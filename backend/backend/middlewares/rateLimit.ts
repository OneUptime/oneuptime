// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'expr... Remove this comment to see the full error message
import rateLimit from 'express-rate-limit'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'rate... Remove this comment to see the full error message
import redisStore from 'rate-limit-redis'
const {
    RATE_LIMITTER_TIME_PERIOD_IN_MS,
    RATE_LIMITTER_REQUEST_LIMIT,
} = process.env;

const limiter = rateLimit({
    store: new redisStore({
        redisURL: `//${process.env['REDIS_HOST']}`,
        expiry: Number(RATE_LIMITTER_TIME_PERIOD_IN_MS) / 1000, // convert to seconds, same as windowMs
    }),
    max: Number(RATE_LIMITTER_REQUEST_LIMIT),
    keyGenerator: function(req: $TSFixMe) {
        const accessToken = req.headers.authorization || req.query.accessToken;
        if (accessToken) {
            return accessToken;
        }

        const apiKey =
            req.query.apiKey || req.headers.apikey || req.body.apiKey;
        if (apiKey) {
            return apiKey;
        }

        return req.ip;
    },
});
export default limiter;
