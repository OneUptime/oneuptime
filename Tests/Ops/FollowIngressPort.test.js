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
  publishedIngressOf,
  ingressUrlOf,
  ingressRequestOf,
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
    [undefined, "http://localhost", 80, ""],
    ["", "http://localhost", 80, ""],
    ["80", "http://localhost", 80, ""],
    ["8080", "http://localhost:8080", 8080, ""],
    ["127.0.0.1:8080", "http://localhost:8080", 8080, "127.0.0.1"],
    ["0.0.0.0:8080", "http://localhost:8080", 8080, "0.0.0.0"],
    ["10.0.0.5:8080", "http://10.0.0.5:8080", 8080, "10.0.0.5"],
    ["[::1]:8080", "http://[::1]:8080", 8080, "[::1]"],
    // Compose takes an IPv6 address without brackets too; a URL needs them.
    ["::1:8080", "http://[::1]:8080", 8080, "[::1]"],
    ["2001:db8::5:8080", "http://[2001:db8::5]:8080", 8080, "[2001:db8::5]"],
    // Docker publishes :: on IPv6 alone, where localhost may be 127.0.0.1 alone.
    [":::8080", "http://[::1]:8080", 8080, "[::]"],
    ["[::]:8080", "http://[::1]:8080", 8080, "[::]"],
  ])("ONEUPTIME_HTTP_PORT=%p: %s", (value, url, port, address) => {
    expect(ingressUrlOf(value)).toEqual({ url, port, address });
  });

  test("a setting that is no port is no ingress", () => {
    expect(ingressUrlOf("eighty")).toBeNull();
  });

  /*
   * Unbracketed, a bundled probe's URL was http://::1:8080, which no client
   * can read: the probe never started, and the doctor said OneUptime did
   * not answer.
   */
  test.each(["::1:8080", "2001:db8::5:8080", "[::1]:8443", "10.0.0.5:8080"])(
    "ONEUPTIME_HTTP_PORT=%s gives the probes a URL that reads as the address and port Compose publishes",
    (value) => {
      const { url, port } = ingressUrlOf(value);
      const parsed = new URL(url);
      const published = publishedIngressOf(value);

      expect(parsed.host).toBe(`${published.address}:${port}`);
      expect(parsed.pathname).toBe("/");
    },
  );

  test.each([
    [undefined, { address: "", port: 80 }],
    ["", { address: "", port: 80 }],
    ["80", { address: "", port: 80 }],
    [" 8080 ", { address: "", port: 8080 }],
    [":8080", { address: "", port: 8080 }],
    ["0.0.0.0:8080", { address: "0.0.0.0", port: 8080 }],
    ["[::]:8080", { address: "[::]", port: 8080 }],
    [":::8080", { address: "[::]", port: 8080 }],
    ["127.0.0.1:8080", { address: "127.0.0.1", port: 8080 }],
    ["127.0.0.1:80", { address: "127.0.0.1", port: 80 }],
    ["[::1]:8080", { address: "[::1]", port: 8080 }],
    ["::1:8080", { address: "[::1]", port: 8080 }],
    ["10.0.0.5:8443", { address: "10.0.0.5", port: 8443 }],
    ["[2001:db8::5]:8080", { address: "[2001:db8::5]", port: 8080 }],
    ["2001:db8::5:8080", { address: "[2001:db8::5]", port: 8080 }],
    ["eighty", null],
    ["10.0.0.5", null],
    ["10.0.0.5:", null],
  ])("ONEUPTIME_HTTP_PORT=%p is published at %p", (value, expected) => {
    expect(publishedIngressOf(value)).toEqual(expected);
  });
});

/*
 * What npm run doctor and backup.sh's report ask: where the ingress is
 * published, under localhost. By the address it is published on, the ingress
 * serves a status page's custom domain, which has none of the app's pages
 * (#10024).
 */
