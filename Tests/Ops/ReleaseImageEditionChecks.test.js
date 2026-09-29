"use strict";

/**
 * The release workflows check the App images they publish.
 *
 * Scripts/GHA/check_app_image_edition.sh proves an App image is the edition
 * it claims to be: its labels, what is on disk (ee/ or no ee/ anywhere), and
 * what the real Enterprise loader does when it boots in the image. The Build
 * workflow runs it on the images each pull request builds, but a release
 * builds its images again, pushes them, and only its e2e jobs ever pull them
 * back. So each e2e job checks the App tag it is about to boot:
 *
 *   release.yml        test-e2e-release-saas         enterprise-<version>       enterprise
 *                      test-e2e-release-self-hosted  <version>                  community
 *                      test-e2e-release-enterprise   enterprise-<version>       enterprise
 *   test-release.yaml  test-e2e-test-saas            enterprise-<version>-test  enterprise
 *                      test-e2e-test-self-hosted     <version>-test             community
 *                      test-e2e-test-enterprise      enterprise-<version>-test  enterprise
 *
 * In release.yml, push-release-tags waits for all three e2e jobs, so a failed
 * check stops release / enterprise-release from moving onto a wrong image.
 *
 * The two enterprise jobs are the only ones that boot a self-hosted Enterprise
 * stack - the enterprise image with billing OFF, where the license rather than
 * the billing flag decides whether SSO, SCIM and audit logging run - and the
 * only ones that run their suite in two phases against one stack: licensed,
 * then with the trial backdated out from under it. The last describe in this
 * file pins that shape, because a phase that quietly stopped running would
 * leave the job green.
 *
 * The check's boot probe calls into code it only meets inside a real image,
 * so the second half of this suite pins what the probe relies on: the
 * loader's path, options and result, EnterpriseEdition's API, the flags
 * `npm start` gives node, and the Dockerfile setting that keeps ee's Common a
 * link.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const yaml = require("js-yaml");

const {
  render,
  parseStages,
  ancestry,
  instructions,
} = require("./Utils/DockerfileTemplate");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK_SCRIPT = "Scripts/GHA/check_app_image_edition.sh";
const VERSION = "${{needs.read-version.outputs.major_minor}}";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readYaml(relativePath) {
  return yaml.load(read(relativePath));
}

const E2E_JOBS = [
  {
    workflow: ".github/workflows/release.yml",
    job: "test-e2e-release-saas",
    tag: `enterprise-${VERSION}`,
    edition: "enterprise",
  },
  {
    workflow: ".github/workflows/release.yml",
    job: "test-e2e-release-self-hosted",
    tag: VERSION,
    edition: "community",
  },
  {
    workflow: ".github/workflows/test-release.yaml",
    job: "test-e2e-test-saas",
    tag: `enterprise-${VERSION}-test`,
    edition: "enterprise",
  },
  {
    workflow: ".github/workflows/test-release.yaml",
    job: "test-e2e-test-self-hosted",
    tag: `${VERSION}-test`,
    edition: "community",
  },
  {
    workflow: ".github/workflows/release.yml",
    job: "test-e2e-release-enterprise",
    tag: `enterprise-${VERSION}`,
    edition: "enterprise",
  },
  {
    workflow: ".github/workflows/test-release.yaml",
    job: "test-e2e-test-enterprise",
    tag: `enterprise-${VERSION}-test`,
    edition: "enterprise",
  },
];

function stepsOf(workflow, job) {
  const definition = readYaml(workflow).jobs[job];

  if (!definition) {
    throw new Error(`${workflow} has no job ${job}`);
  }

  return definition.steps;
}

function runOf(step) {
  return typeof step.run === "string" ? step.run : "";
}

function indexOfStep(steps, predicate, what) {
  const index = steps.findIndex(predicate);

  if (index === -1) {
    throw new Error(`no ${what} step`);
  }

  return index;
}

function checkSteps(steps) {
  return steps.filter((step) => {
    return runOf(step).includes("check_app_image_edition.sh");
  });
}

// The step that boots the stack: `docker compose ... up ... -d`.
function isStartStep(step) {
  return /docker compose [^\n]*\bup\b[^\n]*\s-d\b/.test(runOf(step));
}

/*
 * The step that runs the e2e suite. The SaaS and Community jobs run the image's
 * default CMD with `up --exit-code-from e2e`; the enterprise jobs run one named
 * suite per phase, which needs `run --rm e2e <command>` to override that CMD.
 */
