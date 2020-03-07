const sendErrorResponse = require('./response').sendErrorResponse;

module.exports = (req, res, next)=> {
    if(req.body.license == null || req.body.license == undefined || req.body.email == null || req.body.email == undefined){
        const error = new Error('Please provide all the required details'); 
        error.statusCode = 400;

        return sendErrorResponse(req, res, error) 
    }

    next()
}
