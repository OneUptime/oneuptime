"use strict";

/**
 * The App's Iron Bank project (IronBank/App) ships the image the release ships,
 * on Iron Bank's base image.
 *
 * Iron Bank builds IronBank/App/Dockerfile in its own pipeline, offline, and the
 * Dockerfile copies /usr/src out of the release's Enterprise Edition image
 * (IronBank/README.md). A COPY --from brings files and nothing else, so the
 * Dockerfile sets again everything the release's runtime and enterprise stages
 * set. Nothing would notice a start command, a user, an environment variable or
 * a package the App's Dockerfile changed and the Iron Bank one kept, until a
 * DoD installation ran it. So this holds IronBank/App to
 * packages/App/Dockerfile.tpl as `npm run prerun` renders it for production:
 * the enterprise stage's start command, user, working directory, ports and
 * environment (with the runtime stage it starts from), every label of the
 * release, both stages' commands (bash, curl, the PostgreSQL clients, npm's
 * cache directory) and what the enterprise stage copies.
 *
 * IronBankProjects.test.js holds every project, the App's included, to Iron
 * Bank's rules (the pinned release, the base image, the manifest, the files
 * in git); the Iron Bank Preflight workflow builds, boots and scans it.
 */

const {
  render,
  parseStages,
  instructions,
} = require("./Utils/DockerfileTemplate");
const {
  read,
  pairs,
  all,
  last,
  commands,
  copies,
  readProject,
} = require("./Utils/IronBank");

const project = readProject("App");
const finalInstructions = project.finalInstructions;
const VERSION = project.manifest.labels["org.opencontainers.image.version"];

const appStages = parseStages(
  render(read("packages/App/Dockerfile.tpl"), "production"),
);
const runtimeStage = appStages.find((stage) => {
  return stage.name === "runtime";
});
const enterpriseStage = appStages.find((stage) => {
  return stage.name === "enterprise";
});
// What the enterprise image is: the runtime stage, then the enterprise stage.
const enterpriseInstructions = [
  ...instructions(runtimeStage.body),
  ...instructions(enterpriseStage.body),
];

describe("IronBank/App runs the image the release runs", () => {
  test("reads both Dockerfiles' stages (the checks below are not vacuous)", () => {
    expect(
      project.stages.map((stage) => {
        return stage.name;
      }),
    ).toEqual(["release", null]);
    expect(runtimeStage).toBeDefined();
    expect(enterpriseStage).toBeDefined();
    expect(enterpriseStage.from).toBe("runtime");
    expect(enterpriseInstructions.length).toBeGreaterThan(10);
  });

  test("the same start command, user, working directory and ports", () => {
    for (const keyword of ["CMD", "USER", "WORKDIR"]) {
      expect({ keyword, ironBank: last(finalInstructions, keyword) }).toEqual({
        keyword,
        ironBank: last(enterpriseInstructions, keyword),
      });
    }
    expect(all(finalInstructions, "EXPOSE")).toEqual(
      all(enterpriseInstructions, "EXPOSE"),
    );
  });

  test("the same environment, with the release's version and commit for its build arguments", () => {
    const expected = pairs(enterpriseInstructions, "ENV");
    const environment = pairs(finalInstructions, "ENV");

    // The Enterprise loader's marker: ee/ must load.
    expect(expected["ONEUPTIME_EDITION"]).toBe("enterprise");
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
    const expected = pairs(enterpriseInstructions, "LABEL");
    const labels = {
      ...project.manifest.labels,
      ...pairs(finalInstructions, "LABEL"),
    };
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

  test("both stages' commands, except updating npm, which Iron Bank's base image brings", () => {
    const release = commands(enterpriseInstructions).filter((command) => {
      return !command.includes("UpdateNpmCli");
    });

    expect(release).toEqual(
      expect.arrayContaining([
        "apk add --no-cache bash curl",
        "apk add --no-cache postgresql16-client postgresql17-client postgresql18-client",
      ]),
    );
    expect(commands(finalInstructions)).toEqual(
      expect.arrayContaining(release),
    );
  });

  test("/usr/src out of the release, as the enterprise stage copies it out of its build", () => {
    expect(
      copies(instructions(enterpriseStage.body))
        .filter((copy) => {
          return copy.from !== null;
        })
        .map((copy) => {
          return `${copy.sources.join(" ")} ${copy.destination}`;
        }),
    ).toEqual(["/usr/src /usr/src"]);
    expect(all(finalInstructions, "COPY")).toEqual([
      "COPY --from=release /usr/src /usr/src",
    ]);
  });
});
