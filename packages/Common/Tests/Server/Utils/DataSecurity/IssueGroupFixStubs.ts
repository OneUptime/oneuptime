import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../../Server/Services/CodeRepositoryService";
import DataSecurityAiProposalService from "../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import CodeTaskAccess from "../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskGate from "../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import DataSecurityCodeTask from "../../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import DataSecurityIssueGroupNaming from "../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupNaming";
import DataSecurityIssueGroupProposals from "../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupProposals";
import DeclaredCodeOwner from "../../../../Server/Utils/AI/Remediation/DeclaredCodeOwner";
import SubjectCodeFixRun, {
  SubjectCodeFixRunInput,
} from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import { ResolvableRepository } from "../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import DataSecurityResponse from "../../../../Server/Utils/DataSecurity/DataSecurityResponse";
import DataSecurityStoreCreators from "../../../../Server/Utils/DataSecurity/DataSecurityStoreCreators";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DATA_SECURITY_RESPONSE_FIELD_KEY } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { DataSecurityResponseAction } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { DeclaredCodeOwnerReason } from "../../../../Utils/AiRemediation/DeclaredCodeChange";
import { makeId } from "./IssueGroupsWorld";
import { jest } from "@jest/globals";

/*
 * WHAT A GROUP'S FIX TALKS TO, ANSWERED (#10370): the code task's gate and
 * queue, the repositories, the cloud connections and their response
 * actions, and the proposals - each recorded, so a test says what one press
 * asked of them. The issues, stores and groups are the world's.
 */

export const REPOSITORY_ID: string = "11111111-1111-4111-8111-111111111111";

export const REPOSITORY: ResolvableRepository = {
  id: REPOSITORY_ID,
  name: "infra",
  organizationName: "acme",
  repositoryName: "infra",
} as unknown as ResolvableRepository;

export const USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

// A person of the project with these permissions - on the issues of these labels only, when given.
export function personWith(
  projectId: string,
  permissions: Array<Permission>,
  labelIds: Array<ObjectID> = [],
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(projectId),
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds,
        isBlockPermission: false,
      };
    }),
  };
  const map: Dictionary<UserTenantAccessPermission> = {};

  map[projectId] = tenantPermission;

  return {
    tenantId: new ObjectID(projectId),
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: map,
  };
}

export interface GroupFixCalls {
  // Each Code task the fix queued, with what it was given.
  queued: Array<SubjectCodeFixRunInput>;
  // Each response action run: the store, and the action.
  responses: Array<{ dataStoreId: string; action: DataSecurityResponseAction }>;
  // Each issue the fix wrote on.
  feedIssueIds: Array<string>;
  // The groups whose waiting proposals were settled, with the kinds.
  expired: Array<{ groupId: string; kinds?: Array<string> | undefined }>;
}

export interface GroupFixStubOptions {
  // The cloud connections, by id: each one's response setting is on unless said.
  connections?: Array<{ id: string; isEnabled?: boolean; response?: string }>;
  // A response action that fails on these stores.
  failingStoreIds?: Array<string>;
  // Why the code task's gate refuses, when it does.
  gateRefusal?: string | undefined;
  // The server has Code switched off.
  isCodeOff?: boolean | undefined;
}

// The repository the Code task works in: the one the person picked or OneUptime was given.
function repositoryModel(): CodeRepository {
  const repository: CodeRepository = new CodeRepository();

  repository._id = REPOSITORY_ID;
  repository.id = new ObjectID(REPOSITORY_ID);
  repository.name = "infra";
  repository.organizationName = "acme";
  repository.repositoryName = "infra";

  return repository;
}

