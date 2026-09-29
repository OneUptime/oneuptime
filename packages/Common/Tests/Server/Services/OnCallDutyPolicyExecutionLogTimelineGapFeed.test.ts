import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserService from "../../../Server/Services/UserService";
import Model from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import logger from "../../../Server/Utils/Logger";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * addToIncidentOrAlertFeed turns an on-call execution timeline row into the
 * human-readable entry that lands in the incident feed and the workspace channel.
 *
 * Some rows have NO recipient by construction: the escalation runner writes a
 * `Skipped` row carrying only a schedule id when that schedule currently has
 * nobody on call (a coverage gap), and another when a rule has no responders at
 * all. Those rows are exactly the ones an operator most needs to understand —
 * they are the reason an incident sat unacknowledged.
 *
 * The builder used to interpolate `alertSentToUserId!` unconditionally: a
 * non-null assertion on a column that is never set for those rows. The result
 * was a feed entry asserting that somebody "was alerted" when in fact nobody
 * was. These tests pin the branch that now distinguishes the two, and the
 * separate fail-closed guard in UserService that stops an undefined id from
 * degrading into a query that matches an arbitrary user.
 *
 * Everything is stubbed at the service boundary — no Postgres involved.
 */

const service: any = OnCallDutyPolicyExecutionLogTimelineService as any;

/*
 * The REAL getUserMarkdownString, captured at module load — before the
 * beforeEach below swaps in a stub for the feed-builder tests. The guard tests
 * at the bottom of this file must exercise the real implementation; calling
 * UserService.getUserMarkdownString there would hit the stub and pass
 * vacuously.
 */
const realGetUserMarkdownString: (data: {
  userId: ObjectID;
  projectId: ObjectID;
}) => Promise<string> = UserService.getUserMarkdownString.bind(UserService);

const PROJECT_ID: ObjectID = new ObjectID("project1");
const TIMELINE_ID: ObjectID = new ObjectID("timeline1");
const POLICY_ID: ObjectID = new ObjectID("policy1");
const INCIDENT_ID: ObjectID = new ObjectID("incident1");
const INCIDENT_EPISODE_ID: ObjectID = new ObjectID("incidentEpisode1");
const USER_ID: ObjectID = new ObjectID("user1");

// Markdown captured from whichever feed service the builder routed to.
interface CapturedFeed {
  target: string;
  markdown: string;
}

let captured: Array<CapturedFeed> = [];

// Saved originals, restored in afterEach so suites stay independent.
const originals: Record<string, any> = {};

/*
 * Overrides are a loose record rather than Partial<Model>: the suite needs to
 * set relation/id fields back to undefined to describe rows the runner really
 * writes, and exactOptionalPropertyTypes forbids that on the model type.
 */
type BuildRowFunction = (overrides: Record<string, unknown>) => Model;

/*
 * A timeline row as the builder's own findOneById would return it: relations
 * already resolved, ids present. Defaults describe an incident-triggered
 * `Skipped` step against a named schedule with NO recipient — the coverage-gap
 * shape.
 */
const buildRow: BuildRowFunction = (
  overrides: Record<string, unknown>,
): Model => {
  return {
    _id: TIMELINE_ID,
    projectId: PROJECT_ID,
    status: OnCallDutyExecutionLogTimelineStatus.Skipped,
    statusMessage:
      "Skipped because no active users are found in this schedule.",
    triggeredByIncidentId: INCIDENT_ID,
    onCallDutyPolicy: {
      name: "Production Paging",
      id: POLICY_ID,
    },
    onCallDutyPolicyEscalationRule: {
      name: "Level 1",
      id: new ObjectID("rule1"),
    },
    onCallDutySchedule: {
      name: "Weekend Rotation",
      id: new ObjectID("schedule1"),
    },
    ...overrides,
  } as unknown as Model;
};

