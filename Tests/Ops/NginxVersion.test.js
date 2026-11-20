"use strict";

/**
 * Every place that pins the ingress's nginx names one release, and that
 * release fixes nginx's published vulnerabilities (#9709).
 *
 * OneUptime's ingress image (packages/Nginx/Dockerfile.tpl) is built FROM the
 * official nginx image, and the tag of its base stage is the nginx that
 * OneUptime ships. The Nginx Test workflow builds that same stage to run the
 * configuration's tests in (NginxImageTestsInCi.test.js), so it has no second
 * tag. 16.0.0 shipped nginx 1.30.5, without the five fixes 1.30.6 had brought
 * in October, and on the day it shipped nginx disclosed two vulnerabilities in
 * HTTP/2, CVE-2026-123007 and CVE-2026-123633, which 1.30.7 fixes. The primary
 * server block turns HTTP/2 on, so with PROVISION_SSL its HTTPS listener
 * negotiates it. This suite holds:
 *
 *   - the ingress's nginx at or past the first release of its line that fixes
 *     them (FIRST_FIXED), so that a revert, a merge or a "pin what worked"
 *     cannot take it back;
 *   - every file that builds, runs or deploys an image to pinning no other
 *     nginx;
 *   - Iron Bank's nginx-alpine, which the Iron Bank ingress is built on
 *     (IronBank/README.md), to the same nginx line, and the Iron Bank
 *     project's docs to naming that line. Iron Bank builds that image itself.
 *     While it has no fixed release, IRON_BANK_NGINX_WAITING names the tag it
 *     is held at and the issue that moves it.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const { render, parseStages } = require("./Utils/DockerfileTemplate");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INGRESS_DOCKERFILE = "packages/Nginx/Dockerfile.tpl";
const IRON_BANK_MANIFEST = "IronBank/Ingress/hardening_manifest.yaml";
const IRON_BANK_DOCKERFILE = "IronBank/Ingress/Dockerfile";

/*
 * The first release of each nginx line that fixes every vulnerability below,
 * from https://nginx.org/en/security_advisories.html. The ingress follows
 * 1.30, the stable line, and 1.31 is the mainline. A line newer than both
 * started after these fixes and has them.
 *
 *   1.30.7 and 1.31.9 (2026-11-18): CVE-2026-123007 and CVE-2026-123633 in
 *   HTTP/2, CVE-2026-118899 (TLS 1.3), CVE-2026-121810, CVE-2026-123634,
 *   CVE-2026-113425, CVE-2026-120967, CVE-2026-123640, CVE-2026-125283, and
 *   CVE-2026-120993 (only 1.31.4 to 1.31.8 have that one).
 *   1.30.6 and 1.31.7 (2026-10-14): CVE-2026-15176, CVE-2026-93479,
 *   CVE-2026-95101, CVE-2026-97629, CVE-2026-97205.
 *
 * When nginx publishes another advisory, move the ingress to its fixed
 * release, and these entries with it.
 */
const FIRST_FIXED = Object.freeze(["1.30.7", "1.31.9"]);

/*
 * Iron Bank's nginx-alpine on Repo1 (dsop/opensource/nginx/1.30/nginx-alpine)
 * was still at 1.30.3 on 2026-11-19, and no Alpine nginx on Iron Bank had the
 * fixes yet. So the Iron Bank ingress stays on it until Iron Bank publishes
 * one, which #9844 tracks. Once BASE_TAG reaches FIRST_FIXED, this suite
 * fails until this is null.
 */
const IRON_BANK_NGINX_WAITING = Object.freeze({
  tag: "1.30.3",
  issue: "https://github.com/OneUptime/oneuptime/issues/9844",
});

/*
 * An nginx image pinned to an exact release, however its reference is
 * written: nginx:1.30.7-alpine3.24, docker.io/library/nginx:1.30.7, or
 * through a mirror. Not OneUptime's own image (oneuptime/nginx:<version>),
 * and not Iron Bank's (ironbank/opensource/nginx/nginx-alpine:<tag>), which
 * is held to the line below.
 */
