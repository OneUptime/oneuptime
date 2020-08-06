const express = require('express');
const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const IncidentPrioritiesService = require('../services/incidentPrioritiesService');

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
  const { projectId } = req.params;
  if (!projectId) {
    return sendErrorResponse(req, res, {
      code: 400,
      message: 'Project Id must be present'
    });
  }
  try {
    const IncidentPriorities = await IncidentPrioritiesService.findBy({ projectId });
    return sendListResponse(req, res, IncidentPriorities);
  } catch (error) {
    return sendErrorResponse(req, res, error);
  }

});

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
  const { projectId } = req.params;
  const {name, color} = req.body;
  if (!projectId) {
    return sendErrorResponse(req, res, {
      code: 400,
      message: 'Project Id must be present.'
    });
  }
  if (!name) {
    return sendErrorResponse(req, res, {
      code: 400,
      message: 'Name must be present'
    });
  }
  if (!color) {
    return sendErrorResponse(req, res, {
      code: 400,
      message: 'Color must be present'
    });
  }

  try {
    const IncidentPriorities = await IncidentPrioritiesService.create({ projectId, name,color });
    return sendItemResponse(req, res, IncidentPriorities);
  } catch (error) {
    return sendErrorResponse(req, res, error);
  }

});

module.exports = router; 