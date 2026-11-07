import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import { Logger } from "../../../UI/Utils/Logger";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import UserUtil from "../../../UI/Utils/User";
import UserLanguageUtil from "../../../UI/Utils/UserLanguage";

/*
 * A SIGNED-IN PERSON'S LANGUAGE, AS THE DASHBOARDS SAVE AND READ IT
 * (fu-i18n-larger).
 *
 * Picked in the language menu while signed in, it is saved to their own
 * account - one of the codes OneUptime writes in - and read back on every
 * browser they sign in on. Both ways are best effort: never thrown, a
 * failure logged, the page left in the language it shows.
 */

const USER_ID: ObjectID = new ObjectID("7c1d5e20-3b4a-4f6e-8a9b-1c2d3e4f5a01");

// ModelAPI's generic methods, as jest.spyOn types a spy on them.
type UpdateById = (
  data: Parameters<typeof ModelAPI.updateById>[0],
) => ReturnType<typeof ModelAPI.updateById>;
type GetItem = (
  data: Parameters<typeof ModelAPI.getItem>[0],
) => ReturnType<typeof ModelAPI.getItem>;

const signedIn: (isLoggedIn: boolean) => void = (isLoggedIn: boolean): void => {
  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(isLoggedIn);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(USER_ID);
};

const userWith: (language: string | undefined) => User = (
  language: string | undefined,
): User => {
  const user: User = new User(USER_ID);

  if (language !== undefined) {
    user.language = language;
  }

  return user;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserLanguageUtil.saveSignedInUserLanguage", () => {
  test("saves the pick to the person's own account, as one of OneUptime's codes", async () => {
    signedIn(true);

    const update: SpyInstance<UpdateById> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(undefined as never);

    await expect(
      UserLanguageUtil.saveSignedInUserLanguage("de-AT"),
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalledTimes(1);

    const options: Parameters<typeof ModelAPI.updateById>[0] =
      update.mock.calls[0]![0];

    expect(options.modelType).toBe(User);
    expect(options.id.toString()).toBe(USER_ID.toString());
    // The language, and nothing else of the account.
    expect(options.data).toEqual({ language: "de" });
  });

  test("a visitor who is not signed in saves nothing", async () => {
    signedIn(false);

    const update: SpyInstance<UpdateById> = jest.spyOn(ModelAPI, "updateById");

    await expect(UserLanguageUtil.saveSignedInUserLanguage("fr")).resolves.toBe(
      false,
    );
    expect(update).not.toHaveBeenCalled();
  });

  test("a language OneUptime does not write in, or none, is never sent", async () => {
    signedIn(true);

    const update: SpyInstance<UpdateById> = jest.spyOn(ModelAPI, "updateById");

    for (const language of ["xx", "klingon", "", "   "]) {
      await expect(
        UserLanguageUtil.saveSignedInUserLanguage(language),
      ).resolves.toBe(false);
    }

    expect(update).not.toHaveBeenCalled();
  });

  test("a save that fails is logged, never thrown", async () => {
    signedIn(true);
    jest
      .spyOn(ModelAPI, "updateById")
      .mockRejectedValue(new Error("Network unreachable"));

    const logged: SpyInstance<typeof Logger.error> = jest
      .spyOn(Logger, "error")
      .mockImplementation((): void => {});

    await expect(UserLanguageUtil.saveSignedInUserLanguage("ja")).resolves.toBe(
      false,
    );
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]![0])).toContain(
      "Error saving your language",
    );
  });

  test("a save the server refuses is logged with what the server said", async () => {
    signedIn(true);
    jest
      .spyOn(ModelAPI, "updateById")
      .mockRejectedValue(
        new HTTPErrorResponse(
          400,
          { message: "Language must be one of: en." },
          {},
        ),
      );

    const logged: SpyInstance<typeof Logger.error> = jest
      .spyOn(Logger, "error")
      .mockImplementation((): void => {});

    await expect(UserLanguageUtil.saveSignedInUserLanguage("de")).resolves.toBe(
      false,
    );
    expect(String(logged.mock.calls[0]![0])).toContain(
      "Language must be one of: en.",
    );
  });
});

describe("UserLanguageUtil.readSignedInUserLanguage", () => {
  test("reads the language of the person's own account, and nothing else", async () => {
    signedIn(true);

    const read: SpyInstance<GetItem> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(userWith("ko") as never);

    await expect(UserLanguageUtil.readSignedInUserLanguage()).resolves.toBe(
      "ko",
    );

    const options: Parameters<typeof ModelAPI.getItem>[0] =
      read.mock.calls[0]![0];

    expect(options.modelType).toBe(User);
    expect(options.id.toString()).toBe(USER_ID.toString());
    expect(options.select).toEqual({ language: true });
  });

  test("a regional tag stored through the API reads as its language", async () => {
    signedIn(true);
    jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(userWith("zh-HK") as never);

    await expect(UserLanguageUtil.readSignedInUserLanguage()).resolves.toBe(
      "zh-TW",
    );
  });

  test("a person who picked none reads as none: the Dashboard follows the browser", async () => {
    signedIn(true);
    jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(userWith(undefined) as never);

    await expect(UserLanguageUtil.readSignedInUserLanguage()).resolves.toBe("");
  });

  test("a visitor who is not signed in reads none, without a read", async () => {
    signedIn(false);

    const read: SpyInstance<GetItem> = jest.spyOn(ModelAPI, "getItem");

    await expect(UserLanguageUtil.readSignedInUserLanguage()).resolves.toBe("");
    expect(read).not.toHaveBeenCalled();
  });

  test("a read that fails is none, logged, never thrown", async () => {
    signedIn(true);
    jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(new Error("Network unreachable"));

    const logged: SpyInstance<typeof Logger.error> = jest
      .spyOn(Logger, "error")
      .mockImplementation((): void => {});

    await expect(UserLanguageUtil.readSignedInUserLanguage()).resolves.toBe("");
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
