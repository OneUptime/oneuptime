const  { checker } = require('../utils/checkInput')
const { generateWebToken } = require('../utils/handleToken')
const { notFound, expired } = require('../utils/messages')
const { findLicense, updateEmail } = require('./airtableService')

exports.confirmLicense = async (userDetails) => {
        let check = checker(userDetails)

        if(check.status){
            try{
                const result = await findLicense(userDetails.license)
                if(result === null) return {message: notFound}

                const date = new Date();
                const mydate = new Date(result.expiryDate);

                if(mydate < date) return {message: expired}

                await updateEmail(result.id, userDetails.email)
        
                let token = generateWebToken(date, mydate)
                return {token}
            }catch(error){
                throw (error)
            }
        }else{
            return ({message: check.message, statusCode: check.statusCode})
        }
}