const NGINX_IMAGE =
  /(?<![\w./-])(?:(?:docker\.io|mirror\.gcr\.io|public\.ecr\.aws\/docker)\/)?(?:library\/)?nginx:(\d+\.\d+\.\d+)(?![\d.])[\w.-]*/g;

// "nginx 1.30" in prose: a line, not a release.
const NGINX_LINE_IN_PROSE = /\bnginx (\d+\.\d+)(?![\d.]*\d)/g;

const IRON_BANK_DOCS = [
  "IronBank/README.md",
  "IronBank/Ingress/README.md",
  IRON_BANK_DOCKERFILE,
  IRON_BANK_MANIFEST,
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function parseVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${version} is not an nginx release (major.minor.patch)`);
  }
  return version.split(".").map(Number);
}

// Compares versions part by part, as numbers: 1.30.10 is newer than 1.30.9.
function compareVersions(left, right) {
  const a = Array.isArray(left) ? left : left.split(".").map(Number);
  const b = Array.isArray(right) ? right : right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function lineOf(version) {
  return parseVersion(version).slice(0, 2).join(".");
}

/*
 * Whether an nginx release has every fix in FIRST_FIXED: at or past the fix of
 * its line, or on a line that started after all of them.
 */
function isFixed(version) {
  const line = lineOf(version);
  const fix = FIRST_FIXED.find((release) => {
    return lineOf(release) === line;
  });
  if (fix) {
    return compareVersions(version, fix) >= 0;
  }
  const newestLine = FIRST_FIXED.map(lineOf).sort(compareVersions).pop();
  return compareVersions(line, newestLine) > 0;
}

function fixedReleases() {
  return FIRST_FIXED.join(" or ");
}

// The nginx release the ingress image is built FROM: its base stage's tag.
function ingressNginx() {
  const stages = parseStages(
    render(read(INGRESS_DOCKERFILE), "production", {
      fileExists: (relativePath) => {
        return fs.existsSync(path.join(REPO_ROOT, relativePath));
      },
    }),
  );
  const base = stages.find((stage) => {
    return stage.name === "base";
  });
  if (!base) {
    throw new Error(`${INGRESS_DOCKERFILE} has no base stage`);
  }
  const match = /^nginx:(\d+\.\d+\.\d+)-alpine\d+\.\d+$/.exec(base.from);
  if (!match) {
    throw new Error(
      `${INGRESS_DOCKERFILE}'s base stage is FROM ${base.from}, not nginx:<release>-alpine<version>`,
    );
  }
  return { image: base.from, version: match[1] };
}

// Every nginx image a text pins to a release, with the number of its line.
function nginxImagesIn(text) {
  const found = [];
  text.split("\n").forEach((content, index) => {
    for (const match of content.matchAll(NGINX_IMAGE)) {
      found.push({ line: index + 1, image: match[0], version: match[1] });
    }
  });
  return found;
}

/*
 * Files that build, run or deploy an image, where an nginx image would be
 * pinned: Dockerfiles and their templates, Compose files, the Helm charts, the
 * GitHub workflows and actions, the Iron Bank projects and the scripts. Tests
 * and their fixtures are left out, since they pin nothing that runs
 * (ImageVulnerabilities.test.js keeps a vulnerable nginx on purpose), and so
 * are the examples, whose containers are things to monitor.
 */
