import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import AnalyticsTableEngine from 'Common/Types/AnalyticsDatabase/AnalyticsTableEngine';
import ObjectID from 'Common/Types/ObjectID';
import Route from 'Common/Types/API/Route';
import Permission from 'Common/Types/Permission';
import { JSONObject } from 'Common/Types/JSON';

export default class MonitorMetricsByMinute extends AnalyticsBaseModel {
    public constructor() {
        super({
            tableName: 'MonitorMetricsByMinute',
            tableEngine: AnalyticsTableEngine.MergeTree,
            singularName: 'Monitor Metrics By Minute',
            accessControl: {
                read: [
                    Permission.ProjectOwner,
                    Permission.ProjectAdmin,
                    Permission.ProjectMember,
                    Permission.CanReadProjectMonitor,
                ],
                create: [
                   
                ],
                update: [
                   
                ],
                delete: [
                    
                ],
            },
            pluralName: 'Monitor Metrics By Minutes',
            crudApiPath: new Route('/monitor-metrics-by-minute'),
            tableColumns: [
                new AnalyticsTableColumn({
                    key: 'projectId',
                    title: 'Project ID',
                    description: 'ID of project',
                    required: true,
                    type: TableColumnType.ObjectID,
                    isTenantId: true,
                    accessControl: {
                        read: [
                            Permission.ProjectOwner,
                            Permission.ProjectAdmin,
                            Permission.ProjectMember,
                            Permission.CanReadProjectMonitor,
                        ],
                        create: [
                           
                        ],
                        update: [],
                    },
                }),

                new AnalyticsTableColumn({
                    key: 'monitorId',
                    title: 'Monitor ID',
                    description: 'ID of the Monitor which this metric belongs to',
                    required: true,
                    type: TableColumnType.ObjectID,
                    accessControl: {
                        read: [
                            Permission.ProjectOwner,
                            Permission.ProjectAdmin,
                            Permission.ProjectMember,
                            Permission.CanReadProjectMonitor,
                        ],
                        create: [
                           
                        ],
                        update: [],
                    },
                }),

                new AnalyticsTableColumn({
                    key: 'metricType',
                    title: 'Metric Type',
                    description: 'Type of metric',
                    required: true,
                    type: TableColumnType.Text,
                    accessControl: {
                        read: [
                            Permission.ProjectOwner,
                            Permission.ProjectAdmin,
                            Permission.ProjectMember,
                            Permission.CanReadProjectMonitor,
                        ],
                        create: [
                           
                        ],
                        update: [],
                    },
                }),


                new AnalyticsTableColumn({
                    key: 'metricValue',
                    title: 'Metric Value',
                    description: 'Value of the metric',
                    required: true,
                    type: TableColumnType.Number,
                    accessControl: {
                        read: [
                            Permission.ProjectOwner,
                            Permission.ProjectAdmin,
                            Permission.ProjectMember,
                            Permission.CanReadProjectMonitor,
                        ],
                        create: [
                           
                        ],
                        update: [],
                    },
                }),


                new AnalyticsTableColumn({
                    key: 'miscData',
                    title: 'Misc Data',
                    description: 'Misc data for the metric (if any)',
                    required: false,
                    type: TableColumnType.JSON,
                    accessControl: {
                        read: [
                            Permission.ProjectOwner,
                            Permission.ProjectAdmin,
                            Permission.ProjectMember,
                            Permission.CanReadProjectMonitor,
                        ],
                        create: [
                           
                        ],
                        update: [],
                    },
                }),

                
            ],
            primaryKeys: ['projectId', 'monitorId', 'createdAt'],
        });
    }

    public get projectId(): ObjectID | undefined {
        return this.getColumnValue('projectId') as ObjectID | undefined;
    }

    public set projectId(v: ObjectID | undefined) {
        this.setColumnValue('projectId', v);
    }

    public get monitorId(): ObjectID | undefined {
        return this.getColumnValue('monitorId') as ObjectID | undefined;
    }

    public set monitorId(v: ObjectID | undefined) {
        this.setColumnValue('monitorId', v);
    }

    public get metricType(): string | undefined {
        return this.getColumnValue('metricType') as string | undefined;
    }

    public set metricType(v: string | undefined) {
        this.setColumnValue('metricType', v);
    }

    public get metricValue(): number | undefined {
        return this.getColumnValue('metricValue') as number | undefined;
    }

    public set metricValue(v: number | undefined) {
        this.setColumnValue('metricValue', v);
    }

    public get miscData(): JSONObject | undefined {
        return this.getColumnValue('miscData') as JSONObject | undefined;
    }

    public set miscData(v: JSONObject | undefined) {
        this.setColumnValue('miscData', v);
    }
}