import AffectedResourceSearch, {
  AFFECTED_RESOURCE_KIND_SEARCH_SPECS,
  AffectedResourceKindSearchSpec,
  getAffectedResourceKindService,
} from "../../../../Server/Utils/AffectedResources/AffectedResourceSearch";
import logger from "../../../../Server/Utils/Logger";
import ColumnPermissions from "../../../../Server/Types/Database/Permissions/ColumnPermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../Models/DatabaseModels/Host";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import {
  AFFECTED_RESOURCE_KINDS,
  AffectedResourceKind,
  AffectedResourceSearchMatch,
  AffectedResourceSearchResult,
} from "../../../../Types/AffectedResources/AffectedResourceSearch";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The server's half of the one Affected Resources search (issue #5341): a
 * customer read the picker as "a lookup against Hosts" because routers and
 * switches could not be found at all, and every kind it did search was
 * asked twice a keystroke. Now one request reads every kind the picker
 * offers, each through its own service with the caller's own props:
 *
 *   - a kind the caller may not read is named, never listed;
 *   - a column they may not read is never searched or shown;
 *   - archived resources are not offered for a new link;
 *   - the text is matched literally, in every field the kind is known by;
 *   - a page cut short still leads with the names that start with the text;
 *   - one kind that fails is left out, and every other kind still answers.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5b1f0a0e-1111-4c1e-9a1e-000000000001",
);

const ROOT: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID("7c1f0a0e-2222-4c1e-9a1e-000000000002"),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return { _type: "UserPermission", permission, labelIds: [] };
        }),
      },
    } as unknown as { [tenantId: string]: UserTenantAccessPermission },
  } as unknown as DatabaseCommonInteractionProps;
}

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

interface KindStub {
  findBy: jest.Mock;
  countBy: jest.Mock;
}

/*
 * Each kind's service, stubbed: findBy answers its rows (each call's rows
 * may differ - the page by name, then the page by prefix), countBy the
 * count. A kind left unstubbed is a failure the test did not plan for.
 */
function stubKind(
  kind: AffectedResourceKind,
  data: {
    rows?: Array<BaseModel> | Array<Array<BaseModel>>;
    count?: number;
    error?: Error;
  },
): KindStub {
  const service: {
    findBy: (data: unknown) => Promise<Array<BaseModel>>;
    countBy: (data: unknown) => Promise<PositiveNumber>;
  } = getAffectedResourceKindService(kind) as never;

  const pages: Array<Array<BaseModel>> =
    data.rows && Array.isArray(data.rows[0])
      ? (data.rows as Array<Array<BaseModel>>)
      : [(data.rows as Array<BaseModel>) || []];
  let call: number = 0;

  const findBy: jest.Mock = jest
    .spyOn(service, "findBy")
    .mockImplementation(async (): Promise<Array<BaseModel>> => {
      if (data.error) {
        throw data.error;
      }

      const page: Array<BaseModel> =
        pages[Math.min(call, pages.length - 1)] || [];
      call++;
      return page;
    }) as unknown as jest.Mock;

  const countBy: jest.Mock = jest
    .spyOn(service, "countBy")
    .mockImplementation(async (): Promise<PositiveNumber> => {
      if (data.error) {
        throw data.error;
      }

      return new PositiveNumber(data.count ?? (pages[0] ? pages[0].length : 0));
    }) as unknown as jest.Mock;

  return { findBy, countBy };
}

function argOf(mock: jest.Mock, index: number = 0): JSONObject {
  return mock.mock.calls[index]![0] as JSONObject;
}

function queryOf(mock: jest.Mock, index: number = 0): JSONObject {
  return argOf(mock, index)["query"] as JSONObject;
}

function names(matches: Array<AffectedResourceSearchMatch>): Array<string> {
  return matches.map((match: AffectedResourceSearchMatch): string => {
    return match.name;
  });
}

