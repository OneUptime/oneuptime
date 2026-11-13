import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  WhoIsToldTool,
  describeWhoIsToldForModel,
} from "../../../../../Server/Utils/AI/Toolbox/WhoIsToldTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import MonitorService from "../../../../../Server/Services/MonitorService";
import WhoIsToldService from "../../../../../Server/Services/WhoIsToldService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import AIChatPermissionMode from "../../../../../Types/AI/AIChatPermissionMode";
import {
  WhoIsToldBreakKind,
  WhoIsToldFix,
  WhoIsToldOwnersSource,
  WhoIsToldPersonProblem,
  WhoIsToldResult,
} from "../../../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "../../../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * "WHO IS TOLD WHEN EXAMPLE.COM GOES DOWN?" (issues #6829 and #6810).
 *
 * After Ask AI set a monitor up, it answers that from the resolver the
 * monitor's own page draws ("When this goes down"), as the person may see
 * it: every criteria, what it opens, who it emails and pages and by what,
 * and each break in the resolver's own words. Never a guess.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_ID: string = "55555555-5555-4555-8555-555555555555";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
};

type Spy = jest.SpyInstance;

afterEach(() => {
  jest.restoreAllMocks();
});

const RESULT: WhoIsToldResult = {
  monitorId: MONITOR_ID,
  monitorName: "example.com",
  checkedAt: "2026-11-12T10:00:00.000Z",
  criteria: [
    {
      id: "c1",
      name: "Check if offline",
      statusName: "Offline",
      statusOwners: {
        source: WhoIsToldOwnersSource.MonitorOwners,
        userNames: ["Me Myself"],
        teamNames: [],
      },
      events: [
        {
          kind: OnCallTestPageRecordKind.Incident,
          title: "example.com is offline",
          severityName: "Critical Incident",
          owners: {
            source: WhoIsToldOwnersSource.ProjectOwners,
            userNames: [],
            teamNames: [],
          },
          ownerRules: [],
          rules: [{ id: "r1", name: "Page Default for every new incident" }],
          policies: [
            {
              id: "p1",
              name: "Default on-call policy",
              isHidden: false,
              isNamedByCriteria: false,
              ruleIds: ["r1"],
              levelCount: 1,
              people: [
                {
                  userId: "u1",
                  name: "Me Myself",
                  channels: [OnCallPageChannel.Email, OnCallPageChannel.SMS],
                  isFallback: true,
                  isReachable: true,
                },
                {
                  userId: "u2",
                  name: "Ana Lopez",
                  reachedThrough: "Team Platform",
                  channels: [],
                  isFallback: false,
                  isReachable: false,
                  problem: WhoIsToldPersonProblem.NoVerifiedMethod,
                },
              ],
              notPaged: [],
            },
          ],
          statusPages: [{ id: "s1", name: "Acme Status" }],
        },
      ],
    },
  ],
  channels: {
    isBillingEnabled: false,
    isSmsOn: true,
    isCallOn: true,
    isWhatsAppOn: false,
    isTelegramOn: false,
    hasOwnTwilioForSms: false,
    hasOwnTwilioForCalls: false,
    serverCanSendEmail: true,
    serverCanSendSms: true,
    serverCanCall: true,
  },
  breaks: [
    {
      kind: WhoIsToldBreakKind.PersonUnreachable,
      message:
        "Ana Lopez can't be reached by this page: no method of theirs is verified.",
      fix: WhoIsToldFix.OnCallReadiness,
    },
  ],
};

