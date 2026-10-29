import AffectedResourceReferences, {
  AFFECTED_RESOURCE_REFERENCE_COLUMNS,
  AffectedResourceReferenceResolution,
} from "../../../../Server/Utils/AffectedResources/AffectedResourceReferences";
import {
  AFFECTED_RESOURCE_KIND_SEARCH_SPECS,
  getAffectedResourceKindService,
} from "../../../../Server/Utils/AffectedResources/AffectedResourceSearch";
import logger from "../../../../Server/Utils/Logger";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { AffectedResourceKind } from "../../../../Types/AffectedResources/AffectedResourceSearch";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_LINKED_AFFECTED_RESOURCES } from "../../../../Types/Workflow/AffectedResourcesSetting";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a workflow's Affected Resources names (issue #5341): an alert from
 * another tool names its host "WAN-RTR-01" or "10.0.4.1", and each such
 * reference is looked for in every kind the record can hold - whole, in
 * any case - by the columns the kind is known by: its name, a device's
 * polled address and DNS name, a host's agent-reported name and its
 * addresses, a cloud resource's provider ID. An ID is the resource with
 * that ID. Never a description: a reference links what it names, not what
 * merely mentions it. Every kind is read with the caller's props.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5b1f0a0e-1111-4c1e-9a1e-000000000001",
);

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("7c1f0a0e-2222-4c1e-9a1e-000000000002"),
} as DatabaseCommonInteractionProps;

let seq: number = 0;

function uuid(): string {
  seq++;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function rowOf(
  kind: AffectedResourceKind,
  name: string,
  extra: Record<string, unknown> = {},
): BaseModel {
  const row: BaseModel = new AFFECTED_RESOURCE_KIND_SEARCH_SPECS[
    kind
  ].modelType();
  row._id = (extra["_id"] as string) || uuid();
  (row as unknown as Record<string, unknown>)["name"] = name;

  for (const key of Object.keys(extra)) {
    if (key !== "_id") {
      (row as unknown as Record<string, unknown>)[key] = extra[key];
    }
  }

  return row;
}

/*
 * Each kind's findBy, stubbed: answers the rows whose columns the query
 * names - by id, or by a column the query asks about - as the database
 * would. The QueryHelper operators are marked so the stub can read them.
 */
interface Marked {
  op: "same" | "list";
  texts: Array<string>;
}

function isMarked(value: unknown): value is Marked {
  return Boolean(
    value &&
      typeof value === "object" &&
      "op" in (value as Record<string, unknown>),
  );
}

function stubKind(
  kind: AffectedResourceKind,
  rows: Array<BaseModel>,
  error?: Error,
): jest.Mock {
  const service: { findBy: (data: unknown) => Promise<Array<BaseModel>> } =
    getAffectedResourceKindService(kind) as never;

  return jest
    .spyOn(service, "findBy")
    .mockImplementation(async (data: unknown): Promise<Array<BaseModel>> => {
      if (error) {
        throw error;
      }

      const query: JSONObject = (data as { query: JSONObject }).query;

      return rows.filter((row: BaseModel): boolean => {
        const record: Record<string, unknown> = row as unknown as Record<
          string,
          unknown
        >;

        for (const key of Object.keys(query)) {
          const value: unknown = query[key];

          if (value instanceof Includes) {
            return (value.values as Array<string>).includes(
              String(row._id).toLowerCase(),
            );
          }

          if (isMarked(value)) {
            const text: string = String(record[key] || "").toLowerCase();

            return value.op === "list"
              ? text
                  .split(",")
                  .map((part: string): string => {
                    return part.trim();
                  })
                  .some((part: string): boolean => {
                    return value.texts.includes(part);
                  })
              : value.texts.includes(text.trim());
          }
        }

        return false;
      });
    }) as unknown as jest.Mock;
}

function queriesOf(mock: jest.Mock): Array<JSONObject> {
  return mock.mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { query: JSONObject }).query;
  });
}

async function resolve(
  references: Array<string>,
  kinds: Array<AffectedResourceKind>,
): Promise<AffectedResourceReferenceResolution> {
  return AffectedResourceReferences.resolve({
    projectId: PROJECT_ID,
    props: PROPS,
    references,
    kinds,
  });
}

