import RemediationApproval from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import { getRemediationPlanFingerprint } from "../../../../Server/Utils/AutoRemediation/RemediationPlanFingerprint";
import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import WorkspaceRemediationActions from "../../../../Server/Utils/Workspace/WorkspaceRemediationActions";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import Label from "../../../../Models/DatabaseModels/Label";
import Project from "../../../../Models/DatabaseModels/Project";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import UserType from "../../../../Types/UserType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { withLabelJoinTables } from "../../TestingUtils/LabelJoinTables";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A PERSON WHO MAY NOT CHANGE A CLOUD ACCOUNT CANNOT APPROVE ONEUPTIME AI'S
 * FIX OF IT - on AWS, Azure and Google Cloud alike, whether they press
 * Approve on the incident's card in the Dashboard or Approve and run on the
 * fix's message in Slack or Microsoft Teams.
 *
 * All three reach RemediationApproval.approve with the person's own props
 * (a chat press through WorkspaceRemediationActions.approve, once the chat
 * authorized the member), which asks ResourceAiAccessService
 * .assertCallerMayChangeResource for every account the plan changes. That
 * check runs for real here, against the account's own row as an edit of the
 * account decides it: its update ACL, and blocks and grants limited by
 * labels. Refused, nothing is claimed and nothing runs; a person who may
 * edit the account approves the very same plan. Only the account's row,
 * its AI status and the suggestion's row are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e3f1c2a-0b7d-4c1e-9a2f-3b4c5d6e7f01",
);
const USER_ID: ObjectID = new ObjectID("5e3f1c2a-0b7d-4c1e-9a2f-3b4c5d6e7f02");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "5e3f1c2a-0b7d-4c1e-9a2f-3b4c5d6e7f03",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "5e3f1c2a-0b7d-4c1e-9a2f-3b4c5d6e7f04",
);
const CLOUD_ACCOUNT_ID: string = "5e3f1c2a-0b7d-4c1e-9a2f-3b4c5d6e7f05";
const AGENT_ID: string = "5e3f1c2a-0b7d-4c1e-9a2f-3b4c5d6e7f06";
const PROD_LABEL_ID: ObjectID = new ObjectID(
  "5e3f1c2a-0b7d-4c1e-9a2f-3b4c5d6e7f07",
);
const STAGING_LABEL_ID: ObjectID = new ObjectID(
  "5e3f1c2a-0b7d-4c1e-9a2f-3b4c5d6e7f08",
);

interface Cloud {
  name: string;
  type: AiResourceType;
  accountId: string;
  // A change of the account, as OneUptime AI composes one.
  command: string;
  noun: string;
}

const CLOUDS: Array<Cloud> = [
  {
    name: "AWS",
    type: AiResourceType.AwsAccount,
    accountId: "123456789012",
    command:
      "cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/web --count 4",
    noun: "AWS account",
  },
  {
    name: "Azure",
    type: AiResourceType.AzureSubscription,
    accountId: "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
    command:
      "cloud restart-service /subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/prod/providers/Microsoft.Web/sites/web",
    noun: "Azure subscription",
  },
  {
    name: "Google Cloud",
    type: AiResourceType.GoogleCloudProject,
    accountId: "shop-prod-1234",
    command:
      "cloud reboot-instance //compute.googleapis.com/projects/shop-prod-1234/zones/us-central1-a/instances/vm-1",
    noun: "Google Cloud project",
  },
];

// Where the person presses Approve: the Dashboard, or a fix's chat message.
type Where = "Dashboard" | WorkspaceType.Slack | WorkspaceType.MicrosoftTeams;

const EVERYWHERE: Array<Where> = [
  "Dashboard",
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
];

function label(id: ObjectID, name: string): Label {
  const model: Label = new Label();
  model.id = id;
  model.name = name;
  return model;
}

function account(labels: Array<Label>): CloudAccount {
  const model: CloudAccount = new CloudAccount();
  model.id = new ObjectID(CLOUD_ACCOUNT_ID);
  model.projectId = PROJECT_ID;
  model.labels = labels;
  return model;
}

function person(
  permissions: Array<Partial<UserPermission>>,
): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map(
      (permission: Partial<UserPermission>): UserPermission => {
        return {
          _type: "UserPermission",
          labelIds: [],
          isBlockPermission: false,
          ...permission,
        } as UserPermission;
      },
    ),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

// A project member, whose edit of cloud accounts is blocked where they carry "prod".
function blockedOnProd(): DatabaseCommonInteractionProps {
  return person([
    { permission: Permission.ProjectMember },
    {
      permission: Permission.EditCloudResource,
      isBlockPermission: true,
      labelIds: [PROD_LABEL_ID],
    },
  ]);
}

