// Turns Playwright's output into a Testrun__c update. Shared by the GitHub reporter
// and the local runner, which differ only in how they talk to Salesforce.
//
// A client has updateRun(runId, fields) and uploadFile(runId, path).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const RESULTS_FILE = process.env.RESULTS_FILE || 'results.json';
export const OUTPUT_DIR = process.env.OUTPUT_DIR || 'test-results';
const MAX_ERROR_LENGTH = 30000;
const FILE_TYPES = /\.(png|jpe?g|webm|mp4|mov)$/i;

// Title and PathOnClient for a ContentVersion, with no extension in the title.
export function fileDetails(path) {
    const name = `${basename(dirname(path))}-${basename(path)}`;
    return { Title: name.replace(/\.[^.]+$/, '').slice(0, 255), PathOnClient: name };
}

function findFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return findFiles(path);
        return FILE_TYPES.test(entry.name) ? [path] : [];
    });
}

function stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');
}

function collectFailures(suite, failures = []) {
    for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
            if (test.status !== 'unexpected') continue;
            const result = test.results?.at(-1);
            const error = result?.error ?? result?.errors?.[0];
            const location = error?.location ?? { file: spec.file, line: spec.line };
            failures.push({
                title: spec.title,
                location: `${basename(location.file ?? spec.file)}:${location.line}`,
                message: stripAnsi(error?.message ?? 'Test failed')
            });
        }
    }
    for (const child of suite.suites ?? []) collectFailures(child, failures);
    return failures;
}

// Everything except a results file with at least one test and no failures is a
// failure, so a run that broke before or during Playwright cannot show as Passed.
function summarise(resultsPath) {
    if (!existsSync(resultsPath)) {
        return {
            Status__c: 'Failed',
            Failure_Location__c: null,
            Error_Message__c: 'The run stopped before Playwright produced results. Check the GitHub run or the local runner log.'
        };
    }
    const report = JSON.parse(readFileSync(resultsPath, 'utf8'));
    const failures = collectFailures(report);
    const globalErrors = (report.errors ?? []).map((e) => stripAnsi(e.message));

    // A flaky test failed, then passed on a retry, so it counts as having run and passed.
    const passedCount = (report.stats?.expected ?? 0) + (report.stats?.flaky ?? 0);
    if (failures.length === 0 && globalErrors.length === 0 && passedCount > 0) {
        return { Status__c: 'Passed', Failure_Location__c: null, Error_Message__c: null };
    }
    const messages = [
        ...globalErrors,
        ...failures.map((f) => `${f.title} (${f.location})\n${f.message}`)
    ];
    return {
        Status__c: 'Failed',
        Failure_Location__c: failures[0]?.location.slice(0, 255) ?? null,
        Error_Message__c: (messages.join('\n\n') || 'No tests were run.').slice(0, MAX_ERROR_LENGTH)
    };
}

// Files go up before the final status because the LWC loads the run's files as
// soon as it sees Passed or Failed.
export async function finishRun(client, runId, extraFields = {}) {
    const outcome = summarise(RESULTS_FILE);
    const uploadErrors = [];
    for (const path of findFiles(OUTPUT_DIR)) {
        try {
            await client.uploadFile(runId, path);
        } catch (error) {
            uploadErrors.push(error.message);
        }
    }
    if (uploadErrors.length > 0) {
        console.error(`File uploads failed:\n${uploadErrors.join('\n')}`);
        const note = `Some files could not be attached:\n${uploadErrors.join('\n')}`;
        outcome.Error_Message__c = [outcome.Error_Message__c, note]
            .filter(Boolean)
            .join('\n\n')
            .slice(0, MAX_ERROR_LENGTH);
    }
    // A spec could print its session token, and error messages are saved on the record.
    const token = process.env.SF_TEST_ACCESS_TOKEN;
    if (token && outcome.Error_Message__c) {
        outcome.Error_Message__c = outcome.Error_Message__c.replaceAll(token, '[redacted]');
    }
    await client.updateRun(runId, { ...outcome, Finished_At__c: new Date().toISOString(), ...extraFields });
    console.log(`Run ${runId}: ${outcome.Status__c}`);
}
