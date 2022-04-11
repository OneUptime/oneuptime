import Model, {
    requiredFields,
    uniqueFields,
    slugifyField,
    encryptedFields,
} from '../Models/CallRoutingLog';
import DatabaseService from './DatabaseService';

export default class CallRoutingLogService extends DatabaseService<
    typeof Model
> {
    constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
            friendlyName: 'Call Routing Log',
            publicListProps: {
                populate: [],
                select: [],
            },
            adminListProps: {
                populate: [],
                select: [],
            },
            ownerListProps: {
                populate: [],
                select: [],
            },
            memberListProps: {
                populate: [],
                select: [],
            },
            viewerListProps: {
                populate: [],
                select: [],
            },
            publicItemProps: {
                populate: [],
                select: [],
            },
            adminItemProps: {
                populate: [],
                select: [],
            },
            memberItemProps: {
                populate: [],
                select: [],
            },
            viewerItemProps: {
                populate: [],
                select: [],
            },
            ownerItemProps: {
                populate: [],
                select: [],
            },
            isResourceByProject: true,
            slugifyField: slugifyField,
encryptedFields: encryptedFields
        });
    }
}
