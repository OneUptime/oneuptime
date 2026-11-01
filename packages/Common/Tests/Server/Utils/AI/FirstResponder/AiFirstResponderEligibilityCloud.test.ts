import CloudAccount from "../../../../../Models/DatabaseModels/CloudAccount";
import ResourceAiAgent from "../../../../../Models/DatabaseModels/ResourceAiAgent";
import CloudAccountService from "../../../../../Server/Services/CloudAccountService";
import KubernetesClusterAiAccessService from "../../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService, {
  ResourceAiAccessProjectGates,
  ResourceAiAccessRef,
} from "../../../../../Server/Services/ResourceAiAccessService";
import AiFirstResponderEligibility from "../../../../../Server/Utils/AI/FirstResponder/AiFirstResponderEligibility";
import OneUptimeDate from "../../../../../Types/Date";
import ObjectID from "../../../../../Types/ObjectID";
import AiResourceType from "../../../../../Types/ResourceAiAgent/AiResourceType";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { ResourceAiRemediationMode } from "../../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * The AI First Responder holds a page only where AI could fix something on
 * its own (countUnattendedFixTargets). A cloud account counts like any
 * resource with an agent: an incident's cloud resources lead to their
 * accounts, and an account whose Cloud AI agent is online, with fixes
 * Automatic or Bypass approval, is somewhere AI could fix. One that asks
 * first, has fixes off, or whose agent is offline is not.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000002",
);

const GATES: ResourceAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

interface AccountCase {
  type: AiResourceType;
  provider: CloudProvider;
  id: ObjectID;
  accountId: string;
  mode: ResourceAiRemediationMode;
  isAgentOnline: boolean;
}

const CASES: Array<AccountCase> = [
  {
    type: AiResourceType.AwsAccount,
    provider: CloudProvider.AWS,
    id: new ObjectID("6b000000-0000-4000-8000-0000000000a1"),
    accountId: "123456789012",
    mode: ResourceAiRemediationMode.Automatic,
    isAgentOnline: true,
  },
  {
    type: AiResourceType.AzureSubscription,
    provider: CloudProvider.Azure,
    id: new ObjectID("6b000000-0000-4000-8000-0000000000a2"),
    accountId: "00000000-0000-0000-0000-0000000000ab",
    mode: ResourceAiRemediationMode.BypassApproval,
    isAgentOnline: true,
  },
  {
    type: AiResourceType.GoogleCloudProject,
    provider: CloudProvider.GCP,
    id: new ObjectID("6b000000-0000-4000-8000-0000000000a3"),
    accountId: "shop-prod",
    mode: ResourceAiRemediationMode.RequireApproval,
    isAgentOnline: true,
  },
  {
    type: AiResourceType.AwsAccount,
    provider: CloudProvider.AWS,
    id: new ObjectID("6b000000-0000-4000-8000-0000000000a4"),
    accountId: "210987654321",
    mode: ResourceAiRemediationMode.Automatic,
    isAgentOnline: false,
  },
];

function accountRow(item: AccountCase): CloudAccount {
  const account: CloudAccount = new CloudAccount();
  account.id = item.id;
  account._id = item.id.toString();
  account.projectId = PROJECT_ID;
  account.name = `${item.provider}-prod`;
  account.provider = item.provider;
  account.accountId = item.accountId;
  account.cloudConnectionId = ObjectID.generate();
  account.isAiInvestigationEnabled = true;
  account.aiRemediationMode = item.mode;
  account.aiCommandAllowlist = [];
  return account;
}

function agentRow(item: AccountCase): ResourceAiAgent {
  const agent: ResourceAiAgent = new ResourceAiAgent();
  agent.id = ObjectID.generate();
  agent._id = agent.id.toString();
  agent.projectId = PROJECT_ID;
  agent.resourceType = item.type;
  agent.resourceId = item.id;
  agent.resourceIdentifier = item.accountId;
  agent.connectionStatus = "connected";
  agent.lastAliveAt = item.isAgentOnline
    ? OneUptimeDate.getCurrentDate()
    : OneUptimeDate.getSomeMinutesAgo(60);
  agent.posture = {
    resourceType: item.type,
    resourceIdentifier: item.accountId,
    allowWrites: true,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
  } as never;
  return agent;
}

function serve(cases: Array<AccountCase>): void {
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
    .mockResolvedValue([]);
  jest
    .spyOn(ResourceAiAccessService, "getResourcesForSubject")
    .mockResolvedValue(
      cases.map((item: AccountCase): ResourceAiAccessRef => {
        return { resourceType: item.type, resourceId: item.id.toString() };
      }),
    );
  jest
    .spyOn(CloudAccountService, "findBy")
    .mockImplementation(
      async (data: {
        query: Record<string, unknown>;
      }): Promise<Array<CloudAccount>> => {
        return cases
          .filter((item: AccountCase): boolean => {
            return item.provider === data.query["provider"];
          })
          .map(accountRow);
      },
    );
  jest
    .spyOn(ResourceAiAccessService, "getProjectGates")
    .mockResolvedValue(GATES);
  jest.spyOn(ResourceAiAccessService, "findAgentRows").mockResolvedValue(
    new Map<string, ResourceAiAgent>(
      cases.map((item: AccountCase): [string, ResourceAiAgent] => {
        return [`${item.type}:${item.id.toString()}`, agentRow(item)];
      }),
    ),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a cloud account and the AI First Responder", () => {
  test("an online Cloud AI agent that fixes on its own counts, on every cloud", async () => {
    serve(CASES);

    /*
     * AWS (Automatic) and Azure (Bypass approval); not Google Cloud, which
     * asks first, nor the AWS account whose agent is offline.
     */
    expect(
      await AiFirstResponderEligibility.countUnattendedFixTargets({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(2);
  });

  test("an account with fixes off is nowhere AI could fix", async () => {
    serve([{ ...CASES[0]!, mode: ResourceAiRemediationMode.Disabled }]);

    expect(
      await AiFirstResponderEligibility.countUnattendedFixTargets({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(0);
  });

  test("its statuses are the subject's, read for the incident's project", async () => {
    serve([CASES[0]!]);

    await AiFirstResponderEligibility.countUnattendedFixTargets({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(
      (
        ResourceAiAccessService.getResourcesForSubject as unknown as {
          mock: { calls: Array<Array<{ projectId: ObjectID }>> };
        }
      ).mock.calls[0]![0]!.projectId,
    ).toBe(PROJECT_ID);
  });
});
