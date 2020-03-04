const express = require('express');
const router = express.Router();
const licenseController = require('../controllers/licenseController')
const licenseCtrl = new licenseController()

router.post('/', licenseCtrl.confirmLicense);

module.exports = router;
