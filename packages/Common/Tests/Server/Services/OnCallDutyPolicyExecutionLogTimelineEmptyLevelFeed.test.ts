import Model from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import { Red500 } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import { ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import {
  ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A LEVEL'S OWN LINE, AS ITS RECORD'S FEED HEARS OF IT.
 *
 * The run writes a line for a level that paged nobody, and the line's own
 * create hook (addToIncidentOrAlertFeed) writes the record's feed entry: the
 * level by its place among the policy's levels, counted then, and that the
 * policy moved on at once. Every kind of record a run pages about hears it
 * the same way: an incident, an alert, and either kind of episode.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0c100000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "0c100000-0000-4000-8000-000000000002",
);
const RULE_ID: ObjectID = new ObjectID("0c100000-0000-4000-8000-000000000003");
const LINE_ID: ObjectID = new ObjectID("0c100000-0000-4000-8000-000000000004");
const RECORD_ID: ObjectID = new ObjectID(
  "0c100000-0000-4000-8000-000000000005",
);
const TEAM_ID: ObjectID = new ObjectID("0c100000-0000-4000-8000-000000000006");

const POLICY_MD: string = "**[sg - irm](https://oneuptime.test/policy/1)**";

interface Written {
  feed: string;
  markdown: string;
  color: unknown;
}

let written: Array<Written>;
let levels: number;

function line(overrides: Record<string, unknown>): Model {
  return {
    _id: LINE_ID.toString(),
    id: LINE_ID,
    projectId: PROJECT_ID,
    status: OnCallDutyExecutionLogTimelineStatus.Skipped,
    onCallDutyPolicyId: POLICY_ID,
    onCallDutyPolicy: { name: "sg - irm", id: POLICY_ID },
    onCallDutyPolicyEscalationRule: { order: 1, id: RULE_ID },
    triggeredByIncidentId: RECORD_ID,
    ...overrides,
  } as unknown as Model;
}

async function feedOf(row: Model): Promise<void> {
  jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findOneById")
    .mockResolvedValue(row as never);

  await OnCallDutyPolicyExecutionLogTimelineService.addToIncidentOrAlertFeed({
    onCallDutyPolicyExecutionLogTimelineId: LINE_ID,
  });
}

beforeEach(() => {
  written = [];
  levels = 2;

  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/policy/1"));

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
    .mockImplementation((async () => {
      return new PositiveNumber(levels);
    }) as never);

  // A line about nobody names nobody: no person is ever looked up for it.
  jest.spyOn(UserService, "getUserMarkdownString").mockImplementation((() => {
    throw new Error("A line about nobody looked up a person.");
  }) as never);

  const capture: (
    feed: string,
  ) => (data: {
    feedInfoInMarkdown: string;
    displayColor: unknown;
  }) => Promise<undefined> = (feed: string) => {
    return async (data: {
      feedInfoInMarkdown: string;
      displayColor: unknown;
    }): Promise<undefined> => {
      written.push({
        feed: feed,
        markdown: data.feedInfoInMarkdown,
        color: data.displayColor,
      });
      return undefined;
    };
  };

  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(capture("incident") as never);
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockImplementation(capture("alert") as never);
  jest
    .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
    .mockImplementation(capture("alert episode") as never);
  jest
    .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
    .mockImplementation(capture("incident episode") as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a level with no responders", () => {
  test("its entry says so, and that the policy moved on to the next level at once", async () => {
    await feedOf(
      line({ statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE }),
    );

    expect(written).toEqual([
      {
        feed: "incident",
        markdown: `On-call policy ${POLICY_MD} paged nobody at **Level 1 of 2**: this escalation rule has no responders, so it moved on to the next level at once.`,
        color: Red500,
      },
    ]);
  });

  test("the level is counted among the policy's levels, as it is now", async () => {
    levels = 4;

    await feedOf(
      line({ statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE }),
    );

    expect(written[0]!.markdown).toContain("**Level 1 of 4**");
    expect(OnCallDutyPolicyEscalationRuleService.countBy).toHaveBeenCalledWith({
      query: { onCallDutyPolicyId: POLICY_ID },
      props: { isRoot: true },
    });
  });

  test("the last level: no word of moving on", async () => {
    await feedOf(
      line({
        statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
        onCallDutyPolicyEscalationRule: { order: 2, id: RULE_ID },
      }),
    );

    expect(written[0]!.markdown).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 2 of 2**: this escalation rule has no responders.`,
    );
  });

  test("levels that cannot be counted: it moved on at once, and the entry is still written", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
      .mockImplementation((async () => {
        throw new Error("connection reset");
      }) as never);

    await feedOf(
      line({ statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE }),
    );

    expect(written[0]!.markdown).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 1**: this escalation rule has no responders, so it moved on at once.`,
    );
  });

  test.each([
    ["incident", { triggeredByIncidentId: RECORD_ID }],
    [
      "alert",
      { triggeredByIncidentId: undefined, triggeredByAlertId: RECORD_ID },
    ],
    [
      "alert episode",
      {
        triggeredByIncidentId: undefined,
        triggeredByAlertEpisodeId: RECORD_ID,
      },
    ],
    [
      "incident episode",
      {
        triggeredByIncidentId: undefined,
        triggeredByIncidentEpisodeId: RECORD_ID,
      },
    ],
  ])(
    "about an %s: that record's own feed hears it, in the same words",
    async (feed: string, trigger: Record<string, unknown>) => {
      await feedOf(
        line({
          statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
          ...trigger,
        }),
      );

      expect(written).toEqual([
        {
          feed: feed,
          markdown: `On-call policy ${POLICY_MD} paged nobody at **Level 1 of 2**: this escalation rule has no responders, so it moved on to the next level at once.`,
          color: Red500,
        },
      ]);
    },
  );
});

describe("a level that named somebody and paged nobody", () => {
  test("its own entry: paged nobody, so it moved on to the next level at once", async () => {
    await feedOf(
      line({ statusMessage: ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE }),
    );

    expect(written[0]!.markdown).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 1 of 2**, so it moved on to the next level at once.`,
    );
  });

  test("a team of it with nobody in it: named, in an entry of its own", async () => {
    await feedOf(
      line({
        statusMessage: ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
        userBelongsToTeamId: TEAM_ID,
        userBelongsToTeam: { name: "Night Shift", id: TEAM_ID },
      }),
    );

    expect(written[0]!.markdown).toBe(
      `On-call policy ${POLICY_MD} paged nobody at **Level 1 of 2**: team **Night Shift** has no members.`,
    );
  });
});
