import KubernetesResourceService from "../../../Server/Services/KubernetesResourceService";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * Which Kubernetes nodes and pods hold an address a Traffic page shows
 * (issue #5340): one statement for a page's addresses, pinned to the
 * project, every value bound, at most `limit` ids back - and only ids. A
 * node holds its InternalIP and ExternalIP addresses; a pod its own podIP,
 * never the node's address it shares on the host network.
 * NetworkAddressNamesPostgres runs the statement against real rows.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const POD: string = "72000000-0000-4000-8000-000000000001";
const NODE: string = "71000000-0000-4000-8000-000000000001";

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

let query: Mock<QueryFunction>;

beforeEach(() => {
  query = jest.fn<QueryFunction>(async (): Promise<unknown> => {
    return [];
  });

  jest.spyOn(KubernetesResourceService, "getRepository").mockReturnValue({
    manager: { query: query },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("KubernetesResourceService.findIdsHoldingAddresses", () => {
  test("one statement, pinned to the project, its addresses and limit bound", async () => {
    await KubernetesResourceService.findIdsHoldingAddresses({
      projectId: PROJECT,
      addresses: ["10.242.0.9", " 2001:DB8::5 ", "10.242.0.9", ""],
      limit: 500,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0]!;

    expect(sql).toContain(`WHERE "projectId" = $1`);
    expect(sql).toContain(`AND "deletedAt" IS NULL`);
    expect(sql).toContain("LIMIT $3");
    expect(parameters).toEqual([
      PROJECT.toString(),
      ["10.242.0.9", "2001:db8::5"],
      500,
    ]);
  });

  test("a pod by its own podIP only - not one on its node's network", async () => {
    await KubernetesResourceService.findIdsHoldingAddresses({
      projectId: PROJECT,
      addresses: ["10.242.0.9"],
      limit: 10,
    });

    const sql: string = query.mock.calls[0]![0];

    expect(sql).toContain(`"kind" = 'Pod'`);
    expect(sql).toContain(`LOWER("status" ->> 'podIP') = ANY($2::text[])`);
    expect(sql).toContain(
      `COALESCE("status" ->> 'hostIP', '') <> COALESCE("status" ->> 'podIP', '')`,
    );
  });

  test("a node by an InternalIP or ExternalIP entry of status.addresses", async () => {
    await KubernetesResourceService.findIdsHoldingAddresses({
      projectId: PROJECT,
      addresses: ["10.34.0.1"],
      limit: 10,
    });

    const sql: string = query.mock.calls[0]![0];

    expect(sql).toContain(`"kind" = 'Node'`);
    expect(sql).toContain(`jsonb_array_elements("status" -> 'addresses')`);
    expect(sql).toContain(`->> 'type' IN ('InternalIP', 'ExternalIP')`);
    expect(sql).toContain(
      `LOWER(node_address.item ->> 'address') = ANY($2::text[])`,
    );
  });

  test("answers the ids, and nothing that is not one", async () => {
    query.mockResolvedValue([
      { _id: POD },
      { _id: NODE },
      { _id: "not-an-id" },
      null,
      { other: 1 },
    ]);

    const ids: Array<ObjectID> =
      await KubernetesResourceService.findIdsHoldingAddresses({
        projectId: PROJECT,
        addresses: ["10.242.0.9"],
        limit: 10,
      });

    expect(
      ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([POD, NODE]);
  });

  test("no addresses, or no room, reads nothing", async () => {
    expect(
      await KubernetesResourceService.findIdsHoldingAddresses({
        projectId: PROJECT,
        addresses: ["", "  "],
        limit: 10,
      }),
    ).toEqual([]);
    expect(
      await KubernetesResourceService.findIdsHoldingAddresses({
        projectId: PROJECT,
        addresses: ["10.0.0.1"],
        limit: 0,
      }),
    ).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test("an answer that is not a list is no ids", async () => {
    query.mockResolvedValue({ rows: [{ _id: POD }] });

    expect(
      await KubernetesResourceService.findIdsHoldingAddresses({
        projectId: PROJECT,
        addresses: ["10.242.0.9"],
        limit: 10,
      }),
    ).toEqual([]);
  });
});
