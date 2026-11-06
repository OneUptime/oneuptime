import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpiedFunction } from "jest-mock";
import User from "../../../../Models/DatabaseModels/User";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import UserLanguage from "../../../../Server/Utils/Notification/UserLanguage";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE LANGUAGE A PAGE TO A PERSON IS WRITTEN IN (fu-i18n-larger): the one
 * they picked, read as OneUptime, or English - also when it cannot be
 * read, so a page is never held back for its language.
 */

const USER_ID: ObjectID = new ObjectID("4a7f0b52-0b4c-4f4e-9a5d-3a9c0a0e1f01");

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

describe("UserLanguage.getLanguage", () => {
  test("reads the person's own language, as OneUptime, and nothing else", async () => {
    const read: SpiedFunction<typeof UserService.findOneById> = jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(userWith("de"));

    expect(await UserLanguage.getLanguage(USER_ID)).toBe("de");
    expect(read).toHaveBeenCalledTimes(1);

    const options: Parameters<typeof UserService.findOneById>[0] =
      read.mock.calls[0]![0];

    expect(options.id.toString()).toBe(USER_ID.toString());
    expect(options.select).toEqual({ language: true });
    expect(options.props).toEqual({ isRoot: true });
  });

  test("a regional tag stored by hand reads as its language", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(userWith("pt-BR"));

    expect(await UserLanguage.getLanguage(USER_ID)).toBe("pt");
  });

  test("a person who picked none is written to in English", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(userWith(undefined));

    expect(await UserLanguage.getLanguage(USER_ID)).toBe("en");
  });

  test("a person who is gone is written to in English", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null);

    expect(await UserLanguage.getLanguage(USER_ID)).toBe("en");
  });

  test("a language OneUptime does not write in reads as English", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(userWith("xx"));

    expect(await UserLanguage.getLanguage(USER_ID)).toBe("en");
  });

  test("a read that fails is English, logged, and never thrown", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockRejectedValue(new Error("Database not connected"));
    const logged: SpiedFunction<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    await expect(UserLanguage.getLanguage(USER_ID)).resolves.toBe("en");
    expect(logged).toHaveBeenCalledTimes(1);
  });

  test("no person: English, without a read", async () => {
    const read: SpiedFunction<typeof UserService.findOneById> = jest.spyOn(
      UserService,
      "findOneById",
    );

    expect(await UserLanguage.getLanguage(undefined)).toBe("en");
    expect(await UserLanguage.getLanguage(null)).toBe("en");
    expect(read).not.toHaveBeenCalled();
  });
});
