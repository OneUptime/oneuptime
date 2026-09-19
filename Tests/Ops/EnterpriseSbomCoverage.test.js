"use strict";

/**
 * generate_sboms.sh scans the enterprise tag of exactly the images whose
 * enterprise tag is a different build.
 *
 * build_docker_images.sh builds an image's enterprise tag from its
 * Dockerfile's `enterprise` target when there is one (a stage named exactly
 * "enterprise": today only the App, whose enterprise target adds ee/), and
 * otherwise as the community build with IS_ENTERPRISE_EDITION=true, which no
 * RUN step reads. generate_sboms.sh scans the enterprise tag only for the
 * images in its hard-coded ENTERPRISE_IMAGES. So that list must equal the set
 * of images release.yml builds from a Dockerfile with an enterprise stage:
 * a second image with an enterprise target, missing from the list, would
 * ship an enterprise image with no SBOM of its own, and nothing else would
 * notice.
 *
 * The images are read from release.yml's build_docker_images.sh calls
 * (--image / --dockerfile), each Dockerfile from its Dockerfile.tpl, rendered
 * for production the way the release does.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  render,
  parseStages,
  findTemplates,
} = require("./Utils/DockerfileTemplate");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_WORKFLOW = ".github/workflows/release.yml";
const GENERATE_SBOMS = "Scripts/GHA/generate_sboms.sh";
const BUILD_DOCKER_IMAGES = "Scripts/GHA/build_docker_images.sh";

/*
 * build_docker_images.sh's own test for an enterprise target, as written
 * there (grep -qiE, one line at a time).
 */
const BUILD_SCRIPT_ENTERPRISE_GREP =
  "grep -qiE '^[[:space:]]*FROM[[:space:]].*[[:space:]]AS[[:space:]]+enterprise[[:space:]]*$' \"$DOCKERFILE\"";
// The same test in JavaScript: [[:space:]] is \s, and -i is the i flag.
const ENTERPRISE_FROM_LINE = /^\s*FROM\s.*\sAS\s+enterprise\s*$/i;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/**
 * A bash array assignment from a script (`NAME=(` ... `)`), evaluated by
 * bash itself so quoting and comments mean what they mean to the script.
 * @param {string} script - The script text
 * @param {string} name - The array's name
 * @returns {Array<string>|null} null when the script has no such array
 */
