import "@testing-library/jest-dom";
import {
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
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The banner at the top of an incoming call policy's Overview while its
 * Answer Calls switch is off.
 *
 * It used to be one line in a card's description - "Set up, but not
 * answering calls. Turn on Answer Calls under Settings." - a trip to
 * another page for a one-press fix. Now it says what callers hear, with a
 * Start answering calls button that writes what the switch on Settings
 * writes (isEnabled), locked for exactly the people the switch is locked
 * for, saving once however fast it is pressed, and saying why a save
 * failed. A quiet status with a pause icon, like a turned-off monitor's:
 * a line someone switched off is a choice, not an outage.
 *
 * The banner, the gate, the save and the events are the real ones; only
 * the network and the signed-in user's permissions are stubbed.
 */

const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import IncomingCallAnswerCallsOffBanner from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingCallPolicy/IncomingCallAnswerCallsOffBanner";
import {
  INCOMING_CALL_ANSWER_CALLS_COLUMN,
  INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID,
  INCOMING_CALL_START_ANSWERING_BUTTON_TEST_ID,
  INCOMING_CALL_START_ANSWERING_ERROR_TEST_ID,
  IncomingCallAnswerCallsCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingCallPolicy/IncomingCallPolicySettingsCopy";
import {
  MODEL_SWITCH_SAVED_EVENT,
  ModelSwitchSaved,
} from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const POLICY_ID: string = "7b000000-0000-4000-8000-0000000000c3";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

let announced: Array<ModelSwitchSaved> = [];

const listener: (event: Event) => void = (event: Event): void => {
  announced.push((event as CustomEvent).detail as ModelSwitchSaved);
};

const onStartedAnswering: MockFunction = getJestMockFunction();

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
      ja: { translation: readLocale("ja") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  announced = [];
  window.addEventListener(MODEL_SWITCH_SAVED_EVENT, listener);

  onStartedAnswering.mockReset();
  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });
});

afterEach(async () => {
  window.removeEventListener(MODEL_SWITCH_SAVED_EVENT, listener);
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

function renderBanner(): void {
  render(
    <IncomingCallAnswerCallsOffBanner
      policyId={new ObjectID(POLICY_ID)}
      onStartedAnswering={(): void => {
        onStartedAnswering();
      }}
    />,
  );
}

function button(): HTMLElement {
  return screen.getByTestId(INCOMING_CALL_START_ANSWERING_BUTTON_TEST_ID);
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

describe("what the banner says", () => {
  test("that the policy is not answering calls, and what callers hear", () => {
    renderBanner();

    const banner: HTMLElement = screen.getByTestId(
      INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID,
    );

    expect(banner).toHaveTextContent(
      IncomingCallAnswerCallsCopy.offBannerTitle,
    );
    expect(IncomingCallAnswerCallsCopy.offBannerTitle).toBe(
      "Not answering calls",
    );
    // The same words the switch on Settings says while it is off.
    expect(banner).toHaveTextContent(
      IncomingCallAnswerCallsCopy.switchOffDescription,
    );
    expect(button()).toHaveTextContent("Start answering calls");
    // Not a trip to Settings.
    expect(banner).not.toHaveTextContent("under Settings");
  });

  test("is a quiet status, not an alarm: a line someone switched off is a choice", () => {
    renderBanner();

    const banner: HTMLElement = screen.getByTestId(
      INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID,
    );

    expect(banner).toHaveAttribute("role", "status");
    expect(banner.className).not.toMatch(/bg-red|bg-amber/);
  });
});

describe("Start answering calls", () => {
  test("writes what the Answer Calls switch writes - isEnabled on - and tells the page", async () => {
    renderBanner();

    fireEvent.click(button());
    await settle();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const call: UpdateCall = updateByIdMock.mock.calls[0]![0] as UpdateCall;

    expect(call.modelType).toBe(IncomingCallPolicy);
    expect(call.id.toString()).toBe(POLICY_ID);
    expect(call.data).toEqual({ [INCOMING_CALL_ANSWER_CALLS_COLUMN]: true });
    expect(INCOMING_CALL_ANSWER_CALLS_COLUMN).toBe("isEnabled");
    expect(onStartedAnswering).toHaveBeenCalledTimes(1);
  });

  test("announces the save, so the switch on Settings follows it", async () => {
    renderBanner();

    fireEvent.click(button());
    await settle();

    expect(announced).toEqual([
      expect.objectContaining({
        tableName: new IncomingCallPolicy().tableName,
        modelId: POLICY_ID,
        column: "isEnabled",
        value: true,
      }),
    ]);
  });

  test("saves once however fast it is pressed", async () => {
    let finish: () => void = (): void => {};
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    renderBanner();

    fireEvent.click(button());
    fireEvent.click(button());
    fireEvent.click(button());

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    await settle();

    expect(onStartedAnswering).toHaveBeenCalledTimes(1);
  });

  test("a refused save says why, keeps the banner and tells the page nothing", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to edit this policy.");
    });

    renderBanner();

    fireEvent.click(button());
    await settle();

    expect(
      screen.getByTestId(INCOMING_CALL_START_ANSWERING_ERROR_TEST_ID),
    ).toHaveTextContent("You do not have permission to edit this policy.");
    expect(
      screen.getByTestId(INCOMING_CALL_START_ANSWERING_ERROR_TEST_ID),
    ).toHaveAttribute("role", "alert");
    expect(
      screen.getByTestId(INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID),
    ).toBeInTheDocument();
    expect(onStartedAnswering).not.toHaveBeenCalled();
    expect(announced).toEqual([]);
  });

  test("is locked, saying which permission is missing, for someone who may only read the policy", async () => {
    permissionsForTest = [Permission.SettingsViewer];

    renderBanner();

    expect(button()).toBeDisabled();

    fireEvent.click(button());
    await settle();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(onStartedAnswering).not.toHaveBeenCalled();
  });

  test("is left out, not locked, before the permissions arrive - the banner still says what callers hear", () => {
    permissionsForTest = [];

    renderBanner();

    expect(
      screen.queryByTestId(INCOMING_CALL_START_ANSWERING_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID),
    ).toHaveTextContent(IncomingCallAnswerCallsCopy.switchOffDescription);
  });
});

describe("in the reader's language", () => {
  test("German says Nimmt keine Anrufe an, with Anrufe wieder annehmen", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    renderBanner();

    const banner: HTMLElement = screen.getByTestId(
      INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID,
    );

    expect(banner).toHaveTextContent("Nimmt keine Anrufe an");
    expect(button()).toHaveTextContent("Anrufe wieder annehmen");
    expect(banner).toHaveTextContent(
      "Anrufer hören, dass die Leitung nicht verfügbar ist, und niemand wird angerufen.",
    );
    expect(banner).not.toHaveTextContent("Not answering calls");
  });

  test("Japanese says it in Japanese", async () => {
    await act(async () => {
      await i18next.changeLanguage("ja");
    });

    renderBanner();

    expect(
      screen.getByTestId(INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID),
    ).toHaveTextContent("通話に応答していません");
    expect(button()).toHaveTextContent("通話への応答を再開");
  });
});
