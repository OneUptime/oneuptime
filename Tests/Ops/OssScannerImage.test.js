"use strict";

/**
 * .oss-scanner/: OneUptime's enrolment in Anthropic's OSS Scanner.
 *
 * The scanner clones the default branch, builds .oss-scanner/Dockerfile with
 * network access, and studies the finished image with none, guided by
 * .oss-scanner/threat_model.md. Nothing else in the repository runs these
 * files, so nothing else notices when they drift from it, and the scanner
 * only notices by failing a build (an email to security@) or, worse, by
 * building an image that quietly lacks part of the code. These tests hold
 * them to the repository:
 *
 *   - every project with a package.json or go.mod is installed and built
 *     there, or listed as not built with a reason;
 *   - the base images and versions are the ones the repository runs (Node
 *     and Debian, ClickHouse, Postgres, Go), each pinned by digest;
 *   - the files are committed: the repo-wide "**\/Dockerfile" ignore rule
 *     once swallowed a hand-written Dockerfile (ExampleDockerfiles.test.ts);
 *   - the build context keeps every tracked file, and the build stops if a
 *     builder hands it the root .dockerignore's context instead;
 *   - the settings the image's config.env, its scripts, CI and the Probe
 *     image share agree;
 *   - the threat model names every compose service, the boundaries and the
 *     entry points, and every path it cites exists;
 *   - project.yaml passes the enrolment rules of the scanner's
 *     tools/validate.py.
 *
 * They read files and git's index. The only processes they start are git,
 * bash (the scripts' syntax, and run-in-parallel.sh and start-services.sh
 * run for real in a scratch copy) and, when installed, shellcheck.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SCANNER_DIRECTORY = ".oss-scanner";
const DOCKERFILE = ".oss-scanner/Dockerfile";
const DOCKERIGNORE = ".oss-scanner/Dockerfile.dockerignore";
const THREAT_MODEL = ".oss-scanner/threat_model.md";
const PROJECT_YAML = ".oss-scanner/project.yaml";
const README = ".oss-scanner/README.md";
const RUN_IN_PARALLEL = ".oss-scanner/run-in-parallel.sh";
const START_SERVICES = ".oss-scanner/start-services.sh";
const START_APP = ".oss-scanner/start-app.sh";

const SCANNER_FILES = [
  DOCKERFILE,
  DOCKERIGNORE,
  THREAT_MODEL,
  PROJECT_YAML,
  README,
  RUN_IN_PARALLEL,
  START_SERVICES,
  START_APP,
];
const SCRIPTS = [RUN_IN_PARALLEL, START_SERVICES, START_APP];

const PROBE_TEMPLATE = "packages/Probe/Dockerfile.tpl";
const APP_TEMPLATE = "packages/App/Dockerfile.tpl";
const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.base.yml"];
const DEV_COMPOSE = "Scripts/Dev/docker-compose.dev.yml";
const TEST_SETUP = "packages/Common/test-setup.sh";
const CONFIG_TEMPLATE = "config.example.env";
const SECURITY_POLICY = ".github/SECURITY.md";

const NODE_REGISTRY = "public.ecr.aws/docker/library/node";
const PINNED_IMAGE =
  /^(?<name>[^@\s]+):(?<tag>[^:@\s/]+)@sha256:(?<digest>[0-9a-f]{64})$/;
const FROM_LINE =
  /^FROM\s+(?:--\S+\s+)*(?<image>\S+)(?:\s+AS\s+(?<stage>\S+))?$/i;
const HEREDOC_MARKER = /<<(-?)(["']?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
const COMMENT_OR_BLANK = /^\s*(#|$)/;
const COMMENT_LINE = /^\s*#/;
const NOT_BUILT_LINE = /^# not built: (?<directory>\S+) - (?<reason>.+)$/;
const NODE_MAJOR_IN_FROM =
  /^FROM\s+(?:--\S+\s+)*\S*\/node:(?<major>\d+)[-.]/gim;
const NODE_TAG = /^(?<major>\d+)-(?<codename>[a-z]+)(?:-slim)?$/;
const GO_TAG = /^(?<version>\d+\.\d+(?:\.\d+)?)-(?<codename>[a-z]+)$/;
const GO_DIRECTIVE = /^go (?<version>\d+\.\d+(?:\.\d+)?)\s*$/m;
const ENGINES_MAJOR = /(?<major>\d+)/;
const CONFIG_KEY = /^(?<key>[A-Z][A-Z0-9_]*)=/gm;
const ENV_READ =
  /process\.env(?:\["(?<bracket>[A-Z0-9_]+)"\]|\.(?<dot>[A-Z0-9_]+))/g;
const CONTEXT_PATH =
  /(?:^|\s)((?:\.oss-scanner|Scripts|packages|Clickhouse|agents)\/[A-Za-z0-9_./*-]+)/g;
const ECHOED_SETTING = /echo "(?<key>[A-Z][A-Z0-9_]*)=(?<value>[^"]*)"/g;
const FRONTEND_RUN = /frontend-run\.sh (?<directory>FeatureSet\/\S+) build$/;
const NPM_RUN_SCRIPT = /^npm run (?<script>\S+)$/;
const USR_SRC_LITERAL = /["'`]\/usr\/src\/(?<name>[A-Za-z]+)/g;
const USR_SRC_LINK = /ln -s (?<target>\S+) \/usr\/src\/(?<name>[A-Za-z]+)/g;
const BACKTICKED = /`(?<value>[^`\n]+)`/g;
const MARKDOWN_LINK = /\]\((?<target>[^)\s]+)\)/g;
const REPOSITORY_PATH =
  /^(?:\.oss-scanner|\.github|packages|ee|agents|Scripts|Tests|HelmChart|Clickhouse|Examples|Docs)\/[A-Za-z0-9_.*/-]*$/;
const ROOT_FILE =
  /^(?:docker-compose(?:\.base)?\.yml|config\.example\.env|AGENTS\.md|package\.json)$/;
const EMAIL = /[^@\s]+@[^@\s]+\.[^@\s]+/;
// tools/validate.py in anthropics/oss-scanner, as of the enrolment.
const VALIDATE_URL = /^https:\/\/[^\s#]+(#[A-Za-z0-9._/-]{1,100})?$/;
const VALIDATE_REPO_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const VALIDATE_REQUIRED_KEYS = ["repo", "primary_contact"];
const VALIDATE_OPTIONAL_KEYS = [
  "auto_ccs",
  "homepage",
  "pgp",
  "disabled",
  "dockerfile",
  "threat_model",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

/*
 * git is how these tests know what the scanner's clone contains. Without it
 * there is nothing left to check, so a missing git fails loudly instead of
 * passing.
 */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `Could not run \`git ${args.join(" ")}\` in ${REPO_ROOT}: these tests read git's index, so they need a git checkout. ${String(error)}`,
    );
  }
}

