import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  SnmpTableSnapshot,
  SnmpTableSnapshotCell,
  SnmpTableSnapshotColumn,
  SnmpTableSnapshotRow,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpOidListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import SnmpTrap, {
  SnmpTrapVarbind,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTrap";

// Rows named in one root cause before the rest are summarised.
const MAX_ROWS_IN_ROOT_CAUSE: number = 5;

// A value that is exactly a number, with nothing after it.
const WHOLE_NUMBER: RegExp = /^\s*[-+]?(\d+(\.\d+)?|\.\d+)\s*$/;

/*
 * A value as both forms a person might compare it against: what the device
 * sent, and what it is shown as. Sophos sends a tunnel's status as 0, which
 * a value label shows as "inactive"; "Equal To inactive" and "Equal To 0"
 * must both match it.
 */
interface ComparableValue {
  raw: string;
  display: string;
  numeric?: number | undefined;
}

/*
 * The SNMP checks that read a list rather than one value: the rows of a
 * walked table, and the varbinds carried by a trap. Kept apart from
 * SnmpMonitorCriteria so the comparison rules - which are the subtle part -
 * are pure and testable on their own.
 *
 * Every function returns a root cause when the filter is met and null when
 * it is not, or when there is nothing to judge - a table this walk did not
 * produce, a column it does not have. "Not evaluated" is null, never a
 * breach, matching the rest of the SNMP criteria.
 */
export default class SnmpTableCriteria {
  public static evaluateTableValue(data: {
    tables: Array<SnmpTableSnapshot> | undefined;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    const snapshot: SnmpTableSnapshot | undefined =
      SnmpTableCriteria.getUsableSnapshot(
        data.tables,
        data.criteriaFilter.snmpMonitorOptions?.tableKey,
      );

    if (!snapshot) {
      return null;
    }

    const column: SnmpTableSnapshotColumn | undefined =
      SnmpTableListUtil.findColumn(
        snapshot,
        data.criteriaFilter.snmpMonitorOptions?.tableColumnOid,
      );

    if (!column) {
      return null;
    }

    const rows: Array<SnmpTableSnapshotRow> = SnmpTableListUtil.scopeRows(
      snapshot,
      data.criteriaFilter.snmpMonitorOptions?.tableRow,
    );

    const matchingRows: Array<SnmpTableSnapshotRow> = rows.filter(
      (row: SnmpTableSnapshotRow) => {
        const cell: SnmpTableSnapshotCell | undefined = row.cells[column.oid];

        return SnmpTableCriteria.isValueMatch({
          value: SnmpTableCriteria.toComparable(cell),
          threshold: data.criteriaFilter.value,
          filterType: data.criteriaFilter.filterType,
        });
      },
    );

    if (matchingRows.length === 0) {
      return null;
    }

    const described: string = matchingRows
      .slice(0, MAX_ROWS_IN_ROOT_CAUSE)
      .map((row: SnmpTableSnapshotRow) => {
        const cell: SnmpTableSnapshotCell | undefined = row.cells[column.oid];
        const shown: string = cell?.display || "(empty)";
        return `${row.label} (${column.name}: ${shown}${
          column.unit && cell?.display ? ` ${column.unit}` : ""
        })`;
      })
      .join(", ");

    const more: string =
      matchingRows.length > MAX_ROWS_IN_ROOT_CAUSE
        ? `, and ${matchingRows.length - MAX_ROWS_IN_ROOT_CAUSE} more`
        : "";

    return `${matchingRows.length} row(s) of SNMP table ${snapshot.name} where ${column.name} ${SnmpTableCriteria.describeFilter(data.criteriaFilter)}: ${described}${more}.`;
  }

  /*
   * Rows whose status is outside what their table calls healthy (a column's
   * healthyValues). "True" is met when any in-scope row is unhealthy, "False"
   * when none is. A table that declares no healthy values has nothing to
   * judge, so it is never evaluated rather than always healthy.
   */
  public static evaluateTableRowIsUnhealthy(data: {
    tables: Array<SnmpTableSnapshot> | undefined;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    const snapshot: SnmpTableSnapshot | undefined =
      SnmpTableCriteria.getUsableSnapshot(
        data.tables,
        data.criteriaFilter.snmpMonitorOptions?.tableKey,
      );

    if (!snapshot) {
      return null;
    }

    const statusColumns: Array<SnmpTableSnapshotColumn> =
      snapshot.columns.filter((column: SnmpTableSnapshotColumn) => {
        return Boolean(column.healthyValues && column.healthyValues.length > 0);
      });

    if (statusColumns.length === 0) {
      return null;
    }

    const rows: Array<SnmpTableSnapshotRow> = SnmpTableListUtil.scopeRows(
      snapshot,
      data.criteriaFilter.snmpMonitorOptions?.tableRow,
    );

    if (rows.length === 0) {
      return null;
    }

    const unhealthyRows: Array<SnmpTableSnapshotRow> = rows.filter(
      (row: SnmpTableSnapshotRow) => {
        return statusColumns.some((column: SnmpTableSnapshotColumn) => {
          return row.cells[column.oid]?.isHealthy === false;
        });
      },
    );

    if (data.criteriaFilter.filterType === FilterType.True) {
      if (unhealthyRows.length === 0) {
        return null;
      }

      const described: string = unhealthyRows
        .slice(0, MAX_ROWS_IN_ROOT_CAUSE)
        .map((row: SnmpTableSnapshotRow) => {
          const states: string = statusColumns
            .filter((column: SnmpTableSnapshotColumn) => {
              return row.cells[column.oid]?.isHealthy === false;
            })
            .map((column: SnmpTableSnapshotColumn) => {
              return `${column.name}: ${row.cells[column.oid]?.display || "(empty)"}`;
            })
            .join(", ");
          return `${row.label} (${states})`;
        })
        .join(", ");

      const more: string =
        unhealthyRows.length > MAX_ROWS_IN_ROOT_CAUSE
          ? `, and ${unhealthyRows.length - MAX_ROWS_IN_ROOT_CAUSE} more`
          : "";

      return `${unhealthyRows.length} unhealthy row(s) in SNMP table ${snapshot.name}: ${described}${more}.`;
    }

    if (data.criteriaFilter.filterType === FilterType.False) {
      return unhealthyRows.length === 0
        ? `Every row in SNMP table ${snapshot.name} is healthy.`
        : null;
    }

    return null;
  }

  public static evaluateTableRowCount(data: {
    tables: Array<SnmpTableSnapshot> | undefined;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    const snapshot: SnmpTableSnapshot | undefined =
      SnmpTableCriteria.getUsableSnapshot(
        data.tables,
        data.criteriaFilter.snmpMonitorOptions?.tableKey,
      );

    if (!snapshot) {
      return null;
    }

    const threshold: number | undefined = SnmpTableCriteria.toNumber(
      data.criteriaFilter.value,
    );

    if (threshold === undefined) {
      return null;
    }

    const rowCount: number = SnmpTableListUtil.scopeRows(
      snapshot,
      data.criteriaFilter.snmpMonitorOptions?.tableRow,
    ).length;

    if (
      !SnmpTableCriteria.compareNumbers(
        rowCount,
        threshold,
        data.criteriaFilter.filterType,
      )
    ) {
      return null;
    }

    return `SNMP table ${snapshot.name} has ${rowCount} row(s), which is ${SnmpTableCriteria.describeFilter(data.criteriaFilter)}.`;
  }

  /*
   * Varbinds in scope: those whose OID is the configured one or sits under
   * it (an instance suffix such as ".0"), or every varbind when none is
   * configured. A positive filter is met when ANY of them matches it; a
   * negative one (Not Equal To, Not Contains, Is Empty) when NONE matches
   * its positive counterpart - so "Not Contains test" means the trap says
   * nothing about a test anywhere, not that one varbind happens not to.
   */
  public static evaluateTrapVarbind(data: {
    snmpTrap: SnmpTrap;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    const scopeOid: string = SnmpOidListUtil.normalizeOid(
      data.criteriaFilter.snmpMonitorOptions?.oid,
    );

    const varbinds: Array<SnmpTrapVarbind> = (
      data.snmpTrap.varbinds || []
    ).filter((varbind: SnmpTrapVarbind) => {
      if (!scopeOid) {
        return true;
      }

      const varbindOid: string = SnmpOidListUtil.normalizeOid(varbind.oid);
      return varbindOid === scopeOid || varbindOid.startsWith(`${scopeOid}.`);
    });

    const filterType: FilterType | undefined = data.criteriaFilter.filterType;
    const positiveFilterType: FilterType | undefined =
      SnmpTableCriteria.getPositiveCounterpart(filterType);

    if (!positiveFilterType) {
      return null;
    }

    const matching: Array<SnmpTrapVarbind> = varbinds.filter(
      (varbind: SnmpTrapVarbind) => {
        return SnmpTableCriteria.isValueMatch({
          value: {
            raw: varbind.value ?? "",
            display: varbind.value ?? "",
            numeric: SnmpTableListUtil.parseNumericValue(varbind.value),
          },
          threshold: data.criteriaFilter.value,
          filterType: positiveFilterType,
        });
      },
    );

    const isNegative: boolean = positiveFilterType !== filterType;
    const isMet: boolean = isNegative
      ? matching.length === 0
      : matching.length > 0;

    if (!isMet) {
      return null;
    }

    const scopeText: string = scopeOid ? `varbind ${scopeOid}` : "a varbind";

    if (isNegative) {
      return `SNMP trap ${data.snmpTrap.trapOid} from ${data.snmpTrap.sourceIpAddress}: ${scopeText} ${SnmpTableCriteria.describeFilter(data.criteriaFilter)}.`;
    }

    const first: SnmpTrapVarbind = matching[0]!;
    return `SNMP trap ${data.snmpTrap.trapOid} from ${data.snmpTrap.sourceIpAddress}: varbind ${first.oid} = "${SnmpTableCriteria.truncate(first.value, 200)}" ${SnmpTableCriteria.describeFilter(data.criteriaFilter)}.`;
  }

  /*
   * The table a criteria names, provided this walk produced it. A table
   * whose walk failed this time is not judged at all - its rows are empty,
   * and "row count is 0" or "no row matches" would be claims about a walk
   * that did not happen.
   */
  private static getUsableSnapshot(
    tables: Array<SnmpTableSnapshot> | undefined,
    tableKey: string | undefined,
  ): SnmpTableSnapshot | undefined {
    const snapshot: SnmpTableSnapshot | undefined =
      SnmpTableListUtil.findSnapshot(tables, tableKey);

    if (!snapshot || snapshot.failureCause) {
      return undefined;
    }

    return snapshot;
  }

  private static toComparable(
    cell: SnmpTableSnapshotCell | undefined,
  ): ComparableValue {
    if (!cell) {
      return { raw: "", display: "" };
    }

    return {
      raw: cell.raw === null || cell.raw === undefined ? "" : String(cell.raw),
      display: cell.display || "",
      numeric: cell.numeric,
    };
  }

  /*
   * One value against one filter.
   *
   * Numbers compare as numbers whenever both sides are numbers - "Status
   * Not Equal To 1" must not be a text comparison that "1.0" fails. Text
   * compares against BOTH forms of the value: a positive filter (Equal To,
   * Contains, ...) is met when either the raw value or its label matches,
   * a negative one (Not Equal To, Not Contains) only when neither does.
   */
  public static isValueMatch(data: {
    value: ComparableValue;
    threshold: string | number | undefined;
    filterType: FilterType | undefined;
  }): boolean {
    const filterType: FilterType | undefined = data.filterType;

    if (filterType === FilterType.IsEmpty) {
      return !data.value.display.trim() && !data.value.raw.trim();
    }

    if (filterType === FilterType.IsNotEmpty) {
      return Boolean(data.value.display.trim() || data.value.raw.trim());
    }

    if (data.threshold === undefined || data.threshold === null) {
      return false;
    }

    const thresholdText: string = String(data.threshold).trim();
    const thresholdNumber: number | undefined = SnmpTableCriteria.toNumber(
      data.threshold,
    );

    if (SnmpTableCriteria.isNumericOnlyFilter(filterType)) {
      if (data.value.numeric === undefined || thresholdNumber === undefined) {
        return false;
      }

      return SnmpTableCriteria.compareNumbers(
        data.value.numeric,
        thresholdNumber,
        filterType,
      );
    }

    if (
      (filterType === FilterType.EqualTo ||
        filterType === FilterType.NotEqualTo) &&
      data.value.numeric !== undefined &&
      thresholdNumber !== undefined &&
      SnmpTableCriteria.isWholeNumberText(data.value.raw)
    ) {
      return SnmpTableCriteria.compareNumbers(
        data.value.numeric,
        thresholdNumber,
        filterType,
      );
    }

    const forms: Array<string> = Array.from(
      new Set([data.value.raw, data.value.display]),
    );

    switch (filterType) {
      case FilterType.EqualTo:
        return forms.some((form: string) => {
          return form === thresholdText;
        });
      case FilterType.NotEqualTo:
        return forms.every((form: string) => {
          return form !== thresholdText;
        });
      case FilterType.Contains:
        return forms.some((form: string) => {
          return form.includes(thresholdText);
        });
      case FilterType.NotContains:
        return forms.every((form: string) => {
          return !form.includes(thresholdText);
        });
      case FilterType.StartsWith:
        return forms.some((form: string) => {
          return form.startsWith(thresholdText);
        });
      case FilterType.EndsWith:
        return forms.some((form: string) => {
          return form.endsWith(thresholdText);
        });
      default:
        return false;
    }
  }

  /*
   * A raw value that is exactly a number ("1", "-3", "2.5", or a number
   * varbind). Equal To compares numerically only then: "80MHz" Equal To 80
   * reads as text, so it does not quietly match by its leading digits.
   */
  private static isWholeNumberText(raw: string): boolean {
    return WHOLE_NUMBER.test(raw);
  }

  private static isNumericOnlyFilter(
    filterType: FilterType | undefined,
  ): boolean {
    return (
      filterType === FilterType.GreaterThan ||
      filterType === FilterType.LessThan ||
      filterType === FilterType.GreaterThanOrEqualTo ||
      filterType === FilterType.LessThanOrEqualTo
    );
  }

  public static compareNumbers(
    value: number,
    threshold: number,
    filterType: FilterType | undefined,
  ): boolean {
    switch (filterType) {
      case FilterType.EqualTo:
        return value === threshold;
      case FilterType.NotEqualTo:
        return value !== threshold;
      case FilterType.GreaterThan:
        return value > threshold;
      case FilterType.LessThan:
        return value < threshold;
      case FilterType.GreaterThanOrEqualTo:
        return value >= threshold;
      case FilterType.LessThanOrEqualTo:
        return value <= threshold;
      default:
        return false;
    }
  }

  /*
   * The positive filter a negative one is the absence of, for list-shaped
   * values ("Not Contains x" = no varbind contains x). Undefined for filter
   * types that do not apply to a value.
   */
  private static getPositiveCounterpart(
    filterType: FilterType | undefined,
  ): FilterType | undefined {
    switch (filterType) {
      case FilterType.NotEqualTo:
        return FilterType.EqualTo;
      case FilterType.NotContains:
        return FilterType.Contains;
      case FilterType.IsEmpty:
        return FilterType.IsNotEmpty;
      case FilterType.EqualTo:
      case FilterType.Contains:
      case FilterType.StartsWith:
      case FilterType.EndsWith:
      case FilterType.IsNotEmpty:
      case FilterType.GreaterThan:
      case FilterType.LessThan:
      case FilterType.GreaterThanOrEqualTo:
      case FilterType.LessThanOrEqualTo:
        return filterType;
      default:
        return undefined;
    }
  }

  private static toNumber(
    value: string | number | undefined | null,
  ): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }

    if (!value.trim()) {
      return undefined;
    }

    const parsed: number = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private static describeFilter(criteriaFilter: CriteriaFilter): string {
    const filterType: string = (criteriaFilter.filterType || "").toLowerCase();

    if (
      criteriaFilter.filterType === FilterType.IsEmpty ||
      criteriaFilter.filterType === FilterType.IsNotEmpty
    ) {
      return filterType;
    }

    return `${filterType} ${criteriaFilter.value ?? ""}`.trim();
  }

  private static truncate(value: string, maxLength: number): string {
    return value.length > maxLength
      ? `${value.substring(0, maxLength)}…`
      : value;
  }

  /*
   * What the walk actually showed, for the evaluation summary of a table
   * criteria that did not match - "why didn't this fire?" should be
   * answerable without opening the device.
   */
  public static describeTableObservation(data: {
    tables: Array<SnmpTableSnapshot> | undefined;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    const tableKey: string | undefined =
      data.criteriaFilter.snmpMonitorOptions?.tableKey;

    if (!tableKey) {
      return "No SNMP table is configured on this criteria. Pick one in the criteria editor.";
    }

    const snapshot: SnmpTableSnapshot | undefined =
      SnmpTableListUtil.findSnapshot(data.tables, tableKey);

    if (!snapshot) {
      return `SNMP table ${tableKey} was not walked on this poll.`;
    }

    if (snapshot.failureCause) {
      return `SNMP table ${snapshot.name} could not be walked: ${snapshot.failureCause}`;
    }

    const rows: Array<SnmpTableSnapshotRow> = SnmpTableListUtil.scopeRows(
      snapshot,
      data.criteriaFilter.snmpMonitorOptions?.tableRow,
    );

    if (data.criteriaFilter.checkOn === CheckOn.SnmpTableRowCount) {
      return `SNMP table ${snapshot.name} had ${rows.length} row(s).`;
    }

    if (data.criteriaFilter.checkOn === CheckOn.SnmpTableRowIsUnhealthy) {
      const unhealthy: number = rows.filter((row: SnmpTableSnapshotRow) => {
        return Object.values(row.cells).some((cell: SnmpTableSnapshotCell) => {
          return cell.isHealthy === false;
        });
      }).length;

      return `SNMP table ${snapshot.name} had ${rows.length} row(s) in scope, ${unhealthy} of them unhealthy.`;
    }

    const column: SnmpTableSnapshotColumn | undefined =
      SnmpTableListUtil.findColumn(
        snapshot,
        data.criteriaFilter.snmpMonitorOptions?.tableColumnOid,
      );

    if (!column) {
      return `SNMP table ${snapshot.name} has no column ${data.criteriaFilter.snmpMonitorOptions?.tableColumnOid || "(none selected)"}.`;
    }

    if (rows.length === 0) {
      return `SNMP table ${snapshot.name} had no rows in scope.`;
    }

    const values: string = rows
      .slice(0, MAX_ROWS_IN_ROOT_CAUSE)
      .map((row: SnmpTableSnapshotRow) => {
        return `${row.label}: ${row.cells[column.oid]?.display || "(empty)"}`;
      })
      .join(", ");

    return `${column.name} in SNMP table ${snapshot.name} was ${values}${
      rows.length > MAX_ROWS_IN_ROOT_CAUSE
        ? `, and ${rows.length - MAX_ROWS_IN_ROOT_CAUSE} more row(s)`
        : ""
    }.`;
  }

  public static describeTrapVarbindObservation(data: {
    snmpTrap: SnmpTrap | undefined;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (!data.snmpTrap) {
      return "Only evaluated when an SNMP trap arrives from the device.";
    }

    const varbinds: Array<SnmpTrapVarbind> = data.snmpTrap.varbinds || [];

    if (varbinds.length === 0) {
      return `SNMP trap ${data.snmpTrap.trapOid} carried no varbinds.`;
    }

    return `SNMP trap ${data.snmpTrap.trapOid} carried: ${varbinds
      .slice(0, MAX_ROWS_IN_ROOT_CAUSE)
      .map((varbind: SnmpTrapVarbind) => {
        return `${varbind.oid} = "${SnmpTableCriteria.truncate(varbind.value ?? "", 120)}"`;
      })
      .join(", ")}.`;
  }

  public static isTableCheckOn(checkOn: CheckOn | undefined): boolean {
    return (
      checkOn === CheckOn.SnmpTableValue ||
      checkOn === CheckOn.SnmpTableRowCount ||
      checkOn === CheckOn.SnmpTableRowIsUnhealthy
    );
  }
}
