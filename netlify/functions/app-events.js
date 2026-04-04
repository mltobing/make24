/**
 * Netlify serverless function: POST /api/app-events
 *
 * Server-side ingestion path for lifecycle analytics into public.app_events.
 * Uses the Supabase service-role key so writes can pass RLS on app_events.
 */
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error('[make24] app-events missing server env vars', {
            hasSupabaseUrl: !!SUPABASE_URL,
            hasServiceRole: !!SUPABASE_SERVICE_ROLE_KEY,
        });
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Server analytics is not configured' }),
        };
    }

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch (_err) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid JSON body' }),
        };
    }

    const allowedEvents = new Set(['app_open', 'run_start', 'first_interaction', 'run_end']);
    if (!allowedEvents.has(payload.event_name)) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Unsupported app event' }),
        };
    }

    if (payload.app_slug !== 'make24' || !payload.device_id || !payload.session_id) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Missing required app event fields' }),
        };
    }

    const insertBody = {
        event_name: payload.event_name,
        app_slug: payload.app_slug,
        device_id: payload.device_id,
        session_id: payload.session_id,
        url: payload.url || null,
        props: payload.props && typeof payload.props === 'object' ? payload.props : {},
    };

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/app_events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                Prefer: 'return=minimal',
            },
            body: JSON.stringify(insertBody),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('[make24] app-events insert failed', {
                status: response.status,
                eventName: insertBody.event_name,
                appSlug: insertBody.app_slug,
                deviceId: insertBody.device_id,
                sessionId: insertBody.session_id,
                errorBody,
            });
            return {
                statusCode: response.status,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Supabase insert failed' }),
            };
        }

        return {
            statusCode: 202,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: true }),
        };
    } catch (err) {
        console.error('[make24] app-events insert exception', {
            eventName: insertBody.event_name,
            appSlug: insertBody.app_slug,
            deviceId: insertBody.device_id,
            sessionId: insertBody.session_id,
            message: err && err.message ? err.message : String(err),
        });

        return {
            statusCode: 502,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Upstream request failed' }),
        };
    }
};
