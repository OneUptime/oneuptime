"use strict";

/**
 * A datastore port is published on the loopback address only.
 *
 * Docker publishes a port that names no address ("5400:5432") on every
 * interface of the server, IPv4 and IPv6, and its own iptables rules let that
 * port past a host firewall such as ufw. A datastore's port is for tools on
 * the server itself - npm run backup, restore.sh, psql, the test suites on a
 * development machine - so every compose file in this repository publishes
 * PostgreSQL, ClickHouse, Valkey and any other datastore on 127.0.0.1, and
 * nowhere else. The production stack publishes nothing else beyond the
 * server but its ingress.
 *
 * ComposeDatabaseRuntime.test.js starts PostgreSQL from docker-compose.yml
 * for real and checks the same from the outside.
 */

const fs = require("fs");
const path = require("path");
const {
  REPO_ROOT,
  LOOPBACK_ADDRESS,
  trackedComposeFiles,
  readCompose,
  imageName,
  isDataStoreService,
  parsePublishedPort,
  dataStoreServices,
  configExampleSettings,
  hasDockerCompose,
  renderCompose,
} = require("./Utils/ComposePorts");

const PRODUCTION_COMPOSE_FILES = [
  "docker-compose.yml",
  "docker-compose.base.yml",
];
const DEV_COMPOSE_FILE = "Scripts/Dev/docker-compose.dev.yml";
const E2E_CLICKHOUSE_OVERLAY = "packages/E2E/docker-compose.e2e-clickhouse.yml";

// The ingress is the one way into a production stack, on every interface.
const INGRESS_PORTS = [
  "${ONEUPTIME_HTTP_PORT}:7849",
  "${STATUS_PAGE_HTTPS_PORT}:7850",
];

const RESTORE_ADD_HOST = /--add-host=host\.docker\.internal:(\S+)/;
const NET_HOST = /docker run --net=host\b/;

const composeFiles = trackedComposeFiles();
const dataStores = dataStoreServices(composeFiles);

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// A shell script without its full-line comments, so prose never matches.
function executableLines(relativePath) {
  return read(relativePath)
    .split("\n")
    .filter((line) => {
      return !line.trim().startsWith("#");
    })
    .join("\n");
}

function describePort(store, port) {
  return `${store.file}: ${store.service} publishes ${JSON.stringify(port.entry)}`;
}

describe("the guard sees the compose files that run OneUptime's datastores", () => {
  test("it finds the production, development and E2E compose files", () => {
    expect(composeFiles).toEqual(
      expect.arrayContaining([
        ...PRODUCTION_COMPOSE_FILES,
        DEV_COMPOSE_FILE,
        E2E_CLICKHOUSE_OVERLAY,
        "packages/E2E/docker-compose.billing.yml",
        "packages/E2E/docker-compose.e2e.yml",
      ]),
    );
  });

  test("it finds every datastore those files run, whether by name, image or extends", () => {
    const seen = dataStores.map((store) => {
      return `${store.file}#${store.service}`;
    });

    expect(seen).toEqual(
      expect.arrayContaining([
        "docker-compose.yml#postgres",
        "docker-compose.yml#clickhouse",
        "docker-compose.yml#valkey",
        "docker-compose.base.yml#postgres",
        "docker-compose.base.yml#clickhouse",
        "docker-compose.base.yml#valkey",
        `${DEV_COMPOSE_FILE}#postgres`,
        `${DEV_COMPOSE_FILE}#clickhouse`,
        `${DEV_COMPOSE_FILE}#valkey`,
        `${E2E_CLICKHOUSE_OVERLAY}#clickhouse`,
      ]),
    );
  });

  test("datastores are told apart by their name, the service they extend, or their image", () => {
    expect(isDataStoreService("postgres", {})).toBe(true);
    expect(isDataStoreService("db", { extends: { service: "valkey" } })).toBe(
      true,
    );
    expect(isDataStoreService("db", { image: "postgres:15" })).toBe(true);
    expect(
      isDataStoreService("analytics", {
        image: "clickhouse/clickhouse-server:26.7",
      }),
    ).toBe(true);
    expect(
      isDataStoreService("search", {
        image: "docker.elastic.co/elasticsearch/elasticsearch:8.15.3",
      }),
    ).toBe(true);
    expect(isDataStoreService("cache", { image: "redis@sha256:abc" })).toBe(
      true,
    );
    expect(isDataStoreService("app", { image: "oneuptime/app:release" })).toBe(
      false,
    );
    expect(
      isDataStoreService("ingress", { extends: { service: "ingress" } }),
    ).toBe(false);
    expect(imageName("ghcr.io/cloudnative-pg/postgresql:15")).toBe(
      "postgresql",
    );
    expect(imageName(undefined)).toBe("");
  });
});

