import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import OnCallNotRunOnCreate from "../../../../Server/Utils/OnCall/OnCallNotRunOnCreate";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
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
      policyNames: ["![x](https://tracker.example/p) **bold** [team]\n# heading"],
    });

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

describe("OnCallNotRunOnCreate.getFeedMarkdown - the line for the policies a record names", () => {
  // Each read of the policies: what it asked for.
  let reads: Array<{
    ids: Array<string>;
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
        const asked: string = JSON.stringify(findBy.query).toLowerCase();
        const ids: Array<string> = Object.keys(NAMES)
          .concat([DELETED])
          .filter((id: string): boolean => {
            return asked.includes(id);
          });

        reads.push({ ids: ids, select: findBy.select, props: findBy.props });

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
    const markdown: string | null = await OnCallNotRunOnCreate.getFeedMarkdown(
      {
        noun: "incident",
        stage: StartingStage.Acknowledged,
        policyIds: [new ObjectID(PRIMARY), new ObjectID(DATABASE)],
      },
    );

    expect(markdown).toBe(
      "📞 **No one was paged.** This incident was created already acknowledged, so its on-call policies **Primary** and **Database** were not run.",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]!.ids.sort()).toEqual([DATABASE, PRIMARY].sort());
    expect(reads[0]!.select).toEqual({ _id: true, name: true });
    expect(reads[0]!.props).toEqual({ isRoot: true });
  });

  test("a policy listed twice, in any letter case, is named once", async () => {
    const markdown: string | null = await OnCallNotRunOnCreate.getFeedMarkdown(
      {
        noun: "alert",
        stage: StartingStage.Resolved,
        policyIds: [PRIMARY, PRIMARY.toUpperCase(), new ObjectID(PRIMARY)],
      },
    );

    expect(markdown).toBe(
      "📞 **No one was paged.** This alert was created already resolved, so its on-call policy **Primary** was not run.",
    );
  });

  test("a policy deleted since is left out of the line", async () => {
    const markdown: string | null = await OnCallNotRunOnCreate.getFeedMarkdown(
      {
        noun: "episode",
        stage: StartingStage.Resolved,
        policyIds: [DELETED, PAYMENTS],
      },
    );

    expect(markdown).toBe(
      "📞 **No one was paged.** This episode was created already resolved, so its on-call policy **Payments** was not run.",
    );
  });

  test("no line when every policy it named is gone: there was nobody to page", async () => {
    expect(
      await OnCallNotRunOnCreate.getFeedMarkdown({
        noun: "incident",
        stage: StartingStage.Acknowledged,
        policyIds: [DELETED],
      }),
    ).toBeNull();
  });

  test("no line, and no read, when the record names no policy", async () => {
    expect(
      await OnCallNotRunOnCreate.getFeedMarkdown({
        noun: "incident",
        stage: StartingStage.Acknowledged,
        policyIds: [],
      }),
    ).toBeNull();
    expect(
      await OnCallNotRunOnCreate.getFeedMarkdown({
        noun: "incident",
        stage: StartingStage.Acknowledged,
        policyIds: [""],
      }),
    ).toBeNull();
    expect(reads).toEqual([]);
  });

  test("a policy with no name is still named, as an unnamed policy", async () => {
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
        policyIds: [PRIMARY],
      }),
    ).toBe(
      "📞 **No one was paged.** This incident was created already acknowledged, so its on-call policy **Unnamed policy** was not run.",
    );
  });
});
