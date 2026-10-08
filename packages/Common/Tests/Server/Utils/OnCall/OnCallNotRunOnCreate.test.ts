import AlertEpisodeFeedService from "../../../../Server/Services/AlertEpisodeFeedService";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import IncidentEpisodeFeedService from "../../../../Server/Services/IncidentEpisodeFeedService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import OnCallNotRunOnCreate, {
  OnCallNotRunRecord,
} from "../../../../Server/Utils/OnCall/OnCallNotRunOnCreate";
import { AlertEpisodeFeedEventType } from "../../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import { IncidentEpisodeFeedEventType } from "../../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import { Gray500 } from "../../../../Types/BrandColors";
import ObjectID from "../../../../Types/ObjectID";
import { StartingStage } from "../../../../Utils/StartingStage";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * The one line an incident, alert or episode created already acknowledged
 * or resolved writes to its feed instead of paging: who was not paged, and
 * why, in plain words.
 */

const PRIMARY: string = "0193c0de-5a7e-4ddd-8eee-0000000000b1";
const DATABASE: string = "0193c0de-5a7e-4ddd-8eee-0000000000b2";
const PAYMENTS: string = "0193c0de-5a7e-4ddd-8eee-0000000000b3";
const DELETED: string = "0193c0de-5a7e-4ddd-8eee-0000000000b9";

const NAMES: Record<string, string | undefined> = {
  [PRIMARY]: "Primary",
  [DATABASE]: "Database",
  [PAYMENTS]: "Payments",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4ddd-8eee-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4ddd-8eee-000000000002",
);

// The policies as a record lists them: their ids only.
function listed(ids: Array<string>): Array<OnCallDutyPolicy> {
  return ids.map((id: string): OnCallDutyPolicy => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = id;
    return policy;
  });
}

describe("OnCallNotRunOnCreate.getMarkdown - the line", () => {
  test("one policy, created acknowledged", () => {
    expect(
      OnCallNotRunOnCreate.getMarkdown({
        noun: "incident",
        stage: StartingStage.Acknowledged,
        policyNames: ["Primary"],
      }),
    ).toBe(
      "📞 **No one was paged.** This incident was created already acknowledged, so its on-call policy **Primary** was not run.",
    );
  });

  test("two policies, created resolved", () => {
    expect(
      OnCallNotRunOnCreate.getMarkdown({
        noun: "alert",
        stage: StartingStage.Resolved,
        policyNames: ["Primary", "Database"],
      }),
    ).toBe(
      "📞 **No one was paged.** This alert was created already resolved, so its on-call policies **Primary** and **Database** were not run.",
    );
  });

  test("three or more policies are listed with commas and a final 'and'", () => {
    expect(
      OnCallNotRunOnCreate.getMarkdown({
        noun: "episode",
        stage: StartingStage.Acknowledged,
        policyNames: ["Primary", "Database", "Payments"],
      }),
    ).toBe(
      "📞 **No one was paged.** This episode was created already acknowledged, so its on-call policies **Primary**, **Database** and **Payments** were not run.",
    );
  });

  test("a policy name is free text: it cannot become a link, an image, formatting or a second line", () => {
    const markdown: string = OnCallNotRunOnCreate.getMarkdown({
      noun: "incident",
      stage: StartingStage.Resolved,
      policyNames: [
        "![x](https://tracker.example/p) **bold** [team]\n# heading",
      ],
    }).toString();

    expect(markdown).toBe(
      "📞 **No one was paged.** This incident was created already resolved, so its on-call policy **\\!\\[x\\]\\(https://tracker.example/p\\) \\*\\*bold\\*\\* \\[team\\] \\# heading** was not run.",
    );
    expect(markdown).not.toContain("\n");
  });

  test("it is one line, whatever the stage", () => {
    for (const stage of [StartingStage.Acknowledged, StartingStage.Resolved]) {
      expect(
        OnCallNotRunOnCreate.getMarkdown({
          noun: "incident",
          stage: stage,
          policyNames: ["Primary", "Database"],
        }),
      ).not.toContain("\n");
    }
  });
});

