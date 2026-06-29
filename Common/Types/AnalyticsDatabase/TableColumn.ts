import TableColumnType from "../AnalyticsDatabase/TableColumnType";
import { ColumnAccessControl } from "../BaseDatabase/AccessControl";
import ColumnBillingAccessControl from "../BaseDatabase/ColumnBillingAccessControl";
import { JSONValue } from "../JSON";

export enum SkipIndexType {
  BloomFilter = "bloom_filter",
  Set = "set",
  TokenBF = "tokenbf_v1",
  NgramBF = "ngrambf_v1",
  MinMax = "minmax",
}

export interface SkipIndex {
  name: string;
  type: SkipIndexType;
  // e.g. 0.01 for bloom_filter, 10 for set, or [10240, 3, 0] for tokenbf_v1
  params?: Array<number> | undefined;
  granularity: number;
}

/*
 * General-purpose compressors plus the specialized "encoding" codecs that
 * pre-transform data before a general compressor runs. Delta / DoubleDelta
 * shrink monotonic sequences (timestamps, counters); Gorilla is tuned for
 * slowly-changing floating-point time-series values; T64 packs integers.
 * These are almost always paired with a general compressor in a pipeline,
 * e.g. CODEC(DoubleDelta, ZSTD(1)) — see ColumnCodecValue.
 */
export type ColumnCodec =
  | "ZSTD"
  | "LZ4"
  | "LZ4HC"
  | "NONE"
  | "Delta"
  | "DoubleDelta"
  | "Gorilla"
  | "T64";

export interface ColumnCodecConfig {
  codec: ColumnCodec;
  level?: number | undefined; // e.g. 3 for ZSTD(3), or 8 for Delta(8)
}

/*
 * A column's codec is either a single config or an ordered pipeline. The
 * pipeline is emitted as CODEC(a, b, ...) and is applied left-to-right, so
 * the encoding codec comes first and the general compressor last —
 * e.g. [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }] becomes
 * CODEC(DoubleDelta, ZSTD(1)), the ideal encoding for timestamp columns.
 */
export type ColumnCodecValue = ColumnCodecConfig | Array<ColumnCodecConfig>;

export default class AnalyticsTableColumn {
  private _key: string = "id";

  public get key(): string {
    return this._key;
  }
  public set key(v: string) {
    this._key = v;
  }

  private _title: string = "";
  public get title(): string {
    return this._title;
  }
  public set title(v: string) {
    this._title = v;
  }

  private _description: string = "";
  public get description(): string {
    return this._description;
  }
  public set description(v: string) {
    this._description = v;
  }

  private _required: boolean = false;
  public get required(): boolean {
    return this._required;
  }
  public set required(v: boolean) {
    this._required = v;
  }

  private _isTenantId: boolean = false;
  public get isTenantId(): boolean {
    return this._isTenantId;
  }
  public set isTenantId(v: boolean) {
    this._isTenantId = v;
  }

  private _type: TableColumnType = TableColumnType.Text;
  public get type(): TableColumnType {
    return this._type;
  }
  public set type(v: TableColumnType) {
    this._type = v;
  }

  private _forceGetDefaultValueOnCreate?:
    | (() => Date | string | number | boolean)
    | undefined;
  public get forceGetDefaultValueOnCreate():
    | (() => Date | string | number | boolean)
    | undefined {
    return this._forceGetDefaultValueOnCreate;
  }
  public set forceGetDefaultValueOnCreate(
    v: (() => Date | string | number | boolean) | undefined,
  ) {
    this._forceGetDefaultValueOnCreate = v;
  }

  private _defaultValue: JSONValue | undefined;
  public get defaultValue(): JSONValue {
    return this._defaultValue;
  }
  public set defaultValue(v: JSONValue) {
    this._defaultValue = v;
  }

  public get isDefaultValueColumn(): boolean {
    return Boolean(this.defaultValue !== undefined);
  }

  private _billingAccessControl?: ColumnBillingAccessControl | undefined;
  public get billingAccessControl(): ColumnBillingAccessControl | undefined {
    return this._billingAccessControl;
  }
  public set billingAccessControl(v: ColumnBillingAccessControl | undefined) {
    this._billingAccessControl = v;
  }

