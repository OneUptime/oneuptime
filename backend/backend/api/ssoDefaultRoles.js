const express = require('express');
const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const SsoDefaultRolesService = require('../services/ssoDefaultRolesService');

router.get('/', getUser, isUserMasterAdmin, async function(req, res) {
    const skip = req.query.skip || 0;
    const limit = req.query.limit || 10;
    try {
        const ssos = await SsoDefaultRolesService.findBy({}, limit, skip);
        const count = await SsoDefaultRolesService.countBy();
        return sendListResponse(req, res, ssos, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:id', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        if(!req.params.id)
            throw new Error('Id must be defined');
        const sso = await SsoDefaultRolesService.deleteBy({
            _id: req.params.id,
        });
        return sendItemResponse(req, res, sso);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/', getUser, isUserMasterAdmin, async function(req, res) {
    const data = req.body;
    try {
        const ssoDefaultRole = await SsoDefaultRolesService.create(data);
        return sendItemResponse(req, res, ssoDefaultRole);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:id', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        const sso = await SsoDefaultRolesService.findOneBy({
            _id: req.params.id,
        });
        return sendItemResponse(req, res, sso);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:id', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        const id = req.params.id;
        const ssoDefaultRole = await SsoDefaultRolesService.updateById(
             id,
             req.body
        );
        return sendItemResponse(req, res, ssoDefaultRole);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
