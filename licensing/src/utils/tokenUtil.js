const jwt = require('jsonwebtoken')
const secret = process.env.TOKEN_SECRET

module.exports = {
    generateWebToken: ({ license, presentTime, expiryTime }) => {
        const tokenExpiryTime = (expiryTime - presentTime)
        
        return  jwt.sign({license} , secret, { expiresIn: `${tokenExpiryTime}`})
    }    
}