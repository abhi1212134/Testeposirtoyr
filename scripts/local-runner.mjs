// Runs specs on this machine for the Playwright Runner tab, without GitHub.
// Watches the org for your Queued runs started with Run locally, runs each spec, and writes back the status and files.
//
//   npm run runner                 keep running until Ctrl+C
//   npm run runner -- --headed     also show the browser while tests run
//
// It signs in through your existing Salesforce CLI login, and it only takes runs started
// by that user. Set SF_ORG to use an org other than the default below.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileDetails, finishRun, OUTPUT_DIR, RESULTS_FILE } from './results.mjs';

const ORG = process.env.SF_ORG || 'testproject';
const API = '/services/data/v62.0';
// Each check is an API call, and a Developer Edition org allows 15,000 a day.
// This leaves plenty for everything else if the runner stays on all day.
const POLL_MS = 15000;
const SINGLE_RUNNER_PORT = 47813;
const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!/^[\w.@-]+$/.test(ORG)) {
    console.error('SF_ORG is not a valid org alias or username');
    process.exit(1);
}

function myLocalRunsQuery(status, username) {
    const safeUsername = username.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return encodeURIComponent(
        'SELECT Id, Module__c, Spec__c FROM Testrun__c ' +
            `WHERE Status__c = '${status}' AND Run_Target__c = 'Local' AND CreatedBy.Username = '${safeUsername}' ` +
            'ORDER BY CreatedDate'
    );
}

// Finds which user the CLI is signed in as.
function readCliUsername() {
    const env = { ...process.env, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const result = spawnSync(`sf org display --json --target-org ${ORG}`, {
        shell: true,
        env,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
    });
    let username;
    try {
        username = JSON.parse(result.stdout).result.username;
    } catch {
        username = undefined;
    }
    if (result.status !== 0 || !username) {
        throw new Error(`Could not read your Salesforce CLI login. Run: sf org login web --alias ${ORG}`);
    }
    return username;
}

// The command is built only from this script's constants, the checked org name, ids
// returned by Salesforce and a percent-encoded query. Request bodies go through stdin.
function sfRest(method, path, body) {
    const bodyArgument = body === undefined ? '' : '--body -';
    const env = { ...process.env, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const result = spawnSync(
        `sf api request rest "${path}" --method ${method} ${bodyArgument} --target-org ${ORG}`,
        {
            shell: true,
            env,
            input: body === undefined ? undefined : JSON.stringify(body),
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024
        }
    );
    if (result.status !== 0) {
        throw new Error(`${method} ${path} failed: ${(result.stdout || result.stderr || '').trim().slice(0, 1000)}`);
    }
    return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}

const client = {
    updateRun(runId, fields) {
        sfRest('PATCH', `${API}/sobjects/Testrun__c/${runId}`, fields);
    },
    uploadFile(runId, path) {
        sfRest('POST', `${API}/sobjects/ContentVersion`, {
            ...fileDetails(path),
            FirstPublishLocationId: runId,
            VersionData: readFileSync(path).toString('base64')
        });
    }
};

function runPlaywright(run) {
    // Results from an earlier run must never be read as this run's results.
    rmSync(join(PROJECT_DIR, RESULTS_FILE), { force: true });
    rmSync(join(PROJECT_DIR, OUTPUT_DIR), { recursive: true, force: true });

    // Called without a shell, so values from the record can't become commands.
    const headed = process.argv.includes('--headed') ? ['--headed'] : [];
    spawnSync(
        process.execPath,
        ['node_modules/@playwright/test/cli.js', 'test', `tests/${run.Module__c}/${run.Spec__c}`, ...headed],
        // Specs get login links through the CLI, so they never handle an access token.
        { cwd: PROJECT_DIR, stdio: 'inherit', env: { ...process.env, SF_TEST_ORG: ORG } }
    );
}

async function processRun(run) {
    console.log(`\n=== ${run.Id}: ${run.Module__c}/${run.Spec__c}`);
    try {
        if (!/^\w+$/.test(run.Module__c ?? '') || !/^[\w.-]+\.spec\.ts$/.test(run.Spec__c ?? '')) {
            throw new Error(`Invalid module or spec name: ${run.Module__c}/${run.Spec__c}`);
        }
        client.updateRun(run.Id, { Status__c: 'In Progress', Started_At__c: new Date().toISOString() });
        runPlaywright(run);
        await finishRun(client, run.Id);
    } catch (error) {
        console.error(error.message);
        client.updateRun(run.Id, {
            Status__c: 'Failed',
            Finished_At__c: new Date().toISOString(),
            Error_Message__c: error.message.slice(0, 30000)
        });
    }
}

// If the runner stopped during a test, that run would otherwise stay In Progress.
// Only one runner can be on this machine, so nothing here is still running it.
function failInterruptedRuns(username) {
    const { records } = sfRest('GET', `${API}/query?q=${myLocalRunsQuery('In Progress', username)}`);
    for (const run of records) {
        client.updateRun(run.Id, {
            Status__c: 'Failed',
            Finished_At__c: new Date().toISOString(),
            Error_Message__c: 'The local runner stopped before this run finished.'
        });
        console.log(`Marked interrupted run ${run.Id} as Failed.`);
    }
}

// Runners share one results folder, so a second one would wipe the first one's files.
// Holding a local port keeps it to one, and the OS frees the port if the runner dies.
function holdSingleRunnerPort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(SINGLE_RUNNER_PORT, '127.0.0.1', resolve);
    });
}

async function main() {
    process.chdir(PROJECT_DIR);
    try {
        await holdSingleRunnerPort();
    } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
        console.error('A local runner is already running. Stop it with Ctrl+C before starting another.');
        process.exit(1);
    }
    let username;
    try {
        username = readCliUsername();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
    try {
        failInterruptedRuns(username);
    } catch (error) {
        // Not worth stopping for: the tab also fails these runs after 30 minutes.
        console.error(error.message);
    }
    const query = myLocalRunsQuery('Queued', username);
    console.log(`Local runner watching your runs in org "${ORG}". Press Ctrl+C to stop.`);
    for (;;) {
        try {
            const { records } = sfRest('GET', `${API}/query?q=${query}`);
            for (const run of records) await processRun(run);
        } catch (error) {
            // Keep going: a network problem shouldn't stop the runner.
            console.error(error.message);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
}

main();
