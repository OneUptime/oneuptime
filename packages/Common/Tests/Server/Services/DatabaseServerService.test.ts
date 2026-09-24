/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseServerService, {
  UpsertWorkloadDatabaseData,
} from "../../../Server/Services/DatabaseServerService";
import DatabaseServerEndpointService, {
  DatabaseServerEndpointClaimResult,
} from "../../../Server/Services/DatabaseServerEndpointService";
import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerLabelRuleEngineService from "../../../Server/Services/DatabaseServerLabelRuleEngineService";
import DatabaseServerOwnerRuleEngineService from "../../../Server/Services/DatabaseServerOwnerRuleEngineService";
import UserService from "../../../Server/Services/UserService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import logger from "../../../Server/Utils/Logger";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import { DatabaseServerFeedEventType } from "../../../Models/DatabaseModels/DatabaseServerFeed";
import Label from "../../../Models/DatabaseModels/Label";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseServerDiscoverySource from "../../../Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  DatabaseEndpoint,
  ManualDatabaseEndpoint,
  isKubernetesServiceDnsHost,
  parseManualDatabaseEndpoint,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import crypto from "crypto";

/*
 * DatabaseServerService - the Databases product's root service.
 *
 * Pinned here, everything external mocked at its seam (no Postgres, no Redis):
 *
 *   - a MANUAL create through the real create pipeline, column permission
 *     check included: engine normalized, endpoint canonicalized, identity
 *     computed, discoverySource forced to manual, the primary endpoint
 *     claimed, and friendly refusals for every conflict;
 *   - findOrCreateByEndpoint: owner first, LOCAL-scope endpoints and
 *     allowCreate=false never create, the identifier race and the endpoint
 *     race (orphan removed, owner returned, no trace of the orphan);
 *   - upsertWorkloadDatabase: lookup by workload, ADOPTION only for exactly
 *     one owner that is not another workload's, aliases never taken from
 *     another database, member-key merge, never touching the collector
 *     status, never throwing;
 *   - the two liveness heartbeats (collector vs sighting);
 *   - un-archiving only what discovery archived itself;
 *   - the stale-collector, auto-archive and budget SQL, each scoping
 *     project + deletedAt itself.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const OTHER_DATABASE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const CLUSTER_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

const ORDERS_ENDPOINT: DatabaseEndpoint = {
  host: "orders-db.example.com",
  port: 5432,
};

const MEMBER_KEY_A: string = "0123456789abcdef";
const MEMBER_KEY_B: string = "fedcba9876543210";
const MEMBER_KEY_OLD: string = "00000000000000aa";

const service: any = DatabaseServerService;

function userPermission(permission: Permission): UserPermission {
  return {
    permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

function memberProps(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map(userPermission),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function databaseRow(overrides: Partial<DatabaseServer> = {}): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer(ObjectID.generate());
  row.projectId = PROJECT_ID;
  row.name = "PostgreSQL orders-db.example.com:5432";
  row.dbSystem = "postgresql";
  row.databaseIdentifier = "postgresql|orders-db.example.com:5432";
  row.isArchived = false;
  Object.assign(row, overrides);
  return row;
}

/** Let the fire-and-forget rule/feed chains drain before asserting on them. */
function flushPromises(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

function silenceLogs(): {
  error: jest.SpyInstance;
  warn: jest.SpyInstance;
  info: jest.SpyInstance;
  debug: jest.SpyInstance;
} {
  return {
    error: jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    }),
    warn: jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    }),
    info: jest.spyOn(logger, "info").mockImplementation(() => {
      return undefined as never;
    }),
    debug: jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined as never;
    }),
  };
}

interface SideEffectSpies {
  labelRules: jest.SpyInstance;
  ownerRules: jest.SpyInstance;
  feed: jest.SpyInstance;
}

function mockSideEffects(): SideEffectSpies {
  getJestSpyOn(service, "getDatabaseServerMarkdownLink").mockResolvedValue(
    "[Database PostgreSQL orders-db.example.com:5432](/db)",
  );
  getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
    "Jane Doe (jane@example.com)",
  );

  return {
    labelRules: getJestSpyOn(
      DatabaseServerLabelRuleEngineService,
      "applyRulesToDatabaseServer",
    ).mockResolvedValue(undefined),
    ownerRules: getJestSpyOn(
      DatabaseServerOwnerRuleEngineService,
      "applyRulesToDatabaseServer",
    ).mockResolvedValue(undefined),
    feed: getJestSpyOn(
      DatabaseServerFeedService,
      "createDatabaseServerFeedItem",
    ).mockResolvedValue(undefined),
  };
}

// Raw SQL issued through getRepository().manager.query.
function mockRawQuery(result: unknown = []): jest.Mock {
  const query: jest.Mock = jest.fn(async () => {
    return result;
  });
  getJestSpyOn(service, "getRepository").mockReturnValue({
    manager: { query },
  } as never);
  return query;
}

