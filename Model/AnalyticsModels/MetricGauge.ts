import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import AnalyticsTableEngine from 'Common/Types/AnalyticsDatabase/AnalyticsTableEngine';
import ObjectID from 'Common/Types/ObjectID';
import KeyValueNestedModel from './NestedModels/KeyValueNestedModel';

export default class Metric extends AnalyticsBaseModel {
    public constructor() {
        super({
            tableName: 'MetricGauge',
            tableEngine: AnalyticsTableEngine.MergeTree,
            singularName: 'Metric Gauge',
            pluralName: 'Metrics Gauge',
            tableColumns: [
                new AnalyticsTableColumn({
                    key: 'projectId',
                    title: 'Project ID',
                    description: 'ID of project',
                    required: true,
                    type: TableColumnType.ObjectID,
                }),

                new AnalyticsTableColumn({
                    key: 'serviceId',
                    title: 'Service ID',
                    description: 'ID of the Service which created the log',
                    required: true,
                    type: TableColumnType.ObjectID,
                }),

                // add name and description

                new AnalyticsTableColumn({
                    key: 'name',
                    title: 'Name',
                    description: 'Name of the Metric',
                    required: false,
                    type: TableColumnType.Text,
                }),

                new AnalyticsTableColumn({
                    key: 'description',
                    title: 'Description',
                    description: 'Description of the Metric',
                    required: false,
                    type: TableColumnType.Text,
                }),

                new AnalyticsTableColumn({
                    key: 'time',
                    title: 'Time',
                    description: 'When did the Metric happen?',
                    required: true,
                    type: TableColumnType.Date,
                }),

                new AnalyticsTableColumn({
                    key: 'startTime',
                    title: 'Start Time',
                    description: 'When did the Metric happen?',
                    required: false,
                    type: TableColumnType.Date,
                }),

                new AnalyticsTableColumn({
                    key: 'timeUnixNano',
                    title: 'Time (in Unix Nano)',
                    description: 'When did the Metric happen?',
                    required: false,
                    type: TableColumnType.LongNumber,
                }),

                new AnalyticsTableColumn({
                    key: 'startTimeUnixNano',
                    title: 'Start Time (in Unix Nano)',
                    description: 'When did the Metric happen?',
                    required: true,
                    type: TableColumnType.LongNumber,
                }),

                new AnalyticsTableColumn({
                    key: 'attributes',
                    title: 'Attributes',
                    description: 'Attributes',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new KeyValueNestedModel(),
                }),

                new AnalyticsTableColumn({
                    key: 'value',
                    title: 'Value',
                    description: 'Value',
                    required: false,
                    type: TableColumnType.Number,
                }),
            ],
            primaryKeys: ['projectId', 'serviceId', 'time'],
        });
    }

    public get projectId(): ObjectID | undefined {
        return this.getColumnValue('projectId') as ObjectID | undefined;
    }

    public set projectId(v: ObjectID | undefined) {
        this.setColumnValue('projectId', v);
    }

    public get serviceId(): ObjectID | undefined {
        return this.getColumnValue('serviceId') as ObjectID | undefined;
    }

    public set serviceId(v: ObjectID | undefined) {
        this.setColumnValue('serviceId', v);
    }

    public get time(): Date | undefined {
        return this.getColumnValue('time') as Date | undefined;
    }

    public set time(v: Date | undefined) {
        this.setColumnValue('time', v);
    }

    public get name(): string | undefined {
        return this.getColumnValue('name') as string | undefined;
    }

    public set name(v: string | undefined) {
        this.setColumnValue('name', v);
    }

    public get description(): string | undefined {
        return this.getColumnValue('description') as string | undefined;
    }

    public set description(v: string | undefined) {
        this.setColumnValue('description', v);
    }

    public get attributes(): Array<KeyValueNestedModel> | undefined {
        return this.getColumnValue('attributes') as
            | Array<KeyValueNestedModel>
            | undefined;
    }

    public set attributes(v: Array<KeyValueNestedModel> | undefined) {
        this.setColumnValue('attributes', v);
    }

    public get value(): number | undefined {
        return this.getColumnValue('value') as number | undefined;
    }

    public set value(v: number | undefined) {
        this.setColumnValue('value', v);
    }

    public get startTime(): Date | undefined {
        return this.getColumnValue('startTime') as Date | undefined;
    }

    public set startTime(v: Date | undefined) {
        this.setColumnValue('startTime', v);
    }

    public get startTimeUnixNano(): number | undefined {
        return this.getColumnValue('startTimeUnixNano') as number | undefined;
    }

    public set startTimeUnixNano(v: number | undefined) {
        this.setColumnValue('startTimeUnixNano', v);
    }

    public get timeUnixNano(): number | undefined {
        return this.getColumnValue('timeUnixNano') as number | undefined;
    }

    public set timeUnixNano(v: number | undefined) {
        this.setColumnValue('timeUnixNano', v);
    }
}
