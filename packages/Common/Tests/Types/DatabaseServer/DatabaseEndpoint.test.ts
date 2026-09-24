import {
  buildDatabaseCallerContext,
  buildDatabaseServerDisplayName,
  buildDatabaseServerIdentifier,
  buildKubernetesDatabaseAliases,
  buildWorkloadDatabaseServerIdentifier,
  canonicalizeDatabaseEndpoint,
  DATABASE_INSTANCE_ATTRIBUTES,
  DatabaseCallerContext,
  DatabaseEndpoint,
  DatabaseEndpointPurpose,
  formatDatabaseEndpoint,
  getDatabaseClusterHost,
  getDatabaseEndpointScope,
  isClusterScopedDatabaseHost,
  isEphemeralCaller,
  isHostRelativeDatabaseHost,
  isIpLiteralHost,
  isKubernetesDatabaseCaller,
  isLinkLocalIpHost,
  isLoopbackDatabaseHost,
  isPrivateIpHost,
  ManualDatabaseEndpoint,
  NETWORK_SCOPED_NAME_SUFFIXES,
  parseDatabaseEndpointString,
  parseHostAndPort,
  parseHostAndPortList,
  ParsedHostAndPort,
  parseManualDatabaseEndpoint,
  readDatabaseInstanceName,
  splitDatabaseHostInstance,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import { keyForDatabaseEndpoint } from "../../../Utils/Telemetry/EntityKey";
import { describe, expect, test } from "@jest/globals";

/*
 * The endpoint rules decide which telemetry lands on which database page.
 * A wrong merge shows one database's queries on another's page; a wrong
 * split leaves a page dark. Every rule of SPEC §2.3 is pinned here.
 */

const VM_CALLER: DatabaseCallerContext = {
  hostName: "app-7.corp.example",
  isEphemeral: false,
};

const K8S_CALLER: DatabaseCallerContext = {
  kubernetesNamespace: "shop",
  kubernetesClusterName: "prod-eu",
  hostName: "checkout-7d9f-abcde",
  isEphemeral: true,
};

const NO_CONTEXT: DatabaseCallerContext = { isEphemeral: true };

function canonical(
  address: string | null | undefined,
  options: {
    system?: string;
    port?: string | number | null;
    caller?: DatabaseCallerContext;
    purpose?: DatabaseEndpointPurpose;
  } = {},
): DatabaseEndpoint | null {
  return canonicalizeDatabaseEndpoint({
    system: options.system ?? "postgresql",
    address,
    port: options.port,
    caller: options.caller ?? NO_CONTEXT,
    purpose: options.purpose ?? "client-call",
  });
}

describe("parseHostAndPort — accepted shapes", () => {
  test.each([
    ["db.prod.example.com", "db.prod.example.com", null],
    ["db.prod.example.com:6543", "db.prod.example.com", 6543],
    ["  DB.Prod.Example.COM.  ", "db.prod.example.com", null],
    ["db.prod.example.com.:5432", "db.prod.example.com", 5432],
    ["10.0.0.5", "10.0.0.5", null],
    ["10.0.0.5:5432", "10.0.0.5", 5432],
    ["010.000.000.005", "10.0.0.5", null],
    ["pg_primary", "pg_primary", null],
    ["postgres", "postgres", null],
  ])("%s → host %s port %s", (raw: string, host: string, port: unknown) => {
    expect(parseHostAndPort(raw)).toEqual({ host, port });
  });

  test("URL forms: scheme, userinfo, path and query are stripped", () => {
    expect(
      parseHostAndPort("postgres://app:secret@db.prod:5432/orders"),
    ).toEqual({ host: "db.prod", port: 5432 });
    expect(
      parseHostAndPort("postgresql://db.prod:5432/orders?sslmode=require"),
    ).toEqual({ host: "db.prod", port: 5432 });
    expect(parseHostAndPort("redis://cache.prod#frag")).toEqual({
      host: "cache.prod",
      port: null,
    });
    expect(
      parseHostAndPort("mongodb+srv://cluster0.abc.mongodb.net/app"),
    ).toEqual({ host: "cluster0.abc.mongodb.net", port: null });
    expect(parseHostAndPort("jdbc:postgresql://db.prod:5433/app")).toEqual({
      host: "db.prod",
      port: 5433,
    });
  });

  test("URL userinfo splits on the LAST @ before the first /", () => {
    // A password containing "@" must not leak into the host.
    expect(parseHostAndPort("mysql://app:p@ss@w0rd@db.prod:3306/x")).toEqual({
      host: "db.prod",
      port: 3306,
    });
    // An "@" after the authority is path, not userinfo.
    expect(parseHostAndPort("mysql://db.prod:3306/x@y")).toEqual({
      host: "db.prod",
      port: 3306,
    });
  });

  test("userinfo is only recognised in URL forms", () => {
    expect(parseHostAndPort("admin@db:5432")).toBeNull();
  });

  test("JDBC ;key=value properties are not part of the address", () => {
    expect(
      parseHostAndPort(
        "jdbc:sqlserver://sql.prod:1433;databaseName=orders;encrypt=true",
      ),
    ).toEqual({ host: "sql.prod", port: 1433 });
    expect(parseHostAndPort("sql.prod:1433;encrypt=true")).toEqual({
      host: "sql.prod",
      port: 1433,
    });
  });

  test("a host list keeps its first host in canonical order", () => {
    expect(
      parseHostAndPort("mongodb://m1.prod:27017,m2.prod:27017/app"),
    ).toEqual({ host: "m1.prod", port: 27017 });
    expect(parseHostAndPort("m1.prod:27018,m2.prod:27017")).toEqual({
      host: "m1.prod",
      port: 27018,
    });
  });

  test("non-URL values drop a path and query", () => {
    // Oracle's service.instance.id shape: host:port/service.
    expect(parseHostAndPort("ora.prod:1521/ORCLPDB1")).toEqual({
      host: "ora.prod",
      port: 1521,
    });
    expect(parseHostAndPort("db.prod:5432?x=1")).toEqual({
      host: "db.prod",
      port: 5432,
    });
  });

  test("SQL Server forms", () => {
    expect(parseHostAndPort("tcp:sql.prod,1433")).toEqual({
      host: "sql.prod",
      port: 1433,
    });
    expect(parseHostAndPort("TCP:sql.prod")).toEqual({
      host: "sql.prod",
      port: null,
    });
    expect(parseHostAndPort("sql.prod,14330")).toEqual({
      host: "sql.prod",
      port: 14330,
    });
    // The named instance is returned beside the host, lowercased.
    expect(parseHostAndPort("sql.prod\\SQLEXPRESS")).toEqual({
      host: "sql.prod",
      port: null,
      instance: "sqlexpress",
    });
    expect(parseHostAndPort("sql.prod\\SQLEXPRESS,1434")).toEqual({
      host: "sql.prod",
      port: 1434,
      instance: "sqlexpress",
    });
    expect(parseHostAndPort("sql.prod\\SQLEXPRESS:1435")).toEqual({
      host: "sql.prod",
      port: 1435,
      instance: "sqlexpress",
    });
    // MSSQLSERVER is the default instance: no instance at all.
    expect(parseHostAndPort("sql.prod\\MSSQLSERVER")).toEqual({
      host: "sql.prod",
      port: null,
    });
    expect(parseHostAndPort("sql.prod\\")).toEqual({
      host: "sql.prod",
      port: null,
    });
  });

  test("a SQL Server instance that is not a valid instance name rejects the value", () => {
    for (const raw of [
      "sql.prod\\[REDACTED]",
      "sql.prod\\SQL EXPRESS",
      "sql.prod\\averyveryverylonginstance",
      "sql.prod\\inst:abc",
    ]) {
      expect(parseHostAndPort(raw)).toBeNull();
    }
    // "#" ends an address (a URL fragment), so it never reaches an instance.
    expect(parseHostAndPort("sql.prod\\inst#1")).toEqual({
      host: "sql.prod",
      port: null,
      instance: "inst",
    });
  });

  test("a host literally named tcp keeps its port", () => {
    expect(parseHostAndPort("tcp:5432")).toEqual({ host: "tcp", port: 5432 });
  });

  test("SQL Server local-machine spellings become localhost", () => {
    expect(parseHostAndPort("(local)")).toEqual({
      host: "localhost",
      port: null,
    });
    expect(parseHostAndPort("(LOCAL)\\SQLEXPRESS")).toEqual({
      host: "localhost",
      port: null,
      instance: "sqlexpress",
    });
    expect(parseHostAndPort(".")).toEqual({ host: "localhost", port: null });
    expect(parseHostAndPort(".\\SQLEXPRESS,1433")).toEqual({
      host: "localhost",
      port: 1433,
      instance: "sqlexpress",
    });
    expect(parseHostAndPort("(localdb)\\MSSQLLocalDB")).toEqual({
      host: "localhost",
      port: null,
      instance: "mssqllocaldb",
    });
  });

  test("IPv6: brackets, bare, zone id, compression, case", () => {
    expect(parseHostAndPort("[fd00::5]:5432")).toEqual({
      host: "fd00::5",
      port: 5432,
    });
    expect(parseHostAndPort("[FD00:0:0:0:0:0:0:5]")).toEqual({
      host: "fd00::5",
      port: null,
    });
    expect(parseHostAndPort("fd00:0000:0000::0005")).toEqual({
      host: "fd00::5",
      port: null,
    });
    expect(parseHostAndPort("fe80::1%eth0")).toEqual({
      host: "fe80::1",
      port: null,
    });
    expect(parseHostAndPort("[fe80::1%25eth0]:6379")).toEqual({
      host: "fe80::1",
      port: 6379,
    });
    expect(parseHostAndPort("2001:db8:0:0:1:0:0:1")).toEqual({
      host: "2001:db8::1:0:0:1",
      port: null,
    });
    expect(parseHostAndPort("::1")).toEqual({ host: "::1", port: null });
    expect(parseHostAndPort("::")).toEqual({ host: "::", port: null });
  });

  test("IPv4-mapped IPv6 is unwrapped to IPv4 (dotted and hex tails)", () => {
    expect(parseHostAndPort("::ffff:10.0.0.5")).toEqual({
      host: "10.0.0.5",
      port: null,
    });
    expect(parseHostAndPort("[::ffff:10.0.0.5]:5432")).toEqual({
      host: "10.0.0.5",
      port: 5432,
    });
    expect(parseHostAndPort("::FFFF:7f00:1")).toEqual({
      host: "127.0.0.1",
      port: null,
    });
  });

  test("ports outside 1..65535 are dropped, not the host", () => {
    expect(parseHostAndPort("db.prod:0")).toEqual({
      host: "db.prod",
      port: null,
    });
    expect(parseHostAndPort("db.prod:65536")).toEqual({
      host: "db.prod",
      port: null,
    });
    expect(parseHostAndPort("db.prod:65535")).toEqual({
      host: "db.prod",
      port: 65535,
    });
    expect(parseHostAndPort("db.prod:")).toEqual({
      host: "db.prod",
      port: null,
    });
    expect(parseHostAndPort("[fd00::1]:")).toEqual({
      host: "fd00::1",
      port: null,
    });
  });
});

describe("parseHostAndPort — rejected values", () => {
  test.each([
    // Built-in trace scrub outputs.
    ["[REDACTED]"],
    ["[redacted]:5432"],
    ["[HASHED:ab12cd34]"],
    ["[HASHED:ab]"],
    ["***.***.***.***"],
    ["***.***.***.***:5432"],
    // Garbage.
    ["*"],
    [""],
    ["   "],
    ["db prod"],
    ["db\tprod"],
    ["(db)"],
    ["db!.prod"],
    ["hashed:ab12cd"],
    ["db.prod:abc"],
    // Unix socket paths.
    ["/var/run/postgresql"],
    ["/tmp/.s.PGSQL.5432"],
    // Mangled addresses.
    ["999.1.1.1"],
    ["1.2.3"],
    ["12345"],
    ["[fd00::1"],
    ["[fd00::1]5432"],
    ["fd00:::1"],
    ["1:2:3:4:5:6:7:8:9"],
    [":5432"],
  ])("%j → null", (raw: string) => {
    expect(parseHostAndPort(raw)).toBeNull();
  });

  test("labels and total length follow RFC 1123 limits", () => {
    const label63: string = "a".repeat(63);
    expect(parseHostAndPort(`${label63}.example.com`)?.host).toBe(
      `${label63}.example.com`,
    );
    expect(parseHostAndPort(`${"a".repeat(64)}.example.com`)).toBeNull();

    const long: string = `${Array(64).fill("abc").join(".")}.com`; // 259 chars
    expect(long.length).toBeGreaterThan(253);
    expect(parseHostAndPort(long)).toBeNull();
  });

  test("non-strings are null", () => {
    expect(parseHostAndPort(null)).toBeNull();
    expect(parseHostAndPort(undefined)).toBeNull();
    expect(parseHostAndPort(5432)).toBeNull();
    expect(parseHostAndPort({ host: "db" })).toBeNull();
  });
});

describe("host classification", () => {
  test("isIpLiteralHost", () => {
    expect(isIpLiteralHost("10.0.0.5")).toBe(true);
    expect(isIpLiteralHost("fd00::1")).toBe(true);
    expect(isIpLiteralHost("[fd00::1]")).toBe(true);
    expect(isIpLiteralHost("db.prod")).toBe(false);
    expect(isIpLiteralHost("1.2.3")).toBe(false);
    expect(isIpLiteralHost("")).toBe(false);
  });

  test("isLoopbackDatabaseHost", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "api.localhost",
      "127.0.0.1",
      "127.1.2.3",
      "::1",
      "::",
      "0.0.0.0",
      "::ffff:127.0.0.1",
      "0:0:0:0:0:0:0:1",
      "(local)",
      ".",
      // The /etc/hosts aliases distributions give the loopback address.
      "localhost.localdomain",
      "LOCALHOST.LOCALDOMAIN.",
      "localhost4",
      "localhost6",
      "localhost6.localdomain6",
      "ip6-localhost",
      "ip6-loopback",
      "localhost.",
    ]) {
      expect(isLoopbackDatabaseHost(host)).toBe(true);
    }
    for (const host of ["db.prod", "10.0.0.5", "128.0.0.1", "localhost.corp"]) {
      expect(isLoopbackDatabaseHost(host)).toBe(false);
    }
  });

  test("isHostRelativeDatabaseHost", () => {
    for (const host of [
      "host.docker.internal",
      "HOST.DOCKER.INTERNAL.",
      "host.containers.internal",
      "gateway.docker.internal",
      "docker.for.mac.localhost",
      "kubernetes.docker.internal",
    ]) {
      expect(isHostRelativeDatabaseHost(host)).toBe(true);
    }
    expect(isHostRelativeDatabaseHost("db.internal")).toBe(false);
  });

  test("isPrivateIpHost covers RFC 1918, CGNAT and ULA only", () => {
    for (const host of [
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "100.127.255.255",
      "fc00::1",
      "fd12:3456::1",
      "[fd00::1]",
      "::ffff:10.1.2.3",
    ]) {
      expect(isPrivateIpHost(host)).toBe(true);
    }
    for (const host of [
      "172.15.0.1",
      "172.32.0.1",
      "192.169.0.1",
      "100.63.255.255",
      "100.128.0.1",
      "8.8.8.8",
      "2001:db8::1",
      "fe80::1",
      "db.prod",
      "10.0.0",
    ]) {
      expect(isPrivateIpHost(host)).toBe(false);
    }
  });
});

