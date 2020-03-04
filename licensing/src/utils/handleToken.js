const jwt = require('jsonwebtoken')
const secret = process.env.tokenSecret

module.exports.generateWebToken = (data) => {
    return  jwt.sign({data}, secret, { expiresIn: 60 *60 *24 *10 })
}
