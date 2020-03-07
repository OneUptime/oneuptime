const tokenUtil = require('../utils/tokenUtil').generateWebToken
const AirtableService = require('./airtableService')

module.exports = {
    confirm: async (payload) => {
        try{
            let records = await AirtableService.find({ tableName: "License", view: "Grid view" })
            let userRecord = {}

            for(let record of records) {
                let fetchedLicense = record.get("License Key")
                if(payload.license === fetchedLicense){  
                        userRecord['id'] = record.id
                        userRecord['expiryDate'] = record.get("Expires")
                }
            }               

            if(Object.entries(userRecord).length === 0){
                const error = new Error('Not Found'); 
                    error.statusCode = 400;

                throw error
            }

            const presentTime = new Date().getTime();
            const expiryTime = new Date(userRecord.expiryDate).getTime();

            if(expiryTime < presentTime){
                const error = new Error('License Expired'); 
                error.statusCode = 400;
                throw error
            }

            await AirtableService.update({ id: userRecord.id, email: payload.email, tableName: "License" })
            
            let token = tokenUtil({ license: payload.license, presentTime, expiryTime })

            return {token}
        }catch(error){
            throw (error)
        }
    }
}