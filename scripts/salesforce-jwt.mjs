// Signs in to Salesforce with the OAuth 2.0 JWT bearer flow.
//
// Env: SF_LOGIN_URL, SF_CLIENT_ID, SF_JWT_PRIVATE_KEY.
// SF_JWT_AUDIENCE is optional. Set it to https://test.salesforce.com for a sandbox.
import { createSign } from 'node:crypto';

const DEFAULT_AUDIENCE = 'https://login.salesforce.com';
const TOKEN_LIFETIME_SECONDS = 180;

function requireEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
}

const base64Url = (value) => Buffer.from(value).toString('base64url');

export function createJwt({ clientId, username, audience, privateKey, now = Date.now() }) {
    const header = base64Url(JSON.stringify({ alg: 'RS256' }));
    const claims = base64Url(
        JSON.stringify({
            iss: clientId,
            sub: username,
            aud: audience,
            exp: Math.floor(now / 1000) + TOKEN_LIFETIME_SECONDS
        })
    );
    const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(privateKey, 'base64url');
    return `${header}.${claims}.${signature}`;
}

// Salesforce error bodies don't echo the username, so this message is safe for public logs.
export async function loginWithJwt(username) {
    const assertion = createJwt({
        clientId: requireEnv('SF_CLIENT_ID'),
        username,
        audience: process.env.SF_JWT_AUDIENCE || DEFAULT_AUDIENCE,
        // Accepts a real multi-line key, or one pasted with literal \n sequences.
        privateKey: requireEnv('SF_JWT_PRIVATE_KEY').replace(/\\n/g, '\n')
    });
    const response = await fetch(`${requireEnv('SF_LOGIN_URL').replace(/\/$/, '')}/services/oauth2/token`, {
        method: 'POST',
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion
        })
    });
    if (!response.ok) {
        throw new Error(`Salesforce JWT login failed (${response.status}): ${await response.text()}`);
    }
    const body = await response.json();
    return { instanceUrl: body.instance_url, token: body.access_token };
}
