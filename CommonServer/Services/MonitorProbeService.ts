import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/MonitorProbe';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {

        if((createBy.data.monitorId || createBy.data.monitor) && (createBy.data.probeId || createBy.data.probe)){
            const monitorProbe = await this.findOneBy({
                query: {
                    monitorId: createBy.data.monitorId! || createBy.data.monitor?.id!,
                    probeId: createBy.data.probeId! || createBy.data.probe?.id!
                },
                select: {
                    _id: true
                },
                props: {
                    isRoot: true
                }
            });

            if(monitorProbe){
                throw new BadDataException('Probe is already added to this monitor.');
            }
        }

        return { createBy, carryForward: null };
    }
}

export default new Service();