function suggestionRow(cloud: Cloud): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    resourceType: cloud.type,
    resourceId: new ObjectID(CLOUD_ACCOUNT_ID),
    verificationWindowMinutes: 15,
    commandPlan: {
      commands: [
        {
          sequence: 1,
          stepType: RunbookStepType.ResourceCommand,
          runnerId: AGENT_ID,
          runnerNameSnapshot: "Cloud AI agent",
          resourceType: cloud.type,
          resourceId: CLOUD_ACCOUNT_ID,
          resourceNameSnapshot: "prod",
          resourceCommandTier: "SafeWrite",
          command: cloud.command,
          timeoutInMs: 60000,
          rationale: "the service is overloaded",
          expectedEffect: "latency drops",
          policyVerdict: "RequiresApproval",
        },
      ],
    } as JSONObject,
  };
}

function cloudStatus(cloud: Cloud): ResourceAiAccessStatus {
  return {
    resourceType: cloud.type,
    resourceId: CLOUD_ACCOUNT_ID,
    resourceName: "prod",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: cloud.type,
        resourceIdentifier: cloud.accountId,
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  };
}

describe.each(CLOUDS)(
  "$name: approving OneUptime AI's fix of the account",
  (cloud: Cloud) => {
    let claim: jest.SpyInstance;
    let execute: jest.SpyInstance;
    let accountRow: CloudAccount;

    beforeEach(() => {
      withLabelJoinTables();

      const row: Record<string, unknown> = suggestionRow(cloud);

      // The suggestion, as the person's read and the root read pick it.
      jest
        .spyOn(AutoRemediationSuggestionService, "findOneById")
        .mockImplementation(async (args: unknown): Promise<never> => {
          const select: Record<string, unknown> = (
            args as { select: Record<string, unknown> }
          ).select;
          const picked: Record<string, unknown> = { id: row["id"] };

          for (const key of Object.keys(select)) {
            if (key in row) {
              picked[key] = row[key];
            }
          }

          return picked as never;
        });
      claim = jest
        .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
        .mockResolvedValue(1);
      execute = jest
        .spyOn(CommandPlanExecutor, "executeApprovedPlan")
        .mockResolvedValue(undefined as never);
      jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
        id: PROJECT_ID,
        enableAi: true,
      } as unknown as Project);
      jest
        .spyOn(ResourceAiAccessService, "getStatusForResource")
        .mockResolvedValue(cloudStatus(cloud));
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(AlertFeedService, "createAlertFeedItem")
        .mockResolvedValue(undefined as never);

      // The account's own row, read through its own service.
      accountRow = account([label(PROD_LABEL_ID, "prod")]);
      jest
        .spyOn(CloudAccountService, "findOneBy")
        .mockImplementation(async (): Promise<never> => {
          return accountRow as never;
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function approveFrom(
      where: Where,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> {
      if (where === "Dashboard") {
        return await RemediationApproval.approve({
          props,
          suggestionId: SUGGESTION_ID.toString(),
        });
      }

      // A press on the fix's message: the member's props, once authorized.
      return await WorkspaceRemediationActions.approve({
        props,
        value: {
          suggestionId: SUGGESTION_ID,
          fingerprint: getRemediationPlanFingerprint(
            suggestionRow(cloud) as unknown as AutoRemediationSuggestion,
          ),
        },
        from: where,
      });
    }

    test.each(EVERYWHERE)(
      "from %s: a member blocked from editing the account cannot approve it, and nothing is claimed or run",
      async (where: Where) => {
        let refusal: unknown = null;

        try {
          await approveFrom(where, blockedOnProd());
        } catch (error) {
          refusal = error;
        }

        expect(refusal).toBeInstanceOf(NotAuthorizedException);
        expect((refusal as Error).message).toBe(
          `You do not have permission to edit this ${cloud.noun}, so you cannot approve an AI plan that changes it. Ask someone who may edit the ${cloud.noun} to approve it, or dismiss the suggestion.`,
        );
        expect(claim).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
      },
    );

    test.each(EVERYWHERE)(
      "from %s: a member whose edit is limited to other accounts' labels cannot approve it either",
      async (where: Where) => {
        await expect(
          approveFrom(
            where,
            person([
              {
                permission: Permission.EditCloudResource,
                labelIds: [STAGING_LABEL_ID],
              },
              {
                permission: Permission.ReadCloudResource,
              },
              { permission: Permission.CreateRunbookExecution },
            ]),
          ),
        ).rejects.toThrow(NotAuthorizedException);
        expect(claim).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
      },
    );

    test.each(EVERYWHERE)(
      "from %s: the same member approves a plan for an account the block does not reach, and it runs",
      async (where: Where) => {
        accountRow = account([label(STAGING_LABEL_ID, "staging")]);

        await approveFrom(where, blockedOnProd());

        expect(claim).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        // Approved as the person, from where they pressed.
        const set: Record<string, unknown> = (
          claim.mock.calls[0]![0] as { set: Record<string, unknown> }
        ).set;
        expect(set["approvedByUserId"]).toBe(USER_ID.toString());
      },
    );
  },
);
