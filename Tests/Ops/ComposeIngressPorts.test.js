"use strict";

/**
 * Where Docker Compose publishes the ingress, when ONEUPTIME_HTTP_PORT or
 * STATUS_PAGE_HTTPS_PORT is empty, unset, or leaves the port to Docker
 * (#10170).
 *
 * docker-compose.base.yml published the ingress at
 * "${ONEUPTIME_HTTP_PORT}:7849". With the setting empty (or missing from a
 * config.env) that rendered ":7849", which has Docker publish the ingress on
 * a port it picks as it starts the container. Everything on the server takes
 * an empty setting as config.example.env's port 80 (and 443): npm start's
 * status check (Tests/Scripts/status-check.sh's read_ingress), the doctor
 * and backup.sh's report (FollowIngressPort's ingressRequestOf), and the
 * bundled probes (FollowIngressPort). So npm start waited five minutes for
 * nothing at port 80, ended with "Maximum retries reached", and the probes
 * showed Disconnected, while nothing said the setting was empty.
 *
 * Compose now publishes an empty or unset setting on its default port, as
 * docker-compose.yml already does for PostgreSQL's DATABASE_PUBLISHED_PORT:
 * "${ONEUPTIME_HTTP_PORT:-80}:7849". What no default can fill in - an
 * address with no port after it (127.0.0.1:) or port 0 - still has Docker
 * pick, and stops npm start with the line to write (Preflight.js's
 * pickedPortFindings). These tests hold the files, the scripts that read
 * the settings and Compose itself to that.
 */

const path = require("path");
const { spawnSync } = require("child_process");
const {
  REPO_ROOT,
  configExampleSettings,
  hasDockerCompose,
  readCompose,
  renderCompose,
} = require("./Utils/ComposePorts");
const {
  PICKED_PORT_SETTINGS,
  pickedPortFindings,
} = require("../../Scripts/Install/Preflight");
const {
  INGRESS_PORT_SETTINGS,
} = require("../../Scripts/Install/CheckIngressPorts");
const {
  ingressRequestOf,
  ingressUrlOf,
  publishedIngressOf,
} = require("../../Scripts/Install/FollowIngressPort");

// The ingress's two published ports: the setting, its default, and the port inside.
const INGRESS_PORTS = [
  { setting: "ONEUPTIME_HTTP_PORT", defaultPort: "80", target: 7849 },
  { setting: "STATUS_PAGE_HTTPS_PORT", defaultPort: "443", target: 7850 },
];

// The stacks OneUptime starts, as `npm start` and `npm run dev` name them.
const STACKS = [
  { name: "npm start", files: ["docker-compose.yml"] },
  { name: "npm run dev", files: ["Scripts/Dev/docker-compose.dev.yml"] },
];

/*
 * Values that leave the port to Docker, as Compose reads them: no port after
 * the address, or port 0. And values with a port of their own.
 */
const PICKED_FORMS = [
  ":",
  "0",
  "00",
  "127.0.0.1:",
  "127.0.0.1:0",
  "0.0.0.0:",
  "[::1]:",
  "::1:",
  "[::]:0",
  ":::",
];
const FIXED_FORMS = [
  "80",
  "8080",
  ":8080",
  "0.0.0.0:8080",
  "127.0.0.1:8080",
  "[::1]:8080",
  "::1:8080",
  "[::]:8080",
];

const describeWithCompose = hasDockerCompose() ? describe : describe.skip;

// The ingress's published port for `target`, as `docker compose config` renders `stack` with `extraEnv`.
function publishedOf(files, extraEnv, target) {
  return renderCompose(files, extraEnv).services.ingress.ports.find((port) => {
    return Number(port.target) === target;
  });
}

describe("the compose files publish an empty or unset setting on its default port", () => {
  const base = readCompose("docker-compose.base.yml");

  test("docker-compose.base.yml's ingress publishes 7849 and 7850 with config.example.env's ports as their defaults", () => {
    expect(base.services.ingress.ports).toEqual([
      "${ONEUPTIME_HTTP_PORT:-80}:7849",
      "${STATUS_PAGE_HTTPS_PORT:-443}:7850",
    ]);
    // The setting it hands the ingress takes the same default.
    expect(base.services.ingress.environment.ONEUPTIME_HTTP_PORT).toBe(
      "${ONEUPTIME_HTTP_PORT:-80}",
    );
  });

  test.each(INGRESS_PORTS)(
    "$setting: the default is config.example.env's, and the one every script that reads it assumes",
    ({ setting, defaultPort }) => {
      expect(configExampleSettings().get(setting)).toBe(defaultPort);
      expect(
        INGRESS_PORT_SETTINGS.find((entry) => {
          return entry.setting === setting;
        }).defaultPort,
      ).toBe(defaultPort);
      expect(
        String(
          PICKED_PORT_SETTINGS.find((entry) => {
            return entry.setting === setting;
          }).defaultPort,
        ),
      ).toBe(defaultPort);
    },
  );

  test("the doctor, backup.sh's report and the bundled probes take an empty ONEUPTIME_HTTP_PORT as port 80, and so does an unset one", () => {
    for (const value of ["", undefined, " "]) {
      expect(publishedIngressOf(value)).toEqual({ address: "", port: 80 });
      expect(ingressRequestOf(value)).toEqual({
        url: "http://localhost",
        host: "localhost",
        port: 80,
      });
      expect(ingressUrlOf(value).url).toBe("http://localhost");
    }
  });

  test.each(STACKS)(
    "$name runs the ingress from docker-compose.base.yml's, with its ports",
    ({ files }) => {
      const ingress = readCompose(files[0]).services.ingress;

      expect(path.posix.basename(ingress.extends.file)).toBe(
        "docker-compose.base.yml",
      );
      expect(ingress.extends.service).toBe("ingress");
      // Ports of its own would add to the base's, with no default.
      expect(ingress.ports).toBeUndefined();
    },
  );
});