async function search(data: {
  kinds: Array<AffectedResourceKind>;
  search?: string;
  limitPerKind?: number;
  countKinds?: Array<AffectedResourceKind>;
  props?: DatabaseCommonInteractionProps;
}): Promise<AffectedResourceSearchResult> {
  return AffectedResourceSearch.search({
    projectId: PROJECT_ID,
    props: data.props || ROOT,
    request: {
      search: data.search || "",
      kinds: data.kinds,
      limitPerKind: data.limitPerKind || 15,
      countKinds: data.countKinds || [],
    },
  });
}

beforeEach(() => {
  seq = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what each kind is searched by", () => {
  test("every kind has a spec, read through its own service, of its own model", () => {
    for (const kind of AFFECTED_RESOURCE_KINDS) {
      const spec: AffectedResourceKindSearchSpec =
        AFFECTED_RESOURCE_KIND_SEARCH_SPECS[kind];
      const service: { modelType: unknown } = getAffectedResourceKindService(
        kind,
      ) as unknown as { modelType: unknown };

      expect({ kind, model: spec.modelType.name }).toEqual({
        kind,
        model: (service.modelType as { name: string }).name,
      });
    }
  });

  test("every field a kind is searched by is a column of its model, the name first", () => {
    for (const kind of AFFECTED_RESOURCE_KINDS) {
      const spec: AffectedResourceKindSearchSpec =
        AFFECTED_RESOURCE_KIND_SEARCH_SPECS[kind];
      const model: BaseModel = new spec.modelType();

      expect(spec.searchFields[0]).toBe("name");

      for (const field of spec.searchFields) {
        expect({ kind, field, isColumn: model.hasColumn(field) }).toEqual({
          kind,
          field,
          isColumn: true,
        });
      }

      if (spec.detailField) {
        expect(spec.searchFields).toContain(spec.detailField);
      }
    }
  });

  test("a network device is found by the address it is polled at and its DNS name, and shows its address", () => {
    expect(
      AFFECTED_RESOURCE_KIND_SEARCH_SPECS[AffectedResourceKind.NetworkDevice],
    ).toEqual({
      modelType: NetworkDevice,
      searchFields: ["name", "hostname", "dnsName", "description"],
      detailField: "hostname",
    });
  });

  test("a host is found by the name its agent reports and its addresses", () => {
    expect(
      AFFECTED_RESOURCE_KIND_SEARCH_SPECS[AffectedResourceKind.Host],
    ).toEqual({
      modelType: Host,
      searchFields: [
        "name",
        "hostIdentifier",
        "hostIpAddresses",
        "description",
      ],
    });
  });

  test("every other kind is found by its name and its description, as the picker always found it", () => {
    for (const kind of AFFECTED_RESOURCE_KINDS) {
      if (
        kind === AffectedResourceKind.NetworkDevice ||
        kind === AffectedResourceKind.Host
      ) {
        continue;
      }

      expect(AFFECTED_RESOURCE_KIND_SEARCH_SPECS[kind].searchFields).toEqual([
        "name",
        "description",
      ]);
    }
  });
});

describe("getReadableSearchFields - never a column the caller may not read", () => {
  test("root and a master admin search every field", () => {
    for (const props of [
      ROOT,
      { isMasterAdmin: true } as DatabaseCommonInteractionProps,
    ]) {
      expect(
        AffectedResourceSearch.getReadableSearchFields({
          kind: AffectedResourceKind.NetworkDevice,
          props,
        }),
      ).toEqual(["name", "hostname", "dnsName", "description"]);
    }
  });

  test("a project member searches what their role may read - every field of a device", () => {
    expect(
      AffectedResourceSearch.getReadableSearchFields({
        kind: AffectedResourceKind.NetworkDevice,
        props: memberProps([Permission.ProjectMember]),
      }),
    ).toEqual(["name", "hostname", "dnsName", "description"]);
  });

  test("someone who may read no column of a kind searches nothing, so the kind is unreadable", () => {
    expect(
      AffectedResourceSearch.getReadableSearchFields({
        kind: AffectedResourceKind.NetworkDevice,
        props: memberProps([]),
      }),
    ).toEqual([]);
  });

  test("a field they may not read is not searched, and without the name nothing is", () => {
    const spy: jest.Mock = jest
      .spyOn(ColumnPermissions, "getModelColumnsByPermissions")
      .mockReturnValue({
        columns: ["_id", "name", "description"],
      } as never) as unknown as jest.Mock;

    expect(
      AffectedResourceSearch.getReadableSearchFields({
        kind: AffectedResourceKind.NetworkDevice,
        props: memberProps([Permission.ProjectMember]),
      }),
    ).toEqual(["name", "description"]);
    expect(spy.mock.calls[0]![0]).toBe(NetworkDevice);

    spy.mockReturnValue({ columns: ["_id", "hostname", "description"] });

    expect(
      AffectedResourceSearch.getReadableSearchFields({
        kind: AffectedResourceKind.NetworkDevice,
        props: memberProps([Permission.ProjectMember]),
      }),
    ).toEqual([]);
  });
});

