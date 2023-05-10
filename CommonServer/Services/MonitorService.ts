import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Monitor';
import DatabaseService, { OnCreate, OnDelete } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusService from './MonitorStatusService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorStatusTimelineService from './MonitorStatusTimelineService';
import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ProbeService from './ProbeService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import MonitorProbe from 'Model/Models/MonitorProbe';
import MonitorProbeService from './MonitorProbeService';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import Probe from 'Model/Models/Probe';
import ActiveMonitoringMeteredPlan from '../Types/Billing/MeteredPlan/ActiveMonitoringMeteredPlan';
import { IsBillingEnabled } from '../Config';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        if (onDelete.deleteBy.props.tenantId && IsBillingEnabled) {
            await ActiveMonitoringMeteredPlan.updateCurrentQuantity(
                onDelete.deleteBy.props.tenantId
            );
        }

        return onDelete;
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

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        if (!createdItem.projectId) {
            throw new BadDataException('projectId is required');
        }

        if (!createdItem.id) {
            throw new BadDataException('id is required');
        }

        if (!createdItem.currentMonitorStatusId) {
            throw new BadDataException('currentMonitorStatusId is required');
        }

        await this.changeMonitorStatus(
            createdItem.projectId,
            [createdItem.id],
            createdItem.currentMonitorStatusId,
            onCreate.createBy.props
        );

        if (
            createdItem.monitorType &&
            (createdItem.monitorType === MonitorType.API ||
                createdItem.monitorType === MonitorType.IncomingRequest ||
                createdItem.monitorType === MonitorType.Website ||
                createdItem.monitorType === MonitorType.Ping ||
                createdItem.monitorType === MonitorType.IP)
        ) {
            await this.addDefaultProbesToMonitor(
                createdItem.projectId,
                createdItem.id
            );
        }

        if (IsBillingEnabled) {
            await ActiveMonitoringMeteredPlan.updateCurrentQuantity(
                createdItem.projectId
            );
        }

        return createdItem;
    }

    public async addDefaultProbesToMonitor(
        projectId: ObjectID,
        monitorId: ObjectID
    ): Promise<void> {
        const globalProbes: Array<Probe> = await ProbeService.findBy({
            query: {
                isGlobalProbe: true,
                shouldAutoEnableProbeOnNewMonitors: true,
            },
            select: {
                _id: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
                isRoot: true,
            },
        });

        const projectProbes: Array<Probe> = await ProbeService.findBy({
            query: {
                isGlobalProbe: false,
                shouldAutoEnableProbeOnNewMonitors: true,
                projectId: projectId,
            },
            select: {
                _id: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
                isRoot: true,
            },
        });

        const totalProbes: Array<Probe> = [...globalProbes, ...projectProbes];

        for (const probe of totalProbes) {
            const monitorProbe: MonitorProbe = new MonitorProbe();

            monitorProbe.monitorId = monitorId;
            monitorProbe.probeId = probe.id!;
            monitorProbe.projectId = projectId;
            monitorProbe.isEnabled = true;

            await MonitorProbeService.create({
                data: monitorProbe,
                props: {
                    isRoot: true,
                },
            });
        }
    }

    public async changeMonitorStatus(
        projectId: ObjectID,
        monitorIds: Array<ObjectID>,
        monitorStatusId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        for (const monitorId of monitorIds) {
            const statusTimeline: MonitorStatusTimeline =
                new MonitorStatusTimeline();

            statusTimeline.monitorId = monitorId;
            statusTimeline.monitorStatusId = monitorStatusId;
            statusTimeline.projectId = projectId;

            await MonitorStatusTimelineService.create({
                data: statusTimeline,
                props: props,
            });
        }
    }
}
export default new Service();
