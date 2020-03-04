const jwt = require('jsonwebtoken')
const secret = process.env.tokenSecret

module.exports.generateWebToken = (data) => {
    return  jwt.sign({data}, secret, { expiresAt: data.expires })
}