const TRACKED_FILES = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const TRACKED = new Set(TRACKED_FILES);

/*
 * `git check-ignore` exits 0 for an ignored path and 1 for a path that is
 * not, including one a later negation rescues.
 */
function isGitIgnored(relativePath) {
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", relativePath],
    { cwd: REPO_ROOT },
  );

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `git check-ignore failed for ${relativePath} (exit ${result.status})`,
    );
  }

  return result.status === 0;
}

/**
 * A Dockerfile's instructions as Docker reads them: comment lines dropped,
 * backslash continuations joined, and each heredoc's body (RUN cmd <<'EOF'
 * ... EOF) kept apart line by line instead of being read as instructions.
 * @param {string} text
 * @returns {Array<{keyword: string, text: string, heredocs: Array<{delimiter: string, lines: Array<string>}>, line: number}>}
 */
function parseDockerfile(text) {
  const lines = text.split("\n");
  const parsed = [];
  let index = 0;

  while (index < lines.length) {
    if (COMMENT_OR_BLANK.test(lines[index])) {
      index++;
      continue;
    }

    const firstLine = index + 1;
    let logical = "";

    while (index < lines.length) {
      const current = lines[index];
      index++;

      if (logical && COMMENT_LINE.test(current)) {
        continue;
      }

      const trimmed = current.replace(/\s+$/, "");

      if (trimmed.endsWith("\\")) {
        logical += `${trimmed.slice(0, -1)} `;
        continue;
      }

      logical += trimmed;
      break;
    }

    const heredocs = [];

    for (const marker of logical.matchAll(HEREDOC_MARKER)) {
      const delimiter = marker[3];
      const body = [];

      while (index < lines.length && lines[index].trim() !== delimiter) {
        body.push(lines[index]);
        index++;
      }

      if (index >= lines.length) {
        throw new Error(
          `${DOCKERFILE}:${firstLine}: the heredoc <<${delimiter} never ends`,
        );
      }

      index++;
      heredocs.push({ delimiter, lines: body });
    }

    const normalized = logical.trim().replace(/\s+/g, " ");

    parsed.push({
      keyword: normalized.split(" ")[0].toUpperCase(),
      text: normalized,
      heredocs,
      line: firstLine,
    });
  }

  return parsed;
}

const DOCKERFILE_TEXT = read(DOCKERFILE);
const INSTRUCTIONS = parseDockerfile(DOCKERFILE_TEXT);
const RUNS = INSTRUCTIONS.filter((instruction) => {
  return instruction.keyword === "RUN";
});

/**
 * The lines each run-in-parallel.sh step runs: "<directory> <command...>",
 * with the step's position among the RUN instructions.
 */
function parallelSteps() {
  return RUNS.filter((run) => {
    return run.text.includes(`bash ${RUN_IN_PARALLEL}`);
  }).map((run) => {
    return {
      runIndex: RUNS.indexOf(run),
      line: run.line,
      lines: run.heredocs
        .flatMap((heredoc) => {
          return heredoc.lines;
        })
        .map((line) => {
          return line.trim();
        })
        .filter((line) => {
          return line.length > 0 && !line.startsWith("#");
        })
        .map((line) => {
          const [directory, ...command] = line.split(/\s+/);
          return { directory, command, text: line };
        }),
    };
  });
}

const STEPS = parallelSteps();

const INSTALLS = STEPS.flatMap((step) => {
  return step.lines
    .filter((line) => {
      return line.command[0] === "npm" && line.command[1] === "ci";
    })
    .map((line) => {
      return { ...line, runIndex: step.runIndex };
    });
});

const BUILDS = STEPS.flatMap((step) => {
  return step.lines
    .filter((line) => {
      return !(line.command[0] === "npm" && line.command[1] === "ci");
    })
    .map((line) => {
      return { ...line, runIndex: step.runIndex };
    });
});

const NOT_BUILT = DOCKERFILE_TEXT.split("\n")
  .map((line) => {
    return NOT_BUILT_LINE.exec(line.trim());
  })
  .filter(Boolean)
  .map((match) => {
    return {
      directory: match.groups.directory,
      reason: match.groups.reason.trim(),
    };
  });

const GO_BUILDS = RUNS.map((run) => {
  const match = /cd (?<directory>\S+) && go mod download/.exec(run.text);
  return match ? { directory: match.groups.directory, run } : null;
}).filter(Boolean);

function packageJsonOf(directory) {
  return JSON.parse(read(path.posix.join(directory, "package.json")));
}

function projectsWith(fileName) {
  return TRACKED_FILES.filter((file) => {
    return path.posix.basename(file) === fileName;
  })
    .map((file) => {
      return path.posix.dirname(file);
    })
    .sort();
}

const NODE_PROJECTS = projectsWith("package.json");
const GO_MODULES = projectsWith("go.mod");

function froms() {
  return INSTRUCTIONS.filter((instruction) => {
    return instruction.keyword === "FROM";
  }).map((instruction) => {
    const match = FROM_LINE.exec(instruction.text);

    if (!match) {
      throw new Error(`${DOCKERFILE}:${instruction.line}: unreadable FROM`);
    }

    return {
      image: match.groups.image,
      stage: match.groups.stage ? match.groups.stage.toLowerCase() : null,
      pinned: PINNED_IMAGE.exec(match.groups.image),
    };
  });
}

const FROMS = froms();

function stageImage(stage) {
  const from = FROMS.find((candidate) => {
    return candidate.stage === stage;
  });

  if (!from || !from.pinned) {
    throw new Error(`${DOCKERFILE} has no pinned stage named ${stage}`);
  }

  return from.pinned.groups;
}

function composeServices(composeFile) {
  return yaml.load(read(composeFile)).services;
}

/**
 * The settings the Dockerfile writes into config.env, in order.
 * @returns {Map<string, string>}
 */
function imageSettings() {
  const run = RUNS.find((candidate) => {
    return candidate.text.includes("> config.env");
  });

  if (!run) {
    throw new Error(`${DOCKERFILE} writes no config.env`);
  }

  const settings = new Map();

  for (const match of run.text.matchAll(ECHOED_SETTING)) {
    settings.set(match.groups.key, match.groups.value);
  }

  return settings;
}

