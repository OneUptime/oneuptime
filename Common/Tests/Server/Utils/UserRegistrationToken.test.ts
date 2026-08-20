import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import EmailVerificationTokenService from "../../../Server/Services/EmailVerificationTokenService";
import UserRegistrationToken, {
  REGISTRATION_TOKEN_EXPIRY_IN_DAYS,
} from "../../../Server/Utils/UserRegistrationToken";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The gate on claiming an invited account (GHSA-qg84-6hrg-mr5g).
 *
 * An invited user's row exists, with no password, before they have ever
 * authenticated. Whoever can spend one of these tokens gets to put a password
 * on that row and walk in, so the interesting cases here are all the ways a
 * token must NOT be spendable: not by a different address, not after it has
 * expired, and not twice.
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const TOKEN_ROW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TOKEN: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const INVITED_EMAIL: Email = new Email("alice@company.com");
const OTHER_EMAIL: Email = new Email("mallory@company.com");

let createSpy: jest.SpyInstance;
let findOneBySpy: jest.SpyInstance;
let deleteOneBySpy: jest.SpyInstance;

/*
 * A live, valid token row for INVITED_EMAIL.
 *
 * Overrides are loosely typed so a test can put a column back to undefined --
 * a half-written row read out of the database. exactOptionalPropertyTypes
 * forbids expressing that through Partial<EmailVerificationToken>, and those
 * are exactly the rows consumeRegistrationToken has to refuse.
 */
function tokenRow(
  overrides: Record<string, unknown> = {},
): EmailVerificationToken {
  const row: EmailVerificationToken = new EmailVerificationToken(TOKEN_ROW_ID);
  row._id = TOKEN_ROW_ID.toString();
  row.email = INVITED_EMAIL;
  row.expires = OneUptimeDate.getSomeDaysAfter(1);

  return Object.assign(row, overrides);
}

beforeEach(() => {
  createSpy = jest
    .spyOn(EmailVerificationTokenService, "create")
    .mockResolvedValue(new EmailVerificationToken());

  findOneBySpy = jest
    .spyOn(EmailVerificationTokenService, "findOneBy")
    .mockResolvedValue(tokenRow());

  deleteOneBySpy = jest
    .spyOn(EmailVerificationTokenService, "deleteOneBy")
    .mockResolvedValue(1);

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserRegistrationToken.generateRegistrationToken", () => {
  test("binds the token to the user and the address it will be mailed to", async () => {
    const token: ObjectID =
      await UserRegistrationToken.generateRegistrationToken({
        userId: USER_ID,
        email: INVITED_EMAIL,
      });

    const created: EmailVerificationToken = createSpy.mock.calls[0]![0][
      "data"
    ] as EmailVerificationToken;

    expect(created.userId!.toString()).toBe(USER_ID.toString());
    expect(created.email!.toString()).toBe(INVITED_EMAIL.toString());
    expect(created.token!.toString()).toBe(token.toString());
  });

  test("mints a fresh unguessable token each time", async () => {
    const first: ObjectID =
      await UserRegistrationToken.generateRegistrationToken({
        userId: USER_ID,
        email: INVITED_EMAIL,
      });
    const second: ObjectID =
      await UserRegistrationToken.generateRegistrationToken({
        userId: USER_ID,
        email: INVITED_EMAIL,
      });

    expect(first.toString()).not.toBe(second.toString());
    expect(ObjectID.isValidUUID(first.toString())).toBe(true);
  });

  test("expires, and outlives a plain verification link", async () => {
    /*
     * Invitations get read when the person gets round to them, so these last
     * days rather than the 24 hours a verification link gets. They still have
     * to expire -- an invitation mail sitting in an old inbox forever is a
     * standing key to the account.
     */
    await UserRegistrationToken.generateRegistrationToken({
      userId: USER_ID,
      email: INVITED_EMAIL,
    });

    const created: EmailVerificationToken = createSpy.mock.calls[0]![0][
      "data"
    ] as EmailVerificationToken;

    /*
     * The source stamps expires = now + N days, then a few milliseconds later
     * this test reads the clock again to measure the gap. Measuring in whole
     * days would truncate that sub-day drift down to N-1 (moment's diff rounds
     * toward zero), which is a timing race that fails under CI load. Measure the
     * raw gap in milliseconds and allow a generous tolerance for the execution
     * time between the two clock reads instead.
     */
    const msOut: number =
      created.expires!.getTime() - OneUptimeDate.getCurrentDate().getTime();
    const expectedMs: number =
      REGISTRATION_TOKEN_EXPIRY_IN_DAYS * 24 * 60 * 60 * 1000;

    // Never longer than configured, and no more than a minute short of it.
    expect(msOut).toBeLessThanOrEqual(expectedMs);
    expect(msOut).toBeGreaterThan(expectedMs - 60 * 1000);

    // It lasts days, not the 24 hours a plain verification link gets.
    expect(REGISTRATION_TOKEN_EXPIRY_IN_DAYS).toBeGreaterThan(1);
  });
});

