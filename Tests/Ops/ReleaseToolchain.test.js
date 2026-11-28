/*
 * The toolchain every release build of the Terraform provider and the
 * infrastructure agent uses (#11464): Go, GoReleaser and syft, pinned to
 * exact versions in .github/actions/setup-release-toolchain/versions.env,
 * which that action installs and checks, which each release's notes name,
 * and which Scripts/Release/ReleaseToolchain.js checks every week against the
 * newest releases.
 *
 * The builds are reproducible for a given toolchain: the provider's zips
 * (Scripts/TerraformProvider/Tests/GoReleaserConfig.test.ts) and the agent's
 * files (InfrastructureAgentReproducibleBuild.test.js) are the same bytes when
 * built twice. With `go-version: stable` and GoReleaser's `~> v2`, a version
 * built again weeks later got other tools, and with them other bytes.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  ISSUE_LABELS,
  ISSUE_TITLE,
  PINS_FILE,
  describeToolchain,
  fetchReleases,
  findOpenIssue,
  findStalePins,
  issueAction,
  keepIssue,
  main,
  parsePins,
  readPins,
  renderIssue,
} = require("../../Scripts/Release/ReleaseToolchain");
const MainNotes = require("../../Scripts/Release/GenerateReleaseNotes");
const ProviderNotes = require("../../Scripts/TerraformProvider/GenerateReleaseNotes");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ACTION = ".github/actions/setup-release-toolchain/action.yml";

/*
 * Text as a RegExp literal: every character a pattern reads as syntax,
 * backslashes included, as Common's escapeRegExp does: these plain
 * JavaScript tests cannot import it.
 */
function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// A file without its comment lines, which say what used to move.
function withoutComments(text) {
  return text.replace(/^[ \t]*#.*$/gm, "");
}

function workflow(file) {
  return yaml.load(read(`.github/workflows/${file}`));
}

const action = yaml.load(read(ACTION));
const actionStep = (id) => {
  return action.runs.steps.find((step) => {
    return step.id === id || step.name === id;
  });
};

const scratchDirs = [];
afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-toolchain-"));
  scratchDirs.push(dir);
  return dir;
}

/* ------------------------------------------------------------- the pins */

describe("versions.env", () => {
  test("pins Go, GoReleaser and syft to exact versions, and nothing to a range", () => {
    const pins = readPins();
    expect(pins.go).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pins.goreleaser).toMatch(/^v2\.\d+\.\d+$/);
    expect(pins.syft).toMatch(/^v1\.\d+\.\d+$/);
    expect(withoutComments(read(PINS_FILE))).not.toMatch(
      /stable|latest|~>|\^|\*/,
    );
  });

  test("reads NAME=value lines, the last of a name winning, a comment after the value", () => {
    expect(
      parsePins(
        [
          "# a comment",
          "GO_VERSION=1.26.1",
          "GO_VERSION=1.27.4 # the newest",
          "GORELEASER_VERSION=v2.20.3",
          "SYFT_VERSION=v1.57.2",
          "",
        ].join("\n"),
      ),
    ).toEqual({ go: "1.27.4", goreleaser: "v2.20.3", syft: "v1.57.2" });
  });

  test.each([
    ["GO_VERSION=stable", "GO_VERSION"],
    ["GO_VERSION=1.27", "GO_VERSION"],
    ["GO_VERSION=go1.27.4", "GO_VERSION"],
    ["GORELEASER_VERSION=~> v2", "GORELEASER_VERSION"],
    ["GORELEASER_VERSION=2.20.3", "GORELEASER_VERSION"],
    ["GORELEASER_VERSION=v3.0.0", "GORELEASER_VERSION"],
    ["SYFT_VERSION=latest", "SYFT_VERSION"],
  ])("refuses %s, which is not an exact version of its kind", (line, name) => {
    const text = read(PINS_FILE).replace(new RegExp(`^${name}=.*$`, "m"), line);
    expect(() => {
      return parsePins(text);
    }).toThrow(`${PINS_FILE} gives ${name}`);
  });

  test("refuses a pin that is missing", () => {
    expect(() => {
      return parsePins("GO_VERSION=1.27.4\nGORELEASER_VERSION=v2.20.3\n");
    }).toThrow('gives SYFT_VERSION ""');
  });
});

