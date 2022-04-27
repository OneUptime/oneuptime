import Model, {
    requiredFields,
    uniqueFields,
    slugifyField,
    encryptedFields,
} from 'Common/Models/ApplicationScanner';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/DB/CreateBy';
import { Document } from '../Infrastructure/ORM';
import OneUptimeDate from 'Common/Types/Date';
import ObjectID from 'Common/Types/ObjectID';
import Query from '../Types/DB/Query';

class Service extends DatabaseService<typeof Model> {
    public constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
            friendlyName: 'Application Scanner',
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
            encryptedFields: encryptedFields,
        });
    }

    protected override async onBeforeCreate({
        data,
    }: CreateBy): Promise<CreateBy> {
        let applicationScannerKey: ObjectID;
        if (data['applicationScannerKey']) {
            applicationScannerKey = new ObjectID(
                data['applicationScannerKey'] as string
            );
        } else {
            applicationScannerKey = ObjectID.generate();
        }

        data['applicationScannerKey'] = applicationScannerKey;

        return Promise.resolve({ data } as CreateBy);
    }

    public async updateStatus(applicationScannerId: ObjectID): Promise<void> {
        const data: Document = new this.model();
        data.set('lastAlive', OneUptimeDate.getCurrentDate());

        await this.updateOneBy({
            query: new Query().equalTo('_id', applicationScannerId),
            data,
        });
    }
}

export default Service;
