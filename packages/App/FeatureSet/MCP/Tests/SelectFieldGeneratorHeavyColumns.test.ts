import {
  SelectableFieldsInfo,
  generateAllFieldsSelect,
  getSelectableFieldsForModel,
} from "../Services/SelectFieldGenerator";
import ModelType from "../Types/ModelType";
import Host from "Common/Models/DatabaseModels/Host";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Host.hostIpAddresses became a `text` column (TableColumnType.VeryLongText)
 * when issue #3006 showed that the OTel `host.ip` array has no upper bound.
 * VeryLongText is on the MCP "heavy column" exclusion list — types that hold
 * multi-KB payloads and are dropped from the default select for token
 * efficiency.
 *
 * That exclusion is wrong for this column: the stored value is a short
 * comma-separated IP list, and it is one of the few fields that lets an agent
 * tell two hosts apart. So it is exempted, and these tests pin BOTH halves —
 * the exemption holds, and it did not accidentally disable the heavy-column
 * filter for everything else.
 */

describe("MCP default select: Host.hostIpAddresses", () => {
  test("is included in the default select despite being a text column", () => {
    const select: JSONObject = generateAllFieldsSelect(
      "Host",
      ModelType.Database,
    );

    expect(select["hostIpAddresses"]).toBe(true);
  });

  test("is not reported as a heavy field", () => {
    const info: SelectableFieldsInfo = getSelectableFieldsForModel(new Host());

    expect(info.allFields).toContain("hostIpAddresses");
    expect(info.heavyFields).not.toContain("hostIpAddresses");
  });

  test("the exemption is needed — the column really is a heavy type", () => {
    /*
     * If this ever fails the column was narrowed back to a bounded varchar
     * and the exemption in SelectFieldGenerator can be deleted.
     */
    expect(new Host().getTableColumnMetadata("hostIpAddresses").type).toBe(
      TableColumnType.VeryLongText,
    );
  });

  test("ordinary Host columns are still selected", () => {
    const select: JSONObject = generateAllFieldsSelect(
      "Host",
      ModelType.Database,
    );

    expect(select["hostIdentifier"]).toBe(true);
    expect(select["otelCollectorStatus"]).toBe(true);
    expect(select["lastSeenAt"]).toBe(true);
  });
});

describe("MCP default select: the heavy-column filter still works", () => {
  test("Host's JSON retention config is still excluded", () => {
    const select: JSONObject = generateAllFieldsSelect(
      "Host",
      ModelType.Database,
    );

    expect(
      new Host().getTableColumnMetadata("telemetryRetentionConfig").type,
    ).toBe(TableColumnType.JSON);
    expect(select["telemetryRetentionConfig"]).toBeUndefined();
  });

  test("Host still reports its remaining heavy fields", () => {
    const info: SelectableFieldsInfo = getSelectableFieldsForModel(new Host());

    expect(info.heavyFields).toContain("telemetryRetentionConfig");
  });

  test("other models are unaffected — Monitor's heavy columns stay excluded", () => {
    const info: SelectableFieldsInfo = getSelectableFieldsForModel(
      new Monitor(),
    );

    expect(info.heavyFields.length).toBeGreaterThan(0);

    const select: JSONObject = generateAllFieldsSelect(
      "Monitor",
      ModelType.Database,
    );

    for (const heavyField of info.heavyFields) {
      expect(select[heavyField]).toBeUndefined();
    }
  });

  test("the exemption is scoped to Host — a same-named column elsewhere is not exempt", () => {
    /*
     * The exemption key is "<tableName>.<columnName>", so nothing else can
     * ride in on the column name alone.
     */
    const select: JSONObject = generateAllFieldsSelect(
      "Monitor",
      ModelType.Database,
    );

    expect(select["hostIpAddresses"]).toBeUndefined();
  });
});
