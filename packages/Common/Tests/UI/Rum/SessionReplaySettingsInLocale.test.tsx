import "@testing-library/jest-dom";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import SessionReplayCaptureTrigger from "../../../Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "../../../Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import { createTranslator, Translator } from "../../../Types/Translator";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Replay Policy page's read view in the reader's language (issue
 * #6369). Its field titles were looked up by the card, but several values
 * were drawn as written: the empty lists' sentences ("None beyond the
 * masking mode"), a performance budget's "Off" and "4000 ms", the
 * same-origin switch's two sentences, the retention ("30 days") and the
 * monthly budget ("2 GB"). Each is looked up now.
 *
 * The lookups here are marked, ⟦like this⟧, so a value drawn without one
 * shows up unmarked.
 */

type TranslatorModule = typeof import("../../../Types/Translator");

const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (): Promise<{ data: Array<unknown>; count: number }> => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

// Every lookup a component makes comes back marked, in German.
jest.mock("../../../UI/Utils/Translation", () => {
  const translatorModule: TranslatorModule =
    jest.requireActual("../../../Types/Translator") as TranslatorModule;
  const translateString: (value: string | undefined) => string | undefined = (
    value: string | undefined,
  ): string | undefined => {
    return value ? `⟦${value}⟧` : value;
  };
  const translator: Translator = translatorModule.createTranslator(
    translateString,
    "de",
  );

  return {
    __esModule: true,
    default: () => {
      return {
        translateString: translateString,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? translateString(value) : value;
        },
        translateTemplate: translator.translateTemplate,
        translatePlural: translator.translatePlural,
        translateTerm: translator.translateTerm,
        hasTranslation: translator.hasTranslation,
        formatNumber: translator.formatNumber,
        language: translator.language,
      };
    },
  };
});

import RumApplicationSessionReplaySettings, {
  describeSameOriginTracePropagation,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplaySettings";
import { clearSessionReplayHealthStore } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

/* The page fetches; give the waits room on a loaded CI box. */
const WAIT_TIMEOUT: number = 20000;

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay-settings`;

// A reader whose every lookup is marked: what was looked up shows.
const MARKING: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

function wireStatus(): JSONObject {
  const recent: string = new Date(Date.now() - 60 * 1000).toISOString();

  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: [],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: recent,
    budgetExceededAt: null,
    projectBytesUsedToday: 0,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskAllText",
    retentionInDays: 30,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: recent,
    lastSessionStartedAt: recent,
    sessionsLast24h: 4,
    playableSessionsLast24h: 4,
    refusalsLast24h: [],
  };
}

/* A NEW row per call, the way the real API deserialises one. */
function makeApplication(): RumApplication {
  const application: RumApplication = new RumApplication();

  application.id = new ObjectID(APP_ID);
  application.isSessionReplayEnabled = true;
  application.sessionReplayCaptureTrigger = SessionReplayCaptureTrigger.Always;
  application.sessionReplaySamplePercentage = 100;
  application.sessionReplayMaskingMode = SessionReplayMaskingMode.MaskAllText;
  application.sessionReplayConsentMode = SessionReplayConsentMode.NotRequired;
  application.sessionReplayIgnoreErrorPatterns = [];
  application.sessionReplayMaskSelectors = [];
  application.sessionReplayBlockSelectors = [];
  application.sessionReplayCaptureUserIdentity = true;
  application.sessionReplayCaptureGeo = true;
  application.sessionReplayRecordCanvas = false;
  application.sessionReplayLcpBudgetMs = 4000;
  application.sessionReplayLongTaskBudgetMs = 0;
  application.sessionReplaySlowRequestBudgetMs = 0;
  application.sessionReplaySameOriginTracePropagation = false;
  application.sessionReplayTracePropagationOrigins = [];
  application.sessionReplayRetentionInDays = 30;
  application.sessionReplayMonthlyBudgetInGB = 2;

  return application;
}

function getPolicyCard(): HTMLElement {
  return document.getElementById("replay-policy") as HTMLElement;
}

beforeEach(() => {
  postMock.mockReset();
  getItemMock.mockReset();
  clearSessionReplayHealthStore();
  window.history.replaceState({}, "", PAGE_PATH);

  postMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(new HTTPResponse<JSONObject>(200, wireStatus(), {}));
  });
  getItemMock.mockImplementation((): Promise<RumApplication> => {
    return Promise.resolve(makeApplication());
  });
});

afterEach(() => {
  cleanup();
  clearSessionReplayHealthStore();
});

describe("describeSameOriginTracePropagation", () => {
  it("says the switch's state in the reader's language, English without a translator", () => {
    expect(describeSameOriginTracePropagation(false, MARKING)).toBe(
      "⟦Off: nothing is added to requests to your own origin⟧",
    );
    expect(describeSameOriginTracePropagation(undefined, MARKING)).toBe(
      "⟦On: requests to your own origin carry a traceparent and this session's id⟧",
    );
    expect(describeSameOriginTracePropagation(true)).toBe(
      "On: requests to your own origin carry a traceparent and this session's id",
    );
  });
});

describe("the Replay Policy page's read view in the reader's language", () => {
  it(
    "draws every value it words itself looked up",
    async () => {
      render(
        <MemoryRouter>
          <RumApplicationSessionReplaySettings
            pageRoute={new Route(PAGE_PATH)}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );

      await waitFor(
        () => {
          expect(
            within(getPolicyCard()).getByText("⟦30 days⟧"),
          ).toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );

      const card: HTMLElement = getPolicyCard();

      for (const value of [
        // The trigger and the consent mode, as Edit Policy's choices name them.
        "⟦Always⟧",
        "⟦Not required⟧",
        "⟦None: every uncaught error can trigger an upload⟧",
        "⟦None beyond the masking mode⟧",
        "⟦None: every element is recorded (subject to masking)⟧",
        "⟦4000 ms⟧",
        "⟦Off: nothing is added to requests to your own origin⟧",
        "⟦None: no cross-origin request gets a traceparent⟧",
        "⟦2 GB⟧",
      ]) {
        expect({
          value: value,
          drawn: within(card).queryAllByText(value).length > 0,
        }).toEqual({ value: value, drawn: true });
      }

      // The two budgets that are off.
      expect(within(card).getAllByText("⟦Off⟧")).toHaveLength(2);
      expect(screen.getByTestId("privacy-summary-retention")).toHaveTextContent(
        "⟦Recorded footage is deleted after 30 days",
      );
    },
    WAIT_TIMEOUT * 2,
  );
});
