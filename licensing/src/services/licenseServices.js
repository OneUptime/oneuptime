const Airtable = require('airtable')
const API_KEY = process.env.AIRTABLE_API_KEY
const BASE_NAME = process.env.AIRTABLE_BASE_NAME
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME

Airtable.configure({
    endpointUrl: 'https://api.airtable.com',
    apiKey: API_KEY
})

const base = Airtable.base(BASE_NAME)
const table = base(TABLE_NAME)
const  { checker } = require('../utils/checkInput')
const { generateWebToken } = require('../utils/handleToken')

exports.confirmLicense = async (userDetails) => {
    return new Promise((resolve, reject) => {
        let check = checker(userDetails)

        if(check.status){
            table.find(userDetails.license, (error, record) => {
                if (error) {
                    reject(error)
                }else{
                    table.update(userDetails.license, {
                        "Contact Email": userDetails.email
                      }, (error, record) => {
                            if (error) {
                                reject(error)
                            }else{
                                let token = generateWebToken({expires: record.Expires})

                                resolve(token)
                            }
                      })
                }
            })
        }else{
            reject({message: check.message, statusCode: check.statusCode})
        }
    })
}