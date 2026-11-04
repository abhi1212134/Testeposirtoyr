// Writes a GitHub Actions run's progress and results to its Testrun__c record.
//   node scripts/report-to-salesforce.mjs start    -> Status__c = In Progress, Run_URL__c
//   node scripts/report-to-salesforce.mjs finish   -> uploads files, then final status
//
// Auth: SF_LOGIN_URL + SF_CLIENT_ID + SF_CLIENT_SECRET (client credentials flow).
// For a local check, set SF_INSTANCE_URL + SF_ACCESS_TOKEN instead.
import { readFileSync } from 'node:fs';
import { fileDetails, finishRun } from './results.mjs';

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
    const response = await fetch(`${requireEnv('SF_LOGIN_URL').replace(/\/$/, '')}/services/oauth2/token`, {
        method: 'POST',
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: requireEnv('SF_CLIENT_ID'),
            client_secret: requireEnv('SF_CLIENT_SECRET')
        })
    });
    if (!response.ok) {
        throw new Error(`Salesforce login failed (${response.status}): ${await response.text()}`);
    }
    const body = await response.json();
    return { instanceUrl: body.instance_url, token: body.access_token };
}

function createClient(sf) {
    return {
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
            const form = new FormData();
            form.append(
                'entity_content',
                new Blob([JSON.stringify({ ...details, FirstPublishLocationId: runId })], { type: 'application/json' })
            );
            form.append('VersionData', new Blob([readFileSync(path)]), details.PathOnClient);
            const response = await fetch(`${sf.instanceUrl}/services/data/${API_VERSION}/sobjects/ContentVersion`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${sf.token}` },
                body: form
            });
            if (!response.ok) {
                throw new Error(`${details.PathOnClient} (${response.status}): ${await response.text()}`);
            }
        }
    };
}

async function main() {
    const step = process.argv[2];
    const runId = requireEnv('RUN_ID');
    if (!/^[a-zA-Z0-9]{15,18}$/.test(runId)) throw new Error('RUN_ID is not a Salesforce id');

    const client = createClient(await authenticate());
    if (step === 'start') {
        await client.updateRun(runId, { Status__c: 'In Progress', Run_URL__c: process.env.RUN_URL });
    } else if (step === 'finish') {
        await finishRun(client, runId, { Run_URL__c: process.env.RUN_URL });
    } else {
        throw new Error('Usage: report-to-salesforce.mjs start|finish');
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
