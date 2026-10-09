import BadDataException from "../../Exception/BadDataException";
import SnmpOidListUtil from "./SnmpOidListUtil";
import {
  SnmpTableColumn,
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableResult,
  SnmpTableResultRow,
  SnmpTableSnapshot,
  SnmpTableSnapshotCell,
  SnmpTableSnapshotColumn,
  SnmpTableSnapshotRow,
  SnmpTableValueType,
  SnmpTableWalkRequest,
} from "./SnmpTable";

/*
 * The one place that decides which SNMP tables a device walks and how a
 * walked table is read back. The table-shaped twin of SnmpOidListUtil, and
 * load-bearing in the same places: the two write paths that validate a
 * template's and a device's tables, the poll path that merges them into the
 * probe payload, the ingest path that joins the probe's raw rows back to
 * their definitions, and the dashboard. Pure, so all of them share it.
 */

/*
 * The caps compose the way the OID caps do: a template's tables plus a
 * device's own can never exceed what one device walks.
 */
export const MAX_TABLES_PER_TEMPLATE: number = 10;
export const MAX_DEVICE_SPECIFIC_TABLES: number = 10;
export const MAX_EFFECTIVE_TABLES_PER_DEVICE: number =
  MAX_TABLES_PER_TEMPLATE + MAX_DEVICE_SPECIFIC_TABLES;

// Label and value columns together - each one is a walk of its own.
export const MAX_COLUMNS_PER_TABLE: number = 20;
export const MAX_ROW_LABEL_COLUMNS: number = 3;

/*
 * Rows are bounded because the probe walks every column of every row on
 * every poll, and because a table is stored on the device. A tunnel list or
 * a radio table is a handful of rows; the ceiling is for the operator who
 * points a table at a forwarding database by mistake.
 */
export const DEFAULT_SNMP_TABLE_MAX_ROWS: number = 100;
export const MAX_SNMP_TABLE_MAX_ROWS: number = 250;

export const MAX_TABLE_NAME_LENGTH: number = 100;
export const MAX_TABLE_KEY_LENGTH: number = 64;
export const MAX_COLUMN_NAME_LENGTH: number = 100;
export const MAX_VALUE_LABELS_PER_COLUMN: number = 50;
export const MAX_VALUE_LABEL_LENGTH: number = 100;
export const MAX_HEALTHY_VALUES_PER_COLUMN: number = 20;
export const MAX_UNIT_LENGTH: number = 20;

/*
 * Bounds on a column's numeric adjustment (scale, offset). Vendors need a
 * half (dBm stored doubled), a tenth, a sign flip or an offset of 256; the
 * bounds only stop a number that would make every value meaningless.
 */
export const MAX_COLUMN_SCALE_MAGNITUDE: number = 1000000;
export const MAX_COLUMN_OFFSET_MAGNITUDE: number = 1000000;

// Adjusted numbers keep this many decimals: 0.1 x 155 is 15.5, not 15.500000000000002.
const ADJUSTED_NUMBER_PRECISION: number = 1000000;

/*
 * What one device's stored snapshot may hold in total. The snapshot is a
 * jsonb column on the device row and rewritten on every successful walk, so
 * it is bounded by cells rather than by rows: ten rows of twenty columns and
 * two hundred rows of one column cost the same.
 */
export const MAX_SNAPSHOT_CELLS_PER_DEVICE: number = 5000;

/*
 * Metric points one walk may write for its tables. Each numeric cell is a
 * point, keyed by table, column and row.
 */
export const MAX_TABLE_METRIC_SERIES: number = 1000;

export const ROW_LABEL_SEPARATOR: string = " / ";

// A row scope that names a row by its exact index rather than its name.
export const ROW_INDEX_SCOPE_PREFIX: string = "index:";

/*
 * A number at the very start of the text, optionally followed by a unit:
 * "36", "-95 dBm", "80MHz", "1.5", "99/88/0/0". Anything that does not start
 * with a number is text.
 */
const LEADING_NUMBER: RegExp = /^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))/;

export interface ValidateTableListOptions {
  max: number;
  // Names the list in every error message: "OID Collection Template", etc.
  label: string;
}

export interface EffectiveTableResolution {
  tables: Array<SnmpTableDefinition>;
  // How many tables the cap removed. Zero on every well-formed list.
  truncatedCount: number;
}

