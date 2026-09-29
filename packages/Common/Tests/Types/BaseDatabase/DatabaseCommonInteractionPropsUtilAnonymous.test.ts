import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";

/*
 * "No credentials at all" is the one refusal the browser client can recover
 * from. The dashboard's access-token cookie expires with the 15-minute JWT
 * inside it, so an idle tab's next request arrives with no user and no key,
 * and the client refreshes the session and replays the request only when the
 * answer is a 401. isAnonymous decides who is in that bucket and
 * assertCredentialsPresent turns it into the 401; both are shared by
 * CommonAPI, the AI privacy filters and ModelPermission, so a mistake here
 * shows up as a bogus 422 (or a wrongly refreshed API key) everywhere at once.
 */

type PropsCase = [string, DatabaseCommonInteractionProps];

const anonymousCases: Array<PropsCase> = [
  ["no props at all", {}],
  ["a tenant but no user", { tenantId: ObjectID.generate() }],
  ["an explicitly Public caller", { userType: UserType.Public }],
  [
    "a Public caller with a tenant",
    { tenantId: ObjectID.generate(), userType: UserType.Public },
  ],
  /*
   * userType User without a userId cannot happen through getUserMiddleware,
   * but if it did there is still nobody to scope to.
   */
  ["userType User but no userId", { userType: UserType.User }],
];

const credentialedCases: Array<PropsCase> = [
  ["a signed-in user", { userId: ObjectID.generate() }],
  [
    "a signed-in user with userType User",
    { userId: ObjectID.generate(), userType: UserType.User },
  ],
  /*
   * A user id wins even over a Public userType: the caller named a user, so
   * this is not an expired session.
   */
  [
    "a user id with a Public userType",
    { userId: ObjectID.generate(), userType: UserType.Public },
  ],
  // A project API key: credentials, but no user.
  [
    "a project API key",
    { tenantId: ObjectID.generate(), userType: UserType.API },
  ],
  // A master API key / master-admin session with no userId on the props.
  ["a master admin userType", { userType: UserType.MasterAdmin }],
];

describe("DatabaseCommonInteractionPropsUtil.AUTHENTICATION_REQUIRED_MESSAGE", () => {
  test("is the shared login-required sentence", () => {
    expect(
      DatabaseCommonInteractionPropsUtil.AUTHENTICATION_REQUIRED_MESSAGE,
    ).toBe("Authentication required. Please log in to access this resource.");
  });
});

describe("DatabaseCommonInteractionPropsUtil.isAnonymous", () => {
  test.each(anonymousCases)(
    "is true for %s",
    (_label: string, props: DatabaseCommonInteractionProps) => {
      expect(DatabaseCommonInteractionPropsUtil.isAnonymous(props)).toBe(true);
    },
  );

  test.each(credentialedCases)(
    "is false for %s",
    (_label: string, props: DatabaseCommonInteractionProps) => {
      expect(DatabaseCommonInteractionPropsUtil.isAnonymous(props)).toBe(false);
    },
  );

  /*
   * isRoot / isMasterAdmin are NOT part of this question - callers that bypass
   * permissions check those themselves before asking. Pinned so nobody folds
   * them in and silently changes every caller's ordering.
   */
  test("does not look at isRoot or isMasterAdmin", () => {
    expect(
      DatabaseCommonInteractionPropsUtil.isAnonymous({ isRoot: true }),
    ).toBe(true);
    expect(
      DatabaseCommonInteractionPropsUtil.isAnonymous({ isMasterAdmin: true }),
    ).toBe(true);
  });
});

describe("DatabaseCommonInteractionPropsUtil.assertCredentialsPresent", () => {
  test.each(anonymousCases)(
    "throws a 401 NotAuthenticatedException for %s",
    (_label: string, props: DatabaseCommonInteractionProps) => {
      let thrown: unknown = undefined;

      try {
        DatabaseCommonInteractionPropsUtil.assertCredentialsPresent(props);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(NotAuthenticatedException);
      expect(thrown).not.toBeInstanceOf(NotAuthorizedException);
      expect((thrown as Exception).code).toBe(
        ExceptionCode.NotAuthenticatedException,
      );
      expect((thrown as Exception).code).toBe(401);
      expect((thrown as Exception).message).toBe(
        DatabaseCommonInteractionPropsUtil.AUTHENTICATION_REQUIRED_MESSAGE,
      );
    },
  );

  test.each(credentialedCases)(
    "does not throw for %s",
    (_label: string, props: DatabaseCommonInteractionProps) => {
      expect(() => {
        DatabaseCommonInteractionPropsUtil.assertCredentialsPresent(props);
      }).not.toThrow();
    },
  );

  test("does not mutate the props it is given", () => {
    const props: DatabaseCommonInteractionProps = {
      tenantId: ObjectID.generate(),
      userType: UserType.API,
    };
    const before: string = JSON.stringify(props);

    DatabaseCommonInteractionPropsUtil.assertCredentialsPresent(props);

    expect(JSON.stringify(props)).toBe(before);
  });
});
