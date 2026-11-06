import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AzureCloudAiAgentRoleDefinition,
  CloudAiAgentSetupOptions,
  getAwsCloudAiAgentTemplate,
  getAzureCloudAiAgentRoleDefinition,
  getCloudAiAgentRolePermissions,
  getGcpCloudAiAgentReaderPermissions,
  getGcpCloudAiAgentServices,
} from "../../../Types/CloudConnection/CloudAiAgentSetupCommands";
import { buildCloudAiAgentKey } from "../../../Types/CloudConnection/CloudAiAgentKey";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - the least-privilege grants of App Platforms' own
 * platforms in the Cloud AI agent's setup command
 * (Types/CloudConnection/CloudAiAgentSetupCommands, from the cloud
 * catalog's permissions):
 *
 *  - AWS: the write role may redeploy an App Runner service and restart an
 *    Elastic Beanstalk environment's app servers, and read only what those
 *    two changes read first; the tags of either are read only while a tag
 *    is required, and the changes themselves only on tagged resources;
 *  - Azure: the role may restart, start and stop a container group, and
 *    read it;
 *  - Google Cloud: the write account may move an App Engine service's
 *    traffic and scale its version, the agent's own account reads only,
 *    and the command turns the App Engine Admin API on;
 *  - turning a change off takes exactly its permissions out.
 */

type Json = any;

const CLOUD_ACCOUNT_ID: string = "33333333-3333-4333-8333-333333333333";
const KEY: string = buildCloudAiAgentKey({
  cloudAccountId: CLOUD_ACCOUNT_ID,
  secret: "0123456789abcdef".repeat(4),
});

const BASE: Omit<CloudAiAgentSetupOptions, "provider" | "accountId"> = {
  oneuptimeUrl: "https://oneuptime.com",
  agentKey: KEY,
  cloudAccountId: CLOUD_ACCOUNT_ID,
  fixesMode: "RequireApproval",
};

const AWS: CloudAiAgentSetupOptions = {
  ...BASE,
  provider: CloudProvider.AWS,
  accountId: "123456789012",
};

const AZURE: CloudAiAgentSetupOptions = {
  ...BASE,
  provider: CloudProvider.Azure,
  accountId: "0b1f6471-1bf0-4dda-aec3-111122223333",
};

// The write role's statements, by their Sid.
function writeStatements(
  options: CloudAiAgentSetupOptions,
): Record<string, Json> {
  const template: Json = JSON.parse(getAwsCloudAiAgentTemplate(options));
  const statements: Array<Json> =
    template.Resources.WriteRole.Properties.Policies[0].PolicyDocument
      .Statement;
  const bySid: Record<string, Json> = {};

  for (const statement of statements) {
    bySid[statement.Sid] = statement;
  }

  return bySid;
}

describe("AWS: App Runner and Elastic Beanstalk on the write role", () => {
  test("the changes are the write role's, the reads before them its reads, and nothing else of either service", () => {
    const statements: Record<string, Json> = writeStatements(AWS);
    const changes: Array<string> = statements["MakeTheChangesTurnedOn"].Action;
    const reads: Array<string> = statements["ReadWhatAChangeReplaces"].Action;

    expect(
      changes.filter((action: string): boolean => {
        return (
          action.startsWith("apprunner:") ||
          action.startsWith("elasticbeanstalk:")
        );
      }),
    ).toEqual([
      "apprunner:StartDeployment",
      "elasticbeanstalk:RestartAppServer",
    ]);
    expect(
      reads.filter((action: string): boolean => {
        return (
          action.startsWith("apprunner:") ||
          action.startsWith("elasticbeanstalk:")
        );
      }),
    ).toEqual([
      "apprunner:DescribeService",
      "elasticbeanstalk:DescribeEnvironments",
    ]);
  });

  test("with a required tag, their tags are read too, and the changes need the tag", () => {
    const statements: Record<string, Json> = writeStatements({
      ...AWS,
      requiredTag: "oneuptime-ai=allow",
    });

    expect(statements["ReadWhatAChangeReplaces"].Action).toEqual(
      expect.arrayContaining([
        "apprunner:ListTagsForResource",
        "elasticbeanstalk:ListTagsForResource",
      ]),
    );
    expect(statements["MakeTheChangesTurnedOn"].Condition).toEqual({
      StringEquals: { "aws:ResourceTag/oneuptime-ai": "allow" },
    });
    // Without one, no tag is ever read.
    expect(
      writeStatements(AWS)["ReadWhatAChangeReplaces"].Action,
    ).not.toContain("apprunner:ListTagsForResource");
  });

  test("restart-service turned off takes App Runner's and Elastic Beanstalk's changes out", () => {
    const permissions: Array<string> = getCloudAiAgentRolePermissions(
      CloudProvider.AWS,
      ["scale-out", "scale-in"],
    );

    for (const action of [
      "apprunner:StartDeployment",
      "apprunner:DescribeService",
      "elasticbeanstalk:RestartAppServer",
      "elasticbeanstalk:DescribeEnvironments",
    ]) {
      expect([action, permissions.includes(action)]).toEqual([action, false]);
    }
  });
});

describe("Azure: a container group on the agent's role", () => {
  test("the role may restart, start and stop one, and read it", () => {
    const role: AzureCloudAiAgentRoleDefinition =
      getAzureCloudAiAgentRoleDefinition(AZURE);

    expect(
      role.Actions.filter((action: string): boolean => {
        return action.startsWith("Microsoft.ContainerInstance/");
      }),
    ).toEqual([
      "Microsoft.ContainerInstance/containerGroups/read",
      "Microsoft.ContainerInstance/containerGroups/restart/action",
      "Microsoft.ContainerInstance/containerGroups/start/action",
      "Microsoft.ContainerInstance/containerGroups/stop/action",
    ]);
  });

  test("stopping turned off takes only the stop out", () => {
    const role: AzureCloudAiAgentRoleDefinition =
      getAzureCloudAiAgentRoleDefinition({
        ...AZURE,
        enabledOperations: ["restart-service", "start-instance"],
      });

    expect(role.Actions).toContain(
      "Microsoft.ContainerInstance/containerGroups/restart/action",
    );
    expect(role.Actions).toContain(
      "Microsoft.ContainerInstance/containerGroups/start/action",
    );
    expect(role.Actions).not.toContain(
      "Microsoft.ContainerInstance/containerGroups/stop/action",
    );
  });
});

describe("Google Cloud: an App Engine service", () => {
  test("the write account may move its traffic and scale its version, and follow the operation", () => {
    const permissions: Array<string> = getCloudAiAgentRolePermissions(
      CloudProvider.GCP,
    ).filter((permission: string): boolean => {
      return permission.startsWith("appengine.");
    });

    expect(permissions).toEqual([
      "appengine.operations.get",
      "appengine.services.get",
      "appengine.services.update",
      "appengine.versions.get",
      "appengine.versions.list",
      "appengine.versions.update",
    ]);
  });

  test("the agent's own account only reads it", () => {
    expect(
      getGcpCloudAiAgentReaderPermissions().filter(
        (permission: string): boolean => {
          return permission.startsWith("appengine.");
        },
      ),
    ).toEqual([
      "appengine.operations.get",
      "appengine.services.get",
      "appengine.versions.get",
      "appengine.versions.list",
    ]);
  });

  test("a roll back alone moves traffic and never scales; a scale alone never moves traffic", () => {
    const rollBack: Array<string> = getCloudAiAgentRolePermissions(
      CloudProvider.GCP,
      ["roll-back-service"],
    );
    const scale: Array<string> = getCloudAiAgentRolePermissions(
      CloudProvider.GCP,
      ["scale-out"],
    );

    expect(rollBack).toContain("appengine.services.update");
    expect(rollBack).not.toContain("appengine.versions.update");
    expect(scale).toContain("appengine.versions.update");
    expect(scale).not.toContain("appengine.services.update");
  });

  test("the command turns the App Engine Admin API on, only for a change that uses it", () => {
    expect(getGcpCloudAiAgentServices()).toContain("appengine.googleapis.com");
    expect(getGcpCloudAiAgentServices(["roll-back-service"])).toContain(
      "appengine.googleapis.com",
    );
    expect(getGcpCloudAiAgentServices(["start-instance"])).not.toContain(
      "appengine.googleapis.com",
    );
  });
});