function isE2eStep(step) {
  const run = runOf(step);

  return run.includes("--exit-code-from e2e") || /\brun --rm e2e\s/.test(run);
}

describe.each(E2E_JOBS)("$workflow $job", ({ workflow, job, tag, edition }) => {
  const steps = stepsOf(workflow, job);

  test(`checks the App image once, as the ${edition} edition`, () => {
    const found = checkSteps(steps);

    expect(found).toHaveLength(1);
    expect(runOf(found[0])).toContain(
      `bash ./${CHECK_SCRIPT} --image "$APP_IMAGE" --edition ${edition}\n`,
    );
  });

  test("the edition is the one the tag names", () => {
    expect(tag.startsWith("enterprise-")).toBe(edition === "enterprise");
  });

  test("checks the image the job boots: docker-compose's app image with the job's APP_TAG", () => {
    const [step] = checkSteps(steps);
    const start = steps.find(isStartStep);
    const exported = /^\s*export APP_TAG=(\S+)\s*$/m.exec(runOf(start));

    expect(step.env).toEqual({ APP_IMAGE: `oneuptime/app:${tag}` });
    expect(exported).not.toBeNull();
    expect(exported[1]).toBe(tag);

    const composeFiles = [...runOf(start).matchAll(/-f (\S+\.ya?ml)/g)].map(
      (match) => {
        return match[1];
      },
    );

    expect(composeFiles[0]).toBe("docker-compose.yml");
    expect(readYaml("docker-compose.yml").services.app.image).toBe(
      "oneuptime/app:${APP_TAG}",
    );

    for (const overlay of composeFiles.slice(1)) {
      const services = readYaml(overlay).services || {};
      expect({ overlay, image: (services.app || {}).image }).toEqual({
        overlay,
        image: undefined,
      });
    }
  });

  test("pulls the image first, and stops if the pull fails", () => {
    const run = runOf(checkSteps(steps)[0]);
    const pull = run.indexOf('docker pull "$APP_IMAGE"\n');

    expect(run.startsWith("set -euo pipefail\n")).toBe(true);
    expect(pull).toBeGreaterThan(-1);
    expect(pull).toBeLessThan(run.indexOf(CHECK_SCRIPT));
  });

  test("runs before the stack boots and before the e2e suite", () => {
    const check = indexOfStep(
      steps,
      (step) => {
        return runOf(step).includes(CHECK_SCRIPT);
      },
      "check",
    );
    const start = indexOfStep(steps, isStartStep, "start");
    const e2e = indexOfStep(steps, isE2eStep, "e2e");

    expect(check).toBeLessThan(start);
    expect(start).toBeLessThan(e2e);
  });

  test("cannot be skipped or ignored, and passes the tag through env rather than into the script", () => {
    const [step] = checkSteps(steps);

    expect(step.if).toBeUndefined();
    expect(step["continue-on-error"]).toBeUndefined();
    expect(runOf(step)).not.toContain("${{");
  });
});

/*
 * The two-phase enterprise e2e jobs.
 *
 * These are the only jobs that boot a self-hosted Enterprise stack, and the
 * only ones whose value comes from running their suite TWICE against that one
 * stack: once while the install is inside its unlicensed 14-day trial, and once
 * after the trial has been backdated out from under it. Everything between the
 * phases is load-bearing and silent when it breaks:
 *
 *   - drop phase B and the job still passes, proving only that enterprise
 *     features work when they are supposed to;
 *   - drop the backdating step and phase B runs against a license that never
 *     lapsed, so a suite asserting refusals fails for the wrong reason - or,
 *     worse, is rewritten until it passes;
 *   - drop the poll and phase B starts inside the 60s license-inputs cache
 *     (ee/Server/License/LicenseSettings.ts), which is a flake, not a failure.
 *
 * There is deliberately no test hook or env var for faking a license state, so
 * the backdated column IS the mechanism; these tests pin it rather than let it
 * drift into one.
 */
