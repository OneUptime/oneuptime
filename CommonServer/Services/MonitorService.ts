import OneUptimeDate from 'Common/Types/Date';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/Monitor';
import Query from '../Types/Database/Query';
import DatabaseService from './DatabaseService';
import { In, IsNull, LessThan } from 'typeorm';
import MonitorType from 'Common/Types/Monitor/MonitorType';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async getMonitorsNotPingedByProbeInLastMinute(
        probeId: ObjectID,
        limit: PositiveNumber
    ): Promise<Array<Model>> {
        let monitors: Array<Model> = [];
        //Get monitors that have not been pinged for the last minute.
        const date: Date = OneUptimeDate.getOneMinAgo();

        const key: string = `probe.${probeId}.pingtime`;

        /// get monitors that have never been pinged by this probe
        const emptyQuery: Query<Model> = {
            disabled: false,
            type: In([MonitorType.API, MonitorType.Website]),
            [key]: IsNull(),
        };

        const nonEmptyQuery: Query<Model> = {
            disabled: false,
            type: In([MonitorType.API, MonitorType.Website]),
            [key]: LessThan(date),
        };

        const monitorsThatHaveNeverBeenPinged: Array<Model> = await this.findBy(
            {
                query: emptyQuery,
                limit: limit,
                skip: new PositiveNumber(0),
            }
        );

        monitors = monitors.concat(monitorsThatHaveNeverBeenPinged);

        if (monitorsThatHaveNeverBeenPinged.length < limit.toNumber()) {
            const monitorsThatHaveBeenPingedBeforeOneMinute: Array<Model> =
                await this.findBy({
                    query: nonEmptyQuery,
                    limit: limit,
                    skip: new PositiveNumber(0),
                });

            monitors = monitors.concat(
                monitorsThatHaveBeenPingedBeforeOneMinute
            );
        }

        if (monitors && monitors.length > 0) {
            await this.updateBy({
                query: {
                    _id: In(
                        monitors.map((monitor: Model) => {
                            return monitor._id;
                        })
                    ),
                },
                data: {
                    [key]: OneUptimeDate.getCurrentDate(),
                },
            });

            return monitors;
        }
        return [];
    }
}
export default new Service();
