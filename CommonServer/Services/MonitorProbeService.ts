import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorProbe from 'Model/Models/MonitorProbe';

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
                        createBy.data.monitorId! || createBy.data.monitor?.id!,
                    probeId: createBy.data.probeId! || createBy.data.probe?.id!,
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

        return { createBy, carryForward: null };
    }
}

export default new Service();