describe("isEphemeralCaller / buildDatabaseCallerContext", () => {
  const VM: Record<string, unknown> = {
    "host.name": "app-7",
    "os.type": "linux",
  };

  test("a VM with os.type is a stable machine", () => {
    expect(isEphemeralCaller(VM)).toBe(false);
  });

  test.each([
    ["k8s.pod.name", "checkout-7d9f"],
    ["k8s.namespace.name", "shop"],
    ["k8s.cluster.name", "prod"],
    ["k8s.node.name", "node-1"],
    ["container.id", "0123456789ab"],
    ["container.runtime", "docker"],
    ["faas.name", "resize-image"],
    ["faas.instance", "2021/06/28/[$LATEST]abc"],
  ])("%s marks the caller ephemeral", (key: string, value: string) => {
    expect(isEphemeralCaller({ ...VM, [key]: value })).toBe(true);
  });

  test.each([
    "aws_ecs",
    "aws_lambda",
    "aws_app_runner",
    "gcp_cloud_run",
    "gcp_cloud_functions",
    "gcp_app_engine",
    "azure_container_apps",
    "azure_container_instances",
    "azure_functions",
  ])("cloud.platform %s marks the caller ephemeral", (platform: string) => {
    expect(isEphemeralCaller({ ...VM, "cloud.platform": platform })).toBe(true);
  });

  test("an EC2 / GCE VM stays stable", () => {
    expect(isEphemeralCaller({ ...VM, "cloud.platform": "aws_ec2" })).toBe(
      false,
    );
  });

  test("no os.type → ephemeral (no system detector ran)", () => {
    expect(isEphemeralCaller({ "host.name": "app-7" })).toBe(true);
    expect(isEphemeralCaller({ "host.name": "app-7", "os.type": "  " })).toBe(
      true,
    );
    expect(isEphemeralCaller({})).toBe(true);
  });

  test("blank identity attributes do not count", () => {
    expect(isEphemeralCaller({ ...VM, "k8s.pod.name": "  " })).toBe(false);
    expect(isEphemeralCaller({ ...VM, "container.id": "" })).toBe(false);
  });

  test("the stored resource.-prefixed spelling is honoured", () => {
    expect(
      isEphemeralCaller({
        "resource.host.name": "app-7",
        "resource.os.type": "linux",
      }),
    ).toBe(false);
    expect(
      isEphemeralCaller({
        "resource.os.type": "linux",
        "resource.k8s.pod.name": "p",
      }),
    ).toBe(true);
    expect(
      isEphemeralCaller({
        "resource.os.type": "linux",
        "resource.faas.name": "f",
      }),
    ).toBe(true);
  });

  test("buildDatabaseCallerContext reads namespace, cluster and host", () => {
    expect(
      buildDatabaseCallerContext({
        "k8s.namespace.name": " shop ",
        "k8s.cluster.name": "prod-eu",
        "host.name": "checkout-7d9f",
      }),
    ).toEqual({
      kubernetesNamespace: "shop",
      kubernetesClusterName: "prod-eu",
      hostName: "checkout-7d9f",
      isEphemeral: true,
    });
    expect(buildDatabaseCallerContext(VM)).toEqual({
      kubernetesNamespace: null,
      kubernetesClusterName: null,
      hostName: "app-7",
      isEphemeral: false,
    });
  });
});

describe("canonicalizeDatabaseEndpoint — rule 1 (parse + port)", () => {
  test("the engine default port is applied when none is given", () => {
    expect(canonical("db.prod")).toEqual({ host: "db.prod", port: 5432 });
    expect(canonical("cache.prod", { system: "redis" })).toEqual({
      host: "cache.prod",
      port: 6379,
    });
    expect(canonical("db.prod", { system: "postgres" })).toEqual({
      host: "db.prod",
      port: 5432,
    });
  });

  test("an explicit port wins over the address port and the default", () => {
    expect(canonical("db.prod:6543", { port: 5433 })).toEqual({
      host: "db.prod",
      port: 5433,
    });
    expect(canonical("db.prod", { port: "6543" })).toEqual({
      host: "db.prod",
      port: 6543,
    });
    expect(canonical("db.prod:6543")).toEqual({ host: "db.prod", port: 6543 });
  });

  test("an invalid explicit port falls back", () => {
    expect(canonical("db.prod:6543", { port: "abc" })).toEqual({
      host: "db.prod",
      port: 6543,
    });
    expect(canonical("db.prod", { port: 0 })).toEqual({
      host: "db.prod",
      port: 5432,
    });
    expect(canonical("db.prod", { port: 5432.5 })).toEqual({
      host: "db.prod",
      port: 5432,
    });
  });

  test("an unknown engine without a port keeps port null", () => {
    expect(canonical("db.prod", { system: "acmedb" })).toEqual({
      host: "db.prod",
      port: null,
    });
    expect(canonical("db.prod", { system: "" })).toEqual({
      host: "db.prod",
      port: null,
    });
  });

  test("unparseable addresses are null", () => {
    expect(canonical(null)).toBeNull();
    expect(canonical(undefined)).toBeNull();
    expect(canonical("[REDACTED]")).toBeNull();
    expect(canonical("***.***.***.***")).toBeNull();
  });
});

