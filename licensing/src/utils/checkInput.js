module.exports.checker = (payload, req, res, next) => {
    var result = {status: true, message: ""}

    Object.entries(payload).forEach(([key, value]) => {
        if(value == null || value == undefined){
            result.message = `Please provide your ${key}`
            result.statusCode = 200
            result.status = false
        }
    })

    return result
}