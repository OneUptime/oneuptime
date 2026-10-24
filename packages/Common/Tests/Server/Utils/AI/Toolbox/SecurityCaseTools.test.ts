import IncidentService from "../../../../../Server/Services/IncidentService";
import SecurityCaseNoteService from "../../../../../Server/Services/SecurityCaseNoteService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../../Server/Services/SecurityDetectionService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityPlaybookRunService from "../../../../../Server/Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../../../../Server/Services/SecurityPlaybookService";
import ThreatIntelIndicatorService from "../../../../../Server/Services/ThreatIntelIndicatorService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  AddSecurityCaseNoteTool,
  DEFAULT_ACTIVITY_HOURS,
  LookupThreatIntelTool,
  MAX_ACTIVITY_HOURS,
  MAX_LOOKUP_VALUES,
  QuerySecurityCasesTool,
  QuerySecurityPlaybooksTool,
  RunSecurityPlaybookTool,
  SecurityEntityActivityTool,
  describePlaybookSteps,
  readLookupValues,
} from "../../../../../Server/Utils/AI/Toolbox/SecurityCaseTools";
import {
  ObservabilityTool,
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { securityCaseGroupingKey } from "../../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseNote from "../../../../../Models/DatabaseModels/SecurityCaseNote";
import SecurityDetection from "../../../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybook from "../../../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../../../Models/DatabaseModels/SecurityPlaybookRun";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../../../Types/Date";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import SecurityCaseAiVerdict from "../../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import SecurityCasePriorityLevel from "../../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStatus from "../../../../../Models/DatabaseModels/SecurityCaseStatus";
import {
  TEST_STATUS_IDS,
  buildDefaultTestStatuses,
  buildTestStatus,
  testPriorityId,
  testStatusId,
} from "../../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../../Helpers/SecurityCaseValuesStub";
import { SecurityPlaybookActionType } from "../../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The security case tools: how OneUptime AI reads a case and what is
 * around it - in a triage and in Ask AI - and, in a conversation and with
 * the person's approval, adds a note or starts a playbook. Every read runs
 * with the caller's props inside the project; results keep the observables
 * security work is about and redact secrets; the writes are mutations the
 * conversation asks before, made as the person.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const otherProjectId: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const caseId: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const playbookId: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const userId: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

function context(
  allowed: Array<Permission> = [Permission.SecurityMember],
): ToolContext {
  return {
    projectId,
    props: {
      tenantId: projectId,
      userId,
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public],
        projectIds: [projectId],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [projectId.toString()]: {
          projectId,
          permissions: allowed.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            };
          }),
          _type: "UserTenantAccessPermission",
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
}