describe("canonicalizeDatabaseEndpoint — rule 2 (loopback + host-relative)", () => {
  const LOOPBACKS: Array<string> = [
    "localhost",
    "localhost:5432",
    "127.0.0.1",
    "::1",
    "[::1]:5432",
    "::",
    "0.0.0.0",
    "::ffff:127.0.0.1",
    "(local)",
    ".",
    "db.localhost",
    "localhost.localdomain",
    "ip6-localhost",
  ];
  const HOST_RELATIVE: Array<string> = [
    "host.docker.internal",
    "host.containers.internal",
    "gateway.docker.internal",
    "docker.for.mac.localhost",
    "kubernetes.docker.internal",
  ];

  test.each([...LOOPBACKS, ...HOST_RELATIVE])(
    "client-call: %s is never an identity, whoever the caller is",
    (address: string) => {
      expect(canonical(address, { caller: VM_CALLER })).toBeNull();
      expect(canonical(address, { caller: K8S_CALLER })).toBeNull();
      expect(canonical(address, { caller: NO_CONTEXT })).toBeNull();
    },
  );

  test.each([...LOOPBACKS, ...HOST_RELATIVE])(
    "collector on a stable VM: %s is the VM's own host",
    (address: string) => {
      expect(
        canonical(address, { caller: VM_CALLER, purpose: "collector" }),
      ).toEqual({ host: "app-7.corp.example", port: 5432 });
    },
  );

  test("collector: the address port survives the rewrite", () => {
    expect(
      canonical("localhost:6543", { caller: VM_CALLER, purpose: "collector" }),
    ).toEqual({ host: "app-7.corp.example", port: 6543 });
  });

  test("collector: an ephemeral collector's loopback is null", () => {
    expect(
      canonical("localhost", { caller: K8S_CALLER, purpose: "collector" }),
    ).toBeNull();
    expect(
      canonical("127.0.0.1", {
        caller: { hostName: "3f9a1b2c4d5e", isEphemeral: true },
        purpose: "collector",
      }),
    ).toBeNull();
  });

  test("collector: no host.name, or a loopback host.name, is null", () => {
    expect(
      canonical("localhost", {
        caller: { isEphemeral: false },
        purpose: "collector",
      }),
    ).toBeNull();
    expect(
      canonical("localhost", {
        caller: { hostName: "localhost", isEphemeral: false },
        purpose: "collector",
      }),
    ).toBeNull();
    expect(
      canonical("localhost", {
        caller: { hostName: "[REDACTED]", isEphemeral: false },
        purpose: "collector",
      }),
    ).toBeNull();
  });

  test("collector: the rewritten host is canonicalized", () => {
    expect(
      canonical("localhost", {
        caller: { hostName: "  DB-1.Corp. ", isEphemeral: false },
        purpose: "collector",
      }),
    ).toEqual({ host: "db-1.corp", port: 5432 });
  });

  test("a non-loopback address is unaffected by the purpose", () => {
    expect(
      canonical("db.prod", { caller: VM_CALLER, purpose: "collector" }),
    ).toEqual(canonical("db.prod", { caller: VM_CALLER }));
  });
});

describe("canonicalizeDatabaseEndpoint — rule 3 (Kubernetes DNS)", () => {
  test.each([
    ["pg.shop.svc", "pg.shop.svc.cluster.local"],
    ["pg.shop.svc.cluster.local", "pg.shop.svc.cluster.local"],
    ["pg.shop.svc.cluster.local.", "pg.shop.svc.cluster.local"],
    ["pg.shop.svc.corp.k8s", "pg.shop.svc.cluster.local"],
    ["PG.Shop.SVC", "pg.shop.svc.cluster.local"],
    // A StatefulSet member behind a headless Service.
    ["pg-0.pg-hl.shop.svc", "pg-0.pg-hl.shop.svc.cluster.local"],
    ["pg-0.pg-hl.shop.svc.corp.k8s", "pg-0.pg-hl.shop.svc.cluster.local"],
  ])("%s → %s", (address: string, host: string) => {
    expect(canonical(address, { caller: NO_CONTEXT })?.host).toBe(host);
  });

  test("a single-label name expands with the caller's namespace", () => {
    expect(
      canonical("pg", {
        caller: { kubernetesNamespace: "Shop", isEphemeral: true },
      }),
    ).toEqual({ host: "pg.shop.svc.cluster.local", port: 5432 });
  });

  test("a single-label name without a namespace stays as is", () => {
    expect(canonical("pg", { caller: VM_CALLER })).toEqual({
      host: "pg",
      port: 5432,
    });
  });

  test("an invalid namespace does not produce a bogus FQDN", () => {
    expect(
      canonical("pg", {
        caller: { kubernetesNamespace: "not a namespace", isEphemeral: true },
      })?.host,
    ).toBe("pg");
  });

  test("a two-label name from a Kubernetes caller is <service>.<namespace>", () => {
    // A pod's resolver search path turns `pg.shop` into the Service FQDN.
    expect(canonical("pg.shop", { caller: K8S_CALLER })).toEqual({
      host: "pg.shop.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod-eu",
    });
  });

  test("a two-label name from anything else is a domain and left alone", () => {
    expect(canonical("pg.shop", { caller: VM_CALLER })).toEqual({
      host: "pg.shop",
      port: 5432,
    });
    expect(canonical("pg.shop", { caller: NO_CONTEXT })).toEqual({
      host: "pg.shop",
      port: 5432,
    });
  });

  test("IP literals are never expanded", () => {
    expect(
      canonical("fd00::1", {
        caller: { kubernetesNamespace: "shop", isEphemeral: true },
      })?.host,
    ).toBe("fd00::1");
  });

  test("a one-label-before-svc name is not a Service FQDN", () => {
    expect(canonical("pg.svc", { caller: NO_CONTEXT })?.host).toBe("pg.svc");
  });
});

describe("canonicalizeDatabaseEndpoint — rule 4 (cluster qualifier)", () => {
  test("cluster-local names are qualified with the caller's cluster", () => {
    expect(canonical("pg", { caller: K8S_CALLER })).toEqual({
      host: "pg.shop.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod-eu",
    });
    expect(
      canonical("pg.other.svc.cluster.local", { caller: K8S_CALLER }),
    ).toEqual({
      host: "pg.other.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod-eu",
    });
  });

  test("private IPs are qualified (pod CIDRs overlap across clusters)", () => {
    for (const address of [
      "10.244.3.17",
      "172.20.0.5",
      "192.168.0.10",
      "100.64.1.2",
      "fd00::5",
      "::ffff:10.244.3.17",
    ]) {
      expect(
        canonical(address, { caller: K8S_CALLER })?.kubernetesClusterName,
      ).toBe("prod-eu");
    }
  });

  test("public names and public IPs are never qualified", () => {
    for (const address of [
      "mydb.abc123.us-east-1.rds.amazonaws.com",
      "8.8.8.8",
      "2001:db8::1",
    ]) {
      expect(
        canonical(address, { caller: K8S_CALLER })?.kubernetesClusterName,
      ).toBeUndefined();
    }
    // A two-label name is only public when the caller is not in Kubernetes.
    expect(
      canonical("pg.shop", {
        caller: { ...VM_CALLER, kubernetesClusterName: null },
      })?.kubernetesClusterName,
    ).toBeUndefined();
  });

  test("the cluster is canonicalized but otherwise kept raw (ARNs)", () => {
    const arn: string = "arn:aws:eks:us-east-1:123456789012:cluster/Prod-EU";
    expect(
      canonical("10.0.0.5", {
        caller: { kubernetesClusterName: `  ${arn} `, isEphemeral: true },
      })?.kubernetesClusterName,
    ).toBe(arn.toLowerCase());
  });

  test("no cluster on the caller → no qualifier (and no empty one)", () => {
    const endpoint: DatabaseEndpoint | null = canonical("10.0.0.5", {
      caller: { kubernetesClusterName: "  ", isEphemeral: true },
    });
    expect(endpoint).toEqual({ host: "10.0.0.5", port: 5432 });
    expect(Object.keys(endpoint!)).not.toContain("kubernetesClusterName");
  });
});

describe("getDatabaseEndpointScope", () => {
  test.each([
    [{ host: "db.prod.example.com", port: 5432 }, "global"],
    [{ host: "8.8.8.8", port: 5432 }, "global"],
    [{ host: "2001:db8::1", port: 5432 }, "global"],
    [
      {
        host: "pg.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "prod",
      },
      "global",
    ],
    [{ host: "10.0.0.5", port: 5432, kubernetesClusterName: "prod" }, "global"],
    [{ host: "pg.shop", port: 5432 }, "global"],
    [{ host: "postgres", port: 5432 }, "local"],
    [{ host: "db1", port: 5432 }, "local"],
    [{ host: "pg.shop.svc.cluster.local", port: 5432 }, "local"],
    [
      {
        host: "pg.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "  ",
      },
      "local",
    ],
    [{ host: "10.0.0.5", port: 5432 }, "local"],
    [{ host: "fd00::5", port: 5432 }, "local"],
    [{ host: "100.64.0.1", port: 5432 }, "local"],
    [{ host: "localhost", port: 5432 }, "local"],
    [{ host: "127.0.0.1", port: 5432 }, "local"],
    [{ host: "host.docker.internal", port: 5432 }, "local"],
    [{ host: "", port: 5432 }, "local"],
  ])("%j is %s", (endpoint: DatabaseEndpoint, scope: string) => {
    expect(getDatabaseEndpointScope(endpoint)).toBe(scope);
  });
});

describe("formatDatabaseEndpoint", () => {
  test.each([
    [{ host: "db.prod", port: 5432 }, "db.prod:5432"],
    [{ host: "db.prod", port: null }, "db.prod"],
    [{ host: "DB.Prod", port: 5432 }, "db.prod:5432"],
    [{ host: "fd00::5", port: 5432 }, "[fd00::5]:5432"],
    [{ host: "fd00::5", port: null }, "[fd00::5]"],
    [
      {
        host: "pg.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: " Prod-EU ",
      },
      "pg.shop.svc.cluster.local:5432@prod-eu",
    ],
    [
      { host: "10.0.0.5", port: 5432, kubernetesClusterName: "" },
      "10.0.0.5:5432",
    ],
    [{ host: "db.prod", port: 0 }, "db.prod"],
  ])("%j → %s", (endpoint: DatabaseEndpoint, formatted: string) => {
    expect(formatDatabaseEndpoint(endpoint)).toBe(formatted);
  });
});

