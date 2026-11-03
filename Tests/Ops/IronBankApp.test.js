"use strict";

/**
 * The App's Iron Bank project (IronBank/App) ships the image the release ships,
 * on Iron Bank's base image.
 *
 * Iron Bank builds IronBank/App/Dockerfile in its own pipeline, offline, and the
 * Dockerfile copies /usr/src out of the release's Community Edition image
 * (IronBank/README.md). A COPY --from brings files and nothing else, so the
 * Dockerfile sets again everything the release's runtime and community stages
 * set. Nothing would notice a start command, a user, an environment variable or
 * a package the App's Dockerfile changed and the Iron Bank one kept, until a
 * DoD installation ran it. So this holds IronBank/App to
 * packages/App/Dockerfile.tpl as `npm run prerun` renders it for production:
 *
 *   - the community stage's start command, user, working directory, ports and
 *     environment (with the runtime stage it starts from), the runtime
 *     stage's commands (bash, curl, npm's cache directory) and what the
 *     community stage copies;
 *   - every label of the release, from the manifest or the Dockerfile;
 *   - one release everywhere: the manifest's first tag, version label and
 *     resource, the release stage, APP_VERSION, GIT_SHA and the revision
 *     label, which Scripts/IronBank/PinRelease.js moves together (and finds
 *     each of exactly once);
 *   - Iron Bank's rules for a Dockerfile: the base image from the three ARGs
 *     the manifest's args fill, nothing from the network but Alpine packages,
 *     no ADD, a user that is not root, an absolute WORKDIR;
 *   - the manifest's labels within what Iron Bank's schema allows, the LICENSE
 *     the repository's, Renovate's patterns matching the base tag in both files,
 *     and IronBank/Justifications/App.yaml readable by NewFindings.js;
 *   - every file Repo1 gets tracked by git and not ignored: the repository's
 *     rule that ignores rendered Dockerfiles once kept this one out.
 *
 * Iron Bank's schema, its FIXME check and its semgrep rules run in the Iron
 * Bank Preflight workflow (Scripts/IronBank/lint.sh), as Repo1 serves them
 * that day, and the workflow builds, boots and scans the image.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const {
  render,
  parseStages,
  instructions,
} = require("./Utils/DockerfileTemplate");
const { FILES, pin } = require("../../Scripts/IronBank/PinRelease");
const { readJustifications } = require("../../Scripts/IronBank/NewFindings");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PROJECT = "IronBank/App";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/*
 * git, which says what a clone of the repository holds; failing loudly when it
 * cannot run, rather than passing on nothing.
 */
function git(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.error) {
    throw new Error(`Could not run git ${args.join(" ")}: ${result.error}`);
  }
  return result;
}

/*
 * `git check-ignore` exits 0 for an ignored path and 1 for one that is not,
 * including one a later negation rescues.
 */
function isGitIgnored(relativePath) {
  const result = git(["check-ignore", "--quiet", "--no-index", relativePath]);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${relativePath}`);
  }
  return result.status === 0;
}

const dockerfileText = read(`${PROJECT}/Dockerfile`);
const manifestText = read(`${PROJECT}/hardening_manifest.yaml`);
const manifest = yaml.load(manifestText);
const stages = parseStages(dockerfileText);
const finalStage = stages[stages.length - 1];
const releaseStage = stages.find((stage) => {
  return stage.name === "release";
});
const finalInstructions = instructions(finalStage.body);

const appStages = parseStages(
  render(read("packages/App/Dockerfile.tpl"), "production"),
);
const runtimeStage = appStages.find((stage) => {
  return stage.name === "runtime";
});
const communityStage = appStages.find((stage) => {
  return stage.name === "community";
});
// What the community image is: the runtime stage, then the community stage.
const communityInstructions = [
  ...instructions(runtimeStage.body),
  ...instructions(communityStage.body),
];

const VERSION = manifest.labels["org.opencontainers.image.version"];

/*
 * `ENV KEY=value` / `LABEL key="value"` instructions as an object, one pair
 * per instruction (both Dockerfiles write them so).
 */
function pairs(lines, keyword) {
  const values = {};
  for (const line of lines) {
    if (!line.startsWith(`${keyword} `)) {
      continue;
    }
    const match = new RegExp(`^${keyword} ([^=\\s]+)=("[^"]*"|\\S+)$`).exec(
      line,
    );
    if (!match) {
      throw new Error(`Not one ${keyword} pair: ${line}`);
    }
    values[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return values;
}

