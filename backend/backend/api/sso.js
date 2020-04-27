const express = require('express');
const router = express.Router();
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const SsoService = require('../services/ssoService')

router.get('/ssos', async function (req, res) {
  try {
    const ssos = await SsoService.getAllSsos()
    return sendListResponse(req, res, ssos)
  } catch (error) {
    return sendErrorResponse(req, res, error)
  }
})

module.exports = router;