describe("parseDatabaseEndpointString", () => {
  const PG: { system: string } = { system: "postgresql" };

  test("round-trips everything canonicalize produces", () => {
    const endpoints: Array<DatabaseEndpoint | null> = [
      canonical("db.prod.example.com"),
      canonical("db.prod.example.com:6543"),
      canonical("pg", { caller: K8S_CALLER }),
      canonical("10.244.3.17", { caller: K8S_CALLER }),
      canonical("fd00::5", { caller: K8S_CALLER }),
      canonical("2001:db8::1:0:0:1"),
      canonical("db.prod", { system: "acmedb" }),
      canonical("pg.shop.svc.cluster.local"),
    ];
    for (const endpoint of endpoints) {
      expect(endpoint).not.toBeNull();
      expect(
        parseDatabaseEndpointString(formatDatabaseEndpoint(endpoint!), {
          system: endpoint!.port === null ? "acmedb" : "postgresql",
        }),
      ).toEqual(endpoint);
    }
  });

  test("an ARN-like cluster name round-trips", () => {
    const endpoint: DatabaseEndpoint = {
      host: "pg.shop.svc.cluster.local",
      port: 5432,
      kubernetesClusterName:
        "arn:aws:eks:us-east-1:123456789012:cluster/prod-eu",
    };
    const formatted: string = formatDatabaseEndpoint(endpoint);
    expect(formatted).toBe(
      "pg.shop.svc.cluster.local:5432@arn:aws:eks:us-east-1:123456789012:cluster/prod-eu",
    );
    expect(parseDatabaseEndpointString(formatted, PG)).toEqual(endpoint);
  });

  test("the cluster splits on the LAST @", () => {
    expect(
      parseDatabaseEndpointString("10.0.0.5:5432@team@prod", PG),
    ).toBeNull();
    expect(
      parseDatabaseEndpointString("10.0.0.5:5432@prod", PG)
        ?.kubernetesClusterName,
    ).toBe("prod");
  });

  test("a qualifier on a host that resolves the same everywhere is refused, not dropped", () => {
    expect(
      parseDatabaseEndpointString("db.prod.example.com:5432@prod", PG),
    ).toBeNull();
    expect(parseDatabaseEndpointString("8.8.8.8@prod", PG)).toBeNull();
    expect(parseDatabaseEndpointString("2001:db8::1@prod", PG)).toBeNull();
  });

  test("an empty qualifier is no qualifier", () => {
    expect(parseDatabaseEndpointString("10.0.0.5:5432@", PG)).toEqual({
      host: "10.0.0.5",
      port: 5432,
    });
  });

  test("URL forms: the @ is userinfo, never a cluster", () => {
    expect(
      parseDatabaseEndpointString(
        "postgres://admin@pg.shop.svc.cluster.local:5432/app",
        { ...PG, kubernetesClusterName: "prod" },
      ),
    ).toEqual({
      host: "pg.shop.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod",
    });
  });

  test("row context: a bare name on a Kubernetes row expands and qualifies", () => {
    expect(
      parseDatabaseEndpointString("pg:5432", {
        system: "postgresql",
        kubernetesNamespace: "shop",
        kubernetesClusterName: "Prod-EU",
      }),
    ).toEqual({
      host: "pg.shop.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod-eu",
    });
  });

  test("row context: .svc forms expand, and the row cluster fills in", () => {
    expect(
      parseDatabaseEndpointString("pg.shop.svc", {
        system: "postgresql",
        kubernetesClusterName: "prod",
      }),
    ).toEqual({
      host: "pg.shop.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod",
    });
  });

  test("an explicit qualifier wins over the row's cluster", () => {
    expect(
      parseDatabaseEndpointString("10.0.0.5@staging", {
        system: "postgresql",
        kubernetesClusterName: "prod",
      })?.kubernetesClusterName,
    ).toBe("staging");
  });

  test("a bare name without row context stays single-label", () => {
    expect(parseDatabaseEndpointString("postgres", PG)).toEqual({
      host: "postgres",
      port: 5432,
    });
  });

  test("the port defaults from the row's engine", () => {
    expect(
      parseDatabaseEndpointString("cache.prod", { system: "redis" }),
    ).toEqual({ host: "cache.prod", port: 6379 });
    expect(parseDatabaseEndpointString("cache.prod", { system: "" })).toEqual({
      host: "cache.prod",
      port: null,
    });
  });

  test("loopback, host-relative and garbage are null", () => {
    for (const value of [
      "localhost:5432",
      "localhost.localdomain",
      "127.0.0.1",
      "[::1]:5432",
      "host.docker.internal",
      "(local)",
      "[REDACTED]",
      "***.***.***.***@prod",
      "",
      "  ",
      "@prod",
    ]) {
      expect(parseDatabaseEndpointString(value, PG)).toBeNull();
    }
    expect(parseDatabaseEndpointString(null, PG)).toBeNull();
    expect(parseDatabaseEndpointString(42, PG)).toBeNull();
  });

  test("a non-URL user@host is refused — never read as host@qualifier", () => {
    // The finding's probes: these used to become hosts "user" and "admin".
    expect(parseDatabaseEndpointString("user@db.example.com", PG)).toBeNull();
    expect(parseDatabaseEndpointString("admin@10.0.0.5:5432", PG)).toBeNull();
    expect(parseDatabaseEndpointString("admin@db:5432", PG)).toBeNull();
    // Even on a Kubernetes row, whose namespace would expand "admin".
    expect(
      parseDatabaseEndpointString("admin@10.0.0.5:5432", {
        system: "postgresql",
        kubernetesNamespace: "shop",
        kubernetesClusterName: "prod",
      }),
    ).toBeNull();
    expect(
      parseDatabaseEndpointString("admin@db.example.com", {
        system: "postgresql",
        kubernetesNamespace: "shop",
      }),
    ).toBeNull();
    // A dotted user name is not read as a <service>.<namespace> either.
    expect(
      parseDatabaseEndpointString("john.doe@db.example.com", PG),
    ).toBeNull();
    expect(
      parseDatabaseEndpointString("postgres.data@db.example.com", PG),
    ).toBeNull();
  });

  test("an address that takes a qualifier keeps it, whatever the cluster name looks like", () => {
    for (const [value, host] of [
      ["10.0.0.5@prod.eu-west-1", "10.0.0.5"],
      ["pg.shop.svc.cluster.local@prod.eu-west-1", "pg.shop.svc.cluster.local"],
      ["pg.shop.svc@prod.eu-west-1", "pg.shop.svc.cluster.local"],
      ["db.internal@prod.eu-west-1", "db.internal"],
      ["postgres.data:5432@prod.eu-west-1", "postgres.data.svc.cluster.local"],
    ] as Array<[string, string]>) {
      const endpoint: DatabaseEndpoint | null = parseDatabaseEndpointString(
        value,
        PG,
      );
      expect(endpoint?.host).toBe(host);
      expect(endpoint?.kubernetesClusterName).toBe("prod.eu-west-1");
    }
    // An EKS ARN never reads as a server.
    expect(
      parseDatabaseEndpointString(
        "postgres.data@arn:aws:eks:us-east-1:1:cluster/prod",
        PG,
      )?.kubernetesClusterName,
    ).toBe("arn:aws:eks:us-east-1:1:cluster/prod");
  });
});

describe("buildDatabaseServerIdentifier", () => {
  test("system|formatted endpoint, system normalized", () => {
    expect(
      buildDatabaseServerIdentifier("postgres", {
        host: "db.prod",
        port: 5432,
      }),
    ).toBe("postgresql|db.prod:5432");
    expect(
      buildDatabaseServerIdentifier("postgresql", {
        host: "pg.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "prod",
      }),
    ).toBe("postgresql|pg.shop.svc.cluster.local:5432@prod");
  });

  test("cluster-qualified and unqualified endpoints are different rows", () => {
    expect(
      buildDatabaseServerIdentifier("postgresql", {
        host: "10.0.0.5",
        port: 5432,
        kubernetesClusterName: "prod",
      }),
    ).not.toBe(
      buildDatabaseServerIdentifier("postgresql", {
        host: "10.0.0.5",
        port: 5432,
      }),
    );
  });
});

describe("buildWorkloadDatabaseServerIdentifier", () => {
  test("kubernetes: cluster/namespace/kind/name, lowercased", () => {
    expect(
      buildWorkloadDatabaseServerIdentifier({
        system: "postgres",
        platform: "kubernetes",
        parentName: "Prod-EU",
        namespace: "Shop",
        workloadKind: "Cluster",
        workloadName: "PG-Main",
      }),
    ).toBe("postgresql|kubernetes:prod-eu/shop/cluster/pg-main");
  });

  test("kubernetes: missing namespace / kind leave empty segments", () => {
    expect(
      buildWorkloadDatabaseServerIdentifier({
        system: "redis",
        platform: "kubernetes",
        parentName: "prod",
        workloadName: "cache",
      }),
    ).toBe("redis|kubernetes:prod///cache");
  });

  test("docker / podman: no kind, so compose labels cannot change identity", () => {
    const base: {
      system: string;
      parentName: string;
      workloadName: string;
    } = {
      system: "mysql",
      parentName: "Build-Host-1",
      workloadName: "shop-db",
    };

    expect(
      buildWorkloadDatabaseServerIdentifier({ ...base, platform: "docker" }),
    ).toBe("mysql|docker:build-host-1/shop-db");
    expect(
      buildWorkloadDatabaseServerIdentifier({
        ...base,
        platform: "docker",
        workloadKind: "ComposeService",
        namespace: "shop",
      }),
    ).toBe("mysql|docker:build-host-1/shop-db");
    expect(
      buildWorkloadDatabaseServerIdentifier({ ...base, platform: "podman" }),
    ).toBe("mysql|podman:build-host-1/shop-db");
  });
});

describe("buildDatabaseServerDisplayName", () => {
  test("engine + host:port, never the cluster qualifier", () => {
    expect(
      buildDatabaseServerDisplayName({
        system: "postgresql",
        endpoint: {
          host: "pg.shop.svc.cluster.local",
          port: 5432,
          kubernetesClusterName: "prod",
        },
      }),
    ).toBe("PostgreSQL pg.shop.svc.cluster.local:5432");
    expect(
      buildDatabaseServerDisplayName({
        system: "redis",
        endpoint: { host: "fd00::5", port: 6379 },
      }),
    ).toBe("Redis [fd00::5]:6379");
  });

  test("engine + namespace/workload, or the workload alone", () => {
    expect(
      buildDatabaseServerDisplayName({
        system: "mongodb",
        namespace: "shop",
        workloadName: "orders-db",
      }),
    ).toBe("MongoDB shop/orders-db");
    expect(
      buildDatabaseServerDisplayName({
        system: "mongodb",
        workloadName: "orders-db",
      }),
    ).toBe("MongoDB orders-db");
  });

  test("the endpoint wins over the workload", () => {
    expect(
      buildDatabaseServerDisplayName({
        system: "mysql",
        endpoint: { host: "db.prod", port: 3306 },
        workloadName: "ignored",
      }),
    ).toBe("MySQL db.prod:3306");
  });

  test("nothing to name → just the engine; unknown engine → raw", () => {
    expect(buildDatabaseServerDisplayName({ system: "postgresql" })).toBe(
      "PostgreSQL",
    );
    expect(buildDatabaseServerDisplayName({ system: "" })).toBe("Database");
    expect(
      buildDatabaseServerDisplayName({
        system: "acmedb",
        endpoint: { host: "acme.prod", port: 4000 },
      }),
    ).toBe("acmedb acme.prod:4000");
  });

  test("is capped at 100 characters, keeping the engine", () => {
    const name: string = buildDatabaseServerDisplayName({
      system: "postgresql",
      endpoint: { host: `${"a".repeat(60)}.${"b".repeat(60)}.com`, port: 5432 },
    });
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.startsWith("PostgreSQL ")).toBe(true);
  });
});

