import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import PrivateUserEmailAddressChangedNotice, {
  PrivateUserEmailAddressChangedEvent,
} from "../../../Server/Utils/StatusPage/PrivateUserEmailAddressChangedNotice";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import {
  EMAIL_ADDRESS_CHANGED_BY_KEY,
  EmailAddressChangedBy,
} from "../../../Types/Accounts/EmailAddressChangedEmail";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { PrivateUserEmailAddressChangedBy } from "../../../Types/StatusPage/PrivateUserEmailAddressChangedEmail";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

/*
 * EVERY ADDRESS A STATUS PAGE PRIVATE USER LEAVES IS TOLD (#10156).
 *
 * StatusPagePrivateUserService reads, before an update, the private users
 * whose address it changes (onBeforeUpdate), and once the update is through
 * emails each of them at the address they had (onUpdateSuccess,
 * PrivateUserEmailAddressChangedNotice). Through those hooks, without a
 * database, each way an address changes:
 *
 *   - the status page's team, on the Dashboard's Private Users page or the
 *     API: a request's write;
 *   - the page's identity provider, through SCIM: root, naming itself
 *     (ee's StatusPageSCIM, pinned there);
 *   - another root write, which names nobody.
 *
 * Exactly one email per user whose address changed, to the address they
 * had; none for the address they already have, in any case; none for a row
 * the write did not reach; and the answer never waits on it.
 */

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const OLD_EMAIL: string = "river@old-mailbox.example.com";
const NEW_EMAIL: string = "river@new-mailbox.example.com";

interface ServiceInternals {
  onBeforeUpdate: (
    updateBy: UpdateBy<StatusPagePrivateUser>,
  ) => Promise<OnUpdate<StatusPagePrivateUser>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<StatusPagePrivateUser>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<StatusPagePrivateUser>>;
}

function service(): ServiceInternals {
  return StatusPagePrivateUserService as unknown as ServiceInternals;
}

function privateUser(
  email: string,
  id: ObjectID = USER_ID,
  statusPageId: ObjectID = STATUS_PAGE_ID,
): StatusPagePrivateUser {
  const user: StatusPagePrivateUser = new StatusPagePrivateUser();
  user.id = id;
  user._id = id.toString();
  user.email = new Email(email);
  user.statusPageId = statusPageId;
  return user;
}

// A teammate on the status page's project.
const TEAM: DatabaseCommonInteractionProps = {
  userId: new ObjectID("88888888-8888-4888-8888-888888888888"),
  tenantId: PROJECT_ID,
};

function update(
  patch: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
  miscDataProps?: JSONObject,
): UpdateBy<StatusPagePrivateUser> {
  return {
    query: {
      _id: USER_ID.toString(),
    } as unknown as UpdateBy<StatusPagePrivateUser>["query"],
    data: patch as unknown as UpdateBy<StatusPagePrivateUser>["data"],
    ...(miscDataProps ? { miscDataProps: miscDataProps } : {}),
    props: props,
    limit: 10,
    skip: 0,
  };
}

let findBy: jest.SpyInstance;
let send: jest.SpyInstance;

async function write(
  updateBy: UpdateBy<StatusPagePrivateUser>,
  written: Array<ObjectID> = [USER_ID],
): Promise<void> {
  const onUpdate: OnUpdate<StatusPagePrivateUser> =
    await service().onBeforeUpdate(updateBy);
  await service().onUpdateSuccess(onUpdate, written);
}

function told(): Array<PrivateUserEmailAddressChangedEvent> {
  return send.mock.calls.map(
    (call: Array<unknown>): PrivateUserEmailAddressChangedEvent => {
      return call[0] as PrivateUserEmailAddressChangedEvent;
    },
  );
}

function onlyNotice(): PrivateUserEmailAddressChangedEvent {
  expect(send).toHaveBeenCalledTimes(1);
  return told()[0]!;
}

