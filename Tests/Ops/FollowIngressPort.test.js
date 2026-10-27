"use strict";

/**
 * Scripts/Install/FollowIngressPort.js, a step of `npm start` before Compose
 * starts anything.
 *
 * The bundled probes use the host's network and reach OneUptime through the
 * ingress, at URLs config.example.env ships as http://localhost (port 80).
 * Moving the ingress (ONEUPTIME_HTTP_PORT=8080, because port 80 was taken)
 * left them calling port 80, so the probe never registered and monitors never
 * ran (#1834, #2035; the Docker Compose guide's troubleshooting said to set
 * the URLs by hand). `npm start` now moves each of them that calls this
 * server over plain HTTP on another port than the ingress's, and leaves every
 * other value - and every other line - as it is. The bundled global Runner
 * reaches the app on OneUptime's own network, so it has no such URL.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  BUNDLED_URL_SETTINGS,
  ingressUrlOf,
  followedUrl,
  followIngressPort,
  describeMoved,
  init,
} = require("../../Scripts/Install/FollowIngressPort");
const {
  readSettings,
} = require("../../Scripts/Install/ReplacePlaceholderSecrets");
const { renderCompose, hasDockerCompose } = require("./Utils/ComposePorts");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = "./Scripts/Install/FollowIngressPort.js";
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);
const ROOT_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);

function withSetting(contents, key, value) {
  const lines = contents.split("\n");
  const index = lines.findIndex((line) => {
    return line.startsWith(`${key}=`);
  });

  if (index === -1) {
    lines.push(`${key}=${value}`);
  } else {
    lines[index] = `${key}=${value}`;
  }

  return lines.join("\n");
}

describe("where the ingress is", () => {
  test.each([
    [undefined, { url: "http://localhost", port: 80 }],
    ["", { url: "http://localhost", port: 80 }],
    ["80", { url: "http://localhost", port: 80 }],
    ["8080", { url: "http://localhost:8080", port: 8080 }],
    ["127.0.0.1:8080", { url: "http://localhost:8080", port: 8080 }],
    ["0.0.0.0:8080", { url: "http://localhost:8080", port: 8080 }],
    ["10.0.0.5:8080", { url: "http://10.0.0.5:8080", port: 8080 }],
    ["[::1]:8080", { url: "http://[::1]:8080", port: 8080 }],
    ["eighty", null],
  ])("ONEUPTIME_HTTP_PORT=%p", (value, expected) => {
    expect(ingressUrlOf(value)).toEqual(expected);
  });
});

describe("which URLs follow it", () => {
  const ingress = ingressUrlOf("8080");

  test.each([
    ["http://localhost", "http://localhost:8080"],
    ["http://localhost/", "http://localhost:8080"],
    ["http://127.0.0.1", "http://localhost:8080"],
    ["http://[::1]:80", "http://localhost:8080"],
    ["http://localhost:9090", "http://localhost:8080"],
    ["HTTP://LOCALHOST", "http://localhost:8080"],
  ])("%s, on another port than the ingress's, moves to %s", (value, url) => {
    expect(followedUrl(value, ingress)).toBe(url);
  });

  test.each([
    "http://localhost:8080",
    "https://localhost",
    "http://oneuptime.example.com",
    "https://oneuptime.example.com:8443",
    "http://10.0.0.5",
    "http://localhost/oneuptime",
    "http://localhost.example.com",
    "",
  ])("%p stays as it is", (value) => {
    expect(followedUrl(value, ingress)).toBeNull();
  });

  test("an ingress setting that cannot be read moves nothing", () => {
    expect(followedUrl("http://localhost", null)).toBeNull();
  });
});

describe("followIngressPort on config.env", () => {
  test("a stock config.env is left exactly as it is", () => {
    const result = followIngressPort(TEMPLATE);

    expect(result.contents).toBe(TEMPLATE);
    expect(result.moved).toEqual([]);
  });

  test("an ingress moved to 8080 moves the two probes, and nothing else", () => {
    const before = withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080");
    const result = followIngressPort(before);
    const settings = readSettings(result.contents);

    expect(result.moved).toEqual([
      "GLOBAL_PROBE_1_ONEUPTIME_URL",
      "GLOBAL_PROBE_2_ONEUPTIME_URL",
    ]);
    for (const key of BUNDLED_URL_SETTINGS) {
      expect(settings.get(key)).toBe("http://localhost:8080");
    }

    const changed = before.split("\n").filter((line, index) => {
      return line !== result.contents.split("\n")[index];
    });

    expect(changed).toEqual([
      "GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost",
      "GLOBAL_PROBE_2_ONEUPTIME_URL=http://localhost",
    ]);
  });

  /*
   * The shared Runner, which used the host's network, is gone, and nothing
   * reads its URL. A config.env from before keeps the line, untouched.
   */
  test("leaves the shared Runner's old URL in an older config.env alone", () => {
    expect(BUNDLED_URL_SETTINGS).not.toContain(
      "ONEUPTIME_RUNNER_ONEUPTIME_URL",
    );

    const before = withSetting(
      withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080"),
      "ONEUPTIME_RUNNER_ONEUPTIME_URL",
      "http://localhost",
    );
    const result = followIngressPort(before);

    expect(
      readSettings(result.contents).get("ONEUPTIME_RUNNER_ONEUPTIME_URL"),
    ).toBe("http://localhost");
    expect(result.moved).not.toContain("ONEUPTIME_RUNNER_ONEUPTIME_URL");
  });

  test("the Docker Compose guide's proxy settings need nothing more", () => {
    let config = TEMPLATE;

    for (const [key, value] of [
      ["ONEUPTIME_HTTP_PORT", "127.0.0.1:8080"],
      ["GLOBAL_PROBE_1_ONEUPTIME_URL", "http://localhost:8080"],
    ]) {
      config = withSetting(config, key, value);
    }

    expect(followIngressPort(config).moved).toEqual([
      "GLOBAL_PROBE_2_ONEUPTIME_URL",
    ]);
  });

  test("moving the ingress back to 80 moves them back", () => {
    let config = withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080");
    config = followIngressPort(config).contents;
    config = withSetting(config, "ONEUPTIME_HTTP_PORT", "80");

    const result = followIngressPort(config);

    expect(result.contents).toBe(TEMPLATE);
  });

  test("a URL the operator pointed elsewhere is never touched", () => {
    let config = withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080");
    config = withSetting(
      config,
      "GLOBAL_PROBE_1_ONEUPTIME_URL",
      "https://oneuptime.example.com",
    );

    const result = followIngressPort(config);

    expect(
      readSettings(result.contents).get("GLOBAL_PROBE_1_ONEUPTIME_URL"),
    ).toBe("https://oneuptime.example.com");
    expect(result.moved).not.toContain("GLOBAL_PROBE_1_ONEUPTIME_URL");
  });

  test("quotes, comments, look-alike names and Windows line endings", () => {
    const before = [
      "ONEUPTIME_HTTP_PORT=8080\r",
      "# GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost\r",
      'GLOBAL_PROBE_1_ONEUPTIME_URL="http://localhost"\r',
      "GLOBAL_PROBE_1_ONEUPTIME_URL_OLD=http://localhost\r",
      "",
    ].join("\n");
    const result = followIngressPort(before);

    expect(result.contents.split("\n")).toEqual([
      "ONEUPTIME_HTTP_PORT=8080\r",
      "# GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost\r",
      "GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost:8080\r",
      "GLOBAL_PROBE_1_ONEUPTIME_URL_OLD=http://localhost\r",
      "",
    ]);
  });

  test("a second run changes nothing", () => {
    const first = followIngressPort(
      withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080"),
    );
    const second = followIngressPort(first.contents);

    expect(second.contents).toBe(first.contents);
    expect(second.moved).toEqual([]);
  });

  test("it says what it moved, in one line of npm start's list", () => {
    expect(
      describeMoved(
        ["GLOBAL_PROBE_1_ONEUPTIME_URL", "GLOBAL_PROBE_2_ONEUPTIME_URL"],
        "http://localhost:8080",
      ),
    ).toBe(
      "  ✓ Pointed the bundled probes at the ingress: GLOBAL_PROBE_1_ONEUPTIME_URL and GLOBAL_PROBE_2_ONEUPTIME_URL are now http://localhost:8080 in config.env.",
    );
    expect(
      describeMoved(["GLOBAL_PROBE_1_ONEUPTIME_URL"], "http://localhost:8080"),
    ).toContain("GLOBAL_PROBE_1_ONEUPTIME_URL is now http://localhost:8080");
  });

  test("it names what it moved: the probe or the probes", () => {
    const subjectOf = (moved) => {
      const line = describeMoved(moved, "http://localhost:8080");

      return line.slice(line.indexOf("Pointed ") + 8, line.indexOf(" at the"));
    };

    expect(subjectOf(["GLOBAL_PROBE_1_ONEUPTIME_URL"])).toBe(
      "the bundled probe",
    );
    expect(
      subjectOf([
        "GLOBAL_PROBE_1_ONEUPTIME_URL",
        "GLOBAL_PROBE_2_ONEUPTIME_URL",
      ]),
    ).toBe("the bundled probes");
    expect(subjectOf(BUNDLED_URL_SETTINGS)).toBe("the bundled probes");
    // A fresh config.example.env moves both, and says so in those words.
    expect(
      describeMoved(
        followIngressPort(withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080"))
          .moved,
        "http://localhost:8080",
      ),
    ).toBe(
      "  ✓ Pointed the bundled probes at the ingress: GLOBAL_PROBE_1_ONEUPTIME_URL and GLOBAL_PROBE_2_ONEUPTIME_URL are now http://localhost:8080 in config.env.",
    );
  });
});

