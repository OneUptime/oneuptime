import {
  SnmpTableColumn,
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableSnapshot,
  SnmpTableWalkRequest,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil, {
  MAX_HEALTHY_VALUES_PER_COLUMN,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * Two things a SAN switch's tables needed that no table had before:
 *
 *   - rowLabelsByIndex: rows named by a column of another table, read by
 *     the row's own index - an MDS power supply (CISCO-ENTITY-FRU-CONTROL-
 *     MIB, indexed by entPhysicalIndex) named by its entPhysicalName -
 *     rather than walking the whole entity table, which on a director is
 *     thousands of rows, for the handful of names wanted.
 *   - noReadingValues: a value the device sends for "no reading" - Brocade's
 *     swSensorValue of -2147483648 for a power supply - shown as nothing,
 *     not as minus two billion, while its health is judged as for any other.
 */

const ENT_PHYSICAL_NAME: string = "1.3.6.1.2.1.47.1.1.1.1.7";
const POWER_STATUS: string = "1.3.6.1.4.1.9.9.117.1.1.2.1.2";

function powerSupplies(
  overrides: Partial<SnmpTableDefinition> = {},
): SnmpTableDefinition {
  return {
    key: "power_supplies",
    name: "Power Supplies",
    kind: SnmpTableKind.Generic,
    rowLabelColumnOids: [ENT_PHYSICAL_NAME],
    rowLabelsByIndex: true,
    columns: [
      {
        oid: POWER_STATUS,
        name: "Status",
        role: SnmpTableColumnRole.Status,
        healthyValues: ["2"],
      },
    ],
    ...overrides,
  };
}

describe("rowLabelsByIndex", () => {
  test("is kept through validation when the table has a name column", () => {
    expect(
      SnmpTableListUtil.validateTable(powerSupplies(), "test").rowLabelsByIndex,
    ).toBe(true);
  });

  test("is dropped when there is no name column to look up", () => {
    expect(
      SnmpTableListUtil.validateTable(
        powerSupplies({ rowLabelColumnOids: [] }),
        "test",
      ).rowLabelsByIndex,
    ).toBeUndefined();
    expect(
      SnmpTableListUtil.validateTable(
        powerSupplies({ rowLabelColumnOids: undefined }),
        "test",
      ).rowLabelsByIndex,
    ).toBeUndefined();
  });

  test("anything but true is no lookup", () => {
    expect(
      SnmpTableListUtil.validateTable(
        powerSupplies({
          rowLabelsByIndex: "yes" as unknown as boolean,
        }),
        "test",
      ).rowLabelsByIndex,
    ).toBeUndefined();
  });

  test("the probe walks the status column and looks the names up by index", () => {
    const [request] = SnmpTableListUtil.toWalkRequests([powerSupplies()]) as [
      SnmpTableWalkRequest,
    ];

    expect(request.columnOids).toEqual([POWER_STATUS]);
    expect(request.labelOids).toEqual([ENT_PHYSICAL_NAME]);
  });

  test("a name column that is also a value column is walked, not looked up", () => {
    const table: SnmpTableDefinition = powerSupplies({
      rowLabelColumnOids: [ENT_PHYSICAL_NAME],
      columns: [
        { oid: ENT_PHYSICAL_NAME, name: "Name" },
        { oid: POWER_STATUS, name: "Status" },
      ],
    });

    expect(SnmpTableListUtil.getLabelLookupOids(table)).toEqual([]);
    expect(SnmpTableListUtil.toWalkRequests([table])[0]?.columnOids).toContain(
      ENT_PHYSICAL_NAME,
    );
  });

  test("without it, a table walks its name columns as it always did", () => {
    const [request] = SnmpTableListUtil.toWalkRequests([
      powerSupplies({ rowLabelsByIndex: undefined }),
    ]) as [SnmpTableWalkRequest];

    expect(request.columnOids).toEqual([ENT_PHYSICAL_NAME, POWER_STATUS]);
    expect(request.labelOids).toBeUndefined();
  });

  test("the names the probe looked up name the rows, like a walked name column", () => {
    const snapshot: SnmpTableSnapshot = SnmpTableListUtil.materialize({
      tables: [powerSupplies()],
      results: [
        {
          key: "power_supplies",
          rows: [
            {
              index: "470",
              values: {
                [POWER_STATUS]: 2,
                [ENT_PHYSICAL_NAME]: "PowerSupply-1",
              },
            },
            { index: "471", values: { [POWER_STATUS]: 5 } },
          ],
        },
      ],
    })[0]!;

    expect(snapshot.rows[0]!.label).toBe("PowerSupply-1");
    // A name the agent did not answer: the row is still there, by index.
    expect(snapshot.rows[1]!.label).toContain("471");
    expect(snapshot.rows[1]!.cells[POWER_STATUS]!.isHealthy).toBe(false);
  });
});

describe("noReadingValues", () => {
  const VALUE: SnmpTableColumn = {
    oid: "1.3.6.1.4.1.1588.2.1.1.1.1.22.1.4",
    name: "Value",
    noReadingValues: ["-2147483648"],
  };

  test("a no-reading value shows as nothing, and keeps what was sent", () => {
    expect(SnmpTableListUtil.buildCell(VALUE, -2147483648)).toEqual({
      raw: -2147483648,
      display: "",
    });
    expect(SnmpTableListUtil.buildCell(VALUE, "-2147483648")).toEqual({
      raw: "-2147483648",
      display: "",
    });
  });

  test("it has no number: nothing to chart or compare", () => {
    expect(
      SnmpTableListUtil.buildCell(VALUE, -2147483648).numeric,
    ).toBeUndefined();
  });

  test("any other value reads as before", () => {
    expect(SnmpTableListUtil.buildCell(VALUE, 41)).toEqual({
      raw: 41,
      display: "41",
      numeric: 41,
    });
  });

  test("health is still judged on a status column", () => {
    const status: SnmpTableColumn = {
      oid: "1.3.6.1.4.1.1588.2.1.1.1.1.22.1.3",
      name: "Status",
      healthyValues: ["4", "6"],
      noReadingValues: ["6"],
    };

    expect(SnmpTableListUtil.buildCell(status, 6)).toEqual({
      raw: 6,
      display: "",
      isHealthy: true,
    });
  });

  test("validation keeps them, trimmed, once each, and capped", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 30; index++) {
      many.push(`-${index}`);
    }

    const validated: SnmpTableDefinition = SnmpTableListUtil.validateTable(
      {
        key: "sensors",
        name: "Sensors",
        kind: SnmpTableKind.Generic,
        columns: [
          {
            oid: "1.3.6.1.4.1.1588.2.1.1.1.1.22.1.4",
            name: "Value",
            noReadingValues: [" -2147483648 ", "-2147483648", "", ...many],
          },
        ],
      },
      "test",
    );

    const kept: Array<string> | undefined =
      validated.columns[0]!.noReadingValues;

    expect(kept?.[0]).toBe("-2147483648");
    expect(new Set(kept).size).toBe(kept?.length);
    expect(kept?.length).toBe(MAX_HEALTHY_VALUES_PER_COLUMN);
    expect(kept).not.toContain("");
  });

  test("no list, or an empty one, is none", () => {
    for (const noReadingValues of [undefined, [], ["", "  "]]) {
      const validated: SnmpTableDefinition = SnmpTableListUtil.validateTable(
        {
          key: "sensors",
          name: "Sensors",
          kind: SnmpTableKind.Generic,
          columns: [
            {
              oid: "1.3.6.1.4.1.1588.2.1.1.1.1.22.1.4",
              name: "Value",
              ...(noReadingValues ? { noReadingValues: noReadingValues } : {}),
            },
          ],
        },
        "test",
      );

      expect(validated.columns[0]!.noReadingValues).toBeUndefined();
    }
  });
});
