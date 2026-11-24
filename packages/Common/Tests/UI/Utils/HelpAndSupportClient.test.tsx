import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHERE THIS SERVER SENDS ITS PEOPLE FOR HELP, IN THE BROWSER (#10864-#10866):
 * Common/UI/Utils/HelpAndSupport.
 *
 *   - What env.js carried is read before anything draws: every place's
 *     choice, the support address and the help page. Nothing else, and
 *     nothing unsafe, is ever read from it.
 *   - The links env.js holds back - the chat link, the mobile app's page -
 *     are read from the server once a signed-in Dashboard starts, and every
 *     component drawn with them is drawn again when they arrive. Until then,
 *     and when they cannot be read, a place that uses one shows nothing.
 *   - The settings are the same object until either changes, as a React
 *     store's snapshot must be.
 */

const getMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return getMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "11111111-1111-4111-8111-111111111111" };
      },
    },
  };
});

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import * as Config from "../../../UI/Config";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  ChatKind,
  HELP_AND_SUPPORT_LINKS_ROUTE,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  MobileAppOfferKind,
  getChatLink,
  getDefaultHelpAndSupportSettings,
  getHelpPageLink,
  getMobileAppOffer,
  getSupportEmailAddress,
  toHelpAndSupportJSON,
  HELP_AND_SUPPORT_LINKS_ITEMS,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import HelpAndSupport, {
  useHelpAndSupport,
} from "../../../UI/Utils/HelpAndSupport";
import {
  forgetHelpAndSupport,
  helpAndSupportWith,
  setHelpAndSupportEnvironment,
} from "../../Helpers/HelpAndSupportEnvironment";

const ok: (data: JSONObject) => HTTPResponse<JSONObject> = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

// A server whose admins set everything env.js and the links route carry.
const OWN_TEAM: HelpAndSupportSettings = helpAndSupportWith({
  [HelpItem.SupportEmail]: {
    choice: HelpChoice.Email,
    value: "it-help@example.com",
  },
  [HelpItem.Chat]: {
    choice: HelpChoice.Link,
    value: "https://teams.microsoft.com/l/channel/19%3aabc/Help",
  },
  [HelpItem.HelpLink]: {
    choice: HelpChoice.Link,
    value: "https://help.example.com/oneuptime",
  },
  [HelpItem.RequestDemo]: { choice: HelpChoice.Hidden, value: null },
  [HelpItem.MobileApp]: {
    choice: HelpChoice.Link,
    value: "https://apps.example.com/oneuptime",
  },
  [HelpItem.GitHub]: { choice: HelpChoice.Hidden, value: null },
});

beforeEach(() => {
  forgetHelpAndSupport();
});

afterEach(() => {
  cleanup();
  getMock.mockReset();
  forgetHelpAndSupport();
});