describe("buildKubernetesDatabaseAliases", () => {
  test("each Service × port, qualified; the engine default port is always included", () => {
    expect(
      buildKubernetesDatabaseAliases({
        system: "postgresql",
        namespace: "shop",
        clusterName: "prod",
        serviceNames: ["pg-rw", "pg-ro"],
        ports: [5432],
        includeUnqualified: false,
      }),
    ).toEqual([
      "pg-rw.shop.svc.cluster.local:5432@prod",
      "pg-ro.shop.svc.cluster.local:5432@prod",
    ]);
  });

  test("the unqualified twin only when asked (single-cluster projects)", () => {
    expect(
      buildKubernetesDatabaseAliases({
        system: "redis",
        namespace: "cache",
        clusterName: "Prod",
        serviceNames: ["redis-master"],
        ports: [],
        includeUnqualified: true,
      }),
    ).toEqual([
      "redis-master.cache.svc.cluster.local:6379@prod",
      "redis-master.cache.svc.cluster.local:6379",
    ]);
  });

  test("declared container ports are added after the default, deduped", () => {
    expect(
      buildKubernetesDatabaseAliases({
        system: "postgresql",
        namespace: "shop",
        clusterName: "prod",
        serviceNames: ["pg"],
        ports: [5432, 6432, 6432, 0, 70000],
        includeUnqualified: false,
      }),
    ).toEqual([
      "pg.shop.svc.cluster.local:5432@prod",
      "pg.shop.svc.cluster.local:6432@prod",
    ]);
  });

  test("per-member headless DNS for StatefulSet / operator members", () => {
    expect(
      buildKubernetesDatabaseAliases({
        system: "mongodb",
        namespace: "data",
        clusterName: "prod",
        serviceNames: ["mongo"],
        podServiceNames: [
          { podName: "mongo-0", serviceName: "mongo-headless" },
          { podName: "mongo-1", serviceName: "mongo-headless" },
        ],
        ports: [27017],
        includeUnqualified: false,
      }),
    ).toEqual([
      "mongo.data.svc.cluster.local:27017@prod",
      "mongo-0.mongo-headless.data.svc.cluster.local:27017@prod",
      "mongo-1.mongo-headless.data.svc.cluster.local:27017@prod",
    ]);
  });

  test("never emits two-label svc.ns forms", () => {
    const aliases: Array<string> = buildKubernetesDatabaseAliases({
      system: "postgresql",
      namespace: "shop",
      clusterName: "prod",
      serviceNames: ["pg"],
      ports: [],
      includeUnqualified: true,
    });
    for (const alias of aliases) {
      expect(alias.startsWith("pg.shop:")).toBe(false);
      expect(alias).toContain(".svc.cluster.local");
    }
  });

  test("invalid names are skipped; duplicates collapse", () => {
    expect(
      buildKubernetesDatabaseAliases({
        system: "postgresql",
        namespace: "shop",
        clusterName: "prod",
        serviceNames: ["PG", "pg", "bad name", "", "-pg"],
        podServiceNames: [{ podName: "pg-0", serviceName: "" }],
        ports: [],
        includeUnqualified: false,
      }),
    ).toEqual(["pg.shop.svc.cluster.local:5432@prod"]);
  });

  test("an invalid namespace produces nothing", () => {
    expect(
      buildKubernetesDatabaseAliases({
        system: "postgresql",
        namespace: "Not A Namespace",
        clusterName: "prod",
        serviceNames: ["pg"],
        ports: [],
        includeUnqualified: true,
      }),
    ).toEqual([]);
  });

  test("a blank cluster can only produce the unqualified form", () => {
    expect(
      buildKubernetesDatabaseAliases({
        system: "postgresql",
        namespace: "shop",
        clusterName: " ",
        serviceNames: ["pg"],
        ports: [],
        includeUnqualified: false,
      }),
    ).toEqual(["pg.shop.svc.cluster.local:5432"]);
  });

  test("an engine without a default port and no declared port → port-less", () => {
    expect(
      buildKubernetesDatabaseAliases({
        system: "acmedb",
        namespace: "shop",
        clusterName: "prod",
        serviceNames: ["acme"],
        ports: [],
        includeUnqualified: false,
      }),
    ).toEqual(["acme.shop.svc.cluster.local@prod"]);
  });

  test("every alias parses back to itself", () => {
    const aliases: Array<string> = buildKubernetesDatabaseAliases({
      system: "postgresql",
      namespace: "shop",
      clusterName: "arn:aws:eks:us-east-1:1:cluster/prod",
      serviceNames: ["pg-rw"],
      podServiceNames: [{ podName: "pg-1", serviceName: "pg" }],
      ports: [6432],
      includeUnqualified: true,
    });
    expect(aliases.length).toBe(8);
    for (const alias of aliases) {
      const parsed: DatabaseEndpoint | null = parseDatabaseEndpointString(
        alias,
        { system: "postgresql" },
      );
      expect(parsed).not.toBeNull();
      expect(formatDatabaseEndpoint(parsed!)).toBe(alias);
    }
  });

  test("the alias a k8s caller's span canonicalizes to is in the set", () => {
    const aliases: Array<string> = buildKubernetesDatabaseAliases({
      system: "postgresql",
      namespace: "shop",
      clusterName: "prod-eu",
      serviceNames: ["pg"],
      ports: [],
      includeUnqualified: false,
    });
    const fromSpan: DatabaseEndpoint | null = canonical("pg", {
      caller: K8S_CALLER,
    });
    expect(aliases).toContain(formatDatabaseEndpoint(fromSpan!));
  });
});

describe("parse → canonicalize consistency", () => {
  test("the parsed host of every accepted shape is itself parseable", () => {
    for (const raw of [
      "db.prod:5432",
      "[fd00::5]:5432",
      "tcp:sql.prod,1433",
      "postgres://u:p@db.prod/x",
      "::ffff:10.0.0.5",
    ]) {
      const parsed: ParsedHostAndPort | null = parseHostAndPort(raw);
      expect(parsed).not.toBeNull();
      expect(parseHostAndPort(parsed!.host)?.host).toBe(parsed!.host);
    }
  });
});