describe("describeToolchain: the toolchain as a release's notes name it", () => {
  test.each([
    [
      { go: "1.27.4", goreleaser: "v2.20.3" },
      "Go 1.27.4 and GoReleaser v2.20.3",
    ],
    [
      { go: "go1.27.4", goreleaser: "2.20.3" },
      "Go 1.27.4 and GoReleaser v2.20.3",
    ],
    [
      { go: "1.27.4", goreleaser: "v2.20.3", syft: "v1.57.2" },
      "Go 1.27.4, GoReleaser v2.20.3 and syft v1.57.2",
    ],
    [
      { go: "1.27.4", goreleaser: "v2.20.3", syft: "1.57.2" },
      "Go 1.27.4, GoReleaser v2.20.3 and syft v1.57.2",
    ],
  ])("%j is %j", (toolchain, described) => {
    expect(describeToolchain(toolchain)).toBe(described);
  });
});

/* ------------------------------------------------ the action, run for real */

/*
 * The action's own shell steps, run with bash as Actions runs them:
 * `shell: bash` is `bash --noprofile --norc -eo pipefail {0}`.
 */
function runStep(step, env, { path: extraPath } = {}) {
  const dir = scratch();
  const script = path.join(dir, "step.sh");
  fs.writeFileSync(script, step.run);
  const output = path.join(dir, "output");
  const githubEnv = path.join(dir, "env");
  fs.writeFileSync(output, "");
  fs.writeFileSync(githubEnv, "");
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-eo", "pipefail", script],
    {
      encoding: "utf8",
      env: {
        PATH: extraPath ? `${extraPath}:${process.env.PATH}` : process.env.PATH,
        GITHUB_OUTPUT: output,
        GITHUB_ENV: githubEnv,
        ...env,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    outputs: Object.fromEntries(
      fs
        .readFileSync(output, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          return line.split("=");
        }),
    ),
    env: fs.readFileSync(githubEnv, "utf8"),
  };
}

describe("setup-release-toolchain reads the pins", () => {
  const readStep = actionStep("pin");

  test("as ReleaseToolchain.js reads them, and makes Go use itself (GOTOOLCHAIN=local)", () => {
    const result = runStep(readStep, {
      PINS: path.join(REPO_ROOT, PINS_FILE),
    });
    const pins = readPins();

    expect(result.status).toBe(0);
    expect(result.outputs).toEqual({
      go: pins.go,
      goreleaser: pins.goreleaser,
      syft: pins.syft,
    });
    expect(result.env).toBe("GOTOOLCHAIN=local\n");
  });

  test.each([
    ["GO_VERSION=stable", "GO_VERSION 'stable'"],
    ["GORELEASER_VERSION=~> v2", "GORELEASER_VERSION '~>'"],
    ["SYFT_VERSION=", "SYFT_VERSION ''"],
  ])("and refuses %s, before anything is installed", (line, said) => {
    const name = line.split("=")[0];
    const pins = path.join(scratch(), "versions.env");
    fs.writeFileSync(
      pins,
      read(PINS_FILE).replace(new RegExp(`^${name}=.*$`, "m"), line),
    );

    const result = runStep(readStep, { PINS: pins });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`gives ${said}`);
    expect(result.stderr).toContain("a range would move");
    expect(result.outputs).toEqual({});
  });

  test("its inputs are the pins it read, and nothing else names a version", () => {
    const setupGo = action.runs.steps.find((step) => {
      return String(step.uses || "").startsWith("actions/setup-go@");
    });
    const goreleaser = action.runs.steps.find((step) => {
      return String(step.uses || "").startsWith(
        "goreleaser/goreleaser-action@",
      );
    });
    const syft = action.runs.steps.find((step) => {
      return String(step.uses || "").startsWith(
        "anchore/sbom-action/download-syft@",
      );
    });

    expect(setupGo.with).toEqual({
      "go-version": "${{ steps.pin.outputs.go }}",
      cache: false,
    });
    expect(goreleaser.with).toEqual({
      "install-only": true,
      version: "${{ steps.pin.outputs.goreleaser }}",
    });
    expect(syft.if).toBe("inputs.syft == 'true'");
    expect(syft.with).toEqual({
      "syft-version": "${{ steps.pin.outputs.syft }}",
    });
    // No version of its own anywhere in the action.
    expect(withoutComments(read(ACTION))).not.toMatch(
      /stable|~>|go-version-file/,
    );
  });
});

