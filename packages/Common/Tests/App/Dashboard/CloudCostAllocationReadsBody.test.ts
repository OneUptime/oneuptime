import { afterEach, describe, expect, jest, test } from "@jest/globals";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CloudCostAllocationInterval } from "../../../Types/Cloud/CloudCostAllocation";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import { getJestSpyOn } from "../../Spy";
import {
  CloudCostAllocationAsk,
  fetchCloudCostAllocation,
  fetchCloudCostGroupSpend,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostAllocationReads";

/*
 * WHAT A COST VIEW'S ALLOCATION AND A GROUP'S SPEND ASK THE SERVER (#11006).
 *
 * Both send the same body: the period, and of the interval, currency, cost
 * basis and accounts only what the page set - the server reads anything left
 * out as its default (the project's basis, every account). These pin the
 * body as each read sends it.
 */

const VIEW_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const GROUP_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ACCOUNT_A: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ACCOUNT_B: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const START: Date = new Date("2026-11-01T00:00:00.000Z");
const END: Date = new Date("2026-11-30T23:59:59.999Z");

interface Sent {
  url: string;
  body: JSONObject;
}

// Answers every post with an empty object, and keeps what each one sent.
function recordPosts(): Array<Sent> {
  const sent: Array<Sent> = [];

  getJestSpyOn(API, "post").mockImplementation((async (options: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<unknown> => {
    sent.push({ url: options.url.toString(), body: options.data });

    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never);

  return sent;
}

async function bothReads(ask: CloudCostAllocationAsk): Promise<Array<Sent>> {
  const sent: Array<Sent> = recordPosts();

  await fetchCloudCostAllocation({ viewId: VIEW_ID, ask });
  await fetchCloudCostGroupSpend({ groupId: GROUP_ID, ask });

  return sent;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the body a cost view's allocation and a group's spend send", () => {
  test("with only a period: the period, and nothing the page did not set", async () => {
    const sent: Array<Sent> = await bothReads({
      startDate: START,
      endDate: END,
    });

    expect(sent).toHaveLength(2);
    expect(sent[0]!.url).toContain(
      `/cloud-cost-view/${VIEW_ID.toString()}/allocation`,
    );
    expect(sent[1]!.url).toContain(
      `/cloud-cost-group/${GROUP_ID.toString()}/spend`,
    );

    for (const { body } of sent) {
      expect(body).toEqual({
        startDate: "2026-11-01T00:00:00.000Z",
        endDate: "2026-11-30T23:59:59.999Z",
      });
    }
  });

  test("with everything set: the interval, currency, basis and accounts, the accounts as their ids", async () => {
    const sent: Array<Sent> = await bothReads({
      startDate: START,
      endDate: END,
      interval: CloudCostAllocationInterval.Month,
      currency: "EUR",
      basis: CloudCostBasis.Net,
      cloudAccountIds: [ACCOUNT_A, ACCOUNT_B],
    });

    for (const { body } of sent) {
      expect(body).toEqual({
        startDate: "2026-11-01T00:00:00.000Z",
        endDate: "2026-11-30T23:59:59.999Z",
        interval: "month",
        currency: "EUR",
        basis: CloudCostBasis.Net,
        cloudAccountIds: [ACCOUNT_A.toString(), ACCOUNT_B.toString()],
      });
    }
  });

  test("an empty list of accounts, an empty currency and no basis are left out, as never set", async () => {
    const sent: Array<Sent> = await bothReads({
      startDate: START,
      endDate: END,
      currency: "",
      basis: undefined,
      cloudAccountIds: [],
    });

    for (const { body } of sent) {
      expect(Object.keys(body).sort()).toEqual(["endDate", "startDate"]);
    }
  });
});