describe("hostile input stays linear", () => {
  /*
   * Hosts come straight from telemetry. Each of these inputs made the old
   * trailing-dot regexes (/\.+$/) backtrack quadratically; the parsers must
   * answer in well under a second.
   */
  test("long runs of dots that do not end the host", () => {
    const dots: string = ".".repeat(200_000);
    const started: number = performance.now();

    expect(parseHostAndPort("a" + dots + "b")).toBeNull();
    expect(isLoopbackDatabaseHost("a" + dots + "b")).toBe(false);
    expect(isHostRelativeDatabaseHost("a" + dots + "b")).toBe(false);
    expect(parseHostAndPort("db" + dots + ":5432")).toEqual({
      host: "db",
      port: 5432,
    });

    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("trailing dots are still dropped", () => {
    expect(parseHostAndPort("db.prod.:5432")).toEqual({
      host: "db.prod",
      port: 5432,
    });
    expect(isLoopbackDatabaseHost("localhost.")).toBe(true);
    expect(isHostRelativeDatabaseHost("host.docker.internal.")).toBe(true);
  });
});

/*
 * ---- Audit regressions (lane B1: endpoint identity) -------------------------
 *
 * Each block below first reproduces a failure the audit found, then pins the
 * rule that fixes it.
 */

const PG_SYSTEM: string = "postgresql";
const MSSQL: string = "microsoft.sql_server";
const PROJECT: string = "8a4c5b1e-2b3f-4c1d-9e8f-1a2b3c4d5e6f";

function key(endpoint: DatabaseEndpoint | null): string | null {
  return endpoint ? keyForDatabaseEndpoint(PROJECT, endpoint) : null;
}

function pod(
  namespace: string | null,
  cluster: string | null,
): DatabaseCallerContext {
  return {
    kubernetesNamespace: namespace,
    kubernetesClusterName: cluster,
    hostName: "api-7d9f-abcde",
    isEphemeral: true,
  };
}

describe("two-label <service>.<namespace> names from Kubernetes callers", () => {
  test("the finding's probe: staging and production pods calling postgres.data no longer share one global key", () => {
    const staging: DatabaseEndpoint | null = canonical("postgres.data", {
      caller: pod("shop", "staging"),
    });
    const production: DatabaseEndpoint | null = canonical("postgres.data", {
      caller: pod("shop", "production"),
    });

    expect(staging).toEqual({
      host: "postgres.data.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "staging",
    });
    expect(production).toEqual({
      host: "postgres.data.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "production",
    });
    expect(key(staging)).not.toBe(key(production));
  });

  test("the span key is exactly the Kubernetes workload's Service alias, so the rows merge", () => {
    const aliases: Array<string> = buildKubernetesDatabaseAliases({
      system: PG_SYSTEM,
      namespace: "data",
      clusterName: "prod",
      serviceNames: ["postgres"],
      ports: [],
      includeUnqualified: true,
    });

    // A pod that reports its cluster: the qualified alias.
    expect(aliases).toContain(
      formatDatabaseEndpoint(
        canonical("postgres.data", { caller: pod("shop", "prod") })!,
      ),
    );
    // A pod that reports no cluster (single-cluster project): the twin.
    expect(aliases).toContain(
      formatDatabaseEndpoint(
        canonical("postgres.data", { caller: pod("shop", null) })!,
      ),
    );
    // And the alias parses back to the very key the span was stamped with.
    const alias: DatabaseEndpoint | null = parseDatabaseEndpointString(
      "postgres.data.svc.cluster.local:5432@prod",
      { system: PG_SYSTEM },
    );
    expect(key(alias)).toBe(
      key(canonical("postgres.data", { caller: pod("billing", "prod") })),
    );
  });

  test("without a cluster the name is cluster-local and LOCAL scope (never auto-created, never global)", () => {
    const endpoint: DatabaseEndpoint | null = canonical("postgres.data", {
      caller: pod("shop", null),
    });
    expect(endpoint).toEqual({
      host: "postgres.data.svc.cluster.local",
      port: 5432,
    });
    expect(getDatabaseEndpointScope(endpoint!)).toBe("local");
  });

  test("a caller with only a cluster (no namespace) is in Kubernetes too", () => {
    expect(canonical("postgres.data", { caller: pod(null, "prod") })).toEqual({
      host: "postgres.data.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod",
    });
  });

  test("the discovery query's flag alone is enough (reduced cron context)", () => {
    expect(
      canonical("postgres.data", {
        caller: { isEphemeral: true, runsInKubernetes: true },
      }),
    ).toEqual({ host: "postgres.data.svc.cluster.local", port: 5432 });
    expect(
      canonical("postgres.data", {
        caller: { isEphemeral: true, runsInKubernetes: false },
      }),
    ).toEqual({ host: "postgres.data", port: 5432 });
  });

  test("blank namespace / cluster values do not make a caller Kubernetes", () => {
    for (const caller of [
      pod("   ", "  "),
      pod("", ""),
      { isEphemeral: false, hostName: "vm-1" },
    ]) {
      expect(isKubernetesDatabaseCaller(caller)).toBe(false);
      expect(canonical("postgres.data", { caller })).toEqual({
        host: "postgres.data",
        port: 5432,
      });
    }
    expect(isKubernetesDatabaseCaller(null)).toBe(false);
    expect(isKubernetesDatabaseCaller(pod("shop", null))).toBe(true);
    expect(isKubernetesDatabaseCaller(pod(null, "prod"))).toBe(true);
  });

  test("case, trailing dots and ports are canonicalized first", () => {
    expect(
      canonical("Postgres.Data.:6543", { caller: pod("shop", "Prod") }),
    ).toEqual({
      host: "postgres.data.svc.cluster.local",
      port: 6543,
      kubernetesClusterName: "prod",
    });
  });

  test("the collector purpose reads the name the same way (a receiver in a pod)", () => {
    expect(
      canonical("postgres.data:5432", {
        caller: pod("monitoring", "prod"),
        purpose: "collector",
      }),
    ).toEqual({
      host: "postgres.data.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod",
    });
  });

  test("a StatefulSet member of the caller's own namespace keeps its namespace", () => {
    // `mongo-0.mongo-headless` from namespace data is that pod, not a Service.
    const member: DatabaseEndpoint | null = canonical(
      "mongo-0.mongo-headless:27017",
      { system: "mongodb", caller: pod("data", "prod") },
    );
    expect(member).toEqual({
      host: "mongo-0.mongo-headless.data.svc.cluster.local",
      port: 27017,
      kubernetesClusterName: "prod",
    });
    // …which is the member alias the Kubernetes worker claims.
    expect(
      buildKubernetesDatabaseAliases({
        system: "mongodb",
        namespace: "data",
        clusterName: "prod",
        serviceNames: ["mongo"],
        podServiceNames: [
          { podName: "mongo-0", serviceName: "mongo-headless" },
        ],
        ports: [27017],
        includeUnqualified: false,
      }),
    ).toContain(formatDatabaseEndpoint(member!));

    // Bitnami-style names share only the release word.
    expect(
      canonical("redis-node-2.redis-headless", {
        system: "redis",
        caller: pod("cache", "prod"),
      })?.host,
    ).toBe("redis-node-2.redis-headless.cache.svc.cluster.local");
  });

  test("a StatefulSet-looking name with no namespace known falls back to the Service reading", () => {
    expect(
      canonical("mongo-0.mongo-headless", {
        system: "mongodb",
        caller: pod(null, "prod"),
      })?.host,
    ).toBe("mongo-0.mongo-headless.svc.cluster.local");
  });

  test("a Service whose name ends in a number is still a Service in another namespace", () => {
    expect(
      canonical("postgres-2.data", { caller: pod("shop", "prod") })?.host,
    ).toBe("postgres-2.data.svc.cluster.local");
  });

  test("private-zone second labels are not namespaces, but stay network-scoped", () => {
    for (const address of ["db.internal", "db.local", "db.localdomain"]) {
      const endpoint: DatabaseEndpoint | null = canonical(address, {
        caller: pod("shop", "prod"),
      });
      expect(endpoint?.host).toBe(address);
    }
    expect(
      canonical("db.internal", { caller: pod("shop", "prod") })
        ?.kubernetesClusterName,
    ).toBe("prod");
  });

  test("labels Kubernetes would reject are never expanded", () => {
    expect(canonical("my_db.corp", { caller: pod("shop", "prod") })).toEqual({
      host: "my_db.corp",
      port: 5432,
    });
  });

  test("three-label public names from pods are never touched", () => {
    expect(
      canonical("db.example.com", { caller: pod("shop", "prod") }),
    ).toEqual({ host: "db.example.com", port: 5432 });
  });

  test("an alias typed as svc.ns on a Kubernetes row reads like its pods' spans", () => {
    expect(
      parseDatabaseEndpointString("postgres.data:5432", {
        system: PG_SYSTEM,
        kubernetesNamespace: "data",
        kubernetesClusterName: "Prod",
      }),
    ).toEqual({
      host: "postgres.data.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod",
    });
    // …but a stored / VM-seen two-label endpoint parses back to itself.
    expect(
      parseDatabaseEndpointString("postgres.data:5432", { system: PG_SYSTEM }),
    ).toEqual({ host: "postgres.data", port: 5432 });
  });
});

describe("SQL Server named instances", () => {
  test("the finding's probe: INST01 and INST02 on one host are two endpoints with two keys", () => {
    const first: DatabaseEndpoint | null = canonical(
      "sql1.corp.example.com\\INST01",
      { system: MSSQL, caller: VM_CALLER },
    );
    const second: DatabaseEndpoint | null = canonical(
      "sql1.corp.example.com\\INST02",
      { system: MSSQL, caller: VM_CALLER },
    );
    expect(first).toEqual({
      host: "sql1.corp.example.com\\inst01",
      port: null,
    });
    expect(second).toEqual({
      host: "sql1.corp.example.com\\inst02",
      port: null,
    });
    expect(key(first)).not.toBe(key(second));
    // Neither takes the default instance's 1433.
    expect(key(first)).not.toBe(
      key(canonical("sql1.corp.example.com", { system: MSSQL })),
    );
  });

  test("an instance reported beside the address (db.namespace / db.mssql.instance_name) splits the same way", () => {
    const first: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
      system: MSSQL,
      address: "sql1.corp.example.com",
      instance: "INST01",
      caller: VM_CALLER,
      purpose: "client-call",
    });
    const second: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
      system: MSSQL,
      address: "sql1.corp.example.com",
      instance: "INST02",
      caller: VM_CALLER,
      purpose: "client-call",
    });
    expect(formatDatabaseEndpoint(first!)).toBe(
      "sql1.corp.example.com\\inst01",
    );
    expect(key(first)).not.toBe(key(second));
    // Written in the address or beside it, it is one endpoint.
    expect(first).toEqual(
      canonical("sql1.corp.example.com\\inst01", { system: MSSQL }),
    );
  });

  test("the default instance is the plain host on 1433", () => {
    for (const instance of ["MSSQLSERVER", "mssqlserver", "", "  ", null]) {
      expect(
        canonicalizeDatabaseEndpoint({
          system: MSSQL,
          address: "sql1.corp.example.com",
          instance: instance,
          caller: VM_CALLER,
          purpose: "client-call",
        }),
      ).toEqual({ host: "sql1.corp.example.com", port: 1433 });
    }
    expect(
      canonical("sql1.corp.example.com\\MSSQLSERVER", { system: MSSQL }),
    ).toEqual({ host: "sql1.corp.example.com", port: 1433 });
  });

  test("a known port already names the instance, so the instance is dropped", () => {
    const expected: DatabaseEndpoint = {
      host: "sql1.corp.example.com",
      port: 1434,
    };
    expect(
      canonical("sql1.corp.example.com\\INST01,1434", { system: MSSQL }),
    ).toEqual(expected);
    expect(
      canonical("sql1.corp.example.com\\INST01:1434", { system: MSSQL }),
    ).toEqual(expected);
    expect(
      canonical("sql1.corp.example.com\\INST01", {
        system: MSSQL,
        port: 1434,
      }),
    ).toEqual(expected);
    expect(
      canonicalizeDatabaseEndpoint({
        system: MSSQL,
        address: "sql1.corp.example.com",
        port: "1434",
        instance: "INST01",
        caller: VM_CALLER,
        purpose: "client-call",
      }),
    ).toEqual(expected);
    // host,port forms on one host stay apart by port.
    expect(
      key(canonical("sql1.corp.example.com,1434", { system: MSSQL })),
    ).not.toBe(key(canonical("sql1.corp.example.com,1435", { system: MSSQL })));
  });

  test("the address's instance wins over a reported one; an invalid reported one is ignored", () => {
    expect(
      canonicalizeDatabaseEndpoint({
        system: MSSQL,
        address: "sql1.corp\\INST01",
        instance: "INST02",
        caller: VM_CALLER,
        purpose: "client-call",
      })?.host,
    ).toBe("sql1.corp\\inst01");
    expect(
      canonicalizeDatabaseEndpoint({
        system: MSSQL,
        address: "sql1.corp",
        instance: "not an instance!",
        caller: VM_CALLER,
        purpose: "client-call",
      }),
    ).toEqual({ host: "sql1.corp", port: 1433 });
  });

  test("an instance on a private IP from a pod is qualified, and stays an IP", () => {
    const endpoint: DatabaseEndpoint | null = canonical("10.0.0.5\\INST01", {
      system: MSSQL,
      caller: K8S_CALLER,
    });
    expect(endpoint).toEqual({
      host: "10.0.0.5\\inst01",
      port: null,
      kubernetesClusterName: "prod-eu",
    });
    expect(isIpLiteralHost(endpoint!.host)).toBe(true);
    expect(isPrivateIpHost(endpoint!.host)).toBe(true);
    expect(getDatabaseEndpointScope(endpoint!)).toBe("global");
    expect(
      getDatabaseEndpointScope({ host: "10.0.0.5\\inst01", port: null }),
    ).toBe("local");
  });

  test("scope ignores the instance: a single-label host is still local", () => {
    expect(getDatabaseEndpointScope({ host: "sql1\\inst01", port: null })).toBe(
      "local",
    );
    expect(
      getDatabaseEndpointScope({
        host: "sql1.corp.example.com\\inst01",
        port: null,
      }),
    ).toBe("global");
    expect(
      getDatabaseEndpointScope({ host: "localhost\\sqlexpress", port: null }),
    ).toBe("local");
  });

  test("format → parse round-trips, whatever system the reader assumes", () => {
    const endpoints: Array<DatabaseEndpoint> = [
      { host: "sql1.corp.example.com\\inst01", port: null },
      { host: "fd00::5\\inst01", port: null, kubernetesClusterName: "prod" },
      { host: "10.0.0.5\\inst$1", port: null, kubernetesClusterName: "prod" },
    ];
    expect(formatDatabaseEndpoint(endpoints[1]!)).toBe(
      "[fd00::5]\\inst01@prod",
    );
    for (const endpoint of endpoints) {
      for (const system of [MSSQL, "", PG_SYSTEM]) {
        expect(
          parseDatabaseEndpointString(formatDatabaseEndpoint(endpoint), {
            system,
          }),
        ).toEqual(endpoint);
      }
    }
  });

  test("identifiers and display names carry the instance", () => {
    const endpoint: DatabaseEndpoint = {
      host: "sql1.corp.example.com\\inst01",
      port: null,
    };
    expect(buildDatabaseServerIdentifier(MSSQL, endpoint)).toBe(
      "microsoft.sql_server|sql1.corp.example.com\\inst01",
    );
    expect(buildDatabaseServerDisplayName({ system: MSSQL, endpoint })).toBe(
      "SQL Server sql1.corp.example.com\\inst01",
    );
    expect(splitDatabaseHostInstance(endpoint.host)).toEqual({
      host: "sql1.corp.example.com",
      instance: "inst01",
    });
    expect(splitDatabaseHostInstance("db.prod")).toEqual({
      host: "db.prod",
      instance: "",
    });
  });

  test("loopback with an instance is still loopback", () => {
    expect(
      canonical("localhost\\SQLEXPRESS", { system: MSSQL, caller: VM_CALLER }),
    ).toBeNull();
    expect(
      canonical(".\\SQLEXPRESS", {
        system: MSSQL,
        caller: VM_CALLER,
        purpose: "collector",
      }),
    ).toEqual({ host: "app-7.corp.example\\sqlexpress", port: null });
  });
});

