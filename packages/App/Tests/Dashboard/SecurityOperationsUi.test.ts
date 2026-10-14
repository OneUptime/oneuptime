import { describe, expect, test } from "@jest/globals";
import { SecurityCaseFeedEventType } from "Common/Models/DatabaseModels/SecurityCaseFeed";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityCasePriority from "Common/Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus, {
  OPEN_SECURITY_CASE_STATUSES,
} from "Common/Types/SecurityCase/SecurityCaseStatus";
import SecurityCaseVerdict from "Common/Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityEntityType,
  readSecurityEntities,
} from "Common/Types/SecurityCase/SecurityEntity";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import SecurityPlaybookTrigger from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { FeedTone } from "Common/UI/Components/Feed/FeedEntryKind";
import { getSecurityCaseFeedKind } from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseFeedKind";
import {
  SECURITY_CASE_QUEUE_VIEWS,
  SecurityCaseQueueView,
  getSecurityCaseQueueQuery,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";
import { SECURITY_CASE_DISPLAY_TERMS } from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseTerms";
import { getMitreAttackUrl } from "../../FeatureSet/Dashboard/src/Components/SecurityCase/MitreAttackLinks";
import {
  parseEntityActivity,
  parseOverview,
  parseTopEntities,
  readDate,
  readNumber,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApiTypes";
import {
  formatDayLabel,
  getLabelledDayIndexes,
} from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/DayLabels";
import { getRunStepRows } from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunStepRows";

/*
 * The pure parts of the case and playbook pages: the queue's views, the
 * timeline's look, the terms the pages translate, the ATT&CK links, the
 * overview's API reading, the chart's day labels and a run's step rows.
 */

describe("the case queue's views", () => {
  const ME: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

  test("are Open, Assigned to Me, Unassigned, Closed and All, in that order", () => {
    expect(
      SECURITY_CASE_QUEUE_VIEWS.map((view: SecurityCaseQueueView): string => {
        return view.key;
      }),
    ).toEqual(["open", "mine", "unassigned", "closed", "all"]);
  });

  test("Open asks for every status but Closed", () => {
    const query: JSONObject = getSecurityCaseQueueQuery(
      "open",
      ME,
    ) as unknown as JSONObject;
    const status: Includes = query["status"] as unknown as Includes;

    expect(status).toBeInstanceOf(Includes);
    expect(status.values).toEqual([...OPEN_SECURITY_CASE_STATUSES]);
    expect(status.values).not.toContain(SecurityCaseStatus.Closed);
  });

  test("Assigned to Me is the open cases of the person signed in", () => {
    const query: JSONObject = getSecurityCaseQueueQuery(
      "mine",
      ME,
    ) as unknown as JSONObject;

    expect(query["assignedToUserId"]).toEqual(ME);
    expect(query["status"]).toBeInstanceOf(Includes);
  });

  test("Assigned to Me with nobody signed in matches nobody's cases, not everybody's", () => {
    const query: JSONObject = getSecurityCaseQueueQuery(
      "mine",
      undefined,
    ) as unknown as JSONObject;

    expect(query["assignedToUserId"]).toEqual(ObjectID.getZeroObjectID());
  });

  test("Unassigned is the open cases with no one on them", () => {
    const query: JSONObject = getSecurityCaseQueueQuery(
      "unassigned",
      ME,
    ) as unknown as JSONObject;

    expect(query["assignedToUserId"]).toBeInstanceOf(IsNull);
    expect(query["status"]).toBeInstanceOf(Includes);
  });

  test("Closed asks for Closed, and All for nothing", () => {
    expect(getSecurityCaseQueueQuery("closed", ME)).toEqual({
      status: SecurityCaseStatus.Closed,
    });
    expect(getSecurityCaseQueueQuery("all", ME)).toEqual({});
  });

  test("every view says what it shows and what an empty one means", () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      expect(view.title.length).toBeGreaterThan(2);
      expect(view.description.endsWith(".")).toBe(true);
      expect(view.emptyMessage.endsWith(".")).toBe(true);
    }
  });
});

