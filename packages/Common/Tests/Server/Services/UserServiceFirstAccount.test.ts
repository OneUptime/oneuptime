import UserService from "../../../Server/Services/UserService";
import ProjectService from "../../../Server/Services/ProjectService";
import logger from "../../../Server/Utils/Logger";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * UserService.isAwaitingFirstAccount: whether a server has no account to sign
 * in to yet - no user and no project, the state in which the next signup
 * becomes its admin. A self-hosted server's sign-in page sends people to
 * register then (#5229's follow-ups), and the register page says so.
 *
 * It decides nothing, so it reads as root, takes no lock and logs nothing
 * (it is asked on page loads); the counts are stubbed.
 */

type CountBy = typeof UserService.countBy;

const stubCounts: (
  users: number,
  projects: number,
) => {
  userCount: jest.SpiedFunction<CountBy>;
  projectCount: jest.SpiedFunction<typeof ProjectService.countBy>;
} = (
  users: number,
  projects: number,
): {
  userCount: jest.SpiedFunction<CountBy>;
  projectCount: jest.SpiedFunction<typeof ProjectService.countBy>;
} => {
  return {
    userCount: jest
      .spyOn(UserService, "countBy")
      .mockResolvedValue(new PositiveNumber(users)),
    projectCount: jest
      .spyOn(ProjectService, "countBy")
      .mockResolvedValue(new PositiveNumber(projects)),
  };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserService.isAwaitingFirstAccount", () => {
  test("a server with no user and no project is waiting for its first account", async () => {
    const { userCount, projectCount } = stubCounts(0, 0);

    await expect(UserService.isAwaitingFirstAccount()).resolves.toBe(true);
    // Every user and every project, whoever asks: the question is the server's.
    expect(userCount).toHaveBeenCalledWith({
      props: { isRoot: true },
      query: {},
    });
    expect(projectCount).toHaveBeenCalledWith({
      props: { isRoot: true },
      query: {},
    });
  });

  test("a server with an account is not, and the projects are not even counted", async () => {
    const { projectCount } = stubCounts(3, 0);

    await expect(UserService.isAwaitingFirstAccount()).resolves.toBe(false);
    expect(projectCount).not.toHaveBeenCalled();
  });

  /*
   * No user but projects: the users were taken out of the database by hand.
   * The election refuses Master Admin to the next signup there, so the
   * sign-in page must not tell anyone their account will run the server.
   */
  test("no user but projects is not waiting, and says nothing in the log", async () => {
    stubCounts(0, 2);

    await expect(UserService.isAwaitingFirstAccount()).resolves.toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("a count that fails is an error, never a yes", async () => {
    jest
      .spyOn(UserService, "countBy")
      .mockRejectedValue(new Error("database down"));

    await expect(UserService.isAwaitingFirstAccount()).rejects.toThrow(
      "database down",
    );
  });
});
