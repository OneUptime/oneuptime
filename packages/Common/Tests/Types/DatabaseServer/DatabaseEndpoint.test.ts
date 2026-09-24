import {
  buildDatabaseCallerContext,
  buildDatabaseServerDisplayName,
  buildDatabaseServerIdentifier,
  buildKubernetesDatabaseAliases,
  buildWorkloadDatabaseServerIdentifier,
  canonicalizeDatabaseEndpoint,
  DatabaseCallerContext,
  DatabaseEndpoint,
  DatabaseEndpointPurpose,
  formatDatabaseEndpoint,
  getDatabaseEndpointScope,
  isEphemeralCaller,
  isHostRelativeDatabaseHost,
  isIpLiteralHost,
  isLoopbackDatabaseHost,
  isPrivateIpHost,
  parseDatabaseEndpointString,
  parseHostAndPort,
  ParsedHostAndPort,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
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
    expect(parseHostAndPort("postgres://app:secret@db.prod:5432/orders")).toEqual(
      { host: "db.prod", port: 5432 },
    );
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

  test("a host list keeps the first host", () => {
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
    expect(parseHostAndPort("sql.prod\\SQLEXPRESS")).toEqual({
      host: "sql.prod",
      port: null,
    });
    expect(parseHostAndPort("sql.prod\\SQLEXPRESS,1434")).toEqual({
      host: "sql.prod",
      port: 1434,
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
    });
    expect(parseHostAndPort(".")).toEqual({ host: "localhost", port: null });
    expect(parseHostAndPort(".\\SQLEXPRESS,1433")).toEqual({
      host: "localhost",
      port: 1433,
    });
    expect(parseHostAndPort("(localdb)\\MSSQLLocalDB")).toEqual({
      host: "localhost",
      port: null,
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
    expect(isEphemeralCaller({ ...VM, "cloud.platform": platform })).toBe(
      true,
    );
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
    expect(canonical("db.prod", { system: "tidb" })).toEqual({
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

  test("two-label names are never rewritten (indistinguishable from a domain)", () => {
    expect(canonical("pg.shop", { caller: K8S_CALLER })).toEqual({
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
    expect(canonical("pg.other.svc.cluster.local", { caller: K8S_CALLER }))
      .toEqual({
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
      "pg.shop",
    ]) {
      expect(
        canonical(address, { caller: K8S_CALLER })?.kubernetesClusterName,
      ).toBeUndefined();
    }
  });

  test("the cluster is canonicalized but otherwise kept raw (ARNs)", () => {
    const arn: string =
      "arn:aws:eks:us-east-1:123456789012:cluster/Prod-EU";
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
      canonical("db.prod", { system: "tidb" }),
      canonical("pg.shop.svc.cluster.local"),
    ];
    for (const endpoint of endpoints) {
      expect(endpoint).not.toBeNull();
      expect(
        parseDatabaseEndpointString(formatDatabaseEndpoint(endpoint!), {
          system: endpoint!.port === null ? "tidb" : "postgresql",
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

  test("a qualifier on a non-cluster-scoped host is dropped", () => {
    expect(parseDatabaseEndpointString("db.prod.example.com:5432@prod", PG))
      .toEqual({ host: "db.prod.example.com", port: 5432 });
    expect(parseDatabaseEndpointString("8.8.8.8@prod", PG)).toEqual({
      host: "8.8.8.8",
      port: 5432,
    });
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

  test("a non-URL user@host is read as host@qualifier (documented limit)", () => {
    // Only URL forms carry userinfo; "admin" is taken as the host.
    expect(parseDatabaseEndpointString("admin@db:5432", PG)).toEqual({
      host: "admin",
      port: 5432,
    });
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
    } = { system: "mysql", parentName: "Build-Host-1", workloadName: "shop-db" };

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
        system: "tidb",
        endpoint: { host: "tidb.prod", port: 4000 },
      }),
    ).toBe("tidb tidb.prod:4000");
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
        system: "tidb",
        namespace: "shop",
        clusterName: "prod",
        serviceNames: ["tidb"],
        ports: [],
        includeUnqualified: false,
      }),
    ).toEqual(["tidb.shop.svc.cluster.local@prod"]);
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