const SETTINGS = imageSettings();

function heredocSetting(text, key) {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(text);
  return match ? match[1].trim() : undefined;
}

function templateKeys(text) {
  return new Set(
    [...text.matchAll(CONFIG_KEY)].map((match) => {
      return match.groups.key;
    }),
  );
}

/**
 * A .dockerignore as moby's patternmatcher reads it: patterns relative to
 * the context root (a leading "/" means nothing), "**" for any number of
 * path segments, "*" and "?" within one, "!" re-including what an earlier
 * pattern excluded, the last matching pattern winning, and a pattern that
 * matches a directory excluding everything in it.
 * @param {string} text
 * @returns {(relativePath: string) => boolean} whether a path is excluded
 */
function dockerignore(text) {
  const rules = text
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .filter((line) => {
      return line.length > 0 && !line.startsWith("#");
    })
    .map((line) => {
      const negate = line.startsWith("!");
      const pattern = path.posix
        .normalize((negate ? line.slice(1) : line).trim())
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      let source = "";

      for (let index = 0; index < pattern.length; index++) {
        const character = pattern[index];

        if (character === "*" && pattern[index + 1] === "*") {
          const followedBySlash = pattern[index + 2] === "/";
          source += followedBySlash ? "(?:.*/)?" : ".*";
          index += followedBySlash ? 2 : 1;
        } else if (character === "*") {
          source += "[^/]*";
        } else if (character === "?") {
          source += "[^/]";
        } else {
          source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
      }

      return { negate, pattern, regex: new RegExp(`^${source}$`) };
    });

  return (relativePath) => {
    const segments = relativePath.split("/");
    let excluded = false;

    for (const rule of rules) {
      for (let depth = 1; depth <= segments.length; depth++) {
        if (rule.regex.test(segments.slice(0, depth).join("/"))) {
          excluded = !rule.negate;
          break;
        }
      }
    }

    return excluded;
  };
}

/**
 * A scratch copy of the scanner's scripts in <dir>/.oss-scanner, the way
 * they sit in the repository, for running them for real.
 */
function scratchRepository() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oss-scanner-"));
  fs.mkdirSync(path.join(directory, SCANNER_DIRECTORY));

  for (const script of SCRIPTS) {
    fs.copyFileSync(path.join(REPO_ROOT, script), path.join(directory, script));
  }

  return directory;
}

function runInParallel(repository, jobs, input) {
  return spawnSync(
    "bash",
    [path.join(repository, RUN_IN_PARALLEL), ...(jobs === null ? [] : [jobs])],
    { input, encoding: "utf8", timeout: 60000 },
  );
}

describe("the scanner's files are committed where project.yaml points", () => {
  test.each(SCANNER_FILES)("%s is tracked by git", (file) => {
    expect(TRACKED.has(file)).toBe(true);
  });

  test.each(SCANNER_FILES)("%s is not ignored by .gitignore", (file) => {
    // The repo-wide **/Dockerfile rule swallowed Examples/snmp-simulator's.
    expect({ file, ignored: isGitIgnored(file) }).toEqual({
      file,
      ignored: false,
    });
  });

  test("the **/Dockerfile rule still ignores the rendered service Dockerfiles", () => {
    // The negation that rescues ours must not have widened to them.
    expect(isGitIgnored("packages/App/Dockerfile")).toBe(true);
    expect(isGitIgnored("packages/Probe/Dockerfile")).toBe(true);
  });

  test("project.yaml names the Dockerfile and threat model that are here", () => {
    const project = yaml.load(read(PROJECT_YAML));

    expect(project.dockerfile).toBe(DOCKERFILE);
    expect(project.threat_model).toBe(THREAT_MODEL);
  });
});

describe("the image is built on the versions the repository runs", () => {
  test("every FROM is pinned by digest", () => {
    expect(FROMS.length).toBeGreaterThanOrEqual(3);

    for (const from of FROMS) {
      expect({ image: from.image, pinned: Boolean(from.pinned) }).toEqual({
        image: from.image,
        pinned: true,
      });
    }
  });

  test("the final stage is the Probe image's Node base", () => {
    const final = FROMS[FROMS.length - 1];
    const probeFrom = /^FROM\s+(?<image>\S+)\s*$/m.exec(read(PROBE_TEMPLATE));

    expect(final.stage).toBeNull();
    expect(final.pinned).not.toBeNull();
    expect(probeFrom).not.toBeNull();
    expect(`${final.pinned.groups.name}:${final.pinned.groups.tag}`).toBe(
      probeFrom.groups.image,
    );
    expect(final.pinned.groups.name).toBe(NODE_REGISTRY);
  });

  test("its Node major is the one every image and the root engines field use", () => {
    const final = FROMS[FROMS.length - 1].pinned.groups;
    const ours = Number(NODE_TAG.exec(final.tag).groups.major);
    const templates = TRACKED_FILES.filter((file) => {
      return path.posix.basename(file) === "Dockerfile.tpl";
    });
    const majors = new Set();

    for (const template of templates) {
      for (const match of read(template).matchAll(NODE_MAJOR_IN_FROM)) {
        majors.add(Number(match.groups.major));
      }
    }

    const engines = JSON.parse(read("package.json")).engines.node;

    expect(templates.length).toBeGreaterThanOrEqual(5);
    expect([...majors]).toEqual([ours]);
    expect(Number(ENGINES_MAJOR.exec(engines).groups.major)).toBe(ours);
  });

  test("ClickHouse is the image docker-compose.base.yml runs", () => {
    const clickhouse = stageImage("clickhouse");
    const services = composeServices("docker-compose.base.yml");

    expect(`${clickhouse.name}:${clickhouse.tag}`).toBe(
      services.clickhouse.image,
    );
  });

  test("Go is the version each built module's go.mod names (what CI's setup-go installs), on Node's Debian release", () => {
    const go = stageImage("go");
    const goTag = GO_TAG.exec(go.tag);
    const node = NODE_TAG.exec(FROMS[FROMS.length - 1].pinned.groups.tag);

    expect(go.name).toBe("public.ecr.aws/docker/library/golang");
    expect(goTag).not.toBeNull();
    expect(goTag.groups.codename).toBe(node.groups.codename);
    expect(GO_BUILDS.length).toBeGreaterThan(0);

    for (const build of GO_BUILDS) {
      const directive = GO_DIRECTIVE.exec(
        read(path.posix.join(build.directory, "go.mod")),
      );

      expect({ module: build.directory, go: directive.groups.version }).toEqual(
        { module: build.directory, go: goTag.groups.version },
      );
    }
  });

  test("Postgres is the major docker-compose.base.yml runs, everywhere the image names it", () => {
    const composeMajor = /^postgres:(?<major>\d+)/.exec(
      composeServices("docker-compose.base.yml").postgres.image,
    ).groups.major;
    const majors = [
      ...DOCKERFILE_TEXT.matchAll(/postgresql-(\d+)|pg_\w+ (\d+) main/g),
      ...read(START_SERVICES).matchAll(/pg_\w+ (\d+) main/g),
    ].map((match) => {
      return match[1] || match[2];
    });

    expect(majors.length).toBeGreaterThanOrEqual(4);
    expect(new Set(majors)).toEqual(new Set([composeMajor]));
  });
});

