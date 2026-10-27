"use strict";

/**
 * Docker Compose keeps each visitor's address on the way to the ingress, in
 * the setups the Docker Compose guide describes, and an upgrade never
 * touches OneUptime's network to get there.
 *
 * OneUptime counts a visitor by the address its ingress accepted the
 * connection from: its sign-in limits, its other per-address limits and its
 * IP allowlists. Two settings decide whether that is the visitor's own:
 *
 *   - IPv6 on OneUptime's network. Without it Docker passes every IPv6
 *     visitor on to the ingress from one address of its own (its userland
 *     proxy, from the network's gateway), so OneUptime sees them all as one
 *     visitor. The operator turns it on in docker-compose.override.yml, the
 *     snippet in the guide's "Visitor addresses" section, which `npm start`
 *     and `npm run update` read because they name no compose file. The
 *     compose files OneUptime ships keep the network exactly as installs
 *     created it: Docker Compose recreates a network whose settings change,
 *     and cannot while a container it does not manage is attached (an
 *     operator's own proxy, say), so a change there would stop such an
 *     install on its next upgrade. It needs Docker Engine 27 or later, which
 *     gives the network an IPv6 range of its own.
 *   - Behind a proxy of the operator's own on the same server
 *     (TRUSTED_PROXY_HOPS=2), the ingress's ports are published on the
 *     loopback address only (ONEUPTIME_HTTP_PORT=127.0.0.1:8080), so nobody
 *     reaches the ingress around the proxy and writes the address OneUptime
 *     counts them by themselves.
 *
 * Read from the compose files, the guide and package.json, and from
 * `docker compose config` where the Docker CLI is installed (the Ops Config
 * Test workflow has it).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const {
  REPO_ROOT,
  configExampleSettings,
  hasDockerCompose,
  readCompose,
  renderCompose,
} = require("./Utils/ComposePorts");

// Every compose file that runs OneUptime's own network.
const COMPOSE_FILES = [
  "docker-compose.yml",
  "docker-compose.base.yml",
  "Scripts/Dev/docker-compose.dev.yml",
];

const PRODUCTION_STACK = ["docker-compose.yml"];

// docker-compose.yml extends services of docker-compose.base.yml.
const PRODUCTION_FILES = ["docker-compose.yml", "docker-compose.base.yml"];

const GUIDE = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en/installation/docker-compose.md",
);

const OVERRIDE_FENCE = '```yaml title="docker-compose.override.yml"';

const describeWithCompose = hasDockerCompose() ? describe : describe.skip;

/** The guide's "Visitor addresses" section, up to the next section. */
function visitorAddressesSection() {
  const lines = fs.readFileSync(GUIDE, "utf8").split("\n");
  const start = lines.indexOf("## Visitor addresses");

  if (start < 0) {
    throw new Error("the guide has no Visitor addresses section");
  }

  const end = lines.findIndex((line, index) => {
    return index > start && line.startsWith("## ");
  });

  return lines.slice(start, end < 0 ? undefined : end);
}

/** The docker-compose.override.yml the section tells the operator to write. */
function guideOverride() {
  const section = visitorAddressesSection();
  const fences = section.reduce((found, line, index) => {
    return line === OVERRIDE_FENCE ? found.concat(index) : found;
  }, []);

  if (fences.length !== 1) {
    throw new Error(`expected one override snippet, found ${fences.length}`);
  }

  const close = section.indexOf("```", fences[0] + 1);

  return section.slice(fences[0] + 1, close).join("\n") + "\n";
}

describe("the compose files OneUptime ships keep OneUptime's network as installs created it", () => {
  test.each(COMPOSE_FILES)(
    "%s declares the network with its driver and nothing else",
    (file) => {
      expect(readCompose(file).networks).toEqual({
        oneuptime: { driver: "bridge" },
      });
    },
  );

  test("npm start and npm run update read docker-compose.override.yml: they name no compose file", () => {
    const scripts = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    ).scripts;
    const compose = scripts.start
      .split("&&")
      .map((command) => {
        return command.trim();
      })
      .filter((command) => {
        return command.includes("docker compose");
      });

    // Docker Compose reads the override itself only when no file is named.
    expect(compose).toEqual([
      "sh ./Scripts/Install/WithConfig.sh docker compose up --remove-orphans -d $npm_config_services",
    ]);
    expect(scripts.update.trim().endsWith("&& npm run start")).toBe(true);
  });

  test("the guide's override turns IPv6 on for OneUptime's network, and sets nothing else", () => {
    expect(yaml.load(guideOverride())).toEqual({
      networks: { oneuptime: { enable_ipv6: true } },
    });
  });
});

