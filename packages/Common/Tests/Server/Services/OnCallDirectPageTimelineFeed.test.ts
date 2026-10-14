import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import Model from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import URL from "../../../Types/API/URL";
import { Green500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
import { getAwayTimelineMessage } from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import FeedMarkdown, {
  MarkdownText,
} from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * EVERY LINE OF A DIRECT PAGE'S TIMELINE IS AN ENTRY OF ITS RECORD'S FEED.
 *
 * A line of a run's timeline - a person paged, somebody who acknowledged, a
 * schedule with nobody on call - is written to the feed of the incident or
 * alert the run is about (addToIncidentOrAlertFeed). A direct page's lines
 * name no policy and no escalation rule; this used to be where a line was
 * dropped ("no policy, nothing to say"), so the suite holds that each one is
 * written, in a direct page's words, naming who started the page - and that
 * a policy's line reads exactly as it did.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const LINE_ID: ObjectID = new ObjectID("11110000-0000-4000-8000-000000000001");
const POLICY_ID: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const ALERT_ID: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-000000000002");
const ALICE: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const BOB: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const STARTER: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000003");

const NAMES: Record<string, string> = {
  [ALICE.toString()]: "Alice",
  [BOB.toString()]: "Bob",
  [STARTER.toString()]: "Sam Starter",
};

function userLink(id: ObjectID): string {
  return `[${NAMES[id.toString()]}](https://oneuptime.test/users/${id.toString()})`;
}

interface FeedEntry {
  feed: "incident" | "alert";
  recordId: string;
  type: string;
  color: Color;
  markdown: string;
}

/*
 * A line as the service's own read returns it. The defaults describe a
 * direct page's line about an incident: a person paged, with no policy and
 * no rule, in a run a workflow's step started.
 */
function line(overrides: Record<string, unknown>): Model {
  return {
    _id: LINE_ID.toString(),
    projectId: PROJECT_ID,
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    statusMessage: "Notification sent by SMS.",
    triggeredByIncidentId: INCIDENT_ID,
    alertSentToUserId: ALICE,
    onCallDutyPolicyExecutionLog: {
      triggeredByWorkflowName: "Page the on-call engineer",
    },
    ...overrides,
  } as unknown as Model;
}

describe("a direct page's timeline line in the record's feed", () => {
  let feed: Array<FeedEntry>;
  let read: SpyInstance<
    typeof OnCallDutyPolicyExecutionLogTimelineService.findOneById
  >;
  let policyLink: SpyInstance<
    typeof OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard
  >;
  let userRead: SpyInstance<typeof UserService.getUserMarkdownString>;

  async function write(row: Model | null): Promise<Array<FeedEntry>> {
    read.mockResolvedValue(row);

    await OnCallDutyPolicyExecutionLogTimelineService.addToIncidentOrAlertFeed({
      onCallDutyPolicyExecutionLogTimelineId: LINE_ID,
    });

    return feed;
  }

  beforeEach(() => {
    feed = [];

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    read = jest.spyOn(
      OnCallDutyPolicyExecutionLogTimelineService,
      "findOneById",
    );

    policyLink = jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/policy/1"));

    userRead = jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation(
        async (data: { userId: ObjectID }): Promise<MarkdownText> => {
          return FeedMarkdown.asMarkdown(userLink(data.userId));
        },
      );

    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async (data: {
        incidentId: ObjectID;
        incidentFeedEventType: IncidentFeedEventType;
        displayColor: Color;
        feedInfoInMarkdown: string;
      }) => {
        feed.push({
          feed: "incident",
          recordId: data.incidentId.toString(),
          type: data.incidentFeedEventType,
          color: data.displayColor,
          markdown: data.feedInfoInMarkdown,
        });
      }) as never);

    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockImplementation((async (data: {
        alertId: ObjectID;
        alertFeedEventType: AlertFeedEventType;
        displayColor: Color;
        feedInfoInMarkdown: string;
      }) => {
        feed.push({
          feed: "alert",
          recordId: data.alertId.toString(),
          type: data.alertFeedEventType,
          color: data.displayColor,
          markdown: data.feedInfoInMarkdown,
        });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the line is read with the run that says who started the page", async () => {
    await write(line({}));

    const select: Record<string, unknown> = (
      read.mock.calls[0]![0] as unknown as { select: Record<string, unknown> }
    ).select;

    expect(select["onCallDutyPolicyId"]).toBe(true);
    expect(select["onCallDutyPolicy"]).toEqual({ name: true, _id: true });
    expect(select["onCallDutyPolicyExecutionLog"]).toEqual({
      triggeredByWorkflowName: true,
      triggeredByUserId: true,
    });
  });

  test("a person paged: one entry on the incident, naming the workflow and no policy", async () => {
    expect(await write(line({}))).toEqual([
      {
        feed: "incident",
        recordId: INCIDENT_ID.toString(),
        type: IncidentFeedEventType.OnCallPolicy,
        color: Green500,
        markdown: `Workflow **Page the on-call engineer** paged **${userLink(ALICE)}**.\n\nNotification sent by SMS.`,
      },
    ]);
    // No policy to link to: none is looked up.
    expect(policyLink).not.toHaveBeenCalled();
  });

  test("a page about an alert goes to the alert's feed", async () => {
    expect(
      await write(
        line({
          triggeredByIncidentId: undefined,
          triggeredByAlertId: ALERT_ID,
        }),
      ),
    ).toEqual([
      {
        feed: "alert",
        recordId: ALERT_ID.toString(),
        type: AlertFeedEventType.OnCallPolicy,
        color: Green500,
        markdown: `Workflow **Page the on-call engineer** paged **${userLink(ALICE)}**.\n\nNotification sent by SMS.`,
      },
    ]);
  });

  test("on call in a schedule, and as a member of a team", async () => {
    expect(
      (
        await write(
          line({
            statusMessage: undefined,
            onCallDutySchedule: { name: "Primary" },
          }),
        )
      )[0]!.markdown,
    ).toBe(
      `Workflow **Page the on-call engineer** paged **${userLink(ALICE)}**, on call in schedule **Primary**.`,
    );

    feed.length = 0;

    expect(
      (
        await write(
          line({
            statusMessage: undefined,
            userBelongsToTeam: { name: "Platform" },
          }),
        )
      )[0]!.markdown,
    ).toBe(
      `Workflow **Page the on-call engineer** paged **${userLink(ALICE)}**, as a member of **Platform**.`,
    );
  });

  test("somebody paged in place of a person who is away says who they cover for", async () => {
    expect(
      (
        await write(
          line({
            statusMessage: undefined,
            overridedByUser: { id: BOB },
          }),
        )
      )[0]!.markdown,
    ).toBe(
      `Workflow **Page the on-call engineer** paged **${userLink(ALICE)}**.\n\nThey are covering for ${userLink(BOB)} (a user override).`,
    );
  });

  test("somebody away and not paged: a skipped entry with when they are back", async () => {
    const entries: Array<FeedEntry> = await write(
      line({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: getAwayTimelineMessage(
          new Date("2026-10-17T09:00:00.000Z"),
        ),
      }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.color).toEqual(Red500);
    expect(entries[0]!.markdown).toBe(
      `Workflow **Page the on-call engineer** did not page **${userLink(ALICE)}**.\n\nAway until \`2026-10-17T09:00:00.000Z\`, and nobody is named to cover for them.`,
    );
  });

  test("the person who acknowledged is an entry that reads after their name", async () => {
    const entries: Array<FeedEntry> = await write(
      line({
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        statusMessage: undefined,
        isAcknowledged: true,
      }),
    );

    expect(entries).toEqual([
      {
        feed: "incident",
        recordId: INCIDENT_ID.toString(),
        type: IncidentFeedEventType.OnCallPolicy,
        color: Green500,
        markdown: `**${userLink(ALICE)}** acknowledged the page from workflow **Page the on-call engineer**.`,
      },
    ]);
  });

  test("a page that could not be sent says so, with why", async () => {
    const entries: Array<FeedEntry> = await write(
      line({
        status: OnCallDutyExecutionLogTimelineStatus.Error,
        statusMessage: "No notification rules for this severity",
      }),
    );

    expect(entries[0]!.color).toEqual(Red500);
    expect(entries[0]!.markdown).toBe(
      `Workflow **Page the on-call engineer** could not page **${userLink(ALICE)}**.\n\nNo notification rules for this severity.`,
    );
  });

  describe("a target the page found nobody in", () => {
    test("a schedule with nobody on call names the schedule, and no person", async () => {
      const entries: Array<FeedEntry> = await write(
        line({
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage: "Skipped because no one is on call.",
          alertSentToUserId: undefined,
          onCallDutySchedule: { name: "Weekend Rotation" },
        }),
      );

      expect(entries).toEqual([
        {
          feed: "incident",
          recordId: INCIDENT_ID.toString(),
          type: IncidentFeedEventType.OnCallPolicy,
          color: Red500,
          markdown:
            "Workflow **Page the on-call engineer** paged nobody: nobody was on call in schedule **Weekend Rotation**.",
        },
      ]);
      // Nobody is looked up by an id that is not set.
      expect(userRead).not.toHaveBeenCalled();
    });

    test("a team with no members names the team", async () => {
      const entries: Array<FeedEntry> = await write(
        line({
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage: ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
          alertSentToUserId: undefined,
          userBelongsToTeam: { name: "Platform" },
        }),
      );

      expect(entries[0]!.markdown).toBe(
        "Workflow **Page the on-call engineer** paged nobody: team **Platform** has no members.",
      );
    });

    test("a page with nobody to page at all says it paged nobody", async () => {
      const entries: Array<FeedEntry> = await write(
        line({
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage: ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
          alertSentToUserId: undefined,
        }),
      );

      expect(entries[0]!.markdown).toBe(
        "Workflow **Page the on-call engineer** paged nobody.",
      );
    });

    test("nobody a line could be covering for is named when nobody was paged", async () => {
      const entries: Array<FeedEntry> = await write(
        line({
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          alertSentToUserId: undefined,
          overridedByUser: { id: BOB },
          onCallDutySchedule: { name: "Weekend Rotation" },
        }),
      );

      expect(entries[0]!.markdown).not.toContain("covering for");
      expect(userRead).not.toHaveBeenCalled();
    });
  });

  describe("who started the page", () => {
    test("a person: named as a link, read in the run's project", async () => {
      const entries: Array<FeedEntry> = await write(
        line({
          statusMessage: undefined,
          onCallDutyPolicyExecutionLog: { triggeredByUserId: STARTER },
        }),
      );

      expect(entries[0]!.markdown).toBe(
        `**${userLink(STARTER)}** paged **${userLink(ALICE)}**.`,
      );
      expect(userRead).toHaveBeenCalledWith({
        userId: STARTER,
        projectId: PROJECT_ID,
      });
    });

    test("a workflow and a person: the workflow", async () => {
      const entries: Array<FeedEntry> = await write(
        line({
          statusMessage: undefined,
          onCallDutyPolicyExecutionLog: {
            triggeredByWorkflowName: "Page SRE",
            triggeredByUserId: STARTER,
          },
        }),
      );

      expect(entries[0]!.markdown).toBe(
        `Workflow **Page SRE** paged **${userLink(ALICE)}**.`,
      );
    });

    test.each<[string, Record<string, unknown>]>([
      ["a run that records nobody", { onCallDutyPolicyExecutionLog: {} }],
      [
        "a line read without its run",
        { onCallDutyPolicyExecutionLog: undefined },
      ],
    ])(
      "%s: the product is named, never an empty name",
      async (_what: string, overrides: Record<string, unknown>) => {
        const entries: Array<FeedEntry> = await write(
          line({ statusMessage: undefined, ...overrides }),
        );

        expect(entries[0]!.markdown).toBe(
          `${ProductBrandingText.getProductName()} paged **${userLink(ALICE)}**.`,
        );
        expect(entries[0]!.markdown).not.toContain("****");
        expect(entries[0]!.markdown).not.toContain("undefined");
      },
    );
  });

  describe("what is not an entry", () => {
    test.each([
      OnCallDutyExecutionLogTimelineStatus.Started,
      OnCallDutyExecutionLogTimelineStatus.Executing,
    ])(
      "a line that is still %s",
      async (status: OnCallDutyExecutionLogTimelineStatus) => {
        expect(await write(line({ status: status }))).toEqual([]);
      },
    );

    test("a person the page names a second time: they were paged the first time", async () => {
      /*
       * A member of two teams the page names, or on call in two of its
       * schedules: "did not page Alice" under "paged Alice" would read as
       * a page that failed.
       */
      expect(
        await write(
          line({
            status: OnCallDutyExecutionLogTimelineStatus.Skipped,
            statusMessage: ALREADY_PAGED_TIMELINE_MESSAGE,
            userBelongsToTeam: { name: "Platform" },
          }),
        ),
      ).toEqual([]);
      // Nobody is looked up for an entry that is not written.
      expect(userRead).not.toHaveBeenCalled();
    });

    test("a line that is not about a record", async () => {
      expect(await write(line({ triggeredByIncidentId: undefined }))).toEqual(
        [],
      );
    });

    test("a line that is gone", async () => {
      expect(await write(null)).toEqual([]);
    });
  });

  describe("a policy's line is still a policy's", () => {
    const POLICY_LINE: Record<string, unknown> = {
      statusMessage: undefined,
      onCallDutyPolicyId: POLICY_ID,
      onCallDutyPolicy: { name: "Production Paging", id: POLICY_ID },
      onCallDutyPolicyEscalationRule: { name: "Level 1" },
      onCallDutySchedule: { name: "Primary" },
    };

    test("it names the policy and the escalation rule, as before", async () => {
      const entries: Array<FeedEntry> = await write(line(POLICY_LINE));

      expect(entries).toEqual([
        {
          feed: "incident",
          recordId: INCIDENT_ID.toString(),
          type: IncidentFeedEventType.OnCallPolicy,
          color: Green500,
          markdown: `On-call policy **[Production Paging](https://oneuptime.test/policy/1)** paged **${userLink(ALICE)}** at escalation rule **Level 1** (schedule **Primary**).`,
        },
      ]);
      expect(policyLink).toHaveBeenCalledTimes(1);
    });

    test("even in a run a workflow's step started: the policy paged, not the workflow", async () => {
      const entries: Array<FeedEntry> = await write(
        line({
          ...POLICY_LINE,
          onCallDutyPolicyExecutionLog: {
            triggeredByWorkflowName: "Page the on-call engineer",
          },
        }),
      );

      expect(entries[0]!.markdown.indexOf("On-call policy **")).toBe(0);
      expect(entries[0]!.markdown).not.toContain("Workflow");
    });

    test("a person a rule names a second time is still an entry of a policy's run, as before", async () => {
      const entries: Array<FeedEntry> = await write(
        line({
          ...POLICY_LINE,
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage: ALREADY_PAGED_TIMELINE_MESSAGE,
        }),
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]!.markdown).toBe(
        `On-call policy **[Production Paging](https://oneuptime.test/policy/1)** did not page **${userLink(ALICE)}** at escalation rule **Level 1** (schedule **Primary**).\n\nSkipped because notification sent to this user already.`,
      );
    });

    test("a policy's line whose policy could not be read is not passed off as a direct page", async () => {
      const entries: Array<FeedEntry> = await write(
        line({
          ...POLICY_LINE,
          onCallDutyPolicy: undefined,
        }),
      );

      expect(entries).toEqual([]);
    });
  });
});
