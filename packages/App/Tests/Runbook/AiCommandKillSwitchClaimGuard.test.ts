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
