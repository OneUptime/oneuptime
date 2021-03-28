const express = require('express');
const { isAuthorized } = require('../middlewares/authorization');
const { getUser } = require('../middlewares/user');
const {
    sendErrorResponse,
    sendItemResponse,
    sendListResponse,
} = require('../middlewares/response');
const CustomFieldService = require('../services/customFieldService');

const router = express.Router();

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;
        const { fieldName, fieldType, uniqueField } = req.body;

        if (!fieldName || !fieldName.trim()) {
            const error = new Error('Field name is required');
            error.code = 400;
            throw error;
        }

        if (!fieldType || !fieldType.trim()) {
            const error = new Error('Field type is required');
            error.code = 400;
            throw error;
        }

        let customField = await CustomFieldService.findOneBy({
            projectId,
            fieldName,
        });
        if (customField) {
            const error = new Error(
                'Custom field with this name already exist'
            );
            error.code = 400;
            throw error;
        }

        customField = await CustomFieldService.create({
            projectId,
            fieldName,
            fieldType,
            uniqueField,
        });
        return sendItemResponse(req, res, customField);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;
        const { limit, skip } = req.query;
        const customFields = await CustomFieldService.findBy(
            {
                projectId,
            },
            limit,
            skip
        );
        const count = await CustomFieldService.countBy({
            projectId,
        });

        return sendListResponse(req, res, customFields, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:customFieldId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { projectId, customFieldId } = req.params;
        const { fieldName, fieldType, uniqueField } = req.body;

        if (!fieldName || !fieldName.trim()) {
            const error = new Error('Field name is required');
            error.code = 400;
            throw error;
        }

        if (!fieldType || !fieldType.trim()) {
            const error = new Error('Field type is required');
            error.code = 400;
            throw error;
        }

        let customField = await CustomFieldService.findOneBy({
            projectId,
            fieldName,
        });
        if (customField && String(customField._id) !== String(customFieldId)) {
            const error = new Error(
                'Custom field with this name already exist'
            );
            error.code = 400;
            throw error;
        }

        customField = await CustomFieldService.updateOneBy(
            { _id: customFieldId, projectId },
            {
                fieldName,
                fieldType,
                uniqueField,
            }
        );
        return sendItemResponse(req, res, customField);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete(
    '/:projectId/:customFieldId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId, customFieldId } = req.params;

            const deletedCustomField = await CustomFieldService.deleteBy({
                _id: customFieldId,
                projectId,
            });

            return sendItemResponse(req, res, deletedCustomField);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
