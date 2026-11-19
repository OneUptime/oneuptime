import CloudResourceService from "../../../../../Server/Services/CloudResourceService";
import DockerHostService from "../../../../../Server/Services/DockerHostService";
import HostService from "../../../../../Server/Services/HostService";
import KubernetesClusterService from "../../../../../Server/Services/KubernetesClusterService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../../Server/Services/NetworkDeviceService";
import OpenStackCloudService from "../../../../../Server/Services/OpenStackCloudService";
import PodmanHostService from "../../../../../Server/Services/PodmanHostService";
import ServerlessFunctionService from "../../../../../Server/Services/ServerlessFunctionService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import UserService from "../../../../../Server/Services/UserService";
import logger from "../../../../../Server/Utils/Logger";
import ResourceSecurity, {
  ResourceSecurityIdentity,
} from "../../../../../Server/Utils/SecurityEvent/Connections/ResourceSecurity";
import SecurityConnectedRecords, {
  SecurityConnectedRecord,
  SecurityConnectedRecordsResult,
} from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import User from "../../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../../Types/Email";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityConnectionKind } from "../../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * SECURITY EVENTS NAME A MEMBERSHIP AS THE PROJECT KNOWS ITS PERSON (#9934).
 *
 * Security Events connects a case's users to the project's members by
 * email (SecurityConnectedRecords: a case's Connected Signals, and the
 * triage OneUptime AI reads), and a member's page has a Security card
 * (ResourceSecurity). A membership can be an invitation not accepted yet,
 * and who its person is was read as OneUptime: the account's own name,
 * which the project does not see until they join (#9823). Each is named
 * as the project knows them instead: the name typed for them, else their
 * address. A member keeps their own name.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "99340000-3333-4000-8000-000000000001",
);
const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("99340000-3333-4000-8000-000000000002"),
  tenantId: PROJECT_ID,
};

const MEMBER_ID: string = "99340000-3333-4000-8000-0000000000a1";
const NAMED_INVITEE_ID: string = "99340000-3333-4000-8000-0000000000b2";
const UNNAMED_INVITEE_ID: string = "99340000-3333-4000-8000-0000000000c3";

const ACCOUNTS: Record<string, { name: string; email: string }> = {
  [MEMBER_ID]: { name: "Mia Member", email: "mia@acme.example" },
  [NAMED_INVITEE_ID]: { name: "Ingrid Account", email: "ingrid@acme.example" },
  [UNNAMED_INVITEE_ID]: { name: "Uma Account", email: "uma@acme.example" },
};

// The invitees' own account names: never in what the project reads.
const OWN_NAMES: Array<string> = ["Ingrid Account", "Uma Account"];

let withheldIn: SpyInstance<
  typeof PendingInviteeProfiles.readWithheldProfilesInProject
>;

function account(id: string): User {
  const user: User = new User(new ObjectID(id));
  user.name = new Name(ACCOUNTS[id]!.name);
  user.email = new Email(ACCOUNTS[id]!.email);
  return user;
}