function readBashArray(script, name) {
  const lines = script.split("\n");
  const start = lines.indexOf(`${name}=(`);

  if (start === -1) {
    return null;
  }

  const end = lines.findIndex((line, index) => {
    return index > start && line.trim() === ")";
  });

  if (end === -1) {
    return null;
  }

  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail\n${lines.slice(start, end + 1).join("\n")}\nfor item in \${${name}[@]+"\${${name}[@]}"}; do printf '%s\\n' "$item"; done`,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`bash could not read ${name}: ${result.stderr}`);
  }

  return result.stdout.split("\n").filter((item) => {
    return item.length > 0;
  });
}

/**
 * Every build_docker_images.sh call in a workflow, with its --image and
 * --dockerfile arguments.
 * @param {Object} workflow - The parsed workflow
 * @returns {Array<{job: string, image: (string|undefined), dockerfile: (string|undefined)}>}
 */
function imageBuildsOf(workflow) {
  const builds = [];

  for (const [job, definition] of Object.entries(workflow.jobs || {})) {
    for (const step of definition.steps || []) {
      if (typeof step.run !== "string") {
        continue;
      }

      const commands = step.run.replace(/\\\n\s*/g, " ").split("\n");

      for (const command of commands) {
        if (!command.includes("build_docker_images.sh")) {
          continue;
        }

        builds.push({
          job,
          image: (/--image\s+(\S+)/.exec(command) || [])[1],
          dockerfile: (/--dockerfile\s+(\S+)/.exec(command) || [])[1],
        });
      }
    }
  }

  return builds;
}

// "./packages/App/Dockerfile" -> "packages/App/Dockerfile.tpl"
function templateOf(dockerfile) {
  return `${path.posix.normalize(dockerfile)}.tpl`;
}

function renderForRelease(template) {
  return render(read(template), "production", {
    fileExists: () => {
      return false;
    },
  });
}

/**
 * Whether a rendered Dockerfile has an enterprise target, by the build
 * script's line test and by the stage parser. The two must agree.
 * @param {string} dockerfile
 * @returns {{byBuildScript: boolean, byStages: boolean}}
 */
function enterpriseTarget(dockerfile) {
  return {
    byBuildScript: dockerfile.split("\n").some((line) => {
      return ENTERPRISE_FROM_LINE.test(line);
    }),
    byStages: parseStages(dockerfile).some((stage) => {
      return stage.name === "enterprise";
    }),
  };
}

/**
 * The images whose enterprise tag is its own build.
 * @param {Array<{image: string, dockerfile: string}>} builds
 * @param {(template: string) => string} renderTemplate
 * @returns {Array<string>} Sorted, without duplicates
 */
function enterpriseTargetImages(builds, renderTemplate) {
  const images = new Set();

  for (const build of builds) {
    if (
      enterpriseTarget(renderTemplate(templateOf(build.dockerfile))).byStages
    ) {
      images.add(build.image);
    }
  }

  return [...images].sort();
}

/**
 * @param {Array<string>} listed - ENTERPRISE_IMAGES
 * @param {Array<string>} built - enterpriseTargetImages()
 */
function sbomDrift(listed, built) {
  return {
    notScanned: built.filter((image) => {
      return !listed.includes(image);
    }),
    scannedWithoutTarget: listed.filter((image) => {
      return !built.includes(image);
    }),
  };
}

const releaseBuilds = imageBuildsOf(yaml.load(read(RELEASE_WORKFLOW)));
const sbomScript = read(GENERATE_SBOMS);
const ENTERPRISE_IMAGES = readBashArray(sbomScript, "ENTERPRISE_IMAGES");
const IMAGES = readBashArray(sbomScript, "IMAGES");

describe("the SBOM drift check's own machinery", () => {
  test("reads a bash array the way bash does", () => {
    const script = [
      "#!/usr/bin/env bash",
      "NOT_IT=(",
      "\tother",
      ")",
      "LIST=(",
      "\t# a comment, not an item",
      "\tapp",
      '\t"probe" # trailing comment',
      "\tone two",
      ")",
      "EMPTY=(",
      ")",
      "",
    ].join("\n");

    expect(readBashArray(script, "LIST")).toEqual([
      "app",
      "probe",
      "one",
      "two",
    ]);
    expect(readBashArray(script, "EMPTY")).toEqual([]);
    expect(readBashArray(script, "MISSING")).toBeNull();
  });

  test("reads --image and --dockerfile from multi-line build_docker_images.sh calls", () => {
    const workflow = {
      jobs: {
        "probe-docker-image-build": {
          steps: [
            { uses: "actions/checkout@v4" },
            {
              run: [
                "bash ./Scripts/GHA/build_docker_images.sh \\",
                "  --image probe \\",
                '  --version "1.0" \\',
                "  --dockerfile ./packages/Probe/Dockerfile \\",
                "  --context .",
              ].join("\n"),
            },
          ],
        },
        "unrelated-job": { steps: [{ run: "npm test" }] },
      },
    };

    expect(imageBuildsOf(workflow)).toEqual([
      {
        job: "probe-docker-image-build",
        image: "probe",
        dockerfile: "./packages/Probe/Dockerfile",
      },
    ]);
    expect(templateOf("./packages/Probe/Dockerfile")).toBe(
      "packages/Probe/Dockerfile.tpl",
    );
  });

  test("tells a Dockerfile with an enterprise target from one without", () => {
    expect(
      enterpriseTarget(
        "FROM node AS base\nFROM base AS enterprise-build\nFROM enterprise-build AS enterprise\nFROM base AS community\n",
      ),
    ).toEqual({ byBuildScript: true, byStages: true });
    expect(
      enterpriseTarget("FROM node AS base\nFROM base AS enterprise-build\n"),
    ).toEqual({ byBuildScript: false, byStages: false });
    expect(enterpriseTarget("from node as Enterprise\n")).toEqual({
      byBuildScript: true,
      byStages: true,
    });
  });

  test("names an image that gained an enterprise target but is not scanned, and the reverse (negative control)", () => {
    const builds = [
      { image: "app", dockerfile: "./packages/App/Dockerfile" },
      { image: "probe", dockerfile: "./packages/Probe/Dockerfile" },
      { image: "nginx", dockerfile: "./packages/Nginx/Dockerfile" },
    ];
    const withEnterprise = new Set([
      "packages/App/Dockerfile.tpl",
      "packages/Probe/Dockerfile.tpl",
    ]);
    const fakeRender = (template) => {
      return withEnterprise.has(template)
        ? "FROM node AS base\nFROM base AS enterprise\n"
        : "FROM node\n";
    };
    const built = enterpriseTargetImages(builds, fakeRender);

    expect(built).toEqual(["app", "probe"]);
    expect(sbomDrift(["app"], built)).toEqual({
      notScanned: ["probe"],
      scannedWithoutTarget: [],
    });
    expect(sbomDrift(["app", "probe", "nginx"], built)).toEqual({
      notScanned: [],
      scannedWithoutTarget: ["nginx"],
    });
    expect(sbomDrift(["app", "probe"], built)).toEqual({
      notScanned: [],
      scannedWithoutTarget: [],
    });
  });
});

describe("generate_sboms.sh's ENTERPRISE_IMAGES", () => {
  test("release.yml builds its images with build_docker_images.sh, each from a Dockerfile.tpl", () => {
    const templates = findTemplates(REPO_ROOT);

    expect(releaseBuilds.length).toBeGreaterThanOrEqual(12);

    for (const build of releaseBuilds) {
      expect(build.image).toMatch(/^[a-z0-9-]+$/);
      expect(build.dockerfile).toBeDefined();
      expect({
        image: build.image,
        template: templateOf(build.dockerfile),
      }).toEqual({
        image: build.image,
        template: expect.stringMatching(/Dockerfile\.tpl$/),
      });
      expect(templates).toContain(templateOf(build.dockerfile));
    }
  });

  test("the enterprise-target test mirrors build_docker_images.sh's, and agrees with the stage parser on every template", () => {
    expect(read(BUILD_DOCKER_IMAGES)).toContain(BUILD_SCRIPT_ENTERPRISE_GREP);

    for (const template of findTemplates(REPO_ROOT)) {
      const target = enterpriseTarget(renderForRelease(template));

      expect({
        template,
        agree: target.byBuildScript === target.byStages,
      }).toEqual({ template, agree: true });
    }
  });

  test("is read from the script, and every entry is also a scanned image", () => {
    expect(ENTERPRISE_IMAGES).not.toBeNull();
    expect(IMAGES).not.toBeNull();
    expect(ENTERPRISE_IMAGES.length).toBeGreaterThan(0);

    for (const image of ENTERPRISE_IMAGES) {
      expect(IMAGES).toContain(image);
    }
  });

  test("equals the images release.yml builds from a Dockerfile with an enterprise target", () => {
    const built = enterpriseTargetImages(releaseBuilds, renderForRelease);

    expect(built).toContain("app");
    expect(sbomDrift(ENTERPRISE_IMAGES, built)).toEqual({
      notScanned: [],
      scannedWithoutTarget: [],
    });
  });
});