describe("where the install scripts ask OneUptime on this server", () => {
  test.each([
    [undefined, "http://localhost", "localhost"],
    ["", "http://localhost", "localhost"],
    ["80", "http://localhost", "localhost"],
    ["8080", "http://localhost:8080", "localhost:8080"],
    [":8080", "http://localhost:8080", "localhost:8080"],
    ["0.0.0.0:8080", "http://localhost:8080", "localhost:8080"],
    // Docker publishes :: on IPv6 alone: Node's localhost may be 127.0.0.1 alone.
    ["[::]:8080", "http://[::1]:8080", "localhost:8080"],
    [":::8080", "http://[::1]:8080", "localhost:8080"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080", "localhost:8080"],
    ["127.0.0.1:80", "http://127.0.0.1", "localhost"],
    ["[::1]:8080", "http://[::1]:8080", "localhost:8080"],
    ["::1:8080", "http://[::1]:8080", "localhost:8080"],
    ["[::1]:80", "http://[::1]", "localhost"],
    ["10.0.0.5:8443", "http://10.0.0.5:8443", "localhost:8443"],
    ["10.0.0.5:80", "http://10.0.0.5", "localhost"],
    ["[2001:db8::5]:8080", "http://[2001:db8::5]:8080", "localhost:8080"],
    ["2001:db8::5:8080", "http://[2001:db8::5]:8080", "localhost:8080"],
  ])(
    "ONEUPTIME_HTTP_PORT=%p: connect to %s, with Host: %s",
    (value, url, host) => {
      const request = ingressRequestOf(value);

      expect(request).toEqual({
        url: url,
        host: host,
        port: publishedIngressOf(value).port,
      });
      // A URL Node reads, at the port Compose publishes.
      expect(new URL(request.url).port || "80").toBe(String(request.port));
      // Never the address itself as the name.
      expect(new URL(`http://${request.host}`).hostname).toBe("localhost");
    },
  );

  test("a setting that is no port asks nothing", () => {
    expect(ingressRequestOf("eighty")).toBeNull();
  });

  test("the bundled probes keep their URL, which names the ingress and the place it is published at once", () => {
    // They cannot send a Host of their own: localhost for 127.0.0.1, which localhost names everywhere.
    expect(ingressUrlOf("127.0.0.1:8080").url).toBe("http://localhost:8080");
    expect(ingressRequestOf("127.0.0.1:8080").url).toBe(
      "http://127.0.0.1:8080",
    );
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

  /*
   * On the ingress's port, a URL moves too when it names an address the
   * ingress is not published on: with ONEUPTIME_HTTP_PORT=10.0.0.5:80 the
   * shipped http://localhost called nothing, and the probe showed
   * Disconnected. A name that reaches it there stays.
   */
  test.each([
    ["10.0.0.5:80", "http://localhost", "http://10.0.0.5"],
    ["10.0.0.5:80", "http://127.0.0.1", "http://10.0.0.5"],
    ["10.0.0.5:80", "http://[::1]", "http://10.0.0.5"],
    ["[::1]:80", "http://localhost", "http://[::1]"],
    ["[::1]:80", "http://127.0.0.1/", "http://[::1]"],
    ["10.0.0.5:8080", "http://localhost:8080", "http://10.0.0.5:8080"],
    ["[::]:8080", "http://localhost:8080", "http://[::1]:8080"],
    ["[::]:8080", "http://127.0.0.1:8080", "http://[::1]:8080"],
    ["0.0.0.0:8080", "http://[::1]:8080", "http://localhost:8080"],
    ["127.0.0.1:8080", "http://[::1]:8080", "http://localhost:8080"],
  ])(
    "with ONEUPTIME_HTTP_PORT=%s, %s, which does not reach it, moves to %s",
    (setting, value, url) => {
      expect(followedUrl(value, ingressUrlOf(setting))).toBe(url);
    },
  );

  test.each([
    ["8080", "http://localhost:8080"],
    ["8080", "http://127.0.0.1:8080"],
    ["8080", "http://[::1]:8080"],
    ["0.0.0.0:8080", "http://127.0.0.1:8080"],
    ["0.0.0.0:8080", "http://localhost:8080"],
    ["127.0.0.1:8080", "http://localhost:8080"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["[::]:8080", "http://[::1]:8080"],
    ["[::1]:8080", "http://[::1]:8080"],
    ["::1:8080", "http://[::1]:8080/"],
    ["10.0.0.5:8080", "http://10.0.0.5:8080"],
  ])(
    "with ONEUPTIME_HTTP_PORT=%s, %s, which reaches it, stays as it is",
    (setting, value) => {
      expect(followedUrl(value, ingressUrlOf(setting))).toBeNull();
    },
  );
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
   * Published on one address of the server, on the port the probes already
   * call: they moved only for another port, so http://localhost stayed, and
   * nothing listened there.
   */
  test.each([
    ["10.0.0.5:80", "http://10.0.0.5"],
    ["[::1]:80", "http://[::1]"],
    ["[::]:80", "http://[::1]"],
  ])(
    "an ingress moved onto %s, port 80 still, moves the two probes to %s, and a second run changes nothing",
    (setting, url) => {
      const before = withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", setting);
      const result = followIngressPort(before);
      const settings = readSettings(result.contents);

      expect(result.moved).toEqual([
        "GLOBAL_PROBE_1_ONEUPTIME_URL",
        "GLOBAL_PROBE_2_ONEUPTIME_URL",
      ]);
      for (const key of BUNDLED_URL_SETTINGS) {
        expect(settings.get(key)).toBe(url);
      }
      expect(followIngressPort(result.contents)).toEqual({
        contents: result.contents,
        moved: [],
        url: url,
      });
    },
  );

  test("an ingress moved from 8080 onto one address, port 8080 still, takes the probes along", () => {
    const moved = followIngressPort(
      withSetting(TEMPLATE, "ONEUPTIME_HTTP_PORT", "8080"),
    ).contents;
    const result = followIngressPort(
      withSetting(moved, "ONEUPTIME_HTTP_PORT", "10.0.0.5:8080"),
    );

    expect(readSettings(moved).get("GLOBAL_PROBE_1_ONEUPTIME_URL")).toBe(
      "http://localhost:8080",
    );
    for (const key of BUNDLED_URL_SETTINGS) {
      expect(readSettings(result.contents).get(key)).toBe(
        "http://10.0.0.5:8080",
      );
    }
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

  /*
   * Compose gets `export NAME=value` as NAME (WithConfig.sh): read as a
   * setting of that name, the port and the probe's URL both, and the export
   * kept on the line it moves.
   */
  test("an export before a name is read as WithConfig.sh hands it to Compose, and stays", () => {
    const before = [
      "export ONEUPTIME_HTTP_PORT=8080",
      "export GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost",
      "  export   GLOBAL_PROBE_2_ONEUPTIME_URL = http://localhost",
      "",
    ].join("\n");
    const result = followIngressPort(before);

    expect(result.moved).toEqual([
      "GLOBAL_PROBE_1_ONEUPTIME_URL",
      "GLOBAL_PROBE_2_ONEUPTIME_URL",
    ]);
    expect(result.contents.split("\n")).toEqual([
      "export ONEUPTIME_HTTP_PORT=8080",
      "export GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost:8080",
      "  export   GLOBAL_PROBE_2_ONEUPTIME_URL =http://localhost:8080",
      "",
    ]);
    expect(followIngressPort(result.contents).moved).toEqual([]);
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
