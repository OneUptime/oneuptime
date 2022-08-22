import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Monitor';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusService from './MonitorStatusService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import QueryHelper from '../Types/Database/QueryHelper';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.props.tenantId) {
            throw new BadDataException('ProjectId required to create monitor.');
        }

        const monitorStatus: MonitorStatus | null =
            await MonitorStatusService.findOneBy({
                query: {
                    projectId: createBy.props.tenantId,
                    isOperationalState: true,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!monitorStatus || !monitorStatus.id) {
            throw new BadDataException(
                'Operational status not found for this project. Please add an operational status'
            );
        }

        createBy.data.currentMonitorStatusId = monitorStatus.id;

        return { createBy, carryForward: null };
    }

    public async changeMonitorStatus(
        monitorIds: Array<ObjectID>,
        monitorStatusId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        await this.updateBy({
            query: {
                _id: QueryHelper.in(
                    monitorIds.map((i: ObjectID) => {
                        return i.toString();
                    })
                ),
            },
            data: {
                currentMonitorStatusId: monitorStatusId,
            },
            props: props,
        });

        // TODO: update the timeline of these monitors.
    }
}
export default new Service();
