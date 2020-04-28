const express = require('express');
const router = express.Router();
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const SsoService = require('../services/ssoService')

router.get('/ssos', async function (req, res) {
  const skip = req.query.skip || 0;
  const limit = req.query.limit || 10;
  try {
    const ssos = await SsoService.getAllSsos(skip, limit)
    const count= await SsoService.getCount()
    return sendListResponse(req, res, ssos,count)
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
    await SsoService.deleteSso(ssoId);
    return sendItemResponse(req, res);
  } catch (error) {
    return sendErrorResponse(req, res, error)
  }
})

router.post('/create', async function (req, res) {
  const data = req.body
  try {
    await SsoService.createSso(data)
    return sendItemResponse(req, res);
  } catch (error) {
    return sendErrorResponse(req, res, error)
  }
})

router.get('/:ssoId', async function (req, res) {
  const ssoId = req.params.ssoId
  if (!ssoId) {
    return sendErrorResponse(req, res, {
      code: 400,
      message: 'SsoId must be present.'
    })
  }
  try {
    const sso = await SsoService.getSso(ssoId);
    return sendItemResponse(req, res, sso);
  } catch (error) {
    return sendErrorResponse(req, res, error)
  }
})

router.put('/update', async function (req, res) {
  const data = req.body
  const { _id: ssoId } = data
  if (!ssoId) {
    return sendErrorResponse(req, res, {
      code: 400,
      message: 'SsoId must be present.'
    })
  }
  try {
    await SsoService.updateSso(ssoId, data);
    return sendItemResponse(req, res);
  } catch (error) {
    return sendErrorResponse(req, res, error)
  }

})

module.exports = router;