describe("init", () => {
  function fileSystemWith(contents, fails) {
    const state = { contents: contents, writes: 0 };

    return Object.assign(state, {
      existsSync: () => {
        return contents !== null;
      },
      readFileSync: () => {
        if (fails === "read") {
          throw new Error("EACCES: permission denied");
        }

        return state.contents;
      },
      writeFileSync: (_path, next) => {
        state.writes += 1;

        if (fails === "write") {
          throw new Error("EROFS: read-only file system");
        }

        state.contents = next;
      },
    });
  }

  test("writes and says what it moved", () => {
    const files = fileSystemWith(
      withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080"),
    );
    const logged = [];

    expect(
      init({
        fileSystem: files,
        log: (line) => {
          logged.push(line);
        },
      }),
    ).toEqual(["GLOBAL_PROBE_1_ONEUPTIME_URL", "GLOBAL_PROBE_2_ONEUPTIME_URL"]);
    expect(files.writes).toBe(1);
    expect(logged).toHaveLength(1);
  });

  test("a stock config.env is not written, and nothing is said", () => {
    const files = fileSystemWith(TEMPLATE);
    const logged = [];

    expect(
      init({
        fileSystem: files,
        log: (line) => {
          logged.push(line);
        },
      }),
    ).toEqual([]);
    expect(files.writes).toBe(0);
    expect(logged).toEqual([]);
  });

  test("no config.env, or one it cannot read or write: nothing, and never a throw", () => {
    for (const files of [
      fileSystemWith(null),
      fileSystemWith(
        withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080"),
        "read",
      ),
      fileSystemWith(
        withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080"),
        "write",
      ),
    ]) {
      expect(init({ fileSystem: files, log: () => {} })).toEqual([]);
    }
  });

  test("run as a script, it exits 0 even when config.env is not a file", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-follow-ingress-"),
    );

    try {
      fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
        recursive: true,
      });
      for (const file of [
        "FollowIngressPort.js",
        "ReplacePlaceholderSecrets.js",
        "StartOutput.js",
      ]) {
        fs.copyFileSync(
          path.join(REPO_ROOT, "Scripts", "Install", file),
          path.join(directory, "Scripts", "Install", file),
        );
      }
      fs.mkdirSync(path.join(directory, "config.env"));

      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: directory,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");

      fs.rmSync(path.join(directory, "config.env"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "config.env"),
        withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080"),
      );

      const moved = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: directory,
        encoding: "utf8",
      });

      expect(moved.status).toBe(0);
      expect(moved.stdout).toContain(
        "are now http://localhost:8080 in config.env.",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("npm start", () => {
  test("runs it before Compose starts anything with config.env's settings", () => {
    const steps = ROOT_PACKAGE.scripts.start.split(" && ");
    const step = steps.indexOf(`node ${SCRIPT_PATH}`);
    const compose = steps.findIndex((command) => {
      return command.startsWith(
        "sh ./Scripts/Install/WithConfig.sh docker compose up ",
      );
    });

    expect(step).toBeGreaterThan(0);
    expect(compose).toBeGreaterThan(0);
    expect(step).toBeLessThan(compose);
  });

  test("the services it points are the ones on the host's network that read those settings", () => {
    const base = require("js-yaml").load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );

    expect(base.services["probe-1"].network_mode).toBe("host");
    expect(base.services["probe-1"].environment.ONEUPTIME_URL).toBe(
      "${GLOBAL_PROBE_1_ONEUPTIME_URL}",
    );
    expect(base.services["probe-2"].network_mode).toBe("host");
    expect(base.services["probe-2"].environment.ONEUPTIME_URL).toBe(
      "${GLOBAL_PROBE_2_ONEUPTIME_URL}",
    );

    // The other services reach the app on OneUptime's own network.
    expect(base.services["global-runner"].network_mode).toBeUndefined();
    expect(base.services["global-runner"].environment.ONEUPTIME_URL).toBe(
      "http://app:${APP_PORT}",
    );

    // And no other service is on the host's network.
    const onTheHostsNetwork = Object.keys(base.services).filter((name) => {
      return base.services[name].network_mode === "host";
    });

    expect(onTheHostsNetwork.sort()).toEqual(["e2e", "probe-1", "probe-2"]);
  });
});

const describeWithCompose = hasDockerCompose() ? describe : describe.skip;

describeWithCompose("as Compose renders a moved ingress", () => {
  test("the bundled probe gets the ingress's new address", () => {
    const moved = readSettings(
      followIngressPort(withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080"))
        .contents,
    );
    const rendered = renderCompose(["docker-compose.yml"], {
      ONEUPTIME_HTTP_PORT: "8080",
      GLOBAL_PROBE_1_ONEUPTIME_URL: moved.get("GLOBAL_PROBE_1_ONEUPTIME_URL"),
    });

    expect(rendered.services["probe-1"].environment.ONEUPTIME_URL).toBe(
      "http://localhost:8080",
    );
    expect(String(rendered.services.ingress.ports[0].published)).toBe("8080");
  });
});