describe("UserRegistrationToken.getRegistrationLink", () => {
  test("points at the register page and carries both the address and the token", async () => {
    const link: URL = await UserRegistrationToken.getRegistrationLink({
      email: INVITED_EMAIL,
      token: TOKEN,
    });

    const asString: string = link.toString();

    expect(asString).toContain("/accounts/register");
    expect(asString).toContain(encodeURIComponent(INVITED_EMAIL.toString()));
    expect(asString).toContain(TOKEN.toString());
  });

  test("generateRegistrationLink mints a token and puts that same token on the link", async () => {
    const link: URL = await UserRegistrationToken.generateRegistrationLink({
      userId: USER_ID,
      email: INVITED_EMAIL,
    });

    const created: EmailVerificationToken = createSpy.mock.calls[0]![0][
      "data"
    ] as EmailVerificationToken;

    expect(link.toString()).toContain(created.token!.toString());
  });
});

describe("UserRegistrationToken.consumeRegistrationToken", () => {
  test("accepts a live token minted for this address", async () => {
    const accepted: boolean =
      await UserRegistrationToken.consumeRegistrationToken({
        token: TOKEN,
        email: INVITED_EMAIL,
      });

    expect(accepted).toBe(true);
  });

  test("spends it, so it cannot be replayed", async () => {
    await UserRegistrationToken.consumeRegistrationToken({
      token: TOKEN,
      email: INVITED_EMAIL,
    });

    expect(deleteOneBySpy).toHaveBeenCalledTimes(1);

    const query: Record<string, any> = deleteOneBySpy.mock.calls[0]![0][
      "query"
    ] as Record<string, any>;

    expect(query["_id"].toString()).toBe(TOKEN_ROW_ID.toString());
  });

  test("refuses a token that does not exist", async () => {
    findOneBySpy.mockResolvedValue(null);

    const accepted: boolean =
      await UserRegistrationToken.consumeRegistrationToken({
        token: TOKEN,
        email: INVITED_EMAIL,
      });

    expect(accepted).toBe(false);
    expect(deleteOneBySpy).not.toHaveBeenCalled();
  });

  test("refuses a token minted for somebody else's address", async () => {
    /*
     * The cross-invitation case. Mallory has a real invitation of her own, so
     * she holds a real live token -- it just is not for Alice's address, and
     * without this check it would open Alice's unclaimed account.
     */
    const accepted: boolean =
      await UserRegistrationToken.consumeRegistrationToken({
        token: TOKEN,
        email: OTHER_EMAIL,
      });

    expect(accepted).toBe(false);
    expect(deleteOneBySpy).not.toHaveBeenCalled();
  });

  test("matches the address case-insensitively", async () => {
    /*
     * Email lowercases on construction, so an invitation sent to Alice@ and a
     * form filled in as alice@ are the same mailbox and must not be refused.
     */
    const accepted: boolean =
      await UserRegistrationToken.consumeRegistrationToken({
        token: TOKEN,
        email: new Email("ALICE@company.com"),
      });

    expect(accepted).toBe(true);
  });

  test("refuses an expired token", async () => {
    findOneBySpy.mockResolvedValue(
      tokenRow({ expires: OneUptimeDate.getSomeDaysAgo(1) }),
    );

    const accepted: boolean =
      await UserRegistrationToken.consumeRegistrationToken({
        token: TOKEN,
        email: INVITED_EMAIL,
      });

    expect(accepted).toBe(false);
    expect(deleteOneBySpy).not.toHaveBeenCalled();
  });

  test("refuses a row with no expiry rather than treating it as immortal", async () => {
    findOneBySpy.mockResolvedValue(tokenRow({ expires: undefined }));

    const accepted: boolean =
      await UserRegistrationToken.consumeRegistrationToken({
        token: TOKEN,
        email: INVITED_EMAIL,
      });

    expect(accepted).toBe(false);
    expect(deleteOneBySpy).not.toHaveBeenCalled();
  });

  test("refuses a row with no address rather than treating it as a match", async () => {
    findOneBySpy.mockResolvedValue(tokenRow({ email: undefined }));

    const accepted: boolean =
      await UserRegistrationToken.consumeRegistrationToken({
        token: TOKEN,
        email: INVITED_EMAIL,
      });

    expect(accepted).toBe(false);
    expect(deleteOneBySpy).not.toHaveBeenCalled();
  });

  test("loses the race gracefully when another request spent it first", async () => {
    /*
     * Two requests can both read a live token before either deletes it. The
     * delete is the tiebreak: whoever removes the row won, and the one that
     * removed nothing is told no.
     */
    deleteOneBySpy.mockResolvedValue(0);

    const accepted: boolean =
      await UserRegistrationToken.consumeRegistrationToken({
        token: TOKEN,
        email: INVITED_EMAIL,
      });

    expect(accepted).toBe(false);
  });

  test("looks the token up by the token itself", async () => {
    await UserRegistrationToken.consumeRegistrationToken({
      token: TOKEN,
      email: INVITED_EMAIL,
    });

    const query: Record<string, any> = findOneBySpy.mock.calls[0]![0][
      "query"
    ] as Record<string, any>;

    expect(query["token"].toString()).toBe(TOKEN.toString());
  });
});
