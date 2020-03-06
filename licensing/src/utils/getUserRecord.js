module.exports.search = (getUserDetails)=> {
    return new Promise((resolve, reject)=>{
        var result = {}
        getUserDetails.records.forEach(function(record) {
            let fetchedLicense = record.get("License Key")
            if(getUserDetails.license === fetchedLicense){  
                    result["id"] = record.id
                    result["expiryDate"] = record.get("Expires")
                    resolve (result)
            }
        }); 

        const error = new Error('Not Found'); 
            error.statusCode = 400;

        reject(error)
    }) 
}
