import { QuerySlosTool } from "../../../../Server/Utils/AI/Toolbox/SloTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveMonitorRuleService from "../../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../../Types/ServiceLevelObjective/SloWindowType";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_slos and archived SLOs.
 *
 * An archived SLO is retired: hidden from the SLO list and no longer
 * evaluated, so its compliance columns are frozen at the moment it was
 * archived. The tool must therefore (a) leave archived SLOs out of lists by
 * default - "which SLOs are at risk?" must not surface one whose status froze
 * months ago - while letting the model ask for them explicitly, and (b) still
 * return one looked up by id, clearly flagged as archived so its numbers are
 * not read as live.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const SLO_ID: ObjectID = ObjectID.generate();
const ARCHIVED_AT: Date = new Date("2026-06-01T08:30:00.000Z");

const ARCHIVED_NOTE_START: string = "Note: this SLO is archived";

interface WidgetField {
  label: string;
  value: string;
}

function buildSlo(data?: {
  id?: ObjectID;
  name?: string;
  status?: SloStatus;
  isEnabled?: boolean;
  isArchived?: boolean;
}): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = (data?.id ?? SLO_ID).toString();
  slo.name = data?.name ?? "Checkout availability";
  slo.isEnabled = data?.isEnabled ?? true;
  slo.isArchived = data?.isArchived ?? false;
  slo.sliType = SliType.MonitorUptime;
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.sloStatus = data?.status ?? SloStatus.Healthy;
  slo.currentSliPercentage = 99.95;
  slo.errorBudgetRemainingPercentage = 47.3;
  slo.currentBurnRate = 0.8;
  slo.lastEvaluatedAt = new Date("2026-05-31T09:00:00Z");

  if (slo.isArchived) {
    slo.archivedAt = ARCHIVED_AT;
  }

  slo.monitors = [];

  return slo;
}

function queryOf(spy: jest.SpyInstance): JSONObject {
  return (spy.mock.calls[0]?.[0] as JSONObject)["query"] as JSONObject;
}

function widgetStatus(result: ToolExecutionResult): string | undefined {
  const fields: Array<WidgetField> = (
    result.widget as unknown as { data: { fields: Array<WidgetField> } }
  ).data.fields;

  return fields.find((field: WidgetField): boolean => {
    return field.label === "Status";
  })?.value;
}

