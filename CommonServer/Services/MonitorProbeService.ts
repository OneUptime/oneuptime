import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService from './DatabaseService';
import { OnCreate } from '../Types/Database/Hooks';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorProbe from 'Model/Models/MonitorProbe';
import OneUptimeDate from 'Common/Types/Date';

export class Service extends DatabaseService<MonitorProbe> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(MonitorProbe, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<MonitorProbe>
    ): Promise<OnCreate<MonitorProbe>> {
        if (
            (createBy.data.monitorId || createBy.data.monitor) &&
            (createBy.data.probeId || createBy.data.probe)
        ) {
            const monitorProbe: MonitorProbe | null = await this.findOneBy({
                query: {
                    monitorId:
                        createBy.data.monitorId! || createBy.data.monitor?.id,
                    probeId: createBy.data.probeId! || createBy.data.probe?.id,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (monitorProbe) {
                throw new BadDataException(
                    'Probe is already added to this monitor.'
                );
            }
        }

        if (!createBy.data.nextPingAt) {
            createBy.data.nextPingAt = OneUptimeDate.getCurrentDate();
        }

        if (!createBy.data.lastPingAt) {
            createBy.data.lastPingAt = OneUptimeDate.getCurrentDate();
        }

        return { createBy, carryForward: null };
    }
}

export default new Service();