export function installGroupFixStubs(
  options: GroupFixStubOptions = {},
): GroupFixCalls {
  const calls: GroupFixCalls = {
    queued: [],
    responses: [],
    feedIssueIds: [],
    expired: [],
  };

  // The grouping: no creators, the repository's tree, nothing named or proposed.
  jest
    .spyOn(DataSecurityStoreCreators, "read")
    .mockResolvedValue(new Map() as never);
  jest
    .spyOn(CodeRepositoryService, "getResolvableRepositories")
    .mockResolvedValue([REPOSITORY] as never);
  jest
    .spyOn(CodeRepositoryServiceClass, "getRepositoryTreePaths")
    .mockResolvedValue([
      "modules/static-site/main.tf",
      "modules/static-site/variables.tf",
      "README.md",
    ] as never);
  jest
    .spyOn(DataSecurityIssueGroupNaming, "nameGroups")
    .mockResolvedValue(0 as never);
  jest
    .spyOn(DataSecurityIssueGroupProposals, "proposeForGroups")
    .mockResolvedValue(0 as never);

  // Code: open on the server, the gate as asked, one repository.
  jest
    .spyOn(ServerProducts, "getOffReasonOfServerWork")
    .mockResolvedValue((options.isCodeOff ? "Off" : null) as never);
  jest
    .spyOn(CodeTaskGate, "getBlocker")
    .mockResolvedValue(
      (options.gateRefusal ? { message: options.gateRefusal } : null) as never,
    );
  jest
    .spyOn(CodeTaskAccess, "listReadableRepositories")
    .mockResolvedValue([repositoryModel()] as never);
  jest
    .spyOn(CodeTaskAccess, "canAskInRepository")
    .mockResolvedValue(true as never);
  jest.spyOn(DeclaredCodeOwner, "findCandidates").mockResolvedValue([
    {
      repository: {
        id: REPOSITORY_ID,
        name: "infra",
        organizationName: "acme",
        repositoryName: "infra",
      },
      reason: DeclaredCodeOwnerReason.HasNamedFile,
      matchedPaths: ["modules/static-site/main.tf"],
      score: 10,
    },
  ] as never);
  jest
    .spyOn(CodeRepositoryService, "findOneBy")
    .mockResolvedValue(repositoryModel() as never);
  jest
    .spyOn(
      DataSecurityCodeTask as unknown as {
        chooseRepository: () => Promise<unknown>;
      },
      "chooseRepository",
    )
    .mockResolvedValue({ repository: repositoryModel() } as never);
  jest
    .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
    .mockImplementation((async (input: SubjectCodeFixRunInput) => {
      calls.queued.push(input);

      const run: AIRun = new AIRun();

      run.id = new ObjectID(makeId());

      return run;
    }) as never);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockImplementation((async (data: { dataSecurityIssueId: ObjectID }) => {
      calls.feedIssueIds.push(data.dataSecurityIssueId.toString());
    }) as never);

  // The cloud connections, and the response actions run through them.
  jest.spyOn(CloudConnectionService, "findBy").mockImplementation((async () => {
    return (options.connections || []).map(
      (row: { id: string; isEnabled?: boolean; response?: string }) => {
        const connection: CloudConnection = new CloudConnection();

        connection._id = row.id;
        connection.id = new ObjectID(row.id);
        connection.isEnabled = row.isEnabled !== false;
        connection.config = {
          [DATA_SECURITY_RESPONSE_FIELD_KEY]: row.response || "block",
        } as JSONObject;

        return connection;
      },
    );
  }) as never);
  jest.spyOn(DataSecurityResponse, "run").mockImplementation((async (data: {
    dataStoreId: ObjectID;
    action: DataSecurityResponseAction;
  }) => {
    const dataStoreId: string = data.dataStoreId.toString().toLowerCase();

    if ((options.failingStoreIds || []).includes(dataStoreId)) {
      throw new Error("The cloud refused the change.");
    }

    calls.responses.push({ dataStoreId, action: data.action });

    return { changed: true, summary: "Changed." };
  }) as never);

  // The proposals a press settles.
  jest
    .spyOn(DataSecurityAiProposalService, "expireWaitingForGroup")
    .mockImplementation((async (data: {
      dataSecurityIssueGroupId: ObjectID;
      kinds?: Array<string> | undefined;
    }) => {
      calls.expired.push({
        groupId: data.dataSecurityIssueGroupId.toString().toLowerCase(),
        kinds: data.kinds,
      });

      return 0;
    }) as never);

  return calls;
}