describe("readDatabaseInstanceName", () => {
  function read(
    system: unknown,
    attributes: Record<string, unknown>,
  ): string | null {
    return readDatabaseInstanceName({
      system,
      getAttribute: (name: string): unknown => {
        return attributes[name];
      },
    });
  }

  test("reads the legacy attribute first, then the instance half of db.namespace", () => {
    expect(DATABASE_INSTANCE_ATTRIBUTES).toEqual([
      "db.mssql.instance_name",
      "db.namespace",
    ]);
    expect(
      read("mssql", {
        "db.mssql.instance_name": "INST01",
        "db.namespace": "INST02|orders",
      }),
    ).toBe("INST01");
    expect(read(MSSQL, { "db.namespace": "INST02|orders" })).toBe("INST02");
    expect(read(MSSQL, { "db.namespace": "a|b|c" })).toBe("a");
    expect(read(MSSQL, { "db.mssql.instance_name": 7 })).toBe("7");
  });

  test("an empty legacy attribute falls through; a plain database name is no instance", () => {
    expect(
      read(MSSQL, {
        "db.mssql.instance_name": "",
        "db.namespace": "INST02|orders",
      }),
    ).toBe("INST02");
    expect(read(MSSQL, { "db.namespace": "orders" })).toBeNull();
    expect(read(MSSQL, {})).toBeNull();
  });

  test("only SQL Server reads an instance (other engines' db.namespace means something else)", () => {
    for (const system of ["postgresql", "redis", "", null]) {
      expect(
        read(system, {
          "db.mssql.instance_name": "INST01",
          "db.namespace": "a|b",
        }),
      ).toBeNull();
    }
  });

  test("tolerates junk", () => {
    expect(
      readDatabaseInstanceName(
        null as unknown as {
          system: unknown;
          getAttribute: (key: string) => unknown;
        },
      ),
    ).toBeNull();
    expect(read(MSSQL, { "db.mssql.instance_name": { x: 1 } })).toBeNull();
  });
});

describe("per-network names are never global identities", () => {
  test("the finding's probes: dev-tool gateway names are host-relative", () => {
    for (const host of [
      "host.minikube.internal",
      "host.k3d.internal",
      "host.lima.internal",
      "host.orb.internal",
      "host.rancher-desktop.internal",
      "HOST.MINIKUBE.INTERNAL.",
      "vm.docker.internal",
      "host.docker.internal",
    ]) {
      expect(isHostRelativeDatabaseHost(host)).toBe(true);
      expect(canonical(host, { caller: VM_CALLER })).toBeNull();
      expect(canonical(host, { caller: K8S_CALLER })).toBeNull();
      // A collector on a stable machine: that machine.
      expect(
        canonical(host, { caller: VM_CALLER, purpose: "collector" })?.host,
      ).toBe("app-7.corp.example");
    }
    for (const host of [
      "db.internal",
      "host.internal",
      "a.host.minikube.internal",
      "host.bad_label.internal",
      "db.docker.internals",
    ]) {
      expect(isHostRelativeDatabaseHost(host)).toBe(false);
    }
  });

  test("isLinkLocalIpHost: 169.254/16 and fe80::/10 only", () => {
    for (const host of [
      "169.254.1.10",
      "169.254.0.1",
      "fe80::1",
      "fe80::1%eth0",
      "[fe80::1]",
      "febf::1",
      "::ffff:169.254.1.1",
    ]) {
      expect(isLinkLocalIpHost(host)).toBe(true);
    }
    for (const host of [
      "169.253.1.1",
      "170.254.1.1",
      "fec0::1",
      "fe7f::1",
      "10.0.0.1",
      "db.prod",
      "",
    ]) {
      expect(isLinkLocalIpHost(host)).toBe(false);
    }
  });

  test("the finding's probes: link-local addresses are LOCAL, qualified or not", () => {
    const fromPod: DatabaseEndpoint | null = canonical("169.254.1.10", {
      caller: K8S_CALLER,
    });
    expect(fromPod).toEqual({
      host: "169.254.1.10",
      port: 5432,
      kubernetesClusterName: "prod-eu",
    });
    expect(getDatabaseEndpointScope(fromPod!)).toBe("local");

    const zoned: DatabaseEndpoint | null = canonical("fe80::1%eth0", {
      caller: VM_CALLER,
    });
    expect(zoned).toEqual({ host: "fe80::1", port: 5432 });
    expect(getDatabaseEndpointScope(zoned!)).toBe("local");
  });

  test("private DNS zones (.internal, .local, .home.arpa) are network-scoped", () => {
    expect(NETWORK_SCOPED_NAME_SUFFIXES).toEqual([
      ".local",
      ".internal",
      ".home.arpa",
      ".localdomain",
    ]);
    for (const host of [
      "ip-10-0-0-5.ec2.internal",
      "db-1.c.my-project.internal",
      "db.corp.local",
      "nas.home.arpa",
      "build-7.localdomain",
      "pg.shop.svc.cluster.local",
    ]) {
      expect(isClusterScopedDatabaseHost(host)).toBe(true);

      // From a machine outside any cluster: kept, but LOCAL.
      const fromVm: DatabaseEndpoint | null = canonical(host, {
        caller: VM_CALLER,
      });
      expect(fromVm?.kubernetesClusterName).toBeUndefined();
      expect(getDatabaseEndpointScope(fromVm!)).toBe("local");

      // From a pod: qualified with its cluster, which makes it global.
      const fromPod: DatabaseEndpoint | null = canonical(host, {
        caller: K8S_CALLER,
      });
      expect(fromPod?.kubernetesClusterName).toBe("prod-eu");
      expect(getDatabaseEndpointScope(fromPod!)).toBe("global");
    }
    for (const host of [
      "db.example.com",
      "orders.cjd8.eu-west-1.rds.amazonaws.com",
      "api.localhost",
      "db.internalapi.com",
      "8.8.8.8",
      "",
    ]) {
      expect(isClusterScopedDatabaseHost(host)).toBe(false);
    }
  });

  test("two clusters' copies of one EC2 private name are two endpoints", () => {
    expect(
      key(canonical("ip-10-0-0-5.ec2.internal", { caller: pod("a", "east") })),
    ).not.toBe(
      key(canonical("ip-10-0-0-5.ec2.internal", { caller: pod("a", "west") })),
    );
  });

  test("isPrivateIpHost is unchanged: link-local is its own class", () => {
    expect(isPrivateIpHost("169.254.1.1")).toBe(false);
    expect(isPrivateIpHost("fe80::1")).toBe(false);
  });
});

describe("the @cluster qualifier on typed endpoints", () => {
  const PG: { system: string } = { system: PG_SYSTEM };

  test("names the cluster of every cluster-scoped kind of address", () => {
    expect(
      parseDatabaseEndpointString("pg.shop.svc.cluster.local:5432@Prod-EU", PG),
    ).toEqual({
      host: "pg.shop.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod-eu",
    });
    // A <service>.<namespace> short name is read as the pod would read it.
    expect(parseDatabaseEndpointString("postgres.data@staging", PG)).toEqual({
      host: "postgres.data.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "staging",
    });
    expect(parseDatabaseEndpointString("db.internal:5432@prod", PG)).toEqual({
      host: "db.internal",
      port: 5432,
      kubernetesClusterName: "prod",
    });
    expect(
      parseDatabaseEndpointString("169.254.1.1@prod", PG)
        ?.kubernetesClusterName,
    ).toBe("prod");
  });

  test("a single-label name takes a qualifier only with a namespace to expand it", () => {
    expect(parseDatabaseEndpointString("pg@prod", PG)).toBeNull();
    expect(
      parseDatabaseEndpointString("pg@prod", {
        ...PG,
        kubernetesNamespace: "shop",
      }),
    ).toEqual({
      host: "pg.shop.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod",
    });
  });

  test("stored values stay readable: everything canonicalize can produce round-trips", () => {
    const produced: Array<DatabaseEndpoint | null> = [
      canonical("postgres.data", { caller: pod("shop", "staging") }),
      canonical("postgres.data", { caller: pod("shop", null) }),
      canonical("mongo-0.mongo-hl", {
        system: "mongodb",
        caller: pod("data", "prod"),
      }),
      canonical("169.254.1.10", { caller: K8S_CALLER }),
      canonical("db.internal", { caller: K8S_CALLER }),
      canonical("db.internal", { caller: VM_CALLER }),
      canonical("10.0.0.5\\INST01", { system: MSSQL, caller: K8S_CALLER }),
      canonical("pg.shop", { caller: VM_CALLER }),
    ];
    for (const endpoint of produced) {
      expect(endpoint).not.toBeNull();
      const system: string = endpoint!.host.includes("\\")
        ? MSSQL
        : endpoint!.port === 27017
          ? "mongodb"
          : PG_SYSTEM;
      expect(
        parseDatabaseEndpointString(formatDatabaseEndpoint(endpoint!), {
          system,
        }),
      ).toEqual(endpoint);
    }
  });
});

