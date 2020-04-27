const express = require('express');
const router = express.Router();
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
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

router.delete('/:ssoId', async function (req, res) {
  const ssoId = req.params.ssoId
  if (!ssoId) {
    return sendErrorResponse(req, res, {
      code: 400,
      message: 'SsoId must be present.'
    })
  }
  try {
    const message = await SsoService.deleteSso(ssoId);
    return sendItemResponse(req, res, message);
  } catch (error) {
    return sendErrorResponse(req, res, error)
  }

})

module.exports = router;