const ENTERPRISE_E2E_JOBS = [
  {
    workflow: ".github/workflows/release.yml",
    job: "test-e2e-release-enterprise",
  },
  {
    workflow: ".github/workflows/test-release.yaml",
    job: "test-e2e-test-enterprise",
  },
];

const LICENSED_PHASE = "npm run test-enterprise-licensed";
const LAPSED_PHASE = "npm run test-enterprise-lapsed";
const LICENSE_ENDPOINT = "/api/global-config/license";
const TRIAL_COLUMN = '"enterpriseEditionFirstSeenAt"';

/*
 * Like indexOfStep, but the failure names the phase AND the command it looked
 * for, because "no e2e step" in a job with four of them says nothing.
 */
function requireStep(steps, predicate, missing) {
  const index = steps.findIndex(predicate);

  if (index === -1) {
    throw new Error(missing);
  }

  return index;
}

function indexOfRun(steps, needle, what) {
  return requireStep(
    steps,
    (step) => {
      return runOf(step).includes(needle);
    },
    `${what}: no step in this job runs \`${needle}\``,
  );
}

describe.each(ENTERPRISE_E2E_JOBS)("$workflow $job", ({ workflow, job }) => {
  const steps = stepsOf(workflow, job);

  test("runs the licensed suite, then the lapsed suite, against one booted stack", () => {
    const licensed = indexOfRun(steps, LICENSED_PHASE, "phase A (licensed)");
    const lapsed = indexOfRun(steps, LAPSED_PHASE, "phase B (lapsed)");

    expect({ order: licensed < lapsed }).toEqual({ order: true });
    expect({
      stacksBooted: steps.filter(isStartStep).length,
    }).toEqual({ stacksBooted: 1 });
  });

  test("runs each phase's suite by name, never the whole default suite", () => {
    for (const phase of [LICENSED_PHASE, LAPSED_PHASE]) {
      const index = indexOfRun(steps, phase, `the phase running ${phase}`);
      const run = runOf(steps[index]);

      // `run --rm` overrides the e2e image's CMD; `up` would run `npm test`.
      expect({
        phase,
        overridesTheImageCommand: /\brun --rm e2e\s/.test(run),
      }).toEqual({
        phase,
        overridesTheImageCommand: true,
      });
    }

    expect(
      steps.filter(isE2eStep).map((step) => {
        return runOf(step).includes("--exit-code-from e2e");
      }),
    ).toEqual([false, false]);
  });

  test("expires the trial between the phases, by backdating the column the trial counts from", () => {
    const licensed = indexOfRun(steps, LICENSED_PHASE, "phase A (licensed)");
    const lapsed = indexOfRun(steps, LAPSED_PHASE, "phase B (lapsed)");
    const expiry = indexOfRun(steps, TRIAL_COLUMN, "the trial-expiry step");
    const run = runOf(steps[expiry]);

    expect({ betweenThePhases: licensed < expiry && expiry < lapsed }).toEqual({
      betweenThePhases: true,
    });
    expect(run).toContain("psql");
    expect(run).toContain('UPDATE "GlobalConfig"');
    // Past the 14-day trial (Common/Types/EnterpriseLicense/EnterpriseLicensePeriods.ts).
    expect(run).toMatch(/INTERVAL '(\d+) days'/);
    expect(Number(/INTERVAL '(\d+) days'/.exec(run)[1])).toBeGreaterThan(14);
  });

  test("fails loudly if backdating the trial updated no row", () => {
    const run = runOf(
      steps[indexOfRun(steps, TRIAL_COLUMN, "the trial-expiry step")],
    );

    /*
     * No row means the App never stamped the column, so the install never
     * started a trial - a bug in ee/Server/License/LicenseStore.ts, and a
     * phase B that would otherwise run against a license that never lapsed.
     */
    expect(run).toContain("::error::");
    expect(run).toContain("exit 1");
  });

  test("waits for the app to report the lapse before starting the lapsed phase", () => {
    const expiry = indexOfRun(steps, TRIAL_COLUMN, "the trial-expiry step");
    const lapsed = indexOfRun(steps, LAPSED_PHASE, "phase B (lapsed)");
    const poll = requireStep(
      steps,
      (step) => {
        const run = runOf(step);

        return run.includes(LICENSE_ENDPOINT) && run.includes("while");
      },
      `the license poll: no step in this job loops on ${LICENSE_ENDPOINT}, so the lapsed phase would start inside the 60s license-inputs cache`,
    );
    const run = runOf(steps[poll]);

    expect({
      afterTheLapseAndBeforePhaseB: expiry < poll && poll < lapsed,
    }).toEqual({
      afterTheLapseAndBeforePhaseB: true,
    });
    // The two fields that say the license really lapsed, not just that it changed.
    expect(run).toContain('"missing"');
    expect(run).toContain("licenseValid");
    // Bounded, and loud when the bound is reached.
    expect(run).toMatch(/date \+%s\) \+ \d+ \)\)/);
    expect(run).toContain("::error::");
  });
});

