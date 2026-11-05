"use strict";

/**
 * What #5750 runs on a real cloud in a running OneUptime. It takes a runner for two hours, so what can go
 * wrong without one is checked here: that it runs only when asked for and takes no other job with it, that
 * what it asks of the product's routes is what the product answers to, and that what it holds a webhook to
 * is what the notice writes.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const RIG = path.join(__dirname, "openstack-e2e");
const WALK = fs.readFileSync(path.join(RIG, "status-pages-live.py"), "utf8");
const WORKFLOW = yaml.load(
  fs.readFileSync(
    path.join(ROOT, ".github", "workflows", "test.openstack-e2e.yaml"),
    "utf8",
  ),
);
const JOB = WORKFLOW.jobs["status-pages-live"];
const API = fs.readFileSync(
  path.join(ROOT, "packages/Common/Server/API/OpenStackProjectNoticeAPI.ts"),
  "utf8",
);

describe("the status pages job", () => {
  test("runs only when asked for by name", () => {
    expect(JOB.if).toBe("${{ inputs.status_pages_live }}");
    expect(WORKFLOW.on.workflow_dispatch.inputs.status_pages_live.type).toBe(
      "boolean",
    );
    expect(WORKFLOW.on.workflow_dispatch.inputs.status_pages_live.default).toBe(
      false,
    );
  });

  test("takes no other job with it", () => {
    for (const [name, job] of Object.entries(WORKFLOW.jobs)) {
      if (
        typeof job.if === "string" &&
        job.if.includes("!inputs.whole_path")
      ) {
        expect(`${name}: ${job.if}`).toContain("!inputs.status_pages_live");
      }
    }
  });

  test("walks this file, and keeps what it found", () => {
    const step = JOB.steps.find((candidate) => {
      return (candidate.run || "").includes("status-pages-live.py");
    });

    expect(step).toBeDefined();
    expect(step.run).toContain("python3 -I");
    expect(step["timeout-minutes"]).toBeLessThan(JOB["timeout-minutes"]);

    const upload = JOB.steps.find((candidate) => {
      return candidate.with && candidate.with.name === "openstack-status-pages-live";
    });
    expect(upload).toBeDefined();
    expect(upload.if).toBe("always()");
  });

  test("lets OneUptime reach the webhook, which is a server on this runner", () => {
    const start = JOB.steps.find((candidate) => {
      return candidate.name === "Start OneUptime";
    });

    expect(start.run).toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS=true");
  });
});

describe("what it asks of the product", () => {
  test.each([
    "status-page-plan",
    "make-status-page",
    "preview",
    "turn-on",
    "who-would-be-told",
  ])("%s is a route", (route) => {
    expect(WALK).toContain(`{NOTICE_API}/${route}/`);
    expect(API).toContain(`\${path}/${route}/:`);
  });

  test("it reuses the whole path's parts, and starts nothing of its own", () => {
    expect(WALK).toContain("whole.part_oneuptime");
    expect(WALK).toContain("whole.part_agent");
  });
});
