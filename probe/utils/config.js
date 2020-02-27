module.exports = {
    serverUrl: process.env['SERVER_URL'] || 'http://localhost:3002',
    probeName: process.env['PROBE_NAME'] || 'US East',
    probeKey:
        process.env['PROBE_KEY'] || '33b674ca-9fdd-11e9-a2a3-2a2ae2dbcce4',
};
