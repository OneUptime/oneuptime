import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * TURN MONITORING ON, FAILED, IN THE READER'S LANGUAGE (#7537).
 *
 * The "Monitoring is turned off" banner on a monitor's pages offers Turn
 * monitoring on; when it fails, the line under it was the hook's error as
 * it came - for a gateway's 502, "Error connecting to server. Please try
 * again in few minutes." in English on a German or a Persian page, and a
 * server failure's reference with no copy button. It is drawn with
 * ErrorInSentence now: read here from the Dashboard's locale files, no
 * English is left but the product's name, and a message the server wrote
 * reads as it did.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/PermissionGate", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/PermissionGate",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...(actual["default"] as Record<string, unknown>),
      checkColumnUpdate: (): { isAllowed: boolean } => {
        return { isAllowed: true };
      },
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return true;
    },
  });

  return mockedConfig;
});

import DisabledWarning from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning";
import MonitoringSwitchCopy, {
  TURN_MONITORING_ON_ERROR_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringSwitchCopy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import APIException from "../../../Types/Exception/ApiException";
import {
  getExplanationWords,
  getUnexplainedServerErrorMessage,
  readUnexplainedError,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
} from "../../../Types/Exception/UnexplainedError";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { joinSentences } from "../../../UI/Utils/SentenceSeparator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const MONITOR: string = "11111111-1111-4111-8111-111111111111";
const LANGUAGES: Array<string> = ["de", "fa"];

function said(language: string, text: string): string {
  return language === "en" ? text : readDashboardLocale(language)[text] || text;
}

// ErrorInSentence's words for `message`, to a Cloud reader, in `language`.
function wordsIn(language: string, message: string): string {
  const words: { why: string; next: string } = getExplanationWords({
    error: readUnexplainedError(message)!,
    isCloud: true,
    isMasterAdmin: false,
    isVisitor: false,
  });

  return joinSentences([said(language, words.why), said(language, words.next)]);
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// The banner in `language`, Turn monitoring on pressed and failing with `rejection`.
async function turnOnFailsWith(
  language: string,
  rejection: unknown,
): Promise<HTMLElement> {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = MonitorType.API;
  monitor.disableActiveMonitoring = true;
  getItemMock.mockResolvedValue(monitor as never);
  updateByIdMock.mockRejectedValue(rejection as never);

  await inLanguage(language);
  render(<DisabledWarning monitorId={new ObjectID(MONITOR)} />);
  await flush();

  fireEvent.click(
    screen.getByRole("button", {
      name: said(language, MonitoringSwitchCopy.turnOnButton),
    }),
  );
  await flush();

  return screen.getByTestId(TURN_MONITORING_ON_ERROR_TEST_ID);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  getItemMock.mockReset();
  updateByIdMock.mockReset();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("Turn monitoring on, failed", () => {
  test.each([
    [
      "a gateway's 502",
      new HTTPErrorResponse(502, "<html>Bad Gateway</html>" as never, {}),
      SERVER_DOWN_MESSAGE,
    ],
    [
      "a load balancer's 503 page",
      new HTTPErrorResponse(
        503,
        "<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>" as never,
        {},
      ),
      SERVER_DOWN_MESSAGE,
    ],
    [
      "an empty answer",
      new HTTPErrorResponse(500, "" as never, {}),
      UNEXPLAINED_ERROR_MESSAGES.server,
    ],
    [
      "OneUptime not reached",
      new APIException(
        "Request failed to https://oneuptime.example.com/api/monitor. Network Error",
      ),
      UNEXPLAINED_ERROR_MESSAGES.unreachable,
    ],
  ])(
    "%s: in German and in Persian, with no English left",
    async (_failure: string, rejection: unknown, message: string) => {
      for (const language of LANGUAGES) {
        const error: HTMLElement = await turnOnFailsWith(language, rejection);
        const words: string = wordsIn(language, message);

        expect(words).not.toBe(wordsIn("en", message));
        expect(within(error).getByTestId("error-in-sentence").textContent).toBe(
          words,
        );
        expect(error.textContent).not.toContain(message);
        expect(error.textContent).not.toContain("<");

        if (language === "fa") {
          expect(
            (error.textContent || "").replace(/OneUptime/g, ""),
          ).not.toMatch(/[A-Za-z]/);
        }

        cleanup();
      }
    },
  );

  test("a server failure's reference is code, with a Copy button, in Persian too", async () => {
    const error: HTMLElement = await turnOnFailsWith(
      "fa",
      new HTTPErrorResponse(
        500,
        {
          error: getUnexplainedServerErrorMessage("1f0c9a2b"),
          reference: "1f0c9a2b",
        },
        {},
      ),
    );
    const reference: HTMLElement = within(error).getByTestId("error-reference");

    expect(within(reference).getByText("1f0c9a2b").tagName).toBe("CODE");
    expect(within(reference).getByRole("button")).toBeInTheDocument();
    expect(
      within(error).getByTestId("error-in-sentence").textContent,
    ).toContain(wordsIn("fa", getUnexplainedServerErrorMessage("1f0c9a2b")));
  });

  test.each([
    ["English", "You do not have permission to update this Monitor."],
    ["Persian", "این مانیتور را نمی‌توان روشن کرد."],
    ["Japanese", "接続が拒否されました"],
  ])(
    "a message the server wrote in %s reads as it was written",
    async (_script: string, message: string) => {
      const error: HTMLElement = await turnOnFailsWith(
        "de",
        new HTTPErrorResponse(400, { message: message }, {}),
      );

      expect(error.textContent).toBe(message);
      expect(within(error).queryByTestId("error-in-sentence")).toBeNull();
    },
  );
});
