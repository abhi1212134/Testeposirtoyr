import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    outputDir: './test-results',
    timeout: 60_000,
    retries: 0,
    workers: 1,
    reporter: [['list'], ['json', { outputFile: 'results.json' }]],
    use: {
        screenshot: 'on',
        // Each run's files count against the org's file storage, so only failures keep a video.
        video: 'retain-on-failure',
        trace: 'off'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