beforeEach(() => {
  seq = 0;
  jest
    .spyOn(QueryHelper, "findWithSameTextAnyOf")
    .mockImplementation((texts: Array<string>): never => {
      return {
        op: "same",
        texts: texts.map((text: string): string => {
          return text.toLowerCase().trim();
        }),
      } as never;
    });
  jest
    .spyOn(QueryHelper, "listsAnyOf")
    .mockImplementation((texts: Array<string>): never => {
      return {
        op: "list",
        texts: texts.map((text: string): string => {
          return text.toLowerCase().trim();
        }),
      } as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a kind is known by", () => {
  test("its name, then identifiers only - never a description", () => {
    expect(
      AffectedResourceReferences.getReferenceColumns(
        AffectedResourceKind.NetworkDevice,
      ),
    ).toEqual([
      { column: "name", match: "text" },
      { column: "hostname", match: "text" },
      { column: "dnsName", match: "text" },
    ]);
    expect(
      AffectedResourceReferences.getReferenceColumns(AffectedResourceKind.Host),
    ).toEqual([
      { column: "name", match: "text" },
      { column: "hostIdentifier", match: "text" },
      { column: "hostIpAddresses", match: "list" },
    ]);
    expect(
      AffectedResourceReferences.getReferenceColumns(
        AffectedResourceKind.CloudResource,
      ),
    ).toEqual([
      { column: "name", match: "text" },
      { column: "providerResourceId", match: "text" },
    ]);
    expect(
      AffectedResourceReferences.getReferenceColumns(
        AffectedResourceKind.Service,
      ),
    ).toEqual([{ column: "name", match: "text" }]);
  });

  test("every column named is a column of the kind's model", () => {
    for (const [kind, columns] of Object.entries(
      AFFECTED_RESOURCE_REFERENCE_COLUMNS,
    )) {
      const model: BaseModel = new AFFECTED_RESOURCE_KIND_SEARCH_SPECS[
        kind as AffectedResourceKind
      ].modelType();

      for (const column of columns || []) {
        expect({
          kind,
          column: column.column,
          ok: model.hasColumn(column.column),
        }).toEqual({ kind, column: column.column, ok: true });
      }
    }

    for (const columns of Object.values(AFFECTED_RESOURCE_REFERENCE_COLUMNS)) {
      for (const column of columns || []) {
        expect(column.column).not.toBe("description");
      }
    }
  });
});

describe("getMatchedReferences - which references a row answers", () => {
  test("by its name, its address, one of its addresses, or its id - whole, in any case", () => {
    const id: string = "11111111-1111-4111-8111-111111111111";
    const device: BaseModel = rowOf(
      AffectedResourceKind.NetworkDevice,
      " WAN-RTR-01 ",
      { _id: id, hostname: "10.0.0.1", dnsName: "rtr1.corp.example" },
    );

    expect(
      AffectedResourceReferences.getMatchedReferences({
        kind: AffectedResourceKind.NetworkDevice,
        row: device,
        references: [
          "wan-rtr-01",
          "10.0.0.1",
          "RTR1.corp.example",
          id.toUpperCase(),
          "WAN-RTR",
          "10.0.0.10",
        ],
      }),
    ).toEqual([
      "wan-rtr-01",
      "10.0.0.1",
      "RTR1.corp.example",
      id.toUpperCase(),
    ]);

    const host: BaseModel = rowOf(AffectedResourceKind.Host, "web-01", {
      hostIdentifier: "ip-10-0-1-11.ec2.internal",
      hostIpAddresses: "10.0.1.11, fe80::1",
    });

    expect(
      AffectedResourceReferences.getMatchedReferences({
        kind: AffectedResourceKind.Host,
        row: host,
        references: ["FE80::1", "ip-10-0-1-11.ec2.internal", "10.0.1.1"],
      }),
    ).toEqual(["FE80::1", "ip-10-0-1-11.ec2.internal"]);
  });

  test("a description that mentions it is not a match", () => {
    expect(
      AffectedResourceReferences.getMatchedReferences({
        kind: AffectedResourceKind.Service,
        row: rowOf(AffectedResourceKind.Service, "checkout", {
          description: "talks to WAN-RTR-01",
        }),
        references: ["WAN-RTR-01"],
      }),
    ).toEqual([]);
  });
});

describe("resolve - every resource the references name", () => {
  test("no reference reads nothing", async () => {
    const hosts: jest.Mock = stubKind(AffectedResourceKind.Host, []);

    expect(await resolve(["  ", ""], [AffectedResourceKind.Host])).toEqual({
      resolved: [],
      notFound: [],
      unreadableKinds: [],
      leftOverCap: 0,
    });
    expect(hosts).not.toHaveBeenCalled();
  });

  test("each kind is asked by id and by each column it is known by, not archived, with the caller's props", async () => {
    const devices: jest.Mock = stubKind(AffectedResourceKind.NetworkDevice, []);
    const id: string = "22222222-2222-4222-8222-222222222222";

    await resolve(
      ["WAN-RTR-01", id.toUpperCase()],
      [AffectedResourceKind.NetworkDevice],
    );

    const queries: Array<JSONObject> = queriesOf(devices);

    expect(queries).toHaveLength(4);

    for (const query of queries) {
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["isArchived"]).toBe(false);
    }

    expect((queries[0]!["_id"] as Includes).values).toEqual([id]);
    expect(queries[1]!["name"]).toEqual({ op: "same", texts: ["wan-rtr-01"] });
    expect(queries[2]!["hostname"]).toEqual({
      op: "same",
      texts: ["wan-rtr-01"],
    });
    expect(queries[3]!["dnsName"]).toEqual({
      op: "same",
      texts: ["wan-rtr-01"],
    });

    const call: JSONObject = devices.mock.calls[0]![0] as JSONObject;

    expect(call["props"]).toBe(PROPS);
    expect(call["limit"]).toBe(MAX_LINKED_AFFECTED_RESOURCES + 1);
    expect(call["sort"]).toEqual({ name: SortOrder.Ascending });
    expect(call["select"]).toEqual({
      _id: true,
      name: true,
      hostname: true,
      dnsName: true,
    });
  });

  test("a host's addresses are matched as one value of their list", async () => {
    const hosts: jest.Mock = stubKind(AffectedResourceKind.Host, [
      rowOf(AffectedResourceKind.Host, "web-01", {
        hostIpAddresses: "10.0.1.11, 10.0.1.12",
      }),
    ]);

    const result: AffectedResourceReferenceResolution = await resolve(
      ["10.0.1.12"],
      [AffectedResourceKind.Host],
    );

    expect(
      queriesOf(hosts).some((query: JSONObject): boolean => {
        return (
          isMarked(query["hostIpAddresses"]) &&
          (query["hostIpAddresses"] as Marked).op === "list"
        );
      }),
    ).toBe(true);
    expect(result.resolved).toEqual([
      expect.objectContaining({
        kind: AffectedResourceKind.Host,
        name: "web-01",
        reference: "10.0.1.12",
      }),
    ]);
  });

  test("a router named by its address and a host by its name are both linked, kinds in the order asked", async () => {
    const router: BaseModel = rowOf(
      AffectedResourceKind.NetworkDevice,
      "WAN-RTR-01",
      { hostname: "10.0.4.1" },
    );
    const host: BaseModel = rowOf(AffectedResourceKind.Host, "app-server-01");

    stubKind(AffectedResourceKind.Host, [host]);
    stubKind(AffectedResourceKind.NetworkDevice, [router]);

    const result: AffectedResourceReferenceResolution = await resolve(
      ["10.0.4.1", "App-Server-01", "nothing-here"],
      [AffectedResourceKind.Host, AffectedResourceKind.NetworkDevice],
    );

    expect(result.resolved).toEqual([
      {
        kind: AffectedResourceKind.Host,
        id: String(host._id),
        name: "app-server-01",
        reference: "App-Server-01",
      },
      {
        kind: AffectedResourceKind.NetworkDevice,
        id: String(router._id),
        name: "WAN-RTR-01",
        reference: "10.0.4.1",
      },
    ]);
    // Said by name, as written.
    expect(result.notFound).toEqual(["nothing-here"]);
  });

  test("a name two kinds share links both: that is what was written", async () => {
    stubKind(AffectedResourceKind.Host, [
      rowOf(AffectedResourceKind.Host, "core-01"),
    ]);
    stubKind(AffectedResourceKind.NetworkDevice, [
      rowOf(AffectedResourceKind.NetworkDevice, "core-01"),
    ]);

    const result: AffectedResourceReferenceResolution = await resolve(
      ["core-01"],
      [AffectedResourceKind.Host, AffectedResourceKind.NetworkDevice],
    );

    expect(
      result.resolved.map((resource: { kind: string }): string => {
        return resource.kind;
      }),
    ).toEqual(["Host", "NetworkDevice"]);
    expect(result.notFound).toEqual([]);
  });

  test("a device found by its name and its address is linked once", async () => {
    stubKind(AffectedResourceKind.NetworkDevice, [
      rowOf(AffectedResourceKind.NetworkDevice, "WAN-RTR-01", {
        hostname: "10.0.4.1",
      }),
    ]);

    const result: AffectedResourceReferenceResolution = await resolve(
      ["WAN-RTR-01", "10.0.4.1"],
      [AffectedResourceKind.NetworkDevice],
    );

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.reference).toBe("WAN-RTR-01");
    expect(result.notFound).toEqual([]);
  });

  test("within a kind, resources are listed by name", async () => {
    stubKind(AffectedResourceKind.Host, [
      rowOf(AffectedResourceKind.Host, "zeta"),
      rowOf(AffectedResourceKind.Host, "alpha"),
    ]);

    const result: AffectedResourceReferenceResolution = await resolve(
      ["zeta", "alpha"],
      [AffectedResourceKind.Host],
    );

    expect(
      result.resolved.map((resource: { name: string }): string => {
        return resource.name;
      }),
    ).toEqual(["alpha", "zeta"]);
  });

  test("an id is lower-cased, so the same resource is never linked twice", async () => {
    const id: string = "33333333-3333-4333-8333-333333333333";

    stubKind(AffectedResourceKind.Service, [
      rowOf(AffectedResourceKind.Service, "checkout", { _id: id }),
    ]);

    const result: AffectedResourceReferenceResolution = await resolve(
      [id.toUpperCase()],
      [AffectedResourceKind.Service],
    );

    expect(result.resolved).toEqual([
      {
        kind: AffectedResourceKind.Service,
        id: id,
        name: "checkout",
        reference: id.toUpperCase(),
      },
    ]);
  });

  test.each([
    ["their role may not read it", new NotAuthorizedException("no")],
    ["the plan does not have it", new PaymentRequiredException("upgrade")],
  ])(
    "a kind is said unreadable, once, when %s; every other kind still links",
    async (_why: string, error: Error) => {
      stubKind(AffectedResourceKind.DatabaseServer, [], error);
      stubKind(AffectedResourceKind.Host, [
        rowOf(AffectedResourceKind.Host, "db-01"),
      ]);

      const result: AffectedResourceReferenceResolution = await resolve(
        ["db-01"],
        [AffectedResourceKind.DatabaseServer, AffectedResourceKind.Host],
      );

      expect(result.unreadableKinds).toEqual([
        AffectedResourceKind.DatabaseServer,
      ]);
      expect(result.resolved).toHaveLength(1);
    },
  );

  test("a kind that fails to read is logged and links nothing; the rest still link", async () => {
    stubKind(AffectedResourceKind.CephCluster, [], new Error("timeout"));
    stubKind(AffectedResourceKind.Host, [
      rowOf(AffectedResourceKind.Host, "ceph-mon-01"),
    ]);
    const errorLog: jest.Mock = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      }) as unknown as jest.Mock;

    const result: AffectedResourceReferenceResolution = await resolve(
      ["ceph-mon-01"],
      [AffectedResourceKind.CephCluster, AffectedResourceKind.Host],
    );

    expect(result.unreadableKinds).toEqual([]);
    expect(result.resolved).toHaveLength(1);
    expect(String(errorLog.mock.calls[0]![0])).toContain("CephCluster");
  });

  test(`links at most ${MAX_LINKED_AFFECTED_RESOURCES}, and says how many more matched`, async () => {
    const rows: Array<BaseModel> = Array.from(
      { length: 60 },
      (_value: unknown, index: number): BaseModel => {
        return rowOf(
          AffectedResourceKind.Host,
          `web-${String(index).padStart(2, "0")}`,
          {
            hostIpAddresses: "10.0.0.1",
          },
        );
      },
    );

    stubKind(AffectedResourceKind.Host, rows);

    const result: AffectedResourceReferenceResolution = await resolve(
      ["10.0.0.1"],
      [AffectedResourceKind.Host],
    );

    expect(result.resolved).toHaveLength(MAX_LINKED_AFFECTED_RESOURCES);
    expect(result.leftOverCap).toBe(60 - MAX_LINKED_AFFECTED_RESOURCES);
  });

  test("a row the read returns that answers no reference is not linked", async () => {
    const service: { findBy: (data: unknown) => Promise<Array<BaseModel>> } =
      getAffectedResourceKindService(AffectedResourceKind.Host) as never;

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([rowOf(AffectedResourceKind.Host, "something-else")]);

    const result: AffectedResourceReferenceResolution = await resolve(
      ["web-01"],
      [AffectedResourceKind.Host],
    );

    expect(result.resolved).toEqual([]);
    expect(result.notFound).toEqual(["web-01"]);
  });

  test("a kind that cannot be archived is not asked about it", async () => {
    const sites: jest.Mock = stubKind(AffectedResourceKind.NetworkSite, []);

    await resolve(["Mumbai"], [AffectedResourceKind.NetworkSite]);

    expect(queriesOf(sites)[0]!["isArchived"]).toBeUndefined();
  });
});