function last(lines, keyword) {
  const found = lines.filter((line) => {
    return line.startsWith(`${keyword} `);
  });
  return found.length > 0 ? found[found.length - 1] : null;
}

function all(lines, keyword) {
  return lines.filter((line) => {
    return line.startsWith(`${keyword} `);
  });
}

/*
 * The commands of a stage's RUN instructions, split at &&.
 */
function commands(lines) {
  return all(lines, "RUN").flatMap((line) => {
    return line
      .slice("RUN ".length)
      .split(" && ")
      .map((command) => {
        return command.trim();
      });
  });
}

/*
 * The ARGs before the first FROM, which only the FROM lines can read.
 */
function globalArgs(text) {
  const args = {};
  for (const line of text.split("\n")) {
    if (/^\s*FROM\s/i.test(line)) {
      break;
    }
    const match = /^ARG (\w+)=(\S+)$/.exec(line.trim());
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

function copiesFrom(lines) {
  return all(lines, "COPY")
    .filter((line) => {
      return /--from=/.test(line);
    })
    .map((line) => {
      return line.replace(/^COPY (--\S+ )*--from=\S+ /, "");
    });
}

describe("IronBank/App runs the image the release runs", () => {
  test("reads both Dockerfiles' stages (the checks below are not vacuous)", () => {
    expect(
      stages.map((stage) => {
        return stage.name;
      }),
    ).toEqual(["release", null]);
    expect(runtimeStage).toBeDefined();
    expect(communityStage).toBeDefined();
    expect(communityStage.from).toBe("runtime");
    expect(communityInstructions.length).toBeGreaterThan(10);
  });

  test("the same start command, user, working directory and ports", () => {
    for (const keyword of ["CMD", "USER", "WORKDIR"]) {
      expect({ keyword, ironBank: last(finalInstructions, keyword) }).toEqual({
        keyword,
        ironBank: last(communityInstructions, keyword),
      });
    }
    expect(all(finalInstructions, "EXPOSE")).toEqual(
      all(communityInstructions, "EXPOSE"),
    );
  });

  test("the same environment, with the release's version and commit for its build arguments", () => {
    const expected = pairs(communityInstructions, "ENV");
    const environment = pairs(finalInstructions, "ENV");

    // Read from the release's image by PinRelease.js.
    expect(expected["APP_VERSION"]).toBe("${APP_VERSION}");
    expect(expected["GIT_SHA"]).toBe("${GIT_SHA}");
    expect(environment["APP_VERSION"]).toBe(VERSION);
    expect(environment["GIT_SHA"]).toMatch(/^[0-9a-f]{40}$/);

    expect(environment).toEqual({
      ...expected,
      APP_VERSION: VERSION,
      GIT_SHA: environment["GIT_SHA"],
    });
  });

  test("every label of the release, from the manifest or the Dockerfile", () => {
    const expected = pairs(communityInstructions, "LABEL");
    const labels = { ...manifest.labels, ...pairs(finalInstructions, "LABEL") };
    const gitSha = pairs(finalInstructions, "ENV")["GIT_SHA"];

    const wanted = Object.fromEntries(
      Object.entries(expected).map(([key, value]) => {
        const resolved = value
          .replace("${APP_VERSION}", VERSION)
          .replace("${GIT_SHA}", gitSha)
          // Iron Bank's schema allows printable ASCII only.
          .replace(" — ", ": ");
        return [key, resolved];
      }),
    );
    expect(Object.keys(wanted)).toEqual(
      expect.arrayContaining([
        "org.opencontainers.image.revision",
        "com.oneuptime.edition",
      ]),
    );
    for (const [key, value] of Object.entries(wanted)) {
      expect({ label: key, value: labels[key] }).toEqual({ label: key, value });
    }
  });

  test("the runtime stage's commands, except updating npm, which Iron Bank's base image brings", () => {
    const runtime = commands(instructions(runtimeStage.body)).filter(
      (command) => {
        return !command.includes("UpdateNpmCli");
      },
    );

    expect(runtime).toEqual(
      expect.arrayContaining(["apk add --no-cache bash curl"]),
    );
    expect(commands(finalInstructions)).toEqual(
      expect.arrayContaining(runtime),
    );
  });

  test("/usr/src out of the release, as the community stage copies it out of its build", () => {
    expect(copiesFrom(instructions(communityStage.body))).toEqual([
      "/usr/src /usr/src",
    ]);
    expect(all(finalInstructions, "COPY")).toEqual([
      "COPY --from=release /usr/src /usr/src",
    ]);
  });
});

describe("IronBank/App pins one release everywhere", () => {
  const gitSha = pairs(finalInstructions, "ENV")["GIT_SHA"];
  const resource = (manifest.resources || [])[0] || {};
  const digest = String(resource.url).split("@")[1];

  test("the manifest's first tag and resource, and the release stage, are its version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.tags[0]).toBe(VERSION);
    expect(manifest.resources).toEqual([
      {
        tag: `oneuptime/app:${VERSION}`,
        url: `docker://docker.io/oneuptime/app@${digest}`,
      },
    ]);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(releaseStage.from).toBe(`oneuptime/app:${VERSION}`);
    expect(pairs(finalInstructions, "LABEL")).toEqual(
      expect.objectContaining({
        "org.opencontainers.image.revision": gitSha,
      }),
    );
  });

  test("PinRelease.js finds each value once, and pinning to the same release changes nothing", () => {
    const files = { manifest: manifestText, dockerfile: dockerfileText };

    expect(pin(files, { version: VERSION, digest, gitSha })).toEqual(files);
  });

  test("PinRelease.js moves all of them to another release", () => {
    const next = {
      version: "99.1.2",
      digest: `sha256:${"a".repeat(64)}`,
      gitSha: "b".repeat(40),
    };
    const pinned = pin(
      { manifest: manifestText, dockerfile: dockerfileText },
      next,
    );
    const moved = yaml.load(pinned.manifest);
    const movedInstructions = instructions(
      parseStages(pinned.dockerfile).pop().body,
    );

    expect(Object.keys(FILES)).toEqual(["manifest", "dockerfile"]);
    expect(moved.tags[0]).toBe("99.1.2");
    expect(moved.labels["org.opencontainers.image.version"]).toBe("99.1.2");
    expect(moved.resources).toEqual([
      {
        tag: "oneuptime/app:99.1.2",
        url: `docker://docker.io/oneuptime/app@${next.digest}`,
      },
    ]);
    expect(parseStages(pinned.dockerfile)[0].from).toBe("oneuptime/app:99.1.2");
    expect(pairs(movedInstructions, "ENV")).toEqual(
      expect.objectContaining({
        APP_VERSION: "99.1.2",
        GIT_SHA: next.gitSha,
      }),
    );
    expect(pairs(movedInstructions, "LABEL")).toEqual(
      expect.objectContaining({
        "org.opencontainers.image.revision": next.gitSha,
      }),
    );
    // Nothing else changed: the old release is gone from both files.
    expect(pinned.manifest).not.toContain(VERSION);
    expect(pinned.dockerfile).not.toContain(VERSION);
    expect(pinned.dockerfile).not.toContain(gitSha);
  });
});

describe("IronBank/App/Dockerfile follows Iron Bank's rules", () => {
  const args = globalArgs(dockerfileText);

  test("its base image is the one the manifest's args name, under registry1's ironbank/ project", () => {
    expect(args).toEqual({
      BASE_REGISTRY: "registry1.dso.mil",
      BASE_IMAGE: `ironbank/${manifest.args.BASE_IMAGE}`,
      BASE_TAG: manifest.args.BASE_TAG,
    });
    expect(finalStage.from).toBe("${base_registry}/${base_image}:${base_tag}");
  });

  test("it fetches nothing but Alpine packages, which Iron Bank's build reaches through a proxy", () => {
    const allowed = [
      /^apk (upgrade|add) --no-cache( [a-z0-9][a-z0-9.+_-]*)*$/,
      /^mkdir \/\S+$/,
      /^chmod \d+ \/\S+$/,
      /^chown \d+:\d+ \/\S+$/,
      /^npm config set [a-z-]+ \S+ --global$/,
    ];
    const offenders = commands(finalInstructions).filter((command) => {
      return !allowed.some((pattern) => {
        return pattern.test(command);
      });
    });

    expect(offenders).toEqual([]);
    expect(all(finalInstructions, "ADD")).toEqual([]);
    expect(all(instructions(releaseStage.body), "RUN")).toEqual([]);
  });

  test("it runs as a user that is not root, from an absolute WORKDIR", () => {
    expect(last(finalInstructions, "USER")).toBe("USER node");
    for (const workdir of all(finalInstructions, "WORKDIR")) {
      expect(workdir).toMatch(/^WORKDIR \//);
    }
  });
});

describe("IronBank/App's other files", () => {
  // hardening_manifest.schema.json's labels, which allows no others.
  const SCHEMA_LABELS = [
    "mil.dso.ironbank.image.keywords",
    "mil.dso.ironbank.image.type",
    "mil.dso.ironbank.product.name",
    "org.opencontainers.image.description",
    "org.opencontainers.image.licenses",
    "org.opencontainers.image.title",
    "org.opencontainers.image.url",
    "org.opencontainers.image.vendor",
    "org.opencontainers.image.version",
  ];

  test("the manifest's labels are ones Iron Bank's schema allows, in printable ASCII", () => {
    expect(
      Object.keys(manifest.labels).filter((label) => {
        return !SCHEMA_LABELS.includes(label);
      }),
    ).toEqual([]);
    for (const [label, value] of Object.entries(manifest.labels)) {
      expect({ label, printable: /^(?!\s*$)[ -~]*$/.test(value) }).toEqual({
        label,
        printable: true,
      });
    }
    expect(["opensource", "commercial"]).toContain(
      manifest.labels["mil.dso.ironbank.image.type"],
    );
  });

  test("the manifest is v1, names its maintainers, and tags the release first", () => {
    expect(manifest.apiVersion).toBe("v1");
    expect(manifest.name).toBe("oneuptime/app");
    expect(new Set(manifest.tags).size).toBe(manifest.tags.length);
    expect(manifest.tags.length).toBeLessThanOrEqual(10);
    expect(manifest.maintainers.length).toBeGreaterThan(0);
    for (const maintainer of manifest.maintainers) {
      expect(typeof maintainer.name).toBe("string");
      expect(typeof maintainer.username).toBe("string");
    }
  });

  test("LICENSE is the repository's", () => {
    expect(read(`${PROJECT}/LICENSE`)).toBe(read("LICENSE"));
  });

  test("every file Repo1 gets is in git: none is ignored, and each is tracked", () => {
    // The repo-wide **/Dockerfile rule, for the Dockerfiles configure.sh
    // renders, swallowed this project's: it merged without its Dockerfile.
    const files = [
      "Dockerfile",
      "hardening_manifest.yaml",
      "LICENSE",
      "README.md",
      "renovate.json",
    ];
    const tracked = git(["ls-files", "--", PROJECT]).stdout.split("\n");

    for (const file of files) {
      expect({
        file,
        ignored: isGitIgnored(`${PROJECT}/${file}`),
        tracked: tracked.includes(`${PROJECT}/${file}`),
      }).toEqual({ file, ignored: false, tracked: true });
    }
    // The negation that rescues it must not have widened to those.
    expect(isGitIgnored("packages/App/Dockerfile")).toBe(true);
  });

  test("README.md says what the image is", () => {
    expect(read(`${PROJECT}/README.md`)).toContain("# OneUptime App");
  });

  test("Renovate moves BASE_TAG in both files, and nothing else", () => {
    const renovate = JSON.parse(read(`${PROJECT}/renovate.json`));
    const [manager] = renovate.regexManagers;

    // Renovate's own Dockerfile manager would move the release stage's FROM
    // without APP_VERSION and GIT_SHA: PinRelease.js moves the release.
    expect(renovate.enabledManagers).toEqual(["regex"]);
    expect(renovate.regexManagers).toHaveLength(1);
    expect(manager.depNameTemplate).toBe(
      `registry1.dso.mil/ironbank/${manifest.args.BASE_IMAGE}`,
    );
    expect(manager.datasourceTemplate).toBe("docker");

    for (const [file, text] of [
      ["hardening_manifest.yaml", manifestText],
      ["Dockerfile", dockerfileText],
    ]) {
      expect(
        manager.fileMatch.some((pattern) => {
          return new RegExp(pattern).test(file);
        }),
      ).toBe(true);
      const found = manager.matchStrings
        .map((pattern) => {
          return [...text.matchAll(new RegExp(pattern, "g"))].map((match) => {
            return match.groups.currentValue;
          });
        })
        .flat();
      expect({ file, found }).toEqual({
        file,
        found: [manifest.args.BASE_TAG],
      });
    }
  });

  test("IronBank/Justifications/App.yaml is a list NewFindings.js reads", () => {
    const entries = yaml.load(read("IronBank/Justifications/App.yaml"));

    expect(Array.isArray(entries)).toBe(true);
    expect(() => {
      return readJustifications(entries);
    }).not.toThrow();
  });
});
