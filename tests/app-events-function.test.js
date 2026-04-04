const { handler } = require('../netlify/functions/app-events');

describe('app-events netlify function', () => {
    const originalEnv = process.env;
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...originalEnv,
            SUPABASE_URL: 'https://example.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        };
    });

    afterEach(() => {
        process.env = originalEnv;
        global.fetch = originalFetch;
    });

    test('writes valid make24 lifecycle event to app_events via service role', async () => {
        let request = null;
        global.fetch = (url, opts) => {
            request = { url, opts };
            return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve('') });
        };

        const response = await handler({
            httpMethod: 'POST',
            body: JSON.stringify({
                event_name: 'run_end',
                app_slug: 'make24',
                device_id: 'dev_123',
                session_id: 'sess_123',
                url: 'https://make24.app/',
                props: { outcome: 'solved' },
            }),
        });

        expect(response.statusCode).toBe(202);
        expect(request.url).toBe('https://example.supabase.co/rest/v1/app_events');
        expect(request.opts.headers.Authorization).toBe('Bearer service-role-key');
        expect(JSON.parse(request.opts.body).event_name).toBe('run_end');
    });

    test('rejects unsupported event_name', async () => {
        global.fetch = jest.fn();

        const response = await handler({
            httpMethod: 'POST',
            body: JSON.stringify({
                event_name: 'random_event',
                app_slug: 'make24',
                device_id: 'dev_123',
                session_id: 'sess_123',
                props: {},
            }),
        });

        expect(response.statusCode).toBe(400);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
