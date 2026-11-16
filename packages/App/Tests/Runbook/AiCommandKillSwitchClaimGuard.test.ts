import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Guard: Enable AI is read where every agent claims its work.
 *
 * A command OneUptime AI composed reaches infrastructure through one of the
 * agents' ingresses: a Runner, a cluster's Kubernetes AI agent, a resource's
 * AI agent (a cloud account's Cloud AI agent included). A job enqueued a
 * moment before the project turned Enable AI off must be failed there,
 * never served (Common/Server/Utils/AI/AiCommandKillSwitch). This holds
 * every ingress that serves claim-next-job to that read, so a new agent's
 * ingress cannot forget it. The behaviour itself is pinned by each
 * ingress's suite ("with Enable AI turned off since the job was
 * enqueued").
 */

const INGRESS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Runbook",
  "API",
);

const CLAIM_ROUTE_MARKER: string = "`/claim-next-job`";
const KILL_SWITCH_READ: string = "AiCommandKillSwitch.getClaimRefusal({";

function ingressesServingClaims(): Array<string> {
  return fs
    .readdirSync(INGRESS_DIRECTORY)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .filter((name: string): boolean => {
      return fs
        .readFileSync(path.join(INGRESS_DIRECTORY, name), "utf-8")
        .includes(CLAIM_ROUTE_MARKER);
    })
    .sort();
}

describe("every agent ingress reads Enable AI as a job leaves OneUptime", () => {
  test("finds the three agents that claim work: a Runner, a Kubernetes AI agent, a resource AI agent", () => {
    expect(ingressesServingClaims()).toEqual([
      "KubernetesAiAgentIngress.ts",
      "ResourceAiAgentIngress.ts",
      "RunnerIngress.ts",
    ]);
  });

  test.each([
    "KubernetesAiAgentIngress.ts",
    "ResourceAiAgentIngress.ts",
    "RunnerIngress.ts",
  ])("%s fails a claimed AI command while Enable AI is off", (name: string) => {
    const source: string = fs.readFileSync(
      path.join(INGRESS_DIRECTORY, name),
      "utf-8",
    );

    expect(source).toContain(
      'import AiCommandKillSwitch from "Common/Server/Utils/AI/AiCommandKillSwitch";',
    );
    expect(source).toContain(KILL_SWITCH_READ);
    // The claim's own project, which every claim query holds the job to.
    expect(source).toContain("projectId: agent.projectId,");
  });

  test("the read comes after the claim and before anything is served", () => {
    for (const name of ingressesServingClaims()) {
      const source: string = fs.readFileSync(
        path.join(INGRESS_DIRECTORY, name),
        "utf-8",
      );
      const claimHandler: number = source.indexOf("public async claimNextJob(");
      const read: number = source.indexOf(KILL_SWITCH_READ, claimHandler);
      const served: number = source.indexOf("job: ", read);

      expect(claimHandler).toBeGreaterThan(0);
      expect(read).toBeGreaterThan(claimHandler);
      expect(served).toBeGreaterThan(read);
    }
  });
});

/*
 * Guard: Enable AI is read again on every job heartbeat.
 *
 * An agent that already holds an AI command when the project turns Enable
 * AI off is told to stop by its job's heartbeat ({ status: "ok", stop: true,
 * reason }): the heartbeat it sends right before a command starts keeps the
 * command from starting. This holds every ingress that serves a job
 * heartbeat to that read, after the lease is renewed (so a stopped agent
 * still reports what it did) and before it answers. The behaviour itself is
 * pinned by each ingress's suite ("with Enable AI turned off since the
 * claim").
 */

const JOB_HEARTBEAT_ROUTE_MARKER: string = "`/job/:jobId/heartbeat`";
const LEASE_RENEWAL: string = "RunnerJobService.heartbeatJob({";
const STOP_READ: string = "RunnerJobService.getStopReasonOfHeldJob(";
const STOP_ANSWER: string =
  'stop ? { status: "ok", stop: true, reason: stop } : { status: "ok" }';

function ingressesServingJobHeartbeats(): Array<string> {
  return fs
    .readdirSync(INGRESS_DIRECTORY)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .filter((name: string): boolean => {
      return fs
        .readFileSync(path.join(INGRESS_DIRECTORY, name), "utf-8")
        .includes(JOB_HEARTBEAT_ROUTE_MARKER);
    })
    .sort();
}

describe("every agent ingress reads Enable AI on a held job's heartbeat", () => {
  test("finds the three agents that hold jobs: a Runner, a Kubernetes AI agent, a resource AI agent", () => {
    expect(ingressesServingJobHeartbeats()).toEqual([
      "KubernetesAiAgentIngress.ts",
      "ResourceAiAgentIngress.ts",
      "RunnerIngress.ts",
    ]);
  });

  test.each([
    "KubernetesAiAgentIngress.ts",
    "ResourceAiAgentIngress.ts",
    "RunnerIngress.ts",
  ])(
    "%s renews the lease, then reads the stop, then answers it",
    (name: string) => {
      const source: string = fs.readFileSync(
        path.join(INGRESS_DIRECTORY, name),
        "utf-8",
      );
      const handler: number = source.indexOf("public async heartbeatJob(");
      const renewal: number = source.indexOf(LEASE_RENEWAL, handler);
      const read: number = source.indexOf(STOP_READ, renewal);
      const answered: number = source.indexOf(STOP_ANSWER, read);
      const nextHandler: number = source.indexOf("public async ", handler + 1);

      expect(handler).toBeGreaterThan(0);
      expect(renewal).toBeGreaterThan(handler);
      expect(read).toBeGreaterThan(renewal);
      expect(answered).toBeGreaterThan(read);
      // All of it inside the heartbeat's own handler.
      expect(nextHandler === -1 || answered < nextHandler).toBe(true);
      // The agent's own project, which every claim holds the job to.
      expect(source.slice(read, answered)).toContain(
        "projectId: agent.projectId,",
      );
    },
  );
});