describe("buildKindQuery - the project's resources, not archived, with the text in a readable field", () => {
  test("no text asks for the project's resources, archived ones left out", () => {
    expect(
      AffectedResourceSearch.buildKindQuery({
        kind: AffectedResourceKind.NetworkDevice,
        projectId: PROJECT_ID,
        search: "",
        searchFields: ["name", "hostname"],
      }),
    ).toEqual({ projectId: PROJECT_ID, isArchived: false });
  });

  test("a kind that cannot be archived is not asked about it", () => {
    expect(
      AffectedResourceSearch.buildKindQuery({
        kind: AffectedResourceKind.NetworkSite,
        projectId: PROJECT_ID,
        search: "",
        searchFields: ["name"],
      }),
    ).toEqual({ projectId: PROJECT_ID });
  });

  test("the text is searched in every readable field, matched literally", () => {
    const query: JSONObject = AffectedResourceSearch.buildKindQuery({
      kind: AffectedResourceKind.NetworkDevice,
      projectId: PROJECT_ID,
      search: "50%_off\\x",
      searchFields: ["name", "hostname"],
    });
    const multi: MultiSearch = query[
      "_multiFieldSearch"
    ] as unknown as MultiSearch;

    expect(multi).toBeInstanceOf(MultiSearch);
    expect(multi.fields).toEqual(["name", "hostname"]);
    // A % or _ someone typed is not a wildcard, nor a backslash an escape.
    expect(multi.value).toBe("50\\%\\_off\\\\x");
    expect(query["isArchived"]).toBe(false);
  });

  test("the prefix read keeps the kind's own query and asks for names that start with the text", () => {
    const kindQuery: JSONObject = AffectedResourceSearch.buildKindQuery({
      kind: AffectedResourceKind.NetworkDevice,
      projectId: PROJECT_ID,
      search: "sw_1",
      searchFields: ["name", "hostname"],
    });
    const query: JSONObject = AffectedResourceSearch.buildNamePrefixQuery({
      kindQuery,
      search: "sw_1",
    });

    expect(query["_multiFieldSearch"]).toBeUndefined();
    expect(query["name"]).toBeInstanceOf(StartsWith);
    expect((query["name"] as unknown as StartsWith<string>).value).toBe(
      "sw\\_1",
    );
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["isArchived"]).toBe(false);
    // The kind's own query is left as it was.
    expect(kindQuery["_multiFieldSearch"]).toBeInstanceOf(MultiSearch);
    expect(kindQuery["name"]).toBeUndefined();
  });
});