describe("the case timeline's entries", () => {
  test("every event type a case records has a look of its own", () => {
    for (const eventType of Object.values(SecurityCaseFeedEventType)) {
      expect([eventType, Boolean(getSecurityCaseFeedKind(eventType))]).toEqual([
        eventType,
        true,
      ]);
    }
  });

  test("a note reads as a note, an incident as danger, a status change in its own color", () => {
    expect(
      getSecurityCaseFeedKind(SecurityCaseFeedEventType.PrivateNote)?.isNote,
    ).toBe(true);
    expect(
      getSecurityCaseFeedKind(SecurityCaseFeedEventType.IncidentDeclared)?.tone,
    ).toBe(FeedTone.Danger);
    expect(
      getSecurityCaseFeedKind(SecurityCaseFeedEventType.StatusChanged)?.tone,
    ).toBe(FeedTone.Record);
    expect(
      getSecurityCaseFeedKind(SecurityCaseFeedEventType.ApprovalRequested)
        ?.tone,
    ).toBe(FeedTone.Warning);
  });

  test("an event type it does not know falls to the shared rules", () => {
    expect(getSecurityCaseFeedKind("SomethingNew")).toBeUndefined();
  });
});

describe("the terms the case pages translate", () => {
  test("every value a case, detection, entity or run shows is registered", () => {
    const values: Array<string> = [
      ...Object.values(SecurityCaseStatus),
      ...Object.values(SecurityCasePriority),
      ...Object.values(SecurityCaseVerdict),
      ...Object.values(SecurityDetectionSource),
      ...Object.values(SecurityEntityType),
      ...Object.values(SecurityPlaybookTrigger),
      ...Object.values(SecurityPlaybookRunStatus),
      ...Object.values(SecurityPlaybookStepStatus),
    ];

    for (const value of values) {
      expect([value, SECURITY_CASE_DISPLAY_TERMS.includes(value)]).toEqual([
        value,
        true,
      ]);
    }
  });

  test("lists each term once", () => {
    expect(new Set(SECURITY_CASE_DISPLAY_TERMS).size).toBe(
      SECURITY_CASE_DISPLAY_TERMS.length,
    );
  });
});

describe("getMitreAttackUrl", () => {
  test("links tactics, techniques and sub-techniques to attack.mitre.org", () => {
    expect(getMitreAttackUrl("TA0006")).toBe(
      "https://attack.mitre.org/tactics/TA0006/",
    );
    expect(getMitreAttackUrl("t1110")).toBe(
      "https://attack.mitre.org/techniques/T1110/",
    );
    expect(getMitreAttackUrl("T1110.003")).toBe(
      "https://attack.mitre.org/techniques/T1110/003/",
    );
  });

  test("never makes a link of anything else", () => {
    for (const value of [
      "",
      "javascript:alert(1)",
      "T11",
      "TA06",
      "T1110.03",
      "https://evil.example/T1110",
      "T1110/../../x",
    ]) {
      expect([value, getMitreAttackUrl(value)]).toEqual([value, null]);
    }
  });
});

