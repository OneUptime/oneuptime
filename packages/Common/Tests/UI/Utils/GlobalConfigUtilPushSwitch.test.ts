import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "../../../UI/Utils/GlobalConfig";
import API from "../../../Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE SERVER'S PUBLIC SETTINGS, AS A DASHBOARD READS THEM.
 *
 * GlobalConfigUtil.fetchVars reads GET /global-config/vars once per page
 * load, for every screen that asks: whether people may create projects, and
 * whether push notifications are turned off for the whole server
 * (disablePushNotifications) - which the Dashboard uses to show its notice
 * in place of the push devices and to offer none in a rule.
 *
 * An answer the server refused reads as both off - push on, project creation
 * allowed - as every server was before either switch, and is kept like any
 * answer. A request that never got an answer is not kept: the next screen to
 * ask, asks again.
 */

let get: jest.SpyInstance;

function answer(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

beforeEach(() => {
  GlobalConfigUtil.clearCache();

  get = jest
    .spyOn(API, "get")
    .mockResolvedValue(answer({ disablePushNotifications: false }) as never);
});

afterEach(() => {
  GlobalConfigUtil.clearCache();
  jest.restoreAllMocks();
});

describe("what it reads", () => {
  test("GET /global-config/vars, once", async () => {
    await GlobalConfigUtil.fetchVars();

    expect(get).toHaveBeenCalledTimes(1);

    const url: URL = (get.mock.calls[0]![0] as { url: URL }).url;

    expect(url.toString()).toMatch(/\/global-config\/vars$/);
  });

  test.each([
    [{ disablePushNotifications: true }, true],
    [{ disablePushNotifications: false }, false],
    [{}, false],
    [{ disablePushNotifications: null }, false],
  ])(
    "an answer of %j reads push as turned off: %p",
    async (data: JSONObject, expected: boolean) => {
      get.mockResolvedValue(answer(data) as never);

      const vars: GlobalConfigVars = await GlobalConfigUtil.fetchVars();

      expect(vars.disablePushNotifications).toBe(expected);
    },
  );

  test("each switch is read from its own field", async () => {
    get.mockResolvedValue(
      answer({
        disablePushNotifications: true,
        disableUserProjectCreation: false,
      }) as never,
    );

    await expect(GlobalConfigUtil.fetchVars()).resolves.toEqual({
      disableUserProjectCreation: false,
      disablePushNotifications: true,
    });

    GlobalConfigUtil.clearCache();
    get.mockResolvedValue(
      answer({
        disablePushNotifications: false,
        disableUserProjectCreation: true,
      }) as never,
    );

    await expect(GlobalConfigUtil.fetchVars()).resolves.toEqual({
      disableUserProjectCreation: true,
      disablePushNotifications: false,
    });
  });

  test("the answer holds booleans, and only the two switches", async () => {
    get.mockResolvedValue(
      answer({
        disablePushNotifications: 1,
        disableUserProjectCreation: 0,
        somethingElse: "not read",
      } as unknown as JSONObject) as never,
    );

    const vars: GlobalConfigVars = await GlobalConfigUtil.fetchVars();

    expect(vars).toStrictEqual({
      disableUserProjectCreation: false,
      disablePushNotifications: true,
    });
  });
});

describe("an answer the server refused", () => {
  test("reads as push on and project creation allowed, as before either switch", async () => {
    get.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "Server Error" }, {}) as never,
    );

    await expect(GlobalConfigUtil.fetchVars()).resolves.toEqual({
      disableUserProjectCreation: false,
      disablePushNotifications: false,
    });
  });

  test("is kept, like any answer", async () => {
    get.mockResolvedValue(
      new HTTPErrorResponse(503, { message: "Unavailable" }, {}) as never,
    );

    await GlobalConfigUtil.fetchVars();
    await GlobalConfigUtil.fetchVars();

    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("a request that never got an answer", () => {
  test("fails the screen that asked", async () => {
    get.mockRejectedValue(new Error("Network Error"));

    await expect(GlobalConfigUtil.fetchVars()).rejects.toThrow("Network Error");
  });

  test("is not kept: the next screen to ask, asks again, and hears the answer", async () => {
    get.mockRejectedValueOnce(new Error("Network Error"));
    get.mockResolvedValueOnce(
      answer({ disablePushNotifications: true }) as never,
    );

    await expect(GlobalConfigUtil.fetchVars()).rejects.toThrow("Network Error");
    await expect(GlobalConfigUtil.fetchVars()).resolves.toEqual({
      disableUserProjectCreation: false,
      disablePushNotifications: true,
    });
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("once per page load", () => {
  test("a second screen is answered without a request", async () => {
    get.mockResolvedValue(answer({ disablePushNotifications: true }) as never);

    const first: GlobalConfigVars = await GlobalConfigUtil.fetchVars();
    const second: GlobalConfigVars = await GlobalConfigUtil.fetchVars();

    expect(second).toEqual(first);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("screens that ask at once share one request", async () => {
    get.mockResolvedValue(answer({ disablePushNotifications: true }) as never);

    const answers: Array<GlobalConfigVars> = await Promise.all([
      GlobalConfigUtil.fetchVars(),
      GlobalConfigUtil.fetchVars(),
      GlobalConfigUtil.fetchVars(),
    ]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(
      answers.map((vars: GlobalConfigVars): boolean => {
        return vars.disablePushNotifications;
      }),
    ).toEqual([true, true, true]);
  });

  test("clearCache reads again: an admin who just turned push off sees it", async () => {
    get.mockResolvedValue(answer({ disablePushNotifications: false }) as never);
    await GlobalConfigUtil.fetchVars();

    get.mockResolvedValue(answer({ disablePushNotifications: true }) as never);
    GlobalConfigUtil.clearCache();

    await expect(GlobalConfigUtil.fetchVars()).resolves.toEqual({
      disableUserProjectCreation: false,
      disablePushNotifications: true,
    });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
