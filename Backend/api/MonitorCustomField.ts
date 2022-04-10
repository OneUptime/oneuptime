import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { isAuthorized } from '../middlewares/authorization';

import { getUser } from '../middlewares/user';
import {
    sendErrorResponse,
    sendItemResponse,
    sendListResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import MonitorCustomFieldService from '../services/monitorCustomField';

const router = express.getRouter();

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const { fieldName, fieldType, uniqueField } = req.body;

            if (!fieldName || !fieldName.trim()) {
                throw new BadDataException('Field name is required');
            }

            if (!fieldType || !fieldType.trim()) {
                throw new BadDataException('Field type is required');
            }
            const selectMonCustomField =
                'fieldName fieldType projectId uniqueField deleted';

            const populateMonCustomField = [
                { path: 'projectId', select: 'name' },
            ];

            let customField = await MonitorCustomFieldService.findOneBy({
                query: { projectId, fieldName },
                select: selectMonCustomField,
                populate: populateMonCustomField,
            });
            if (customField) {
                const error = new Error(
                    'Custom field with this name already exist'
                );

                error.code = 400;
                throw error;
            }

            customField = await MonitorCustomFieldService.create({
                projectId,
                fieldName,
                fieldType,
                uniqueField,
            });
            return sendItemResponse(req, res, customField);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const { limit, skip } = req.query;
            const selectMonCustomField =
                'fieldName fieldType projectId uniqueField deleted';

            const populateMonCustomField = [
                { path: 'projectId', select: 'name' },
            ];
            const [customFields, count] = await Promise.all([
                MonitorCustomFieldService.findBy({
                    query: {
                        projectId,
                    },
                    limit,
                    skip,
                    select: selectMonCustomField,
                    populate: populateMonCustomField,
                }),
                MonitorCustomFieldService.countBy({
                    projectId,
                }),
            ]);

            return sendListResponse(req, res, customFields, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:customFieldId',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const { projectId, customFieldId } = req.params;
            const { fieldName, fieldType, uniqueField } = req.body;

            if (!fieldName || !fieldName.trim()) {
                throw new BadDataException('Field name is required');
            }

            if (!fieldType || !fieldType.trim()) {
                throw new BadDataException('Field type is required');
            }

            let customField = await MonitorCustomFieldService.findOneBy({
                query: { projectId, fieldName },
                select: '_id',
            });
            if (
                customField &&
                String(customField._id) !== String(customFieldId)
            ) {
                const error = new Error(
                    'Custom field with this name already exist'
                );

                error.code = 400;
                throw error;
            }

            customField = await MonitorCustomFieldService.updateOneBy(
                { _id: customFieldId, projectId },
                {
                    fieldName,
                    fieldType,
                    uniqueField,
                }
            );
            return sendItemResponse(req, res, customField);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:customFieldId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, customFieldId } = req.params;

            const deletedCustomField = await MonitorCustomFieldService.deleteBy(
                {
                    _id: customFieldId,
                    projectId,
                }
            );

            return sendItemResponse(req, res, deletedCustomField);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
