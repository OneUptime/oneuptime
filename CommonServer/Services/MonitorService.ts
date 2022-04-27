import OneUptimeDate from 'Common/Types/Date';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import { Document } from '../Infrastructure/ORM';
import Model, {
    requiredFields,
    uniqueFields,
    slugifyField,
    encryptedFields,
} from 'Common/Models/Monitor';
import Query from '../Types/DB/Query';
import DatabaseService from './DatabaseService';

class Service extends DatabaseService<typeof Model> {
    public constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
            friendlyName: 'Monitor',
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

    public async getMonitorsNotPingedByProbeInLastMinute(
        probeId: ObjectID,
        limit: PositiveNumber
    ): Promise<Array<Document>> {
        let monitors: Array<Document> = [];
        //Get monitors that have not been pinged for the last minute.
        const date: Date = OneUptimeDate.getOneMinAgo();

        const key: string = `probe.${probeId}.pingtime`;

        /// get monitors that have never been pinged by this probe
        const emptyQuery: Query = new Query()
            .equalTo('deleted', false)
            .equalTo('disabled', false)
            .in('type', ['url', 'api'])
            .doesNotExist(key);

        const nonEmptyQuery: Query = new Query()
            .equalTo('deleted', false)
            .equalTo('disabled', false)
            .in('type', ['url', 'api'])
            .lessThan(key, date);

        const monitorsThatHaveNeverBeenPinged: Array<Document> =
            await this.findBy({
                query: emptyQuery,
                limit: limit,
                skip: new PositiveNumber(0),
                select: [],
                populate: [],
                sort: [],
            });

        monitors = monitors.concat(monitorsThatHaveNeverBeenPinged);

        if (monitorsThatHaveNeverBeenPinged.length < limit.toNumber()) {
            const monitorsThatHaveBeenPingedBeforeOneMinute: Array<Document> =
                await this.findBy({
                    query: nonEmptyQuery,
                    limit: limit,
                    skip: new PositiveNumber(0),
                    select: [],
                    populate: [],
                    sort: [],
                });

            monitors = monitors.concat(
                monitorsThatHaveBeenPingedBeforeOneMinute
            );
        }

        if (monitors && monitors.length > 0) {
            const updateData: Document = new this.model();
            updateData.set(key, OneUptimeDate.getCurrentDate());

            await this.updateBy({
                query: new Query().in(
                    '_id',
                    monitors.map((monitor: Document) => {
                        return monitor._id;
                    })
                ),

                data: updateData,
            });

            return monitors;
        }
        return [];
    }
}

export default new Service();
