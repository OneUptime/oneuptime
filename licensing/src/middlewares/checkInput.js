const sendErrorResponse = require('./response').sendErrorResponse;

module.exports.checkPayload = (payload, req, res, next) => {
    var error = {}

    Object.entries(payload).forEach(([key, value]) => {
        if(value == null || value == undefined){
            error.message = `Please provide your ${key}`
            error.statusCode = 400
            
            throw error 
        }
    })
    return
}