function withEnv(name: string, value: string | undefined): () => void {
  const previous: string | undefined = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * A person adding a database - the real create pipeline
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService - manual create (real create pipeline)", () => {
  let save: jest.Mock;
  let findOwner: jest.SpyInstance;
  let findSameIdentity: jest.SpyInstance;
  let claim: jest.SpyInstance;
  let deleteBy: jest.SpyInstance;
  let sideEffects: SideEffectSpies;

  function manualRequest(overrides: Partial<DatabaseServer> = {}): {
    data: DatabaseServer;
    props: DatabaseCommonInteractionProps;
  } {
    const data: DatabaseServer = new DatabaseServer();
    data.dbSystem = "postgres";
    data.serverAddress = "Orders-DB.Example.com";
    Object.assign(data, overrides);
    return { data: data, props: memberProps() };
  }

  beforeEach(() => {
    silenceLogs();
    save = jest.fn(async (entity: any) => {
      entity._id = ObjectID.generate().toString();
      return entity;
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({ save } as never);
    getJestSpyOn(service, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );
    getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    findOwner = getJestSpyOn(
      DatabaseServerEndpointService,
      "findOwnerByEndpoint",
    ).mockResolvedValue(null);
    findSameIdentity = getJestSpyOn(service, "findOneBy").mockResolvedValue(
      null,
    );
    claim = getJestSpyOn(
      DatabaseServerEndpointService,
      "claimEndpoint",
    ).mockResolvedValue("claimed");
    deleteBy = getJestSpyOn(service, "deleteBy").mockResolvedValue(1);
    sideEffects = mockSideEffects();
  });

  test("computes identity from the engine and canonical endpoint, and stamps 'manual'", async () => {
    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({
        // A caller cannot pretend a collector found it.
        discoverySource: DatabaseServerDiscoverySource.Collector,
      }),
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(created.dbSystem).toBe("postgresql");
    expect(created.serverAddress).toBe("orders-db.example.com");
    expect(created.serverPort).toBe(5432);
    expect(created.databaseIdentifier).toBe(
      "postgresql|orders-db.example.com:5432",
    );
    expect(created.discoverySource).toBe("manual");
    expect(created.name).toBe("PostgreSQL orders-db.example.com:5432");
    expect(created.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(created.createdByUserId!.toString()).toBe(USER_ID.toString());
    expect(created.slug).toBeTruthy();
  });

  test("claims the canonical endpoint as the row's primary, added by a person", async () => {
    const created: DatabaseServer =
      await DatabaseServerService.create(manualRequest());

    expect(claim).toHaveBeenCalledTimes(1);
    const call: any = claim.mock.calls[0]![0];
    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.databaseServerId.toString()).toBe(created.id!.toString());
    expect(call.endpoint).toBe("orders-db.example.com:5432");
    expect(call.isPrimary).toBe(true);
    expect(call.source).toBe("user");
  });

  test("runs the label then owner rules and records who created it", async () => {
    const created: DatabaseServer =
      await DatabaseServerService.create(manualRequest());
    await flushPromises();

    expect(sideEffects.labelRules).toHaveBeenCalledWith(created);
    expect(sideEffects.ownerRules).toHaveBeenCalledWith(created);
    expect(sideEffects.labelRules.mock.invocationCallOrder[0]!).toBeLessThan(
      sideEffects.ownerRules.mock.invocationCallOrder[0]!,
    );

    const feed: any = sideEffects.feed.mock.calls[0]![0];
    expect(feed.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.DatabaseServerCreated,
    );
    expect(feed.userId.toString()).toBe(USER_ID.toString());
    expect(feed.feedInfoInMarkdown).toContain("was created by");
    expect(feed.moreInformationInMarkdown).toContain(
      "**Discovered from**: Added manually",
    );
    expect(feed.moreInformationInMarkdown).toContain(
      "postgresql|orders-db.example.com:5432",
    );
  });

  test("keeps a name the person chose", async () => {
    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({ name: "  Orders primary  " }),
    );

    expect(created.name).toBe("Orders primary");
  });

  test("the port field wins over a port typed into the address", async () => {
    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({
        serverAddress: "orders-db.example.com:6000",
        serverPort: 6432,
      }),
    );

    expect(created.serverPort).toBe(6432);
    expect(created.databaseIdentifier).toBe(
      "postgresql|orders-db.example.com:6432",
    );
  });

  test("a valid port field overrides a bad port typed into the address", async () => {
    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({
        serverAddress: "orders-db.example.com:99999",
        serverPort: 5433,
      }),
    );

    expect(created.databaseIdentifier).toBe(
      "postgresql|orders-db.example.com:5433",
    );
  });

  test("an IPv6 address takes the port field without being mangled", async () => {
    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({ serverAddress: "2001:db8::10", serverPort: 5433 }),
    );

    expect(created.serverAddress).toBe("2001:db8::10");
    expect(created.databaseIdentifier).toBe("postgresql|[2001:db8::10]:5433");
  });

  test("a private IP is a perfectly good manual endpoint", async () => {
    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({ serverAddress: "10.0.1.5" }),
    );

    expect(created.databaseIdentifier).toBe("postgresql|10.0.1.5:5432");
  });

  test("a value the form cannot use is refused before anything is looked up", async () => {
    await expect(
      DatabaseServerService.create(
        manualRequest({ serverAddress: "admin@10.0.0.5:5432" }),
      ),
    ).rejects.toThrow(BadDataException);

    expect(findOwner).not.toHaveBeenCalled();
    expect(findSameIdentity).not.toHaveBeenCalled();
  });

  test("an address naming its cluster keeps the qualifier in its identity and endpoint", async () => {
    const clusters: jest.SpyInstance = getJestSpyOn(
      service,
      "findKubernetesClusterNames",
    ).mockResolvedValue(["prod"]);

    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({ serverAddress: "pg.shop.svc.cluster.local:5432@Prod" }),
    );

    expect(created.serverAddress).toBe("pg.shop.svc.cluster.local");
    expect(created.databaseIdentifier).toBe(
      "postgresql|pg.shop.svc.cluster.local:5432@prod",
    );
    expect(claim.mock.calls[0]![0].endpoint).toBe(
      "pg.shop.svc.cluster.local:5432@prod",
    );
    // Already qualified: nothing to advise, no cluster lookup.
    expect(clusters).not.toHaveBeenCalled();
  });

  test("the port field replaces a SQL Server named instance - the port already names it", async () => {
    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({
        dbSystem: "mssql",
        serverAddress: "sql1.corp.example.com\\INST01",
        serverPort: 14330,
      }),
    );

    expect(created.serverAddress).toBe("sql1.corp.example.com");
    expect(created.serverPort).toBe(14330);
    expect(claim.mock.calls[0]![0].endpoint).toBe(
      "sql1.corp.example.com:14330",
    );
  });

  test("without a port, a SQL Server named instance is part of the host and gets no default port", async () => {
    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({
        dbSystem: "mssql",
        serverAddress: "sql1.corp.example.com\\INST01",
      }),
    );

    expect(created.serverAddress).toBe("sql1.corp.example.com\\inst01");
    expect(created.serverPort).toBeUndefined();
    expect(claim.mock.calls[0]![0].endpoint).toBe(
      "sql1.corp.example.com\\inst01",
    );
  });

  /*
   * A Kubernetes Service name only resolves inside one cluster, and pods
   * whose telemetry goes through the Kubernetes agent report that cluster:
   * their calls are keyed `<endpoint>@<cluster>`. A manual row holding only
   * the unqualified name would stay empty while discovery creates a second
   * row for the qualified one - so in a project with clusters the person is
   * asked to name the cluster.
   */
  describe("a Kubernetes Service name typed without its cluster", () => {
    let clusters: jest.SpyInstance;

    beforeEach(() => {
      clusters = getJestSpyOn(
        service,
        "findKubernetesClusterNames",
      ).mockResolvedValue(["prod-eu", "staging"]);
    });

    test("is refused in a project with clusters, naming the qualified form and the project's clusters", async () => {
      const error: Error = (await DatabaseServerService.create(
        manualRequest({ serverAddress: "pg.shop.svc.cluster.local" }),
      ).catch((e: unknown) => {
        return e;
      })) as Error;

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "pg.shop.svc.cluster.local:5432 only resolves inside one Kubernetes cluster or private network. Applications that report their cluster (k8s.cluster.name) are matched to pg.shop.svc.cluster.local:5432@<cluster name> instead, so name the cluster the way they report it, for example pg.shop.svc.cluster.local:5432@prod-eu (this project's clusters: prod-eu, staging). To also match a Database Agent or applications that do not report their cluster, add pg.shop.svc.cluster.local:5432 as an endpoint on the database's Endpoints tab once it is created.",
      );
      expect(clusters).toHaveBeenCalledWith(PROJECT_ID);
      expect(save).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
    });

    test("the short `<service>.<namespace>.svc` form is the same name", async () => {
      await expect(
        DatabaseServerService.create(
          manualRequest({ serverAddress: "pg.shop.svc:6432" }),
        ),
      ).rejects.toThrow("pg.shop.svc.cluster.local:6432@prod-eu");
      expect(save).not.toHaveBeenCalled();
    });

    test("a StatefulSet member's name is refused the same way", async () => {
      await expect(
        DatabaseServerService.create(
          manualRequest({
            serverAddress: "pg-0.pg-headless.shop.svc.cluster.local",
          }),
        ),
      ).rejects.toThrow("pg-0.pg-headless.shop.svc.cluster.local:5432@prod-eu");
    });

    test("is accepted as typed in a project without clusters - nothing could report the qualified form", async () => {
      clusters.mockResolvedValue([]);

      const created: DatabaseServer = await DatabaseServerService.create(
        manualRequest({ serverAddress: "pg.shop.svc.cluster.local" }),
      );

      expect(created.databaseIdentifier).toBe(
        "postgresql|pg.shop.svc.cluster.local:5432",
      );
      expect(claim.mock.calls[0]![0].endpoint).toBe(
        "pg.shop.svc.cluster.local:5432",
      );
    });

    test("an address another database already holds is answered with that first", async () => {
      findOwner.mockResolvedValue({
        databaseServerId: OTHER_DATABASE_ID,
        isPrimary: false,
      });
      getJestSpyOn(
        service,
        "getDatabaseServerNameIfReadable",
      ).mockResolvedValue("Redis shop/pg");

      await expect(
        DatabaseServerService.create(
          manualRequest({ serverAddress: "pg.shop.svc.cluster.local" }),
        ),
      ).rejects.toThrow(
        'pg.shop.svc.cluster.local:5432 already belongs to the database "Redis shop/pg".',
      );
      expect(clusters).not.toHaveBeenCalled();
    });

    test.each([
      ["a private IP", "10.0.1.5", "postgresql|10.0.1.5:5432"],
      [
        "a private-zone name",
        "orders-db.corp.internal",
        "postgresql|orders-db.corp.internal:5432",
      ],
      ["a .local name", "orders-db.local", "postgresql|orders-db.local:5432"],
    ])(
      "%s stays a valid unqualified endpoint - virtual machines and the Database Agent report it that way",
      async (_label: string, address: string, identifier: string) => {
        const created: DatabaseServer = await DatabaseServerService.create(
          manualRequest({ serverAddress: address }),
        );

        expect(created.databaseIdentifier).toBe(identifier);
        expect(clusters).not.toHaveBeenCalled();
      },
    );

    /*
     * The create form runs parseManualDatabaseEndpoint in the browser and
     * shows its clusterQualifierHint only as advice; only the server knows
     * whether the project has clusters. Its refusal is that same hint, with
     * the project's cluster names filled in.
     */
    test("the refusal is the form's own advice, with the project's clusters named", async () => {
      const typed: { serverAddress: string; serverPort: number } = {
        serverAddress: "pg.shop.svc",
        serverPort: 6432,
      };
      const inTheBrowser: ManualDatabaseEndpoint = parseManualDatabaseEndpoint(
        typed.serverAddress,
        { system: "postgresql", port: typed.serverPort },
      );
      expect(inTheBrowser.error).toBeNull();
      expect(inTheBrowser.clusterQualifierHint).not.toBeNull();

      const error: unknown = await DatabaseServerService.create(
        manualRequest(typed),
      ).catch((e: unknown) => {
        return e;
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(
        (error as Error).message.startsWith(
          parseManualDatabaseEndpoint(typed.serverAddress, {
            system: "postgresql",
            port: typed.serverPort,
            knownClusterNames: ["prod-eu", "staging"],
          }).clusterQualifierHint!,
        ),
      ).toBe(true);
    });

    test.each([
      ["a Service name", "pg.shop.svc.cluster.local", true],
      ["the short Service form", "pg.shop.svc", true],
      ["a StatefulSet member", "pg-0.pg-hl.shop.svc.cluster.local", true],
      ["a private IP", "10.0.1.5", false],
      ["a private-zone name", "orders-db.corp.internal", false],
    ])(
      "%s: refused exactly when it is a Kubernetes Service name the form would advise on",
      async (_label: string, address: string, refused: boolean) => {
        expect(
          isKubernetesServiceDnsHost(
            parseManualDatabaseEndpoint(address, { system: "postgresql" })
              .endpoint!.host,
          ),
        ).toBe(refused);

        const outcome: unknown = await DatabaseServerService.create(
          manualRequest({ serverAddress: address }),
        ).catch((e: unknown) => {
          return e;
        });

        expect(outcome instanceof BadDataException).toBe(refused);
      },
    );

    test("clusters that cannot be read never fail the create", async () => {
      clusters.mockRejectedValue(new Error("connection terminated"));

      const created: DatabaseServer = await DatabaseServerService.create(
        manualRequest({ serverAddress: "pg.shop.svc.cluster.local" }),
      );

      expect(created.databaseIdentifier).toBe(
        "postgresql|pg.shop.svc.cluster.local:5432",
      );
    });
  });

  test.each([
    [
      "no engine",
      { dbSystem: "  " },
      "Database engine is required. Choose the engine this database runs, for example PostgreSQL or MySQL.",
    ],
    [
      "no address",
      { serverAddress: "" },
      "Server address is required. Enter the host name or IP address applications use to reach this database, for example orders-db.example.com:5432.",
    ],
    [
      "localhost",
      { serverAddress: "localhost" },
      '"localhost" is a loopback or host-local address, such as localhost or host.docker.internal. Every application reaches its own, so it cannot identify one database.',
    ],
    [
      "a host-relative Docker name",
      { serverAddress: "host.docker.internal:5432" },
      '"host.docker.internal:5432" is a loopback or host-local address',
    ],
    [
      "an out-of-range port typed into the address",
      { serverAddress: "orders-db.example.com:99999" },
      '"orders-db.example.com:99999" has a port outside 1-65535. Enter a port between 1 and 65535.',
    ],
    [
      "an out-of-range port inside a connection URL",
      { serverAddress: "postgresql://app@orders-db.example.com:70000/orders" },
      "has a port outside 1-65535.",
    ],
    [
      "user@host - the user name read as the host before",
      { serverAddress: "admin@10.0.0.5:5432" },
      '"admin@10.0.0.5:5432" looks like user@host. Remove "admin@": the database user does not belong in an endpoint.',
    ],
    [
      "a dotted user name before the host",
      { serverAddress: "john.doe@orders-db.example.com" },
      'Remove "john.doe@"',
    ],
    [
      "a cluster qualifier on a public host - dropped silently before",
      { serverAddress: "orders-db.example.com@prod" },
      '"orders-db.example.com" resolves the same way everywhere, so it cannot take a Kubernetes cluster qualifier. Remove "@prod".',
    ],
    [
      "a cluster qualifier on a bare service name",
      { serverAddress: "postgres@prod" },
      '"postgres" is a single-label name, which only means one Service once its namespace is known. Enter it with the namespace, for example postgres.<namespace>@prod.',
    ],
    [
      "something that is not an address",
      { serverAddress: "orders db" },
      '"orders db" is not a valid host[:port] endpoint. Enter a host name or IP address with an optional port, for example orders-db.example.com:5432.',
    ],
    [
      "a port of 0",
      { serverPort: 0 },
      "Server port must be a whole number between 1 and 65535.",
    ],
    [
      "a port above 65535",
      { serverPort: 70000 },
      "Server port must be a whole number between 1 and 65535.",
    ],
    [
      "a fractional port",
      { serverPort: 54.5 },
      "Server port must be a whole number between 1 and 65535.",
    ],
  ])(
    "refuses %s with a message the form can show",
    async (_label: string, overrides: any, message: string) => {
      const error: unknown = await DatabaseServerService.create(
        manualRequest(overrides),
      ).catch((e: unknown) => {
        return e;
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain(message);
      expect(save).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
    },
  );

  test.each([
    { serverAddress: "localhost" },
    { serverAddress: "admin@10.0.0.5:5432" },
    { serverAddress: "orders-db.example.com@prod" },
    { serverAddress: "postgres@prod" },
    { serverAddress: "orders db" },
    { serverAddress: "orders-db.example.com:99999" },
    { serverPort: 70000 },
  ])(
    "the create form's check and the server say the same thing: %j",
    async (overrides: any) => {
      const request: { data: DatabaseServer } = manualRequest(overrides);
      const inTheBrowser: ManualDatabaseEndpoint = parseManualDatabaseEndpoint(
        request.data.serverAddress,
        { system: "postgresql", port: request.data.serverPort },
      );
      expect(inTheBrowser.error).toBeTruthy();

      await expect(
        DatabaseServerService.create(manualRequest(overrides)),
      ).rejects.toThrow(new BadDataException(inTheBrowser.error!));
    },
  );

  test("an endpoint another database owns is refused, naming that database", async () => {
    findOwner.mockResolvedValue({
      databaseServerId: OTHER_DATABASE_ID,
      isPrimary: true,
    });
    const nameIfReadable: jest.SpyInstance = getJestSpyOn(
      service,
      "getDatabaseServerNameIfReadable",
    ).mockResolvedValue("CockroachDB orders-db.example.com:5432");

    await expect(DatabaseServerService.create(manualRequest())).rejects.toThrow(
      'orders-db.example.com:5432 already belongs to the database "CockroachDB orders-db.example.com:5432".',
    );
    expect(findOwner).toHaveBeenCalledWith(
      PROJECT_ID,
      "orders-db.example.com:5432",
    );
    // The owner is named only through the caller's own read permission.
    const nameCall: any = nameIfReadable.mock.calls[0]![0];
    expect(nameCall.databaseServerId).toBe(OTHER_DATABASE_ID);
    expect(nameCall.props.userId).toBe(USER_ID);
    expect(nameCall.props.isRoot).toBeFalsy();
    expect(save).not.toHaveBeenCalled();
  });

  test("an owner the caller cannot read is not named", async () => {
    findOwner.mockResolvedValue({
      databaseServerId: OTHER_DATABASE_ID,
      isPrimary: true,
    });
    getJestSpyOn(service, "getDatabaseServerNameIfReadable").mockResolvedValue(
      "",
    );
    const rootName: jest.SpyInstance = getJestSpyOn(
      service,
      "getDatabaseServerName",
    ).mockResolvedValue("Payments (team B only)");

    const error: Error = (await DatabaseServerService.create(
      manualRequest(),
    ).catch((e: unknown) => {
      return e;
    })) as Error;

    expect(error.message).toContain(
      "orders-db.example.com:5432 already belongs to another database.",
    );
    expect(error.message).not.toContain("Payments");
    expect(rootName).not.toHaveBeenCalled();
  });

  test("the same identity held by a row the caller cannot read is not named", async () => {
    findSameIdentity.mockImplementation(async (findOneBy: any) => {
      // The identity lookup runs as root; the name lookup as the caller.
      return findOneBy.props.isRoot
        ? databaseRow({ name: "Payments (team B only)" })
        : null;
    });

    const error: Error = (await DatabaseServerService.create(
      manualRequest(),
    ).catch((e: unknown) => {
      return e;
    })) as Error;

    expect(error.message).toBe(
      "A PostgreSQL database at orders-db.example.com:5432 already exists.",
    );
  });

  test("a caller who may not add databases learns nothing: refused before any lookup", async () => {
    findOwner.mockResolvedValue({
      databaseServerId: OTHER_DATABASE_ID,
      isPrimary: true,
    });
    const request: {
      data: DatabaseServer;
      props: DatabaseCommonInteractionProps;
    } = manualRequest();
    request.props = memberProps([Permission.ReadDatabaseServer]);

    const error: Error = (await DatabaseServerService.create(request).catch(
      (e: unknown) => {
        return e;
      },
    )) as Error;

    expect(error.message).not.toContain("already belongs");
    expect(findOwner).not.toHaveBeenCalled();
    expect(findSameIdentity).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  test("the same engine + endpoint twice is refused before the unique index can", async () => {
    findSameIdentity.mockResolvedValue(databaseRow({ name: "Orders primary" }));

    await expect(DatabaseServerService.create(manualRequest())).rejects.toThrow(
      'A PostgreSQL database at orders-db.example.com:5432 already exists: "Orders primary".',
    );
    const call: any = findSameIdentity.mock.calls[0]![0];
    expect(call.query.projectId).toBe(PROJECT_ID);
    expect(call.query.databaseIdentifier).toBe(
      "postgresql|orders-db.example.com:5432",
    );
    expect(save).not.toHaveBeenCalled();
  });

  test("losing the endpoint to a concurrent writer removes the new row and names the winner", async () => {
    claim.mockResolvedValue("owned-by-other");
    findOwner.mockResolvedValueOnce(null).mockResolvedValueOnce({
      databaseServerId: OTHER_DATABASE_ID,
      isPrimary: true,
    });
    const nameIfReadable: jest.SpyInstance = getJestSpyOn(
      service,
      "getDatabaseServerNameIfReadable",
    ).mockResolvedValue("PostgreSQL orders-db.example.com:5432");

    await expect(DatabaseServerService.create(manualRequest())).rejects.toThrow(
      'orders-db.example.com:5432 already belongs to the database "PostgreSQL orders-db.example.com:5432".',
    );
    // Named through the creating caller's own read permission.
    expect(nameIfReadable.mock.calls[0]![0].props.userId).toBe(USER_ID);

    expect(save).toHaveBeenCalledTimes(1);
    const savedId: string = (save.mock.calls[0]![0] as any)._id;
    expect(deleteBy).toHaveBeenCalledTimes(1);
    const deleteCall: any = deleteBy.mock.calls[0]![0];
    expect(deleteCall.query._id).toBe(savedId);
    expect(deleteCall.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(deleteCall.props).toEqual({ isRoot: true, ignoreHooks: true });

    // The row never existed as far as anyone watching is concerned.
    await flushPromises();
    expect(sideEffects.feed).not.toHaveBeenCalled();
    expect(sideEffects.labelRules).not.toHaveBeenCalled();
  });

  test("a failing claim removes the new row and surfaces the error", async () => {
    claim.mockRejectedValue(new Error("connection terminated"));

    await expect(DatabaseServerService.create(manualRequest())).rejects.toThrow(
      "connection terminated",
    );
    expect(deleteBy).toHaveBeenCalledTimes(1);
  });

  /*
   * The whole point of the column ACL note on the model: the hook sets only
   * user-creatable columns, and everything else a caller sends still meets
   * the real column permission check.
   */
  test.each([
    ["workloadIdentifier", "postgresql|kubernetes:prod/data/statefulset/x"],
    ["otelCollectorStatus", "connected"],
    ["lastSeenAt", new Date()],
    ["autoArchivedAt", new Date()],
    ["memberEntityKeys", { [MEMBER_KEY_A]: new Date().toISOString() }],
  ])(
    "a caller-supplied root-only %s is refused by the column permission check",
    async (column: string, value: unknown) => {
      await expect(
        DatabaseServerService.create(
          manualRequest({ [column]: value } as Partial<DatabaseServer>),
        ),
      ).rejects.toThrow(
        `User is not allowed to create on ${column} column of Database`,
      );
      expect(save).not.toHaveBeenCalled();
    },
  );

  test("the user-creatable columns - labels and description included - pass the check", async () => {
    const label: Label = new Label(ObjectID.generate());

    const created: DatabaseServer = await DatabaseServerService.create(
      manualRequest({
        description: "Orders primary",
        labels: [label],
      }),
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(created.description).toBe("Orders primary");
  });

  test("a read-only member cannot add a database at all", async () => {
    await expect(
      DatabaseServerService.create({
        data: manualRequest().data,
        props: memberProps([Permission.ReadDatabaseServer]),
      }),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  test("a root create passes through untouched - discovery computes its own identity", async () => {
    const data: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      databaseIdentifier: "postgresql|kubernetes:prod/data/statefulset/orders",
    });
    delete data._id;

    const created: DatabaseServer = await DatabaseServerService.create({
      data: data,
      props: { isRoot: true },
    });

    expect(findOwner).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(created.discoverySource).toBe("kubernetes");
    expect(created.databaseIdentifier).toBe(
      "postgresql|kubernetes:prod/data/statefulset/orders",
    );
  });
});

describe("DatabaseServerService.findKubernetesClusterNames", () => {
  test("reads a few of the project's live cluster names, sorted", async () => {
    const query: jest.Mock = mockRawQuery([
      { clusterIdentifier: " prod-eu " },
      { clusterIdentifier: "staging" },
      { clusterIdentifier: "" },
      { clusterIdentifier: null },
    ]);

    await expect(
      service.findKubernetesClusterNames(PROJECT_ID),
    ).resolves.toEqual(["prod-eu", "staging"]);

    const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toContain(`FROM "KubernetesCluster" kc`);
    expect(sql).toContain(`kc."projectId" = $1`);
    expect(sql).toContain(`kc."deletedAt" IS NULL`);
    expect(sql).toContain(`ORDER BY kc."clusterIdentifier" ASC`);
    expect(params).toEqual([PROJECT_ID.toString(), 10]);
  });

  test("an unexpected driver answer is no clusters", async () => {
    mockRawQuery(null);

    await expect(
      service.findKubernetesClusterNames(PROJECT_ID),
    ).resolves.toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * findOrCreateByEndpoint
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService.findOrCreateByEndpoint", () => {
  let findOwner: jest.SpyInstance;
  let findOneBy: jest.SpyInstance;
  let create: jest.SpyInstance;
  let claim: jest.SpyInstance;
  let deleteBy: jest.SpyInstance;
  let rawQuery: jest.Mock;
  let sideEffects: SideEffectSpies;

  beforeEach(() => {
    silenceLogs();
    findOwner = getJestSpyOn(
      DatabaseServerEndpointService,
      "findOwnerByEndpoint",
    ).mockResolvedValue(null);
    findOneBy = getJestSpyOn(service, "findOneBy").mockResolvedValue(null);
    create = getJestSpyOn(service, "create").mockImplementation(
      async (input: any) => {
        input.data._id = ObjectID.generate().toString();
        return input.data;
      },
    );
    claim = getJestSpyOn(
      DatabaseServerEndpointService,
      "claimEndpoint",
    ).mockResolvedValue("claimed");
    deleteBy = getJestSpyOn(service, "deleteBy").mockResolvedValue(1);
    rawQuery = mockRawQuery([]);
    sideEffects = mockSideEffects();
  });

  test("returns the row that owns the endpoint, without creating anything", async () => {
    const existing: DatabaseServer = databaseRow();
    findOwner.mockResolvedValue({
      databaseServerId: existing.id,
      isPrimary: true,
    });
    findOneBy.mockResolvedValue(existing);

    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      });

    expect(result).toBe(existing);
    expect(findOwner).toHaveBeenCalledWith(
      PROJECT_ID,
      "orders-db.example.com:5432",
    );
    const lookup: any = findOneBy.mock.calls[0]![0];
    expect(lookup.query._id).toBe(existing.id!.toString());
    expect(lookup.query.projectId).toBe(PROJECT_ID);
    expect(create).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(rawQuery).not.toHaveBeenCalled();
  });

  /*
   * The endpoint key is engine-agnostic by design: CockroachDB speaks the
   * postgresql wire protocol, so a span that says "postgresql" still lands on
   * the row a collector created as "cockroachdb".
   */
  test("the owner is found by endpoint whatever engine the caller reports", async () => {
    const cockroach: DatabaseServer = databaseRow({ dbSystem: "cockroachdb" });
    findOwner.mockResolvedValue({
      databaseServerId: cockroach.id,
      isPrimary: true,
    });
    findOneBy.mockResolvedValue(cockroach);

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      }),
    ).resolves.toBe(cockroach);
  });

  test("an owner that discovery auto-archived is restored when seen again", async () => {
    const archived: DatabaseServer = databaseRow({
      isArchived: true,
      autoArchivedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    findOwner.mockResolvedValue({ databaseServerId: archived.id });
    findOneBy.mockResolvedValue(archived);
    rawQuery.mockResolvedValue([{ _id: archived.id!.toString() }]);

    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: true,
      });

    expect(result!.isArchived).toBe(false);
    expect(result!.autoArchivedAt).toBeUndefined();

    expect(rawQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = rawQuery.mock.calls[0] as [string, Array<unknown>];
    // The conditions live in the UPDATE, so a racing person always wins.
    expect(sql).toContain('"isArchived" = true');
    expect(sql).toContain('"autoArchivedAt" IS NOT NULL');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('"autoArchivedAt" = NULL');
    expect(sql).toContain('"archivedByUserId" = NULL');
    expect(params).toEqual([archived.id!.toString(), PROJECT_ID.toString()]);

    expect(sideEffects.feed).toHaveBeenCalledTimes(1);
    const feed: any = sideEffects.feed.mock.calls[0]![0];
    expect(feed.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.DatabaseServerRestored,
    );
    expect(feed.feedInfoInMarkdown).toContain("restored from the archive");
  });

  test("a restore that lost to someone else writes no second feed item", async () => {
    const archived: DatabaseServer = databaseRow({
      isArchived: true,
      autoArchivedAt: new Date(),
    });
    findOwner.mockResolvedValue({ databaseServerId: archived.id });
    findOneBy.mockResolvedValue(archived);
    rawQuery.mockResolvedValue([]);

    await DatabaseServerService.findOrCreateByEndpoint({
      projectId: PROJECT_ID,
      dbSystem: "postgresql",
      endpoint: ORDERS_ENDPOINT,
      discoverySource: DatabaseServerDiscoverySource.Collector,
      allowCreate: true,
    });

    expect(rawQuery).toHaveBeenCalledTimes(1);
    expect(sideEffects.feed).not.toHaveBeenCalled();
  });

  test("a row a PERSON archived is never un-archived by discovery", async () => {
    const archivedByPerson: DatabaseServer = databaseRow({
      isArchived: true,
      archivedByUserId: USER_ID,
    });
    findOwner.mockResolvedValue({ databaseServerId: archivedByPerson.id });
    findOneBy.mockResolvedValue(archivedByPerson);

    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: true,
      });

    expect(result!.isArchived).toBe(true);
    expect(rawQuery).not.toHaveBeenCalled();
  });

  test("a restore failure never fails the lookup", async () => {
    const archived: DatabaseServer = databaseRow({
      isArchived: true,
      autoArchivedAt: new Date(),
    });
    findOwner.mockResolvedValue({ databaseServerId: archived.id });
    findOneBy.mockResolvedValue(archived);
    rawQuery.mockRejectedValue(new Error("deadlock detected"));

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: true,
      }),
    ).resolves.toBe(archived);
  });

  test("nothing is created when creation is not allowed", async () => {
    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: false,
      }),
    ).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    ["a single-label name", { host: "postgres", port: 5432 }],
    [
      "unqualified cluster-local DNS",
      { host: "orders-db.data.svc.cluster.local", port: 5432 },
    ],
    ["an unqualified private IP", { host: "10.0.0.5", port: 5432 }],
  ])(
    "%s (LOCAL scope) never creates a row",
    async (_label: string, endpoint: DatabaseEndpoint) => {
      await expect(
        DatabaseServerService.findOrCreateByEndpoint({
          projectId: PROJECT_ID,
          dbSystem: "postgresql",
          endpoint: endpoint,
          discoverySource: DatabaseServerDiscoverySource.Collector,
          allowCreate: true,
        }),
      ).resolves.toBeNull();
      expect(create).not.toHaveBeenCalled();
    },
  );

  test("a LOCAL-scope endpoint still joins a row that already lists it", async () => {
    const existing: DatabaseServer = databaseRow();
    findOwner.mockResolvedValue({ databaseServerId: existing.id });
    findOneBy.mockResolvedValue(existing);

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: { host: "postgres", port: 5432 },
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      }),
    ).resolves.toBe(existing);
    expect(findOwner).toHaveBeenCalledWith(PROJECT_ID, "postgres:5432");
  });

  test("a cluster-qualified private IP is GLOBAL and may create", async () => {
    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "redis",
        endpoint: {
          host: "10.0.0.5",
          port: 6379,
          kubernetesClusterName: "prod",
        },
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      });

    expect(result).not.toBeNull();
    expect(result!.databaseIdentifier).toBe("redis|10.0.0.5:6379@prod");
    // The display name never carries the cluster qualifier.
    expect(result!.name).toBe("Redis 10.0.0.5:6379");
    expect(claim.mock.calls[0]![0].endpoint).toBe("10.0.0.5:6379@prod");
  });

  test("creates a client-spans row as root, without hooks, and claims its primary endpoint", async () => {
    const before: number = Date.now();
    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "Postgres",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      });

    expect(create).toHaveBeenCalledTimes(1);
    const call: any = create.mock.calls[0]![0];
    expect(call.props).toEqual({ isRoot: true, ignoreHooks: true });

    const row: DatabaseServer = call.data;
    expect(row.projectId).toBe(PROJECT_ID);
    expect(row.dbSystem).toBe("postgresql");
    expect(row.name).toBe("PostgreSQL orders-db.example.com:5432");
    expect(row.databaseIdentifier).toBe(
      "postgresql|orders-db.example.com:5432",
    );
    expect(row.serverAddress).toBe("orders-db.example.com");
    expect(row.serverPort).toBe(5432);
    expect(row.discoverySource).toBe("client-spans");
    expect(row.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before);
    // Being queried says nothing about engine metrics.
    expect(row.otelCollectorStatus).toBeUndefined();
    expect(row.collectorLastSeenAt).toBeUndefined();

    expect(claim).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      databaseServerId: row.id,
      endpoint: "orders-db.example.com:5432",
      isPrimary: true,
      source: "auto",
    });
    expect(result).toBe(row);

    // The side effects run only once the row has won its endpoint.
    await flushPromises();
    expect(sideEffects.labelRules).toHaveBeenCalledWith(row);
    expect(sideEffects.ownerRules).toHaveBeenCalledWith(row);
    const feed: any = sideEffects.feed.mock.calls[0]![0];
    expect(feed.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.DatabaseServerCreated,
    );
    expect(feed.userId).toBeUndefined();
    expect(feed.feedInfoInMarkdown).toContain("created automatically");
    expect(feed.moreInformationInMarkdown).toContain(
      "**Discovered from**: Application traces",
    );
  });

  test("a collector-created row is connected from its first moment", async () => {
    await DatabaseServerService.findOrCreateByEndpoint({
      projectId: PROJECT_ID,
      dbSystem: "postgresql",
      endpoint: ORDERS_ENDPOINT,
      discoverySource: DatabaseServerDiscoverySource.Collector,
      displayName: "  Orders (collector)  ",
      allowCreate: true,
    });

    const row: DatabaseServer = create.mock.calls[0]![0].data;
    expect(row.otelCollectorStatus).toBe("connected");
    expect(row.collectorLastSeenAt).toBeInstanceOf(Date);
    expect(row.name).toBe("Orders (collector)");
  });

  test("an engine that cannot be named creates nothing", async () => {
    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "  ",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      }),
    ).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  test("an unknown engine is kept, clamped to its column", async () => {
    await DatabaseServerService.findOrCreateByEndpoint({
      projectId: PROJECT_ID,
      dbSystem: `  ${"Q".repeat(300)} `,
      endpoint: ORDERS_ENDPOINT,
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      allowCreate: true,
    });

    const row: DatabaseServer = create.mock.calls[0]![0].data;
    expect(row.dbSystem).toBe("q".repeat(100));
    expect(row.databaseIdentifier).toBe(
      `${"q".repeat(100)}|orders-db.example.com:5432`,
    );
  });

  test("an endpoint without a host is ignored before any read", async () => {
    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: { host: "", port: 5432 },
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      }),
    ).resolves.toBeNull();
    expect(findOwner).not.toHaveBeenCalled();
  });

  test("the identifier race: a racing writer's row is returned and gets the endpoint", async () => {
    const winner: DatabaseServer = databaseRow();
    create.mockRejectedValue(
      new BadDataException("duplicate key value violates unique constraint"),
    );
    findOneBy.mockResolvedValue(winner);
    claim.mockResolvedValue("already-owned-by-this");

    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      });

    expect(result).toBe(winner);
    const refetch: any = findOneBy.mock.calls[0]![0];
    expect(refetch.query.databaseIdentifier).toBe(
      "postgresql|orders-db.example.com:5432",
    );
    expect(refetch.query.projectId).toBe(PROJECT_ID);
    expect(deleteBy).not.toHaveBeenCalled();
    // The winner already recorded its own creation.
    await flushPromises();
    expect(sideEffects.feed).not.toHaveBeenCalled();
  });

  test("the endpoint race: our orphan is removed and the owner's row returned", async () => {
    const owner: DatabaseServer = databaseRow({ dbSystem: "cockroachdb" });
    claim.mockResolvedValue("owned-by-other");
    findOwner
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ databaseServerId: owner.id, isPrimary: true });
    findOneBy.mockResolvedValue(owner);

    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      });

    expect(result).toBe(owner);

    const orphan: DatabaseServer = create.mock.calls[0]![0].data;
    expect(deleteBy).toHaveBeenCalledTimes(1);
    const deleteCall: any = deleteBy.mock.calls[0]![0];
    expect(deleteCall.query._id).toBe(orphan.id!.toString());
    expect(deleteCall.query.projectId).toBe(PROJECT_ID);
    expect(deleteCall.props).toEqual({ isRoot: true, ignoreHooks: true });

    // No feed item, rule run or notification ever referred to the orphan.
    await flushPromises();
    expect(sideEffects.feed).not.toHaveBeenCalled();
    expect(sideEffects.labelRules).not.toHaveBeenCalled();
  });

  test("the endpoint race against a row that has since vanished answers null", async () => {
    claim.mockResolvedValue("owned-by-other");
    findOwner.mockResolvedValue(null);

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      }),
    ).resolves.toBeNull();
    expect(deleteBy).toHaveBeenCalledTimes(1);
  });

  test("a create failure that is not a race is surfaced", async () => {
    create.mockRejectedValue(new Error("connection terminated"));
    findOneBy.mockResolvedValue(null);

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      }),
    ).rejects.toThrow("connection terminated");
  });

  test("a failing claim removes our new row and surfaces the error", async () => {
    claim.mockRejectedValue(new Error("connection terminated"));

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ORDERS_ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      }),
    ).rejects.toThrow("connection terminated");
    expect(deleteBy).toHaveBeenCalledTimes(1);
  });
});

