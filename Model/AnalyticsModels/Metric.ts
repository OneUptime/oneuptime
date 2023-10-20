/** 
 * 
 *  CREATE TABLE opentelemetry_metrics
(
    name String,
    description String,
    unit String,
    time DateTime('UTC'),
    attributes Nested
    (
        key String,
        value String
    ),
    metric_values Nested
    (
        value Double,
        labels Nested
        (
            key String,
            value String
        )
    )
) ENGINE = MergeTree()
ORDER BY (name, time);

 * 
 */

import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import AnalyticsTableEngine from 'Common/Types/AnalyticsDatabase/AnalyticsTableEngine';
import ObjectID from 'Common/Types/ObjectID';
import KeyValueNestedModel from './NestedModels/KeyValueNestedModel';
import NestedModel from 'Common/AnalyticsModels/NestedModel';

export class MetricValue extends NestedModel {
    public constructor() {
        super({
            tableColumns: [
                new AnalyticsTableColumn({
                    key: 'value',
                    title: 'Value',
                    description: 'Value',
                    required: true,
                    type: TableColumnType.Decimal,
                }),

                new AnalyticsTableColumn({
                    key: 'labels',
                    title: 'Labels',
                    description: 'Labels',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new KeyValueNestedModel(),
                }),
            ],
        });
    }
}

export default class Metric extends AnalyticsBaseModel {
    public constructor() {
        super({
            tableName: 'Metric',
            tableEngine: AnalyticsTableEngine.MergeTree,
            singularName: 'Metric',
            pluralName: 'Metrics',
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

                new AnalyticsTableColumn({
                    key: 'time',
                    title: 'Time',
                    description: 'When did the Metric happen?',
                    required: true,
                    type: TableColumnType.Date,
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
                    key: 'metricValues',
                    title: 'Metric Values',
                    description: 'Metric Values',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new MetricValue(),
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

    public get attributes(): Array<KeyValueNestedModel> | undefined {
        return this.getColumnValue('attributes') as
            | Array<KeyValueNestedModel>
            | undefined;
    }

    public set attributes(v: Array<KeyValueNestedModel> | undefined) {
        this.setColumnValue('attributes', v);
    }

    public get metricValues(): Array<MetricValue> | undefined {
        return this.getColumnValue('Array<MetricValue>s') as
            | Array<MetricValue>
            | undefined;
    }

    public set metricValues(v: Array<MetricValue> | undefined) {
        this.setColumnValue('metricValues', v);
    }
}
