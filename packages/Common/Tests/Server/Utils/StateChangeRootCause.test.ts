import StateChangeRootCause from "../../../Server/Utils/StateChangeRootCause";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

// Every refusal below is deliberate.
jest.mock("../../../Server/Utils/Logger");

/*
 * THE ROOT CAUSE WRITTEN AS AN INCIDENT OR ALERT IS RESOLVED (#7765).
 *
 * The Resolve dialog's "Add the root cause" sends it with the state change
 * under writtenRootCause. It is optional: none, a blank one, or anything
 * that is not text, is none. Writing it is a permission of its own, asked
 * with the record's own update check before the change is saved, and a
 * change whose root cause its sender may not write is refused whole, with
 * a message that says how to change the state anyway. Once the change is
 * saved, writing the root cause never fails it.
 */

const RECORD_ID: ObjectID = ObjectID.generate();
const PERSON: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the root cause a state change carries", () => {
  test("travels under writtenRootCause", () => {
    expect(StateChangeRootCause.rootCauseKey).toBe("writtenRootCause");
  });

  test("is read trimmed", () => {
    expect(
      StateChangeRootCause.getRootCause({
        writtenRootCause: "\n  A batch container took the host's CPU.  \n",
      }),
    ).toBe("A batch container took the host's CPU.");
  });

  test.each([
    ["no misc data", undefined],
    ["null misc data", null],
    ["no root cause in it", { privateNote: "On it." }],
    ["an empty one", { writtenRootCause: "" }],
    ["spaces and line breaks only", { writtenRootCause: " \n\t " }],
    ["a number", { writtenRootCause: 42 }],
    ["an object", { writtenRootCause: { text: "A cause." } }],
  ])("is none with %s", (_what: string, miscDataProps: unknown) => {
    expect(
      StateChangeRootCause.getRootCause(
        miscDataProps as JSONObject | undefined | null,
      ),
    ).toBeUndefined();
  });
});

describe("whether its sender may write it", () => {
  test("asks the record's own update check, for its root cause alone", async () => {
    const check: SpyInstance<
      typeof ModelPermission.checkUpdateQueryPermissions
    > = jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockResolvedValue({} as never);

    await StateChangeRootCause.assertCallerMayWrite({
      modelType: Alert,
      recordId: RECORD_ID,
      rootCause: "A cause.",
      props: PERSON,
    });

    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(
      Alert,
      { _id: RECORD_ID.toString() },
      { rootCause: "A cause." },
      PERSON,
    );
  });

  test("OneUptime's own changes are not asked, as the record's update does not ask them", async () => {
    const check: SpyInstance<
      typeof ModelPermission.checkUpdateQueryPermissions
    > = jest.spyOn(ModelPermission, "checkUpdateQueryPermissions");

    await StateChangeRootCause.assertCallerMayWrite({
      modelType: Incident,
      recordId: RECORD_ID,
      rootCause: "A cause.",
      props: { isRoot: true },
    });

    expect(check).not.toHaveBeenCalled();
  });

  test("a refusal refuses the whole change, saying why and how to change the state anyway", async () => {
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to edit Alert. You need one of these permissions: Project Owner, Edit Alert",
        ),
      );

    await expect(
      StateChangeRootCause.assertCallerMayWrite({
        modelType: Alert,
        recordId: RECORD_ID,
        rootCause: "A cause.",
        props: PERSON,
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "The state was not changed: it comes with a root cause, which you may not write. You do not have permissions to edit Alert. You need one of these permissions: Project Owner, Edit Alert. To change the state, leave the root cause out.",
      ),
    );
  });

  test("any other error is passed on as it is", async () => {
    const error: BadDataException = new BadDataException("Alert not found.");
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockRejectedValue(error);

    await expect(
      StateChangeRootCause.assertCallerMayWrite({
        modelType: Alert,
        recordId: RECORD_ID,
        rootCause: "A cause.",
        props: PERSON,
      }),
    ).rejects.toBe(error);
  });

  test("a reason that already ends a sentence is not given a second full stop", () => {
    expect(
      StateChangeRootCause.getRefusalMessage(
        "You may not edit this incident.  ",
      ),
    ).toBe(
      "The state was not changed: it comes with a root cause, which you may not write. You may not edit this incident. To change the state, leave the root cause out.",
    );
  });
});

describe("writing it once the change is saved", () => {
  test("says it was written", async () => {
    const write: Mock<() => Promise<unknown>> = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue(undefined);

    await expect(
      StateChangeRootCause.save({ write, logAttributes: {} }),
    ).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("never fails the saved change: a write that fails says it was not written", async () => {
    await expect(
      StateChangeRootCause.save({
        write: async (): Promise<unknown> => {
          throw new Error("database is down");
        },
        logAttributes: {},
      }),
    ).resolves.toBe(false);
  });
});
