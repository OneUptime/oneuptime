import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN OWNER RULE'S NOTIFY OWNERS DOES WHAT IT SAYS (#9681, #9700).
 *
 * Every owner rule form shows Notify Owners - "Tell people when this rule
 * makes them owners", on by default - and its engine writes each owner it
 * adds not notified yet, for a worker job to tell. Data Observability's
 * table, data store and pipeline rules had no such job (#9681), nor did 23
 * more kinds of record - hosts, clusters, services, dashboards, on-call
 * policies and the rest (#9700) - so the toggle told nobody, and neither did
 * adding an owner on an Owners page. These read the models and the jobs as
 * text: every owner rule's owner rows are read by an owner-added job - one
 * on tellOwnersAdded, or one run by runResourceOwnerAddedJob<Record>(...),
 * which is - and every such job is started by the Workers. There are no
 * known gaps: a new owner rule without a job fails here.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");
const MODELS: string = path.join(PACKAGES, "Common/Models/DatabaseModels");
const WORKERS: string = path.join(PACKAGES, "App/FeatureSet/Workers");
const JOBS: string = path.join(WORKERS, "Jobs");

// What a job that tells the people an owner rule adds calls.
const TELLS_OWNERS_ADDED: ReadonlyArray<string> = [
  "tellOwnersAdded",
  "runResourceOwnerAddedJob<",
];

// The 23 kinds of record whose jobs came with #9700, each by its rule.
const TOLD_SINCE_9700: ReadonlyArray<string> = [
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

// The record an owner rule is of: "HostOwnerRule" is a host's.
function recordOf(rule: string): string {
  return rule.replace(/OwnerRule$/, "");
}

// The owner-added job that reads a rule's owner rows, if any.
function ownerAddedJobOf(
  rule: string,
  jobs: Array<{ file: string; source: string }>,
): string | null {
  const resource: string = recordOf(rule);

  const job: { file: string; source: string } | undefined = jobs.find(
    (candidate: { file: string; source: string }): boolean => {
      return (
        TELLS_OWNERS_ADDED.some((call: string): boolean => {
          return candidate.source.includes(call);
        }) &&
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
    expect(rules).toContain("HostOwnerRule");
  });

  test("has an owner-added job that tells the people its rule adds, every one of them", () => {
    const withoutJob: Array<string> = rules.filter((rule: string): boolean => {
      return ownerAddedJobOf(rule, jobs) === null;
    });

    expect(withoutJob).toEqual([]);
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

  test.each(TOLD_SINCE_9700)(
    "tells %s's new owners, by a job of its own (#9700)",
    (rule: string) => {
      const record: string = recordOf(rule);
      const file: string = `${record}Owners/SendOwnerAddedNotification.ts`;

      expect(rules).toContain(rule);
      expect(ownerAddedJobOf(rule, jobs)).toBe(file);

      const source: string = jobs.find(
        (job: { file: string; source: string }): boolean => {
          return job.file === file;
        },
      )!.source;

      // Run by the shared job, by a name of its own, of its own kind.
      expect(source).toContain("runResourceOwnerAddedJob<");
      expect(source).toContain(
        `jobName: "${record}Owner:SendOwnerAddedNotification",`,
      );
      expect(source).toContain(
        `kind: OwnerNotificationKind.${record}OwnerAdded,`,
      );
      // It waits while its products are switched off, as its owner rows do.
      expect(source).toContain(`ownerTableName: "${record}OwnerUser",`);
    },
  );

  test("the shared job tells through tellOwnersAdded and takes up what a stopped run left", () => {
    const shared: string = fs.readFileSync(
      path.join(WORKERS, "Utils/ResourceOwnersAdded.ts"),
      "utf8",
    );

    expect(shared).toContain("await tellOwnersAdded<TRecord>({");
    expect(shared).toContain("OwnerNotificationDeliveries.resume(");
    expect(shared).toContain("delivery.tell(");
    expect(shared).toContain("isOwnerWorkOff(job.ownerTableName)");
  });

  test("every owner-added job is started by the Workers", () => {
    const workers: string = fs.readFileSync(
      path.join(WORKERS, "Index.ts"),
      "utf8",
    );

    for (const rule of rules) {
      const file: string | null = ownerAddedJobOf(rule, jobs);

      expect({ rule, started: Boolean(file) }).toEqual({
        rule,
        started: true,
      });

      expect({
        rule,
        started: workers.includes(
          `import "./Jobs/${file!.replace(/\.ts$/, "")}";`,
        ),
      }).toEqual({ rule, started: true });
    }
  });

  test("every rule's owner rows can be written not told, for its job to tell", () => {
    for (const rule of rules) {
      const record: string = recordOf(rule);

      for (const owner of ["OwnerUser", "OwnerTeam"]) {
        const model: string = fs.readFileSync(
          path.join(MODELS, `${record}${owner}.ts`),
          "utf8",
        );

        expect({
          model: `${record}${owner}`,
          hasFlag: model.includes("public isOwnerNotified?: boolean"),
        }).toEqual({ model: `${record}${owner}`, hasFlag: true });
      }
    }
  });
});
