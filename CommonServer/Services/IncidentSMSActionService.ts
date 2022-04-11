import Model, {
    requiredFields,
    uniqueFields,
    slugifyField,
} from '../Models/IncidentSMSAction';
import DatabaseService from './DatabaseService';

export default class IncidentSMSActionService extends DatabaseService<
    typeof Model
> {
    constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
            friendlyName: 'Incident SMS Action',
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
            isResourceByProject: false,
            slugifyField: slugifyField,
        });
    }
}