describe("release.yml", () => {
  const jobs = readYaml(".github/workflows/release.yml").jobs;

  test("moves release and enterprise-release only after every checked e2e job passes", () => {
    const needs = jobs["push-release-tags"].needs;

    expect(needs).toContain("test-e2e-release-saas");
    expect(needs).toContain("test-e2e-release-self-hosted");
    expect(needs).toContain("test-e2e-release-enterprise");
    expect(jobs["push-release-tags"].strategy.matrix.image).toContain("app");
  });

  test("the App build and merge publish version tags only, never the release tags", () => {
    const appRuns = ["app-docker-image-build", "app-docker-image-merge"]
      .flatMap((name) => {
        return jobs[name].steps;
      })
      .map(runOf)
      .join("\n");

    expect(appRuns).toContain(
      '--tags "${SANITIZED_VERSION},enterprise-${SANITIZED_VERSION}"',
    );
    expect(appRuns).not.toMatch(/--extra(-enterprise)?-tags/);
    expect(appRuns).not.toMatch(/\brelease\b/);
  });
});

/*
 * What the boot probe relies on. It runs inside the image as
 *   node <npm start's flags> --require ts-node/register -e <probe>
 * from /usr/src/app, so these are checked against packages/App as it is.
 */
describe("check_app_image_edition.sh's boot probe", () => {
  const check = read(CHECK_SCRIPT);
  const probeMatch = /<<'JS' \|\| true\n([\s\S]*?)\nJS\n/.exec(check);
  const probe = probeMatch ? probeMatch[1] : "";
  const loader = read("packages/App/Utils/EnterpriseLoader.ts");
  const enterpriseEdition = read(
    "packages/Common/Server/Enterprise/EnterpriseEdition.ts",
  );
  const moduleContract = read(
    "packages/Common/Server/Enterprise/EnterpriseServerModule.ts",
  );

  test("is in the script, and is valid JavaScript", () => {
    expect(probe.length).toBeGreaterThan(0);
    expect(() => {
      return new vm.Script(probe, { filename: "boot-probe.js" });
    }).not.toThrow();
  });

  test("loads the loader from the App root, which is where the loader lives", () => {
    expect(probe).toContain(
      'require(path.join(appRoot, "Utils", "EnterpriseLoader")).default',
    );
    expect(check).toContain("-w /usr/src/app");
    expect(loader).toContain("export default class EnterpriseLoader");
    expect(loader).toContain("public static async load(");
  });

  test("passes only options the loader has", () => {
    const loadCall = /\.load\(\{([\s\S]*?)\}\)/.exec(probe);
    const optionNames = [...loadCall[1].matchAll(/(\w+):/g)].map((match) => {
      return match[1];
    });

    expect(optionNames).toEqual([
      "edition",
      "initTimeoutInMs",
      "licenseLoadTimeoutInMs",
      "isBillingEnabled",
      "allowBillingWithoutEnterprise",
      "isEnterpriseEditionRequested",
    ]);

    const optionsInterface =
      /export interface EnterpriseLoaderOptions \{([\s\S]*?)\n\}/.exec(
        loader,
      )[1];

    for (const name of optionNames) {
      expect({
        name,
        declared: optionsInterface.includes(`${name}?:`),
      }).toEqual({ name, declared: true });
    }
  });

  test("asks for edition auto, which the loader accepts", () => {
    expect(probe).toContain('edition: "auto"');
    expect(read("packages/Common/Server/EnvironmentConfig.ts")).toMatch(
      /ONEUPTIME_EDITION_SETTINGS[^\n]*=[\s\S]{0,200}"auto"/,
    );
  });

  test("reads only result fields the loader returns, and compares outcomes the loader has", () => {
    const resultInterface =
      /export interface EnterpriseLoadResult \{([\s\S]*?)\n\}/.exec(loader)[1];

    for (const field of [
      "outcome",
      "directory",
      "initCompleted",
      "initError",
      "licenseSnapshot",
    ]) {
      expect(probe).toContain(`result.${field}`);
      expect({
        field,
        declared: resultInterface.includes(`${field}:`),
      }).toEqual({ field, declared: true });
    }

    const outcomes = /export type EnterpriseLoadOutcome =([\s\S]*?);/.exec(
      loader,
    )[1];

    for (const outcome of ["loaded", "not-found"]) {
      expect(check).toContain(`result.get("outcome") == "${outcome}"`);
      expect(outcomes).toContain(`"${outcome}"`);
    }
  });

  test("asks EnterpriseEdition what it registered, through the API it has", () => {
    expect(probe).toContain(
      'const EDITION_MODULE = "Common/Server/Enterprise/EnterpriseEdition";',
    );
    expect(probe).toContain("EnterpriseEdition.getModule()");
    expect(probe).toContain("EnterpriseEdition.isLoaded()");
    expect(probe).toContain("enterpriseModule.version");
    expect(enterpriseEdition).toContain(
      "export default class EnterpriseEdition",
    );
    expect(enterpriseEdition).toContain("public static getModule()");
    expect(enterpriseEdition).toContain("public static isLoaded()");
    expect(moduleContract).toMatch(/^\s*version: string;$/m);
  });

  test("starts node the way `npm start` does", () => {
    const start = JSON.parse(read("packages/App/package.json")).scripts.start;

    expect(start).toContain("--no-node-snapshot");
    expect(start).toContain("--require ts-node/register");
    expect(start).toContain("--max-old-space-size=8096");
    expect(check).toContain(
      "--no-node-snapshot --max-old-space-size=8096 --require ts-node/register",
    );
    expect(check).toContain("-e TS_NODE_TRANSPILE_ONLY=1");
  });

  test("runs with billing off and without a network, so it never needs a database", () => {
    expect(check).toContain("docker run --rm --network none -w /usr/src/app");
    expect(check).toContain("-e BILLING_ENABLED=false");
    expect(probe).toContain("isBillingEnabled: false");
  });

  test("always exits, and has a watchdog", () => {
    expect(probe).toContain("process.exit(code)");
    expect(probe).toContain("EE_PROBE_TIMEOUT_MS");
    expect(check).toMatch(/PROBE_COMMAND=\(timeout /);
  });
});

describe("packages/App/Dockerfile.tpl keeps ee's Common and App links", () => {
  const stages = parseStages(
    render(read("packages/App/Dockerfile.tpl"), "production"),
  );
  const base = stages.find((stage) => {
    return stage.name === "base";
  });

  test("the base stage pins npm's install-links to false", () => {
    expect(instructions(base.body)).toContain(
      "RUN npm config set install-links false --global",
    );
  });

  test("the Enterprise build, where ee's dependencies are installed, is built on it", () => {
    expect(
      ancestry(stages, "enterprise-build").map((stage) => {
        return stage.name;
      }),
    ).toContain("base");
  });

  test("the image check fails an Enterprise image whose ee has its own Common", () => {
    const check = read(CHECK_SCRIPT);

    expect(check).toContain(
      `check "ee's Common dependency is /usr/src/Common" links_to "$EE/node_modules/Common" "$ROOT/usr/src/Common"`,
    );
    expect(check).toContain("exactly one EnterpriseEdition module is loaded");
  });
});