function stubDetailLookups(
  slo: ServiceLevelObjective | null,
): jest.SpyInstance {
  const findOneByIdSpy: jest.SpyInstance = jest
    .spyOn(ServiceLevelObjectiveService, "findOneById")
    .mockResolvedValue(slo as never);

  jest
    .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
    .mockResolvedValue([] as never);

  jest
    .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
    .mockResolvedValue([] as never);

  return findOneByIdSpy;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_slos — archived SLOs in list mode", () => {
  function stubList(slos: Array<ServiceLevelObjective>): {
    findBySpy: jest.SpyInstance;
    countBySpy: jest.SpyInstance;
  } {
    return {
      findBySpy: jest
        .spyOn(ServiceLevelObjectiveService, "findBy")
        .mockResolvedValue(slos as never),
      countBySpy: jest
        .spyOn(ServiceLevelObjectiveService, "countBy")
        .mockResolvedValue(new PositiveNumber(slos.length) as never),
    };
  }

  test("leaves archived SLOs out by default, in the page and in the total alike", async () => {
    const { findBySpy, countBySpy } = stubList([buildSlo()]);

    await QuerySlosTool.execute({}, ctx);

    expect(queryOf(findBySpy)["isArchived"]).toBe(false);
    // The total must count the same set, or "Showing rows 1–10 of N" lies.
    expect(queryOf(countBySpy)["isArchived"]).toBe(false);
  });

  test("an explicit includeArchived: false is the default", async () => {
    const { findBySpy } = stubList([buildSlo()]);

    await QuerySlosTool.execute({ includeArchived: false }, ctx);

    expect(queryOf(findBySpy)["isArchived"]).toBe(false);
  });

  test("includeArchived: true lists archived SLOs too, and flags only those rows", async () => {
    const { findBySpy, countBySpy } = stubList([
      buildSlo(),
      buildSlo({
        id: ObjectID.generate(),
        name: "Legacy search",
        isArchived: true,
      }),
    ]);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { includeArchived: true },
      ctx,
    );

    expect(Object.keys(queryOf(findBySpy))).not.toContain("isArchived");
    expect(Object.keys(queryOf(countBySpy))).not.toContain("isArchived");

    const select: JSONObject = (findBySpy.mock.calls[0]?.[0] as JSONObject)[
      "select"
    ] as JSONObject;
    expect(select["isArchived"]).toBe(true);

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Legacy search");
    expect(result.dataForLlm.split("isArchived=true").length - 1).toBe(1);
    expect(result.dataForLlm).not.toContain("isArchived=false");
  });

  test("accepts includeArchived as the string a model sometimes sends", async () => {
    const { findBySpy } = stubList([]);

    await QuerySlosTool.execute({ includeArchived: "true" }, ctx);

    expect(Object.keys(queryOf(findBySpy))).not.toContain("isArchived");
  });

  test("an unrecognised includeArchived value falls back to leaving archived SLOs out", async () => {
    const { findBySpy } = stubList([]);

    await QuerySlosTool.execute({ includeArchived: "sometimes" }, ctx);

    expect(queryOf(findBySpy)["isArchived"]).toBe(false);
  });

  test("the archive filter composes with the status filter", async () => {
    const { findBySpy, countBySpy } = stubList([
      buildSlo({ status: SloStatus.AtRisk }),
    ]);

    await QuerySlosTool.execute({ sloStatus: "At Risk" }, ctx);

    expect(queryOf(findBySpy)["sloStatus"]).toBe(SloStatus.AtRisk);
    expect(queryOf(findBySpy)["isArchived"]).toBe(false);
    expect(queryOf(countBySpy)["sloStatus"]).toBe(SloStatus.AtRisk);
    expect(queryOf(countBySpy)["isArchived"]).toBe(false);
  });

  test("the schema offers includeArchived, and the description says archived SLOs are left out", () => {
    const properties: JSONObject = (
      QuerySlosTool.inputSchema as unknown as { properties: JSONObject }
    ).properties;

    expect((properties["includeArchived"] as JSONObject)["type"]).toBe(
      "boolean",
    );
    expect(QuerySlosTool.description).toContain("includeArchived");
    expect(QuerySlosTool.description.toLowerCase()).toContain("archived");
  });
});

describe("query_slos — an archived SLO in detail mode", () => {
  test("is still returned by id, flagged, and labelled as frozen", async () => {
    const findOneByIdSpy: jest.SpyInstance = stubDetailLookups(
      buildSlo({ isArchived: true }),
    );

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    const args: JSONObject = findOneByIdSpy.mock.calls[0]?.[0] as JSONObject;
    const select: JSONObject = args["select"] as JSONObject;

    expect(select["isArchived"]).toBe(true);
    expect(select["archivedAt"]).toBe(true);
    // Looked up by id alone - never filtered out by its archive state.
    expect(Object.keys(args)).not.toContain("query");

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm.startsWith(ARCHIVED_NOTE_START)).toBe(true);
    expect(result.dataForLlm).toContain("isArchived=true");
    expect(result.dataForLlm).toContain(
      `archivedAt=${ARCHIVED_AT.toISOString()}`,
    );
    // The compliance note still travels with it.
    expect(result.dataForLlm).toContain("last worker evaluation");
    expect(widgetStatus(result)).toBe("Archived");
  });

  test("a live SLO carries no archive note, and its widget shows its measured status", async () => {
    stubDetailLookups(buildSlo({ status: SloStatus.AtRisk }));

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain(ARCHIVED_NOTE_START);
    expect(result.dataForLlm).toContain("isArchived=false");
    expect(widgetStatus(result)).toBe(SloStatus.AtRisk);
  });

  test("a disabled SLO's widget reads Disabled, not the status it froze with", async () => {
    stubDetailLookups(
      buildSlo({ isEnabled: false, status: SloStatus.Healthy }),
    );

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(widgetStatus(result)).toBe("Disabled");
  });

  test("an SLO that is both archived and disabled reads Archived", async () => {
    stubDetailLookups(buildSlo({ isEnabled: false, isArchived: true }));

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(widgetStatus(result)).toBe("Archived");
  });

  test("a missing SLO gets no archive note", async () => {
    stubDetailLookups(null);

    const result: ToolExecutionResult = await QuerySlosTool.execute(
      { sloId: SLO_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).not.toContain(ARCHIVED_NOTE_START);
  });
});