describe("every project in the repository is installed and built, or listed as not built", () => {
  const installed = new Set(
    INSTALLS.map((install) => {
      return install.directory;
    }),
  );
  const notBuilt = new Set(
    NOT_BUILT.map((entry) => {
      return entry.directory;
    }),
  );

  test("the lists are there to read", () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(3);
    expect(INSTALLS.length).toBeGreaterThanOrEqual(10);
    expect(BUILDS.length).toBeGreaterThanOrEqual(10);
    expect(NOT_BUILT.length).toBeGreaterThan(0);
  });

  test.each(NODE_PROJECTS)(
    "%s is installed or listed as not built",
    (project) => {
      const lists = [
        installed.has(project) ? "installed" : null,
        notBuilt.has(project) ? "not built" : null,
      ].filter(Boolean);

      expect({ project, lists: lists.length }).toEqual({ project, lists: 1 });
    },
  );

  test.each(GO_MODULES)(
    "Go module %s is downloaded and built, or listed as not built",
    (module) => {
      const build = GO_BUILDS.find((candidate) => {
        return candidate.directory === module;
      });

      expect(Boolean(build) || notBuilt.has(module)).toBe(true);

      if (build) {
        expect(build.run.text).toContain("go build ./...");
        expect(build.run.text).toContain("go test");
      }
    },
  );

  test("nothing is both installed and listed as not built, or listed twice", () => {
    const both = [...installed].filter((directory) => {
      return notBuilt.has(directory);
    });

    expect(both).toEqual([]);
    expect(INSTALLS.length).toBe(installed.size);
    expect(NOT_BUILT.length).toBe(notBuilt.size);
  });

  test("every listed directory is a project in the repository", () => {
    const known = new Set([...NODE_PROJECTS, ...GO_MODULES]);
    const goBuilt = GO_BUILDS.map((build) => {
      return build.directory;
    });
    const stale = [...installed, ...notBuilt, ...goBuilt].filter(
      (directory) => {
        return !known.has(directory);
      },
    );

    expect(stale).toEqual([]);
  });

  test.each(NOT_BUILT)("not built: $directory says why", ({ reason }) => {
    expect(reason.split(/\s+/).length).toBeGreaterThanOrEqual(5);
  });

  test.each(INSTALLS)(
    "$directory installs from a committed lockfile",
    ({ directory }) => {
      expect(TRACKED.has(path.posix.join(directory, "package-lock.json"))).toBe(
        true,
      );
    },
  );

  test.each(INSTALLS)(
    "$directory is installed after every project it links with file:",
    ({ directory, runIndex }) => {
      const manifest = packageJsonOf(directory);
      const links = Object.values({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
      })
        .filter((specifier) => {
          return String(specifier).startsWith("file:");
        })
        .map((specifier) => {
          return path.posix.normalize(
            path.posix.join(directory, specifier.slice("file:".length)),
          );
        });

      for (const link of links) {
        const linked = INSTALLS.find((install) => {
          return install.directory === link;
        });

        expect({ directory, link, installed: Boolean(linked) }).toEqual({
          directory,
          link,
          installed: true,
        });
        expect(linked.runIndex).toBeLessThan(runIndex);
      }
    },
  );

  test("ee/ installs without lifecycle scripts, as the Enterprise image does", () => {
    const ee = INSTALLS.find((install) => {
      return install.directory === "ee";
    });

    expect(ee).toBeDefined();
    expect(ee.command).toContain("--ignore-scripts");
    expect(read(APP_TEMPLATE)).toMatch(/npm ci --ignore-scripts/);
  });

  test("every installed project with a compile script is compiled or bundled", () => {
    const appScripts = packageJsonOf("packages/App").scripts;
    const bundled = new Set(
      appScripts["build-frontends:prod"]
        .split("&&")
        .map((part) => {
          return NPM_RUN_SCRIPT.exec(part.trim()).groups.script;
        })
        .map((script) => {
          const match = FRONTEND_RUN.exec(appScripts[script]);
          return path.posix.join("packages/App", match.groups.directory);
        }),
    );

    expect(BUILDS.map((build) => build.text)).toContain(
      "packages/App npm run build-frontends:prod",
    );
    expect(bundled.size).toBeGreaterThanOrEqual(5);

    const unbuilt = [...installed].filter((directory) => {
      const scripts = packageJsonOf(directory).scripts || {};

      if (!scripts.compile) {
        return false;
      }

      return !(
        bundled.has(directory) ||
        BUILDS.some((build) => {
          return (
            build.directory === directory &&
            (build.text === `${directory} npm run compile` ||
              build.text === `${directory} npm run build`)
          );
        })
      );
    });

    expect(unbuilt).toEqual([]);
  });

  test.each(BUILDS)(
    "build line '$text' runs something that exists, after every install",
    ({ directory, command, runIndex }) => {
      const lastInstall = Math.max(
        ...INSTALLS.map((install) => {
          return install.runIndex;
        }),
      );

      expect(installed.has(directory)).toBe(true);
      expect(runIndex).toBeGreaterThan(lastInstall);

      if (command[0] === "npm") {
        expect(command[1]).toBe("run");
        expect(Object.keys(packageJsonOf(directory).scripts)).toContain(
          command[2],
        );
      } else {
        expect(command[0]).toBe("node");
        expect(TRACKED.has(path.posix.join(directory, command[1]))).toBe(true);
      }
    },
  );
});

