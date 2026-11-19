import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import IncidentOwnerUser from "../../../../Models/DatabaseModels/IncidentOwnerUser";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import PendingInviteeProfiles from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";

/*
 * ONEUPTIME AI READS PEOPLE AS THE PROJECT IT WRITES FOR DOES (#9934).
 *
 * A run of OneUptime's own made for the readers of a subject - an AI
 * investigation of an incident or an alert, the fixes it works out, a
 * security case's triage (ReadAudience, #9576) - reads as root, but writes
 * for everyone who may see the subject: its report goes into the subject's
 * feed and channels, and OneUptime AI repeats what it read to whoever
 * asks. Its tools read an incident's owners, a team's members, who is on
 * call, through the ordinary read path (DatabaseService), which withholds
 * a pending invitee's own profile from everyone but OneUptime and a master
 * admin (#9823). So, as root, the run read - and could repeat - the
 * account's own name of someone the project had only invited.
 *
 * A read for an audience now reads people as its project does: someone
 * only invited there by the name typed for them, or none (the address
 * stays); their picture, two-factor flag and account dates withheld; a
 * filter on their name kept from spelling it out. Every other root read,
 * and a master admin's, sees every profile as before.
 */

const PROJECT_ID: string = "99340000-4444-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "99340000-4444-4000-8000-000000000002";
const PENDING_ID: string = "99340000-4444-4000-8000-0000000000b2";
const MEMBER_ID: string = "99340000-4444-4000-8000-0000000000a1";

function audience(projectId: string = PROJECT_ID): ReadAudience {
  return {
    _type: "ReadAudience",
    projectId: projectId,
    ownedOnlyPermissions: [],
    labelledPermissions: [],
    named: {},
    telemetryBlockedIds: [],
  };
}

// The props a run reads with (ReadAudiencePermission.getReadProps).
function audienceProps(
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    isRoot: true,
    tenantId: new ObjectID(PROJECT_ID),
    readAudience: audience(),
    ...overrides,
  };
}

// A person as a read returns them through a relation, every column read.
function personRead(id: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name("Their Own Name");
  user.profilePictureId = new ObjectID("99340000-4444-4000-8000-0000000000dd");
  user.twoFactorAuthEnabled = true;
  user.createdAt = new Date("2020-01-01T00:00:00Z");
  user.updatedAt = new Date("2026-11-19T10:00:00Z");
  return user;
}

// An incident's owner, as an AI tool reads the incident's owners.
function ownerRead(userId: string): IncidentOwnerUser {
  const owner: IncidentOwnerUser = new IncidentOwnerUser();
  owner._id = ObjectID.generate().toString();
  owner.user = personRead(userId);
  return owner;
}

const OWNER_SELECT: unknown = {
  _id: true,
  user: {
    _id: true,
    name: true,
    email: true,
    profilePictureId: true,
    twoFactorAuthEnabled: true,
    createdAt: true,
    updatedAt: true,
  },
};

function pendingIn(
  projectId: string,
  inviteeName: string | null,
): SpyInstance<typeof PendingInviteeProfiles.readPendingMemberships> {
  return jest
    .spyOn(PendingInviteeProfiles, "readPendingMemberships")
    .mockResolvedValue([
      {
        userId: PENDING_ID,
        projectId: projectId,
        inviteeName: inviteeName,
        createdAt: new Date(),
      },
    ]);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who sees every profile", () => {
  test("OneUptime's own reads and a master admin's, as before", () => {
    expect(PendingInviteeProfiles.seesEveryProfile({ isRoot: true })).toBe(
      true,
    );
    expect(
      PendingInviteeProfiles.seesEveryProfile({ isMasterAdmin: true }),
    ).toBe(true);
    expect(
      PendingInviteeProfiles.seesEveryProfile({
        isRoot: true,
        tenantId: new ObjectID(PROJECT_ID),
      }),
    ).toBe(true);
  });

  test("never a run of OneUptime's own for the readers of a subject", () => {
    expect(PendingInviteeProfiles.seesEveryProfile(audienceProps())).toBe(
      false,
    );
  });

  test("an audience counts only on OneUptime's own reads, as ReadAudiencePermission reads it", () => {
    expect(
      PendingInviteeProfiles.getAudienceProjectId({
        readAudience: audience(),
      }),
    ).toBeNull();
    expect(PendingInviteeProfiles.getAudienceProjectId({ isRoot: true })).toBe(
      null,
    );
    expect(
      PendingInviteeProfiles.getAudienceProjectId(
        audienceProps({ readAudience: audience("not-a-project") }),
      ),
    ).toBeNull();
    expect(PendingInviteeProfiles.getAudienceProjectId(audienceProps())).toBe(
      PROJECT_ID,
    );
  });
});

