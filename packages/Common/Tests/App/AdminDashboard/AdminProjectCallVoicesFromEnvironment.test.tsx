import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * ADMIN DASHBOARD > SETTINGS > CALL AND SMS > PROJECT CALL VOICES, WHILE
 * GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE SETS THE SWITCH (#11462) - on
 * the real page, its cards and switch, in the Admin Dashboard's own words;
 * only the network, the page chrome and the side menu are stand-ins.
 *
 * An installation kept in code gives the master admin's consent with the
 * variable. While it is set, the card says so in place of its description,
 * naming the variable and where it is changed, and draws Let projects
 * choose their call voice locked where the variable puts it - on or off,
 * never the saved switch, which the server would not read - with why it is
 * locked told to a screen reader and behind its help icon. A value that is
 * neither true nor false is said above it, by the variable's name, in a
 * line of its own direction, and leaves the switch off. Unset, or from a
 * server that cannot say, the switch is the admin's to flip, as before.
 * Until the server says, no switch is drawn that may not apply; on
 * OneUptime Cloud, no card at all.
 */

jest.setTimeout(60000);

const mockGetItem: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      createOrUpdate: async (): Promise<unknown> => {
        return { data: {} };
      },
      updateById: (...args: Array<unknown>): unknown => {
        return mockUpdateById(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

interface MockPageProps {
  children?: ReactNode | undefined;
}

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return <main data-testid="admin-page">{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import CallSmsSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/Index";
import ProjectCallVoicesCard from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/ProjectCallVoicesCard";
import {
  PROJECT_CALL_VOICES_COPY,
  PROJECT_CALL_VOICES_ENVIRONMENT_TEST_ID,
  PROJECT_CALL_VOICES_LOADING_TEST_ID,
  PROJECT_CALL_VOICES_PROBLEM_TEST_ID,
  PROJECT_CALL_VOICES_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/ProjectCallVoicesCardCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import ServerTwilioEnvironment, {
  SERVER_TWILIO_CALL_VOICE_VARIABLE,
  SERVER_TWILIO_ENVIRONMENT_ROUTE,
  SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE,
  ServerTwilioEnvironmentAnswer,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";

const WAIT_FOR_TIMEOUT: number = 20000;

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

type Locale = Record<string, unknown>;

function readLocale(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
}

const ENGLISH: Locale = readLocale("en");

const VARIABLE: string = SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE;

// The server's row, as the page's cards read it, per test.
let savedRow: Record<string, unknown>;

// What GET /global-config/twilio-environment answers, per test.
let environmentAnswer: () => Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
>;

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
  select: Record<string, unknown>;
}

async function answerGetItem(options: unknown): Promise<unknown> {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();
  Object.assign(item, savedRow);

  return item;
}

// The answer the server gives for these variables, on a self-hosted server, as it sends it.
function answerFor(
  values: Record<string, string>,
): () => Promise<HTTPResponse<JSONObject>> {
  const answer: ServerTwilioEnvironmentAnswer =
    ServerTwilioEnvironment.toAnswer(
      ServerTwilioEnvironment.read(values),
      ServerTwilioEnvironment.readCallVoice(values),
      ServerTwilioEnvironment.readLetProjectsChooseCallVoice(values, {
        isBillingEnabled: false,
      }),
    );

  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      JSON.parse(JSON.stringify(answer)) as JSONObject,
      {},
    );
  };
}

function switchVariable(value: string): Record<string, string> {
  return { [VARIABLE]: value };
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderIn(
  language: string,
  element: ReactElement,
): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [language]: { translation: readLocale(language) },
    },
    interpolation: { escapeValue: false },
  });

  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);

  await settle();
}

async function renderPage(language: string = "en"): Promise<void> {
  await renderIn(language, <CallSmsSettings />);
}