describe("reading a published port", () => {
  test.each([
    ["5400:5432", { hostIp: "", hostPort: "5400", containerPort: "5432" }],
    [
      "127.0.0.1:5400:5432",
      { hostIp: "127.0.0.1", hostPort: "5400", containerPort: "5432" },
    ],
    [
      "0.0.0.0:5400:5432",
      { hostIp: "0.0.0.0", hostPort: "5400", containerPort: "5432" },
    ],
    [
      "[::]:5400:5432",
      { hostIp: "::", hostPort: "5400", containerPort: "5432" },
    ],
    [
      "[::1]:5400:5432/tcp",
      { hostIp: "::1", hostPort: "5400", containerPort: "5432" },
    ],
    [
      "127.0.0.1::5432",
      { hostIp: "127.0.0.1", hostPort: "", containerPort: "5432" },
    ],
    ["5432", { hostIp: "", hostPort: "", containerPort: "5432" }],
    [5432, { hostIp: "", hostPort: "", containerPort: "5432" }],
    [
      "24224:24224/udp",
      { hostIp: "", hostPort: "24224", containerPort: "24224" },
    ],
    [
      "${ONEUPTIME_HTTP_PORT}:7849",
      { hostIp: "", hostPort: "${ONEUPTIME_HTTP_PORT}", containerPort: "7849" },
    ],
    [
      "${DATABASE_ADDRESS:-127.0.0.1}:5400:5432",
      {
        hostIp: "${DATABASE_ADDRESS:-127.0.0.1}",
        hostPort: "5400",
        containerPort: "5432",
      },
    ],
    [
      { target: 5432, published: "5400" },
      { hostIp: "", hostPort: "5400", containerPort: "5432" },
    ],
    [
      { target: 5432, published: 5400, host_ip: "127.0.0.1" },
      { hostIp: "127.0.0.1", hostPort: "5400", containerPort: "5432" },
    ],
  ])("%j", (entry, expected) => {
    expect(parsePublishedPort(entry)).toEqual(expected);
  });

  test("an entry it cannot read is an error, never a pass", () => {
    expect(() => {
      return parsePublishedPort("[::1]5400:5432");
    }).toThrow();
    expect(() => {
      return parsePublishedPort("1:2:3:4");
    }).toThrow();
    expect(() => {
      return parsePublishedPort(null);
    }).toThrow();
  });
});

describe("every datastore port is published on 127.0.0.1 only", () => {
  test("no compose file publishes a datastore port on another address, or on every interface", () => {
    const published = [];
    const elsewhere = [];

    for (const store of dataStores) {
      for (const port of store.ports) {
        published.push(describePort(store, port));

        if (port.hostIp !== LOOPBACK_ADDRESS) {
          elsewhere.push(describePort(store, port));
        }
      }
    }

    // The production and development stacks do publish datastore ports, so
    // the rule is checked on real entries.
    expect(published.length).toBeGreaterThanOrEqual(5);
    expect(elsewhere).toEqual([]);
  });

  test("no datastore runs on the host's network, where every port it listens on is the server's", () => {
    const onHostNetwork = dataStores
      .filter((store) => {
        return store.networkMode === "host";
      })
      .map((store) => {
        return `${store.file}: ${store.service}`;
      });

    expect(onHostNetwork).toEqual([]);
  });

  /*
   * The host port was fixed at 5400, so a server running a PostgreSQL of its
   * own could only stop it. DATABASE_PUBLISHED_PORT moves it, 5400 unless set,
   * and the backup and restore scripts follow it while their own port
   * settings are empty, as config.example.env ships them.
   */
  test("docker-compose.yml publishes PostgreSQL on 127.0.0.1 at DATABASE_PUBLISHED_PORT, 5400 by default, the port backup.sh and restore.sh use", () => {
    const compose = readCompose("docker-compose.yml");
    const settings = configExampleSettings();

    expect(compose.services.postgres.ports).toEqual([
      "127.0.0.1:${DATABASE_PUBLISHED_PORT:-5400}:5432",
    ]);
    expect(parsePublishedPort(compose.services.postgres.ports[0])).toEqual({
      hostIp: LOOPBACK_ADDRESS,
      hostPort: "${DATABASE_PUBLISHED_PORT:-5400}",
      containerPort: "5432",
    });
    expect(settings.get("DATABASE_PUBLISHED_PORT")).toBe("5400");
    expect(settings.get("DATABASE_BACKUP_HOST")).toBe("localhost");
    expect(settings.get("DATABASE_BACKUP_PORT")).toBe("");
    expect(settings.get("DATABASE_RESTORE_PORT")).toBe("");
    expect(settings.get("DATABASE_RESTORE_HOST")).toBe("host.docker.internal");

    for (const [script, setting] of [
      ["backup.sh", "DATABASE_BACKUP_PORT"],
      ["restore.sh", "DATABASE_RESTORE_PORT"],
    ]) {
      expect(executableLines(script)).toContain(
        `${setting}="\${${setting}:-\${DATABASE_PUBLISHED_PORT:-5400}}"`,
      );
    }
  });

  test("backup.sh and restore.sh run their client on the server's network, and restore.sh's host.docker.internal is its loopback address", () => {
    const backup = executableLines("backup.sh");
    const restore = executableLines("restore.sh");

    expect(backup).toMatch(NET_HOST);
    expect(restore).toMatch(NET_HOST);
    expect(RESTORE_ADD_HOST.exec(restore)?.[1]).toBe(LOOPBACK_ADDRESS);
    // Docker's host-gateway is the docker0 address, where a port published on
    // 127.0.0.1 does not answer.
    expect(restore).not.toContain("host-gateway");
  });

  test("the development stack publishes PostgreSQL, ClickHouse and Valkey on the ports its tools use, on 127.0.0.1", () => {
    const dev = readCompose(DEV_COMPOSE_FILE).services;

    expect(dev.postgres.ports).toEqual([
      "127.0.0.1:${DATABASE_PUBLISHED_PORT:-5400}:5432",
    ]);
    expect(dev.clickhouse.ports).toEqual([
      "127.0.0.1:9034:9000",
      "127.0.0.1:8189:8123",
    ]);
    expect(dev.valkey.ports).toEqual(["127.0.0.1:6310:6379"]);
  });
});