describe("OnCallNotRunOnCreate.getFeedMarkdown - the line for the policies a record lists", () => {
  // Each read of the policies: what it asked for.
  let reads: Array<{
    ids: Array<string>;
    projectId: string;
    select: Record<string, unknown>;
    props: Record<string, unknown>;
  }> = [];

  beforeEach(() => {
    reads = [];

    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockImplementation((async (findBy: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      }): Promise<Array<OnCallDutyPolicy>> => {
        const asked: string = JSON.stringify(findBy.query["_id"]).toLowerCase();
        const ids: Array<string> = Object.keys(NAMES)
          .concat([DELETED])
          .filter((id: string): boolean => {
            return asked.includes(id);
          });
        const projectId: string = String(findBy.query["projectId"]);

        reads.push({
          ids: ids,
          projectId: projectId,
          select: findBy.select,
          props: findBy.props,
        });

        // Every policy here is of PROJECT_ID.
        if (projectId !== PROJECT_ID.toString()) {
          return [];
        }

        // The database answers in its own order, and has no DELETED policy.
        return ids
          .filter((id: string): boolean => {
            return id !== DELETED;
          })
          .reverse()
          .map((id: string): OnCallDutyPolicy => {
            const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
            policy._id = id;
            if (NAMES[id]) {
              policy.name = NAMES[id]!;
            }
            return policy;
          });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("names the policies in the order the record lists them, read once, as OneUptime, their names only", async () => {
    const markdown: string | null = await OnCallNotRunOnCreate.getFeedMarkdown({
      noun: "incident",
      stage: StartingStage.Acknowledged,
      projectId: PROJECT_ID,
      policies: listed([PRIMARY, DATABASE]),
    });

    expect(markdown).toBe(
      "📞 **No one was paged.** This incident was created already acknowledged, so its on-call policies **Primary** and **Database** were not run.",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]!.ids.sort()).toEqual([DATABASE, PRIMARY].sort());
    expect(reads[0]!.select).toEqual({ _id: true, name: true });
    expect(reads[0]!.props).toEqual({ isRoot: true });
  });

  test("the names are read from the record's own project only", async () => {
    const markdown: string | null = await OnCallNotRunOnCreate.getFeedMarkdown({
      noun: "incident",
      stage: StartingStage.Acknowledged,
      projectId: OTHER_PROJECT_ID,
      policies: listed([PRIMARY]),
    });

    expect(reads).toHaveLength(1);
    expect(reads[0]!.projectId).toBe(OTHER_PROJECT_ID.toString());
    // A policy of another project is no policy of this record's.
    expect(markdown).toBeNull();
  });

  test("a policy listed twice, in any letter case, is named once", async () => {
    const upper: OnCallDutyPolicy = new OnCallDutyPolicy();
    upper._id = PRIMARY.toUpperCase();

    const markdown: string | null = await OnCallNotRunOnCreate.getFeedMarkdown({
      noun: "alert",
      stage: StartingStage.Resolved,
      projectId: PROJECT_ID,
      policies: [...listed([PRIMARY]), upper, ...listed([PRIMARY])],
    });

    expect(markdown).toBe(
      "📞 **No one was paged.** This alert was created already resolved, so its on-call policy **Primary** was not run.",
    );
  });

  test("a policy deleted since is left out of the line", async () => {
    const markdown: string | null = await OnCallNotRunOnCreate.getFeedMarkdown({
      noun: "episode",
      stage: StartingStage.Resolved,
      projectId: PROJECT_ID,
      policies: listed([DELETED, PAYMENTS]),
    });

    expect(markdown).toBe(
      "📞 **No one was paged.** This episode was created already resolved, so its on-call policy **Payments** was not run.",
    );
  });

  test("no line when every policy it lists is gone: there was nobody to page", async () => {
    expect(
      await OnCallNotRunOnCreate.getFeedMarkdown({
        noun: "incident",
        stage: StartingStage.Acknowledged,
        projectId: PROJECT_ID,
        policies: listed([DELETED]),
      }),
    ).toBeNull();
  });

  test("no line, and no read, when the record lists no policy", async () => {
    expect(
      await OnCallNotRunOnCreate.getFeedMarkdown({
        noun: "incident",
        stage: StartingStage.Acknowledged,
        projectId: PROJECT_ID,
        policies: [],
      }),
    ).toBeNull();
    expect(
      await OnCallNotRunOnCreate.getFeedMarkdown({
        noun: "incident",
        stage: StartingStage.Acknowledged,
        projectId: PROJECT_ID,
        // A policy with no id yet names nothing.
        policies: [new OnCallDutyPolicy()],
      }),
    ).toBeNull();
    expect(reads).toEqual([]);
  });

  test("a policy with no name is still named, as an unnamed policy - and an empty id in the list is skipped", async () => {
    jest.restoreAllMocks();
    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockImplementation((async (): Promise<Array<OnCallDutyPolicy>> => {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy._id = PRIMARY;
        return [policy];
      }) as never);

    expect(
      await OnCallNotRunOnCreate.getFeedMarkdown({
        noun: "incident",
        stage: StartingStage.Acknowledged,
        projectId: PROJECT_ID,
        policies: [new OnCallDutyPolicy(), ...listed([PRIMARY])],
      }),
    ).toBe(
      "📞 **No one was paged.** This incident was created already acknowledged, so its on-call policy **Unnamed policy** was not run.",
    );
  });
});

/*
 * The one place the line is written: each of the four services hands its
 * record over (createFeedItem), and the line lands in that record's own
 * feed - a grey on-call entry, kept off Slack and Microsoft Teams.
 */
describe("OnCallNotRunOnCreate.createFeedItem - the line, in the record's own feed", () => {
  const RECORD_ID: ObjectID = new ObjectID(
    "0193c0de-5a7e-4ddd-8eee-0000000000d1",
  );

  // Every item a feed service was asked to write, by service.
  let written: Array<{ feed: string; item: Record<string, unknown> }> = [];

  function stubFeed(target: unknown, method: string, feed: string): void {
    jest
      .spyOn(
        target as Record<string, (...args: Array<unknown>) => unknown>,
        method,
      )
      .mockImplementation((async (
        item: Record<string, unknown>,
      ): Promise<void> => {
        written.push({ feed: feed, item: item });
      }) as never);
  }

  beforeEach(() => {
    written = [];

    stubFeed(IncidentFeedService, "createIncidentFeedItem", "incident");
    stubFeed(AlertFeedService, "createAlertFeedItem", "alert");
    stubFeed(
      AlertEpisodeFeedService,
      "createAlertEpisodeFeedItem",
      "alert episode",
    );
    stubFeed(
      IncidentEpisodeFeedService,
      "createIncidentEpisodeFeedItem",
      "incident episode",
    );

    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockImplementation((async (): Promise<Array<OnCallDutyPolicy>> => {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy._id = PRIMARY;
        policy.name = "Primary";
        return [policy];
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      "an incident",
      { incidentId: RECORD_ID },
      "incident",
      "incidentId",
      "incidentFeedEventType",
      IncidentFeedEventType.OnCallPolicy,
      "This incident",
    ],
    [
      "an alert",
      { alertId: RECORD_ID },
      "alert",
      "alertId",
      "alertFeedEventType",
      AlertFeedEventType.OnCallPolicy,
      "This alert",
    ],
    [
      "an alert episode",
      { alertEpisodeId: RECORD_ID },
      "alert episode",
      "alertEpisodeId",
      "alertEpisodeFeedEventType",
      AlertEpisodeFeedEventType.OnCallPolicy,
      "This episode",
    ],
    [
      "an incident episode",
      { incidentEpisodeId: RECORD_ID },
      "incident episode",
      "incidentEpisodeId",
      "incidentEpisodeFeedEventType",
      IncidentEpisodeFeedEventType.OnCallPolicy,
      "This episode",
    ],
  ] as Array<
    [string, OnCallNotRunRecord, string, string, string, string, string]
  >)(
    "%s: one grey on-call entry in its own feed, naming it as its feed does, posted nowhere else",
    async (
      _name: string,
      record: OnCallNotRunRecord,
      feed: string,
      recordKey: string,
      eventTypeKey: string,
      eventType: string,
      named: string,
    ) => {
      await OnCallNotRunOnCreate.createFeedItem({
        record: record,
        projectId: PROJECT_ID,
        stage: StartingStage.Resolved,
        policies: listed([PRIMARY]),
      });

      expect(written).toHaveLength(1);
      expect(written[0]!.feed).toBe(feed);

      const item: Record<string, unknown> = written[0]!.item;
      expect(String(item[recordKey])).toBe(RECORD_ID.toString());
      expect(String(item["projectId"])).toBe(PROJECT_ID.toString());
      expect(item[eventTypeKey]).toBe(eventType);
      expect(item["displayColor"]).toBe(Gray500);
      expect(item["feedInfoInMarkdown"]).toBe(
        `📞 **No one was paged.** ${named} was created already resolved, so its on-call policy **Primary** was not run.`,
      );
      // Not posted to Slack or Microsoft Teams, and written as OneUptime.
      expect(item["workspaceNotification"]).toBeUndefined();
      expect(item["userId"]).toBeUndefined();
    },
  );

  test("the stage it was handed is the one the line names", async () => {
    await OnCallNotRunOnCreate.createFeedItem({
      record: { alertId: RECORD_ID },
      projectId: PROJECT_ID,
      stage: StartingStage.Acknowledged,
      policies: listed([PRIMARY]),
    });

    expect(String(written[0]!.item["feedInfoInMarkdown"])).toContain(
      "was created already acknowledged",
    );
  });

  test("nothing is written when the record lists no policy", async () => {
    await OnCallNotRunOnCreate.createFeedItem({
      record: { incidentId: RECORD_ID },
      projectId: PROJECT_ID,
      stage: StartingStage.Acknowledged,
      policies: [],
    });

    expect(written).toEqual([]);
  });

  test("nothing is written when none of its policies exists any more", async () => {
    jest.restoreAllMocks();
    stubFeed(IncidentFeedService, "createIncidentFeedItem", "incident");
    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([] as never);

    await OnCallNotRunOnCreate.createFeedItem({
      record: { incidentId: RECORD_ID },
      projectId: PROJECT_ID,
      stage: StartingStage.Resolved,
      policies: listed([DELETED]),
    });

    expect(written).toEqual([]);
  });
});