describe("what env.js carried", () => {
  test("with no key, as on OneUptime Cloud and every server that never changed the page: every default", () => {
    expect(HelpAndSupport.getSettings()).toEqual(
      getDefaultHelpAndSupportSettings(),
    );
    expect(HelpAndSupport.isLoaded()).toBe(false);
  });

  test("the support address and help page are known before anything draws", () => {
    setHelpAndSupportEnvironment(OWN_TEAM);

    const settings: HelpAndSupportSettings = HelpAndSupport.getSettings();

    expect(getSupportEmailAddress(settings)).toBe("it-help@example.com");
    expect(getHelpPageLink(settings)).toEqual({
      url: "https://help.example.com/oneuptime",
      isOneUptime: false,
    });
    expect(settings[HelpItem.RequestDemo].choice).toBe(HelpChoice.Hidden);
    expect(settings[HelpItem.GitHub].choice).toBe(HelpChoice.Hidden);
  });

  test("a chat link and the mobile app's page are known to be the server's own, and shown only once read", () => {
    setHelpAndSupportEnvironment(OWN_TEAM);

    const settings: HelpAndSupportSettings = HelpAndSupport.getSettings();

    expect(settings[HelpItem.Chat]).toEqual({
      choice: HelpChoice.Link,
      value: null,
    });
    // Not OneUptime's Slack for a moment: nothing, until the server says.
    expect(getChatLink(settings)).toBeNull();
    expect(getMobileAppOffer(settings)).toEqual({
      kind: MobileAppOfferKind.OwnPage,
      url: null,
    });
  });

  test.each([
    ["a broken value", "{not json"],
    ["an empty value", ""],
    ["a list", "[]"],
    [
      "a link no page would show",
      JSON.stringify({
        helpLink: { choice: "link", value: "javascript:alert(1)" },
        supportEmail: { choice: "email", value: "<b>@example.com" },
      }),
    ],
    [
      "a choice the item does not have",
      JSON.stringify({ requestDemo: { choice: "link", value: "https://x.y" } }),
    ],
  ])("%s reads as every default", (_name: string, raw: string) => {
    setHelpAndSupportEnvironment(raw);

    expect(HelpAndSupport.getSettings()).toEqual(
      getDefaultHelpAndSupportSettings(),
    );
  });

  test("an environment that cannot be read at all reads every default, and never throws: the crash screen reads it while the page breaks", () => {
    const envSpy: SpyInstance<typeof Config.env> = jest
      .spyOn(Config, "env")
      .mockImplementation((): string => {
        throw new Error("env.js could not be read");
      });

    try {
      expect(HelpAndSupport.getSettings()).toEqual(
        getDefaultHelpAndSupportSettings(),
      );
    } finally {
      envSpy.mockRestore();
    }
  });

  test("is read when asked, so a page that set env.js late is read as it is now", () => {
    expect(getSupportEmailAddress(HelpAndSupport.getSettings())).toBe(
      "support@oneuptime.com",
    );

    setHelpAndSupportEnvironment(
      helpAndSupportWith({
        [HelpItem.SupportEmail]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    expect(getSupportEmailAddress(HelpAndSupport.getSettings())).toBeNull();
  });
});

describe("the same settings until something changes", () => {
  test("asked twice, the same object: React draws nothing again", () => {
    setHelpAndSupportEnvironment(OWN_TEAM);

    expect(HelpAndSupport.getSettings()).toBe(HelpAndSupport.getSettings());
  });

  test("a new object once env.js or the server's links change", () => {
    const first: HelpAndSupportSettings = HelpAndSupport.getSettings();

    setHelpAndSupportEnvironment(OWN_TEAM);
    const second: HelpAndSupportSettings = HelpAndSupport.getSettings();

    HelpAndSupport.setLoaded(OWN_TEAM);
    const third: HelpAndSupportSettings = HelpAndSupport.getSettings();

    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect(HelpAndSupport.getSettings()).toBe(third);
  });
});

describe("the links read from the server", () => {
  test("take the place of env.js's for the items the links route carries", () => {
    setHelpAndSupportEnvironment(OWN_TEAM);
    HelpAndSupport.setLoaded(OWN_TEAM);

    const settings: HelpAndSupportSettings = HelpAndSupport.getSettings();

    expect(getChatLink(settings)).toEqual({
      url: "https://teams.microsoft.com/l/channel/19%3aabc/Help",
      kind: ChatKind.MicrosoftTeams,
      isOneUptime: false,
    });
    expect(getMobileAppOffer(settings)).toEqual({
      kind: MobileAppOfferKind.OwnPage,
      url: "https://apps.example.com/oneuptime",
    });
    expect(HelpAndSupport.isLoaded()).toBe(true);
  });

  test("never change what env.js does not carry: the sign-in message and Give feedback stay on their defaults", () => {
    HelpAndSupport.setLoaded(
      helpAndSupportWith({
        [HelpItem.InviteMessage]: {
          choice: HelpChoice.Text,
          value: "Ask IT.",
        },
        [HelpItem.GiveFeedback]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    const settings: HelpAndSupportSettings = HelpAndSupport.getSettings();

    expect(settings[HelpItem.InviteMessage].choice).toBe(HelpChoice.Default);
    expect(settings[HelpItem.GiveFeedback].choice).toBe(HelpChoice.Default);
  });

  test("tell every listener when they arrive, and stop telling one that left", () => {
    const listener: MockFunction = getJestMockFunction();
    const stop: () => void = HelpAndSupport.subscribe(listener);

    HelpAndSupport.setLoaded(OWN_TEAM);
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    HelpAndSupport.setLoaded(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("load(): reading the links once a signed-in Dashboard starts", () => {
  test("asks the links route, signed in, and keeps what it answers", async () => {
    setHelpAndSupportEnvironment(OWN_TEAM);
    getMock.mockResolvedValue(
      ok(toHelpAndSupportJSON(OWN_TEAM, HELP_AND_SUPPORT_LINKS_ITEMS)),
    );

    await HelpAndSupport.load();

    const request: { url: { toString: () => string }; headers: JSONObject } =
      getMock.mock.calls[0]![0] as {
        url: { toString: () => string };
        headers: JSONObject;
      };

    expect(new URL(request.url.toString()).pathname).toMatch(
      /\/global-config\/help-and-support\/links$/,
    );
    expect(HELP_AND_SUPPORT_LINKS_ROUTE).toBe(
      "/global-config/help-and-support/links",
    );
    expect(request.headers).toEqual({
      tenantid: "11111111-1111-4111-8111-111111111111",
    });
    expect(getChatLink(HelpAndSupport.getSettings())?.url).toBe(
      "https://teams.microsoft.com/l/channel/19%3aabc/Help",
    );
  });

  test("keeps nothing unsafe a server could answer: an unsafe link reads as the default", async () => {
    getMock.mockResolvedValue(
      ok({
        chat: { choice: "link", value: "javascript:alert(document.cookie)" },
        mobileApp: { choice: "link", value: "data:text/html,<script>" },
      }),
    );

    await HelpAndSupport.load();

    const settings: HelpAndSupportSettings = HelpAndSupport.getSettings();

    expect(settings[HelpItem.Chat]).toEqual({
      choice: HelpChoice.Default,
      value: null,
    });
    expect(settings[HelpItem.MobileApp]).toEqual({
      choice: HelpChoice.Default,
      value: null,
    });
  });

  test.each([
    [
      "an error answer",
      async () => {
        return new HTTPErrorResponse(500, { message: "down" }, {});
      },
    ],
    [
      "a failed request",
      async () => {
        throw new Error("offline");
      },
    ],
  ])(
    "%s changes nothing: a link not read is never shown",
    async (_name: string, answer: () => Promise<unknown>) => {
      setHelpAndSupportEnvironment(OWN_TEAM);
      getMock.mockImplementation(answer);

      await expect(HelpAndSupport.load()).resolves.toBeUndefined();

      expect(HelpAndSupport.isLoaded()).toBe(false);
      expect(getChatLink(HelpAndSupport.getSettings())).toBeNull();
    },
  );
});

describe("useHelpAndSupport", () => {
  const ChatEntry: () => ReactElement = (): ReactElement => {
    const url: string | undefined = getChatLink(useHelpAndSupport())?.url;

    return <span data-testid="chat">{url || "nothing"}</span>;
  };

  test("draws a component again when the server's links arrive", async () => {
    setHelpAndSupportEnvironment(OWN_TEAM);
    render(<ChatEntry />);

    expect(screen.getByTestId("chat")).toHaveTextContent("nothing");

    await act(async () => {
      HelpAndSupport.setLoaded(OWN_TEAM);
    });

    expect(screen.getByTestId("chat")).toHaveTextContent(
      "https://teams.microsoft.com/l/channel/19%3aabc/Help",
    );
  });

  test("on the defaults, OneUptime's community Slack from the first draw", () => {
    render(<ChatEntry />);

    expect(screen.getByTestId("chat").textContent).toMatch(
      /^https:\/\/join\.slack\.com\//,
    );
  });
});