function buildsRunsOrDeploys(file) {
  const name = path.posix.basename(file);
  if (
    /(^|\/)(Tests|tests|__tests__)\//.test(file) ||
    /^Examples\//.test(file) ||
    /[._-]test\.[A-Za-z]+$/.test(name)
  ) {
    return false;
  }
  return (
    /^Dockerfile|\.Dockerfile$/.test(name) ||
    /^(docker-)?compose[\w.-]*\.ya?ml$/.test(name) ||
    /^(HelmChart|IronBank|\.github)\//.test(file) ||
    /^Scripts\/.+\.(sh|js|ts|py|ya?ml)$/.test(file)
  );
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ls-files failed: ${result.error || result.stderr || result.status}`,
    );
  }
  return result.stdout.split("\0").filter(Boolean);
}

function ironBankBaseTag() {
  return yaml.load(read(IRON_BANK_MANIFEST)).args.BASE_TAG;
}

describe("how a release is judged", () => {
  test("a release is fixed at or past its line's fix, compared as numbers", () => {
    expect(isFixed("1.30.5")).toBe(false);
    expect(isFixed("1.30.6")).toBe(false);
    expect(isFixed("1.30.7")).toBe(true);
    expect(isFixed("1.30.10")).toBe(true);
    expect(isFixed("1.31.8")).toBe(false);
    expect(isFixed("1.31.9")).toBe(true);
  });

  test("a line older than the ones listed is not fixed, and one newer is", () => {
    expect(isFixed("1.29.9")).toBe(false);
    expect(isFixed("1.28.4")).toBe(false);
    expect(isFixed("1.32.0")).toBe(true);
    expect(isFixed("2.0.0")).toBe(true);
  });

  test("anything but major.minor.patch is refused", () => {
    expect(() => {
      return isFixed("1.30");
    }).toThrow(/not an nginx release/);
    expect(() => {
      return isFixed("1.30.7-alpine");
    }).toThrow(/not an nginx release/);
  });

  test("FIRST_FIXED names one release of each line", () => {
    const lines = FIRST_FIXED.map(lineOf);
    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe("how a pinned nginx image is found", () => {
  test("an nginx image pinned to a release, however its reference is written", () => {
    const text = [
      "FROM nginx:1.30.7-alpine3.24 AS base",
      "    image: docker.io/library/nginx:1.30.6",
      '  image: "mirror.gcr.io/library/nginx:1.31.9-alpine"',
      "docker pull public.ecr.aws/docker/library/nginx:1.30.5-alpine3.24-slim",
    ].join("\n");

    expect(nginxImagesIn(text)).toEqual([
      { line: 1, image: "nginx:1.30.7-alpine3.24", version: "1.30.7" },
      {
        line: 2,
        image: "docker.io/library/nginx:1.30.6",
        version: "1.30.6",
      },
      {
        line: 3,
        image: "mirror.gcr.io/library/nginx:1.31.9-alpine",
        version: "1.31.9",
      },
      {
        line: 4,
        image: "public.ecr.aws/docker/library/nginx:1.30.5-alpine3.24-slim",
        version: "1.30.5",
      },
    ]);
  });

  test("not OneUptime's own image, Iron Bank's, or a tag that names no release", () => {
    const text = [
      "image: oneuptime/nginx:16.0.0",
      "ghcr.io/oneuptime/nginx:14.0.101-amd64",
      "FROM oneuptime/nginx:14.0.102 AS release",
      "registry1.dso.mil/ironbank/opensource/nginx/nginx-alpine:1.30.3",
      "FROM nginx:1.30-alpine",
      "FROM nginx:stable-alpine",
      "docker image inspect nginx:1.27",
    ].join("\n");

    expect(nginxImagesIn(text)).toEqual([]);
  });
});

describe("the ingress's nginx", () => {
  const ingress = ingressNginx();

  test(`is a release that fixes nginx's published vulnerabilities (${fixedReleases()} or later)`, () => {
    if (!isFixed(ingress.version)) {
      throw new Error(
        `${INGRESS_DOCKERFILE} builds the ingress FROM ${ingress.image}, and nginx ${ingress.version} has vulnerabilities that ${fixedReleases()} fix (FIRST_FIXED in this file lists them). Move its base stage to the newest nginx:<release>-alpine<version> of the line.`,
      );
    }
  });

  test("is the only nginx release that a file which builds, runs or deploys an image pins", () => {
    const pins = [];
    for (const file of trackedFiles().filter(buildsRunsOrDeploys)) {
      let text;
      try {
        text = read(file);
      } catch {
        continue;
      }
      for (const found of nginxImagesIn(text)) {
        pins.push({ file, ...found });
      }
    }

    // The scan reads the ingress's own pin, so it is not passing on nothing.
    expect(
      pins.filter((pin) => {
        return pin.file === INGRESS_DOCKERFILE;
      }),
    ).toEqual([
      expect.objectContaining({
        image: ingress.image,
        version: ingress.version,
      }),
    ]);

    const others = pins
      .filter((pin) => {
        return pin.version !== ingress.version;
      })
      .map((pin) => {
        return `${pin.file}:${pin.line} pins ${pin.image}`;
      });
    if (others.length > 0) {
      throw new Error(
        `The ingress runs nginx ${ingress.version} (${INGRESS_DOCKERFILE}), and these pin another nginx. Move them to ${ingress.version}:\n${others.join("\n")}`,
      );
    }
  });
});

