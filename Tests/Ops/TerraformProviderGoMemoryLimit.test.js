"use strict";

/**
 * Go compiles the Terraform provider with a soft memory limit, everywhere CI
 * compiles it.
 *
 * The generated provider's internal/provider was one Go package, some 985
 * files and 60 MB of Go. With Go's default garbage collection the compiler
 * peaked at about 15 GB, for `go build` and for the test binary `go test`
 * builds alike, while the Node.js generator held another 1.5 GB: more than
 * the 16 GB of a GitHub-hosted runner. Terraform Provider Generation and
 * Terraform Provider E2E Tests both lost their runner in "Generate Terraform
 * provider" on the 14.0.109 release gate (#7559). The generated resources
 * are split into packages now (#7591), each compile far below the limit,
 * which stays as a guard rail.
 *
 * GOMEMLIMIT makes Go collect garbage more often as its memory nears the
 * limit. Scripts/TerraformProvider/Core/GoCommand.ts sets it for every Go
 * command the generators run, unless the caller set one. The provider is
 * compiled again after generation - go build, go vet and go test, the e2e
 * suites' build, GoReleaser's cross-compiles when it is published, and the
 * Crossplane provider, which links it in - so every job that generates it
 * sets the same limit in its env, and publish-terraform-provider.sh sets it
 * for the Go it runs, as a default a caller's own value overrides.
 */

const fs = require("fs");
const path = require("path");

const { stepCommandFromRoot } = require("./Utils/WorkflowStep");
const {
  jobsThatGenerateTheProvider,
} = require("./Utils/TerraformProviderJobs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GO_COMMAND = "Scripts/TerraformProvider/Core/GoCommand.ts";
const PUBLISH_SCRIPT =
  "Scripts/TerraformProvider/publish-terraform-provider.sh";

/*
 * A job that generates the provider compiles it (Utils/TerraformProviderJobs
 * says how one is found). The jobs that did on 2026-11-13, so a reading that
 * finds none fails.
 */
const KNOWN_JOBS = [
  "crossplane-provider.yml crossplane-e2e",
  "release.yml publish-crossplane-provider",
  "release.yml publish-terraform-provider",
  "terraform-provider-e2e.yml terraform-e2e-tests",
  "terraform-provider-generation.yml generate-terraform-provider",
  "test-release.yaml publish-terraform-provider",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// GO_MEMORY_LIMIT in GoCommand.ts, as written there.
function generatorLimit() {
  const match = read(GO_COMMAND).match(
    /^export const GO_MEMORY_LIMIT: string = "([^"]+)";$/m,
  );
  if (!match) {
    throw new Error(`${GO_COMMAND} sets no GO_MEMORY_LIMIT`);
  }
  return match[1];
}

const limit = generatorLimit();
const jobs = jobsThatGenerateTheProvider();

describe("the generators' limit", () => {
  test("is a size Go reads: a whole number of bytes, KiB, MiB, GiB or TiB", () => {
    expect(limit).toMatch(/^[1-9][0-9]*(B|KiB|MiB|GiB|TiB)$/);
  });
});

describe("every job that generates the Terraform provider", () => {
  test("is found", () => {
    expect(
      jobs.map(({ name }) => {
        return name;
      }),
    ).toEqual(expect.arrayContaining(KNOWN_JOBS));
  });

  test.each(
    jobs.map(({ name }) => {
      return name;
    }),
  )("%s gives Go the generators' limit, for all its steps", (name) => {
    const { job } = jobs.find((entry) => {
      return entry.name === name;
    });

    expect((job.env || {}).GOMEMLIMIT).toBe(limit);

    // No step sets a value of its own over it.
    const overridden = (job.steps || [])
      .filter((step) => {
        return (step.env || {}).GOMEMLIMIT !== undefined;
      })
      .map((step) => {
        return step.name || stepCommandFromRoot(step);
      });
    expect(overridden).toEqual([]);
  });
});

describe(PUBLISH_SCRIPT, () => {
  test("gives the Go it runs the generators' limit, unless its caller set one", () => {
    const lines = read(PUBLISH_SCRIPT).split("\n");
    const setsTheLimit = `export GOMEMLIMIT="\${GOMEMLIMIT:-${limit}}"`;

    expect(lines).toContain(setsTheLimit);
    // At the top level, before main runs anything.
    expect(lines.indexOf(setsTheLimit)).toBeLessThan(
      lines.indexOf('main "$@"'),
    );
  });
});
