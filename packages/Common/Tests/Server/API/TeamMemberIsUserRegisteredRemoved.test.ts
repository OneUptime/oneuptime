import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import UserService from "../../../Server/Services/UserService";
import { mockRouter } from "./Helpers";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * POST /team-member/is-user-registered IS GONE (#9745).
 *
 * It answered any signed-in account, about any email address, whether a
 * OneUptime account uses it: it asked for no project and no permission to
 * invite, and read the whole server (UserService.findByEmail as root). On
 * OneUptime Cloud a list of addresses could be checked one by one. The
 * invite forms asked it only to decide whether to show a Name field; they
 * now offer that field for any address (Common/UI/Utils/InviteeName).
 *
 * So nothing the team member router mounts may answer that question again:
 * no route of that name, and no route that looks an address up across the
 * server for anyone but a master admin.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const TEAM_MEMBER_PATH: string =
  new TeamMember().getCrudApiPath()?.toString() || "";

const TEAM_MEMBER_API_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "Server", "API", "TeamMemberAPI.ts"),
  "utf8",
);

describe("the team member routes", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new TeamMemberAPI();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("are mounted, so this reads the real list", () => {
    const uris: Array<string> = mockRouter.routes.map(
      (route: { uri: string }): string => {
        return route.uri;
      },
    );

    expect(uris).toContain(`${TEAM_MEMBER_PATH}/invite-suggestions`);
    expect(uris).toContain(`${TEAM_MEMBER_PATH}/search-members`);
  });

  test("have no is-user-registered, by any method (the regression)", () => {
    const registered: Array<string> = mockRouter.routes
      .filter((route: { uri: string }): boolean => {
        return route.uri.toLowerCase().includes("registered");
      })
      .map((route: { method: string; uri: string }): string => {
        return `${route.method} ${route.uri}`;
      });

    expect(registered).toEqual([]);
    expect(() => {
      mockRouter.match("POST", `${TEAM_MEMBER_PATH}/is-user-registered`);
    }).toThrow();
  });

  test("never look an address up across the server", () => {
    // The removed route's read: an account by address, as root.
    expect(TEAM_MEMBER_API_SOURCE).not.toContain("UserService.findByEmail");
    expect(TEAM_MEMBER_API_SOURCE).not.toMatch(
      /import UserService from "\.\.\/Services\/UserService"/,
    );
  });

  test("building them reads no account", () => {
    const findByEmail: jest.SpyInstance = jest.spyOn(
      UserService,
      "findByEmail",
    );

    mockRouter.routes.length = 0;
    new TeamMemberAPI();

    expect(findByEmail).not.toHaveBeenCalled();
  });
});