describe("the build context", () => {
  const ours = dockerignore(read(DOCKERIGNORE));
  const root = dockerignore(read(".dockerignore"));

  test("is BuildKit's Dockerfile-specific ignore file for this Dockerfile", () => {
    expect(DOCKERIGNORE).toBe(`${DOCKERFILE}.dockerignore`);
  });

  test("keeps every tracked file", () => {
    const left = TRACKED_FILES.filter((file) => {
      return ours(file);
    });

    expect(left).toEqual([]);
  });

  test("leaves out what a developer's checkout holds that a clone does not", () => {
    for (const local of [
      ".git/config",
      "node_modules/x/package.json",
      "packages/Common/node_modules/x/index.js",
      "packages/App/build/dist/Index.js",
      "packages/App/FeatureSet/Dashboard/public/dist/Index.js",
      "config.env",
    ]) {
      expect({ local, excluded: ours(local) }).toEqual({
        local,
        excluded: true,
      });
    }
  });

  test("the matcher reads the root .dockerignore as Docker does", () => {
    // Root-anchored names, ** patterns, and the one negation it carries.
    expect(root("Scripts/Install/configure.sh")).toBe(true);
    expect(root("Scripts/Docker/UpdateNpmCli.js")).toBe(false);
    expect(root("ee/Tests/Server/ModuleShape.test.ts")).toBe(true);
    expect(root("ee/Server/Index.ts")).toBe(false);
    expect(root("packages/App/node_modules/x/index.js")).toBe(true);
    expect(root("packages/App/Index.ts")).toBe(false);
  });

  test("the build stops on the root .dockerignore's context: the paths it checks exist, and that file leaves one out", () => {
    const guard = RUNS.find((run) => {
      return run.text.includes(".oss-scanner/Dockerfile.dockerignore");
    });
    const checked = [...guard.text.matchAll(/test -[fd] (\S+)/g)].map(
      (match) => {
        return match[1];
      },
    );
    const present = checked.filter((checkedPath) => {
      return TRACKED_FILES.some((file) => {
        return file === checkedPath || file.startsWith(`${checkedPath}/`);
      });
    });
    const leftOutByRoot = checked.filter((checkedPath) => {
      return root(checkedPath);
    });

    expect(guard.text).toContain("exit 1");
    expect(checked.length).toBeGreaterThanOrEqual(3);
    expect(present).toEqual(checked);
    expect(leftOutByRoot.length).toBeGreaterThanOrEqual(2);
  });

  test("every file the Dockerfile copies or runs from the context is tracked", () => {
    const named = new Set();

    for (const run of RUNS) {
      for (const match of run.text.matchAll(CONTEXT_PATH)) {
        // What npm installed is not in the clone; everything else must be.
        if (!match[1].includes("/node_modules/")) {
          named.add(match[1]);
        }
      }
    }

    expect(named.size).toBeGreaterThanOrEqual(8);

    for (const file of named) {
      const glob = new RegExp(
        `^${file.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`,
      );
      const matches = TRACKED_FILES.filter((tracked) => {
        return glob.test(tracked) || tracked.startsWith(`${file}/`);
      });

      expect({ file, matches: matches.length > 0 }).toEqual({
        file,
        matches: true,
      });
    }
  });
});

