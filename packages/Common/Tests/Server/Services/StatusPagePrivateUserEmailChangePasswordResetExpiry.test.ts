import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The status page half of the same invariant.
 *
 * `POST /status-page-api/reset-password` (App/FeatureSet/Identity/API/
 * StatusPageAuthentication.ts) finds the account by TOKEN HASH and status page
 * id -- never by the address the link was mailed to -- exactly as the
 * dashboard's endpoint does. So a reset link sent to a private status page
 * user's old address keeps working against that account after somebody moves
 * it to a new one, which is the takeover described in
 * UserEmailChangePasswordResetExpiry.test.ts with a different table underneath.
 *
 * It reaches the same end by a different route, and that difference is why the
 * test file exists separately. A status page user cannot edit their own email:
 * the column is writable by ProjectAdmin / StatusPageAdmin, and by
 * StatusPageSCIM.ts syncing from a directory. So the address change here is
 * something done FOR the user -- "move this subscriber to their new address" --
 * which is the same rescue action, and has to invalidate old links for the same
 * reason.
 *
 * Stubbed at the service boundary; no database. The hook is protected and is
 * reached through a structural cast.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const OLD_EMAIL: string = "subscriber@compromised-mailbox.example.com";
const NEW_EMAIL: string = "subscriber@rescued-mailbox.example.com";

interface StatusPagePrivateUserServiceInternals {
  onBeforeUpdate: (
    updateBy: UpdateBy<StatusPagePrivateUser>,
  ) => Promise<OnUpdate<StatusPagePrivateUser>>;
}

function service(): StatusPagePrivateUserServiceInternals {
  return StatusPagePrivateUserService as unknown as StatusPagePrivateUserServiceInternals;
}

type PersistedUserData = {
  id?: ObjectID | undefined;
  email?: string | undefined;
};

function persistedUser(data: PersistedUserData = {}): StatusPagePrivateUser {
  const user: StatusPagePrivateUser = new StatusPagePrivateUser();

  if (data.id !== undefined) {
    user.id = data.id;
    user._id = data.id.toString();
  }

  if (data.email !== undefined) {
    user.email = new Email(data.email);
  }

  return user;
}

/* A project admin editing somebody else's status page subscription. */
function adminProps(): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID("88888888-8888-4888-8888-888888888888"),
    tenantId: PROJECT_ID,
  };
}

type UpdatePayloadData = {
  patch: Record<string, unknown>;
  query?: Record<string, unknown> | undefined;
};

function updatePayload(
  data: UpdatePayloadData,
): UpdateBy<StatusPagePrivateUser> {
  return {
    query: (data.query || {
      _id: USER_ID.toString(),
    }) as unknown as UpdateBy<StatusPagePrivateUser>["query"],
    data: data.patch as unknown as UpdateBy<StatusPagePrivateUser>["data"],
    props: adminProps(),
    limit: 10,
    skip: 0,
  };
}

type Stubs = {
  findBy: jest.SpyInstance;
  updateOneById: jest.SpyInstance;
};

let stubs: Stubs;

describe("StatusPagePrivateUserService.onBeforeUpdate — a reset link dies with the address it was mailed to", () => {
  beforeEach(() => {
    stubs = {
      findBy: jest
        .spyOn(StatusPagePrivateUserService, "findBy")
        .mockResolvedValue([
          persistedUser({ id: USER_ID, email: OLD_EMAIL }),
        ] as never),
      updateOneById: jest
        .spyOn(StatusPagePrivateUserService, "updateOneById")
        .mockResolvedValue(undefined as never),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("moving a subscriber to a new address kills the outstanding link first", async () => {
    /*
     * `onBeforeUpdate` returns before the caller's UPDATE runs, so the write
     * having already happened here is what rules out any interval in which the
     * account answers to the new address while the old link still works.
     */
    await service().onBeforeUpdate(
      updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
    );

    const write: {
      id: ObjectID;
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = stubs.updateOneById.mock.calls[0]![0] as unknown as {
      id: ObjectID;
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
    expect(write.id.toString()).toBe(USER_ID.toString());
    expect(write.data).toEqual({
      resetPasswordToken: null,
      resetPasswordExpires: null,
    });
    expect(write.props.isRoot).toBe(true);
    expect(write.props.ignoreHooks).toBe(true);
  });

  test("the admin's own update is left exactly as it was", async () => {
    /*
     * Same reason as on the dashboard user: `resetPasswordToken` is declared
     * `update: []`, and the permission check runs after this hook, so folding
     * the nulls into the caller's data would turn every admin email edit into
     * a permission error.
     */
    const payload: UpdateBy<StatusPagePrivateUser> = updatePayload({
      patch: { email: new Email(NEW_EMAIL) },
    });

    await service().onBeforeUpdate(payload);

    expect(Object.keys(payload.data)).toEqual(["email"]);
  });

  test("a SCIM push that re-sends the address unchanged leaves the link alone", async () => {
    await service().onBeforeUpdate(
      updatePayload({ patch: { email: new Email(OLD_EMAIL) } }),
    );

    expect(stubs.updateOneById).not.toHaveBeenCalled();
  });

  test("the same address in different case is not a change", async () => {
    /*
     * `Email` lowercases on construction, and the comparison lowercases too,
     * so this keeps holding if a raw string ever reaches `data.email`.
     */
    stubs.findBy.mockResolvedValue([
      persistedUser({ id: USER_ID, email: "Subscriber@Example.com" }),
    ] as never);

    await service().onBeforeUpdate(
      updatePayload({ patch: { email: new Email("subscriber@example.com") } }),
    );

    expect(stubs.updateOneById).not.toHaveBeenCalled();
  });

  test("an update that does not touch the address loads nothing and clears nothing", async () => {
    await service().onBeforeUpdate(
      updatePayload({ patch: { name: new Name("Subscriber") } }),
    );

    expect(stubs.findBy).not.toHaveBeenCalled();
    expect(stubs.updateOneById).not.toHaveBeenCalled();
  });

  test("across several matched rows only the ones actually changing are cleared", async () => {
    stubs.findBy.mockResolvedValue([
      persistedUser({ id: USER_ID, email: OLD_EMAIL }),
      persistedUser({ id: OTHER_USER_ID, email: NEW_EMAIL }),
    ] as never);

    await service().onBeforeUpdate(
      updatePayload({
        patch: { email: new Email(NEW_EMAIL) },
        query: { statusPageId: STATUS_PAGE_ID.toString() },
      }),
    );

    const clearedIds: Array<string> = stubs.updateOneById.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { id: ObjectID }).id.toString();
      },
    );

    expect(clearedIds).toEqual([USER_ID.toString()]);
  });

  test("a row whose address could not be read is treated as changed", async () => {
    stubs.findBy.mockResolvedValue([persistedUser({ id: USER_ID })] as never);

    await service().onBeforeUpdate(
      updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
    );

    expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("a row that came back without an id is skipped rather than throwing", async () => {
    stubs.findBy.mockResolvedValue([
      persistedUser({ email: OLD_EMAIL }),
      persistedUser({ id: USER_ID, email: OLD_EMAIL }),
    ] as never);

    await expect(
      service().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
      ),
    ).resolves.toBeDefined();

    expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("the hook hands the caller's update straight back", async () => {
    const payload: UpdateBy<StatusPagePrivateUser> = updatePayload({
      patch: { email: new Email(NEW_EMAIL) },
    });

    const result: OnUpdate<StatusPagePrivateUser> =
      await service().onBeforeUpdate(payload);

    expect(result.updateBy).toBe(payload);
    expect(result.carryForward).toBeNull();
  });
});