describe("setup-release-toolchain checks what is on PATH", () => {
  const checkStep = actionStep("Check the toolchain on PATH");
  const pins = readPins();

  // go, goreleaser and syft that say they are the versions given.
  function tools({ go, goreleaser, syft }) {
    const bin = path.join(scratch(), "bin");
    fs.mkdirSync(bin);
    const write = (name, text) => {
      fs.writeFileSync(path.join(bin, name), text, { mode: 0o755 });
    };
    write("go", `#!/bin/sh\n[ "$1 $2" = "env GOVERSION" ] && echo "go${go}"\n`);
    write(
      "goreleaser",
      `#!/bin/sh\necho "  ____ banner"\necho "GitVersion:    ${goreleaser}"\necho "GitCommit:     abc"\n`,
    );
    write(
      "syft",
      `#!/bin/sh\necho "Application:   syft"\necho "Version:       ${syft}"\n`,
    );
    return bin;
  }

  const check = (installed, withSyft) => {
    return runStep(
      checkStep,
      {
        GO_PIN: pins.go,
        GORELEASER_PIN: pins.goreleaser,
        SYFT_PIN: pins.syft,
        WITH_SYFT: withSyft ? "true" : "false",
      },
      { path: tools(installed) },
    );
  };
  const pinned = {
    go: pins.go,
    goreleaser: pins.goreleaser.slice(1),
    syft: pins.syft.slice(1),
  };

  test("passes when Go, GoReleaser and syft are the pinned ones", () => {
    const result = check(pinned, true);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Go: go${pins.go}`);
    expect(result.stdout).toContain(`GoReleaser: ${pinned.goreleaser}`);
    expect(result.stdout).toContain(`syft: ${pinned.syft}`);
  });

  test.each([
    ["Go", { go: "1.26.11" }, `Go go${pins.go} is pinned`],
    [
      "GoReleaser",
      { goreleaser: "2.19.0" },
      `GoReleaser ${pins.goreleaser.slice(1)} is pinned`,
    ],
    ["syft", { syft: "1.40.0" }, `syft ${pins.syft.slice(1)} is pinned`],
  ])("stops the job when %s is another", (_tool, other, said) => {
    const result = check({ ...pinned, ...other }, true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(said);
    expect(result.stderr).toContain(
      ".github/actions/setup-release-toolchain/versions.env",
    );
  });

  test("leaves syft alone when it was not asked for", () => {
    expect(check({ ...pinned, syft: "0.0.1" }, false).status).toBe(0);
  });
});

/* --------------------------------------------- every release build uses it */

const RELEASE_BUILDS = [
  ["release.yml", "publish-terraform-provider", false],
  ["release.yml", "infrastructure-agent-build", true],
  ["test-release.yaml", "publish-terraform-provider", false],
  ["test-release.yaml", "infrastructure-agent-deploy", true],
  ["terraform-provider-republish.yml", "republish-terraform-provider", false],
  // They build what the release builds: the provider twice, and to test it.
  ["terraform-provider-generation.yml", "generate-terraform-provider", false],
  ["terraform-provider-e2e.yml", "terraform-e2e-tests", false],
  ["test.infrastructure-agent.yaml", "reproducible-build", true],
];

describe("every release build installs the pinned toolchain, and no other", () => {
  test.each(RELEASE_BUILDS)("%s %s", (file, id, withSyft) => {
    const job = workflow(file).jobs[id];
    expect(job).toBeDefined();
    const steps = job.steps || [];
    const toolchain = steps.filter((step) => {
      return step.uses === "./.github/actions/setup-release-toolchain";
    });

    expect(toolchain).toHaveLength(1);
    expect(toolchain[0].with).toEqual(withSyft ? { syft: "true" } : undefined);
    // After the checkout that brings the action.
    expect(
      steps.findIndex((step) => {
        return String(step.uses || "").startsWith("actions/checkout@");
      }),
    ).toBeLessThan(steps.indexOf(toolchain[0]));

    for (const step of steps) {
      const uses = String(step.uses || "");
      expect({ step: step.name || uses, uses }).not.toEqual(
        expect.objectContaining({
          uses: expect.stringMatching(
            /^(actions\/setup-go|goreleaser\/goreleaser-action|anchore\/sbom-action\/download-syft)@/,
          ),
        }),
      );
      expect(String(step.run || "")).not.toMatch(/go install .*nfpm|@latest/);
    }
    const text = yaml.dump(job);
    expect(text).not.toMatch(/go-version: '?stable|~> v2/);
  });

  test("the agent's builds run GoReleaser right after it, as before", () => {
    for (const [file, id] of [
      ["release.yml", "infrastructure-agent-build"],
      ["test-release.yaml", "infrastructure-agent-deploy"],
    ]) {
      const steps = workflow(file).jobs[id].steps;
      const at = steps.findIndex((step) => {
        return step.uses === "./.github/actions/setup-release-toolchain";
      });
      expect(steps[at + 1].name).toBe("Run GoReleaser");
    }
  });
});

/* ---------------------------------------------- what is behind, and why */

describe("findStalePins", () => {
  const pins = { go: "1.27.4", goreleaser: "v2.20.3", syft: "v1.57.2" };
  const current = {
    go: ["1.27.4", "1.26.11"],
    goreleaser: ["v2.20.3", "v2.20.2", "v2.19.0"],
    syft: ["v1.57.2", "v1.57.1"],
  };

  test("nothing, when each pin is its newest release", () => {
    expect(findStalePins(pins, current)).toEqual([]);
  });

  test("Go, when its minor has a newer patch: the security fixes", () => {
    expect(
      findStalePins(pins, { ...current, go: ["1.27.5", "1.26.12"] }),
    ).toEqual([
      {
        name: "Go",
        variable: "GO_VERSION",
        pinned: "1.27.4",
        newest: "1.27.5",
        why: "Go 1.27.5 is the newest release of Go 1.27",
      },
    ]);
  });

  test("not Go, when a newer minor is out but the pinned one is supported and current", () => {
    expect(findStalePins({ ...pins, go: "1.26.11" }, current)).toEqual([]);
  });

  test("Go, when Go no longer supports the pinned minor: the newest of all", () => {
    expect(findStalePins({ ...pins, go: "1.25.9" }, current)).toEqual([
      expect.objectContaining({
        name: "Go",
        newest: "1.27.4",
        why: "Go 1.25 is no longer supported, and Go 1.27.4 is the newest release",
      }),
    ]);
  });

  test("GoReleaser and syft, behind their newest release of the same major", () => {
    expect(
      findStalePins(pins, {
        ...current,
        goreleaser: ["v2.21.0", ...current.goreleaser],
        syft: ["v1.58.0", ...current.syft],
      }),
    ).toEqual([
      expect.objectContaining({
        name: "GoReleaser",
        variable: "GORELEASER_VERSION",
        pinned: "v2.20.3",
        newest: "v2.21.0",
        why: "GoReleaser v2.21.0 is its newest v2 release",
      }),
      expect.objectContaining({
        name: "syft",
        variable: "SYFT_VERSION",
        newest: "v1.58.0",
      }),
    ]);
  });

  test("not a new major, which renames what the config says, and is a move of its own", () => {
    expect(
      findStalePins(pins, {
        ...current,
        goreleaser: ["v3.0.0", ...current.goreleaser],
        syft: ["v2.0.0", ...current.syft],
      }),
    ).toEqual([]);
  });

  test("not an older release, or a tag that is not a version", () => {
    expect(
      findStalePins(pins, {
        go: ["1.27.3", "weekly.2026-11-20"],
        goreleaser: ["nightly", "v2.1.0"],
        syft: ["v1.0.0"],
      }),
    ).toEqual([]);
  });
});

describe("fetchReleases", () => {
  function stubFetch(answers) {
    const asked = [];
    const fetchImpl = async (url, options) => {
      asked.push({ url, authorization: options.headers.Authorization });
      const body = answers[url];
      return {
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
        json: async () => {
          return body;
        },
      };
    };
    return { fetchImpl, asked };
  }

  test("reads Go's stable releases from go.dev, and each tool's published releases from GitHub", async () => {
    const { fetchImpl, asked } = stubFetch({
      "https://go.dev/dl/?mode=json": [
        { version: "go1.28rc1", stable: false },
        { version: "go1.27.4", stable: true },
        { version: "go1.26.11", stable: true },
      ],
      "https://api.github.com/repos/goreleaser/goreleaser/releases?per_page=100":
        [
          { tag_name: "v2.21.0-rc1", prerelease: true, draft: false },
          { tag_name: "v2.20.3", prerelease: false, draft: false },
          { tag_name: "v2.20.4", prerelease: false, draft: true },
        ],
      "https://api.github.com/repos/anchore/syft/releases?per_page=100": [
        { tag_name: "v1.57.2", prerelease: false, draft: false },
      ],
    });

    expect(await fetchReleases({ token: "t0ken", fetchImpl })).toEqual({
      go: ["1.27.4", "1.26.11"],
      goreleaser: ["v2.20.3"],
      syft: ["v1.57.2"],
    });
    // GitHub with the token, go.dev without it.
    expect(asked[0]).toEqual({
      url: "https://go.dev/dl/?mode=json",
      authorization: undefined,
    });
    expect(asked[1].authorization).toBe("Bearer t0ken");
  });

  test("fails when a release list cannot be read", async () => {
    const { fetchImpl } = stubFetch({});
    await expect(fetchReleases({ fetchImpl })).rejects.toThrow(
      "https://go.dev/dl/?mode=json answered 404",
    );
  });
});

/* --------------------------------------------------------------- the issue */

describe("the one issue that says a pin is behind", () => {
  const stale = [
    {
      name: "Go",
      variable: "GO_VERSION",
      pinned: "1.27.4",
      newest: "1.27.5",
      why: "Go 1.27.5 is the newest release of Go 1.27",
    },
  ];

  test.each([
    [null, stale, "create"],
    [7, stale, "update"],
    [7, [], "close"],
    [null, [], "none"],
  ])("open issue %s, %j behind: %s", (openIssue, behind, action) => {
    expect(issueAction(openIssue, behind)).toBe(action);
  });

  test("says what is behind, where it is pinned, and how to move it", () => {
    const body = renderIssue(
      stale,
      "https://github.com/OneUptime/oneuptime/actions/runs/1",
    );
    expect(body).toContain(
      "| Go (`GO_VERSION`) | 1.27.4 | 1.27.5 | Go 1.27.5 is the newest release of Go 1.27 |",
    );
    expect(body).toContain(PINS_FILE);
    expect(body).toContain("in a pull request of its own");
    expect(body).toContain(
      "[Release Toolchain Pins](https://github.com/OneUptime/oneuptime/actions/runs/1)",
    );
  });

  // A stand-in gh: its answers to `issue list`, and every call it got.
  function fakeGh(listed) {
    const calls = [];
    const gh = (args) => {
      calls.push(args);
      return args[1] === "list" ? JSON.stringify(listed) : "";
    };
    return { gh, calls };
  }

  test("finds only the issue with exactly its title", () => {
    expect(
      findOpenIssue(
        fakeGh([
          { number: 3, title: `${ISSUE_TITLE} (old)` },
          { number: 9, title: ISSUE_TITLE },
        ]).gh,
      ),
    ).toBe(9);
    expect(findOpenIssue(fakeGh([]).gh)).toBeNull();
  });

  test("opens it with the follow-up labels, rewrites it, and closes it once nothing is behind", () => {
    const opened = fakeGh([]);
    keepIssue({ stale, gh: opened.gh, bodyFile: "/tmp/body.md" });
    expect(opened.calls[1]).toEqual([
      "issue",
      "create",
      "--title",
      ISSUE_TITLE,
      "--body-file",
      "/tmp/body.md",
      ...ISSUE_LABELS.flatMap((label) => {
        return ["--label", label];
      }),
    ]);
    expect(ISSUE_LABELS).toEqual(["follow-up", "enhancement"]);

    const rewritten = fakeGh([{ number: 9, title: ISSUE_TITLE }]);
    keepIssue({ stale, gh: rewritten.gh, bodyFile: "/tmp/body.md" });
    expect(rewritten.calls[1]).toEqual([
      "issue",
      "edit",
      "9",
      "--body-file",
      "/tmp/body.md",
    ]);

    const closed = fakeGh([{ number: 9, title: ISSUE_TITLE }]);
    keepIssue({ stale: [], gh: closed.gh, bodyFile: "/tmp/body.md" });
    expect(closed.calls[1]).toEqual([
      "issue",
      "close",
      "9",
      "--comment",
      "Go, GoReleaser and syft are each at their newest release again.",
    ]);

    const none = fakeGh([]);
    keepIssue({ stale: [], gh: none.gh, bodyFile: "/tmp/body.md" });
    expect(none.calls).toHaveLength(1);
  });
});

/* --------------------------------------------------------- the command line */

describe("the command line", () => {
  function capture() {
    let text = "";
    return {
      stream: {
        write: (chunk) => {
          text += chunk;
        },
      },
      text: () => {
        return text;
      },
    };
  }

  test("describe names the pinned toolchain, syft when asked", async () => {
    const pins = readPins();
    const out = capture();
    expect(await main(["describe"], { out: out.stream })).toBe(0);
    expect(out.text()).toBe(
      `Go ${pins.go} and GoReleaser ${pins.goreleaser}\n`,
    );

    const withSyft = capture();
    expect(
      await main(["describe", "--with-syft"], { out: withSyft.stream }),
    ).toBe(0);
    expect(withSyft.text()).toBe(
      `Go ${pins.go}, GoReleaser ${pins.goreleaser} and syft ${pins.syft}\n`,
    );
  });

  test("check says what is behind, and keeps the issue only with --keep-issue", async () => {
    const pins = readPins();
    const fetchImpl = async (url) => {
      const answers = {
        "https://go.dev/dl/?mode=json": [
          {
            version: `go${pins.go.replace(/\d+$/, (patch) => {
              return String(Number(patch) + 1);
            })}`,
            stable: true,
          },
        ],
      };
      return {
        ok: true,
        json: async () => {
          return (
            answers[url] || [
              { tag_name: pins.goreleaser },
              { tag_name: pins.syft },
            ]
          );
        },
      };
    };
    const calls = [];
    const gh = (args) => {
      calls.push(args);
      return args[1] === "list" ? "[]" : "";
    };

    const out = capture();
    expect(
      await main(["check"], { out: out.stream, fetchImpl, gh, env: {} }),
    ).toBe(0);
    expect(out.text()).toMatch(
      new RegExp(`^Go: ${escapeRegExp(pins.go)} -> `),
    );
    expect(calls).toEqual([]);

    const kept = capture();
    expect(
      await main(["check", "--keep-issue"], {
        out: kept.stream,
        fetchImpl,
        gh,
        env: {
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "OneUptime/oneuptime",
          GITHUB_RUN_ID: "77",
        },
      }),
    ).toBe(0);
    expect(kept.text()).toContain("Opened the issue.");
    expect(calls[1].slice(0, 4)).toEqual([
      "issue",
      "create",
      "--title",
      ISSUE_TITLE,
    ]);
    const body = fs.readFileSync(calls[1][5], "utf8");
    expect(body).toContain(
      "https://github.com/OneUptime/oneuptime/actions/runs/77",
    );
  });

  test("anything else is a usage error", async () => {
    const err = capture();
    expect(await main(["bump"], { err: err.stream })).toBe(2);
    expect(err.text()).toContain("Usage:");
  });
});

/* ------------------------------------------------------- the weekly check */

describe("the Release Toolchain Pins workflow", () => {
  const pinsWorkflow = workflow("release-toolchain-pins.yml");
  const job = pinsWorkflow.jobs["check-pins"];
  const check = job.steps.find((step) => {
    return /ReleaseToolchain\.js check/.test(step.run || "");
  });

  test("runs every week and by hand, in OneUptime's repository only", () => {
    expect(pinsWorkflow.on.schedule).toHaveLength(1);
    expect(pinsWorkflow.on.workflow_dispatch).toBeDefined();
    expect(pinsWorkflow.on.pull_request).toBeUndefined();
    expect(job.if).toBe("${{ github.repository == 'OneUptime/oneuptime' }}");
  });

  test("may write issues and read the code, and nothing more", () => {
    expect(pinsWorkflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toEqual({ contents: "read", issues: "write" });
  });

  test("keeps the issue only from main, with the run's token", () => {
    expect(check.run).toBe(
      "node Scripts/Release/ReleaseToolchain.js check ${KEEP_ISSUE}",
    );
    expect(check.env).toEqual({
      GH_TOKEN: "${{ github.token }}",
      GH_REPO: "${{ github.repository }}",
      KEEP_ISSUE:
        "${{ github.ref == 'refs/heads/main' && '--keep-issue' || '' }}",
    });
  });

  test("checks out what the script reads, and installs nothing", () => {
    const checkout = job.steps.find((step) => {
      return String(step.uses || "").startsWith("actions/checkout@");
    });
    const folders = checkout.with["sparse-checkout"].trim().split("\n");
    expect(folders).toEqual([
      ".github/actions/setup-release-toolchain",
      "Scripts/Release",
    ]);
    for (const step of job.steps) {
      expect(String(step.run || "")).not.toMatch(/npm (ci|install)/);
    }
    // Plain Node.js: it requires nothing outside Node itself.
    expect(read("Scripts/Release/ReleaseToolchain.js")).not.toMatch(
      /require\("\.\.?\//,
    );
  });
});

/* --------------------------------------------------- the release notes */

describe("each release's notes name the toolchain", () => {
  const toolchain = "Go 1.27.4, GoReleaser v2.20.3 and syft v1.57.2";

  test("OneUptime's: the infrastructure agent's, after the changelog", () => {
    const notes = MainNotes.renderNotes({
      version: "18.1.0",
      previous: "18.0.0",
      repository: "OneUptime/oneuptime",
      entries: [],
      contributors: [],
      toolchain,
    });
    expect(notes).toContain(
      `**Built with:** ${toolchain}. The infrastructure agent's archives, packages and SBOMs, built from this tag with them, are the same bytes.`,
    );
    expect(notes.indexOf("**Built with:**")).toBeGreaterThan(
      notes.indexOf("**Full changelog:**"),
    );
  });

  test("OneUptime's, when GitHub could not be read and the notes fall back", () => {
    expect(
      MainNotes.renderFallbackNotes({
        version: "18.1.0",
        previous: "18.0.0",
        repository: "OneUptime/oneuptime",
        toolchain,
      }),
    ).toContain(`**Built with:** ${toolchain}.`);
  });

  test("not when it is not known", () => {
    for (const notes of [
      MainNotes.renderNotes({
        version: "18.1.0",
        previous: "18.0.0",
        repository: "OneUptime/oneuptime",
        entries: [],
        contributors: [],
      }),
      MainNotes.renderFallbackNotes({
        version: "18.1.0",
        previous: "18.0.0",
        repository: "OneUptime/oneuptime",
      }),
    ]) {
      expect(notes).not.toContain("Built with");
      expect(notes).not.toMatch(/\n\n\n/);
    }
  });

  test("the Terraform provider's, and those of a version published again", () => {
    const provider = "Go 1.27.4 and GoReleaser v2.20.3";
    expect(
      ProviderNotes.renderReleaseNotes({
        version: "18.1.0",
        previous: "v18.0.0",
        comparison: null,
        oneUptime: null,
        toolchain: provider,
      }),
    ).toContain(
      `**Built with:** ${provider}. The zips, built from this tag with them, are the same bytes.`,
    );
    expect(
      ProviderNotes.renderRepublishNotes({
        version: "17.2.1",
        republishOf: "v17.2.0",
        toolchain: provider,
      }),
    ).toContain(`**Built with:** ${provider}.`);
    expect(
      ProviderNotes.parseArguments([
        "--version",
        "18.1.0",
        "--provider-dir",
        "/x",
        "--toolchain",
        provider,
      ]).toolchain,
    ).toBe(provider);
    expect(
      ProviderNotes.parseArguments([
        "--version",
        "18.1.0",
        "--provider-dir",
        "/x",
        "--toolchain",
        "",
      ]).toolchain,
    ).toBeNull();
  });
});