export default class SnmpTableListUtil {
  /*
   * Lowercase letters, digits and underscores. Keys are written into
   * criteria and metric attributes and read back from template variables
   * (`{{tables.ipsec_tunnels.rowCount}}`), where a dash or a dot would end
   * the path.
   */
  public static normalizeKey(value: string | undefined): string {
    return (value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .substring(0, MAX_TABLE_KEY_LENGTH);
  }

  /*
   * Sanitize a table list at save time. Mirrors SnmpOidListUtil's split
   * between what is refused (an operator has to fix it) and what is quietly
   * dropped (an editor artifact): a table with no name and no columns is a
   * blank row someone added and abandoned; a table with a malformed OID is a
   * mistake that would never collect anything.
   */
  public static validateTableList(
    tables: Array<SnmpTableDefinition> | undefined,
    options: ValidateTableListOptions,
  ): Array<SnmpTableDefinition> {
    const sanitized: Array<SnmpTableDefinition> = [];
    const seenKeys: Set<string> = new Set();

    for (const table of tables || []) {
      const name: string = (table?.name || "").trim();
      const hasColumns: boolean = (table?.columns || []).some(
        (column: SnmpTableColumn) => {
          return Boolean(SnmpOidListUtil.normalizeOid(column?.oid));
        },
      );

      // Editor artifact, not user intent.
      if (!name && !hasColumns) {
        continue;
      }

      const sanitizedTable: SnmpTableDefinition =
        SnmpTableListUtil.validateTable(table, options.label);

      if (seenKeys.has(sanitizedTable.key)) {
        throw new BadDataException(
          `${options.label}: two tables use the key "${sanitizedTable.key}". Give each table a different name or key.`,
        );
      }

      seenKeys.add(sanitizedTable.key);
      sanitized.push(sanitizedTable);
    }

    if (sanitized.length > options.max) {
      throw new BadDataException(
        `${options.label}: ${sanitized.length} tables is more than the limit of ${options.max}. Remove some, or move them to another template.`,
      );
    }

    return sanitized;
  }

  public static validateTable(
    table: SnmpTableDefinition,
    label: string,
  ): SnmpTableDefinition {
    const name: string = (table.name || "").trim();

    if (!name) {
      throw new BadDataException(`${label}: every table needs a name.`);
    }

    if (name.length > MAX_TABLE_NAME_LENGTH) {
      throw new BadDataException(
        `${label}: the table name "${name.substring(0, 40)}…" is longer than ${MAX_TABLE_NAME_LENGTH} characters.`,
      );
    }

    const key: string = SnmpTableListUtil.normalizeKey(table.key || name);

    if (!key) {
      throw new BadDataException(
        `${label}: the table "${name}" needs a key made of letters or digits.`,
      );
    }

    const kind: SnmpTableKind = SnmpTableListUtil.parseKind(table.kind);

    const columns: Array<SnmpTableColumn> = [];
    const seenColumnOids: Set<string> = new Set();

    for (const column of table.columns || []) {
      const oid: string = SnmpOidListUtil.normalizeOid(column?.oid);

      // A blank column row is an editor artifact.
      if (!oid) {
        continue;
      }

      if (!SnmpOidListUtil.isValidOid(oid)) {
        throw new BadDataException(
          `${label}: "${column.oid}" in table "${name}" is not a numeric OID. Use the column's dotted OID, for example 1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9.`,
        );
      }

      // Keep the first spelling of a duplicate, drop the rest.
      if (seenColumnOids.has(oid)) {
        continue;
      }

      seenColumnOids.add(oid);
      columns.push(
        SnmpTableListUtil.sanitizeColumn(column, oid, {
          label: label,
          tableName: name,
        }),
      );
    }

    if (columns.length === 0) {
      throw new BadDataException(
        `${label}: the table "${name}" needs at least one column to collect.`,
      );
    }

    const rowLabelColumnOids: Array<string> = [];

    for (const rawOid of table.rowLabelColumnOids || []) {
      const oid: string = SnmpOidListUtil.normalizeOid(rawOid);

      if (!oid) {
        continue;
      }

      if (!SnmpOidListUtil.isValidOid(oid)) {
        throw new BadDataException(
          `${label}: the row name column "${rawOid}" in table "${name}" is not a numeric OID.`,
        );
      }

      if (!rowLabelColumnOids.includes(oid)) {
        rowLabelColumnOids.push(oid);
      }
    }

    if (rowLabelColumnOids.length > MAX_ROW_LABEL_COLUMNS) {
      throw new BadDataException(
        `${label}: the table "${name}" names its rows from ${rowLabelColumnOids.length} columns; use at most ${MAX_ROW_LABEL_COLUMNS}.`,
      );
    }

    const walkedColumnCount: number = new Set([
      ...rowLabelColumnOids,
      ...columns.map((column: SnmpTableColumn) => {
        return column.oid;
      }),
    ]).size;

    if (walkedColumnCount > MAX_COLUMNS_PER_TABLE) {
      throw new BadDataException(
        `${label}: the table "${name}" walks ${walkedColumnCount} columns, more than the limit of ${MAX_COLUMNS_PER_TABLE}.`,
      );
    }

    const maxRows: number | undefined = SnmpTableListUtil.parseMaxRows(
      table.maxRows,
      `${label}: the row limit of table "${name}"`,
    );

    const description: string | undefined = table.description?.trim()
      ? table.description.trim()
      : undefined;

    return {
      key: key,
      name: name,
      ...(description ? { description: description } : {}),
      kind: kind,
      ...(rowLabelColumnOids.length > 0
        ? { rowLabelColumnOids: rowLabelColumnOids }
        : {}),
      // Only ever true: an absent flag and a false one mean the same.
      ...(table.rowIndexIsText === true ? { rowIndexIsText: true } : {}),
      ...(table.skipNameOnlyRows === true ? { skipNameOnlyRows: true } : {}),
      columns: columns,
      ...(maxRows === undefined ? {} : { maxRows: maxRows }),
    };
  }

  private static sanitizeColumn(
    column: SnmpTableColumn,
    oid: string,
    context: { label: string; tableName: string },
  ): SnmpTableColumn {
    const sanitized: SnmpTableColumn = {
      oid: oid,
      // A column with no name is still collected; it is shown by its OID.
      name:
        (column.name || "").trim().substring(0, MAX_COLUMN_NAME_LENGTH) || oid,
    };

    if (column.description?.trim()) {
      sanitized.description = column.description.trim();
    }

    if (column.unit?.trim()) {
      sanitized.unit = column.unit.trim().substring(0, MAX_UNIT_LENGTH);
    }

    if (
      column.role &&
      Object.values(SnmpTableColumnRole).includes(column.role)
    ) {
      sanitized.role = column.role;
    }

    if (
      column.valueType &&
      Object.values(SnmpTableValueType).includes(column.valueType)
    ) {
      sanitized.valueType = column.valueType;
    }

    if (column.valueLabels && typeof column.valueLabels === "object") {
      const valueLabels: Record<string, string> = {};

      for (const [raw, display] of Object.entries(column.valueLabels)) {
        const rawKey: string = String(raw).trim();
        const displayValue: string = String(display ?? "").trim();

        if (!rawKey || !displayValue) {
          continue;
        }

        valueLabels[rawKey.substring(0, MAX_VALUE_LABEL_LENGTH)] =
          displayValue.substring(0, MAX_VALUE_LABEL_LENGTH);

        if (Object.keys(valueLabels).length >= MAX_VALUE_LABELS_PER_COLUMN) {
          break;
        }
      }

      if (Object.keys(valueLabels).length > 0) {
        sanitized.valueLabels = valueLabels;
      }
    }

    if (Array.isArray(column.healthyValues)) {
      const healthyValues: Array<string> = [];

      for (const value of column.healthyValues) {
        const healthy: string = String(value ?? "").trim();

        if (healthy && !healthyValues.includes(healthy)) {
          healthyValues.push(healthy.substring(0, MAX_VALUE_LABEL_LENGTH));
        }
      }

      if (healthyValues.length > 0) {
        sanitized.healthyValues = healthyValues.slice(
          0,
          MAX_HEALTHY_VALUES_PER_COLUMN,
        );
      }
    }

    /*
     * A no-op adjustment (scale 1, offset 0) is dropped, so a definition
     * that says nothing extra stores nothing extra.
     */
    const scale: number | undefined = SnmpTableListUtil.parseAdjustment({
      value: column.scale,
      maxMagnitude: MAX_COLUMN_SCALE_MAGNITUDE,
      allowZero: false,
      what: `${context.label}: the scale of column "${sanitized.name}" in table "${context.tableName}"`,
    });

    if (scale !== undefined && scale !== 1) {
      sanitized.scale = scale;
    }

    const offset: number | undefined = SnmpTableListUtil.parseAdjustment({
      value: column.offset,
      maxMagnitude: MAX_COLUMN_OFFSET_MAGNITUDE,
      allowZero: true,
      what: `${context.label}: the offset of column "${sanitized.name}" in table "${context.tableName}"`,
    });

    if (offset !== undefined && offset !== 0) {
      sanitized.offset = offset;
    }

    return sanitized;
  }

  /*
   * A scale or offset as a finite number within bounds, or undefined when
   * none is set. Anything else is refused: a scale that cannot be read
   * would quietly turn every value of the column into nonsense.
   */
  private static parseAdjustment(data: {
    value: number | string | undefined | null;
    maxMagnitude: number;
    allowZero: boolean;
    what: string;
  }): number | undefined {
    if (data.value === undefined || data.value === null || data.value === "") {
      return undefined;
    }

    const parsed: number = Number(data.value);

    if (
      !Number.isFinite(parsed) ||
      Math.abs(parsed) > data.maxMagnitude ||
      (!data.allowZero && parsed === 0)
    ) {
      throw new BadDataException(
        `${data.what} must be a number${data.allowZero ? "" : " other than 0"} between -${data.maxMagnitude} and ${data.maxMagnitude}.`,
      );
    }

    return parsed;
  }

  // Whether a column adjusts the numbers it reads.
  public static hasAdjustment(column: SnmpTableColumn): boolean {
    return (
      (typeof column.scale === "number" &&
        Number.isFinite(column.scale) &&
        column.scale !== 1) ||
      (typeof column.offset === "number" &&
        Number.isFinite(column.offset) &&
        column.offset !== 0)
    );
  }

  // A number read by a column, put into the column's unit (see SnmpTableColumn.scale).
  public static adjustNumber(value: number, column: SnmpTableColumn): number {
    const scale: number =
      typeof column.scale === "number" && Number.isFinite(column.scale)
        ? column.scale
        : 1;
    const offset: number =
      typeof column.offset === "number" && Number.isFinite(column.offset)
        ? column.offset
        : 0;

    const adjusted: number =
      Math.round((value * scale + offset) * ADJUSTED_NUMBER_PRECISION) /
      ADJUSTED_NUMBER_PRECISION;

    // -0 reads as "0" everywhere, but compares oddly; say 0.
    return adjusted === 0 ? 0 : adjusted;
  }

  private static parseMaxRows(
    value: number | string | undefined,
    label: string,
  ): number | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const parsed: number = Number(value);

    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_SNMP_TABLE_MAX_ROWS
    ) {
      throw new BadDataException(
        `${label} must be a whole number from 1 to ${MAX_SNMP_TABLE_MAX_ROWS}.`,
      );
    }