function callArg(spy: jest.SpyInstance, index: number = 0): JSONObject {
  return spy.mock.calls[index]![0] as JSONObject;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  // The project's priorities and statuses: a new project's.
  stubSecurityCaseValues();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_security_cases", () => {
  test("one case: the case and its detections, read as the caller, and where it lives", async () => {
    const ctx: ToolContext = context();
    const findCase: jest.SpyInstance = jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockResolvedValue({
        id: caseId,
        caseNumberWithPrefix: "CASE-42",
        title: "Brute force from 203.0.113.9",
        securityCaseStatusId: testStatusId(SecurityCaseStage.New),
        securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.High),
        entities: [
          { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
        ],
        detectionCount: 2,
        aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
        description: "password=supersecretvalue1234",
      } as unknown as SecurityCase);
    const findDetections: jest.SpyInstance = jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockResolvedValue([
        {
          title: "SSH brute force",
          sampleMessage:
            "Failed password for alice@example.com from 203.0.113.9",
        } as unknown as SecurityDetection,
      ]);

    const result: ToolExecutionResult = await QuerySecurityCasesTool.execute(
      { securityCaseId: caseId.toString() },
      ctx,
    );

    expect(callArg(findCase)["props"]).toBe(ctx.props);
    expect(callArg(findCase)["query"]).toEqual({
      _id: caseId,
      projectId,
    });
    expect(callArg(findDetections)["props"]).toBe(ctx.props);
    expect(result.dataForLlm).toContain("Brute force from 203.0.113.9");
    // The observables stay; the secret does not.
    expect(result.dataForLlm).toContain("alice@example.com");
    expect(result.dataForLlm).not.toContain("supersecretvalue1234");
    expect(result.dataForLlm).toContain("Likely Malicious");
    // Its status and priority as the project names them.
    expect(result.dataForLlm).toContain("New");
    expect(result.dataForLlm).toContain("High");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.SecurityCaseView,
      params: { securityCaseId: caseId.toString() },
    });
    expect(result.rowCount).toBe(2);
    // What Evidence checked lists it as, in words a person reads.
    expect(result.citationLabel).toBe(
      "Security case CASE-42 Brute force from 203.0.113.9 (1 detection)",
    );
  });

  test("a case the caller cannot read is not found", async () => {
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue(null);

    await expect(
      QuerySecurityCasesTool.execute(
        { securityCaseId: caseId.toString() },
        context(),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("the declared incident is named only when the caller may read it", async () => {
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
      id: caseId,
      incidentId: new ObjectID("55555555-5555-4555-8555-555555555555"),
    } as unknown as SecurityCase);
    jest.spyOn(SecurityDetectionService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockRejectedValue(new Error("not allowed"));

    const result: ToolExecutionResult = await QuerySecurityCasesTool.execute(
      { securityCaseId: caseId.toString() },
      context(),
    );

    expect(result.dataForLlm).not.toContain("INC-");

    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      incidentNumberWithPrefix: "INC-7",
      title: "Checkout down",
    } as unknown as Incident);

    const named: ToolExecutionResult = await QuerySecurityCasesTool.execute(
      { securityCaseId: caseId.toString() },
      context(),
    );

    expect(named.dataForLlm).toContain("INC-7 Checkout down");
  });

  test("a list: open cases by default, newest first, at most the limit", async () => {
    const ctx: ToolContext = context();
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityCaseService, "findBy")
      .mockResolvedValue([]);

    await QuerySecurityCasesTool.execute({ limit: 500 }, ctx);

    const call: JSONObject = callArg(findBy);
    const query: JSONObject = call["query"] as JSONObject;

    expect(call["props"]).toBe(ctx.props);
    expect(call["limit"]).toBe(25);
    expect(query["projectId"]).toBe(projectId);
    // Open by what the project's statuses count as, by id.
    expect((query["securityCaseStatusId"] as Includes).values).toEqual([
      TEST_STATUS_IDS[SecurityCaseStage.New],
      TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      TEST_STATUS_IDS[SecurityCaseStage.Contained],
    ]);
  });

  test("closed, all, and the cases about one entity", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityCaseService, "findBy")
      .mockResolvedValue([]);

    await QuerySecurityCasesTool.execute({ status: "closed" }, context());
    await QuerySecurityCasesTool.execute(
      { status: "all", entity: "203.0.113.9" },
      context(),
    );

    expect(
      (
        (callArg(findBy, 0)["query"] as JSONObject)[
          "securityCaseStatusId"
        ] as unknown as Includes
      ).values,
    ).toEqual([TEST_STATUS_IDS[SecurityCaseStage.Closed]]);

    const all: JSONObject = callArg(findBy, 1)["query"] as JSONObject;

    expect(all["securityCaseStatusId"]).toBeUndefined();
    expect(all["groupingKey"]).toBe(
      securityCaseGroupingKey({ groupValue: "203.0.113.9", fingerprint: "" }),
    );
  });

  test("closed is every status that closes a case, the project's own after Closed among them", async () => {
    const duplicateId: string = "c2000000-0000-4000-8000-0000000000a3";
    const statuses: Array<SecurityCaseStatus> = [
      ...buildDefaultTestStatuses(),
      buildTestStatus({ id: duplicateId, name: "Closed - Duplicate", order: 5 }),
    ];
    stubSecurityCaseValues({ statuses });
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityCaseService, "findBy")
      .mockResolvedValue([]);

    await QuerySecurityCasesTool.execute({ status: "closed" }, context());

    expect(
      (
        (callArg(findBy)["query"] as JSONObject)[
          "securityCaseStatusId"
        ] as unknown as Includes
      ).values,
    ).toEqual([TEST_STATUS_IDS[SecurityCaseStage.Closed], duplicateId]);
  });

  test("arguments never move the read to another project", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityCaseService, "findBy")
      .mockResolvedValue([]);

    await QuerySecurityCasesTool.execute(
      { projectId: otherProjectId.toString() },
      context(),
    );

    expect(JSON.stringify(callArg(findBy))).not.toContain(
      otherProjectId.toString(),
    );
  });
});