describe("describeWhoIsToldForModel", () => {
  test("says the chain as the resolver read it: criteria, what opens, who is emailed and paged and by what, and the breaks", () => {
    const text: string = describeWhoIsToldForModel(RESULT);

    expect(text).toContain(
      'Who is told when monitor "example.com" goes down (checked 2026-11-12T10:00:00.000Z):',
    );
    expect(text).toContain(
      '- Criteria "Check if offline": sets status Offline; emails the monitor\'s owners (Me Myself) of the change',
    );
    expect(text).toContain(
      "  - opens an incident (Critical Incident); emails the project's owners",
    );
    expect(text).toContain(
      '    - pages on-call policy "Default on-call policy" (1 escalation level), whose first level pages: Me Myself: by email, SMS (their verified methods, as no rule of theirs covers this severity); Ana Lopez (Team Platform): cannot be reached by this page (NoVerifiedMethod)',
    );
    expect(text).toContain('    - shows on status pages: "Acme Status"');
    expect(text).toContain(
      "Where the chain breaks:\n- Ana Lopez can't be reached by this page: no method of theirs is verified.",
    );
  });

  test("an alert that pages nobody, a hidden policy, and a chain with no break are said as such", () => {
    const text: string = describeWhoIsToldForModel({
      ...RESULT,
      criteria: [
        {
          id: "c2",
          name: "Slow",
          events: [
            {
              kind: OnCallTestPageRecordKind.Alert,
              title: "example.com is slow",
              severityName: "High",
              owners: {
                source: WhoIsToldOwnersSource.Named,
                userNames: [],
                teamNames: ["Platform"],
              },
              ownerRules: [],
              rules: [],
              policies: [],
              statusPages: [],
            },
            {
              kind: OnCallTestPageRecordKind.Incident,
              title: "example.com is slow",
              severityName: "Low",
              owners: {
                source: WhoIsToldOwnersSource.OwnerRules,
                userNames: ["Dana Reyes"],
                teamNames: [],
              },
              ownerRules: [{ id: "o1", name: "Slow sites to Dana" }],
              rules: [],
              policies: [
                {
                  id: "p2",
                  name: "",
                  isHidden: true,
                  isNamedByCriteria: true,
                  ruleIds: [],
                  levelCount: 0,
                  people: [],
                  notPaged: [],
                },
              ],
              statusPages: [],
            },
          ],
        },
      ],
      breaks: [],
    });

    expect(text).toContain("  - opens an alert (High); emails team Platform");
    expect(text).toContain(
      "    - pages nobody: no on-call rule runs a policy for it",
    );
    expect(text).toContain(
      "  - opens an incident (Low); emails the owners added by owner rules (Dana Reyes)",
    );
    expect(text).toContain(
      "an on-call policy the person may not read (paging is set up, and who is hidden)",
    );
    expect(text).toContain("Nothing breaks the chain.");
  });

  test("a monitor whose criteria do nothing says so", () => {
    expect(
      describeWhoIsToldForModel({ ...RESULT, criteria: [], breaks: [] }),
    ).toContain("- No criteria changes its status or opens anything.");
  });
});

describe("who_is_told", () => {
  test("is a read the toolbox offers in every mode, Read-only included", () => {
    expect(WhoIsToldTool.isMutation).toBeFalsy();
    expect(AIToolbox.getToolByName("who_is_told")).toBe(WhoIsToldTool);

    const readOnlyNames: Array<string> = AIToolbox.getLlmToolDefinitions(
      AIChatPermissionMode.ReadOnly,
    ).map((definition: { name: string }) => {
      return definition.name;
    });
    expect(readOnlyNames).toContain("who_is_told");
  });

  test("finds the monitor by its name or address, as the person, and answers from the resolver as they may see it", async () => {
    const find: Spy = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        Object.assign(new Monitor(), { _id: MONITOR_ID, name: "example.com" }),
      ] as never);
    const resolve: Spy = jest
      .spyOn(WhoIsToldService, "getForMonitor")
      .mockResolvedValue(RESULT as never);

    const result: ToolExecutionResult = await WhoIsToldTool.execute(
      { monitor: "https://example.com" },
      ctx,
    );

    expect((find.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
    const asked: {
      projectId: ObjectID;
      monitorId: ObjectID;
      props: unknown;
    } = resolve.mock.calls[0]![0] as {
      projectId: ObjectID;
      monitorId: ObjectID;
      props: unknown;
    };
    expect(asked.props).toBe(ctx.props);
    expect(asked.projectId).toBe(PROJECT_ID);
    expect(asked.monitorId.toString()).toBe(MONITOR_ID);

    expect(result.dataForLlm).toContain(
      'Who is told when monitor "example.com" goes down',
    );
    expect(result.citationLabel).toBe(
      'Who is told when "example.com" goes down',
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.MonitorView,
      params: { monitorId: MONITOR_ID },
    });
  });

  test("finds a monitor by its id", async () => {
    const findOne: Spy = jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue(
        Object.assign(new Monitor(), {
          _id: MONITOR_ID,
          name: "example.com",
        }) as never,
      );
    jest
      .spyOn(WhoIsToldService, "getForMonitor")
      .mockResolvedValue(RESULT as never);

    await WhoIsToldTool.execute({ monitor: MONITOR_ID }, ctx);

    const asked: { query: { _id: string; projectId: ObjectID } } = findOne.mock
      .calls[0]![0] as { query: { _id: string; projectId: ObjectID } };
    expect(asked.query._id).toBe(MONITOR_ID);
    expect(asked.query.projectId).toBe(PROJECT_ID);
  });

  test("a monitor the project does not have is said, never guessed", async () => {
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([] as never);
    const resolve: Spy = jest.spyOn(WhoIsToldService, "getForMonitor");

    await expect(
      WhoIsToldTool.execute({ monitor: "nothing.example" }, ctx),
    ).rejects.toThrow('No monitor named "nothing.example" in this project.');
    await expect(WhoIsToldTool.execute({}, ctx)).rejects.toThrow(
      "No monitor named",
    );
    expect(resolve).not.toHaveBeenCalled();
  });
});