beforeEach(() => {
  findBy = jest
    .spyOn(StatusPagePrivateUserService, "findBy")
    .mockResolvedValue([privateUser(OLD_EMAIL)] as never);
  stubRowsCallerMayWriteLikeFindBy(StatusPagePrivateUserService, findBy);
  jest
    .spyOn(StatusPagePrivateUserService, "updateOneById")
    .mockResolvedValue(undefined as never);
  send = jest
    .spyOn(PrivateUserEmailAddressChangedNotice, "send")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("each way an address changes tells the address the user had, once", () => {
  test("the status page's team, on Private Users or the API", async () => {
    await write(update({ email: new Email(NEW_EMAIL) }, TEAM));

    const notice: PrivateUserEmailAddressChangedEvent = onlyNotice();

    expect(notice.privateUserId.toString()).toBe(USER_ID.toString());
    expect(notice.statusPageId.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(notice.previousEmail.toString()).toBe(OLD_EMAIL);
    expect(notice.newEmail.toString()).toBe(NEW_EMAIL);
    expect(notice.changedBy).toBe(
      PrivateUserEmailAddressChangedBy.StatusPageTeam,
    );
    expect(notice.at).toBeInstanceOf(Date);
  });

  test("SCIM: the page's identity provider, naming itself", async () => {
    // ee's StatusPageSCIM writes exactly this for a new address.
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { isRoot: true },
        {
          [EMAIL_ADDRESS_CHANGED_BY_KEY]:
            EmailAddressChangedBy.IdentityProvider,
        },
      ),
    );

    expect(onlyNotice().changedBy).toBe(
      PrivateUserEmailAddressChangedBy.IdentityProvider,
    );
  });

  test("another root write names nobody", async () => {
    await write(update({ email: new Email(NEW_EMAIL) }, { isRoot: true }));

    expect(onlyNotice().changedBy).toBe(
      PrivateUserEmailAddressChangedBy.OneUptime,
    );
  });

  test("a teammate's request cannot say it is the identity provider", async () => {
    await write(
      update({ email: new Email(NEW_EMAIL) }, TEAM, {
        [EMAIL_ADDRESS_CHANGED_BY_KEY]: EmailAddressChangedBy.IdentityProvider,
      }),
    );

    expect(onlyNotice().changedBy).toBe(
      PrivateUserEmailAddressChangedBy.StatusPageTeam,
    );
  });

  test("two users one write moves are each told at their own address, on their own page", async () => {
    findBy.mockResolvedValue([
      privateUser(OLD_EMAIL),
      privateUser(
        "lake@old-mailbox.example.com",
        OTHER_USER_ID,
        OTHER_STATUS_PAGE_ID,
      ),
    ] as never);

    await write(update({ email: new Email(NEW_EMAIL) }, TEAM), [
      USER_ID,
      OTHER_USER_ID,
    ]);

    expect(
      told().map((notice: PrivateUserEmailAddressChangedEvent) => {
        return [
          notice.privateUserId.toString(),
          notice.previousEmail.toString(),
          notice.statusPageId.toString(),
        ];
      }),
    ).toEqual([
      [USER_ID.toString(), OLD_EMAIL, STATUS_PAGE_ID.toString()],
      [
        OTHER_USER_ID.toString(),
        "lake@old-mailbox.example.com",
        OTHER_STATUS_PAGE_ID.toString(),
      ],
    ]);
  });
});

describe("the writes that tell nobody", () => {
  test.each([
    ["as it is", OLD_EMAIL],
    ["in capitals", OLD_EMAIL.toUpperCase()],
  ])(
    "the address the user already has, %s: SCIM sends it with every push",
    async (_label: string, email: string) => {
      await write(
        update(
          { email: new Email(email) },
          { isRoot: true },
          {
            [EMAIL_ADDRESS_CHANGED_BY_KEY]:
              EmailAddressChangedBy.IdentityProvider,
          },
        ),
      );

      expect(send).not.toHaveBeenCalled();
    },
  );

  test("a write that changes no address", async () => {
    await write(update({ isSsoUser: true }, TEAM));

    expect(send).not.toHaveBeenCalled();
  });

  test("a row the write did not reach", async () => {
    await write(update({ email: new Email(NEW_EMAIL) }, TEAM), []);

    expect(send).not.toHaveBeenCalled();
  });
});

describe("never in the write's way", () => {
  test("the update is answered without waiting for the email", async () => {
    send.mockReturnValue(
      new Promise<boolean>(() => {
        // Never settles: a mail server that does not answer.
      }),
    );

    await expect(
      write(update({ email: new Email(NEW_EMAIL) }, TEAM)),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
