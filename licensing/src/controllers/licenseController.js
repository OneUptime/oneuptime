const { confirmLicense } = require('../services/licenseServices');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendConfirmationResponse = require('../middlewares/response').sendConfirmationResponse;

module.exports = function () {
    this.confirmLicense = async(req, res) => {
        var userDetails = {
            license: req.body.license,
            email: req.body.email
        }

        try{
            var result = await confirmLicense(userDetails)
            return sendConfirmationResponse(req, res, result)
        }catch(error){
            return sendErrorResponse(req, res, error)
        }
    }
}