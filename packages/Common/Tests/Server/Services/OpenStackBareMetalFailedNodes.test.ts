import OpenStackResourceService from "../../../Server/Services/OpenStackResourceService";
import OpenStackResourceAPI from "../../../Server/API/OpenStackResourceAPI";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_BARE_METAL_FAILED_NODES_LIMIT,
  OPENSTACK_BARE_METAL_RESOURCE_CLASS_MAX_LENGTH,
} from "../../../Types/OpenStack/OpenStackBareMetal";
import {
  OPENSTACK_BARE_METAL_ERROR_STATES,
  OpenStackResourceKind,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

// @CaptureSpan logs through the logger; nothing here is about logging.
jest.mock("../../../Server/Utils/Logger");

/*
 * A BARE METAL CLASS'S FAILED NODES, AS ITS "FAILED: N" OPENS THEM (#9751).
 *
 * The Bare Metal page's Capacity by resource class card counts each class's
 * failed nodes (getBareMetalClasses: a status in
 * OPENSTACK_BARE_METAL_ERROR_STATES). Pressed, the count lists those very
 * nodes: POST /openstack-resource/bare-metal-failed-nodes, one bounded,
 * indexed read of the cloud's rows. Here: the statement and what it is
 * handed, the bound and truncation, and the request's resource class.
 * OpenStackResourcePostgres runs the statement on real rows, beside the
 * class count.
 */

type QueryFunction = (sql: string, parameters: Array<unknown>) => unknown;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLOUD_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

function nodeRows(count: number): Array<JSONObject> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return {
      _id: `row-${index}`,
      kind: OpenStackResourceKind.BareMetalNode,
      externalId: `node-${index}`,
      name: `node-${String(index).padStart(3, "0")}`,
      status: "deploy failed",
      memoryCapacityBytes: "1024",
      facts: { resourceClass: "gold", lastError: "IPMI call timed out" },
    };
  });
}

describe("the failed nodes of a class", () => {
  let query: Mock<QueryFunction>;

  beforeEach(() => {
    query = jest.fn<QueryFunction>();
    jest.spyOn(OpenStackResourceService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("are read in one statement: the cloud's failed nodes of that class, by name, bounded", async () => {
    query.mockResolvedValue(nodeRows(2) as never);

    await OpenStackResourceService.getBareMetalFailedNodes({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      resourceClass: "gold",
      regionName: "RegionOne",
    });

    expect(query).toHaveBeenCalledTimes(1);

    const [sql, parameters] = query.mock.calls[0] as [string, Array<unknown>];
    const statement: string = sql.replace(/\s+/g, " ");

    expect(statement).toContain(
      `"projectId" = $1 AND "openStackCloudId" = $2 AND "kind" = '${OpenStackResourceKind.BareMetalNode}' AND "deletedAt" IS NULL`,
    );
    // The class count's own rule for failed.
    expect(statement).toContain(`AND "status" = ANY($3::text[])`);
    expect(statement).toContain(
      `AND (("facts"->>'resourceClass') = $4::text OR ($4::text IS NULL AND ("facts"->>'resourceClass') IS NULL))`,
    );
    expect(statement).toContain(`AND ($5::text IS NULL OR "regionName" = $5)`);
    expect(statement).toContain(
      `ORDER BY "name" ASC NULLS LAST, "externalId" ASC`,
    );
    expect(statement).toContain(
      `LIMIT ${OPENSTACK_BARE_METAL_FAILED_NODES_LIMIT + 1}`,
    );

    expect(parameters).toEqual([
      PROJECT_ID.toString(),
      CLOUD_ID.toString(),
      Array.from(OPENSTACK_BARE_METAL_ERROR_STATES),
      "gold",
      "RegionOne",
    ]);
  });

  test("the nodes with no class are asked for as null, and every region when none is named", async () => {
    query.mockResolvedValue([] as never);

    await OpenStackResourceService.getBareMetalFailedNodes({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      resourceClass: null,
    });

    const parameters: Array<unknown> = query.mock.calls[0]![1];

    expect(parameters[3]).toBeNull();
    expect(parameters[4]).toBeNull();
  });

  test("hands back the rows, numbers as numbers, and says when there were more than it lists", async () => {
    query.mockResolvedValue(
      nodeRows(OPENSTACK_BARE_METAL_FAILED_NODES_LIMIT + 1) as never,
    );

    const read: { rows: Array<JSONObject>; isTruncated: boolean } =
      await OpenStackResourceService.getBareMetalFailedNodes({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        resourceClass: "gold",
      });

    expect(read.isTruncated).toBe(true);
    expect(read.rows).toHaveLength(OPENSTACK_BARE_METAL_FAILED_NODES_LIMIT);
    // Postgres hands a bigint back as text; the rules compare numbers.
    expect(read.rows[0]?.["memoryCapacityBytes"]).toBe(1024);
    expect((read.rows[0]?.["facts"] as JSONObject)["lastError"]).toBe(
      "IPMI call timed out",
    );
  });

  test("as many as it lists is not more", async () => {
    query.mockResolvedValue(
      nodeRows(OPENSTACK_BARE_METAL_FAILED_NODES_LIMIT) as never,
    );

    const read: { rows: Array<JSONObject>; isTruncated: boolean } =
      await OpenStackResourceService.getBareMetalFailedNodes({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        resourceClass: "gold",
      });

    expect(read.isTruncated).toBe(false);
    expect(read.rows).toHaveLength(OPENSTACK_BARE_METAL_FAILED_NODES_LIMIT);
  });
});

describe("the resource class a request names", () => {
  test("is a class's name, or null for the nodes with none", () => {
    expect(
      OpenStackResourceAPI.readResourceClass({ resourceClass: "gold" }),
    ).toBe("gold");
    expect(
      OpenStackResourceAPI.readResourceClass({ resourceClass: null }),
    ).toBe(null);
    // Grouped apart from null, as Postgres groups it.
    expect(OpenStackResourceAPI.readResourceClass({ resourceClass: "" })).toBe(
      "",
    );
  });

  test("anything else is refused, never read as every class", () => {
    for (const body of [
      undefined,
      {},
      { resourceClass: 7 },
      { resourceClass: ["gold"] },
      { resourceClass: { name: "gold" } },
      {
        resourceClass: "g".repeat(
          OPENSTACK_BARE_METAL_RESOURCE_CLASS_MAX_LENGTH + 1,
        ),
      },
    ]) {
      expect(() => {
        return OpenStackResourceAPI.readResourceClass(
          body as JSONObject | undefined,
        );
      }).toThrow(BadDataException);
    }
  });
});
