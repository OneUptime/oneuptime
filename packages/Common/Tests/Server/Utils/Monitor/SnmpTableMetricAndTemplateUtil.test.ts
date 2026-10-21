import SnmpTableMetricUtil, {
  SnmpTablePoint,
} from "../../../../Server/Utils/Monitor/SnmpTableMetricUtil";
import SnmpTableTemplateUtil, {
  MAX_TEMPLATE_ROWS_PER_TABLE,
} from "../../../../Server/Utils/Monitor/SnmpTableTemplateUtil";
import { JSONObject } from "../../../../Types/JSON";
import {
  SNMP_TABLE_COLUMN_ATTRIBUTE,
  SNMP_TABLE_COLUMN_OID_ATTRIBUTE,
  SNMP_TABLE_KEY_ATTRIBUTE,
  SNMP_TABLE_NAME_ATTRIBUTE,
  SNMP_TABLE_ROW_ATTRIBUTE,
  SNMP_TABLE_ROW_INDEX_ATTRIBUTE,
  SnmpTableDefinition,
  SnmpTableSnapshot,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import { describe, expect, it } from "@jest/globals";

const RADIO_ENTRY: string = "1.3.6.1.4.1.17713.22.1.2.1";
const RADIO_BAND: string = `${RADIO_ENTRY}.3`;
const RADIO_CHANNEL: string = `${RADIO_ENTRY}.6`;
const RADIO_POWER: string = `${RADIO_ENTRY}.8`;
const RADIO_TYPE: string = `${RADIO_ENTRY}.4`;
const RADIO_STATE: string = `${RADIO_ENTRY}.13`;

const RADIO_TABLE: SnmpTableDefinition = {
  key: "wifi_radios",
  name: "Wi-Fi Radios",
  rowLabelColumnOids: [RADIO_BAND],
  columns: [
    { oid: RADIO_CHANNEL, name: "Channel" },
    { oid: RADIO_POWER, name: "TX Power (dBm)", unit: "dBm" },
    // Text that merely starts with a digit must not chart.
    { oid: RADIO_TYPE, name: "Radio Type", valueType: "Text" as never },
    {
      oid: RADIO_STATE,
      name: "State",
      valueLabels: { ON: "On", OFF: "Off" },
      healthyValues: ["ON"],
    },
  ],
};

function radios(): SnmpTableSnapshot {
  return SnmpTableListUtil.materialize({
    tables: [RADIO_TABLE],
    results: [
      {
        key: "wifi_radios",
        rows: [
          {
            index: "1",
            values: {
              [RADIO_BAND]: "2.4GHz",
              [RADIO_CHANNEL]: "6",
              [RADIO_POWER]: 14,
              [RADIO_TYPE]: "11axg",
              [RADIO_STATE]: "ON",
            },
          },
          {
            index: "2",
            values: {
              [RADIO_BAND]: "5GHz",
              [RADIO_CHANNEL]: "36",
              [RADIO_POWER]: 21,
              [RADIO_TYPE]: "11axa",
              [RADIO_STATE]: "OFF",
            },
          },
        ],
      },
    ],
  })[0]!;
}

describe("SnmpTableMetricUtil.getPoints", () => {
  it("writes one point per numeric cell, labelled with table, column and row", () => {
    const points: Array<SnmpTablePoint> = SnmpTableMetricUtil.getPoints([
      radios(),
    ]);

    // Channel and TX power for two radios; the text columns write nothing.
    expect(points).toHaveLength(4);

    expect(points[1]).toEqual({
      value: 14,
      unit: "dBm",
      attributes: {
        [SNMP_TABLE_KEY_ATTRIBUTE]: "wifi_radios",
        [SNMP_TABLE_NAME_ATTRIBUTE]: "Wi-Fi Radios",
        [SNMP_TABLE_COLUMN_ATTRIBUTE]: "TX Power (dBm)",
        [SNMP_TABLE_COLUMN_OID_ATTRIBUTE]: RADIO_POWER,
        [SNMP_TABLE_ROW_ATTRIBUTE]: "2.4GHz",
        [SNMP_TABLE_ROW_INDEX_ATTRIBUTE]: "1",
      },
    });

    expect(
      points.map((point: SnmpTablePoint) => {
        return point.value;
      }),
    ).toEqual([6, 14, 36, 21]);
  });

  it("writes nothing for a table that failed, or when there are no tables", () => {
    expect(
      SnmpTableMetricUtil.getPoints([
        { ...radios(), rows: [], failureCause: "timeout" },
      ]),
    ).toEqual([]);
    expect(SnmpTableMetricUtil.getPoints(undefined)).toEqual([]);
    expect(SnmpTableMetricUtil.getPoints([])).toEqual([]);
  });
});

describe("SnmpTableTemplateUtil.toTemplateVariables", () => {
  it("exposes each table by key with rows, values by column name and health", () => {
    const variables: JSONObject = SnmpTableTemplateUtil.toTemplateVariables([
      radios(),
    ]);

    const table: JSONObject = variables["wifi_radios"] as JSONObject;

    expect(table["name"]).toBe("Wi-Fi Radios");
    expect(table["rowCount"]).toBe(2);
    expect(table["unhealthyRowCount"]).toBe(1);
    expect((table["rows"] as Array<JSONObject>)[1]).toEqual({
      name: "5GHz",
      index: "2",
      values: {
        channel: "36",
        tx_power_dbm: "21",
        radio_type: "11axa",
        state: "Off",
      },
    });
    expect(
      ((table["unhealthyRows"] as Array<JSONObject>)[0] as JSONObject)["name"],
    ).toBe("5GHz");
    expect(table["failureCause"]).toBeUndefined();
  });

  it("includes why a table was not walked", () => {
    const variables: JSONObject = SnmpTableTemplateUtil.toTemplateVariables([
      { ...radios(), rows: [], failureCause: "Request timed out" },
    ]);

    expect((variables["wifi_radios"] as JSONObject)["failureCause"]).toBe(
      "Request timed out",
    );
    expect((variables["wifi_radios"] as JSONObject)["rowCount"]).toBe(0);
  });

  it("caps the rows offered to a template", () => {
    const many: SnmpTableSnapshot = {
      ...radios(),
      rows: Array.from(
        { length: MAX_TEMPLATE_ROWS_PER_TABLE + 10 },
        (_: unknown, i: number) => {
          return { index: `${i}`, label: `${i}`, cells: {} };
        },
      ),
    };

    const table: JSONObject = SnmpTableTemplateUtil.toTemplateVariables([many])[
      "wifi_radios"
    ] as JSONObject;

    expect(table["rowCount"]).toBe(MAX_TEMPLATE_ROWS_PER_TABLE + 10);
    expect(table["rows"] as Array<JSONObject>).toHaveLength(
      MAX_TEMPLATE_ROWS_PER_TABLE,
    );
  });

  it("turns column names into template identifiers", () => {
    expect(
      SnmpTableTemplateUtil.getColumnVariableName({
        oid: "1.3.6.1",
        name: " Noise Floor (dBm) ",
      }),
    ).toBe("noise_floor_dbm");
    expect(
      SnmpTableTemplateUtil.getColumnVariableName({
        oid: "1.3.6.1",
        name: "--",
      }),
    ).toBe("1_3_6_1");
  });

  it("calls a row unhealthy only when a status column says so", () => {
    expect(
      SnmpTableTemplateUtil.isUnhealthy({
        index: "1",
        label: "1",
        cells: { a: { raw: 1, display: "1", numeric: 1 } },
      }),
    ).toBe(false);
    expect(
      SnmpTableTemplateUtil.isUnhealthy({
        index: "1",
        label: "1",
        cells: { a: { raw: 0, display: "0", isHealthy: false } },
      }),
    ).toBe(true);
  });
});
