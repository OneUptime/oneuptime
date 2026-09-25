import UserProjectSsoConsent from "../../../Models/DatabaseModels/UserProjectSsoConsent";
import UserProjectSsoConsentService from "../../../Server/Services/UserProjectSsoConsentService";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The record that an account's owner agreed, from their mailbox, that a
 * project's single sign-on may sign them in. Read on every hosted project-SSO
 * sign-in; written only by the confirmation link.
 *
 * What has to hold:
 *
 *  - consent is per (user, project): the query is scoped to both, so one
 *    project's consent can never let another project's IdP in;
 *  - recording is idempotent, because the same person can press the button
 *    twice, or confirm two emails for the same project, and the second must
 *    neither fail nor duplicate the row;
 *  - a lost race with a concurrent insert is absorbed, but a real failure is
 *    not swallowed.
 */

const USER_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

/*
 * Spy handles are held through this rather than a SpiedFunction/SpyInstance
 * type: two such declarations are in scope in this project (the global jest
 * namespace's and @jest/globals'), jest.spyOn returns the latter, and naming
 * the wrong one passes the jest run and fails only in compile-common. These
 * tests read exactly one thing off a spy, so that is all this names.
 */
interface SpyCalls {
  mock: { calls: Array<Array<unknown>> };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserProjectSsoConsentService.hasConsent", () => {
  test("asks about this user in this project, as root", async () => {
    const countBy: SpyCalls = jest
      .spyOn(UserProjectSsoConsentService, "countBy")
      .mockResolvedValue(new PositiveNumber(1)) as unknown as SpyCalls;

    await expect(
      UserProjectSsoConsentService.hasConsent({
        userId: USER_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(true);

    const call: Record<string, any> = countBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(call["query"]["userId"].toString()).toBe(USER_ID.toString());
    expect(call["query"]["projectId"].toString()).toBe(PROJECT_ID.toString());
    expect(call["props"]["isRoot"]).toBe(true);
  });

  test("is false when there is no row", async () => {
    jest
      .spyOn(UserProjectSsoConsentService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));

    await expect(
      UserProjectSsoConsentService.hasConsent({
        userId: USER_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(false);
  });
});

describe("UserProjectSsoConsentService.recordConsent", () => {
  test("writes one row for this user and project", async () => {
    jest
      .spyOn(UserProjectSsoConsentService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    const create: SpyCalls = jest
      .spyOn(UserProjectSsoConsentService, "create")
      .mockResolvedValue(new UserProjectSsoConsent()) as unknown as SpyCalls;

    await UserProjectSsoConsentService.recordConsent({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });

    expect(create.mock.calls).toHaveLength(1);

    const call: Record<string, any> = create.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(call["data"]).toBeInstanceOf(UserProjectSsoConsent);
    expect(call["data"]["userId"].toString()).toBe(USER_ID.toString());
    expect(call["data"]["projectId"].toString()).toBe(PROJECT_ID.toString());
    expect(call["props"]["isRoot"]).toBe(true);
  });

  test("writes nothing when consent is already on record", async () => {
    jest
      .spyOn(UserProjectSsoConsentService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const create: SpyCalls = jest.spyOn(
      UserProjectSsoConsentService,
      "create",
    ) as unknown as SpyCalls;

    await UserProjectSsoConsentService.recordConsent({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });

    expect(create.mock.calls).toHaveLength(0);
  });

  test("absorbs losing an insert race to a concurrent click", async () => {
    // Absent when checked, present by the time the insert was turned away.
    jest
      .spyOn(UserProjectSsoConsentService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(0))
      .mockResolvedValueOnce(new PositiveNumber(1));
    jest
      .spyOn(UserProjectSsoConsentService, "create")
      .mockRejectedValue(
        new Error("duplicate key value violates unique constraint"),
      );

    await expect(
      UserProjectSsoConsentService.recordConsent({
        userId: USER_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  test("does not swallow a write that failed for any other reason", async () => {
    jest
      .spyOn(UserProjectSsoConsentService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(UserProjectSsoConsentService, "create")
      .mockRejectedValue(new Error("connection terminated"));

    await expect(
      UserProjectSsoConsentService.recordConsent({
        userId: USER_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("connection terminated");
  });
});

describe("UserProjectSsoConsent model", () => {
  test("has no API: nobody but the server reads or writes it", () => {
    const model: UserProjectSsoConsent = new UserProjectSsoConsent();

    expect(model.createRecordPermissions).toEqual([]);
    expect(model.readRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
    expect(model.crudApiPath).toBeFalsy();
  });

  test("is one live row per user and project, enforced by the database", () => {
    /*
     * The unique index is what turns a concurrent second insert into the
     * error recordConsent absorbs, instead of a duplicate row.
     */
    const index: IndexMetadataArgs | undefined = getMetadataArgsStorage()
      .indices.filter((candidate: IndexMetadataArgs) => {
        return candidate.target === UserProjectSsoConsent;
      })
      .find((candidate: IndexMetadataArgs) => {
        return candidate.name === "IDX_UserProjectSsoConsent_userId_projectId";
      });

    expect(index).toBeDefined();
    expect(index!.unique).toBe(true);
    expect(index!.columns).toEqual(["userId", "projectId"]);
    expect(index!.where).toBe('"deletedAt" IS NULL');
  });
});