describe("rankMatches - the order a person scans them in", () => {
  const match: (name: string) => AffectedResourceSearchMatch = (
    name: string,
  ): AffectedResourceSearchMatch => {
    return { _id: uuid(), name };
  };

  test("the name typed first, then names that start with it, then the rest, each group by name as read", () => {
    expect(
      names(
        AffectedResourceSearch.rankMatches({
          matches: [
            match("access-sw-01"),
            match("core-sw-02"),
            match("sw-lab"),
            match("SW"),
            match("sw-core"),
          ],
          search: "sw",
        }),
      ),
    ).toEqual(["SW", "sw-lab", "sw-core", "access-sw-01", "core-sw-02"]);
  });

  test("case and surrounding space do not matter", () => {
    expect(
      names(
        AffectedResourceSearch.rankMatches({
          matches: [match("edge-wan-rtr"), match(" WAN-RTR-01 ")],
          search: "  wan-rtr-01 ",
        }),
      ),
    ).toEqual([" WAN-RTR-01 ", "edge-wan-rtr"]);
  });

  test("no text keeps the order read", () => {
    const matches: Array<AffectedResourceSearchMatch> = [
      match("b"),
      match("a"),
    ];

    expect(AffectedResourceSearch.rankMatches({ matches, search: "" })).toEqual(
      matches,
    );
  });
});