  private _allowAccessIfSubscriptionIsUnpaid: boolean = false;
  public get allowAccessIfSubscriptionIsUnpaid(): boolean {
    return this._allowAccessIfSubscriptionIsUnpaid;
  }
  public set allowAccessIfSubscriptionIsUnpaid(v: boolean) {
    this._allowAccessIfSubscriptionIsUnpaid = v;
  }

  private _accessControl: ColumnAccessControl | undefined;
  public get accessControl(): ColumnAccessControl | undefined {
    return this._accessControl;
  }
  public set accessControl(v: ColumnAccessControl | undefined) {
    this._accessControl = v;
  }

  private _skipIndex: SkipIndex | undefined;
  public get skipIndex(): SkipIndex | undefined {
    return this._skipIndex;
  }
  public set skipIndex(v: SkipIndex | undefined) {
    this._skipIndex = v;
  }

  private _codec: ColumnCodecValue | undefined;
  public get codec(): ColumnCodecValue | undefined {
    return this._codec;
  }
  public set codec(v: ColumnCodecValue | undefined) {
    this._codec = v;
  }

  /*
   * When true, the column is stored as LowCardinality(<type>) in ClickHouse
   * (dictionary-encoded). Use for String columns with a small, bounded set of
   * distinct values (e.g. serviceType, severityText, span kind) — it shrinks
   * storage and, more importantly, makes GROUP BY / filters on the column far
   * cheaper in memory. The column's `type` stays its logical type (e.g. Text);
   * only the emitted DDL changes, so every other layer treats it normally.
   */
  private _isLowCardinality: boolean = false;
  public get isLowCardinality(): boolean {
    return this._isLowCardinality;
  }
  public set isLowCardinality(v: boolean) {
    this._isLowCardinality = v;
  }

  /*
   * Optional denormalized key-array column for Map columns. Example:
   * a Map(String, String) column named `attributes` can point at an
   * Array(String) column named `attributeKeys`, letting query generation add
   * key-presence predicates without hardcoding telemetry column names.
   */
  private _mapKeysColumn: string | undefined;
  public get mapKeysColumn(): string | undefined {
    return this._mapKeysColumn;
  }
  public set mapKeysColumn(v: string | undefined) {
    this._mapKeysColumn = v;
  }

  /*
   * For columns of type `AggregateFunction`, the parameterization that
   * goes inside the parentheses, e.g. "stddevPop, Float64" or
   * "quantile(0.95), Float64". The schema generator emits
   * `AggregateFunction(<aggregateFunctionDefinition>)` literally, so
   * include arg types but NOT the surrounding parens. Required when
   * `type === AggregateFunction`; ignored otherwise.
   */
  private _aggregateFunctionDefinition: string | undefined;
  public get aggregateFunctionDefinition(): string | undefined {
    return this._aggregateFunctionDefinition;
  }
  public set aggregateFunctionDefinition(v: string | undefined) {
    this._aggregateFunctionDefinition = v;
  }

  public constructor(data: {
    key: string;
    title: string;
    description: string;
    required: boolean;
    defaultValue?: JSONValue | undefined;
    type: TableColumnType;
    billingAccessControl?: ColumnBillingAccessControl | undefined;
    isTenantId?: boolean | undefined;
    accessControl?: ColumnAccessControl | undefined;
    allowAccessIfSubscriptionIsUnpaid?: boolean | undefined;
    forceGetDefaultValueOnCreate?:
      | (() => Date | string | number | boolean)
      | undefined;
    skipIndex?: SkipIndex | undefined;
    codec?: ColumnCodecValue | undefined;
    isLowCardinality?: boolean | undefined;
    mapKeysColumn?: string | undefined;
    aggregateFunctionDefinition?: string | undefined;
  }) {
    this.accessControl = data.accessControl;
    this.key = data.key;
    this.title = data.title;
    this.description = data.description;
    this.required = data.required;
    this.type = data.type;
    this.isTenantId = data.isTenantId || false;
    this.forceGetDefaultValueOnCreate = data.forceGetDefaultValueOnCreate;
    this.defaultValue = data.defaultValue;
    this.billingAccessControl = data.billingAccessControl;
    this.allowAccessIfSubscriptionIsUnpaid =
      data.allowAccessIfSubscriptionIsUnpaid || false;
    this.skipIndex = data.skipIndex;
    this.codec = data.codec;
    this.isLowCardinality = data.isLowCardinality || false;
    this.mapKeysColumn = data.mapKeysColumn;
    this.aggregateFunctionDefinition = data.aggregateFunctionDefinition;
  }
}
