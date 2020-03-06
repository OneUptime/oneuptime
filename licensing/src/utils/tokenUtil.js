const jwt = require('jsonwebtoken')
const secret = process.env.tokenSecret

module.exports.generateWebToken = (data) => {
    const expiryTime = (data.expiryTime - data.presentTime)
    delete data.expiryTime
    delete data.presentTime

    return  jwt.sign(data, secret, { expiresIn: `${expiryTime}`})
}