describe("a setting that leaves the port to Docker stops npm start", () => {
  test.each(PICKED_FORMS)("ONEUPTIME_HTTP_PORT=%s is said", (value) => {
    const found = pickedPortFindings(new Map([["ONEUPTIME_HTTP_PORT", value]]));

    expect(found).toHaveLength(1);
    expect(found[0].level).toBe("stop");
    expect(found[0].message).toContain(
      `ONEUPTIME_HTTP_PORT in config.env is ${value}, which leaves the port to Docker`,
    );
  });

  test.each(FIXED_FORMS.concat(["", "eighty"]))(
    "ONEUPTIME_HTTP_PORT=%j is not",
    (value) => {
      expect(
        pickedPortFindings(new Map([["ONEUPTIME_HTTP_PORT", value]])),
      ).toEqual([]);
    },
  );
});

describeWithCompose("as Docker Compose publishes the ingress", () => {
  test.each(STACKS)(
    "$name: an empty ONEUPTIME_HTTP_PORT and STATUS_PAGE_HTTPS_PORT publish 80 and 443 on every address",
    ({ files }) => {
      for (const { setting, defaultPort, target } of INGRESS_PORTS) {
        const published = publishedOf(files, { [setting]: "" }, target);

        expect({
          setting,
          hostIp: published.host_ip || "",
          published: published.published,
        }).toEqual({ setting, hostIp: "", published: defaultPort });
      }
    },
  );

  test.each(STACKS)(
    "$name: a config.env without them publishes 80 and 443 too",
    ({ files }) => {
      for (const { setting, defaultPort, target } of INGRESS_PORTS) {
        expect(
          publishedOf(files, { [setting]: undefined }, target).published,
        ).toBe(defaultPort);
      }
    },
  );

  test("a config.env without them gets no warning from Compose", () => {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--project-directory",
        REPO_ROOT,
        "-f",
        path.join(REPO_ROOT, "docker-compose.yml"),
        "config",
        "--quiet",
      ],
      {
        cwd: REPO_ROOT,
        env: Object.fromEntries(
          Object.entries({
            ...process.env,
            ...Object.fromEntries(configExampleSettings()),
          }).filter(([name]) => {
            return (
              name !== "ONEUPTIME_HTTP_PORT" &&
              name !== "STATUS_PAGE_HTTPS_PORT"
            );
          }),
        ),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("ONEUPTIME_HTTP_PORT");
    expect(result.stderr).not.toContain("STATUS_PAGE_HTTPS_PORT");
  });

  /*
   * What Compose leaves to Docker is exactly what the check stops on: no
   * published port, or port 0. Every other form publishes a port of its own.
   */
  test.each(PICKED_FORMS)(
    "ONEUPTIME_HTTP_PORT=%s leaves the port to Docker, as the check says",
    (value) => {
      const published = publishedOf(
        ["docker-compose.yml"],
        { ONEUPTIME_HTTP_PORT: value },
        7849,
      );

      expect(Number(published.published || 0)).toBe(0);
      expect(
        pickedPortFindings(new Map([["ONEUPTIME_HTTP_PORT", value]])),
      ).toHaveLength(1);
    },
  );

  test.each(PICKED_FORMS)(
    "STATUS_PAGE_HTTPS_PORT=%s leaves the port to Docker, as the check says",
    (value) => {
      const published = publishedOf(
        ["docker-compose.yml"],
        { STATUS_PAGE_HTTPS_PORT: value },
        7850,
      );

      expect(Number(published.published || 0)).toBe(0);
      expect(
        pickedPortFindings(new Map([["STATUS_PAGE_HTTPS_PORT", value]])),
      ).toHaveLength(1);
    },
  );

  test.each(FIXED_FORMS)(
    "ONEUPTIME_HTTP_PORT=%s publishes a port of its own, and the check says nothing",
    (value) => {
      const published = publishedOf(
        ["docker-compose.yml"],
        { ONEUPTIME_HTTP_PORT: value },
        7849,
      );

      expect(Number(published.published)).toBeGreaterThan(0);
      expect(
        pickedPortFindings(new Map([["ONEUPTIME_HTTP_PORT", value]])),
      ).toEqual([]);
    },
  );

  test.each(PICKED_FORMS)(
    "the address in the fix the check gives for %s is the one Compose would publish on, with its port",
    (value) => {
      const message = pickedPortFindings(
        new Map([["ONEUPTIME_HTTP_PORT", value]]),
      )[0].message;
      const fixed = /such as ONEUPTIME_HTTP_PORT=(\S+)\.$/.exec(message)[1];
      const before = publishedOf(
        ["docker-compose.yml"],
        { ONEUPTIME_HTTP_PORT: value },
        7849,
      );
      const after = publishedOf(
        ["docker-compose.yml"],
        { ONEUPTIME_HTTP_PORT: fixed },
        7849,
      );

      expect({
        hostIp: after.host_ip || "",
        published: after.published,
      }).toEqual({ hostIp: before.host_ip || "", published: "80" });
    },
  );
});
