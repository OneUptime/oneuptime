import SetupHealthService from "../../../../Server/Services/SetupHealthService";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  GET_SETUP_HEALTH_TOOL_NAME,
  GetSetupHealthTool,
  MAX_SETUP_HEALTH_FINDINGS_FOR_LLM,
  SETUP_HEALTH_DASHBOARD_PATH,
  SETUP_HEALTH_FIX_PAGES,
} from "../../../../Server/Utils/AI/Toolbox/SetupHealthTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  SETUP_HEALTH_WORDS,
  SetupHealthAnswer,
  SetupHealthCheck,
  SetupHealthEventKind,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecordKind,
  getSetupHealthCounts,
  makeSetupHealthFinding,
} from "../../../../Types/SetupHealth/SetupHealth";
import DashboardPages from "../../../../Server/Utils/AI/Docs/DashboardPages.json";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * get_setup_health (#6812): Ask AI answers "is my setup OK?" from the
 * project's Setup health, as the person asking may see it, worst first,
 * each finding with where it is fixed, and cites the Setup Health page.
 */

const PROJECT: ObjectID = new ObjectID("68126666-0000-4000-8000-000000000001");

const ctx: ToolContext = {
  projectId: PROJECT,
  props: { tenantId: PROJECT, userId: ObjectID.generate() },
};

function finding(index: number): SetupHealthFinding {
  return makeSetupHealthFinding({
    check: SetupHealthCheck.MonitorPagesNobody,
    level: SetupHealthLevel.WorthFixing,
    subject: SetupHealthEventKind.Incident,
    record: {
      kind: SetupHealthRecordKind.Monitor,
      id: `68126666-1111-4000-8000-${index.toString().padStart(12, "0")}`,
      name: `Monitor ${index}`,
    },
    fix: SetupHealthFix.IncidentOnCallRules,
    words: SETUP_HEALTH_WORDS.monitorPagesNobody.incident,
    values: { monitor: `Monitor ${index}` },
  });
}

function answer(
  findings: Array<SetupHealthFinding>,
  overrides: Partial<SetupHealthAnswer> = {},
): SetupHealthAnswer {
  return {
    findings: findings,
    dismissed: [],
    counts: getSetupHealthCounts(findings),
    monitorCount: 40,
    checkedAt: "2026-11-12T12:00:00.000Z",
    ...overrides,
  };
}

async function run(
  data: SetupHealthAnswer,
  args: JSONObject = {},
): Promise<{ result: ToolExecutionResult; parsed: JSONObject }> {
  jest
    .spyOn(SetupHealthService, "getForCaller")
    .mockResolvedValue(data as never);

  const result: ToolExecutionResult = await GetSetupHealthTool.execute(
    args,
    ctx,
  );

  return { result: result, parsed: JSON.parse(result.dataForLlm) };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("get_setup_health", () => {
  test("reads the findings as the person asking may see them, for the project they asked in", async () => {
    const getForCaller: SpyInstance<typeof SetupHealthService.getForCaller> =
      jest
        .spyOn(SetupHealthService, "getForCaller")
        .mockResolvedValue(answer([finding(1)]) as never);

    await GetSetupHealthTool.execute({}, ctx);

    expect(getForCaller).toHaveBeenCalledWith({
      projectId: PROJECT,
      props: ctx.props,
    });
  });

  test("says each finding in a sentence, worst first, with where it is fixed, and the counts", async () => {
    const { result, parsed } = await run(answer([finding(1)]));

    expect(parsed["counts"]).toEqual({
      pagesWillNotArrive: 0,
      worthFixing: 1,
      suggestion: 0,
      dismissed: 0,
    });
    expect(parsed["monitorsChecked"]).toBe(40);
    expect(parsed["findings"]).toEqual([
      {
        level: SetupHealthLevel.WorthFixing,
        check: SetupHealthCheck.MonitorPagesNobody,
        finding:
          "Nobody is paged when Monitor 1 goes down: no on-call rule matches its incidents.",
        fixedOn: "Incidents > Rules > On-Call Rules",
      },
    ]);
    expect(result.rowCount).toBe(1);
    expect(result.isTruncated).toBe(false);
  });

  test("cites the Setup Health page, which the Dashboard's page catalog has", async () => {
    const { result } = await run(answer([finding(1)]));

    expect(result.citationLabel).toBe("Setup Health");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DashboardPage,
      params: { path: SETUP_HEALTH_DASHBOARD_PATH, title: "Setup Health" },
    });
    expect(
      (DashboardPages as Array<{ path: string; title: string }>).find(
        (page: { path: string }): boolean => {
          return page.path === SETUP_HEALTH_DASHBOARD_PATH;
        },
      )?.title,
    ).toBe("Setup Health");
  });

  test("nothing to fix is said plainly", async () => {
    const { result, parsed } = await run(answer([]));

    expect(parsed["summary"]).toBe("Nothing to fix: no finding of any level.");
    expect(parsed["findings"]).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  test("the dismissed ones only when asked, with their reasons", async () => {
    const dismissed: SetupHealthAnswer["dismissed"] = [
      {
        finding: finding(2),
        dismissal: {
          id: "68126666-0000-4000-8000-0000000000d1",
          recommendationId: "monitor_pages_nobody:incident",
          resourceType: SetupHealthRecordKind.Monitor,
          resourceId: finding(2).record.id,
          reason: "Staging, on purpose",
          dismissedByName: "Ana Lopez",
          dismissedAt: null,
        },
      },
    ];

    const without: { parsed: JSONObject } = await run(
      answer([finding(1)], { dismissed: dismissed }),
    );

    expect(without.parsed["dismissed"]).toBeUndefined();
    expect((without.parsed["counts"] as JSONObject)["dismissed"]).toBe(1);

    jest.restoreAllMocks();

    const withDismissed: { parsed: JSONObject } = await run(
      answer([finding(1)], { dismissed: dismissed }),
      { includeDismissed: true },
    );

    expect(withDismissed.parsed["dismissed"]).toEqual([
      {
        level: SetupHealthLevel.WorthFixing,
        check: SetupHealthCheck.MonitorPagesNobody,
        finding:
          "Nobody is paged when Monitor 2 goes down: no on-call rule matches its incidents.",
        fixedOn: "Incidents > Rules > On-Call Rules",
        dismissedBecause: "Staging, on purpose",
      },
    ]);
  });

  test("a long list is cut short, and says so", async () => {
    const many: Array<SetupHealthFinding> = [];

    for (
      let index: number = 0;
      index < MAX_SETUP_HEALTH_FINDINGS_FOR_LLM + 5;
      index++
    ) {
      many.push(finding(index));
    }

    const { result, parsed } = await run(answer(many));

    expect(parsed["findings"]).toHaveLength(MAX_SETUP_HEALTH_FINDINGS_FOR_LLM);
    expect(result.isTruncated).toBe(true);
    expect(result.rowCount).toBe(MAX_SETUP_HEALTH_FINDINGS_FOR_LLM + 5);
    expect((parsed["counts"] as JSONObject)["worthFixing"]).toBe(
      MAX_SETUP_HEALTH_FINDINGS_FOR_LLM + 5,
    );
  });

  test("every fix has a page the model can name", () => {
    for (const fix of Object.values(SetupHealthFix)) {
      expect(SETUP_HEALTH_FIX_PAGES[fix].length).toBeGreaterThan(5);
    }
  });

  test("is on Ask AI's belt, reads only, for everyone in the project", () => {
    const tool: ReturnType<typeof AIToolbox.getToolByName> =
      AIToolbox.getToolByName(GET_SETUP_HEALTH_TOOL_NAME);

    expect(tool).toBe(GetSetupHealthTool);
    expect(AIToolbox.isMutationTool(GET_SETUP_HEALTH_TOOL_NAME)).toBe(false);
    expect(GetSetupHealthTool.requiredPermissions).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
      ]),
    );
  });
});