describe("whom a run for an audience reads as", () => {
  test("its project, whatever else its props carry - nobody in particular", () => {
    expect(PendingInviteeProfiles.getReader(audienceProps())).toEqual({
      projectId: PROJECT_ID,
    });
    expect(
      PendingInviteeProfiles.getReader(
        audienceProps({
          tenantId: new ObjectID(OTHER_PROJECT_ID),
          userId: new ObjectID(MEMBER_ID),
        }),
      ),
    ).toEqual({ projectId: PROJECT_ID });
    expect(
      PendingInviteeProfiles.getReaderUserId(
        audienceProps({ userId: new ObjectID(MEMBER_ID) }),
      ),
    ).toBeNull();
  });

  test("its project, upper-case id or not", () => {
    expect(
      PendingInviteeProfiles.getReader(
        audienceProps({ readAudience: audience(PROJECT_ID.toUpperCase()) }),
      ),
    ).toEqual({ projectId: PROJECT_ID });
  });
});

describe("what a run for an audience reads of a person through a relation", () => {
  test("an owner only invited shows the name typed for them - never their own - and no picture, two-factor flag or account dates", async () => {
    const asked: SpyInstance<
      typeof PendingInviteeProfiles.readPendingMemberships
    > = pendingIn(PROJECT_ID, "Grace (typed)");

    const rows: Array<IncidentOwnerUser> = [ownerRead(PENDING_ID)];

    await PendingInviteeProfiles.withholdFromRows({
      modelType: IncidentOwnerUser,
      rows: rows,
      select: OWNER_SELECT,
      props: audienceProps(),
    });

    const user: User = rows[0]!.user!;

    expect(user.name?.toString()).toBe("Grace (typed)");
    expect(user.profilePictureId).toBeUndefined();
    expect(user.twoFactorAuthEnabled).toBeUndefined();
    expect(user.createdAt).toBeUndefined();
    expect(user.updatedAt).toBeUndefined();
    expect(user._id).toBe(PENDING_ID);

    // Asked about the audience's one project.
    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0]![0].reader).toEqual({ projectId: PROJECT_ID });
    expect(asked.mock.calls[0]![0].userIds).toEqual([PENDING_ID]);
  });

  test("an owner only invited with no name typed shows no name at all - never their own", async () => {
    pendingIn(PROJECT_ID, null);

    const rows: Array<IncidentOwnerUser> = [ownerRead(PENDING_ID)];

    await PendingInviteeProfiles.withholdFromRows({
      modelType: IncidentOwnerUser,
      rows: rows,
      select: OWNER_SELECT,
      props: audienceProps(),
    });

    expect(rows[0]!.user!.name).toBeUndefined();
  });

  test("a member keeps their name, and only their account dates are withheld", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readPendingMemberships")
      .mockResolvedValue([]);

    const rows: Array<TeamMember> = [new TeamMember()];
    rows[0]!.user = personRead(MEMBER_ID);

    await PendingInviteeProfiles.withholdFromRows({
      modelType: TeamMember,
      rows: rows,
      select: OWNER_SELECT,
      props: audienceProps(),
    });

    expect(rows[0]!.user!.name?.toString()).toBe("Their Own Name");
    expect(rows[0]!.user!.createdAt).toBeUndefined();
  });

  test("OneUptime's own read with no audience sees the profile, and nothing is asked", async () => {
    const asked: SpyInstance<
      typeof PendingInviteeProfiles.readPendingMemberships
    > = jest.spyOn(PendingInviteeProfiles, "readPendingMemberships");

    const rows: Array<IncidentOwnerUser> = [ownerRead(PENDING_ID)];

    await PendingInviteeProfiles.withholdFromRows({
      modelType: IncidentOwnerUser,
      rows: rows,
      select: OWNER_SELECT,
      props: { isRoot: true, tenantId: new ObjectID(PROJECT_ID) },
    });

    expect(rows[0]!.user!.name?.toString()).toBe("Their Own Name");
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("what a run for an audience filters by", () => {
  test("a filter on a person's name matches nobody only invited to its project", () => {
    const query: Record<string, unknown> = {
      user: { name: "Grace" },
    };

    const narrowed: Record<string, unknown> =
      PendingInviteeProfiles.narrowRelationFilters({
        modelType: IncidentOwnerUser,
        query: query,
        props: audienceProps(),
      });

    expect(narrowed).not.toBe(query);
    expect((narrowed["user"] as Record<string, unknown>)["_id"]).toBeDefined();
    // The query handed in is never written to.
    expect(query).toEqual({ user: { name: "Grace" } });
  });

  test("OneUptime's own read with no audience is left as it is", () => {
    const query: Record<string, unknown> = { user: { name: "Grace" } };

    expect(
      PendingInviteeProfiles.narrowRelationFilters({
        modelType: IncidentOwnerUser,
        query: query,
        props: { isRoot: true },
      }),
    ).toBe(query);
  });
});
