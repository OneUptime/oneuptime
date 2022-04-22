import Model, {
    requiredFields,
    uniqueFields,
    slugifyField,
    encryptedFields,
} from '../Models/Probe';

import { Document } from '../Infrastructure/ORM';

import DatabaseService from './DatabaseService';
import Query from '../Types/DB/Query';
import ObjectID from 'Common/Types/ObjectID';
import Version from 'Common/Types/Version';
import OneUptimeDate from 'Common/Types/Date';

class Service extends DatabaseService<typeof Model> {
    public constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
            friendlyName: 'Probe',
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
            encryptedFields: encryptedFields,
        });
    }

    public async updateProbeKeyByName(
        name: string,
        key: ObjectID
    ): Promise<void> {
        const updatedProbe: Document = new this.model();
        updatedProbe.set('key', key);
        await this.updateOneBy({
            query: new Query().equalTo('name', name),
            data: updatedProbe,
        });
    }

    public async updateProbeVersionByName(
        name: string,
        version: Version
    ): Promise<void> {
        const updatedProbe: Document = new this.model();
        updatedProbe.set('version', version.toString());
        await this.updateOneBy({
            query: new Query().equalTo('name', name),
            data: updatedProbe,
        });
    }

    public async updateLastAlive(name: string): Promise<void> {
        const updatedProbe: Document = new this.model();
        updatedProbe.set('lastAlive', OneUptimeDate.getCurrentDate());
        await this.updateOneBy({
            query: new Query().equalTo('name', name),
            data: updatedProbe,
        });
    }
}

export default new Service();
