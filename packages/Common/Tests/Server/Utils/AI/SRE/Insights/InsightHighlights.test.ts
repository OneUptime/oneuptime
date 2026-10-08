import InsightHighlights, {
  OPEN_INSIGHT_STATUSES,
} from "../../../../../../Server/Utils/AI/SRE/Insights/InsightHighlights";
import AIInsightService from "../../../../../../Server/Services/AIInsightService";
import AIInsight from "../../../../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import {
  AI_INSIGHT_HIGHLIGHTS_SCAN_LIMIT,
  AIInsightHighlights,
} from "../../../../../../Types/AI/AIInsightHighlights";
import DatabaseCommonInteractionProps from "../../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../../Types/ObjectID";
import UserType from "../../../../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * InsightHighlights reads the open findings the AI Insights inbox leads
 * with: under the caller's own props (so a caller whose grants reach only
 * some services hears only about those), the newest first, bounded, with
 * nothing but what the card says - and a finding's triage report becomes
 * its Summary as plain text.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-10-08T12:00:00.000Z");

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("22222222-2222-4222-8222-222222222222"),
  userType: UserType.User,
} as DatabaseCommonInteractionProps;

function insight(overrides: Partial<Record<keyof AIInsight, unknown>>): AIInsight {
  return {
    id: ObjectID.generate(),
    title: "Error logs from checkout spiked 6x",
    insightType: AIInsightType.ErrorLogSpike,
    severity: AIInsightSeverity.High,
    serviceName: "checkout",
    telemetryServiceId: new ObjectID("77777777-0000-4000-8000-000000000001"),
    occurrenceCount: 3,
    firstSeenAt: new Date("2026-10-08T06:00:00.000Z"),
    lastSeenAt: new Date("2026-10-08T10:00:00.000Z"),
    ...overrides,
  } as unknown as AIInsight;
}

describe("InsightHighlights.read", () => {
  let findBy: jest.SpyInstance;

  beforeEach(() => {
    findBy = jest.spyOn(AIInsightService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function request(): {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    sort: Record<string, unknown>;
    limit: number;
    props: DatabaseCommonInteractionProps;
  } {
    return findBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
      props: DatabaseCommonInteractionProps;
    };
  }

  test("reads the project's open findings under the caller's own props, newest first, bounded", async () => {
    await InsightHighlights.read({
      projectId: PROJECT_ID,
      props: CALLER,
      now: NOW,
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(request().props).toBe(CALLER);
    expect(request().query["projectId"]).toBe(PROJECT_ID);

    const statuses: Array<unknown> = Object.values(
      (
        request().query["status"] as {
          objectLiteralParameters: Record<string, unknown>;
        }
      ).objectLiteralParameters,
    )[0] as Array<unknown>;
    expect([...statuses].sort()).toEqual(
      [
        AIInsightStatus.ActionRequired,
        AIInsightStatus.Detected,
        AIInsightStatus.FixOpened,
      ].sort(),
    );
    expect(OPEN_INSIGHT_STATUSES).not.toContain(AIInsightStatus.Resolved);
    expect(OPEN_INSIGHT_STATUSES).not.toContain(AIInsightStatus.Dismissed);

    expect(request().sort).toEqual({
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Ascending,
    });
    expect(request().limit).toBe(AI_INSIGHT_HIGHLIGHTS_SCAN_LIMIT);
  });

  test("selects only what the card says: never the evidence, the fingerprint or the detail", async () => {
    await InsightHighlights.read({ projectId: PROJECT_ID, props: CALLER });

    expect(Object.keys(request().select).sort()).toEqual(
      [
        "_id",
        "title",
        "insightType",
        "severity",
        "serviceName",
        "telemetryServiceId",
        "occurrenceCount",
        "firstSeenAt",
        "lastSeenAt",
        "triageSummaryMarkdown",
      ].sort(),
    );
  });

  test("leads with the most severe finding, with what its triage concluded as plain text", async () => {
    const top: AIInsight = insight({
      triageSummaryMarkdown: [
        "## 🧠 AI — Automated Root Cause Analysis",
        "",
        "**Summary** — The **10:42** deploy set the gateway client's timeout to `2 s` [C1].",
        "",
        "**Suggested next steps**",
        "- Raise it back to 5 s.",
      ].join("\n"),
    });
    findBy.mockResolvedValue([
      insight({ severity: AIInsightSeverity.Low, title: "A low one" }),
      top,
    ]);

    const highlights: AIInsightHighlights = await InsightHighlights.read({
      projectId: PROJECT_ID,
      props: CALLER,
      now: NOW,
    });

    expect(highlights.openCount).toBe(2);
    expect(highlights.topFinding).toEqual({
      id: top.id!.toString(),
      title: "Error logs from checkout spiked 6x",
      insightType: AIInsightType.ErrorLogSpike,
      severity: AIInsightSeverity.High,
      serviceName: "checkout",
      occurrenceCount: 3,
      firstSeenAt: "2026-10-08T06:00:00.000Z",
      lastSeenAt: "2026-10-08T10:00:00.000Z",
      triageSummary: "The 10:42 deploy set the gateway client's timeout to 2 s.",
    });
  });

  test("a finding nobody triaged has no triage words", async () => {
    findBy.mockResolvedValue([insight({ triageSummaryMarkdown: undefined })]);

    const highlights: AIInsightHighlights = await InsightHighlights.read({
      projectId: PROJECT_ID,
      props: CALLER,
      now: NOW,
    });

    expect(highlights.topFinding!.triageSummary).toBeUndefined();
  });

  test("names the service behind most of them by its id", async () => {
    findBy.mockResolvedValue([
      insight({}),
      insight({}),
      insight({
        serviceName: "payments",
        telemetryServiceId: new ObjectID(
          "77777777-0000-4000-8000-000000000002",
        ),
      }),
    ]);

    expect(
      (
        await InsightHighlights.read({
          projectId: PROJECT_ID,
          props: CALLER,
          now: NOW,
        })
      ).topService,
    ).toEqual({
      id: "77777777-0000-4000-8000-000000000001",
      name: "checkout",
      count: 2,
    });
  });

  test("a row without an id or a title is left out", async () => {
    findBy.mockResolvedValue([
      insight({ id: undefined }),
      insight({ title: "" }),
      insight({}),
    ]);

    expect(
      (
        await InsightHighlights.read({
          projectId: PROJECT_ID,
          props: CALLER,
          now: NOW,
        })
      ).openCount,
    ).toBe(1);
  });

  test("says when there were more open findings than it read", async () => {
    findBy.mockResolvedValue(
      Array.from({ length: AI_INSIGHT_HIGHLIGHTS_SCAN_LIMIT }, () => {
        return insight({});
      }),
    );

    expect(
      (await InsightHighlights.read({ projectId: PROJECT_ID, props: CALLER }))
        .isPartial,
    ).toBe(true);
  });

  test("a caller the permission layer refuses is refused: nothing is made up", async () => {
    findBy.mockRejectedValue(new NotAuthorizedException("No."));

    await expect(
      InsightHighlights.read({ projectId: PROJECT_ID, props: CALLER }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });
});
