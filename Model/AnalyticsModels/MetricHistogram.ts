import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import AnalyticsTableEngine from 'Common/Types/AnalyticsDatabase/AnalyticsTableEngine';
import ObjectID from 'Common/Types/ObjectID';
import KeyValueNestedModel from './NestedModels/KeyValueNestedModel';

export default class Metric extends AnalyticsBaseModel {
    public constructor() {
        super({
            tableName: 'MetricHistogram',
            tableEngine: AnalyticsTableEngine.MergeTree,
            singularName: 'Metric Histogram',
            pluralName: 'Metrics Histogram',
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
                    required: false,
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
                    key: 'count',
                    title: 'Count',
                    description: 'Count',
                    required: false,
                    type: TableColumnType.Number,
                }),

                new AnalyticsTableColumn({
                    key: 'sum',
                    title: 'Sum',
                    description: 'Sum',
                    required: false,
                    type: TableColumnType.Number,
                }),

                new AnalyticsTableColumn({
                    key: 'min',
                    title: 'Min',
                    description: 'Min',
                    required: false,
                    type: TableColumnType.Number,
                }),

                new AnalyticsTableColumn({
                    key: 'max',
                    title: 'Max',
                    description: 'Max',
                    required: false,
                    type: TableColumnType.Number,
                }),

                new AnalyticsTableColumn({
                    key: 'bucketCounts',
                    title: 'Bucket Counts',
                    description: 'Bucket Counts',
                    required: false,
                    type: TableColumnType.ArrayNumber,
                }),

                new AnalyticsTableColumn({
                    key: 'explicitBounds',
                    title: 'Explicit Bonds',
                    description: 'Explicit Bonds',
                    required: false,
                    type: TableColumnType.ArrayNumber,
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

    public set serviceId(v: ObjectID | undefined) {
        this.setColumnValue('serviceId', v);
    }

    public get time(): Date | undefined {
        return this.getColumnValue('time') as Date | undefined;
    }

    public set time(v: Date | undefined) {
        this.setColumnValue('time', v);
    }

    public get attributes(): Array<KeyValueNestedModel> | undefined {
        return this.getColumnValue('attributes') as
            | Array<KeyValueNestedModel>
            | undefined;
    }

    public set attributes(v: Array<KeyValueNestedModel> | undefined) {
        this.setColumnValue('attributes', v);
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

    public get count(): number | undefined {
        return this.getColumnValue('count') as number | undefined;
    }

    public set count(v: number | undefined) {
        this.setColumnValue('count', v);
    }

    public get sum(): number | undefined {
        return this.getColumnValue('sum') as number | undefined;
    }

    public set sum(v: number | undefined) {
        this.setColumnValue('sum', v);
    }

    public get min(): number | undefined {
        return this.getColumnValue('min') as number | undefined;
    }

    public set min(v: number | undefined) {
        this.setColumnValue('min', v);
    }

    public get max(): number | undefined {
        return this.getColumnValue('max') as number | undefined;
    }

    public set max(v: number | undefined) {
        this.setColumnValue('max', v);
    }

    public get bucketCounts(): Array<number> | undefined {
        return this.getColumnValue('bucketCounts') as Array<number> | undefined;
    }

    public set bucketCounts(v: Array<number> | undefined) {
        this.setColumnValue('bucketCounts', v);
    }

    public get explicitBounds(): Array<number> | undefined {
        return this.getColumnValue('explicitBounds') as
            | Array<number>
            | undefined;
    }

    public set explicitBounds(v: Array<number> | undefined) {
        this.setColumnValue('explicitBounds', v);
    }
}