describe("Iron Bank's nginx", () => {
  const ingress = ingressNginx();
  const baseTag = ironBankBaseTag();

  test("the Iron Bank ingress is built on Iron Bank's nginx-alpine, by the manifest's tag", () => {
    const manifest = yaml.load(read(IRON_BANK_MANIFEST));
    const dockerfile = read(IRON_BANK_DOCKERFILE);

    expect(manifest.args.BASE_IMAGE).toBe("opensource/nginx/nginx-alpine");
    expect(dockerfile).toMatch(
      /^ARG BASE_IMAGE=ironbank\/opensource\/nginx\/nginx-alpine$/m,
    );
    expect(dockerfile.split("\n")).toContain(`ARG BASE_TAG=${baseTag}`);
  });

  test("is on the ingress's nginx line", () => {
    expect(lineOf(baseTag)).toBe(lineOf(ingress.version));
  });

  test("fixes nginx's published vulnerabilities, or waits for Iron Bank with an issue that tracks it", () => {
    if (isFixed(baseTag)) {
      if (IRON_BANK_NGINX_WAITING !== null) {
        throw new Error(
          `${IRON_BANK_MANIFEST}'s BASE_TAG is ${baseTag}, which has nginx's fixes: set IRON_BANK_NGINX_WAITING in this file to null, and close ${IRON_BANK_NGINX_WAITING.issue}.`,
        );
      }
      return;
    }

    if (IRON_BANK_NGINX_WAITING === null) {
      throw new Error(
        `${IRON_BANK_MANIFEST}'s BASE_TAG is ${baseTag}, and nginx ${baseTag} has vulnerabilities that ${fixedReleases()} fix. Move it to Iron Bank's fixed nginx-alpine, or, while Iron Bank has none, set IRON_BANK_NGINX_WAITING to the tag and the issue that tracks it.`,
      );
    }
    expect(IRON_BANK_NGINX_WAITING.issue).toMatch(
      /^https:\/\/github\.com\/OneUptime\/oneuptime\/issues\/\d+$/,
    );
    // A move to another release that is still not fixed is a decision, not an
    // accident: change the tag here with it.
    expect(baseTag).toBe(IRON_BANK_NGINX_WAITING.tag);
  });

  test("the Iron Bank project's docs name the ingress's nginx line", () => {
    const mentions = [];
    for (const file of IRON_BANK_DOCS) {
      read(file)
        .split("\n")
        .forEach((content, index) => {
          for (const match of content.matchAll(NGINX_LINE_IN_PROSE)) {
            mentions.push({ file, line: index + 1, nginxLine: match[1] });
          }
        });
    }

    expect(mentions.length).toBeGreaterThan(0);
    expect(
      mentions
        .filter((mention) => {
          return mention.nginxLine !== lineOf(ingress.version);
        })
        .map((mention) => {
          return `${mention.file}:${mention.line} says nginx ${mention.nginxLine}`;
        }),
    ).toEqual([]);
  });
});