describe("DatabaseServerService.findByIdInProject", () => {
  test("reads one row, scoped to the project, with the discovery columns", async () => {
    const row: DatabaseServer = databaseRow();
    const findOneBy: jest.SpyInstance = getJestSpyOn(
      service,
      "findOneBy",
    ).mockResolvedValue(row);

    await expect(
      DatabaseServerService.findByIdInProject(PROJECT_ID, row.id!),
    ).resolves.toBe(row);

    const call: any = findOneBy.mock.calls[0]![0];
    expect(call.query).toEqual({
      _id: row.id!.toString(),
      projectId: PROJECT_ID,
    });
    expect(call.props.isRoot).toBe(true);
    expect(call.select).toMatchObject({
      _id: true,
      projectId: true,
      name: true,
      dbSystem: true,
      isArchived: true,
      autoArchivedAt: true,
    });
    // The member-key map is the workload path's business only.
    expect(call.select.memberEntityKeys).toBeUndefined();
  });
});

/*
 * ---------------------------------------------------------------------------
 * upsertWorkloadDatabase - an in-memory world behind the seams
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService.upsertWorkloadDatabase", () => {
  interface World {
    rows: Map<string, DatabaseServer>;
    // endpoint -> owning databaseServerId
    owners: Map<string, string>;
    writes: Array<{ id: string; data: Record<string, unknown> }>;
    claims: Array<any>;
  }

  let world: World;
  let create: jest.SpyInstance;
  let rawQuery: jest.Mock;
  let logs: ReturnType<typeof silenceLogs>;

  const WORKLOAD: string =
    "postgresql|kubernetes:prod/data/statefulset/orders-db";
  const SERVICE_ALIAS: string = "orders-db.data.svc.cluster.local:5432@prod";
  const POD_ALIAS: string =
    "orders-db-0.orders-db-hl.data.svc.cluster.local:5432@prod";
  const UNQUALIFIED_ALIAS: string = "orders-db.data.svc.cluster.local:5432";

  function input(
    overrides: Partial<UpsertWorkloadDatabaseData> = {},
  ): UpsertWorkloadDatabaseData {
    return {
      projectId: PROJECT_ID,
      workloadIdentifier: WORKLOAD,
      dbSystem: "postgresql",
      displayName: "PostgreSQL data/orders-db",
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      aliases: [SERVICE_ALIAS, POD_ALIAS],
      memberKeysSeenNow: [MEMBER_KEY_A],
      instanceCount: 3,
      dbVersion: "16.4",
      kubernetesClusterId: CLUSTER_ID,
      kubernetesNamespace: "data",
      workloadKind: "StatefulSet",
      workloadName: "orders-db",
      allowCreate: true,
      ...overrides,
    };
  }

  function addRow(row: DatabaseServer): DatabaseServer {
    world.rows.set(row.id!.toString(), row);
    return row;
  }

  function matches(row: DatabaseServer, query: any): boolean {
    if (query._id && row.id!.toString() !== query._id.toString()) {
      return false;
    }
    if (
      query.projectId &&
      row.projectId!.toString() !== query.projectId.toString()
    ) {
      return false;
    }
    if (
      query.workloadIdentifier !== undefined &&
      row.workloadIdentifier !== query.workloadIdentifier
    ) {
      return false;
    }
    if (
      query.databaseIdentifier !== undefined &&
      row.databaseIdentifier !== query.databaseIdentifier
    ) {
      return false;
    }
    return true;
  }

  function lastWriteFor(row: DatabaseServer): Record<string, unknown> {
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      world.writes.filter((w: { id: string }) => {
        return w.id === row.id!.toString();
      });
    return writes[writes.length - 1]!.data;
  }

  beforeEach(() => {
    logs = silenceLogs();
    world = { rows: new Map(), owners: new Map(), writes: [], claims: [] };

    getJestSpyOn(service, "findOneBy").mockImplementation(
      async (findOneBy: any) => {
        for (const row of world.rows.values()) {
          if (matches(row, findOneBy.query)) {
            return row;
          }
        }
        return null;
      },
    );

    // Rows by a list of workload identifiers (the engine-family lookup).
    getJestSpyOn(service, "findBy").mockImplementation(async (findBy: any) => {
      const wanted: Array<string> = [];
      for (const values of Object.values(
        findBy.query.workloadIdentifier?.objectLiteralParameters || {},
      )) {
        wanted.push(...(values as Array<string>));
      }
      return Array.from(world.rows.values()).filter((row: DatabaseServer) => {
        return Boolean(
          row.workloadIdentifier && wanted.includes(row.workloadIdentifier),
        );
      });
    });

    getJestSpyOn(DatabaseServerEndpointService, "findBy").mockImplementation(
      async (findBy: any) => {
        expect(findBy.query.projectId).toBe(PROJECT_ID);
        /*
         * QueryHelper.any is a Raw operator: the endpoints ride in its bound
         * parameters, not in its value.
         */
        const wanted: Array<string> = [];
        for (const values of Object.values(
          findBy.query.endpoint.objectLiteralParameters || {},
        )) {
          wanted.push(...(values as Array<string>));
        }
        const rows: Array<DatabaseServerEndpoint> = [];
        for (const endpoint of wanted) {
          const ownerId: string | undefined = world.owners.get(endpoint);
          if (ownerId) {
            const row: DatabaseServerEndpoint = new DatabaseServerEndpoint();
            row.endpoint = endpoint;
            row.databaseServerId = new ObjectID(ownerId);
            rows.push(row);
          }
        }
        return rows;
      },
    );

    getJestSpyOn(
      DatabaseServerEndpointService,
      "claimEndpoint",
    ).mockImplementation(
      async (claim: any): Promise<DatabaseServerEndpointClaimResult> => {
        world.claims.push(claim);
        const ownerId: string | undefined = world.owners.get(claim.endpoint);
        if (ownerId) {
          return ownerId === claim.databaseServerId.toString()
            ? "already-owned-by-this"
            : "owned-by-other";
        }
        world.owners.set(claim.endpoint, claim.databaseServerId.toString());
        return "claimed";
      },
    );

    getJestSpyOn(service, "updateColumnsByIdWithoutHooks").mockImplementation(
      async (update: any) => {
        const row: DatabaseServer | undefined = world.rows.get(
          update.id.toString(),
        );
        if (!row) {
          return;
        }
        for (const [column, expected] of Object.entries(
          update.expectedData || {},
        )) {
          if (((row as any)[column] ?? null) !== expected) {
            // Compare-and-set lost: nothing written.
            return;
          }
        }
        world.writes.push({ id: update.id.toString(), data: update.data });
        Object.assign(row, update.data);
      },
    );

    create = getJestSpyOn(service, "create").mockImplementation(
      async (createBy: any) => {
        const row: DatabaseServer = createBy.data;
        row._id = ObjectID.generate().toString();
        addRow(row);
        return row;
      },
    );

    rawQuery = mockRawQuery([]);
    mockSideEffects();
  });

  test("finds the workload's own row and refreshes it - without touching the collector status", async () => {
    const existing: DatabaseServer = addRow(
      databaseRow({
        workloadIdentifier: WORKLOAD,
        databaseIdentifier: WORKLOAD,
        discoverySource: DatabaseServerDiscoverySource.Kubernetes,
        otelCollectorStatus: "connected",
      }),
    );
    world.owners.set(SERVICE_ALIAS, existing.id!.toString());

    const before: number = Date.now();
    const result: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input());

    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();

    const write: Record<string, unknown> = lastWriteFor(existing);
    expect(write["instanceCount"]).toBe(3);
    expect((write["lastSeenAt"] as Date).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(write["workloadKind"]).toBe("StatefulSet");
    expect(write["workloadName"]).toBe("orders-db");
    expect(write["kubernetesNamespace"]).toBe("data");
    expect((write["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
    expect(write["dbVersion"]).toBe("16.4");
    // Only this path stamps when the workload was last seen.
    expect((write["workloadLastSeenAt"] as Date).getTime()).toBe(
      (write["lastSeenAt"] as Date).getTime(),
    );
    expect("otelCollectorStatus" in write).toBe(false);
    expect("collectorLastSeenAt" in write).toBe(false);
    // Neither discovery source nor the name a person may have chosen.
    expect("discoverySource" in write).toBe(false);
    expect("name" in write).toBe(false);
    // Same engine, same evidence: nothing to record about the engine.
    expect("dbSystem" in write).toBe(false);
    expect("dbSystemSource" in write).toBe(false);
    expect(existing.otelCollectorStatus).toBe("connected");

    // Already ours: not re-claimed. New: claimed as a workload alias.
    expect(
      world.claims.map((claim: any) => {
        return claim.endpoint;
      }),
    ).toEqual([POD_ALIAS]);
    expect(world.claims[0].isPrimary).toBe(false);
    expect(world.claims[0].source).toBe("workload");
  });

  test("merges member keys - a pod restarted last week keeps its key, a stale one ages out", async () => {
    const now: number = Date.now();
    const existing: DatabaseServer = addRow(
      databaseRow({
        workloadIdentifier: WORKLOAD,
        memberEntityKeys: {
          [MEMBER_KEY_B]: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
          [MEMBER_KEY_OLD]: new Date(now - 45 * 24 * 3600 * 1000).toISOString(),
        },
      }),
    );

    await DatabaseServerService.upsertWorkloadDatabase(input());

    const keys: Record<string, string> = lastWriteFor(existing)[
      "memberEntityKeys"
    ] as Record<string, string>;
    expect(Object.keys(keys).sort()).toEqual(
      [MEMBER_KEY_A, MEMBER_KEY_B].sort(),
    );
    expect(Date.parse(keys[MEMBER_KEY_A]!)).toBeGreaterThanOrEqual(now - 1000);
    expect(existing.memberEntityKeys).toBe(keys);
  });

  test("ADOPTS the one endpoint row application traces found - no duplicate database", async () => {
    const tracesRow: DatabaseServer = addRow(
      databaseRow({
        name: "PostgreSQL orders-db.data.svc.cluster.local:5432",
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        databaseIdentifier: `postgresql|${SERVICE_ALIAS}`,
      }),
    );
    world.owners.set(SERVICE_ALIAS, tracesRow.id!.toString());

    const result: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input());

    expect(result).toBe(tracesRow);
    expect(create).not.toHaveBeenCalled();
    expect(tracesRow.workloadIdentifier).toBe(WORKLOAD);
    // First creator wins: adoption never rewrites where the row came from.
    expect(tracesRow.discoverySource).toBe("client-spans");
    expect(tracesRow.databaseIdentifier).toBe(`postgresql|${SERVICE_ALIAS}`);
    expect(tracesRow.name).toBe(
      "PostgreSQL orders-db.data.svc.cluster.local:5432",
    );

    // The adoption itself was a compare-and-set on an empty workloadIdentifier.
    const adoption: any = (
      service.updateColumnsByIdWithoutHooks as jest.SpyInstance
    ).mock.calls[0]![0];
    expect(adoption.data).toEqual({ workloadIdentifier: WORKLOAD });
    expect(adoption.expectedData).toEqual({ workloadIdentifier: null });
  });

  test("never adopts when the endpoints point at two databases - no tie-break", async () => {
    const a: DatabaseServer = addRow(databaseRow());
    const b: DatabaseServer = addRow(databaseRow());
    world.owners.set(SERVICE_ALIAS, a.id!.toString());
    world.owners.set(POD_ALIAS, b.id!.toString());

    const result: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input());

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).not.toBe(a);
    expect(result).not.toBe(b);
    expect(a.workloadIdentifier).toBeUndefined();
    expect(b.workloadIdentifier).toBeUndefined();
    // Neither endpoint is taken away from its owner.
    expect(world.owners.get(SERVICE_ALIAS)).toBe(a.id!.toString());
    expect(world.owners.get(POD_ALIAS)).toBe(b.id!.toString());
    expect(logs.info).toHaveBeenCalledWith(
      expect.stringContaining("belong to 2 different databases"),
      expect.anything(),
    );
  });

  test("never adopts a row that already belongs to another workload", async () => {
    const otherWorkload: DatabaseServer = addRow(
      databaseRow({
        workloadIdentifier:
          "postgresql|kubernetes:prod/data/statefulset/orders-db-old",
      }),
    );
    world.owners.set(SERVICE_ALIAS, otherWorkload.id!.toString());

    const result: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input());

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).not.toBe(otherWorkload);
    expect(otherWorkload.workloadIdentifier).toBe(
      "postgresql|kubernetes:prod/data/statefulset/orders-db-old",
    );
  });

  test("an UNQUALIFIED (local-scope) alias is never evidence for adoption", async () => {
    const localOwner: DatabaseServer = addRow(databaseRow());
    world.owners.set(UNQUALIFIED_ALIAS, localOwner.id!.toString());

    await DatabaseServerService.upsertWorkloadDatabase(
      input({ aliases: [SERVICE_ALIAS, UNQUALIFIED_ALIAS] }),
    );

    expect(localOwner.workloadIdentifier).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("a lost adoption race falls back to the workload index, never a second adoption", async () => {
    const tracesRow: DatabaseServer = addRow(databaseRow());
    world.owners.set(SERVICE_ALIAS, tracesRow.id!.toString());
    // Another workload adopted it between our read and our write.
    getJestSpyOn(service, "findByIdInProject").mockImplementation(async () => {
      const snapshot: DatabaseServer = databaseRow({});
      snapshot._id = tracesRow._id!;
      tracesRow.workloadIdentifier = "postgresql|kubernetes:prod/x/y/z";
      return snapshot;
    });

    const result: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input());

    expect(tracesRow.workloadIdentifier).toBe(
      "postgresql|kubernetes:prod/x/y/z",
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).not.toBe(tracesRow);
  });

  test("creates the workload's row: identity is the workload, first alias is primary", async () => {
    const result: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input());

    expect(create).toHaveBeenCalledTimes(1);
    const call: any = create.mock.calls[0]![0];
    expect(call.props).toEqual({ isRoot: true });
    const row: DatabaseServer = call.data;
    expect(result).toBe(row);
    expect(row.databaseIdentifier).toBe(WORKLOAD);
    expect(row.workloadIdentifier).toBe(WORKLOAD);
    expect(row.discoverySource).toBe("kubernetes");
    expect(row.name).toBe("PostgreSQL data/orders-db");
    expect(row.dbSystem).toBe("postgresql");
    expect(row.serverAddress).toBe("orders-db.data.svc.cluster.local");
    expect(row.serverPort).toBe(5432);
    expect(row.kubernetesClusterId).toBe(CLUSTER_ID);
    expect(row.otelCollectorStatus).toBeUndefined();

    expect(world.claims).toHaveLength(2);
    expect(world.claims[0]).toMatchObject({
      endpoint: SERVICE_ALIAS,
      isPrimary: true,
      source: "workload",
    });
    expect(world.claims[1]).toMatchObject({
      endpoint: POD_ALIAS,
      isPrimary: false,
    });
  });

  test("a container workload has no aliases and no endpoint to show", async () => {
    const dockerHostId: ObjectID = ObjectID.generate();

    await DatabaseServerService.upsertWorkloadDatabase(
      input({
        workloadIdentifier: "redis|docker:web-01/cache",
        dbSystem: "redis",
        displayName: "",
        discoverySource: DatabaseServerDiscoverySource.Docker,
        aliases: [],
        kubernetesClusterId: undefined,
        kubernetesNamespace: undefined,
        workloadKind: "Container",
        workloadName: "cache",
        dockerHostId: dockerHostId,
      }),
    );

    const row: DatabaseServer = create.mock.calls[0]![0].data;
    expect(row.name).toBe("Redis cache");
    expect(row.dockerHostId).toBe(dockerHostId);
    expect(row.serverAddress).toBeUndefined();
    expect(world.claims).toHaveLength(0);
  });

  test("aliases owned by another database are skipped, never taken", async () => {
    const other: DatabaseServer = addRow(
      databaseRow({ workloadIdentifier: "postgresql|kubernetes:prod/a/b/c" }),
    );
    const existing: DatabaseServer = addRow(
      databaseRow({ workloadIdentifier: WORKLOAD }),
    );
    world.owners.set(POD_ALIAS, other.id!.toString());

    await DatabaseServerService.upsertWorkloadDatabase(input());

    expect(world.owners.get(POD_ALIAS)).toBe(other.id!.toString());
    expect(world.owners.get(SERVICE_ALIAS)).toBe(existing.id!.toString());
    expect(
      world.claims.map((claim: any) => {
        return claim.endpoint;
      }),
    ).toEqual([SERVICE_ALIAS]);
    expect(logs.debug).toHaveBeenCalledWith(
      expect.stringContaining(`belong to other databases: ${POD_ALIAS}`),
      expect.anything(),
    );
  });

  test("aliases are re-canonicalized and deduped before anything is claimed", async () => {
    addRow(databaseRow({ workloadIdentifier: WORKLOAD }));

    await DatabaseServerService.upsertWorkloadDatabase(
      input({
        aliases: [
          "Orders-DB.data.svc.cluster.local:5432@PROD",
          SERVICE_ALIAS,
          "localhost:5432",
          "",
        ],
      }),
    );

    expect(
      world.claims.map((claim: any) => {
        return claim.endpoint;
      }),
    ).toEqual([SERVICE_ALIAS]);
  });

  test("one failing alias claim does not stop the rest", async () => {
    const existing: DatabaseServer = addRow(
      databaseRow({ workloadIdentifier: WORKLOAD }),
    );
    (
      DatabaseServerEndpointService.claimEndpoint as unknown as jest.SpyInstance
    ).mockRejectedValueOnce(new Error("deadlock detected"));

    const result: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input());

    expect(result).toBe(existing);
    expect(world.owners.get(POD_ALIAS)).toBe(existing.id!.toString());
    expect(logs.warn).toHaveBeenCalled();
  });

  test("nothing is created or written when creation is not allowed", async () => {
    await expect(
      DatabaseServerService.upsertWorkloadDatabase(
        input({ allowCreate: false }),
      ),
    ).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(world.writes).toHaveLength(0);
    expect(world.claims).toHaveLength(0);
  });

  test("adoption still happens when creation is not allowed", async () => {
    const tracesRow: DatabaseServer = addRow(databaseRow());
    world.owners.set(SERVICE_ALIAS, tracesRow.id!.toString());

    await expect(
      DatabaseServerService.upsertWorkloadDatabase(
        input({ allowCreate: false }),
      ),
    ).resolves.toBe(tracesRow);
  });

  test("a racing run that created the workload first is picked up, not duplicated", async () => {
    const racer: DatabaseServer = databaseRow({
      workloadIdentifier: WORKLOAD,
    });
    create.mockImplementation(async () => {
      addRow(racer);
      throw new BadDataException("duplicate key value");
    });

    await expect(
      DatabaseServerService.upsertWorkloadDatabase(input()),
    ).resolves.toBe(racer);
  });

  test("an auto-archived workload row is restored when seen again", async () => {
    const archived: DatabaseServer = addRow(
      databaseRow({
        workloadIdentifier: WORKLOAD,
        isArchived: true,
        autoArchivedAt: new Date(),
      }),
    );
    rawQuery.mockResolvedValue([{ _id: archived.id!.toString() }]);

    const result: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input());

    expect(result!.isArchived).toBe(false);
    expect(rawQuery).toHaveBeenCalledTimes(1);
  });

  test("oversized collector-free strings are clamped before the hook-free write", async () => {
    const existing: DatabaseServer = addRow(
      databaseRow({ workloadIdentifier: WORKLOAD }),
    );

    await DatabaseServerService.upsertWorkloadDatabase(
      input({
        workloadName: "w".repeat(900),
        workloadKind: "k".repeat(300),
        kubernetesNamespace: "n".repeat(300),
        dbVersion: "v".repeat(300),
      }),
    );

    const write: Record<string, unknown> = lastWriteFor(existing);
    expect((write["workloadName"] as string).length).toBe(500);
    expect((write["workloadKind"] as string).length).toBe(100);
    expect((write["kubernetesNamespace"] as string).length).toBe(100);
    expect((write["dbVersion"] as string).length).toBe(100);
  });

  test("a nonsense instance count is written as 0", async () => {
    const existing: DatabaseServer = addRow(
      databaseRow({ workloadIdentifier: WORKLOAD }),
    );

    await DatabaseServerService.upsertWorkloadDatabase(
      input({ instanceCount: Number.NaN }),
    );

    expect(lastWriteFor(existing)["instanceCount"]).toBe(0);
  });

  test("never throws - a failing read logs and answers null", async () => {
    getJestSpyOn(service, "findOneBy").mockRejectedValue(
      new Error("connection terminated"),
    );

    await expect(
      DatabaseServerService.upsertWorkloadDatabase(input()),
    ).resolves.toBeNull();
    expect(logs.error).toHaveBeenCalledWith(
      expect.stringContaining("connection terminated"),
      expect.anything(),
    );
  });

  test.each([
    ["an empty workload identifier", { workloadIdentifier: "  " }],
    ["an empty engine", { dbSystem: "" }],
  ])(
    "%s answers null without a read",
    async (_label: string, overrides: any) => {
      await expect(
        DatabaseServerService.upsertWorkloadDatabase(input(overrides)),
      ).resolves.toBeNull();
      expect(service.findOneBy).not.toHaveBeenCalled();
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Liveness: collector heartbeat vs sighting
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService liveness", () => {
  type WriteCall = { id: ObjectID; data: Record<string, unknown> };

  const DATABASE_ID: ObjectID = ObjectID.generate();
  let writes: Array<WriteCall>;
  let cache: Map<string, string>;
  let findOneById: jest.SpyInstance;
  let rawQuery: jest.Mock;

  /** A faithful in-memory Redis for the atomic gate primitives. */
  function mockCache(): void {
    getJestSpyOn(GlobalCache, "setStringIfNotExists").mockImplementation(
      async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
    getJestSpyOn(GlobalCache, "setStringIfChanged").mockImplementation(
      async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
    getJestSpyOn(GlobalCache, "deleteKey").mockImplementation(
      async (ns: string, key: string) => {
        cache.delete(`${ns}:${key}`);
      },
    );
  }

  function resetWindows(): void {
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    DatabaseServerService.clearAutoRestoreCheckMemo();
  }

  function lastWrite(): Record<string, unknown> {
    return writes[writes.length - 1]!.data;
  }

  beforeEach(() => {
    silenceLogs();
    writes = [];
    cache = new Map<string, string>();
    resetWindows();
    mockCache();
    getJestSpyOn(
      service,
      "updateColumnsByIdIfUnlockedWithoutHooks",
    ).mockImplementation(async (input: any) => {
      writes.push({ id: input.id, data: { ...input.data } });
      return true;
    });
    findOneById = getJestSpyOn(service, "findOneById").mockResolvedValue(null);
    rawQuery = mockRawQuery([]);
    mockSideEffects();
  });

  afterEach(() => {
    resetWindows();
  });

  describe("recordCollectorHeartbeat", () => {
    test("writes all three collector liveness columns to the row it was given", async () => {
      const before: number = Date.now();
      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.id.toString()).toBe(DATABASE_ID.toString());
      expect(Object.keys(lastWrite()).sort()).toEqual([
        "collectorLastSeenAt",
        "lastSeenAt",
        "otelCollectorStatus",
      ]);
      expect(lastWrite()["otelCollectorStatus"]).toBe("connected");
      expect(
        (lastWrite()["lastSeenAt"] as Date).getTime(),
      ).toBeGreaterThanOrEqual(before);
      expect(lastWrite()["collectorLastSeenAt"]).toEqual(
        lastWrite()["lastSeenAt"],
      );
    });

    test("carries the agent and engine versions", async () => {
      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
        agentVersion: " 0.118.0 ",
        dbVersion: "16.4",
      });

      expect(lastWrite()).toMatchObject({
        agentVersion: "0.118.0",
        dbVersion: "16.4",
      });
    });

    test("an empty version is not written", async () => {
      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
        agentVersion: "",
        dbVersion: "   ",
      });

      expect("agentVersion" in lastWrite()).toBe(false);
      expect("dbVersion" in lastWrite()).toBe(false);
    });

    test("an oversized version is clamped to the column width", async () => {
      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
        dbVersion: "x".repeat(5000),
      });

      expect((lastWrite()["dbVersion"] as string).length).toBe(100);
    });

    test("one heartbeat per window, however many batches arrive", async () => {
      for (let batch: number = 0; batch < 10; batch++) {
        SingleFlight.clear();
        await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
          dbVersion: "16.4",
        });
      }

      expect(writes).toHaveLength(1);
      expect(
        cache.has(`database-server-last-seen:${DATABASE_ID.toString()}`),
      ).toBe(true);
    });

    test("liveness survives a failing enriched write", async () => {
      getJestSpyOn(
        service,
        "updateColumnsByIdIfUnlockedWithoutHooks",
      ).mockImplementation(async (input: any) => {
        const data: Record<string, unknown> = { ...input.data };
        writes.push({ id: input.id, data: data });
        if ("dbVersion" in data) {
          throw new Error("value too long");
        }
        return true;
      });

      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
        dbVersion: "16.4",
      });

      expect(writes).toHaveLength(2);
      expect(Object.keys(lastWrite()).sort()).toEqual([
        "collectorLastSeenAt",
        "lastSeenAt",
        "otelCollectorStatus",
      ]);
    });

    test("restores a row discovery auto-archived - once per window, fleet-wide", async () => {
      const archived: DatabaseServer = databaseRow({
        isArchived: true,
        autoArchivedAt: new Date(),
      });
      archived._id = DATABASE_ID.toString();
      findOneById.mockResolvedValue(archived);
      rawQuery.mockResolvedValue([{ _id: DATABASE_ID.toString() }]);

      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID);

      expect(findOneById).toHaveBeenCalledTimes(1);
      // The archive state, plus what weighing engine evidence needs.
      expect(findOneById.mock.calls[0]![0].select).toMatchObject({
        _id: true,
        projectId: true,
        isArchived: true,
        autoArchivedAt: true,
        dbSystem: true,
        dbSystemSource: true,
        discoverySource: true,
        name: true,
      });
      expect(findOneById.mock.calls[0]![0].props).toEqual({ isRoot: true });
      expect(rawQuery).toHaveBeenCalledTimes(1);
      expect(archived.isArchived).toBe(false);

      // The next batch in this process: the in-process memo answers.
      SingleFlight.clear();
      ResourceHeartbeat.clearRecentHeartbeatMemo();
      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID);
      expect(findOneById).toHaveBeenCalledTimes(1);

      // Another pod (fresh memo): the shared gate answers.
      DatabaseServerService.clearAutoRestoreCheckMemo();
      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID);
      expect(findOneById).toHaveBeenCalledTimes(1);

      // The window has passed: look again.
      DatabaseServerService.clearAutoRestoreCheckMemo();
      cache.delete(
        `database-server-auto-restore-check:${DATABASE_ID.toString()}`,
      );
      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID);
      expect(findOneById).toHaveBeenCalledTimes(2);
    });

    test("a live row costs no restore statement", async () => {
      const live: DatabaseServer = databaseRow();
      live._id = DATABASE_ID.toString();
      findOneById.mockResolvedValue(live);

      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID);

      expect(rawQuery).not.toHaveBeenCalled();
    });

    test("a Redis outage skips the restore check rather than reading per batch", async () => {
      getJestSpyOn(GlobalCache, "setStringIfNotExists").mockRejectedValue(
        new Error("redis down"),
      );

      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID);

      // Liveness still fails OPEN...
      expect(writes).toHaveLength(1);
      // ...but the restore check fails CLOSED.
      expect(findOneById).not.toHaveBeenCalled();
    });

    test("a failing restore check never fails the heartbeat", async () => {
      findOneById.mockRejectedValue(new Error("connection terminated"));

      await expect(
        DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID),
      ).resolves.toBeUndefined();
    });
  });

  describe("recordSighting", () => {
    test("moves lastSeenAt only - being queried is not a connected collector", async () => {
      await DatabaseServerService.recordSighting(DATABASE_ID);

      expect(writes).toHaveLength(1);
      expect(Object.keys(lastWrite())).toEqual(["lastSeenAt"]);
      expect(
        cache.has(`database-server-sighting:${DATABASE_ID.toString()}`),
      ).toBe(true);
    });

    test("one sighting per window", async () => {
      for (let batch: number = 0; batch < 5; batch++) {
        SingleFlight.clear();
        await DatabaseServerService.recordSighting(DATABASE_ID);
      }

      expect(writes).toHaveLength(1);
    });

    /*
     * Separate namespaces: a database queried every second must not be able
     * to suppress the heartbeat that says its collector is alive.
     */
    test("a sighting never suppresses the collector heartbeat", async () => {
      await DatabaseServerService.recordSighting(DATABASE_ID);
      SingleFlight.clear();
      await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID);

      expect(writes).toHaveLength(2);
      expect(lastWrite()["otelCollectorStatus"]).toBe("connected");
    });

    test("never runs the auto-archive check", async () => {
      await DatabaseServerService.recordSighting(DATABASE_ID);

      expect(findOneById).not.toHaveBeenCalled();
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Sweeps: stale collectors, auto-archive, budget
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService.markDisconnectedDatabaseServers", () => {
  test("flips connected rows whose COLLECTOR went quiet, in one conditional statement", async () => {
    const query: jest.Mock = mockRawQuery([{ count: 3 }]);
    const restore: () => void = withEnv(
      "DATABASE_SERVER_COLLECTOR_STALE_MINUTES",
      undefined,
    );

    try {
      const before: number = Date.now();
      const flipped: number =
        await DatabaseServerService.markDisconnectedDatabaseServers();
      const after: number = Date.now();

      expect(flipped).toBe(3);
      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
      expect(sql).toContain(`SET "otelCollectorStatus" = 'disconnected'`);
      expect(sql).toContain(`WHERE "otelCollectorStatus" = 'connected'`);
      expect(sql).toContain(`"collectorLastSeenAt" < $1`);
      expect(sql).toContain(`"deletedAt" IS NULL`);
      // An application still querying the database must not hide a dead collector.
      expect(sql).not.toContain(`"lastSeenAt"`);

      const threshold: Date = params[0] as Date;
      const fifteenMinutes: number = 15 * 60 * 1000;
      expect(before - threshold.getTime()).toBeGreaterThanOrEqual(
        fifteenMinutes - 1000,
      );
      expect(after - threshold.getTime()).toBeLessThanOrEqual(
        fifteenMinutes + 1000,
      );
    } finally {
      restore();
    }
  });

  test("a string count from the driver is still a number", async () => {
    mockRawQuery([{ count: "7" }]);

    await expect(
      DatabaseServerService.markDisconnectedDatabaseServers(),
    ).resolves.toBe(7);
  });

  test("an empty result is 0", async () => {
    mockRawQuery([]);

    await expect(
      DatabaseServerService.markDisconnectedDatabaseServers(),
    ).resolves.toBe(0);
  });
});

describe("DatabaseServerService.getCollectorStaleThresholdMinutes", () => {
  test.each([
    [undefined, 15],
    ["", 15],
    ["30", 30],
    ["10", 10],
    // Below the floor flaps healthy databases against the ingest fence.
    ["5", 10],
    ["0", 10],
    ["-3", 10],
    ["abc", 15],
    ["12.5", 15],
  ])("%s -> %s minutes", (value: string | undefined, expected: number) => {
    const restore: () => void = withEnv(
      "DATABASE_SERVER_COLLECTOR_STALE_MINUTES",
      value,
    );
    try {
      expect(DatabaseServerService.getCollectorStaleThresholdMinutes()).toBe(
        expected,
      );
    } finally {
      restore();
    }
  });
});

describe("DatabaseServerService.autoArchiveStaleDatabaseServers", () => {
  let feed: jest.SpyInstance;

  beforeEach(() => {
    silenceLogs();
    feed = mockSideEffects().feed;
  });

  test("archives in ONE statement that checks every 'untouched' condition itself", async () => {
    const query: jest.Mock = mockRawQuery([]);
    const restore: () => void = withEnv(
      "DATABASE_SERVER_AUTO_ARCHIVE_DAYS",
      undefined,
    );

    try {
      const before: number = Date.now();
      await DatabaseServerService.autoArchiveStaleDatabaseServers();

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];

      // Discovered, live, not yet archived, unseen since the cutoff.
      expect(sql).toContain(`ds."deletedAt" IS NULL`);
      expect(sql).toContain(`ds."isArchived" = false`);
      expect(sql).toContain(`ds."discoverySource" IS NOT NULL`);
      expect(sql).toContain(`ds."discoverySource" <> $3`);
      expect(params[2]).toBe("manual");
      expect(sql).toContain(`COALESCE(ds."lastSeenAt", ds."createdAt") < $1`);
      const cutoff: Date = params[0] as Date;
      const sevenDays: number = 7 * 24 * 3600 * 1000;
      expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(
        sevenDays - 1000,
      );
      expect(before - cutoff.getTime()).toBeLessThanOrEqual(sevenDays + 5000);

      // No retention override.
      expect(sql).toContain(`ds."retainTelemetryDataForDays" IS NULL`);
      expect(sql).toContain(`ds."telemetryRetentionConfig" IS NULL`);

      // Nobody invested in it: every join is scoped to the row's project and live rows.
      for (const table of [
        "DatabaseServerLabel",
        "DatabaseServerOwnerUser",
        "DatabaseServerOwnerTeam",
        "IncidentDatabaseServer",
        "AlertDatabaseServer",
        "ScheduledMaintenanceDatabaseServer",
        "DatabaseServerEndpoint",
      ]) {
        expect(sql).toMatch(
          new RegExp(`NOT EXISTS \\(\\s*SELECT 1 FROM "${table}"`),
        );
      }
      expect((sql.match(/"projectId" = ds\."projectId"/g) || []).length).toBe(
        7,
      );
      // The row, its seven investment joins and its three possible parents.
      expect((sql.match(/"deletedAt" IS NULL/g) || []).length).toBe(11);
      expect(sql).toContain(`e."source" = 'user'`);

      /*
       * Only a PERSON's labels and owners count: the ones rules and ingest
       * attached (automaticAssignments) are excluded inside each join.
       */
      expect(sql).toContain(
        `NOT (COALESCE(ds."automaticAssignments" -> 'labelIds', '[]'::jsonb) @> jsonb_build_array(l."labelId"::text))`,
      );
      expect(sql).toContain(
        `NOT (COALESCE(ds."automaticAssignments" -> 'ownerUserIds', '[]'::jsonb) @> jsonb_build_array(ou."userId"::text))`,
      );
      expect(sql).toContain(
        `NOT (COALESCE(ds."automaticAssignments" -> 'ownerTeamIds', '[]'::jsonb) @> jsonb_build_array(ot."teamId"::text))`,
      );

      /*
       * Staleness is anchored to the cluster / host the row was found on:
       * while the parent is dark, its databases are not "unseen".
       */
      expect(sql).toMatch(
        /LEFT JOIN "KubernetesCluster" kc\s+ON kc\."_id" = ds\."kubernetesClusterId" AND kc\."deletedAt" IS NULL/,
      );
      expect(sql).toMatch(
        /LEFT JOIN "DockerHost" dh\s+ON dh\."_id" = ds\."dockerHostId" AND dh\."deletedAt" IS NULL/,
      );
      expect(sql).toMatch(
        /LEFT JOIN "PodmanHost" ph\s+ON ph\."_id" = ds\."podmanHostId" AND ph\."deletedAt" IS NULL/,
      );
      expect(sql).toContain(
        `COALESCE(ds."lastSeenAt", ds."createdAt") < COALESCE(kc."lastSeenAt", dh."lastSeenAt", ph."lastSeenAt", $2) - INTERVAL '1 hour'`,
      );

      /*
       * A person's Restore holds until the row is seen again or the grace
       * period (30 days, or the archive window if longer) passes.
       */
      expect(sql).toContain(`ds."manuallyRestoredAt" IS NULL`);
      expect(sql).toContain(`ds."manuallyRestoredAt" < $5`);
      expect(sql).toContain(
        `COALESCE(ds."lastSeenAt", ds."createdAt") > ds."manuallyRestoredAt"`,
      );
      const graceCutoff: Date = params[4] as Date;
      const thirtyDays: number = 30 * 24 * 3600 * 1000;
      expect(before - graceCutoff.getTime()).toBeGreaterThanOrEqual(
        thirtyDays - 1000,
      );
      expect(before - graceCutoff.getTime()).toBeLessThanOrEqual(
        thirtyDays + 5000,
      );

      // Marked as discovery's own archive, bounded, and never re-archiving.
      expect(sql).toContain(`"autoArchivedAt" = $2`);
      expect(sql).toContain(`"isArchived" = true`);
      expect(sql).toContain(`stale."isArchived" = false`);
      expect(sql).toContain("LIMIT $4");
      expect(params[3]).toBe(500);
      expect(params).toHaveLength(5);
    } finally {
      restore();
    }
  });

  test("records why on each archived row's feed, and returns the count", async () => {
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();
    mockRawQuery([
      { _id: a.toString(), projectId: PROJECT_ID.toString() },
      { _id: b.toString(), projectId: PROJECT_ID.toString() },
    ]);

    const archived: number =
      await DatabaseServerService.autoArchiveStaleDatabaseServers();

    expect(archived).toBe(2);
    expect(feed).toHaveBeenCalledTimes(2);
    const item: any = feed.mock.calls[0]![0];
    expect(item.databaseServerId.toString()).toBe(a.toString());
    expect(item.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(item.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.DatabaseServerArchived,
    );
    expect(item.feedInfoInMarkdown).toContain(
      "was automatically archived - not seen for 7 days.",
    );
    expect(item.moreInformationInMarkdown).toContain(
      "restored automatically as soon as it is seen again",
    );
    expect(item.userId).toBeUndefined();
  });

  test("the day count follows DATABASE_SERVER_AUTO_ARCHIVE_DAYS", async () => {
    const query: jest.Mock = mockRawQuery([
      { _id: ObjectID.generate().toString(), projectId: PROJECT_ID.toString() },
    ]);
    const restore: () => void = withEnv(
      "DATABASE_SERVER_AUTO_ARCHIVE_DAYS",
      "1",
    );

    try {
      const before: number = Date.now();
      await DatabaseServerService.autoArchiveStaleDatabaseServers();

      const cutoff: Date = (
        query.mock.calls[0]![1] as Array<unknown>
      )[0] as Date;
      expect(before - cutoff.getTime()).toBeLessThanOrEqual(
        24 * 3600 * 1000 + 5000,
      );
      expect(feed.mock.calls[0]![0].feedInfoInMarkdown).toContain(
        "not seen for 1 day.",
      );
    } finally {
      restore();
    }
  });

  test("nothing stale means no feed writes", async () => {
    mockRawQuery([]);

    await expect(
      DatabaseServerService.autoArchiveStaleDatabaseServers(),
    ).resolves.toBe(0);
    expect(feed).not.toHaveBeenCalled();
  });

  test("a failing feed write never stops the rest of the batch", async () => {
    mockRawQuery([
      { _id: ObjectID.generate().toString(), projectId: PROJECT_ID.toString() },
      { _id: ObjectID.generate().toString(), projectId: PROJECT_ID.toString() },
    ]);
    getJestSpyOn(service, "getDatabaseServerMarkdownLink")
      .mockRejectedValueOnce(new Error("row gone"))
      .mockResolvedValue("[Database x](/x)");

    await expect(
      DatabaseServerService.autoArchiveStaleDatabaseServers(),
    ).resolves.toBe(2);
    expect(feed).toHaveBeenCalledTimes(1);
  });
});

describe("DatabaseServerService.getAutoArchiveDays", () => {
  test.each([
    [undefined, 7],
    ["14", 14],
    ["1", 1],
    ["0", 1],
    ["nope", 7],
  ])("%s -> %s days", (value: string | undefined, expected: number) => {
    const restore: () => void = withEnv(
      "DATABASE_SERVER_AUTO_ARCHIVE_DAYS",
      value,
    );
    try {
      expect(DatabaseServerService.getAutoArchiveDays()).toBe(expected);
    } finally {
      restore();
    }
  });
});

describe("DatabaseServerService auto-create budget", () => {
  test.each([
    [undefined, 500],
    ["50", 50],
    ["0", 0],
    ["-1", 0],
    ["x", 500],
  ])("budget %s -> %s", (value: string | undefined, expected: number) => {
    const restore: () => void = withEnv(
      "DATABASE_SERVER_AUTO_CREATE_BUDGET",
      value,
    );
    try {
      expect(DatabaseServerService.getAutoCreateBudget()).toBe(expected);
    } finally {
      restore();
    }
  });

  test("counts live, non-archived DISCOVERED rows of this project only - collector rows included", async () => {
    const query: jest.Mock = mockRawQuery([{ count: 499 }]);
    const restore: () => void = withEnv(
      "DATABASE_SERVER_AUTO_CREATE_BUDGET",
      undefined,
    );

    try {
      await expect(
        DatabaseServerService.isUnderAutoCreateBudget(PROJECT_ID),
      ).resolves.toBe(true);

      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
      expect(sql).toContain(`"projectId" = $1`);
      expect(sql).toContain(`"deletedAt" IS NULL`);
      expect(sql).toContain(`"isArchived" = false`);
      /*
       * Only a person's rows are exempt. A collector keyed on pod IPs mints
       * rows too, so its rows count against the budget.
       */
      expect(sql).toContain(`COALESCE("discoverySource", '') <> $2`);
      expect(params).toEqual([PROJECT_ID.toString(), "manual"]);
    } finally {
      restore();
    }
  });

  test("at the budget, discovery stops creating", async () => {
    mockRawQuery([{ count: "500" }]);

    await expect(
      DatabaseServerService.isUnderAutoCreateBudget(PROJECT_ID),
    ).resolves.toBe(false);
  });

  test("a zero budget turns auto-creation off without a query", async () => {
    const query: jest.Mock = mockRawQuery([{ count: 0 }]);
    const restore: () => void = withEnv(
      "DATABASE_SERVER_AUTO_CREATE_BUDGET",
      "0",
    );

    try {
      await expect(
        DatabaseServerService.isUnderAutoCreateBudget(PROJECT_ID),
      ).resolves.toBe(false);
      expect(query).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Updates, labels, links
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService.onUpdateSuccess", () => {
  let clearWrites: jest.SpyInstance;
  let feed: jest.SpyInstance;

  function onUpdate(data: Record<string, unknown>): any {
    return {
      updateBy: {
        query: {},
        data: data,
        props: { userId: USER_ID },
      },
      carryForward: null,
    };
  }

  beforeEach(() => {
    silenceLogs();
    feed = mockSideEffects().feed;
    clearWrites = getJestSpyOn(
      service,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined);
    getJestSpyOn(service, "findOneById").mockResolvedValue(databaseRow());
  });

  /*
   * A person archiving (or restoring) a row takes it out of discovery's
   * hands: from then on only a person restores it.
   */
  test.each([[true], [false]])(
    "a person setting isArchived=%s clears autoArchivedAt",
    async (isArchived: boolean) => {
      const id: ObjectID = ObjectID.generate();
      const before: number = Date.now();

      await service.onUpdateSuccess(onUpdate({ isArchived }), [id]);

      expect(clearWrites).toHaveBeenCalledTimes(1);
      const write: any = clearWrites.mock.calls[0]![0];
      expect(write.id).toBe(id);
      expect(write.skipUpdateDateColumn).toBe(true);
      expect(write.data.autoArchivedAt).toBeNull();
      /*
       * A Restore is stamped so the sweep leaves the row alone; an archive
       * clears the stamp.
       */
      if (isArchived) {
        expect(write.data.manuallyRestoredAt).toBeNull();
      } else {
        expect(
          (write.data.manuallyRestoredAt as Date).getTime(),
        ).toBeGreaterThanOrEqual(before);
      }
      await flushPromises();
      expect(feed.mock.calls[0]![0].databaseServerFeedEventType).toBe(
        isArchived
          ? DatabaseServerFeedEventType.DatabaseServerArchived
          : DatabaseServerFeedEventType.DatabaseServerRestored,
      );
      expect(feed.mock.calls[0]![0].userId).toBe(USER_ID);
    },
  );

  test("an edit that is not an archive change leaves autoArchivedAt alone", async () => {
    await service.onUpdateSuccess(onUpdate({ name: "Orders" }), [
      ObjectID.generate(),
    ]);

    expect(clearWrites).not.toHaveBeenCalled();
    await flushPromises();
    expect(feed.mock.calls[0]![0].databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.DatabaseServerUpdated,
    );
    expect(feed.mock.calls[0]![0].moreInformationInMarkdown).toContain(
      "`name`",
    );
  });

  test("bookkeeping columns never earn a feed item", async () => {
    await service.onUpdateSuccess(
      onUpdate({ lastSeenAt: new Date(), otelCollectorStatus: "connected" }),
      [ObjectID.generate()],
    );
    await flushPromises();

    expect(feed).not.toHaveBeenCalled();
  });

  test("a failing clear is logged, not thrown", async () => {
    clearWrites.mockRejectedValue(new Error("connection terminated"));

    await expect(
      service.onUpdateSuccess(onUpdate({ isArchived: true }), [
        ObjectID.generate(),
      ]),
    ).resolves.toBeDefined();
  });
});

describe("DatabaseServerService.attachLabels", () => {
  test("adds only the labels the database is missing, and caches the set", async () => {
    const existing: Label = new Label(ObjectID.generate());
    const added: ObjectID = ObjectID.generate();
    const add: jest.Mock = jest.fn(async () => {
      return undefined;
    });
    const builder: any = {
      createQueryBuilder: () => {
        return builder;
      },
      relation: () => {
        return builder;
      },
      of: () => {
        return builder;
      },
      loadMany: async () => {
        return [existing];
      },
      add: add,
    };
    getJestSpyOn(service, "getRepository").mockReturnValue(builder);
    getJestSpyOn(GlobalCache, "getString").mockResolvedValue(null);
    const setString: jest.SpyInstance = getJestSpyOn(
      GlobalCache,
      "setString",
    ).mockResolvedValue(undefined);

    await DatabaseServerService.attachLabels({
      databaseServerId: ObjectID.generate(),
      labelIds: [existing.id!, added, added],
    });

    expect(add).toHaveBeenCalledWith([added.toString()]);
    expect(setString.mock.calls[0]![0]).toBe("database-server-labels-applied");
  });

  test("a label set applied within the minute costs no join-table read", async () => {
    const labelId: ObjectID = ObjectID.generate();
    getJestSpyOn(GlobalCache, "getString").mockResolvedValue(
      crypto.createHash("sha256").update(labelId.toString()).digest("hex"),
    );
    const getRepository: jest.SpyInstance = getJestSpyOn(
      service,
      "getRepository",
    );

    await DatabaseServerService.attachLabels({
      databaseServerId: ObjectID.generate(),
      labelIds: [labelId],
    });

    expect(getRepository).not.toHaveBeenCalled();
  });

  test("no labels is a no-op", async () => {
    const getString: jest.SpyInstance = getJestSpyOn(GlobalCache, "getString");

    await DatabaseServerService.attachLabels({
      databaseServerId: ObjectID.generate(),
      labelIds: [],
    });

    expect(getString).not.toHaveBeenCalled();
  });
});

describe("DatabaseServerService names and links", () => {
  test("links to /databases/<id> and names the database in feed markdown", async () => {
    const id: ObjectID = ObjectID.generate();
    getJestSpyOn(service, "findOneById").mockResolvedValue(
      databaseRow({ name: "PostgreSQL orders-db.example.com:5432" }),
    );
    getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockResolvedValue(
      URL.fromString("https://oneuptime.example.com/dashboard"),
    );

    const markdown: string =
      await DatabaseServerService.getDatabaseServerMarkdownLink(PROJECT_ID, id);

    expect(markdown).toBe(
      `[Database PostgreSQL orders-db.example.com:5432](https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/databases/${id.toString()})`,
    );
  });

  test("a missing row names as an empty string instead of throwing", async () => {
    getJestSpyOn(service, "findOneById").mockResolvedValue(null);

    await expect(
      DatabaseServerService.getDatabaseServerName({
        databaseServerId: ObjectID.generate(),
      }),
    ).resolves.toBe("");
  });
});
