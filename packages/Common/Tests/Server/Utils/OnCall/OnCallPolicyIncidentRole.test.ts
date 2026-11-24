import IncidentEpisodeMember from "../../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeRoleMember from "../../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import IncidentEpisodeMemberService from "../../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeRoleMemberService from "../../../../Server/Services/IncidentEpisodeRoleMemberService";
import IncidentMemberService from "../../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import IncidentRoleFeedText from "../../../../Server/Utils/Incident/IncidentRoleFeedText";
import OnCallPolicyIncidentRole, {
  ON_CALL_POLICY_INCIDENT_ROLE_LOCK_NAMESPACE,
  PagedPerson,
  PagedPersonRoleOutcome,
} from "../../../../Server/Utils/OnCall/OnCallPolicyIncidentRole";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE INCIDENT ROLE AN ON-CALL POLICY GIVES THE PEOPLE IT PAGES
 * (OnCallPolicyIncidentRole): "Payments Primary" giving the people it pages
 * Service Owner lists the payments team's on-call person under the
 * incident's roles - once, to members of the project only, a role that
 * takes one person to the first person paged - and the incident's feed
 * names the policy.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000002",
);
const ROLE_ID: ObjectID = new ObjectID("7e000000-0000-4000-8000-000000000003");
const INCIDENT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000004",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000005",
);
const DEANE_ID: ObjectID = new ObjectID("7e000000-0000-4000-8000-000000000006");
const ANA_ID: ObjectID = new ObjectID("7e000000-0000-4000-8000-000000000007");
const OTHER_POLICY_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000008",
);
const OTHER_ROLE_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000009",
);

const MUTEX: SemaphoreMutex = {} as SemaphoreMutex;

const pagedAboutIncident: PagedPerson = {
  projectId: PROJECT_ID,
  onCallDutyPolicyId: POLICY_ID,
  userId: DEANE_ID,
  incidentId: INCIDENT_ID,
};

const pagedAboutEpisode: PagedPerson = {
  projectId: PROJECT_ID,
  onCallDutyPolicyId: POLICY_ID,
  userId: DEANE_ID,
  incidentEpisodeId: EPISODE_ID,
};

// The policy as stored: its name, and the role it gives, if any.
const policyRow: (roleId: ObjectID | null) => OnCallDutyPolicy = (
  roleId: ObjectID | null,
): OnCallDutyPolicy => {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy._id = POLICY_ID.toString();
  policy.name = "Payments Primary";

  if (roleId) {
    policy.incidentRoleId = roleId;
  }

  return policy;
};

const roleRow: (data: {
  canAssignMultipleUsers: boolean;
  isPrimaryRole?: boolean | undefined;
}) => IncidentRole = (data: {
  canAssignMultipleUsers: boolean;
  isPrimaryRole?: boolean | undefined;
}): IncidentRole => {
  const role: IncidentRole = new IncidentRole();
  role._id = ROLE_ID.toString();
  role.canAssignMultipleUsers = data.canAssignMultipleUsers;
  role.isPrimaryRole = Boolean(data.isPrimaryRole);
  return role;
};

const holder: (userId: ObjectID) => IncidentMember = (
  userId: ObjectID,
): IncidentMember => {
  const member: IncidentMember = new IncidentMember();
  member.userId = userId;
  return member;
};

const episodeHolder: (userId: ObjectID) => IncidentEpisodeRoleMember = (
  userId: ObjectID,
): IncidentEpisodeRoleMember => {
  const member: IncidentEpisodeRoleMember = new IncidentEpisodeRoleMember();
  member.userId = userId;
  return member;
};

