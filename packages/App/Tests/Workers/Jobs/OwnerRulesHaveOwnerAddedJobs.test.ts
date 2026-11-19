import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN OWNER RULE'S NOTIFY OWNERS DOES WHAT IT SAYS (#9681).
 *
 * Every owner rule form shows Notify Owners - "Tell people when this rule
 * makes them owners", on by default - and its engine writes each owner it
 * adds not notified yet, for a worker job to tell. Data Observability's
 * table, data store and pipeline rules had no such job, so the toggle told
 * nobody, and neither did adding an owner on an Owners page; their jobs
 * came with #9681. These read the models and the jobs as text: every owner
 * rule's owner rows are read by an owner-added job (on tellOwnersAdded), or
 * the rule is one of the known gaps, which #9700 is to close - by a job,
 * or by hiding the toggle. A new owner rule without a job fails here, and
 * so does a gap that got its job but is still listed.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");
const MODELS: string = path.join(PACKAGES, "Common/Models/DatabaseModels");
const JOBS: string = path.join(PACKAGES, "App/FeatureSet/Workers/Jobs");

// The owner rules whose owner rows no job reads yet (#9700).
const KNOWN_GAPS: ReadonlyArray<string> = [
  "CephClusterOwnerRule",
  "CloudResourceOwnerRule",
  "DashboardOwnerRule",
  "DatabaseServerOwnerRule",
  "DockerHostOwnerRule",
  "DockerSwarmClusterOwnerRule",
  "HostOwnerRule",
  "IncomingCallPolicyOwnerRule",
  "IoTFleetOwnerRule",
  "KubernetesClusterOwnerRule",
  "MessageQueueOwnerRule",
  "OnCallDutyPolicyOwnerRule",
  "OnCallDutyPolicyScheduleOwnerRule",
  "OpenStackCloudOwnerRule",
  "PodmanHostOwnerRule",
  "ProxmoxClusterOwnerRule",
  "RumApplicationOwnerRule",
  "RunbookOwnerRule",
  "ServerlessFunctionOwnerRule",
  "ServiceOwnerRule",
  "StorageArrayOwnerRule",
  "VMwareVCenterOwnerRule",
  "WorkflowOwnerRule",
];

// Every owner rule model with a Notify Owners column.
function ownerRulesThatNotify(): Array<string> {
  return fs
    .readdirSync(MODELS)
    .filter((file: string): boolean => {
      return file.endsWith("OwnerRule.ts");
    })
    .filter((file: string): boolean => {
      return fs
        .readFileSync(path.join(MODELS, file), "utf8")
        .includes("public notifyOwners?");
    })
    .map((file: string): string => {
      return file.replace(/\.ts$/, "");
    })
    .sort();
}

// Every job file, as text.
function jobSources(): Array<{ file: string; source: string }> {
  const sources: Array<{ file: string; source: string }> = [];

  for (const folder of fs.readdirSync(JOBS)) {
    const folderPath: string = path.join(JOBS, folder);

    if (!fs.statSync(folderPath).isDirectory()) {
      continue;
    }

    for (const file of fs.readdirSync(folderPath)) {
      if (file.endsWith(".ts")) {
        sources.push({
          file: `${folder}/${file}`,
          source: fs.readFileSync(path.join(folderPath, file), "utf8"),
        });
      }
    }
  }

  return sources;
}

// The owner-added job that reads a rule's owner rows, if any.
function ownerAddedJobOf(
  rule: string,
  jobs: Array<{ file: string; source: string }>,
): string | null {
  const resource: string = rule.replace(/OwnerRule$/, "");

  const job: { file: string; source: string } | undefined = jobs.find(
    (candidate: { file: string; source: string }): boolean => {
      return (
        candidate.source.includes("tellOwnersAdded") &&
        candidate.source.includes(
          `Common/Server/Services/${resource}OwnerUserService"`,
        ) &&
        candidate.source.includes(
          `Common/Server/Services/${resource}OwnerTeamService"`,
        )
      );
    },
  );

  return job ? job.file : null;
}

describe("every owner rule's Notify Owners", () => {
  const rules: Array<string> = ownerRulesThatNotify();
  const jobs: Array<{ file: string; source: string }> = jobSources();

  test("is read from the models: the owner rules are found", () => {
    expect(rules.length).toBeGreaterThan(30);
    expect(rules).toContain("MonitorOwnerRule");
    expect(rules).toContain("DataAssetOwnerRule");
  });

  test("has an owner-added job that tells the people its rule adds, but the known gaps", () => {
    const withoutJob: Array<string> = rules.filter((rule: string): boolean => {
      return ownerAddedJobOf(rule, jobs) === null;
    });

    expect(withoutJob).toEqual([...KNOWN_GAPS].sort());
  });

  test("tells a table's, a data store's and a pipeline's new owners (#9681)", () => {
    expect({
      DataAssetOwnerRule: ownerAddedJobOf("DataAssetOwnerRule", jobs),
      DataPipelineOwnerRule: ownerAddedJobOf("DataPipelineOwnerRule", jobs),
      DataStoreOwnerRule: ownerAddedJobOf("DataStoreOwnerRule", jobs),
    }).toEqual({
      DataAssetOwnerRule: "DataAssetOwners/SendOwnerAddedNotification.ts",
      DataPipelineOwnerRule: "DataPipelineOwners/SendOwnerAddedNotification.ts",
      DataStoreOwnerRule: "DataStoreOwners/SendOwnerAddedNotification.ts",
    });
  });

  test("lists only owner rules that exist", () => {
    for (const gap of KNOWN_GAPS) {
      expect({ gap, exists: rules.includes(gap) }).toEqual({
        gap,
        exists: true,
      });
    }
  });
});
