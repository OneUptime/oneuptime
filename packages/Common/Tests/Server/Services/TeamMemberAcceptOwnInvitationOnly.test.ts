import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONLY THE PERSON INVITED ACCEPTS AN INVITATION.
 *
 * A membership is never created accepted on someone's behalf
 * (TeamMemberService.onBeforeCreate), but an update could accept one: the
 * inviter's permission to change memberships - and CurrentUser, which
 * every signed-in person holds, on the column - let an inviter set
 * hasAcceptedInvitation on anyone's pending invitation, pulling that
 * account into the project, onto its teams and into on-call, without its
 * owner ever agreeing. Now an update that accepts is refused unless every
 * membership it writes is the caller's own. OneUptime's own writes and a
 * master admin's are left alone.
 */

const INVITEE_ID: ObjectID = new ObjectID(
  "13000000-0000-4000-8000-000000000001",
);
const INVITER_ID: ObjectID = new ObjectID(
  "13000000-0000-4000-8000-000000000002",
);

function membershipOf(userId: ObjectID): TeamMember {
  const membership: TeamMember = new TeamMember();
  membership._id = ObjectID.generate().toString();
  membership.userId = userId;
  return membership;
}

// Runs the update hook as `props` for an update writing `data`.
async function runUpdate(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  return await (
    TeamMemberService as unknown as {
      onBeforeUpdate: (updateBy: UpdateBy<TeamMember>) => Promise<unknown>;
    }
  ).onBeforeUpdate({
    query: { _id: ObjectID.generate().toString() },
    data: data,
    props: props,
  } as unknown as UpdateBy<TeamMember>);
}

let rowsWritten: Array<TeamMember> = [];

beforeEach(() => {
  rowsWritten = [membershipOf(INVITEE_ID)];

  // The project references the update names are not what is asked here.
  jest
    .spyOn(
      ProjectReferencesService.prototype as unknown as {
        onBeforeUpdate: (...args: Array<never>) => unknown;
      },
      "onBeforeUpdate",
    )
    .mockImplementation((async (updateBy: UpdateBy<TeamMember>) => {
      return { updateBy: updateBy, carryForward: null };
    }) as never);

  jest
    .spyOn(
      TeamMemberService as unknown as {
        findRowsAndHoldUpdateToThem: (...args: Array<never>) => unknown;
      },
      "findRowsAndHoldUpdateToThem",
    )
    .mockImplementation((async (): Promise<Array<TeamMember>> => {
      return rowsWritten;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("accepting an invitation by an update", () => {
  test("the person invited accepts their own", async () => {
    await expect(
      runUpdate({ hasAcceptedInvitation: true }, { userId: INVITEE_ID }),
    ).resolves.toBeDefined();
  });

  test("an inviter does not accept someone else's", async () => {
    await expect(
      runUpdate({ hasAcceptedInvitation: true }, { userId: INVITER_ID }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    // Nor by stamping the time it was accepted.
    await expect(
      runUpdate(
        { invitationAcceptedAt: new Date() },
        { userId: INVITER_ID },
      ),
    ).rejects.toThrow(
      "Only the person invited can accept an invitation to a team.",
    );
  });

  test("an update that also writes someone else's membership is refused whole", async () => {
    rowsWritten = [membershipOf(INVITEE_ID), membershipOf(INVITER_ID)];

    await expect(
      runUpdate({ hasAcceptedInvitation: true }, { userId: INVITEE_ID }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a caller who is no person accepts nothing", async () => {
    await expect(
      runUpdate({ hasAcceptedInvitation: true }, {}),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("OneUptime's own writes and a master admin's are left alone", async () => {
    for (const props of [
      { isRoot: true },
      { isMasterAdmin: true, userId: INVITER_ID },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        runUpdate({ hasAcceptedInvitation: true }, props),
      ).resolves.toBeDefined();
    }
  });

  test("an update that accepts nothing reads nothing", async () => {
    await expect(
      runUpdate({ updatedAt: new Date() }, { userId: INVITER_ID }),
    ).resolves.toBeDefined();

    expect(
      (
        TeamMemberService as unknown as {
          findRowsAndHoldUpdateToThem: jest.Mock;
        }
      ).findRowsAndHoldUpdateToThem,
    ).not.toHaveBeenCalled();
  });
});