let readPolicy: ReturnType<typeof jest.spyOn>;
let readRole: ReturnType<typeof jest.spyOn>;
let isMember: ReturnType<typeof jest.spyOn>;
let lock: ReturnType<typeof jest.spyOn>;
let release: ReturnType<typeof jest.spyOn>;
let readHolders: ReturnType<typeof jest.spyOn>;
let createMember: ReturnType<typeof jest.spyOn>;
let readEpisodeHolders: ReturnType<typeof jest.spyOn>;
let createEpisodeMember: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  readPolicy = jest
    .spyOn(OnCallDutyPolicyService, "findOneBy")
    .mockResolvedValue(policyRow(ROLE_ID));
  readRole = jest
    .spyOn(IncidentRoleService, "findOneBy")
    .mockResolvedValue(roleRow({ canAssignMultipleUsers: true }));
  isMember = jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(true);
  lock = jest.spyOn(Semaphore, "lock").mockResolvedValue(MUTEX);
  release = jest
    .spyOn(Semaphore, "release")
    .mockResolvedValue(undefined as never);
  readHolders = jest
    .spyOn(IncidentMemberService, "findBy")
    .mockResolvedValue([]);
  createMember = jest
    .spyOn(IncidentMemberService, "create")
    .mockImplementation((async (createBy: CreateBy<IncidentMember>) => {
      return createBy.data;
    }) as never);
  readEpisodeHolders = jest
    .spyOn(IncidentEpisodeRoleMemberService, "findBy")
    .mockResolvedValue([]);
  createEpisodeMember = jest
    .spyOn(IncidentEpisodeRoleMemberService, "create")
    .mockImplementation((async (
      createBy: CreateBy<IncidentEpisodeRoleMember>,
    ) => {
      return createBy.data;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a person a policy pages about an incident", () => {
  test("is given the policy's role on it, as OneUptime's own write that names the policy", async () => {
    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.Given);

    expect(createMember).toHaveBeenCalledTimes(1);

    const createBy: CreateBy<IncidentMember> = createMember.mock
      .calls[0]![0] as CreateBy<IncidentMember>;

    expect(createBy.data.projectId).toEqual(PROJECT_ID);
    expect(createBy.data.incidentId).toEqual(INCIDENT_ID);
    expect(createBy.data.userId).toEqual(DEANE_ID);
    expect(createBy.data.incidentRoleId).toEqual(ROLE_ID);
    expect(createBy.props).toEqual({ isRoot: true });
    expect(
      IncidentRoleFeedText.readCause({
        miscDataProps: createBy.miscDataProps,
        props: createBy.props,
      }),
    ).toEqual({ kind: "onCallPolicy", policyName: "Payments Primary" });
    expect(createEpisodeMember).not.toHaveBeenCalled();
  });

  test("is sent no message about the role: their page told them about the incident", async () => {
    await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident);

    expect(
      (createMember.mock.calls[0]![0] as CreateBy<IncidentMember>).data
        .isMemberNotified,
    ).toBe(true);
  });

  test("the policy and its role are read pinned to the project", async () => {
    await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident);

    expect(
      (readPolicy.mock.calls[0]![0] as { query: Record<string, unknown> })
        .query,
    ).toEqual({ _id: POLICY_ID, projectId: PROJECT_ID });
    expect(
      (readRole.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({ _id: ROLE_ID, projectId: PROJECT_ID });
  });

  test("one record's role at a time: the lock is taken for the incident and the role, and given back", async () => {
    await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident);

    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock.mock.calls[0]![0]).toMatchObject({
      key: `${INCIDENT_ID.toString()}-${ROLE_ID.toString()}`,
      namespace: ON_CALL_POLICY_INCIDENT_ROLE_LOCK_NAMESPACE,
    });
    expect(release).toHaveBeenCalledWith(MUTEX);
  });

  test("who holds it already keeps it as it is: nothing twice", async () => {
    // The same person, under an id in upper case.
    readHolders.mockResolvedValue([
      holder(new ObjectID(DEANE_ID.toString().toUpperCase())),
    ]);

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.AlreadyHeld);
    expect(createMember).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(MUTEX);
  });

  test("a role that takes several people: given beside whoever holds it", async () => {
    readHolders.mockResolvedValue([holder(ANA_ID)]);

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.Given);
    expect(createMember).toHaveBeenCalledTimes(1);
  });

  test("a role that takes one person, held by somebody else: the first person paged keeps it", async () => {
    readRole.mockResolvedValue(roleRow({ canAssignMultipleUsers: false }));
    readHolders.mockResolvedValue([holder(ANA_ID)]);

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.HeldBySomebodyElse);
    expect(createMember).not.toHaveBeenCalled();
  });

  test("the Incident Commander is always one person, whatever its setting says", async () => {
    readRole.mockResolvedValue(
      roleRow({ canAssignMultipleUsers: true, isPrimaryRole: true }),
    );
    readHolders.mockResolvedValue([holder(ANA_ID)]);

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.HeldBySomebodyElse);
    expect(createMember).not.toHaveBeenCalled();
  });

  test("a role that takes one person, free: theirs", async () => {
    readRole.mockResolvedValue(
      roleRow({ canAssignMultipleUsers: false, isPrimaryRole: true }),
    );

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.Given);
  });

  test("somebody who is not a member of the project is given nothing, and nothing is locked", async () => {
    isMember.mockResolvedValue(false);

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.NotAProjectMember);
    expect(lock).not.toHaveBeenCalled();
    expect(createMember).not.toHaveBeenCalled();
  });

  test("Redis is not there: the role is still given, without the lock", async () => {
    lock.mockRejectedValue(new Error("Redis client is not connected"));

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.Given);
    expect(createMember).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  test("a create that fails still gives the lock back, and says so to its caller", async () => {
    createMember.mockRejectedValue(new Error("database is down"));

    await expect(
      OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).rejects.toThrow("database is down");
    expect(release).toHaveBeenCalledWith(MUTEX);
  });
});

