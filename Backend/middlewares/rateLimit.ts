import rateLimit from 'express-rate-limit';

import redisStore from 'rate-limit-redis';
const {
    RATE_LIMITTER_TIME_PERIOD_IN_MS,
    RATE_LIMITTER_REQUEST_LIMIT,
}: $TSFixMe = process.env;

const limiter: $TSFixMe = rateLimit({
    store: new redisStore({
        redisURL: `//${process.env['REDIS_HOST']}`,
        expiry: Number(RATE_LIMITTER_TIME_PERIOD_IN_MS) / 1000, // Convert to seconds, same as windowMs
    }),
    max: Number(RATE_LIMITTER_REQUEST_LIMIT),
    keyGenerator: function (req: $TSFixMe): void {
        const accessToken: $TSFixMe =
            req.headers['authorization'] || req.query['accessToken'];
        if (accessToken) {
            return accessToken;
        }

        const apiKey: $TSFixMe =
            req.query['apiKey'] || req.headers['apikey'] || req.body.apiKey;
        if (apiKey) {
            return apiKey;
        }

        return req.ip;
    },
});
export default limiter;