describe("parseManualDatabaseEndpoint", () => {
  function manual(
    value: unknown,
    context: Partial<{
      system: string;
      port: unknown;
      kubernetesClusterName: string | null;
      kubernetesNamespace: string | null;
      knownClusterNames: Array<string> | null;
    }> = {},
  ): ManualDatabaseEndpoint {
    return parseManualDatabaseEndpoint(value, {
      system: PG_SYSTEM,
      ...context,
    });
  }

  test("accepts what parseDatabaseEndpointString accepts, canonicalized the same way", () => {
    for (const value of [
      "Orders-DB.example.com",
      "orders-db.example.com:6543",
      "10.0.0.5@prod",
      "postgres.data@staging",
      "pg.shop.svc.cluster.local:5432@prod",
      "[fd00::5]:5432",
      "postgres://app@db.example.com:5432/orders",
    ]) {
      const result: ManualDatabaseEndpoint = manual(value);
      expect(result.error).toBeNull();
      expect(result.endpoint).toEqual(
        parseDatabaseEndpointString(value, { system: PG_SYSTEM }),
      );
    }
  });

  test("user@host is refused with a message that says to drop the user", () => {
    const result: ManualDatabaseEndpoint = manual("admin@10.0.0.5:5432");
    expect(result.endpoint).toBeNull();
    expect(result.error).toContain("looks like user@host");
    expect(result.error).toContain('Remove "admin@"');
    expect(manual("user@db.example.com").error).toContain(
      "looks like user@host",
    );
    expect(manual("john.doe@db.example.com").error).toContain(
      'Remove "john.doe@"',
    );
    // "@" with nothing before it is simply not an endpoint.
    expect(manual("@db.example.com").error).toContain(
      "is not a valid host[:port] endpoint",
    );
  });

  test("a qualifier on a public name is refused, naming the qualifier to remove", () => {
    const result: ManualDatabaseEndpoint = manual("db.example.com:5432@prod");
    expect(result.endpoint).toBeNull();
    expect(result.error).toContain('Remove "@prod"');
    expect(result.error).toContain("db.example.com");
  });

  test("a qualifier on a bare single-label name asks for the namespace", () => {
    const result: ManualDatabaseEndpoint = manual("pg@prod");
    expect(result.endpoint).toBeNull();
    expect(result.error).toContain("pg.<namespace>@prod");
  });

  test("loopback, garbage and empty values are refused with their own messages", () => {
    expect(manual("localhost:5432").error).toContain("loopback");
    expect(manual("host.minikube.internal").error).toContain("loopback");
    expect(manual("[REDACTED]").error).toContain(
      "is not a valid host[:port] endpoint",
    );
    expect(manual("   ").error).toContain("Server address is required");
    expect(manual(null).error).toContain("Server address is required");
  });

  test("an out-of-range port in the address is an error, not silently the default", () => {
    // parseDatabaseEndpointString would quietly fill in 5432.
    expect(
      parseDatabaseEndpointString("db.example.com:70000", {
        system: PG_SYSTEM,
      }),
    ).toEqual({ host: "db.example.com", port: 5432 });
    const result: ManualDatabaseEndpoint = manual("db.example.com:70000");
    expect(result.endpoint).toBeNull();
    expect(result.error).toContain("outside 1-65535");
  });

  test("the port field replaces the address's port, and must be valid", () => {
    expect(manual("db.example.com:70000", { port: 6543 }).endpoint).toEqual({
      host: "db.example.com",
      port: 6543,
    });
    expect(manual("db.example.com:5432", { port: "6543" }).endpoint).toEqual({
      host: "db.example.com",
      port: 6543,
    });
    expect(manual("db.example.com", { port: "" }).endpoint).toEqual({
      host: "db.example.com",
      port: 5432,
    });
    for (const port of [0, 70000, "abc", 5432.5]) {
      expect(manual("db.example.com", { port }).error).toBe(
        "Server port must be a whole number between 1 and 65535.",
      );
    }
    // A port names a SQL Server instance: the instance is dropped.
    expect(
      manual("sql1.corp\\INST01", { system: MSSQL, port: 1434 }).endpoint,
    ).toEqual({ host: "sql1.corp", port: 1434 });
    expect(manual("sql1.corp\\INST01", { system: MSSQL }).endpoint).toEqual({
      host: "sql1.corp\\inst01",
      port: null,
    });
  });

  test("an unqualified cluster-scoped endpoint is accepted with a hint naming the qualified form", () => {
    const result: ManualDatabaseEndpoint = manual(
      "postgres.data.svc.cluster.local",
      { knownClusterNames: ["Staging", "prod", "", "staging"] },
    );
    expect(result.endpoint).toEqual({
      host: "postgres.data.svc.cluster.local",
      port: 5432,
    });
    expect(result.error).toBeNull();
    expect(result.clusterQualifierHint).toContain(
      "postgres.data.svc.cluster.local:5432@staging",
    );
    expect(result.clusterQualifierHint).toContain(
      "this project's clusters: staging, prod",
    );
    expect(manual("10.0.0.5").clusterQualifierHint).toContain(
      "10.0.0.5:5432@<cluster name>",
    );
  });

  test("no hint for a global or already-qualified endpoint", () => {
    expect(manual("db.example.com").clusterQualifierHint).toBeNull();
    expect(manual("10.0.0.5@prod").clusterQualifierHint).toBeNull();
    // The row's own cluster qualifies it, too.
    expect(
      manual("10.0.0.5", { kubernetesClusterName: "prod" }).endpoint,
    ).toEqual({ host: "10.0.0.5", port: 5432, kubernetesClusterName: "prod" });
  });

  test("echoes at most 100 characters of a rejected value", () => {
    const long: string = `${"a".repeat(300)}!`;
    const error: string = manual(long).error || "";
    expect(error).toContain(`${"a".repeat(100)}…`);
    expect(error).not.toContain("a".repeat(101));
  });
});

describe("host lists name one logical server", () => {
  test("the member chosen does not depend on the order a client lists them", () => {
    const orders: Array<string> = [
      "m1.prod:27017,m2.prod:27017,m3.prod:27017",
      "m3.prod:27017,m1.prod:27017,m2.prod:27017",
      "m2.prod:27017,m3.prod:27017,m1.prod:27017",
      "mongodb://app:pw@m3.prod:27017,m2.prod:27017,m1.prod:27017/orders?replicaSet=rs0",
    ];
    for (const raw of orders) {
      expect(parseHostAndPort(raw)).toEqual({ host: "m1.prod", port: 27017 });
      expect(
        key(canonical(raw, { system: "mongodb", caller: VM_CALLER })),
      ).toBe(key(canonical("m1.prod:27017", { system: "mongodb" })));
    }
  });

  test("parseHostAndPortList returns every member once, in canonical order", () => {
    expect(
      parseHostAndPortList("M2.prod:27017, m1.prod ,m2.prod:27017,"),
    ).toEqual([
      { host: "m1.prod", port: null },
      { host: "m2.prod", port: 27017 },
    ]);
    expect(parseHostAndPortList("db.prod:5432")).toEqual([
      { host: "db.prod", port: 5432 },
    ]);
    expect(parseHostAndPortList("sql.prod,1433")).toEqual([
      { host: "sql.prod", port: 1433 },
    ]);
  });

  test("a list is only read when every member is readable", () => {
    expect(parseHostAndPort("m1.prod:27017,[REDACTED]")).toBeNull();
    expect(parseHostAndPortList("m1.prod,***.***.***.***")).toBeNull();
    expect(parseHostAndPortList(",,,")).toBeNull();
    expect(parseHostAndPortList(null)).toBeNull();
  });
});

describe("getDatabaseClusterHost (managed cluster members)", () => {
  test("MongoDB Atlas members map to their cluster's name", () => {
    expect(getDatabaseClusterHost("c0-shard-00-00.abcd.mongodb.net")).toBe(
      "c0.abcd.mongodb.net",
    );
    expect(getDatabaseClusterHost("C0-Shard-00-02.ABCD.mongodb.net")).toBe(
      "c0.abcd.mongodb.net",
    );
    expect(
      getDatabaseClusterHost("ac-x1y2z3-shard-01-02.ab1cd.mongodb.net"),
    ).toBe("ac-x1y2z3.ab1cd.mongodb.net");
    expect(
      getDatabaseClusterHost("my-shard-cluster-shard-00-01.q.mongodb.net"),
    ).toBe("my-shard-cluster.q.mongodb.net");
  });

  test("anything else is not a member", () => {
    for (const host of [
      "c0.abcd.mongodb.net",
      "c0-shard-0-1.abcd.mongodb.net",
      "c0-shard-00-00.abcd.mongodb.com",
      "a.c0-shard-00-00.abcd.mongodb.net",
      "-shard-00-00.abcd.mongodb.net",
      "c0-shard-00-00-pl-0.abcd.mongodb.net",
      "c0-shard-00-00.ab_cd.mongodb.net",
      "db.example.com",
      "",
    ]) {
      expect(getDatabaseClusterHost(host)).toBeNull();
    }
    expect(getDatabaseClusterHost(null as unknown as string)).toBeNull();
  });
});

describe("the new parsing paths stay linear on hostile input", () => {
  test("huge host lists, long labels and repeated markers answer quickly", () => {
    const started: number = performance.now();

    expect(parseHostAndPort(`${"a,".repeat(100_000)}b`)?.host).toBe("a");
    expect(
      getDatabaseClusterHost(
        `${"x-shard-".repeat(20_000)}00-00.abcd.mongodb.net`,
      ),
    ).toBeNull();
    expect(
      isHostRelativeDatabaseHost(`host.${"a".repeat(200_000)}.internal`),
    ).toBe(false);
    expect(
      parseDatabaseEndpointString(
        `${"a".repeat(100_000)}@${"b.".repeat(50_000)}c`,
        {
          system: PG_SYSTEM,
        },
      ),
    ).toBeNull();
    expect(
      canonical(`${"a-".repeat(50_000)}1.b`, { caller: pod("shop", "prod") }),
    ).toBeNull();

    expect(performance.now() - started).toBeLessThan(2000);
  });
});