describe("a policy that gives no role", () => {
  test("gives nothing, and reads no more than the policy", async () => {
    readPolicy.mockResolvedValue(policyRow(null));

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.PolicyGivesNoRole);
    expect(readRole).not.toHaveBeenCalled();
    expect(isMember).not.toHaveBeenCalled();
    expect(createMember).not.toHaveBeenCalled();
  });

  test("a policy that is gone gives nothing", async () => {
    readPolicy.mockResolvedValue(null);

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.PolicyGivesNoRole);
  });

  test("a role that is gone, or another project's, gives nothing", async () => {
    readRole.mockResolvedValue(null);

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutIncident),
    ).toBe(PagedPersonRoleOutcome.PolicyGivesNoRole);
    expect(createMember).not.toHaveBeenCalled();
  });
});

describe("a page about something that has no incident roles", () => {
  test("an alert, or nothing at all: nothing is read", async () => {
    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson({
        projectId: PROJECT_ID,
        onCallDutyPolicyId: POLICY_ID,
        userId: DEANE_ID,
      }),
    ).toBe(PagedPersonRoleOutcome.NotAboutAnIncident);
    expect(readPolicy).not.toHaveBeenCalled();
  });
});

describe("a person a policy pages about an incident episode", () => {
  test("is given the role on the episode, which carries it into its incidents", async () => {
    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutEpisode),
    ).toBe(PagedPersonRoleOutcome.Given);

    expect(createMember).not.toHaveBeenCalled();
    expect(createEpisodeMember).toHaveBeenCalledTimes(1);

    const createBy: CreateBy<IncidentEpisodeRoleMember> = createEpisodeMember
      .mock.calls[0]![0] as CreateBy<IncidentEpisodeRoleMember>;

    expect(createBy.data.incidentEpisodeId).toEqual(EPISODE_ID);
    expect(createBy.data.userId).toEqual(DEANE_ID);
    expect(createBy.data.incidentRoleId).toEqual(ROLE_ID);
    expect(createBy.props).toEqual({ isRoot: true });
    expect(
      IncidentRoleFeedText.readCause({
        miscDataProps: createBy.miscDataProps,
        props: createBy.props,
      }),
    ).toEqual({ kind: "onCallPolicy", policyName: "Payments Primary" });
    expect(lock.mock.calls[0]![0]).toMatchObject({
      key: `${EPISODE_ID.toString()}-${ROLE_ID.toString()}`,
    });
  });

  test("the episode's holders count as the incident's do", async () => {
    readRole.mockResolvedValue(roleRow({ canAssignMultipleUsers: false }));
    readEpisodeHolders.mockResolvedValue([episodeHolder(ANA_ID)]);

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutEpisode),
    ).toBe(PagedPersonRoleOutcome.HeldBySomebodyElse);

    readEpisodeHolders.mockResolvedValue([episodeHolder(DEANE_ID)]);

    expect(
      await OnCallPolicyIncidentRole.giveRoleToPagedPerson(pagedAboutEpisode),
    ).toBe(PagedPersonRoleOutcome.AlreadyHeld);
    expect(createEpisodeMember).not.toHaveBeenCalled();
  });
});