beforeEach(() => {
  captured = [];

  /*
   * Logger is noisy here (the builder debug-logs the whole row); silence it so
   * a failing assertion is readable.
   */
  originals["loggerDebug"] = logger.debug;
  (logger as any).debug = () => {};

  originals["findOneById"] = service.findOneById;

  originals["incidentFeed"] = IncidentFeedService.createIncidentFeedItem;
  (IncidentFeedService as any).createIncidentFeedItem = async (data: {
    feedInfoInMarkdown: string;
  }): Promise<void> => {
    captured.push({ target: "incident", markdown: data.feedInfoInMarkdown });
  };

  originals["incidentEpisodeFeed"] =
    IncidentEpisodeFeedService.createIncidentEpisodeFeedItem;
  (IncidentEpisodeFeedService as any).createIncidentEpisodeFeedItem =
    async (data: { feedInfoInMarkdown: string }): Promise<void> => {
      captured.push({
        target: "incidentEpisode",
        markdown: data.feedInfoInMarkdown,
      });
    };

  originals["incidentNumber"] = IncidentService.getIncidentNumber;
  (IncidentService as any).getIncidentNumber = async (): Promise<{
    number: number | null;
    numberWithPrefix: string | null;
  }> => {
    return { number: 12, numberWithPrefix: "#12" };
  };

  originals["incidentLink"] = IncidentService.getIncidentLinkInDashboard;
  (IncidentService as any).getIncidentLinkInDashboard =
    async (): Promise<URL> => {
      return URL.fromString("https://oneuptime.test/incident/12");
    };

  originals["episodeNumber"] = IncidentEpisodeService.getEpisodeNumber;
  (IncidentEpisodeService as any).getEpisodeNumber = async (): Promise<{
    number: number | null;
    numberWithPrefix: string | null;
  }> => {
    return { number: 7, numberWithPrefix: "#7" };
  };

  originals["episodeLink"] = IncidentEpisodeService.getEpisodeLinkInDashboard;
  (IncidentEpisodeService as any).getEpisodeLinkInDashboard =
    async (): Promise<URL> => {
      return URL.fromString("https://oneuptime.test/incident-episode/7");
    };

  originals["policyLink"] =
    OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard;
  (OnCallDutyPolicyService as any).getOnCallDutyPolicyLinkInDashboard =
    async (): Promise<URL> => {
      return URL.fromString("https://oneuptime.test/policy/1");
    };

  originals["userMarkdown"] = UserService.getUserMarkdownString;
  (UserService as any).getUserMarkdownString = async (data: {
    userId: ObjectID;
  }): Promise<string> => {
    /*
     * Mirrors the real guard: a falsy id yields an empty string rather than a
     * name. If the builder ever calls this for a gap row, the assertions below
     * catch the resulting "alerted to <nothing>" sentence.
     */
    if (!data.userId) {
      return "";
    }
    return "[Alice](https://oneuptime.test/user/1)";
  };
});

afterEach(() => {
  (logger as any).debug = originals["loggerDebug"];
  service.findOneById = originals["findOneById"];
  (IncidentFeedService as any).createIncidentFeedItem =
    originals["incidentFeed"];
  (IncidentEpisodeFeedService as any).createIncidentEpisodeFeedItem =
    originals["incidentEpisodeFeed"];
  (IncidentService as any).getIncidentNumber = originals["incidentNumber"];
  (IncidentService as any).getIncidentLinkInDashboard =
    originals["incidentLink"];
  (IncidentEpisodeService as any).getEpisodeNumber = originals["episodeNumber"];
  (IncidentEpisodeService as any).getEpisodeLinkInDashboard =
    originals["episodeLink"];
  (OnCallDutyPolicyService as any).getOnCallDutyPolicyLinkInDashboard =
    originals["policyLink"];
  (UserService as any).getUserMarkdownString = originals["userMarkdown"];
});

type RunBuilderFunction = (row: Model) => Promise<void>;

const runBuilder: RunBuilderFunction = async (row: Model): Promise<void> => {
  service.findOneById = async (): Promise<Model> => {
    return row;
  };

  await OnCallDutyPolicyExecutionLogTimelineService.addToIncidentOrAlertFeed({
    onCallDutyPolicyExecutionLogTimelineId: TIMELINE_ID,
  });
};

