import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "../../../UI/Utils/GlobalConfig";
import { useServerCanSendEmail } from "../../../UI/Utils/ServerSending";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../Utils/API";

/*
 * WHETHER THE SERVER CAN SEND EMAIL, AS A PAGE READS IT (#6825).
 *
 * GET /global-config/vars' canSendEmail, read once per page load with the
 * server's other public settings. Only an answer that says false is false:
 * an older server's answer without it, one the server refused, and a read
 * that never came back all leave the page saying what it always said -
 * nothing claims the server cannot send email when it may. While the answer
 * is on its way the hook is null, and the pages draw their usual form.
 */

let get: jest.SpyInstance;

function answer(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

beforeEach(() => {
  GlobalConfigUtil.clearCache();
  get = jest.spyOn(API, "get");
});

afterEach(() => {
  cleanup();
  GlobalConfigUtil.clearCache();
  jest.restoreAllMocks();
});

describe("GlobalConfigUtil's canSendEmail", () => {
  test.each([
    [{ canSendEmail: false }, false],
    [{ canSendEmail: true }, true],
    // An older server, which does not say: it may send.
    [{}, true],
    [{ canSendEmail: null }, true],
    [{ canSendEmail: "false" }, true],
    [{ canSendEmail: 0 }, true],
  ])(
    "an answer of %j reads as can send %p",
    async (data: JSONObject, expected: boolean) => {
      get.mockResolvedValue(answer(data) as never);

      const vars: GlobalConfigVars = await GlobalConfigUtil.fetchVars();

      expect(vars.canSendEmail).toBe(expected);
    },
  );

  test("an answer the server refused reads as can send", async () => {
    get.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "Server Error" }, {}) as never,
    );

    await expect(GlobalConfigUtil.fetchVars()).resolves.toMatchObject({
      canSendEmail: true,
    });
  });

  test("read from its own field, beside the switches", () => {
    expect(
      GlobalConfigUtil.readVars({
        canSendEmail: false,
        disablePushNotifications: true,
        disableUserProjectCreation: true,
      }),
    ).toStrictEqual({
      disableUserProjectCreation: true,
      disablePushNotifications: true,
      canSendEmail: false,
    });

    expect(GlobalConfigUtil.readVars(null)).toStrictEqual({
      disableUserProjectCreation: false,
      disablePushNotifications: false,
      canSendEmail: true,
    });
  });
});

describe("useServerCanSendEmail", () => {
  const Probe: () => ReactElement = (): ReactElement => {
    const canSendEmail: boolean | null = useServerCanSendEmail();

    return (
      <p data-testid="can-send-email">
        {canSendEmail === null ? "reading" : String(canSendEmail)}
      </p>
    );
  };

  test("null while the answer is on its way, then the answer", async () => {
    let resolve: (value: unknown) => void = (): void => {
      return undefined;
    };

    get.mockReturnValue(
      new Promise((done: (value: unknown) => void) => {
        resolve = done;
      }) as never,
    );

    render(<Probe />);

    expect(screen.getByTestId("can-send-email")).toHaveTextContent("reading");

    await act(async () => {
      resolve(answer({ canSendEmail: false }));
    });

    expect(screen.getByTestId("can-send-email")).toHaveTextContent("false");
  });

  test("a read that never came back answers true: the page says what it always said", async () => {
    get.mockRejectedValue(new Error("Network Error") as never);

    await act(async () => {
      render(<Probe />);
    });

    expect(screen.getByTestId("can-send-email")).toHaveTextContent("true");
  });
});