describe("lookup_threat_intel", () => {
  test("each value: the most confident active indicator, or no match", async () => {
    const lookup: jest.SpyInstance = jest
      .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
      .mockResolvedValue([
        {
          indicatorValue: "203.0.113.9",
          feedId: "f1",
          feedName: "Low Feed",
          stixId: "i1",
          indicatorType: "ipv4-addr",
          indicatorName: "Scanner",
          confidence: 20,
        },
        {
          indicatorValue: "203.0.113.9",
          feedId: "f2",
          feedName: "Feodo Tracker",
          stixId: "i2",
          indicatorType: "ipv4-addr",
          indicatorName: "Emotet C2",
          confidence: 90,
        },
      ]);

    const result: ToolExecutionResult = await LookupThreatIntelTool.execute(
      { values: [" 203.0.113.9 ", "evil.example", "203.0.113.9"] },
      context(),
    );

    expect(callArg(lookup)).toEqual({
      projectId,
      values: ["203.0.113.9", "evil.example"],
      now: NOW,
    });
    expect(result.dataForLlm).toContain("Feodo Tracker");
    expect(result.dataForLlm).toContain("Emotet C2");
    expect(result.dataForLlm).not.toContain("Low Feed");
    expect(result.dataForLlm).toContain("evil.example");
    expect(result.dataForLlm).toContain("no match");
    expect(result.rowCount).toBe(1);
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.ThreatIntel,
    });
    expect(result.citationLabel).toBe(
      "Threat intel lookup of 2 values: 1 known-bad",
    );
  });

  test("nothing to look up is an error the model can fix", async () => {
    await expect(
      LookupThreatIntelTool.execute({ values: ["  "] }, context()),
    ).rejects.toThrow("values is required");
  });

  test("values: trimmed, lower case, each once, at most the limit", () => {
    const many: Array<string> = Array.from(
      { length: MAX_LOOKUP_VALUES + 10 },
      (_: unknown, index: number): string => {
        return `10.0.0.${index}`;
      },
    );

    expect(readLookupValues({ values: ["A.example", "a.example "] })).toEqual([
      "a.example",
    ]);
    expect(readLookupValues({ value: "Single.Example" })).toEqual([
      "single.example",
    ]);
    expect(readLookupValues({ values: many })).toHaveLength(MAX_LOOKUP_VALUES);
    expect(readLookupValues({ values: ["x".repeat(3000)] })).toEqual([]);
  });
});

describe("security_entity_activity", () => {
  test("each value over the window: events, findings, worst severity, first and last seen", async () => {
    const activity: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findObservableActivity")
      .mockResolvedValue([
        {
          value: "deploy",
          eventCount: 120,
          findingCount: 3,
          maxSeverityId: 4,
          firstSeen: new Date("2026-10-14T11:50:00.000Z"),
          lastSeen: new Date("2026-10-14T11:59:00.000Z"),
        },
      ]);

    const result: ToolExecutionResult =
      await SecurityEntityActivityTool.execute(
        { values: ["deploy", "web-1"], hours: 5000 },
        context(),
      );

    const call: JSONObject = callArg(activity);

    expect(call["projectId"]).toBe(projectId);
    expect(call["values"]).toEqual(["deploy", "web-1"]);
    // The window is capped.
    expect(
      (call["endTime"] as Date).getTime() -
        (call["startTime"] as Date).getTime(),
    ).toBe(MAX_ACTIVITY_HOURS * 3600 * 1000);
    expect(result.dataForLlm).toContain("deploy");
    expect(result.dataForLlm).toContain("not seen in window");
    expect(result.rowCount).toBe(1);
    expect(result.citationLabel).toBe(
      `Security activity of 2 values over ${MAX_ACTIVITY_HOURS} hours`,
    );
  });

  test("a week back by default", async () => {
    const activity: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findObservableActivity")
      .mockResolvedValue([]);

    const result: ToolExecutionResult =
      await SecurityEntityActivityTool.execute(
        { values: ["deploy"] },
        context(),
      );

    const call: JSONObject = callArg(activity);

    // One value, counted as one.
    expect(result.citationLabel).toBe(
      `Security activity of 1 value over ${DEFAULT_ACTIVITY_HOURS} hours`,
    );

    expect(
      (call["endTime"] as Date).getTime() -
        (call["startTime"] as Date).getTime(),
    ).toBe(DEFAULT_ACTIVITY_HOURS * 3600 * 1000);
  });
});

