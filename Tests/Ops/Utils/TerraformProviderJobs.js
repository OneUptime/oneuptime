"use strict";

/**
 * The workflow jobs that generate the Terraform provider, for the tests that
 * hold them to how it is generated and compiled: Go's memory limit
 * (TerraformProviderGoMemoryLimit), the generator's type check
 * (TerraformProviderGeneratorTypeCheck) and setup-go's cache
 * (TerraformProviderPublishOnce).
 *
 * The provider is gitignored, so a job cannot compile it without generating
 * it first: a job generates it when a step runs one of GENERATES_THE_PROVIDER.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { stepCommandFromRoot } = require("./WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");

const GENERATES_THE_PROVIDER = [
  "npm run generate-terraform-provider",
  "npm run publish-terraform-provider",
];

/**
 * @param {Object} step
 * @returns {boolean} Whether the step generates the provider
 */
function generatesTheProvider(step) {
  const command = stepCommandFromRoot(step);
  return GENERATES_THE_PROVIDER.some((generate) => {
    return command.includes(generate);
  });
}

/**
 * Every job of every workflow that generates the provider, named
 * "<workflow file> <job id>".
 * @returns {Array<{name: string, file: string, id: string, workflow: Object, job: Object}>}
 */
function jobsThatGenerateTheProvider() {
  return fs
    .readdirSync(WORKFLOWS)
    .filter((file) => {
      return /\.ya?ml$/.test(file);
    })
    .sort()
    .flatMap((file) => {
      const workflow =
        yaml.load(fs.readFileSync(path.join(WORKFLOWS, file), "utf8")) || {};
      return Object.entries(workflow.jobs || {})
        .filter(([, job]) => {
          return (job.steps || []).some(generatesTheProvider);
        })
        .map(([id, job]) => {
          return { name: `${file} ${id}`, file, id, workflow, job };
        });
    });
}

module.exports = {
  GENERATES_THE_PROVIDER,
  generatesTheProvider,
  jobsThatGenerateTheProvider,
};
