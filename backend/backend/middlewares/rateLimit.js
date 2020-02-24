const rateLimit = require('express-rate-limit');
const redisStore = require('rate-limit-redis');
const { RATE_LIMITTER_TIME_PERIOD_IN_MS, RATE_LIMITTER_REQUEST_LIMIT } = process.env;

const limiter = rateLimit({
    store: new redisStore({
        redisURL: `//${process.env['REDIS_HOST']}`,
        expiry: Number(RATE_LIMITTER_TIME_PERIOD_IN_MS) / 1000, // convert to seconds, same as windowMs
    }),
    max: Number(RATE_LIMITTER_REQUEST_LIMIT),
    keyGenerator: function (req) {
        const accessToken = req.headers.authorization || req.query.accessToken;
        if (accessToken) {
            return accessToken;
        }

        const apiKey = req.query.apiKey || req.headers.apikey || req.body.apiKey;
        if (apiKey) {
            return apiKey;
        }

        return req.ip;
    }
});
module.exports = limiter;