    return parsed;
  }

  public static parseKind(kind: string | undefined): SnmpTableKind {
    return Object.values(SnmpTableKind).includes(kind as SnmpTableKind)
      ? (kind as SnmpTableKind)
      : SnmpTableKind.Generic;
  }

  /*
   * A template's tables plus a device's own, merged by key on every poll.
   *
   * Template tables come first and keep their position, so the shared tables
   * a device type depends on are the stable prefix the cap never reaches. A
   * device table with the same key replaces the template's - that is how one
   * device overrides a column or a row limit without forking the template.
   *
   * Malformed entries are dropped, not thrown on: this runs against data
   * already persisted, and one bad table must not stop the rest from being
   * walked.
   */
  public static resolveEffectiveTables(data: {
    templateTables: Array<SnmpTableDefinition> | undefined;
    deviceTables: Array<SnmpTableDefinition> | undefined;
  }): EffectiveTableResolution {
    const merged: Array<SnmpTableDefinition> = [];
    const indexByKey: Map<string, number> = new Map();

    for (const table of [
      ...(data.templateTables || []),
      ...(data.deviceTables || []),
    ]) {
      let sanitized: SnmpTableDefinition;

      try {
        sanitized = SnmpTableListUtil.validateTable(table, "SNMP table");
      } catch {
        continue;
      }

      const existingIndex: number | undefined = indexByKey.get(sanitized.key);

      if (existingIndex === undefined) {
        indexByKey.set(sanitized.key, merged.length);
        merged.push(sanitized);
        continue;
      }

      merged[existingIndex] = sanitized;
    }

    if (merged.length <= MAX_EFFECTIVE_TABLES_PER_DEVICE) {
      return { tables: merged, truncatedCount: 0 };
    }

    return {
      tables: merged.slice(0, MAX_EFFECTIVE_TABLES_PER_DEVICE),
      truncatedCount: merged.length - MAX_EFFECTIVE_TABLES_PER_DEVICE,
    };
  }

  // Every column a table needs walked: row-label columns first, then values.
  public static getWalkedColumnOids(table: SnmpTableDefinition): Array<string> {
    const oids: Array<string> = [];

    for (const oid of [
      ...(table.rowLabelColumnOids || []),
      ...table.columns.map((column: SnmpTableColumn) => {
        return column.oid;
      }),
    ]) {
      const normalized: string = SnmpOidListUtil.normalizeOid(oid);

      if (normalized && !oids.includes(normalized)) {
        oids.push(normalized);
      }
    }

    return oids;
  }

  /*
   * The probe payload. Names, units, labels and descriptions stay on the
   * server: the probe only needs to know what to walk, and this list is
   * serialized once per device per poll batch.
   */
  public static toWalkRequests(
    tables: Array<SnmpTableDefinition>,
  ): Array<SnmpTableWalkRequest> {
    return tables.map((table: SnmpTableDefinition) => {
      return {
        key: table.key,
        columnOids: SnmpTableListUtil.getWalkedColumnOids(table),
        maxRows: SnmpTableListUtil.getMaxRows(table),
      };
    });
  }

  public static getMaxRows(table: SnmpTableDefinition): number {
    const maxRows: number = Number(table.maxRows);

    if (!Number.isInteger(maxRows) || maxRows < 1) {
      return DEFAULT_SNMP_TABLE_MAX_ROWS;
    }

    return Math.min(maxRows, MAX_SNMP_TABLE_MAX_ROWS);
  }

  /*
   * The number a cell holds, or undefined. See SnmpTableValueType for why
   * text that starts with a number counts.
   */
  public static parseNumericValue(
    raw: string | number | null | undefined,
    valueType?: SnmpTableValueType | undefined,
  ): number | undefined {
    if (valueType === SnmpTableValueType.Text) {
      return undefined;
    }

    if (typeof raw === "number") {
      return Number.isFinite(raw) ? raw : undefined;
    }

    if (typeof raw !== "string") {
      return undefined;
    }

    const match: RegExpMatchArray | null = raw.match(LEADING_NUMBER);

    if (!match || !match[1]) {
      return undefined;
    }

    const parsed: number = parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  public static buildCell(
    column: SnmpTableColumn,
    raw: string | number | null | undefined,
  ): SnmpTableSnapshotCell {
    const value: string | number | null =
      raw === undefined || raw === null ? null : raw;
    const rawText: string = value === null ? "" : String(value);

    const parsed: number | undefined = SnmpTableListUtil.parseNumericValue(
      value,
      column.valueType,
    );

    const isAdjusted: boolean =
      parsed !== undefined && SnmpTableListUtil.hasAdjustment(column);

    const numeric: number | undefined =
      parsed !== undefined && isAdjusted
        ? SnmpTableListUtil.adjustNumber(parsed, column)
        : parsed;

    /*
     * A value label wins; otherwise an adjusted number is shown as the
     * number it stands for (-94, not the 94 the agent sent), and anything
     * else as it came.
     */
    const display: string =
      (rawText && column.valueLabels?.[rawText.trim()]) ||
      (isAdjusted && numeric !== undefined ? String(numeric) : rawText);

    const cell: SnmpTableSnapshotCell = {
      raw: value,
      display: display,
    };

    if (numeric !== undefined) {
      cell.numeric = numeric;
    }

    if (column.healthyValues && column.healthyValues.length > 0) {
      cell.isHealthy =
        value !== null && column.healthyValues.includes(rawText.trim());
    }

    return cell;
  }

  /*
   * Join the probe's raw rows back to their definitions.
   *
   * Definitions decide what exists: a result for a table that is no longer
   * defined is dropped, and a defined table the probe did not report (an
   * older probe, or a poll where the walk failed before reaching tables) is
   * simply absent, which tells the inventory to keep what it had.
   */
  public static materialize(data: {
    tables: Array<SnmpTableDefinition>;
    results: Array<SnmpTableResult> | undefined;
    collectedAt?: Date | undefined;
  }): Array<SnmpTableSnapshot> {
    const resultsByKey: Map<string, SnmpTableResult> = new Map();

    for (const result of data.results || []) {
      if (result && typeof result.key === "string") {
        resultsByKey.set(result.key, result);
      }
    }

    const snapshots: Array<SnmpTableSnapshot> = [];

    for (const table of data.tables) {
      const result: SnmpTableResult | undefined = resultsByKey.get(table.key);

      if (!result) {
        continue;
      }

      const columnsByOid: Map<string, SnmpTableColumn> = new Map();

      for (const column of table.columns) {
        columnsByOid.set(SnmpOidListUtil.normalizeOid(column.oid), column);
      }

      const resultRows: Array<SnmpTableResultRow> = (result.rows || []).filter(
        (row: SnmpTableResultRow) => {
          return Boolean(row && typeof row.index === "string" && row.index);
        },
      );

      const valuesByIndex: Map<
        string,
        Record<string, string | number | null>
      > = new Map();

      for (const row of resultRows) {
        valuesByIndex.set(row.index, row.values || {});
      }

      /*
       * In a table whose name columns name more than it has (see
       * SnmpTableDefinition.skipNameOnlyRows), the rows that hold nothing
       * but a name are left out - after they have named their children.
       */
      const rows: Array<SnmpTableSnapshotRow> = resultRows
        .filter((row: SnmpTableResultRow) => {
          return (
            !table.skipNameOnlyRows ||
            SnmpTableListUtil.holdsOwnValue(row, columnsByOid)
          );
        })
        .map((row: SnmpTableResultRow) => {
          return SnmpTableListUtil.buildRow(
            table,
            columnsByOid,
            row,
            valuesByIndex,
          );
        })
        .sort((a: SnmpTableSnapshotRow, b: SnmpTableSnapshotRow) => {
          return SnmpTableListUtil.compareRowIndexes(a.index, b.index);
        })
        .slice(0, SnmpTableListUtil.getMaxRows(table));

      const snapshot: SnmpTableSnapshot = {
        key: table.key,
        name: table.name,
        kind: SnmpTableListUtil.parseKind(table.kind),
        columns: table.columns.map(
          (column: SnmpTableColumn): SnmpTableSnapshotColumn => {
            return {
              oid: SnmpOidListUtil.normalizeOid(column.oid),
              name: column.name,
              ...(column.unit ? { unit: column.unit } : {}),
              ...(column.role ? { role: column.role } : {}),
              ...(column.healthyValues && column.healthyValues.length > 0
                ? { healthyValues: column.healthyValues }
                : {}),
            };
          },
        ),
        rows: rows,
      };

      if (result.isTruncated) {
        snapshot.isTruncated = true;
      }

      if (result.failureCause) {
        snapshot.failureCause = result.failureCause;
      }

      if (data.collectedAt) {
        snapshot.collectedAt = data.collectedAt.toISOString();
      }

      snapshots.push(snapshot);
    }

    return snapshots;
  }

  private static buildRow(
    table: SnmpTableDefinition,
    columnsByOid: Map<string, SnmpTableColumn>,
    row: SnmpTableResultRow,
    valuesByIndex: Map<string, Record<string, string | number | null>>,
  ): SnmpTableSnapshotRow {
    const values: Record<string, string | number | null> = row.values || {};

    const cells: Record<string, SnmpTableSnapshotCell> = {};

    for (const [oid, column] of columnsByOid.entries()) {
      cells[oid] = SnmpTableListUtil.buildCell(column, values[oid]);
    }

    const labelParts: Array<string> = [];

    for (const labelOid of table.rowLabelColumnOids || []) {
      const normalized: string = SnmpOidListUtil.normalizeOid(labelOid);
      const labelColumn: SnmpTableColumn | undefined =
        columnsByOid.get(normalized);
      const raw: string | number | null | undefined =
        values[normalized] !== undefined
          ? values[normalized]
          : SnmpTableListUtil.findParentValue(
              row.index,
              normalized,
              valuesByIndex,
            );

      const text: string = labelColumn
        ? SnmpTableListUtil.buildCell(labelColumn, raw).display
        : raw === undefined || raw === null
          ? ""
          : String(raw);

      if (text.trim()) {
        labelParts.push(text.trim());
      }
    }

    const indexText: string | undefined =
      labelParts.length === 0 && table.rowIndexIsText
        ? SnmpTableListUtil.decodeTextIndex(row.index)
        : undefined;

    return {
      index: row.index,
      label: labelParts.join(ROW_LABEL_SEPARATOR) || indexText || row.index,
      cells: cells,
    };
  }

  // Whether a walked row holds a value of one of the table's own columns.
  private static holdsOwnValue(
    row: SnmpTableResultRow,
    columnsByOid: Map<string, SnmpTableColumn>,
  ): boolean {
    const values: Record<string, string | number | null> = row.values || {};

    return Object.keys(values).some((oid: string) => {
      return (
        columnsByOid.has(SnmpOidListUtil.normalizeOid(oid)) &&
        values[oid] !== undefined &&
        values[oid] !== null
      );
    });
  }

  // A name column's value at the nearest parent row, longest prefix first.
  private static findParentValue(
    index: string,
    oid: string,
    valuesByIndex: Map<string, Record<string, string | number | null>>,
  ): string | number | null | undefined {
    const arcs: Array<string> = index.split(".");

    for (let length: number = arcs.length - 1; length >= 1; length--) {
      const parent: Record<string, string | number | null> | undefined =
        valuesByIndex.get(arcs.slice(0, length).join("."));

      if (parent && parent[oid] !== undefined) {
        return parent[oid];
      }
    }

    return undefined;
  }

  /*
   * An index that is a string in SNMP's encoding - its length, then one arc
   * per byte, read as UTF-8 - as its text: "4.67.111.114.112" is "Corp".
   * Undefined for anything else (a length that does not match, a control
   * character, bytes that are not UTF-8), so the row keeps its index.
   */
  public static decodeTextIndex(index: string): string | undefined {
    const arcs: Array<number> = index.split(".").map((arc: string) => {
      return Number(arc);
    });

    const length: number | undefined = arcs[0];

    if (
      arcs.length < 2 ||
      length === undefined ||
      length !== arcs.length - 1 ||
      arcs.some((arc: number) => {
        return !Number.isInteger(arc) || arc < 0;
      })
    ) {
      return undefined;
    }

    const bytes: Array<number> = arcs.slice(1);

    if (
      bytes.some((byte: number) => {
        return byte > 255 || byte < 32 || byte === 127;
      })
    ) {
      return undefined;
    }

    /*
     * decodeURIComponent reads percent-encoded bytes as UTF-8 and refuses
     * invalid sequences, in Node and in browsers alike - no TextDecoder,
     * which some test environments lack.
     */
    try {
      const text: string = decodeURIComponent(
        bytes
          .map((byte: number) => {
            return `%${byte.toString(16).padStart(2, "0")}`;
          })
          .join(""),
      );

      return text.trim() ? text : undefined;
    } catch {
      return undefined;
    }
  }

  // Row indexes compare arc by arc, numerically: "2" before "10", "1.9" before "1.10".
  public static compareRowIndexes(a: string, b: string): number {
    const aParts: Array<string> = a.split(".");
    const bParts: Array<string> = b.split(".");
    const length: number = Math.max(aParts.length, bParts.length);

    for (let i: number = 0; i < length; i++) {
      const aPart: string | undefined = aParts[i];
      const bPart: string | undefined = bParts[i];

      if (aPart === undefined) {
        return -1;
      }

      if (bPart === undefined) {
        return 1;
      }

      const aNumber: number = Number(aPart);
      const bNumber: number = Number(bPart);

      if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
        if (aNumber !== bNumber) {
          return aNumber - bNumber;
        }
        continue;
      }

      const textOrder: number = aPart.localeCompare(bPart);

      if (textOrder !== 0) {
        return textOrder;
      }
    }

    return 0;
  }

  /*
   * Bound what one device stores. Tables are kept in definition order until
   * the cell budget runs out; the table that hits it is cut short and marked
   * truncated, and any after it are stored with no rows. Template tables
   * come first, so the shared tables are the ones that survive.
   */
  public static capSnapshotsForStorage(
    snapshots: Array<SnmpTableSnapshot>,
  ): Array<SnmpTableSnapshot> {
    let remainingCells: number = MAX_SNAPSHOT_CELLS_PER_DEVICE;
    const capped: Array<SnmpTableSnapshot> = [];

    for (const snapshot of snapshots) {
      const cellsPerRow: number = Math.max(1, snapshot.columns.length);
      const rowsThatFit: number = Math.floor(remainingCells / cellsPerRow);

      if (rowsThatFit >= snapshot.rows.length) {
        capped.push(snapshot);
        remainingCells -= snapshot.rows.length * cellsPerRow;
        continue;
      }

      capped.push({
        ...snapshot,
        rows: snapshot.rows.slice(0, Math.max(0, rowsThatFit)),
        isTruncated: true,
      });
      remainingCells -= Math.max(0, rowsThatFit) * cellsPerRow;
    }

    return capped;
  }

  /*
   * Merge this walk's snapshots over the stored ones.
   *
   * A table that failed this walk keeps its previous rows (with the new
   * failure cause on it), so a transient timeout does not blank the view; a
   * table that is no longer defined disappears; everything else is replaced
   * by what was just walked.
   */
  public static mergeWithPrevious(data: {
    current: Array<SnmpTableSnapshot>;
    previous: Array<SnmpTableSnapshot> | undefined;
    definedKeys: Array<string>;
  }): Array<SnmpTableSnapshot> {
    const previousByKey: Map<string, SnmpTableSnapshot> = new Map();

    for (const snapshot of data.previous || []) {
      if (snapshot && typeof snapshot.key === "string") {
        previousByKey.set(snapshot.key, snapshot);
      }
    }

    const currentByKey: Map<string, SnmpTableSnapshot> = new Map();

    for (const snapshot of data.current) {
      currentByKey.set(snapshot.key, snapshot);
    }

    const merged: Array<SnmpTableSnapshot> = [];

    for (const key of data.definedKeys) {
      const current: SnmpTableSnapshot | undefined = currentByKey.get(key);
      const previous: SnmpTableSnapshot | undefined = previousByKey.get(key);

      if (current && !current.failureCause) {
        merged.push(current);
        continue;
      }

      if (current && current.failureCause) {
        merged.push(
          previous
            ? { ...previous, failureCause: current.failureCause }
            : current,
        );
        continue;
      }

      if (previous) {
        merged.push(previous);
      }
    }

    return merged;
  }

  public static findSnapshot(
    snapshots: Array<SnmpTableSnapshot> | undefined,
    key: string | undefined,
  ): SnmpTableSnapshot | undefined {
    const normalizedKey: string = SnmpTableListUtil.normalizeKey(key);

    if (!normalizedKey) {
      return undefined;
    }

    return (snapshots || []).find((snapshot: SnmpTableSnapshot) => {
      return snapshot.key === normalizedKey;
    });
  }

  public static findColumn(
    snapshot: SnmpTableSnapshot,
    columnOidOrName: string | undefined,
  ): SnmpTableSnapshotColumn | undefined {
    const wanted: string = (columnOidOrName || "").trim();

    if (!wanted) {
      return undefined;
    }

    const normalizedOid: string = SnmpOidListUtil.normalizeOid(wanted);

    return (
      snapshot.columns.find((column: SnmpTableSnapshotColumn) => {
        return column.oid === normalizedOid;
      }) ||
      snapshot.columns.find((column: SnmpTableSnapshotColumn) => {
        return column.name.trim().toLowerCase() === wanted.toLowerCase();
      })
    );
  }

  /*
   * The rows a criteria scope selects: every row for an empty scope or the
   * "*" wildcard, the one row with that exact index for "index:<index>",
   * otherwise the rows whose name or index equals it (case-insensitive).
   */
  public static scopeRows(
    snapshot: SnmpTableSnapshot,
    rowScope: string | undefined,
  ): Array<SnmpTableSnapshotRow> {
    const scope: string = (rowScope || "").trim().toLowerCase();

    if (!scope || scope === "*") {
      return snapshot.rows;
    }

    if (scope.startsWith(ROW_INDEX_SCOPE_PREFIX)) {
      const index: string = scope.substring(ROW_INDEX_SCOPE_PREFIX.length);

      return snapshot.rows.filter((row: SnmpTableSnapshotRow) => {
        return row.index === index;
      });
    }

    return snapshot.rows.filter((row: SnmpTableSnapshotRow) => {
      return (
        row.label.trim().toLowerCase() === scope ||
        row.index.trim().toLowerCase() === scope
      );
    });
  }

  /*
   * The scope that addresses exactly one row: its name when no other row
   * shares it, otherwise its index. Per-row alerts narrow to this, so two
   * tunnels that happen to share a name still alert separately.
   */
  public static getRowScope(
    snapshot: SnmpTableSnapshot,
    row: SnmpTableSnapshotRow,
  ): string {
    const label: string = row.label.trim().toLowerCase();

    const rowsWithLabel: number = snapshot.rows.filter(
      (candidate: SnmpTableSnapshotRow) => {
        return (
          candidate.label.trim().toLowerCase() === label ||
          candidate.index.trim().toLowerCase() === label
        );
      },
    ).length;

    return rowsWithLabel === 1 && !label.startsWith(ROW_INDEX_SCOPE_PREFIX)
      ? row.label
      : `${ROW_INDEX_SCOPE_PREFIX}${row.index}`;
  }
}
