const rateLimit = require('express-rate-limit');
const { RATE_LIMITTER_TIME_PERIOD_IN_MS, RATE_LIMITTER_REQUEST_LIMIT } = process.env;
const limiter = rateLimit({
    windowMs: Number(RATE_LIMITTER_TIME_PERIOD_IN_MS), 
    max: Number(RATE_LIMITTER_REQUEST_LIMIT),
    keyGenerator: function (req) {
        const accessToken = req.headers.authorization || req.query.accessToken;
        if (accessToken){
            return accessToken;
        }

        const apiKey = req.query.apiKey || req.headers.apikey || req.body.apiKey;
        if (apiKey){
            return apiKey;
        }
        
        return req.ip;
    }   
});  
module.exports = limiter;