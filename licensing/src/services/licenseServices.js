const  { checker } = require('../utils/checkInput')
const { generateWebToken } = require('../utils/handleToken')
const { findLicense, updateEmail } = require('./airtableService')

exports.confirmLicense = async (userDetails) => {
        let check = checker(userDetails)

        if(check.status){
            try{
                const result = await findLicense(userDetails.license)
                await updateEmail(result.id, userDetails.email)

                
                let token = generateWebToken(result.expiryDate)
                return {token}
            }catch(error){
                return (error)
            }
        }else{
            return ({message: check.message, statusCode: check.statusCode})
        }
}