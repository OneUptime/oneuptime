import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Monitor';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusService from './MonitorStatusService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorStatusTimelineService from './MonitorStatusTimelineService';
import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';

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


    protected override async onCreateSuccess(onCreate: OnCreate<Model>, createdItem: Model): Promise<Model> {

        if (!createdItem.projectId) {
            throw new BadDataException("projectId is required");
        }

        if (!createdItem.id) {
            throw new BadDataException("id is required");
        }

        if (!createdItem.currentMonitorStatusId) {
            throw new BadDataException("currentMonitorStatusId is required");
        }


        await this.changeMonitorStatus(createdItem.projectId, [createdItem.id], createdItem.currentMonitorStatusId, onCreate.createBy.props);
        return createdItem;
    }


    public async changeMonitorStatus(
        projectId: ObjectID,
        monitorIds: Array<ObjectID>,
        monitorStatusId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        
        for (const monitorId of monitorIds) {

            const statusTimeline: MonitorStatusTimeline = new MonitorStatusTimeline();
            
            statusTimeline.monitorId = monitorId;
            statusTimeline.monitorStatusId = monitorStatusId;
            statusTimeline.projectId = projectId;

            await MonitorStatusTimelineService.create({
                data: statusTimeline, 
                props: props
            })
        }
    }




    
}
export default new Service();