// The switch, once the card past its loader draws one.
async function theSwitch(name: string = PROJECT_CALL_VOICES_COPY.switchTitle): Promise<HTMLElement> {
  await waitFor(
    () => {
      expect(screen.getByRole("switch", { name: name })).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return screen.getByRole("switch", { name: name });
}

function environmentCard(): HTMLElement {
  return screen.getByTestId(PROJECT_CALL_VOICES_ENVIRONMENT_TEST_ID);
}

beforeEach(() => {
  savedRow = { letProjectsChooseCallVoice: false };
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);
  mockUpdateById.mockReset();
  mockUpdateById.mockResolvedValue({ data: {} });

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

  environmentAnswer = answerFor({});

  getJestSpyOn(API, "fetch").mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const url: string = String((options as { url: URL }).url);

      if (url.endsWith(SERVER_TWILIO_ENVIRONMENT_ROUTE)) {
        return environmentAnswer();
      }

      // Everything else the page asks - the setup checklist - is not answered.
      return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("set to true", () => {
  test("the card says the variable sets it, and where to change it, in place of its description", async () => {
    environmentAnswer = answerFor(switchVariable("true"));

    await renderPage();
    await theSwitch();

    const card: HTMLElement = environmentCard();

    expect(
      within(card).getByText(PROJECT_CALL_VOICES_COPY.cardTitle),
    ).toBeVisible();
    expect(
      within(card).getByText(PROJECT_CALL_VOICES_COPY.environmentDescription),
    ).toBeVisible();
    expect(card).toHaveTextContent(VARIABLE);
    expect(card).toHaveTextContent("twilio.letProjectsChooseCallVoice");
    expect(card).not.toHaveTextContent(PROJECT_CALL_VOICES_COPY.cardDescription);
  });

  test("the switch is on - though the saved one is off - and locked, saying why to a screen reader", async () => {
    environmentAnswer = answerFor(switchVariable("true"));

    await renderPage();

    const toggle: HTMLElement = await theSwitch();

    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAccessibleDescription(
      expect.stringContaining(PROJECT_CALL_VOICES_COPY.environmentLockedReason),
    );
    expect(environmentCard()).toHaveTextContent(
      PROJECT_CALL_VOICES_COPY.switchOnDescription,
    );
  });

  test("pressing it changes nothing, and saves nothing: the variable is the switch", async () => {
    environmentAnswer = answerFor(switchVariable("true"));

    await renderPage();

    const toggle: HTMLElement = await theSwitch();

    fireEvent.click(toggle);
    await settle();

    expect(toggle).toBeChecked();
    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  test("the switch is never read from the saved row: no switch of the row's is drawn", async () => {
    environmentAnswer = answerFor(switchVariable("true"));

    await renderPage();
    await theSwitch();

    expect(
      screen.getAllByRole("switch", {
        name: PROJECT_CALL_VOICES_COPY.switchTitle,
      }),
    ).toHaveLength(1);
    expect(
      mockGetItem.mock.calls.filter((call: Array<unknown>): boolean => {
        return Boolean(
          (call[0] as ItemCall).select?.["letProjectsChooseCallVoice"],
        );
      }),
    ).toHaveLength(0);
  });

  test("still says what the voices cost the account", async () => {
    environmentAnswer = answerFor(switchVariable("true"));

    await renderPage();
    await theSwitch();

    expect(
      within(environmentCard()).getByTestId(
        `${PROJECT_CALL_VOICES_SWITCH_TEST_ID}-cost`,
      ),
    ).toHaveTextContent(
      "Twilio charges extra for these voices: under 3 US cents for each page's call, in any language.",
    );
    expect(
      within(environmentCard()).queryByTestId(
        PROJECT_CALL_VOICES_PROBLEM_TEST_ID,
      ),
    ).toBeNull();
  });
});

describe("set to false", () => {
  test("off - though the saved switch is on - locked, saying what off means", async () => {
    savedRow = { letProjectsChooseCallVoice: true };
    environmentAnswer = answerFor(switchVariable("FALSE"));

    await renderPage();

    const toggle: HTMLElement = await theSwitch();

    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(environmentCard()).toHaveTextContent(
      PROJECT_CALL_VOICES_COPY.switchOffDescription,
    );
    expect(environmentCard()).not.toHaveTextContent(
      PROJECT_CALL_VOICES_COPY.switchOnDescription,
    );
  });
});

describe("set to neither true nor false", () => {
  test("what is wrong is said above the switch, by the variable's name, in a line of its own direction - and the switch is off, locked", async () => {
    savedRow = { letProjectsChooseCallVoice: true };
    environmentAnswer = answerFor(switchVariable("yes"));

    await renderPage();

    const toggle: HTMLElement = await theSwitch();
    const problem: HTMLElement = within(environmentCard()).getByTestId(
      PROJECT_CALL_VOICES_PROBLEM_TEST_ID,
    );

    expect(problem).toHaveTextContent(
      PROJECT_CALL_VOICES_COPY.environmentProblemTitle,
    );
    expect(problem).toHaveTextContent(
      `${VARIABLE}: "yes" is neither true nor false`,
    );
    expect(problem.querySelector("bdi")).toHaveTextContent(
      `${VARIABLE}: "yes" is neither true nor false`,
    );
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAttribute("aria-disabled", "true");

    // Above the switch.
    expect(
      problem.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("beside the account's and the voice's variables", () => {
  test("each card shows what its own variable sets", async () => {
    environmentAnswer = answerFor({
      [ServerTwilioEnvironmentVariable.AccountSid]:
        "AC22222222222222222222222222222222",
      [ServerTwilioEnvironmentVariable.AuthToken]: "token-sentinel-11462",
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
      [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Polly.Brian-Neural",
      [VARIABLE]: "true",
    });

    await renderPage();

    const toggle: HTMLElement = await theSwitch();

    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(document.body).toHaveTextContent(SERVER_TWILIO_CALL_VOICE_VARIABLE);
    expect(document.body).not.toHaveTextContent("token-sentinel-11462");
  });
});

describe("not set by it", () => {
  test("the saved switch, the admin's to flip, as before", async () => {
    savedRow = { letProjectsChooseCallVoice: true };

    await renderPage();

    const toggle: HTMLElement = await theSwitch();

    expect(toggle).toBeChecked();
    expect(toggle).not.toHaveAttribute("aria-disabled");
    expect(
      screen.queryByTestId(PROJECT_CALL_VOICES_ENVIRONMENT_TEST_ID),
    ).toBeNull();
    expect(document.body).toHaveTextContent(
      PROJECT_CALL_VOICES_COPY.cardDescription,
    );
    expect(document.body).not.toHaveTextContent(VARIABLE);
  });

  test("the voice's variable alone leaves the switch to flip", async () => {
    environmentAnswer = answerFor({
      [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Polly.Matthew-Neural",
    });

    await renderPage();

    expect(await theSwitch()).not.toHaveAttribute("aria-disabled");
  });

  test("from a server that cannot say: the saved switch, and the server still refuses a write the variable makes", async () => {
    environmentAnswer = async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(500, { message: "Server error." }, {});
    };

    await renderPage();

    expect(await theSwitch()).not.toHaveAttribute("aria-disabled");
    expect(
      screen.queryByTestId(PROJECT_CALL_VOICES_ENVIRONMENT_TEST_ID),
    ).toBeNull();
  });

  test("from a server of the release before, which says nothing of the switch: the saved switch", async () => {
    environmentAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          isSetByEnvironment: false,
          problems: [],
          isCallVoiceSetByEnvironment: false,
          callVoice: null,
          callVoiceProblem: null,
        },
        {},
      );
    };

    await renderPage();

    expect(await theSwitch()).not.toHaveAttribute("aria-disabled");
  });
});

describe("until the server says", () => {
  test("the card's title over a loader, and no switch that may not apply", async () => {
    environmentAnswer = (): Promise<HTTPResponse<JSONObject>> => {
      return new Promise<HTTPResponse<JSONObject>>(() => {
        // Never answers.
      });
    };

    await renderPage();

    const loading: HTMLElement = screen.getByTestId(
      PROJECT_CALL_VOICES_LOADING_TEST_ID,
    );

    expect(loading).toHaveTextContent(PROJECT_CALL_VOICES_COPY.cardTitle);
    expect(
      screen.queryByRole("switch", {
        name: PROJECT_CALL_VOICES_COPY.switchTitle,
      }),
    ).toBeNull();
  });
});

describe("on OneUptime Cloud", () => {
  test("no card, whatever the variable says", async () => {
    await renderIn(
      "en",
      <ProjectCallVoicesCard
        isBillingEnabled={true}
        environment={{
          isLoading: false,
          answer: ServerTwilioEnvironment.answerFromJSON({
            isLetProjectsChooseCallVoiceSetByEnvironment: true,
            letProjectsChooseCallVoice: true,
          }),
        }}
      />,
    );

    expect(
      screen.queryByRole("switch", {
        name: PROJECT_CALL_VOICES_COPY.switchTitle,
      }),
    ).toBeNull();
    expect(document.body).not.toHaveTextContent(
      PROJECT_CALL_VOICES_COPY.cardTitle,
    );
  });
});

describe("in the reader's language", () => {
  test.each([["de"], ["ja"], ["fa"], ["ar"]])(
    "%s: the card's words, the switch and why it is locked in the Admin Dashboard's own words",
    async (language: string) => {
      const locale: Locale = readLocale(language);
      const wordOf: (key: string) => string = (key: string): string => {
        const word: unknown = locale[key];

        expect({ key, worded: typeof word === "string" && word !== key }).toEqual(
          { key, worded: true },
        );

        return word as string;
      };

      environmentAnswer = answerFor(switchVariable("true"));

      await renderPage(language);

      const toggle: HTMLElement = await theSwitch(
        wordOf(PROJECT_CALL_VOICES_COPY.switchTitle),
      );

      expect(environmentCard()).toHaveTextContent(
        wordOf(PROJECT_CALL_VOICES_COPY.environmentDescription),
      );
      expect(toggle).toHaveAccessibleDescription(
        expect.stringContaining(
          wordOf(PROJECT_CALL_VOICES_COPY.environmentLockedReason),
        ),
      );
      // The variable's name and the Helm value as they are written, in every language.
      expect(environmentCard()).toHaveTextContent(VARIABLE);
      expect(environmentCard()).toHaveTextContent(
        "twilio.letProjectsChooseCallVoice",
      );
    },
  );

  test("every language words the three new sentences, keeping the variable's name and the Helm value", () => {
    for (const language of fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      })) {
      const locale: Locale = readLocale(language);

      for (const key of [
        PROJECT_CALL_VOICES_COPY.environmentDescription,
        PROJECT_CALL_VOICES_COPY.environmentLockedReason,
        PROJECT_CALL_VOICES_COPY.environmentProblemTitle,
      ]) {
        const word: unknown = locale[key];

        expect({ language, key, worded: typeof word === "string" }).toEqual({
          language,
          key,
          worded: true,
        });

        if (language !== "en") {
          expect({ language, key, translated: word !== key }).toEqual({
            language,
            key,
            translated: true,
          });
        }
      }

      const description: string = locale[
        PROJECT_CALL_VOICES_COPY.environmentDescription
      ] as string;

      expect([language, description.includes(VARIABLE)]).toEqual([
        language,
        true,
      ]);
      expect([
        language,
        description.includes("twilio.letProjectsChooseCallVoice"),
      ]).toEqual([language, true]);
      expect([language, description.includes("config.env")]).toEqual([
        language,
        true,
      ]);
    }
  });
});
