const tokenUtil = require('../utils/tokenUtil')
//const { notFound, expired } = require('../utils/messages')
const airtableService = require('./airtableService')
const getUserRecord = require('../utils/getUserRecord')

module.exports = {
    confirmService: async (userDetails) => {
        try{
            const searchDetails = {
                tableName: "License",
                view: "Grid view",
                limit: 9999
            }

            const records = await airtableService.find(searchDetails)

            var getUserDetails = {
                records, 
                license: userDetails.license
            }

            const userRecord = await getUserRecord.search(getUserDetails)

            const presentTime = new Date().getTime();
            const expiryTime = new Date(userRecord.expiryDate).getTime();

            if(expiryTime < presentTime){
                const error = new Error('License Expired'); 
                error.statusCode = 400;
                throw error
            }

            var updateDetails = {
                id: userRecord.id, 
                email: userDetails.email, 
                tableName: "License"
            }

            await airtableService.update(updateDetails)
            
            var data = {
                license: userDetails.license,
                presentTime,
                expiryTime
            }
            let token = tokenUtil.generateWebToken(data)

            return {token}
        }catch(error){
            throw (error)
        }
    }
}