describe("the roles pages gave a person on an incident", () => {
  const pageBy: (policyId: ObjectID | null) => UserOnCallLog = (
    policyId: ObjectID | null,
  ): UserOnCallLog => {
    const page: UserOnCallLog = new UserOnCallLog();

    if (policyId) {
      page.onCallDutyPolicyId = policyId;
    }

    return page;
  };

  // The incident is in no episode unless a test says so.
  let readEpisodes: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    readEpisodes = jest
      .spyOn(IncidentEpisodeMemberService, "findBy")
      .mockResolvedValue([]);
  });

  test("are the roles of the policies that paged them about it, each once", async () => {
    const readPages: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockResolvedValue([
        pageBy(POLICY_ID),
        pageBy(POLICY_ID),
        pageBy(OTHER_POLICY_ID),
        // A direct page names no policy.
        pageBy(null),
      ]);

    const givingNone: OnCallDutyPolicy = new OnCallDutyPolicy();
    const readPolicies: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([
        policyRow(new ObjectID(ROLE_ID.toString().toUpperCase())),
        policyRow(OTHER_ROLE_ID),
        givingNone,
      ]);

    const roleIds: Set<string> =
      await OnCallPolicyIncidentRole.getRoleIdsGivenByPages({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        userId: DEANE_ID,
      });

    expect(Array.from(roleIds).sort()).toEqual(
      [ROLE_ID.toString(), OTHER_ROLE_ID.toString()].sort(),
    );
    expect(
      (readPages.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userId: DEANE_ID,
    });
    // The two policies, once each, in the project.
    const policyQuery: { _id: FindOperator<unknown>; projectId: ObjectID } = (
      readPolicies.mock.calls[0]![0] as {
        query: { _id: FindOperator<unknown>; projectId: ObjectID };
      }
    ).query;
    const askedFor: Array<string> = Object.values(
      policyQuery._id.objectLiteralParameters || {},
    )
      .flat()
      .map((value: unknown): string => {
        return String(value);
      })
      .sort();

    expect(askedFor).toEqual(
      [POLICY_ID.toString(), OTHER_POLICY_ID.toString()].sort(),
    );
    expect(policyQuery.projectId).toEqual(PROJECT_ID);
  });

  test("never paged about it: none, and no policy is read", async () => {
    jest.spyOn(UserOnCallLogService, "findBy").mockResolvedValue([]);
    const readPolicies: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OnCallDutyPolicyService,
      "findBy",
    );

    expect(
      (
        await OnCallPolicyIncidentRole.getRoleIdsGivenByPages({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
          userId: DEANE_ID,
        })
      ).size,
    ).toBe(0);
    expect(readPolicies).not.toHaveBeenCalled();
  });

  test("count the pages about an episode the incident is in: its role is carried into the incident", async () => {
    const inEpisode: IncidentEpisodeMember = new IncidentEpisodeMember();
    inEpisode.incidentEpisodeId = EPISODE_ID;
    readEpisodes.mockResolvedValue([inEpisode]);

    const readPages: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserOnCallLogService, "findBy")
      // Never paged about the incident itself...
      .mockResolvedValueOnce([])
      // ...but about its episode.
      .mockResolvedValueOnce([pageBy(POLICY_ID)]);
    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([policyRow(ROLE_ID)]);

    const roleIds: Set<string> =
      await OnCallPolicyIncidentRole.getRoleIdsGivenByPages({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        userId: DEANE_ID,
      });

    expect(Array.from(roleIds)).toEqual([ROLE_ID.toString()]);
    expect(
      (readEpisodes.mock.calls[0]![0] as { query: Record<string, unknown> })
        .query,
    ).toEqual({ projectId: PROJECT_ID, incidentId: INCIDENT_ID });

    const episodeQuery: Record<string, unknown> = (
      readPages.mock.calls[1]![0] as { query: Record<string, unknown> }
    ).query;
    expect(episodeQuery["projectId"]).toEqual(PROJECT_ID);
    expect(episodeQuery["userId"]).toEqual(DEANE_ID);
    expect(
      Object.values(
        (episodeQuery["triggeredByIncidentEpisodeId"] as FindOperator<unknown>)
          .objectLiteralParameters || {},
      ).flat(),
    ).toEqual([EPISODE_ID.toString()]);
  });

  test("an incident in no episode reads no episode's pages", async () => {
    const readPages: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockResolvedValue([]);

    await OnCallPolicyIncidentRole.getRoleIdsGivenByPages({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      userId: DEANE_ID,
    });

    expect(readPages).toHaveBeenCalledTimes(1);
  });
});