describe("the settings the image, its scripts, CI and the Probe image share", () => {
  const testSetup = read(TEST_SETUP);
  const template = read(CONFIG_TEMPLATE);
  const startServices = read(START_SERVICES);
  const startApp = read(START_APP);

  test("config.env points the suites where CI's test-setup.sh does", () => {
    for (const key of [
      "NODE_ENV",
      "BILLING_ENABLED",
      "DATABASE_HOST",
      "DATABASE_PORT",
      "VALKEY_HOST",
      "VALKEY_PORT",
      "VALKEY_DB",
      "VALKEY_USERNAME",
    ]) {
      expect({ key, value: SETTINGS.get(key) }).toEqual({
        key,
        value: heredocSetting(testSetup, key),
      });
    }
  });

  test("CI's plans and billing key are copied from test-setup.sh, which still has them", () => {
    const copy = RUNS.find((run) => {
      return run.text.includes("> config.env");
    }).text;

    expect(copy).toContain(
      "grep -E '^(SUBSCRIPTION_PLAN_[A-Z]+|BILLING_PUBLIC_KEY)=' packages/Common/test-setup.sh",
    );
    expect(testSetup.match(/^SUBSCRIPTION_PLAN_[A-Z]+=/gm).length).toBe(4);
    expect(testSetup).toMatch(/^BILLING_PUBLIC_KEY=pk_test_/m);
  });

  test("every setting config.env writes is one something reads", () => {
    // config.example.env's, CI's test-setup.sh's, or one the code reads: a
    // name in none of them is a typo, or a setting that was renamed.
    const read = new Set([
      ...templateKeys(template),
      ...templateKeys(testSetup),
    ]);

    for (const match of git([
      "grep",
      "-h",
      "-o",
      "-E",
      'process\\.env(\\["[A-Z0-9_]+"\\]|\\.[A-Z0-9_]+)',
      "--",
      "*.ts",
    ]).matchAll(ENV_READ)) {
      read.add(match.groups.bracket || match.groups.dot);
    }

    const unread = [...SETTINGS.keys()].filter((key) => {
      return !read.has(key);
    });

    expect(SETTINGS.size).toBeGreaterThanOrEqual(20);
    expect(unread).toEqual([]);
  });

  test("TEST_CLICKHOUSE_URL is the variable the ClickHouse suites read, on the port config.env names", () => {
    const suites = TRACKED_FILES.filter((file) => {
      return (
        file.startsWith("packages/App/Tests/") &&
        file.endsWith("Clickhouse.test.ts")
      );
    });

    expect(suites.length).toBeGreaterThan(0);

    for (const suite of suites) {
      expect(read(suite)).toContain('process.env["TEST_CLICKHOUSE_URL"]');
    }

    expect(SETTINGS.get("TEST_CLICKHOUSE_URL")).toBe(
      `http://default:\${clickhouse_password}@localhost:${SETTINGS.get("CLICKHOUSE_PORT")}`,
    );
    expect(SETTINGS.get("CLICKHOUSE_PASSWORD")).toBe("${clickhouse_password}");
  });

  test("no secret is a placeholder from config.example.env", () => {
    for (const key of [
      "ONEUPTIME_SECRET",
      "ENCRYPTION_SECRET",
      "DATABASE_PASSWORD",
      "VALKEY_PASSWORD",
      "CLICKHOUSE_PASSWORD",
      "REGISTER_PROBE_KEY",
      "GLOBAL_PROBE_1_KEY",
    ]) {
      expect(heredocSetting(template, key)).toMatch(/please-change-this/);
      expect({ key, value: SETTINGS.get(key) }).toEqual({
        key,
        value: expect.stringMatching(
          /^\$\((secret)\)$|^\$\{clickhouse_password\}$/,
        ),
      });
    }
  });

  test("the App reaches itself on this machine, not by its Compose service name", () => {
    const services = composeServices("docker-compose.base.yml");

    expect(Object.keys(services)).toContain(
      heredocSetting(template, "SERVER_APP_HOSTNAME"),
    );
    expect(SETTINGS.get("SERVER_APP_HOSTNAME")).toBe("localhost");
    expect(SETTINGS.get("SERVER_HOME_HOSTNAME")).toBe("localhost");
  });

  test("start-services.sh starts each datastore where config.env and the dev stack put it", () => {
    const devCompose = composeServices(DEV_COMPOSE);
    const databasePort = SETTINGS.get("DATABASE_PORT");
    const valkeyPort = SETTINGS.get("VALKEY_PORT");
    const clickhousePort = SETTINGS.get("CLICKHOUSE_PORT");

    expect(devCompose.postgres.ports).toContain(`${databasePort}:5432`);
    expect(devCompose.valkey.ports).toContain(`${valkeyPort}:6379`);
    expect(clickhousePort).toBe(heredocSetting(template, "CLICKHOUSE_PORT"));
    expect(DOCKERFILE_TEXT).toContain(
      `pg_conftool 15 main set port ${databasePort}`,
    );
    expect(startServices).toContain(
      `pg_isready -h localhost -p ${databasePort}`,
    );
    expect(startServices).toContain(`port ${valkeyPort}`);
    expect(startServices).toContain(`redis-cli -h 127.0.0.1 -p ${valkeyPort}`);
    expect(startServices).toContain(`http://localhost:${clickhousePort}/ping`);
  });

  test("start-services.sh reads the passwords from config.env, as the suites do", () => {
    expect(startServices).toContain("setting VALKEY_PASSWORD");
    expect(startServices).toMatch(
      /sed -n "s\/\^\$1=\/\/p" config\.env \| tail -n 1/,
    );
  });

  test("ClickHouse runs the drop-ins docker-compose.base.yml mounts", () => {
    const mounted = composeServices("docker-compose.base.yml")
      .clickhouse.volumes.map((volume) => {
        return volume.split(":")[0].replace(/^\.\//, "");
      })
      .filter((source) => {
        return source.endsWith(".xml");
      })
      .sort();
    const copied = TRACKED_FILES.filter((file) => {
      return /^Clickhouse\/(config|users)\.d\/[^/]+\.xml$/.test(file);
    }).sort();

    expect(DOCKERFILE_TEXT).toContain(
      "cp Clickhouse/config.d/*.xml /etc/clickhouse-server/config.d/",
    );
    expect(DOCKERFILE_TEXT).toContain(
      "cp Clickhouse/users.d/*.xml /etc/clickhouse-server/users.d/",
    );
    expect(copied).toEqual(mounted);
  });

  test("start-app.sh runs the App as a self-hosted install on config.example.env's port", () => {
    const appPort = heredocSetting(template, "APP_PORT");

    expect(startApp).toContain("export BILLING_ENABLED=false");
    expect(startApp).toContain(`export PORT=${appPort}`);
    expect(startApp).toContain(`http://localhost:${appPort}/status/ready`);
    expect(startApp).toContain("bash .oss-scanner/start-services.sh");
    expect(startApp).toContain("export TS_NODE_TRANSPILE_ONLY=1");
  });

  test("the Probe's browsers are installed where, and as, the Probe image installs them", () => {
    const probe = read(PROBE_TEMPLATE);
    const browsersPath = /^ENV PLAYWRIGHT_BROWSERS_PATH=(\S+)$/m;
    const browsers =
      /npx playwright install --with-deps ([a-z ]+?)\s*(?:\\|&&|\))/;

    expect(browsersPath.exec(DOCKERFILE_TEXT)[1]).toBe(
      browsersPath.exec(probe)[1],
    );
    expect(browsers.exec(DOCKERFILE_TEXT)[1].trim()).toBe(
      browsers.exec(probe)[1].trim(),
    );
  });

  test("the Probe's native helpers are built where the Probe loads them, with the image's modes", () => {
    const library = "/usr/lib/oneuptime-probe/libsynthetic-no-sync.so";
    const helper = "/usr/lib/oneuptime-probe/synthetic-process-memory";
    const probe = read(PROBE_TEMPLATE);

    expect(
      read(
        "packages/Probe/Utils/Monitors/SyntheticRuntime/SyntheticBrowser.ts",
      ),
    ).toContain(library);
    expect(
      read(
        "packages/Probe/Utils/Monitors/SyntheticRuntime/ProcessTreeMemory.ts",
      ),
    ).toContain(helper);

    for (const text of [DOCKERFILE_TEXT, probe]) {
      expect(text).toContain(`-o ${library}`);
      expect(text).toContain(`-o ${helper}`);
      expect(text).toContain(`chmod 0644 ${library}`);
      expect(text).toContain(`chmod 0700 ${helper}`);
    }
  });

  test("the tools the Probe's monitors run are installed, as in the Probe image", () => {
    const probe = read(PROBE_TEMPLATE);

    for (const tool of [
      "iputils-ping",
      "net-tools",
      "dnsutils",
      "traceroute",
    ]) {
      expect(probe).toContain(tool);
      expect(DOCKERFILE_TEXT).toContain(tool);
    }
  });

  test("every /usr/src path the server code hard-codes is linked to the checkout", () => {
    const serverCode = TRACKED_FILES.filter((file) => {
      return (
        file.endsWith(".ts") &&
        !file.includes("/Tests/") &&
        (file.startsWith("packages/Common/Server/") ||
          file.startsWith("ee/Server/") ||
          (file.startsWith("packages/App/") && !file.includes("/src/")))
      );
    });
    const used = new Set();

    for (const file of serverCode) {
      for (const match of read(file).matchAll(USR_SRC_LITERAL)) {
        used.add(match.groups.name);
      }
    }

    const links = new Map(
      [...DOCKERFILE_TEXT.matchAll(USR_SRC_LINK)].map((match) => {
        return [match.groups.name, match.groups.target];
      }),
    );

    // Exactly the ones in use: a link nothing reads is a path that moved.
    expect([...used].sort()).toEqual(["Common", "app"]);
    expect([...links.keys()].sort()).toEqual([...used].sort());
    expect(links.get("app")).toBe("/src/packages/App");
    expect(links.get("Common")).toBe("/src/packages/Common");
  });

  test("npm and go are offline in the finished image", () => {
    const last = RUNS[RUNS.length - 1].text;

    expect(last).toBe("RUN npm config set offline true --global");
    expect(DOCKERFILE_TEXT).toMatch(/^ENV GOPROXY=off \\$/m);
    expect(DOCKERFILE_TEXT).toMatch(/GOTOOLCHAIN=local/);
  });

  test("the checkout is at /src, the scanner's contract", () => {
    const copies = INSTRUCTIONS.filter((instruction) => {
      return (
        instruction.keyword === "COPY" && !instruction.text.includes("--from")
      );
    });

    expect(copies.map((copy) => copy.text)).toEqual(["COPY . /src"]);
    expect(INSTRUCTIONS[INSTRUCTIONS.length - 2].text).toBe("WORKDIR /src");
  });
});

