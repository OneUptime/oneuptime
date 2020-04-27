module.exports = {
    getAllSsos:async function(){
        const ssos=await SsoModel.find({});
        return ssos;
    }
}

const SsoModel = require('../models/sso');