describeWithCompose(
  "as docker compose reads the production stack, the way npm start does",
  () => {
    let project;

    /*
     * `docker compose config` from a directory holding copies of the shipped
     * files, naming none of them, so Docker Compose finds
     * docker-compose.override.yml by itself, as it does for `npm start`.
     */
    function render() {
      const env = Object.assign(
        {},
        process.env,
        Object.fromEntries(configExampleSettings()),
        { COMPOSE_FILE: undefined, COMPOSE_PROJECT_NAME: undefined },
      );
      const result = spawnSync(
        "docker",
        ["compose", "config", "--format", "json"],
        {
          cwd: project,
          env,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        },
      );

      if (result.status !== 0) {
        throw new Error(
          `docker compose config failed (${result.status}): ${result.stderr}`,
        );
      }

      return JSON.parse(result.stdout);
    }

    function writeOverride() {
      fs.writeFileSync(
        path.join(project, "docker-compose.override.yml"),
        guideOverride(),
      );
    }

    beforeEach(() => {
      project = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-compose-"));

      for (const file of PRODUCTION_FILES) {
        fs.copyFileSync(path.join(REPO_ROOT, file), path.join(project, file));
      }
    });

    afterEach(() => {
      fs.rmSync(project, { recursive: true, force: true });
    });

    test("without an override, the network has no IPv6, as installs created it", () => {
      const network = render().networks.oneuptime;

      expect(network.driver).toBe("bridge");
      expect(network.enable_ipv6).toBeUndefined();
    });

    test("with the guide's override, the network has IPv6", () => {
      writeOverride();

      const network = render().networks.oneuptime;

      expect(network.driver).toBe("bridge");
      expect(network.enable_ipv6).toBe(true);
    });

    test("the override changes the network only, not a service", () => {
      const before = render();

      writeOverride();

      const after = render();

      expect(after.services).toEqual(before.services);
      expect(Object.keys(after.networks)).toEqual(["oneuptime"]);
    });

    test("every service off the host network joins OneUptime's network alone, so the ingress gets IPv6 with it", () => {
      writeOverride();

      const rendered = render();
      const joined = [];

      for (const [name, service] of Object.entries(rendered.services)) {
        if (service.network_mode === "host") {
          continue;
        }

        joined.push(name);
        expect([name, Object.keys(service.networks || {})]).toEqual([
          name,
          ["oneuptime"],
        ]);
      }

      expect(joined).toContain("ingress");
    });
  },
);

describeWithCompose(
  "the ingress published on the loopback address, as the guide sets it behind a proxy on the server",
  () => {
    test("ONEUPTIME_HTTP_PORT and STATUS_PAGE_HTTPS_PORT with 127.0.0.1 publish the ingress there and nowhere else", () => {
      const rendered = renderCompose(PRODUCTION_STACK, {
        ONEUPTIME_HTTP_PORT: "127.0.0.1:8080",
        STATUS_PAGE_HTTPS_PORT: "127.0.0.1:8443",
      });

      const ports = rendered.services.ingress.ports.map((port) => {
        return [
          port.host_ip || "",
          String(port.published),
          String(port.target),
        ];
      });

      expect(ports).toEqual([
        ["127.0.0.1", "8080", "7849"],
        ["127.0.0.1", "8443", "7850"],
      ]);
    });

    test("a bare port still publishes on every address, as a stock install does", () => {
      const rendered = renderCompose(PRODUCTION_STACK, {});

      const ports = rendered.services.ingress.ports.map((port) => {
        return [
          port.host_ip || "",
          String(port.published),
          String(port.target),
        ];
      });

      expect(ports).toEqual([
        ["", "80", "7849"],
        ["", "443", "7850"],
      ]);
    });
  },
);
