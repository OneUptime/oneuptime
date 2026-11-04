import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OpenStackResourceAPI from "../../../Server/API/OpenStackResourceAPI";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";

/*
 * POST /openstack-resource/counts/:cloudId   { kind, by }
 *
 * What a request says it wants counted by chooses a column of a GROUP BY, so the route
 * refuses anything not on the closed list before the service runs, and only ever counts a
 * cloud the caller may read. The statement itself is held on Postgres in
 * OpenStackResourcePostgres.test.ts; here are the two doors in front of it.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();

interface CountsApi {
  getCounts: (req: unknown, res: unknown) => Promise<void>;
  resolveCloudForRequest: () => Promise<unknown>;
  service: { getCounts: (data: JSONObject) => Promise<Array<JSONObject>> };
}

function apiWith(data: {
  counted: (data: JSONObject) => Promise<Array<JSONObject>>;
  resolve?: () => Promise<unknown>;
}): CountsApi {
  // Not constructed: its constructor registers routes, and these call one handler.
  const api: CountsApi = Object.create(
    OpenStackResourceAPI.prototype,
  ) as CountsApi;
  api.resolveCloudForRequest =
    data.resolve ||
    (async (): Promise<unknown> => {
      return { projectId: PROJECT_ID, openStackCloudId: CLOUD_ID };
    });
  api.service = { getCounts: data.counted };
  return api;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the counts route lets through", () => {
  test("a count on the list reaches the service with this cloud, and comes back as rows", async () => {
    const counted: jest.Mock<(data: JSONObject) => Promise<Array<JSONObject>>> =
      jest.fn(async (): Promise<Array<JSONObject>> => {
        return [{ value: "small", regionName: "RegionOne", count: 2 }];
      });
    const send: unknown = jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    await apiWith({ counted }).getCounts(
      { body: { kind: OpenStackResourceKind.Instance, by: "flavor" } },
      {},
    );

    expect(counted).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      kind: OpenStackResourceKind.Instance,
      by: "flavor",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test.each<[string, JSONObject]>([
    ["a word that isn't on the list", { kind: "Instance", by: "status" }],
    ["a pair that isn't", { kind: "Hypervisor", by: "project" }],
    ["SQL", { kind: "Instance", by: '"kind"; DROP TABLE "OpenStackResource"' }],
    ["what every object answers to", { kind: "constructor", by: "project" }],
    ["nothing", {}],
  ])(
    "%s is refused before anything is read",
    async (_name: string, body: JSONObject) => {
      const counted: jest.Mock<
        (data: JSONObject) => Promise<Array<JSONObject>>
      > = jest.fn(async (): Promise<Array<JSONObject>> => {
        return [];
      });

      await expect(
        apiWith({ counted }).getCounts({ body }, {}),
      ).rejects.toThrow(BadDataException);
      expect(counted).not.toHaveBeenCalled();
    },
  );

  test("a cloud the caller may not read stops it before anything is read", async () => {
    const counted: jest.Mock<(data: JSONObject) => Promise<Array<JSONObject>>> =
      jest.fn(async (): Promise<Array<JSONObject>> => {
        return [];
      });

    await expect(
      apiWith({
        counted,
        resolve: async (): Promise<unknown> => {
          throw new NotAuthorizedException("You can't read this cloud");
        },
      }).getCounts(
        { body: { kind: OpenStackResourceKind.Instance, by: "flavor" } },
        {},
      ),
    ).rejects.toThrow(NotAuthorizedException);
    expect(counted).not.toHaveBeenCalled();
  });
});
