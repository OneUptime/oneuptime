"use strict";

/**
 * Docker Compose keeps each visitor's address on the way to the ingress, in
 * the setups the Docker Compose guide describes.
 *
 * OneUptime counts a visitor by the address its ingress accepted the
 * connection from: its sign-in limits, its other per-address limits and its
 * IP allowlists. Two settings decide whether that is the visitor's own:
 *
 *   - ENABLE_IPV6 turns IPv6 on for OneUptime's network. Without it Docker
 *     passes every IPv6 visitor on to the ingress from one address of its
 *     own (its userland proxy, from the network's gateway), so OneUptime sees
 *     them all as one visitor. It is off unless config.env says otherwise:
 *     Docker Engine before 27 has no IPv6 range to give the network and would
 *     refuse to start the stack, and so would a kernel without IPv6.
 *   - Behind a proxy of the operator's own on the same server
 *     (TRUSTED_PROXY_HOPS=2), the ingress's ports are published on the
 *     loopback address only (ONEUPTIME_HTTP_PORT=127.0.0.1:8080), so nobody
 *     reaches the ingress around the proxy and writes the address OneUptime
 *     counts them by themselves.
 *
 * Read from the compose files, and from `docker compose config` where the
 * Docker CLI is installed (the Ops Config Test workflow has it).
 */

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

const describeWithCompose = hasDockerCompose() ? describe : describe.skip;

describe("OneUptime's network has IPv6 only when ENABLE_IPV6 says so", () => {
  test.each(COMPOSE_FILES)(
    "%s takes enable_ipv6 from ENABLE_IPV6, off when it is unset",
    (file) => {
      const compose = readCompose(file);

      expect(compose.networks).toEqual({
        oneuptime: {
          driver: "bridge",
          enable_ipv6: "${ENABLE_IPV6:-false}",
        },
      });
    },
  );

  test("config.example.env ships it off", () => {
    expect(configExampleSettings().get("ENABLE_IPV6")).toBe("false");
  });
});

describeWithCompose("as docker compose reads the production stack", () => {
  function oneuptimeNetwork(extraEnv) {
    const rendered = renderCompose(PRODUCTION_STACK, extraEnv);

    return rendered.networks.oneuptime;
  }

  test("an install whose config.env predates the setting keeps an IPv4-only network", () => {
    // npm start exports config.env; an older one has no ENABLE_IPV6 at all.
    expect(oneuptimeNetwork({ ENABLE_IPV6: undefined }).enable_ipv6).toBe(
      false,
    );
  });

  test("config.example.env's value leaves IPv6 off", () => {
    expect(oneuptimeNetwork({}).enable_ipv6).toBe(false);
  });

  test.each([
    ["true", true],
    ["false", false],
    ["yes", true],
    ["no", false],
  ])("ENABLE_IPV6=%s turns it %s", (value, expected) => {
    expect(oneuptimeNetwork({ ENABLE_IPV6: value }).enable_ipv6).toBe(
      expected,
    );
  });

  test("a value Docker Compose cannot read stops the start with its name, never a silent default", () => {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--project-directory",
        REPO_ROOT,
        "-f",
        "docker-compose.yml",
        "config",
        "--format",
        "json",
      ],
      {
        cwd: REPO_ROOT,
        env: Object.assign(
          {},
          process.env,
          Object.fromEntries(configExampleSettings()),
          { ENABLE_IPV6: "maybe" },
        ),
        encoding: "utf8",
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("enable_ipv6");
  });

  test("every service on OneUptime's network joins the one network the setting turns IPv6 on for", () => {
    const rendered = renderCompose(PRODUCTION_STACK, { ENABLE_IPV6: "true" });

    expect(Object.keys(rendered.networks)).toEqual(["oneuptime"]);

    for (const [name, service] of Object.entries(rendered.services)) {
      if (service.network_mode === "host") {
        continue;
      }

      expect([name, Object.keys(service.networks || {})]).toEqual([
        name,
        ["oneuptime"],
      ]);
    }

    expect(rendered.networks.oneuptime.enable_ipv6).toBe(true);
  });
});

describeWithCompose("the ingress published on the loopback address, as the guide sets it behind a proxy on the server", () => {
  test("ONEUPTIME_HTTP_PORT and STATUS_PAGE_HTTPS_PORT with 127.0.0.1 publish the ingress there and nowhere else", () => {
    const rendered = renderCompose(PRODUCTION_STACK, {
      ONEUPTIME_HTTP_PORT: "127.0.0.1:8080",
      STATUS_PAGE_HTTPS_PORT: "127.0.0.1:8443",
    });

    const ports = rendered.services.ingress.ports.map((port) => {
      return [port.host_ip || "", String(port.published), String(port.target)];
    });

    expect(ports).toEqual([
      ["127.0.0.1", "8080", "7849"],
      ["127.0.0.1", "8443", "7850"],
    ]);
  });

  test("a bare port still publishes on every address, as a stock install does", () => {
    const rendered = renderCompose(PRODUCTION_STACK, {});

    const ports = rendered.services.ingress.ports.map((port) => {
      return [port.host_ip || "", String(port.published), String(port.target)];
    });

    expect(ports).toEqual([
      ["", "80", "7849"],
      ["", "443", "7850"],
    ]);
  });
});