describe("query_security_playbooks", () => {
  test("the playbooks that are on, each with its steps and which wait for approval", async () => {
    const ctx: ToolContext = context();
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityPlaybookService, "findBy")
      .mockResolvedValue([
        {
          id: playbookId,
          name: "Contain Host",
          trigger: "Manual",
          steps: [
            {
              id: "s1",
              action: SecurityPlaybookActionType.CheckThreatIntel,
              config: {},
              requiresApproval: false,
              continueOnFailure: false,
              onlyIfThreatIntelMatched: false,
            },
            {
              id: "s2",
              action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
              config: { connectionId: "66666666-6666-4666-8666-666666666666" },
              requiresApproval: true,
              continueOnFailure: false,
              onlyIfThreatIntelMatched: true,
            },
          ],
        } as unknown as SecurityPlaybook,
      ]);

    const result: ToolExecutionResult =
      await QuerySecurityPlaybooksTool.execute({}, ctx);

    expect(callArg(findBy)["props"]).toBe(ctx.props);
    expect(callArg(findBy)["query"]).toEqual({ projectId, isEnabled: true });
    expect(result.dataForLlm).toContain(playbookId.toString());
    expect(result.dataForLlm).toContain(
      "Check entities against threat intel, then Contain the host in CrowdStrike (needs approval)",
    );
  });

  test("steps that cannot be read say so instead of failing every playbook", () => {
    expect(describePlaybookSteps("not json")).toBe(
      "(its steps could not be read)",
    );
    expect(describePlaybookSteps(undefined)).toBe("");
  });
});

