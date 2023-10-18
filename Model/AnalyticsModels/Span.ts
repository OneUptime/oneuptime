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
import NestedModel from 'Common/AnalyticsModels/NestedModel';

export class SpanEvent extends NestedModel {
    public constructor(){
        super({
            nestedColumns: [
                new AnalyticsTableColumn({
                    key: 'time',
                    title: 'Time',
                    description: 'Time',
                    required: true,
                    type: TableColumnType.Date,
                }),

                new AnalyticsTableColumn({
                    key: 'name',
                    title: 'Name',
                    description: 'Name of the span event',
                    required: true,
                    type: TableColumnType.Text,
                }),

                new AnalyticsTableColumn({
                    key: 'attributes',
                    title: 'Attributes',
                    description: 'Attributes',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new KeyValueNestedModel()
                }),

                

            ]
        })
    }
}


export class SpanLink extends NestedModel {
    public constructor(){
        super({
            nestedColumns: [
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
                    key: 'traceState',
                    title: 'Trace State',
                    description: 'Trace State',
                    required: false,
                    type: TableColumnType.Text,
                }),
                
                new AnalyticsTableColumn({
                    key: 'attributes',
                    title: 'Attributes',
                    description: 'Attributes',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new KeyValueNestedModel()
                }),

            ]
        })
    }
}

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
                    type: TableColumnType.Text,
                }),

                new AnalyticsTableColumn({
                    key: 'attributes',
                    title: 'Attributes',
                    description: 'Attributes',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new KeyValueNestedModel()
                }),

                new AnalyticsTableColumn({
                    key: 'events',
                    title: 'Events',
                    description: 'Span Events',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new SpanEvent()
                }),


                new AnalyticsTableColumn({
                    key: 'links',
                    title: 'Links',
                    description: 'Span Links',
                    required: false,
                    type: TableColumnType.NestedModel,
                    nestedModel: new SpanLink()
                }),

                new AnalyticsTableColumn({
                    key: 'statusCode',
                    title: 'Status Code',
                    description: 'Status Code',
                    required: false,
                    type: TableColumnType.Number,
                }),

                new AnalyticsTableColumn({
                    key: 'statusMessage',
                    title: 'Status Message',
                    description: 'Status Message',
                    required: false,
                    type: TableColumnType.Text,
                }),
            
            ],
            primaryKeys: ['projectId', 'sourceId', 'traceId', 'startTime', 'endTime'],
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

    public get startTime(): Date | undefined {
        return this.getColumnValue('startTime') as Date | undefined;
    }

    public set startTime(v: Date | undefined) {
        this.setColumnValue('startTime', v);
    }

    public get endTime(): Date | undefined {
        return this.getColumnValue('endTime') as Date | undefined;
    }

    public set endTime(v: Date | undefined) {
        this.setColumnValue('endTime', v);
    }

    public get traceId(): string | undefined {
        return this.getColumnValue('traceId') as string | undefined;
    }

    public set traceId(v: string | undefined) {
        this.setColumnValue('traceId', v);
    }

    public get spanId(): string | undefined {
        return this.getColumnValue('spanId') as string | undefined;
    }

    public set spanId(v: string | undefined) {
        this.setColumnValue('spanId', v);
    }

    public get parentSpanId(): string | undefined {
        return this.getColumnValue('parentSpanId') as string | undefined;
    }

    public set parentSpanId(v: string | undefined) {
        this.setColumnValue('parentSpanId', v);
    }

    public get traceState(): string | undefined {
        return this.getColumnValue('traceState') as string | undefined;
    }

    public set traceState(v: string | undefined) {
        this.setColumnValue('traceState', v);
    }

    public get attributes(): Array<KeyValueNestedModel> | undefined {
        return this.getColumnValue('attributes') as Array<KeyValueNestedModel> | undefined;
    }

    public set attributes(v: Array<KeyValueNestedModel> | undefined) {
        this.setColumnValue('attributes', v);
    }

    public get events(): Array<SpanEvent> | undefined {
        return this.getColumnValue('events') as Array<SpanEvent> | undefined;
    }

    public set events(v: Array<SpanEvent> | undefined) {
        this.setColumnValue('events', v);
    }

    public get links(): Array<SpanLink> | undefined {
        return this.getColumnValue('links') as Array<SpanLink> | undefined;
    }

    public set links(v: Array<SpanLink> | undefined) {
        this.setColumnValue('links', v);
    }

    public get statusCode(): number | undefined {
        return this.getColumnValue('statusCode') as number | undefined;
    }

    public set statusCode(v: number | undefined) {
        this.setColumnValue('statusCode', v);
    }

    public get statusMessage(): string | undefined {
        return this.getColumnValue('statusMessage') as string | undefined;
    }

    public set statusMessage(v: string | undefined) {
        this.setColumnValue('statusMessage', v);
    }
}
