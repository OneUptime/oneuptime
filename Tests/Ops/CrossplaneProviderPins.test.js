"use strict";

/**
 * The Crossplane Provider Pins workflow (#6616): are the Crossplane
 * provider's pinned Go modules and test tools at their newest compatible
 * releases?
 *
 * `npm run check-crossplane-provider-pins -- --keep-issue`
 * (Scripts/CrossplaneProvider/CheckPins.ts) reads the releases and keeps one
 * issue that lists every pin behind; the generator's own suite
 * (Scripts/CrossplaneProvider/Tests/Pins.test.ts) tests what it decides.
 * This holds the workflow around it to what its header says: weekly and by
 * hand, never for a pull request, since it writes issues; a token that may
 * write issues and nothing else, in OneUptime's repository only; and the
 * issue kept from main's run alone.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { stepCommand } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = ".github/workflows/crossplane-provider-pins.yml";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const raw = read(WORKFLOW);
const workflow = yaml.load(raw);
const job = workflow.jobs["check-pins"];
const checkStep = job.steps.find((step) => {
  return stepCommand(step).includes("check-crossplane-provider-pins");
});

describe("the Crossplane Provider Pins workflow", () => {
  test("runs every week and by hand, and for no pull request", () => {
    // js-yaml reads the key `on` as the string "on".
    const triggers = Object.keys(workflow.on).sort();

    expect(triggers).toEqual(["schedule", "workflow_dispatch"]);
    expect(workflow.on.schedule).toHaveLength(1);
    // One day a week: minute, hour, any day of the month, any month, a weekday.
    expect(workflow.on.schedule[0].cron).toMatch(/^\d+ \d+ \* \* [0-6]$/);
  });

  test("may read the code and write issues, nothing more", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toEqual({ contents: "read", issues: "write" });
    expect(Object.keys(workflow.jobs)).toEqual(["check-pins"]);
  });

  test("keeps the issue in OneUptime's repository only", () => {
    expect(job.if).toBe("${{ github.repository == 'OneUptime/oneuptime' }}");
  });

  test("keeps the issue from main's run, with the job's own token", () => {
    expect(checkStep).toBeDefined();
    expect(checkStep.run).toBe(
      "npm run check-crossplane-provider-pins -- ${KEEP_ISSUE}",
    );
    expect(checkStep.env).toEqual({
      GH_TOKEN: "${{ github.token }}",
      GH_REPO: "${{ github.repository }}",
      KEEP_ISSUE:
        "${{ github.ref == 'refs/heads/main' && '--keep-issue' || '' }}",
    });
    // Its only credential is that token: no secret reaches this job.
    expect(raw).not.toContain("secrets.");
  });

  test("installs the root's packages, which run the checker", () => {
    const installs = job.steps.filter((step) => {
      return step.uses === "./.github/actions/npm-install";
    });

    expect(installs).toHaveLength(1);
    expect((installs[0].with || {})["working-directory"]).toBeUndefined();
    expect(job.steps.indexOf(installs[0]) < job.steps.indexOf(checkStep)).toBe(
      true,
    );
  });

  test("runs the checker the root's package.json names", () => {
    const scripts = JSON.parse(read("package.json")).scripts;

    expect(scripts["check-crossplane-provider-pins"]).toBe(
      "node --require ts-node/register/transpile-only ./Scripts/CrossplaneProvider/CheckPins.ts",
    );
    expect(
      fs.existsSync(
        path.join(REPO_ROOT, "Scripts", "CrossplaneProvider", "CheckPins.ts"),
      ),
    ).toBe(true);
  });

  test("names the issue its checker keeps, and the issue names the workflow", () => {
    const pins = read("Scripts/CrossplaneProvider/Core/Pins.ts");
    const title = pins.match(/PINS_ISSUE_TITLE: string =\s*"([^"]+)"/)[1];

    expect(raw.replace(/\n# /g, " ")).toContain(`"${title}"`);
    expect(workflow.name).toBe("Crossplane Provider Pins");
    expect(pins).toContain("kept by the Crossplane Provider Pins workflow");
  });

  test("the Crossplane Provider workflow tests the checker on pull requests", () => {
    const provider = yaml.load(
      read(".github/workflows/crossplane-provider.yml"),
    );

    expect(provider.on.pull_request.paths).toContain(
      "Scripts/CrossplaneProvider/**",
    );
    expect(
      provider.jobs["crossplane-e2e"].steps.some((step) => {
        return (
          step["working-directory"] === "Scripts/CrossplaneProvider" &&
          stepCommand(step) === "npm test"
        );
      }),
    ).toBe(true);
  });
});