describe("reading the Security API's answers", () => {
  test("numbers and dates read as nothing when they are not what they claim", () => {
    expect(readNumber(4)).toBe(4);
    expect(readNumber("4")).toBe(0);
    expect(readNumber(Number.NaN)).toBe(0);
    expect(readNumber(undefined)).toBe(0);
    expect(readDate("2026-10-14T10:00:00.000Z")?.toISOString()).toBe(
      "2026-10-14T10:00:00.000Z",
    );
    expect(readDate("not a date")).toBeNull();
    expect(readDate(12)).toBeNull();
  });

  test("entity activity keeps every row it can read and drops the rest", () => {
    const rows: ReturnType<typeof parseEntityActivity> = parseEntityActivity({
      activity: [
        {
          value: "alice@example.com",
          eventCount: 12,
          findingCount: 2,
          maxSeverityId: 4,
          firstSeen: "2026-10-13T10:00:00.000Z",
          lastSeen: "2026-10-14T10:00:00.000Z",
        },
        "not a row",
        null,
        { value: "web-01" },
      ] as unknown as JSONArray,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.eventCount).toBe(12);
    expect(rows[0]!.lastSeen?.toISOString()).toBe("2026-10-14T10:00:00.000Z");
    expect(rows[1]).toEqual({
      value: "web-01",
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      firstSeen: null,
      lastSeen: null,
    });
  });

  test("top entities read the same way, and a missing list is empty", () => {
    expect(parseTopEntities({})).toEqual([]);
    expect(
      parseTopEntities({
        entities: [
          {
            value: "10.0.0.5",
            findingCount: 9,
            ruleCount: 3,
            maxSeverityId: 5,
          },
        ],
      }),
    ).toEqual([
      {
        value: "10.0.0.5",
        findingCount: 9,
        ruleCount: 3,
        maxSeverityId: 5,
        lastSeen: null,
      },
    ]);
  });

  test("the overview's windows fall back to the server's defaults", () => {
    const overview: ReturnType<typeof parseOverview> = parseOverview({
      myOpenCases: 3,
      runsWaitingForApproval: 1,
      isTruncated: true,
      metrics: { openCases: 5 },
    });

    expect(overview.caseWindowInDays).toBe(30);
    expect(overview.detectionWindowInDays).toBe(14);
    expect(overview.myOpenCases).toBe(3);
    expect(overview.runsWaitingForApproval).toBe(1);
    expect(overview.isTruncated).toBe(true);
    expect(overview.metrics.openCases).toBe(5);
  });
});

describe("readSecurityEntities", () => {
  test("keeps entities with a value, typing unknown types as Other", () => {
    expect(
      readSecurityEntities([
        { type: "User", value: "alice@example.com" },
        { type: "Spaceship", value: "enterprise" },
        { type: "Host" },
        { type: "Host", value: "   " },
        "web-01",
        null,
      ] as unknown as JSONArray),
    ).toEqual([
      { type: SecurityEntityType.User, value: "alice@example.com" },
      { type: SecurityEntityType.Other, value: "enterprise" },
    ]);
  });

  test("reads anything that is not a list as no entities", () => {
    expect(readSecurityEntities(undefined)).toEqual([]);
    expect(readSecurityEntities(null)).toEqual([]);
    expect(readSecurityEntities("alice" as never)).toEqual([]);
  });
});

describe("the day chart's labels", () => {
  test("label every day of a week, and a few days of a month, always the last", () => {
    expect([...getLabelledDayIndexes(7)]).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const month: Set<number> = getLabelledDayIndexes(31);

    expect(month.has(0)).toBe(true);
    expect(month.has(30)).toBe(true);
    expect(month.size).toBeLessThanOrEqual(8);
    expect(getLabelledDayIndexes(0).size).toBe(0);
  });

  test("names a day in UTC, and leaves text that is not a day alone", () => {
    expect(formatDayLabel("2026-10-14")).toContain("14");
    expect(formatDayLabel("yesterday")).toBe("yesterday");
  });
});

describe("a run's step rows", () => {
  const STEPS: JSONArray = [
    {
      id: "s1",
      action: "Check Threat Intel",
      config: {},
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
    {
      id: "s2",
      action: "Suspend Okta User",
      config: { connectionId: "66666666-6666-4666-8666-666666666666" },
      requiresApproval: true,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  ];

  test("puts each step beside its result, with its action's title", () => {
    const rows: ReturnType<typeof getRunStepRows> = getRunStepRows({
      steps: STEPS,
      stepResults: [
        { stepId: "s1", action: "Check Threat Intel", status: "Succeeded" },
        {
          stepId: "s2",
          action: "Suspend Okta User",
          status: "Waiting for Approval",
        },
      ],
    });

    expect(
      rows.map((row: ReturnType<typeof getRunStepRows>[number]) => {
        return [row.title, row.result?.status, row.requiresApproval];
      }),
    ).toEqual([
      ["Check entities against threat intel", "Succeeded", false],
      ["Suspend the user in Okta", "Waiting for Approval", true],
    ]);
  });

  test("a step with no result yet is pending", () => {
    const rows: ReturnType<typeof getRunStepRows> = getRunStepRows({
      steps: STEPS,
      stepResults: [],
    });

    expect(
      rows.map((row: ReturnType<typeof getRunStepRows>[number]) => {
        return row.result?.status;
      }),
    ).toEqual([
      SecurityPlaybookStepStatus.Pending,
      SecurityPlaybookStepStatus.Pending,
    ]);
  });

  test("a snapshot that no longer reads still shows what the run recorded", () => {
    const rows: ReturnType<typeof getRunStepRows> = getRunStepRows({
      steps: [{ action: "Teleport the attacker" }],
      stepResults: [
        {
          stepId: "x",
          action: "Teleport the attacker",
          status: "Failed",
          error: "No such action",
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Teleport the attacker");
    expect(rows[0]!.result?.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(rows[0]!.result?.error).toBe("No such action");
  });
});
