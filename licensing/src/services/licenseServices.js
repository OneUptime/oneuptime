const  { checker } = require('../utils/checkInput')
const { generateWebToken } = require('../utils/handleToken')
const { findLicense, updateEmail } = require('./airtableService')

exports.confirmLicense = async (userDetails) => {
    return new Promise((resolve, reject) => {
        let check = checker(userDetails)

        if(check.status){
            try{
                const result = findLicense(userDetails.license)
                const update = updateEmail(userDetails)

                if(result && update){
                    let token = generateWebToken({expires: result.Expires})

                    resolve(token)
                }
            }catch(error){
                reject(error)
            }
        }else{
            reject({message: check.message, statusCode: check.statusCode})
        }
    })
}