function expectNoOwnNameOfAnInvitee(value: unknown): void {
  const text: string = JSON.stringify(value);

  for (const name of OWN_NAMES) {
    expect(text).not.toContain(name);
  }
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  withheldIn = jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation((async (): Promise<Map<string, WithheldProfile>> => {
      return new Map<string, WithheldProfile>([
        [NAMED_INVITEE_ID, { inviteeName: "Ingrid from Security" }],
        [UNNAMED_INVITEE_ID, { inviteeName: null }],
      ]);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a member's Security card (ResourceSecurity.readIdentity)", () => {
  async function identityOf(
    userId: string,
  ): Promise<ResourceSecurityIdentity | null> {
    jest
      .spyOn(TeamMemberService, "findOneBy")
      .mockResolvedValue({ userId: new ObjectID(userId) } as never);
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(account(userId) as never);

    return await ResourceSecurity.readIdentity({
      projectId: PROJECT_ID,
      kind: SecurityConnectionKind.User,
      id: new ObjectID(userId),
      props: CALLER,
    });
  }

  test("someone only invited is named by the name typed for them, and searched for by their address", async () => {
    const identity: ResourceSecurityIdentity | null =
      await identityOf(NAMED_INVITEE_ID);

    expect(identity?.name).toBe("Ingrid from Security");
    expect(identity?.names).toEqual(["ingrid@acme.example"]);
    expect(identity?.entity).toEqual({
      type: SecurityEntityType.User,
      value: "ingrid@acme.example",
    });
    expectNoOwnNameOfAnInvitee(identity);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });

  test("someone only invited with no name typed is named by their address", async () => {
    const identity: ResourceSecurityIdentity | null =
      await identityOf(UNNAMED_INVITEE_ID);

    expect(identity?.name).toBe("uma@acme.example");
    expectNoOwnNameOfAnInvitee(identity);
  });

  test("a member is named by their own name", async () => {
    expect((await identityOf(MEMBER_ID))?.name).toBe("Mia Member");
  });
});

describe("a case's members by email (SecurityConnectedRecords.resolve)", () => {
  let users: SpyInstance<typeof UserService.findBy>;
  let members: SpyInstance<typeof TeamMemberService.findBy>;

  beforeEach(() => {
    for (const service of [
      HostService,
      DockerHostService,
      PodmanHostService,
      KubernetesClusterService,
      OpenStackCloudService,
      NetworkDeviceService,
      ServiceService,
      MonitorService,
      CloudResourceService,
      ServerlessFunctionService,
    ]) {
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);
    }

    users = jest
      .spyOn(UserService, "findBy")
      .mockResolvedValue(Object.keys(ACCOUNTS).map(account) as never);
    // All three hold a membership: one accepted, two invitations.
    members = jest.spyOn(TeamMemberService, "findBy").mockResolvedValue(
      Object.keys(ACCOUNTS).map((userId: string) => {
        return { userId: new ObjectID(userId) };
      }) as never,
    );
  });

  async function resolve(): Promise<SecurityConnectedRecordsResult> {
    return await SecurityConnectedRecords.resolve({
      projectId: PROJECT_ID,
      entities: Object.values(ACCOUNTS).map(
        (each: { name: string; email: string }) => {
          return { type: SecurityEntityType.User, value: each.email };
        },
      ),
      props: CALLER,
    });
  }

  function nameOf(
    result: SecurityConnectedRecordsResult,
    userId: string,
  ): string | undefined {
    return result.records.find((record: SecurityConnectedRecord): boolean => {
      return (
        record.kind === SecurityConnectionKind.User && record.id === userId
      );
    })?.name;
  }

  test("someone only invited by the name typed for them, else their address; a member by their own name", async () => {
    const result: SecurityConnectedRecordsResult = await resolve();

    expect(nameOf(result, MEMBER_ID)).toBe("Mia Member");
    expect(nameOf(result, NAMED_INVITEE_ID)).toBe("Ingrid from Security");
    expect(nameOf(result, UNNAMED_INVITEE_ID)).toBe("uma@acme.example");
    expectNoOwnNameOfAnInvitee(result.records);
  });

  test("who is only invited is read once for every member found, in the case's project", async () => {
    await resolve();

    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect([...withheldIn.mock.calls[0]![0].userIds].sort()).toEqual(
      Object.keys(ACCOUNTS).sort(),
    );
    // The people as OneUptime, the memberships as the caller, as before.
    expect(users.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(members.mock.calls[0]![0].props).toBe(CALLER);
  });

  test("when who is only invited cannot be read, no member is named, and their kind is said to have failed", async () => {
    withheldIn.mockRejectedValue(new Error("db down") as never);

    const result: SecurityConnectedRecordsResult = await resolve();

    expect(
      result.records.filter((record: SecurityConnectedRecord): boolean => {
        return record.kind === SecurityConnectionKind.User;
      }),
    ).toEqual([]);
    expect(result.failedKinds).toContain(SecurityConnectionKind.User);
    expectNoOwnNameOfAnInvitee(result);
  });

  test("no member found: nothing more is read", async () => {
    members.mockResolvedValue([] as never);

    const result: SecurityConnectedRecordsResult = await resolve();

    expect(result.records).toEqual([]);
    expect(withheldIn).not.toHaveBeenCalled();
  });
});