describe("the production stack publishes nothing beyond the server but its ingress", () => {
  test.each(PRODUCTION_COMPOSE_FILES)(
    "%s publishes no ClickHouse or Valkey port",
    (file) => {
      const services = readCompose(file).services;

      expect(services.clickhouse.ports).toBeUndefined();
      expect(services.valkey.ports).toBeUndefined();
    },
  );

  test("every port docker-compose.yml and docker-compose.base.yml publish is the ingress's, or on 127.0.0.1", () => {
    const beyondTheServer = [];

    for (const file of PRODUCTION_COMPOSE_FILES) {
      for (const [name, service] of Object.entries(
        readCompose(file).services,
      )) {
        for (const entry of service.ports || []) {
          const port = parsePublishedPort(entry);

          if (port.hostIp === LOOPBACK_ADDRESS) {
            continue;
          }

          beyondTheServer.push(`${file}#${name} ${entry}`);
        }
      }
    }

    expect(beyondTheServer).toEqual(
      INGRESS_PORTS.map((entry) => {
        return `docker-compose.base.yml#ingress ${entry}`;
      }),
    );
  });
});

/*
 * What Compose itself makes of the files: extends resolved and config.env's
 * settings interpolated, as `npm start` and `npm run dev` run them. Needs the
 * docker CLI's compose plugin, not a daemon. Ops Config Test sets
 * RUN_COMPOSE_DATABASE_RUNTIME_TESTS, so there this fails rather than skips
 * when docker is missing.
 */
const REQUIRE_DOCKER = process.env.RUN_COMPOSE_DATABASE_RUNTIME_TESTS === "1";
const describeWithCompose =
  REQUIRE_DOCKER || hasDockerCompose() ? describe : describe.skip;

describeWithCompose("as Compose renders the files", () => {
  function portsOf(rendered, service) {
    return (rendered.services[service].ports || []).map((port) => {
      return {
        host_ip: port.host_ip,
        published: String(port.published),
        target: port.target,
      };
    });
  }

  test("docker compose is available", () => {
    expect(hasDockerCompose()).toBe(true);
  });

  test("docker-compose.yml publishes PostgreSQL on 127.0.0.1:5400 and no other datastore at all", () => {
    const rendered = renderCompose(["docker-compose.yml"]);

    expect(portsOf(rendered, "postgres")).toEqual([
      { host_ip: LOOPBACK_ADDRESS, published: "5400", target: 5432 },
    ]);
    expect(portsOf(rendered, "clickhouse")).toEqual([]);
    expect(portsOf(rendered, "valkey")).toEqual([]);
  });

  test("the development stack publishes every datastore port on 127.0.0.1", () => {
    const rendered = renderCompose([DEV_COMPOSE_FILE]);

    expect(portsOf(rendered, "postgres")).toEqual([
      { host_ip: LOOPBACK_ADDRESS, published: "5400", target: 5432 },
    ]);
    expect(portsOf(rendered, "clickhouse")).toEqual([
      { host_ip: LOOPBACK_ADDRESS, published: "9034", target: 9000 },
      { host_ip: LOOPBACK_ADDRESS, published: "8189", target: 8123 },
    ]);
    expect(portsOf(rendered, "valkey")).toEqual([
      { host_ip: LOOPBACK_ADDRESS, published: "6310", target: 6379 },
    ]);
  });

  test("the E2E stacks keep ClickHouse on 127.0.0.1 and PostgreSQL where docker-compose.yml puts it", () => {
    const rendered = renderCompose([
      "docker-compose.yml",
      "packages/E2E/docker-compose.billing.yml",
      E2E_CLICKHOUSE_OVERLAY,
    ]);

    expect(portsOf(rendered, "clickhouse")).toEqual([
      { host_ip: LOOPBACK_ADDRESS, published: "8189", target: 8123 },
    ]);
    expect(portsOf(rendered, "postgres")).toEqual([
      { host_ip: LOOPBACK_ADDRESS, published: "5400", target: 5432 },
    ]);
  });
});