describe("the threat model", () => {
  const model = read(THREAT_MODEL);
  const project = yaml.load(read(PROJECT_YAML));

  test("follows the sections of the scanner's template", () => {
    for (const heading of [
      "## What OneUptime is",
      "## Components",
      "## Who attacks, and what they start with",
      "## Trust boundaries",
      "## Where untrusted input enters",
      "## In scope and out of scope",
      "## How we rate severity",
      "## How reports and patches should look",
      "## How to exercise it",
      "## Anything to leave alone",
    ]) {
      expect(model).toContain(`\n${heading}\n`);
    }
  });

  test.each(COMPOSE_FILES)("names every service in %s", (composeFile) => {
    const missing = Object.keys(composeServices(composeFile)).filter(
      (service) => {
        return !model.includes(`\`${service}\``);
      },
    );

    expect(missing).toEqual([]);
  });

  test("names every trust boundary", () => {
    for (const boundary of [
      "**Project tenancy.**",
      "**Roles inside a project.**",
      "**label scopes**",
      "**owner",
      "**Master admin.**",
      "**Public and private.**",
      "**Sandboxes.**",
      "**Network egress from shared infrastructure.**",
      "**Credentials and secrets.**",
      "**Agents and runners in customers' infrastructure**",
      "**AI.**",
    ]) {
      expect(model).toContain(boundary);
    }
  });

  test("names every way untrusted input enters", () => {
    for (const entry of [
      "status pages",
      "dashboards",
      "Incoming request (heartbeat) monitors",
      "Inbound email",
      "Telemetry ingestion",
      "The probe API",
      "custom JavaScript monitors",
      "synthetic monitor scripts",
      "workflow JavaScript",
      "SAML and OIDC",
      "SCIM",
      "OAuth",
      "API keys",
      "MCP",
      "File uploads",
      "Outbound requests to user-given URLs",
    ]) {
      expect(model).toContain(entry);
    }
  });

  test("rates severity in four levels", () => {
    for (const level of ["**Critical**", "**High**", "**Medium**", "**Low**"]) {
      expect(model).toContain(`\n${level}\n`);
    }
  });

  test("every repository path it names exists", () => {
    const cited = [...model.matchAll(BACKTICKED)]
      .map((match) => {
        return match.groups.value.replace(/\/$/, "");
      })
      .filter((value) => {
        return REPOSITORY_PATH.test(value) || ROOT_FILE.test(value);
      });
    const missing = cited.filter((cited) => {
      if (cited.includes("*")) {
        return false;
      }

      return !TRACKED_FILES.some((file) => {
        return file === cited || file.startsWith(`${cited}/`);
      });
    });

    expect(cited.length).toBeGreaterThanOrEqual(30);
    expect(missing).toEqual([]);
  });

  test("every relative link resolves", () => {
    const links = [...model.matchAll(MARKDOWN_LINK)]
      .map((match) => {
        return match.groups.target;
      })
      .filter((target) => {
        return !target.startsWith("http");
      });

    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      expect(exists(path.posix.join(SCANNER_DIRECTORY, link))).toBe(true);
    }
  });

  test("sends reports to project.yaml's primary contact", () => {
    expect(project.primary_contact).toBe("security@oneuptime.com");
    expect(model).toContain(project.primary_contact);
  });

  test("keeps SECURITY.md's out-of-scope rules, with the settings it names", () => {
    const policy = read(SECURITY_POLICY);
    const template = read(CONFIG_TEMPLATE);
    const compose = read("docker-compose.base.yml");

    expect(policy).toContain("please-change-this-to-random-value");
    expect(template).toContain("please-change-this-to-random-value");
    expect(model).toContain("please-change-this-to-random-value");

    for (const setting of [
      "ALLOW_PRIVATE_NETWORK_WEBHOOKS",
      "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS",
    ]) {
      expect(model).toContain(setting);
      expect(compose).toContain(setting);
    }
  });

  test("its commands use files that exist", () => {
    const commands = model
      .split("```sh")
      .slice(1)
      .map((block) => {
        return block.split("```")[0];
      })
      .join("\n");
    const testFiles = [
      ...commands.matchAll(
        /cd \/src\/(\S+) && .*?\b((?:Tests)\/\S+\.test\.ts)/g,
      ),
    ];

    expect(testFiles.length).toBeGreaterThanOrEqual(5);

    for (const match of testFiles) {
      expect(TRACKED.has(path.posix.join(match[1], match[2]))).toBe(true);
    }

    expect(commands).toContain(`bash /src/${START_SERVICES}`);
    expect(commands).toContain(`bash /src/${START_APP}`);
  });

  test("the Postgres example switches on the flag its suite reads", () => {
    const example =
      /(RUN_POSTGRES_[A-Z_]+)=true npx jest --runInBand (\S+)/.exec(model);

    expect(example).not.toBeNull();
    expect(read(path.posix.join("packages/Common", example[2]))).toContain(
      `process.env["${example[1]}"] === "true"`,
    );
  });

  test("stays within the size the scanner reads in full", () => {
    // tools/validate.py's MAX_FILE_BYTES for a threat model beside project.yaml.
    expect(Buffer.byteLength(model, "utf8")).toBeLessThan(64 * 1024);
  });
});

