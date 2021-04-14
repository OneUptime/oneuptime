module.exports = {
    createLog: (req, type) => {
        let log = {};
        if (type && type === 'outgoing') {
            log = {
                method: req.method || 'GET',
                host: req.host || req.hostname || '<no host>',
                port: req.port || '',
                path: req.pathname || req.path || '/',
                headers: req.headers || {},
                protocol: req.protocol,
                url: '',
            };
            const portDetails = log.port !== '' ? `:${log.port}` : '';
            log.url = `${log.protocol}//${log.host}${portDetails}${log.path}`;
        } else if (type && type === 'incoming') {
            log = {
                method: req.method || 'GET',
                host:
                    req.host || req.hostname || req.headers.host || '<no host>',
                path: req.pathname || req.url,
                headers: req.headers || {},
                protocol: req.protocol,
                url: '',
            };

            log.url = `${log.protocol}//${log.host}${log.path}`;
        }
        return log;
    },
};