describe("OnCallDutyPolicyExecutionLogTimelineService gap feed entries", () => {
  describe("a step with no recipient", () => {
    test("never claims anyone was alerted", async () => {
      await runBuilder(buildRow({}));

      expect(captured).toHaveLength(1);

      /*
       * The exact sentence that used to be produced for these rows. Its
       * reappearance means the non-null assertion is back.
       */
      expect(captured[0]!.markdown).not.toContain("was alerted");
    });

    test("names the uncovered schedule as the reason nobody was paged", async () => {
      await runBuilder(buildRow({}));

      expect(captured[0]!.markdown).toContain("nobody was notified");
      expect(captured[0]!.markdown).toContain("no one was on call in schedule");
      expect(captured[0]!.markdown).toContain("Weekend Rotation");
      expect(captured[0]!.markdown).toContain(
        "no one was notified at this step",
      );
    });

    test("falls back to the no-responders wording when no schedule was targeted", async () => {
      /*
       * The sibling case: a rule with no responders at all writes a Skipped row
       * with neither a recipient nor a schedule. Blaming a schedule here would
       * send the operator to the wrong screen.
       */
      await runBuilder(buildRow({ onCallDutySchedule: undefined }));

      expect(captured[0]!.markdown).toContain(
        "this escalation rule had no responders",
      );
      expect(captured[0]!.markdown).not.toContain("on call in schedule");
    });

    test("still carries the policy, rule and status message", async () => {
      await runBuilder(buildRow({}));

      const markdown: string = captured[0]!.markdown;
      expect(markdown).toContain("Production Paging");
      expect(markdown).toContain("Level 1");
      expect(markdown).toContain(
        "Skipped because no active users are found in this schedule.",
      );
    });

    test("does not render an empty user link where a name would go", async () => {
      await runBuilder(buildRow({}));

      /*
       * Guards the specific visual symptom of the old bug: "On-Call Alert
       * Skipped to " followed by nothing, because getUserMarkdownString
       * returned "" for the undefined id.
       */
      expect(captured[0]!.markdown).not.toContain("Skipped to ");
      expect(captured[0]!.markdown).not.toContain("to **");
    });
  });

  describe("a step that did notify someone", () => {
    test("keeps the original alerted wording", async () => {
      await runBuilder(
        buildRow({
          status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
          statusMessage: "Notification sent.",
          alertSentToUserId: USER_ID,
        }),
      );

      expect(captured).toHaveLength(1);
      expect(captured[0]!.markdown).toContain("was alerted");
      expect(captured[0]!.markdown).toContain("Alice");
      expect(captured[0]!.markdown).not.toContain("nobody was notified");
    });
  });

  describe("incident episode triggers", () => {
    /*
     * triggeredByIncidentEpisodeId was missing from the builder's own select
     * while the guard below it read that field, so it was always undefined and
     * EVERY incident-episode execution returned before writing anything. The
     * episode feed branch was unreachable dead code.
     *
     * This test drives the builder with a row that only has an episode id — the
     * shape the fixed select now produces — and asserts an entry is written.
     */
    test("produce a feed entry rather than being silently dropped", async () => {
      await runBuilder(
        buildRow({
          triggeredByIncidentId: undefined,
          triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
        }),
      );

      expect(captured).toHaveLength(1);
      expect(captured[0]!.target).toBe("incidentEpisode");
      expect(captured[0]!.markdown).toContain("Incident Episode");
    });

    test("carry the same no-recipient wording as other trigger types", async () => {
      await runBuilder(
        buildRow({
          triggeredByIncidentId: undefined,
          triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
        }),
      );

      expect(captured[0]!.markdown).toContain("nobody was notified");
      expect(captured[0]!.markdown).not.toContain("was alerted");
    });
  });

  describe("rows with no trigger at all", () => {
    test("are skipped without writing a feed entry", async () => {
      await runBuilder(
        buildRow({
          triggeredByIncidentId: undefined,
        }),
      );

      expect(captured).toHaveLength(0);
    });
  });
});

describe("UserService.getUserMarkdownString fail-closed guard", () => {
  test("returns an empty string for a missing user id without querying", async () => {
    /*
     * Callers reach this through non-null assertions on nullable columns. An
     * undefined id must not reach the query layer: the id key would be dropped
     * from the WHERE clause, degrading the lookup into "any user" and naming an
     * arbitrary person in a feed entry. Fail closed instead.
     */
    const originalFindOneBy: any = (UserService as any).findOneBy;
    let queried: boolean = false;

    (UserService as any).findOneBy = async (): Promise<null> => {
      queried = true;
      return null;
    };

    try {
      const result: string = await realGetUserMarkdownString({
        userId: undefined as unknown as ObjectID,
        projectId: PROJECT_ID,
      });

      expect(result).toBe("");
      expect(queried).toBe(false);
    } finally {
      (UserService as any).findOneBy = originalFindOneBy;
    }
  });

  test("still queries when a real user id is supplied", async () => {
    const originalFindOneBy: any = (UserService as any).findOneBy;
    let queried: boolean = false;

    (UserService as any).findOneBy = async (): Promise<null> => {
      queried = true;
      return null;
    };

    try {
      await realGetUserMarkdownString({
        userId: USER_ID,
        projectId: PROJECT_ID,
      });

      expect(queried).toBe(true);
    } finally {
      (UserService as any).findOneBy = originalFindOneBy;
    }
  });
});