describe("project.yaml passes the scanner's enrolment rules", () => {
  const text = read(PROJECT_YAML);
  const project = yaml.load(text);

  test("is a mapping of known fields only", () => {
    const allowed = [...VALIDATE_REQUIRED_KEYS, ...VALIDATE_OPTIONAL_KEYS];

    expect(typeof project).toBe("object");
    expect(
      Object.keys(project).filter((key) => !allowed.includes(key)),
    ).toEqual([]);

    for (const key of VALIDATE_REQUIRED_KEYS) {
      expect(project[key]).toBeTruthy();
    }
  });

  test("names this repository, by one https URL", () => {
    const repository = JSON.parse(read("package.json")).repository.url;

    expect(project.repo).toMatch(VALIDATE_URL);
    expect(project.repo).toBe("https://github.com/OneUptime/oneuptime");
    expect(repository.toLowerCase()).toContain(
      project.repo.replace("https://", "").toLowerCase(),
    );
  });

  test("has one public security address, no CCs and no key", () => {
    expect(project.primary_contact).toMatch(EMAIL);
    expect(project.auto_ccs).toBeUndefined();
    expect(project.pgp).toBeUndefined();
    expect(project.disabled).toBeUndefined();
  });

  test("points at files in this repository by safe relative paths", () => {
    for (const key of ["dockerfile", "threat_model"]) {
      expect(project[key]).toMatch(VALIDATE_REPO_PATH);
      expect(TRACKED.has(project[key])).toBe(true);
    }

    expect(project.homepage).toMatch(VALIDATE_URL);
  });

  test("stays under the scanner's size limit", () => {
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(128 * 1024);
  });
});

describe("the scripts", () => {
  test.each(SCRIPTS)("%s parses under bash -n", (script) => {
    const result = spawnSync("bash", ["-n", path.join(REPO_ROOT, script)], {
      encoding: "utf8",
    });

    expect(result.stderr.trim()).toBe("");
    expect(result.status).toBe(0);
  });

  test.each(SCRIPTS)("%s stops at the first failure", (script) => {
    expect(read(script)).toMatch(/^set -euo pipefail$/m);
  });

  const hasShellcheck = (() => {
    try {
      execFileSync("shellcheck", ["--version"], { stdio: "ignore" });
      return true;
    } catch (error) {
      return false;
    }
  })();

  // shellcheck is on GitHub's runners; skip rather than fail where it is not.
  (hasShellcheck ? test.each : test.skip.each)(SCRIPTS)(
    "%s has no shellcheck warnings",
    (script) => {
      const result = spawnSync(
        "shellcheck",
        ["--severity=warning", "--shell=bash", path.join(REPO_ROOT, script)],
        { encoding: "utf8" },
      );

      expect(`${result.stdout}${result.stderr}`.trim()).toBe("");
      expect(result.status).toBe(0);
    },
  );

  test("start-services.sh refuses to run outside the image, before it starts anything", () => {
    const repository = scratchRepository();

    try {
      const result = spawnSync(
        "bash",
        [path.join(repository, START_SERVICES)],
        { encoding: "utf8", timeout: 30000 },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no config.env here");
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });

  test("start-app.sh starts the datastores first, and so refuses too", () => {
    const repository = scratchRepository();

    try {
      const result = spawnSync("bash", [path.join(repository, START_APP)], {
        encoding: "utf8",
        timeout: 30000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no config.env here");
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe("run-in-parallel.sh", () => {
  let repository;

  beforeEach(() => {
    repository = scratchRepository();

    for (const directory of ["one", "two", "three"]) {
      fs.mkdirSync(path.join(repository, directory));
    }
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  test("runs each line in its directory, relative to the repository root, and prefixes its output", () => {
    const result = runInParallel(
      repository,
      "2",
      "one pwd\ntwo bash -c 'echo hello'\n",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^\[one\] \/\S*\/one$/m);
    expect(result.stdout).toContain("[two] hello");
    expect(result.stdout).toContain("[one] done: pwd");
    expect(result.stdout).toContain("[two] done: bash -c echo hello");
  });

  test("runs lines at the same time, up to the number of jobs", () => {
    // "one" can only finish once "two" has run: with one job it would wait
    // for the whole timeout, with two it returns at once.
    const input = [
      "one bash -c 'for i in $(seq 100); do [ -f ../two/ran ] && exit 0; sleep 0.1; done; exit 1'",
      "two touch ran",
    ].join("\n");
    const started = Date.now();
    const result = runInParallel(repository, "2", input);

    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(9000);
  });

  test("runs every line even when one fails, then fails naming it", () => {
    const result = runInParallel(
      repository,
      "1",
      "one false\ntwo touch ran\nthree touch ran\n",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[one] FAILED: false");
    expect(result.stderr).toContain("These failed");
    expect(result.stderr).toContain("  one: false");
    expect(fs.existsSync(path.join(repository, "two", "ran"))).toBe(true);
    expect(fs.existsSync(path.join(repository, "three", "ran"))).toBe(true);
  });

  test("fails a line whose directory is missing", () => {
    const result = runInParallel(repository, "2", "missing true\none true\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("  missing: true");
    expect(result.stdout).toContain("[one] done: true");
  });

  test("fails a line that names a directory and no command", () => {
    const result = runInParallel(repository, "1", "one\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("one: no command");
  });

  test("skips blank lines and comments", () => {
    const result = runInParallel(
      repository,
      "2",
      "\n# a comment\n   \none touch ran\n  # indented comment\n",
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(repository, "one", "ran"))).toBe(true);
    expect(result.stdout).not.toContain("comment");
  });

  test("keeps two lines apart even when the first ends in blanks", () => {
    // xargs -L joins a line ending in a blank to the next one.
    const result = runInParallel(
      repository,
      "1",
      "one touch first   \ntwo touch second\t\n",
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(repository, "one", "first"))).toBe(true);
    expect(fs.existsSync(path.join(repository, "two", "second"))).toBe(true);
    expect(fs.existsSync(path.join(repository, "one", "two"))).toBe(false);
  });

  test.each([null, "0", "x", "-1", "2.5"])(
    "refuses %p jobs with its usage",
    (jobs) => {
      const result = runInParallel(repository, jobs, "one touch ran\n");

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage: run-in-parallel.sh <jobs>");
      expect(fs.existsSync(path.join(repository, "one", "ran"))).toBe(false);
    },
  );

  test("refuses to run nothing", () => {
    const result = runInParallel(repository, "2", "\n# only a comment\n");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nothing to run");
  });
});
