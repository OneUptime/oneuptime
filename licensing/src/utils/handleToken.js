const jwt = require('jsonwebtoken')
const secret = process.env.tokenSecret

module.exports.generateWebToken = (data) => {
    const today = new Date().getDay()
    const expirydate = new Date(data).getDay()
    const numberOfDays = (expirydate - today)

    return  jwt.sign({data}, secret, { expiresIn: `${numberOfDays} days` })
}
