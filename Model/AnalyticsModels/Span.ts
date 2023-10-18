/**
 * 
 * 
 * CREATE TABLE opentelemetry_spans
(
    trace_id String,
    span_id String,
    trace_state String,
    parent_span_id String,
    name String,
    kind Int32,
    start_time DateTime('UTC'),
    end_time DateTime('UTC'),
    attributes Nested
    (
        key String,
        value String
    ),
    events Nested
    (
        time DateTime('UTC'),
        name String,
        attributes Nested
        (
            key String,
            value String
        )
    ),
    links Nested
    (
        trace_id String,
        span_id String,
        trace_state String,
        attributes Nested
        (
            key String,
            value String
        )
    ),
    status_code Int32,
    status_message String
) ENGINE = MergeTree()
ORDER BY (trace_id, span_id);

 */



import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import AnalyticsTableEngine from 'Common/Types/AnalyticsDatabase/AnalyticsTableEngine';
import ObjectID from 'Common/Types/ObjectID';
import KeyValueNestedModel from './NestedModels/KeyValueNestedModel';

export default class Span extends AnalyticsBaseModel {
    public constructor() {
        super({
            tableName: 'Span',
            tableEngine: AnalyticsTableEngine.MergeTree,
            singularName: 'Span',
            pluralName: 'Spans',
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
                    key: 'startTime',
                    title: 'Start Time',
                    description: 'When did the span start?',
                    required: true,
                    type: TableColumnType.Date,
                }),

                new AnalyticsTableColumn({
                    key: 'endTime',
                    title: 'End Time',
                    description: 'When did the span end?',
                    required: true,
                    type: TableColumnType.Date,
                }),


                new AnalyticsTableColumn({
                    key: 'traceId',
                    title: 'Trace ID',
                    description: 'ID of the trace',
                    required: true,
                    type: TableColumnType.Text,
                }),


                new AnalyticsTableColumn({
                    key: 'spanId',
                    title: 'Span ID',
                    description: 'ID of the span',
                    required: true,
                    type: TableColumnType.Text,
                }),

                new AnalyticsTableColumn({
                    key: 'parentSpanId',
                    title: 'Parent Span ID',
                    description: 'ID of the parent span',
                    required: false,
                    type: TableColumnType.Text,
                }),

                new AnalyticsTableColumn({
                    key: 'traceState',
                    title: 'Trace State',
                    description: 'Trace State',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new KeyValueNestedModel()
                }),

                new AnalyticsTableColumn({
                    key: 'attributes',
                    title: 'Attributes',
                    description: 'Attributes',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new KeyValueNestedModel()
                }),
            
            ],
            primaryKeys: ['projectId', 'sourceId', 'timestamp'],
        });
    }

    public get severity(): string | undefined {
        return this.getColumnValue('severity') as string | undefined;
    }
    public set severity(v: string | undefined) {
        this.setColumnValue('severity', v);
    }

    public get timestamp(): Date | undefined {
        return this.getColumnValue('timestamp') as Date | undefined;
    }
    public set timestamp(v: Date | undefined) {
        this.setColumnValue('timestamp', v);
    }

    public get log(): string | undefined {
        return this.getColumnValue('log') as string | undefined;
    }
    public set log(v: string | undefined) {
        this.setColumnValue('log', v);
    }

    public get sourceId(): ObjectID | undefined {
        return this.getColumnValue('sourceId') as ObjectID | undefined;
    }

    public set sourceId(v: ObjectID | undefined) {
        this.setColumnValue('sourceId', v);
    }

    public get projectId(): ObjectID | undefined {
        return this.getColumnValue('projectId') as ObjectID | undefined;
    }

    public set projectId(v: ObjectID | undefined) {
        this.setColumnValue('projectId', v);
    }

    public get message(): string | undefined {
        return this.getColumnValue('message') as string | undefined;
    }

    public set message(v: string | undefined) {
        this.setColumnValue('message', v);
    }
}