describe("add_security_case_note (a write)", () => {
  test("a mutation: the conversation asks before it runs", () => {
    expect(AddSecurityCaseNoteTool.isMutation).toBe(true);
    expect(RunSecurityPlaybookTool.isMutation).toBe(true);
    expect(AIToolbox.isMutationTool("add_security_case_note")).toBe(true);
    expect(AIToolbox.isMutationTool("run_security_playbook")).toBe(true);
    for (const name of [
      "query_security_cases",
      "lookup_threat_intel",
      "security_entity_activity",
      "query_security_playbooks",
    ]) {
      expect(AIToolbox.isMutationTool(name)).toBe(false);
    }
  });

  test("written as the person, on a case they may read, the model's text kept from acting", async () => {
    const ctx: ToolContext = context();
    const findCase: jest.SpyInstance = jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockResolvedValue({
        id: caseId,
        caseNumberWithPrefix: "CASE-42",
        title: "Brute force",
      } as unknown as SecurityCase);
    const create: jest.SpyInstance = jest
      .spyOn(SecurityCaseNoteService, "create")
      .mockImplementation(async (args: unknown): Promise<SecurityCaseNote> => {
        return (args as { data: SecurityCaseNote }).data;
      });

    const result: ToolExecutionResult = await AddSecurityCaseNoteTool.execute(
      {
        securityCaseId: caseId.toString(),
        note: "Checked: <img src=x onerror=alert(1)> the address is known-bad.",
      },
      ctx,
    );

    expect(callArg(findCase)["props"]).toBe(ctx.props);

    const created: { data: SecurityCaseNote; props: unknown } = callArg(
      create,
    ) as unknown as { data: SecurityCaseNote; props: unknown };

    expect(created.props).toBe(ctx.props);
    expect(created.data.projectId).toBe(projectId);
    expect(created.data.createdByUserId).toBe(userId);
    expect(created.data.note).not.toContain("<img");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.SecurityCaseView,
      params: { securityCaseId: caseId.toString() },
    });
  });

  test("never on a case the person cannot read, and never without a person", async () => {
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest.spyOn(
      SecurityCaseNoteService,
      "create",
    );

    await expect(
      AddSecurityCaseNoteTool.execute(
        { securityCaseId: caseId.toString(), note: "x" },
        context(),
      ),
    ).rejects.toThrow("Security case not found");

    const noPerson: ToolContext = context();
    noPerson.props = { ...noPerson.props, userId: undefined };

    await expect(
      AddSecurityCaseNoteTool.execute(
        { securityCaseId: caseId.toString(), note: "x" },
        noPerson,
      ),
    ).rejects.toThrow("No signed-in person");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("run_security_playbook (a write)", () => {
  test("starts an enabled playbook on the case, as the person; its containment still waits for approval", async () => {
    const ctx: ToolContext = context();
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
      id: caseId,
      caseNumberWithPrefix: "CASE-42",
      title: "Brute force",
    } as unknown as SecurityCase);
    const findPlaybook: jest.SpyInstance = jest
      .spyOn(SecurityPlaybookService, "findOneBy")
      .mockResolvedValue({
        id: playbookId,
        name: "Contain Host",
        steps: [
          {
            id: "s1",
            action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
            config: { connectionId: "66666666-6666-4666-8666-666666666666" },
            requiresApproval: true,
            continueOnFailure: false,
            onlyIfThreatIntelMatched: false,
          },
        ],
      } as unknown as SecurityPlaybook);
    const create: jest.SpyInstance = jest
      .spyOn(SecurityPlaybookRunService, "create")
      .mockImplementation(
        async (args: unknown): Promise<SecurityPlaybookRun> => {
          return (args as { data: SecurityPlaybookRun }).data;
        },
      );

    const result: ToolExecutionResult = await RunSecurityPlaybookTool.execute(
      {
        securityCaseId: caseId.toString(),
        securityPlaybookId: playbookId.toString(),
      },
      ctx,
    );

    expect(callArg(findPlaybook)["query"]).toEqual({
      _id: playbookId,
      projectId,
      isEnabled: true,
    });
    expect(callArg(findPlaybook)["props"]).toBe(ctx.props);

    const created: { data: SecurityPlaybookRun; props: unknown } = callArg(
      create,
    ) as unknown as { data: SecurityPlaybookRun; props: unknown };

    // As the person: the service stamps who started it and its trigger (Manual).
    expect(created.props).toBe(ctx.props);
    expect(created.data.securityCaseId?.toString()).toBe(caseId.toString());
    expect(created.data.securityPlaybookId?.toString()).toBe(
      playbookId.toString(),
    );
    expect(created.data.trigger).toBeUndefined();
    expect(result.dataForLlm).toContain("(needs approval)");
    expect(result.dataForLlm).toContain("waits on the case for a person");
  });

  test("a playbook that is off, or not the person's to read, is not started", async () => {
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
      id: caseId,
    } as unknown as SecurityCase);
    jest.spyOn(SecurityPlaybookService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest.spyOn(
      SecurityPlaybookRunService,
      "create",
    );

    await expect(
      RunSecurityPlaybookTool.execute(
        {
          securityCaseId: caseId.toString(),
          securityPlaybookId: playbookId.toString(),
        },
        context(),
      ),
    ).rejects.toThrow("Playbook not found, turned off");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("who may call them", () => {
  const reads: Array<ObservabilityTool> = [
    QuerySecurityCasesTool,
    LookupThreatIntelTool,
    SecurityEntityActivityTool,
    QuerySecurityPlaybooksTool,
  ];

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
  ])("%s may read", (permission: Permission) => {
    for (const tool of reads) {
      expect(AIToolbox.hasPermissionForTool(tool, context([permission]))).toBe(
        true,
      );
    }
  });

  test.each([Permission.TelemetryAdmin, Permission.ProjectMember])(
    "%s may not read security data",
    (permission: Permission) => {
      for (const tool of reads) {
        expect(
          AIToolbox.hasPermissionForTool(tool, context([permission])),
        ).toBe(false);
      }
    },
  );

  test("a Security Viewer may read but not add notes or start playbooks", () => {
    const viewer: ToolContext = context([Permission.SecurityViewer]);

    expect(
      AIToolbox.hasPermissionForTool(AddSecurityCaseNoteTool, viewer),
    ).toBe(false);
    expect(
      AIToolbox.hasPermissionForTool(RunSecurityPlaybookTool, viewer),
    ).toBe(false);
  });

  test("a call from another project or a multi-tenant request runs nothing", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityCaseService, "findBy")
      .mockResolvedValue([]);
    const ctx: ToolContext = context();

    const outcomes: Array<ToolCallOutcome> = [
      await AIToolbox.executeTool({
        name: "query_security_cases",
        args: {},
        ctx: { ...ctx, projectId: otherProjectId },
      }),
      await AIToolbox.executeTool({
        name: "query_security_cases",
        args: {},
        ctx: { ...ctx, props: { ...ctx.props, isMultiTenantRequest: true } },
      }),
    ];

    for (const outcome of outcomes) {
      expect(outcome.success).toBe(false);
    }
    expect(findBy).not.toHaveBeenCalled();
  });
});
