import express from 'express'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/user"' has no exported mem... Remove this comment to see the full error message
import { getUser } from '../middlewares/user'
const {
    sendErrorResponse,
    sendItemResponse,
    sendListResponse,
} = require('../middlewares/response');
import CustomFieldService from '../services/customFieldService'

const router = express.Router();

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;
        const { fieldName, fieldType, uniqueField } = req.body;

        if (!fieldName || !fieldName.trim()) {
            const error = new Error('Field name is required');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (!fieldType || !fieldType.trim()) {
            const error = new Error('Field type is required');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        const populateCustomField = [{ path: 'projectId', select: 'name' }];
        const selectCustomField = 'fieldName fieldType projectId uniqueField';
        let customField = await CustomFieldService.findOneBy({
            query: { projectId, fieldName },
            populate: populateCustomField,
            select: selectCustomField,
        });
        if (customField) {
            const error = new Error(
                'Custom field with this name already exist'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
        const populateCustomField = [{ path: 'projectId', select: 'name' }];
        const selectCustomField = 'fieldName fieldType projectId uniqueField';
        const [customFields, count] = await Promise.all([
            CustomFieldService.findBy({
                query: {
                    projectId,
                },
                limit,
                skip,
                populate: populateCustomField,
                select: selectCustomField,
            }),
            CustomFieldService.countBy({
                projectId,
            }),
        ]);

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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (!fieldType || !fieldType.trim()) {
            const error = new Error('Field type is required');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        const populateCustomField = [{ path: 'projectId', select: 'name' }];
        const selectCustomField = 'fieldName fieldType projectId uniqueField';
        let customField = await CustomFieldService.findOneBy({
            query: { projectId, fieldName },
            select: selectCustomField,
            populate: populateCustomField,
        });
        if (customField && String(customField._id) !== String(customFieldId)) {
            const error = new Error(
                'Custom field with this name already exist'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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

export default router;
