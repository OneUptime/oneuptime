import Alert from "../../../Models/DatabaseModels/Alert";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ColumnLength from "../../../Types/Database/ColumnLength";
import {
  DEFAULT_RECORDS_TO_OPEN_EPISODE,
  MAX_RECORDS_TO_OPEN_EPISODE,
  MIN_RECORDS_TO_OPEN_EPISODE,
} from "../../../Utils/Episode/EpisodeOpeningThreshold";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, it } from "@jest/globals";

/*
 * THE COLUMNS BEHIND "WAIT FOR MORE INCIDENTS" (issue #5374), and who may
 * touch each:
 *
 *   - IncidentGroupingRule.enableMinimumIncidentCount / minimumIncidentCount
 *     and AlertGroupingRule.enableMinimumAlertCount / minimumAlertCount - the
 *     rule's switch and count: written and read by exactly who may write and
 *     read the rule's time window, off on every rule until someone turns it
 *     on, the count starting at the form's 3;
 *   - Incident / Alert.groupingWaitKey - the group a waiting record waits
 *     in: internal, the grouping engine's own bookkeeping. No API caller
 *     sets it (that would put a record into an episode behind the rules'
 *     back) or reads it.
 */

function accessOf(model: BaseModel, column: string): ColumnAccessControl {
  const access: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  expect(access).toBeTruthy();
  return access!;
}

function databaseColumn(
  model: { new (): BaseModel },
  column: string,
): ColumnMetadataArgs {
  const found: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((args: ColumnMetadataArgs) => {
      return args.target === model && args.propertyName === column;
    });

  expect(found).toBeDefined();
  return found!;
}

interface RuleCase {
  name: string;
  modelType: { new (): BaseModel };
  noun: string;
  enabledColumn: string;
  countColumn: string;
  enabledTitle: string;
  countTitle: string;
}

const RULES: Array<RuleCase> = [
  {
    name: "IncidentGroupingRule",
    modelType: IncidentGroupingRule,
    noun: "incident",
    enabledColumn: "enableMinimumIncidentCount",
    countColumn: "minimumIncidentCount",
    enabledTitle: "Enable Minimum Incident Count",
    countTitle: "Minimum Incident Count",
  },
  {
    name: "AlertGroupingRule",
    modelType: AlertGroupingRule,
    noun: "alert",
    enabledColumn: "enableMinimumAlertCount",
    countColumn: "minimumAlertCount",
    enabledTitle: "Enable Minimum Alert Count",
    countTitle: "Minimum Alert Count",
  },
];

describe.each(RULES)("$name's minimum count", (rule: RuleCase) => {
  const model: BaseModel = new rule.modelType();

  it("is a switch, off by default, named as the API and Terraform show it", () => {
    const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
      model.getTableColumnMetadata(rule.enabledColumn);

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe(rule.enabledTitle);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(false);
    expect(metadata.description).toContain(
      `Wait for more ${rule.noun}s before opening an episode.`,
    );
    expect(metadata.description).toContain(
      `When disabled, the first matching ${rule.noun} opens an episode.`,
    );
    expect(metadata.description).toContain(
      `each ${rule.noun} runs only its own on-call policies`,
    );
  });

  it("is a count, starting where the form does, of 1 to 100", () => {
    const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
      model.getTableColumnMetadata(rule.countColumn);

    expect(metadata.type).toBe(TableColumnType.Number);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe(rule.countTitle);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(DEFAULT_RECORDS_TO_OPEN_EPISODE);
    expect(metadata.description).toContain(
      `A whole number from ${MIN_RECORDS_TO_OPEN_EPISODE} to ${MAX_RECORDS_TO_OPEN_EPISODE}`,
    );
  });

  it("is stored so that every existing rule waits for nothing", () => {
    const enabled: ColumnMetadataArgs = databaseColumn(
      rule.modelType,
      rule.enabledColumn,
    );
    const count: ColumnMetadataArgs = databaseColumn(
      rule.modelType,
      rule.countColumn,
    );

    expect(enabled.options.nullable).toBe(false);
    expect(enabled.options.default).toBe(false);
    expect(count.options.nullable).toBe(false);
    expect(count.options.default).toBe(DEFAULT_RECORDS_TO_OPEN_EPISODE);
  });

  it.each(["enabledColumn", "countColumn"] as const)(
    "%s is written and read by exactly who may write and read the time window",
    (which: "enabledColumn" | "countColumn") => {
      const access: ColumnAccessControl = accessOf(model, rule[which]);
      const timeWindow: ColumnAccessControl = accessOf(
        model,
        "enableTimeWindow",
      );

      expect(access.create).toEqual(timeWindow.create);
      expect(access.read).toEqual(timeWindow.read);
      expect(access.update).toEqual(timeWindow.update);
      expect(access.create.length).toBeGreaterThan(0);
      expect(access.read.length).toBeGreaterThan(0);
      expect(access.update.length).toBeGreaterThan(0);
    },
  );
});

describe.each([
  ["Incident", Incident as { new (): BaseModel }],
  ["Alert", Alert as { new (): BaseModel }],
])("%s.groupingWaitKey", (_name: string, modelType: { new (): BaseModel }) => {
  const model: BaseModel = new modelType();

  it("is optional short text, internal to OneUptime", () => {
    const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
      model.getTableColumnMetadata("groupingWaitKey");

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Grouping Wait Key");
    expect(metadata.description).toMatch(/^Internal: /);
  });

  it("is a nullable column long enough for the key", () => {
    const column: ColumnMetadataArgs = databaseColumn(
      modelType,
      "groupingWaitKey",
    );

    expect(column.options.nullable).toBe(true);
    expect(column.options.length).toBe(ColumnLength.ShortText);
    // A sha256 in hex.
    expect(64).toBeLessThanOrEqual(ColumnLength.ShortText);
  });

  it("no API caller may set it, change it or read it", () => {
    const access: ColumnAccessControl = accessOf(model, "groupingWaitKey");

    expect(access.create).toEqual([]);
    expect(access.read).toEqual([]);
    expect(access.update).toEqual([]);
  });

  it("is kept as the record's other bookkeeping is", () => {
    const wait: ColumnAccessControl = accessOf(model, "groupingWaitKey");
    const aiWait: ColumnAccessControl = accessOf(
      model,
      "aiInvestigationWaitUntil",
    );

    expect(wait).toEqual(aiWait);
  });
});
