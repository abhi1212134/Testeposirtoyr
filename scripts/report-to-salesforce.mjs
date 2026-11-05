// Writes a GitHub Actions run's progress and results to its Testrun__c record.
//   node scripts/report-to-salesforce.mjs start    -> Status__c = In Progress, Run_URL__c
//   node scripts/report-to-salesforce.mjs session  -> signs in as the user who started the run, for the spec
//   node scripts/report-to-salesforce.mjs finish   -> uploads files, then final status
//
// Auth: JWT bearer flow as the service user SF_JWT_USERNAME. See salesforce-jwt.mjs.
// For a local check, set SF_INSTANCE_URL + SF_ACCESS_TOKEN instead.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileDetails, finishRun } from './results.mjs';
import { loginWithJwt } from './salesforce-jwt.mjs';

const API_VERSION = 'v62.0';

function requireEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
}

async function authenticate() {
    if (process.env.SF_ACCESS_TOKEN) {
        return { instanceUrl: requireEnv('SF_INSTANCE_URL'), token: process.env.SF_ACCESS_TOKEN };
    }
    return loginWithJwt(requireEnv('SF_JWT_USERNAME'));
}

function createClient(sf) {
    return {
        // The user comes from the record, not a workflow input, so it can't be spoofed
        // by the dispatch and doesn't appear in this public repository's run details.
        async getRunCreator(runId) {
            const soql = `SELECT CreatedBy.Username FROM Testrun__c WHERE Id = '${runId}'`;
            const response = await fetch(`${sf.instanceUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`, {
                headers: { Authorization: `Bearer ${sf.token}` }
            });
            if (!response.ok) {
                throw new Error(`Could not read run (${response.status}): ${await response.text()}`);
            }
            const { records } = await response.json();
            const username = records?.[0]?.CreatedBy?.Username;
            if (!username) throw new Error('Could not find the user who started this run.');
            return username;
        },
        async updateRun(runId, fields) {
            const response = await fetch(`${sf.instanceUrl}/services/data/${API_VERSION}/sobjects/Testrun__c/${runId}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${sf.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(fields)
            });
            if (!response.ok) {
                throw new Error(`Could not update run (${response.status}): ${await response.text()}`);
            }
        },
        async uploadFile(runId, path) {
            const details = fileDetails(path);
            const response = await fetch(`${sf.instanceUrl}/services/data/${API_VERSION}/sobjects/ContentVersion`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${sf.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...details,
                    FirstPublishLocationId: runId,
                    VersionData: readFileSync(path).toString('base64')
                })
            });
            if (!response.ok) {
                throw new Error(`${details.PathOnClient} (${response.status}): ${await response.text()}`);
            }
        }
    };
}

// Gives later steps a session for the run's user. Only the short-lived session reaches
// the spec, never the private key. It is masked first because the repository is public.
async function startUserSession(client, runId) {
    try {
        const username = await client.getRunCreator(runId);
        console.log(`::add-mask::${username}`);
        const session = await loginWithJwt(username);
        console.log(`::add-mask::${session.token}`);
        appendFileSync(
            requireEnv('GITHUB_ENV'),
            `SF_TEST_INSTANCE_URL=${session.instanceUrl}\nSF_TEST_ACCESS_TOKEN=${session.token}\n`
        );
    } catch (error) {
        await client.updateRun(runId, {
            Status__c: 'Failed',
            Finished_At__c: new Date().toISOString(),
            Run_URL__c: process.env.RUN_URL,
            Error_Message__c:
                'Could not sign in as the user who started this run. Check that they have the ' +
                `Git_hub_Permission permission set and that the External Client App pre-authorizes it.\n\n${error.message}`
        });
        throw error;
    }
}

async function main() {
    const step = process.argv[2];
    const runId = requireEnv('RUN_ID');
    if (!/^[a-zA-Z0-9]{15,18}$/.test(runId)) throw new Error('RUN_ID is not a Salesforce id');

    const client = createClient(await authenticate());
    if (step === 'start') {
        await client.updateRun(runId, {
            Status__c: 'In Progress',
            Started_At__c: new Date().toISOString(),
            Run_URL__c: process.env.RUN_URL
        });
    } else if (step === 'session') {
        await startUserSession(client, runId);
    } else if (step === 'finish') {
        await finishRun(client, runId, { Run_URL__c: process.env.RUN_URL });
    } else {
        throw new Error('Usage: report-to-salesforce.mjs start|session|finish');
    }
}

// Sets exitCode rather than calling exit, so pending output such as a mask command is written first.
main().catch((error) => {
    console.error(error.message);
    // Shows the reason on the run's summary page, without opening the step's log.
    if (process.env.GITHUB_ACTIONS) {
        console.log(`::error::${error.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    }
    process.exitCode = 1;
});