describe("toMatch - a row as the picker lists it", () => {
  test("its id and name", () => {
    expect(
      AffectedResourceSearch.toMatch({
        row: rowOf(AffectedResourceKind.Host, "app-01", {
          _id: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    ).toEqual({ _id: "11111111-1111-4111-8111-111111111111", name: "app-01" });
  });

  test("a device's address beside its name, trimmed, unless it only repeats the name", () => {
    const id: string = "22222222-2222-4222-8222-222222222222";

    expect(
      AffectedResourceSearch.toMatch({
        row: rowOf(AffectedResourceKind.NetworkDevice, "WAN-RTR-01", {
          _id: id,
          hostname: " 10.0.0.1 ",
        }),
        detailField: "hostname",
      }),
    ).toEqual({ _id: id, name: "WAN-RTR-01", detail: "10.0.0.1" });

    for (const hostname of ["wan-rtr-01", "  ", undefined, 42]) {
      expect(
        AffectedResourceSearch.toMatch({
          row: rowOf(AffectedResourceKind.NetworkDevice, "WAN-RTR-01", {
            _id: id,
            hostname,
          }),
          detailField: "hostname",
        }),
      ).toEqual({ _id: id, name: "WAN-RTR-01" });
    }
  });

  test("a row without a real id is no match, and a name that is not text reads as empty", () => {
    expect(
      AffectedResourceSearch.toMatch({
        row: rowOf(AffectedResourceKind.Host, "x", { _id: "not-an-id" }),
      }),
    ).toBeNull();

    const row: BaseModel = rowOf(AffectedResourceKind.Host, "x", {
      _id: "33333333-3333-4333-8333-333333333333",
    });
    (row as unknown as Record<string, unknown>)["name"] = 7;

    expect(AffectedResourceSearch.toMatch({ row })).toEqual({
      _id: "33333333-3333-4333-8333-333333333333",
      name: "",
    });
  });
});

describe("search - every kind asked for, in one request", () => {
  test("lists each kind in the order asked, each read with the caller's props, sorted by name, a page each", async () => {
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.ProjectMember,
    ]);
    const hosts: KindStub = stubKind(AffectedResourceKind.Host, {
      rows: [rowOf(AffectedResourceKind.Host, "app-server-01")],
    });
    const devices: KindStub = stubKind(AffectedResourceKind.NetworkDevice, {
      rows: [
        rowOf(AffectedResourceKind.NetworkDevice, "WAN-RTR-01", {
          hostname: "10.0.0.1",
        }),
      ],
    });

    const result: AffectedResourceSearchResult = await search({
      kinds: [AffectedResourceKind.NetworkDevice, AffectedResourceKind.Host],
      limitPerKind: 15,
      props,
    });

    expect(
      result.kinds.map((kind: { kind: string }): string => {
        return kind.kind;
      }),
    ).toEqual(["NetworkDevice", "Host"]);
    expect(result.kinds[0]!.matches[0]).toMatchObject({
      name: "WAN-RTR-01",
      detail: "10.0.0.1",
    });
    expect(result.unreadableKinds).toEqual([]);

    for (const stub of [hosts, devices]) {
      const arg: JSONObject = argOf(stub.findBy);

      expect(arg["props"]).toBe(props);
      expect(arg["limit"]).toBe(15);
      expect(arg["skip"]).toBe(0);
      expect(arg["sort"]).toEqual({ name: SortOrder.Ascending });
      expect(queryOf(stub.findBy)["projectId"]).toBe(PROJECT_ID);
      expect(argOf(stub.countBy)["props"]).toBe(props);
      expect(queryOf(stub.countBy)).toEqual(queryOf(stub.findBy));
    }

    // Only what the row shows is read: its id, its name and its address.
    expect(argOf(devices.findBy)["select"]).toEqual({
      _id: true,
      name: true,
      hostname: true,
    });
    expect(argOf(hosts.findBy)["select"]).toEqual({ _id: true, name: true });
  });

  test("the text is searched in each kind's fields, and archived resources are left out", async () => {
    const devices: KindStub = stubKind(AffectedResourceKind.NetworkDevice, {
      rows: [],
    });

    await search({
      kinds: [AffectedResourceKind.NetworkDevice],
      search: "10.0.4",
    });

    const query: JSONObject = queryOf(devices.findBy);
    const multi: MultiSearch = query[
      "_multiFieldSearch"
    ] as unknown as MultiSearch;

    expect(query["isArchived"]).toBe(false);
    expect(multi.fields).toEqual([
      "name",
      "hostname",
      "dnsName",
      "description",
    ]);
    expect(multi.value).toBe("10.0.4");
  });

  test("a kind's count is every match, not only the page, and never below the page", async () => {
    stubKind(AffectedResourceKind.Host, {
      rows: [
        rowOf(AffectedResourceKind.Host, "app-01"),
        rowOf(AffectedResourceKind.Host, "app-02"),
      ],
      count: 240,
    });
    stubKind(AffectedResourceKind.Service, {
      rows: [
        rowOf(AffectedResourceKind.Service, "checkout"),
        rowOf(AffectedResourceKind.Service, "payments"),
      ],
      count: 1,
    });

    const result: AffectedResourceSearchResult = await search({
      kinds: [AffectedResourceKind.Host, AffectedResourceKind.Service],
    });

    expect(result.kinds[0]!.count).toBe(240);
    expect(result.kinds[1]!.count).toBe(2);
  });

  test("a count-only kind is counted, never listed", async () => {
    stubKind(AffectedResourceKind.Host, { rows: [] });
    const monitors: KindStub = stubKind(AffectedResourceKind.Monitor, {
      rows: [],
      count: 3,
    });

    const result: AffectedResourceSearchResult = await search({
      kinds: [AffectedResourceKind.Host],
      countKinds: [AffectedResourceKind.Monitor],
      search: "api",
    });

    expect(result.counts).toEqual([
      { kind: AffectedResourceKind.Monitor, count: 3 },
    ]);
    expect(monitors.findBy).not.toHaveBeenCalled();
    expect(queryOf(monitors.countBy)["_multiFieldSearch"]).toBeInstanceOf(
      MultiSearch,
    );
  });

  test.each([
    ["their role may not read it", new NotAuthorizedException("no")],
    ["the plan does not have it", new PaymentRequiredException("upgrade")],
  ])(
    "a kind is named unreadable, and listed nowhere, when %s",
    async (_why: string, error: Error) => {
      stubKind(AffectedResourceKind.Host, {
        rows: [rowOf(AffectedResourceKind.Host, "app-01")],
      });
      stubKind(AffectedResourceKind.DatabaseServer, { error });
      stubKind(AffectedResourceKind.Monitor, { error });
      const errorLog: jest.Mock = jest
        .spyOn(logger, "error")
        .mockImplementation((): void => {
          return undefined;
        }) as unknown as jest.Mock;

      const result: AffectedResourceSearchResult = await search({
        kinds: [AffectedResourceKind.DatabaseServer, AffectedResourceKind.Host],
        countKinds: [AffectedResourceKind.Monitor],
      });

      expect(result.unreadableKinds).toEqual([
        AffectedResourceKind.DatabaseServer,
        AffectedResourceKind.Monitor,
      ]);
      expect(names(result.kinds[0]!.matches)).toEqual(["app-01"]);
      expect(result.kinds).toHaveLength(1);
      expect(result.counts).toEqual([]);
      // Not a failure: nothing is logged.
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  test("a kind the caller may read no column of is unreadable without being read at all", async () => {
    const devices: KindStub = stubKind(AffectedResourceKind.NetworkDevice, {
      rows: [],
    });

    const result: AffectedResourceSearchResult = await search({
      kinds: [AffectedResourceKind.NetworkDevice],
      props: memberProps([]),
    });

    expect(result.unreadableKinds).toEqual([
      AffectedResourceKind.NetworkDevice,
    ]);
    expect(devices.findBy).not.toHaveBeenCalled();
    expect(devices.countBy).not.toHaveBeenCalled();
  });

  test("an address the caller may not read is neither searched nor shown", async () => {
    jest
      .spyOn(ColumnPermissions, "getModelColumnsByPermissions")
      .mockReturnValue({ columns: ["_id", "name", "description"] } as never);
    const devices: KindStub = stubKind(AffectedResourceKind.NetworkDevice, {
      rows: [
        rowOf(AffectedResourceKind.NetworkDevice, "WAN-RTR-01", {
          hostname: "10.0.0.1",
        }),
      ],
    });

    const result: AffectedResourceSearchResult = await search({
      kinds: [AffectedResourceKind.NetworkDevice],
      search: "rtr",
      props: memberProps([Permission.ProjectMember]),
    });

    expect(
      (queryOf(devices.findBy)["_multiFieldSearch"] as unknown as MultiSearch)
        .fields,
    ).toEqual(["name", "description"]);
    expect(argOf(devices.findBy)["select"]).toEqual({ _id: true, name: true });
    expect(result.kinds[0]!.matches[0]!.detail).toBeUndefined();
  });

  test("one kind that fails is left out and logged; every other kind still answers", async () => {
    stubKind(AffectedResourceKind.Host, {
      rows: [rowOf(AffectedResourceKind.Host, "app-01")],
    });
    stubKind(AffectedResourceKind.CephCluster, {
      error: new Error("connection reset"),
    });
    const errorLog: jest.Mock = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      }) as unknown as jest.Mock;

    const result: AffectedResourceSearchResult = await search({
      kinds: [AffectedResourceKind.CephCluster, AffectedResourceKind.Host],
    });

    expect(
      result.kinds.map((kind: { kind: string }): string => {
        return kind.kind;
      }),
    ).toEqual(["Host"]);
    expect(result.unreadableKinds).toEqual([]);
    expect(String(errorLog.mock.calls[0]![0])).toContain("CephCluster");
    expect(String(errorLog.mock.calls[0]![0])).toContain("connection reset");
  });

  test("a row without a real id is left out of the page", async () => {
    stubKind(AffectedResourceKind.Host, {
      rows: [
        rowOf(AffectedResourceKind.Host, "broken", { _id: "nope" }),
        rowOf(AffectedResourceKind.Host, "app-01"),
      ],
    });

    const result: AffectedResourceSearchResult = await search({
      kinds: [AffectedResourceKind.Host],
    });

    expect(names(result.kinds[0]!.matches)).toEqual(["app-01"]);
  });

  test("every kind of the Other Affected Resources picker is read once, in one search", async () => {
    const stubs: Array<KindStub> = AFFECTED_RESOURCE_KINDS.map(
      (kind: AffectedResourceKind): KindStub => {
        return stubKind(kind, { rows: [rowOf(kind, `${kind}-one`)] });
      },
    );

    const result: AffectedResourceSearchResult = await search({
      kinds: [...AFFECTED_RESOURCE_KINDS],
    });

    expect(result.kinds).toHaveLength(AFFECTED_RESOURCE_KINDS.length);

    for (const stub of stubs) {
      expect(stub.findBy).toHaveBeenCalledTimes(1);
      expect(stub.countBy).toHaveBeenCalledTimes(1);
    }
  });
});

describe("a page cut short still leads with the names that start with the text", () => {
  test("the switch called what was typed is found behind a page of switches that only contain it", async () => {
    const page: Array<BaseModel> = Array.from(
      { length: 3 },
      (_value: unknown, index: number): BaseModel => {
        return rowOf(AffectedResourceKind.NetworkDevice, `access-sw-0${index}`);
      },
    );
    const exact: BaseModel = rowOf(AffectedResourceKind.NetworkDevice, "sw");
    const starting: BaseModel = rowOf(
      AffectedResourceKind.NetworkDevice,
      "sw-lab",
    );
    const devices: KindStub = stubKind(AffectedResourceKind.NetworkDevice, {
      // The page by name, then the page of names that start with "sw".
      rows: [page, [exact, starting]],
      count: 180,
    });

    const result: AffectedResourceSearchResult = await search({
      kinds: [AffectedResourceKind.NetworkDevice],
      search: "sw",
      limitPerKind: 3,
    });

    expect(devices.findBy).toHaveBeenCalledTimes(2);

    const prefixQuery: JSONObject = queryOf(devices.findBy, 1);

    expect(prefixQuery["name"]).toBeInstanceOf(StartsWith);
    expect(prefixQuery["_multiFieldSearch"]).toBeUndefined();
    expect(prefixQuery["isArchived"]).toBe(false);
    expect(argOf(devices.findBy, 1)["limit"]).toBe(3);
    // The exact name first, then the one that starts with it, cut to the page.
    expect(names(result.kinds[0]!.matches)).toEqual([
      "sw",
      "sw-lab",
      "access-sw-00",
    ]);
    expect(result.kinds[0]!.count).toBe(180);
  });

  test("a row in both reads is listed once", async () => {
    const shared: BaseModel = rowOf(AffectedResourceKind.Host, "app");
    const other: BaseModel = rowOf(AffectedResourceKind.Host, "my-app");

    stubKind(AffectedResourceKind.Host, {
      rows: [[shared, other], [shared]],
      count: 9,
    });

    const result: AffectedResourceSearchResult = await search({
      kinds: [AffectedResourceKind.Host],
      search: "app",
      limitPerKind: 2,
    });

    expect(names(result.kinds[0]!.matches)).toEqual(["app", "my-app"]);
  });

  test("when everything that matches fits, nothing more is asked", async () => {
    const hosts: KindStub = stubKind(AffectedResourceKind.Host, {
      rows: [rowOf(AffectedResourceKind.Host, "app-01")],
      count: 1,
    });

    await search({ kinds: [AffectedResourceKind.Host], search: "app" });

    expect(hosts.findBy).toHaveBeenCalledTimes(1);
  });

  test("suggestions with no text are never re-read", async () => {
    const hosts: KindStub = stubKind(AffectedResourceKind.Host, {
      rows: [rowOf(AffectedResourceKind.Host, "app-01")],
      count: 500,
    });

    await search({ kinds: [AffectedResourceKind.Host], search: "" });

    expect(hosts.findBy).toHaveBeenCalledTimes(1);
  });

  test("mergePages keeps the first read's rows first, each once, cut to the limit", () => {
    const a: BaseModel = rowOf(AffectedResourceKind.Host, "a");
    const b: BaseModel = rowOf(AffectedResourceKind.Host, "b");
    const c: BaseModel = rowOf(AffectedResourceKind.Host, "c");
    const noId: BaseModel = new Host();

    expect(
      AffectedResourceSearch.mergePages({
        first: [c, noId],
        rest: [a, c, b],
        limit: 2,
      }),
    ).toEqual([c, a]);
    expect(
      AffectedResourceSearch.mergePages({ first: [], rest: [a, b], limit: 5 }),
    ).toEqual([a, b]);
  });
});
