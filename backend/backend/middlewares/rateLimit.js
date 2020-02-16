const rateLimit = require('express-rate-limit');
const { WINDOWMS, MAX } = process.env;
const limiter = rateLimit({
    windowMs: Number(WINDOWMS), 
    max: Number(MAX),
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