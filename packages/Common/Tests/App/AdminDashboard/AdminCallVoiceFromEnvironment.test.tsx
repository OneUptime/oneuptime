import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
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
 * ADMIN DASHBOARD > SETTINGS > CALL AND SMS: THE VOICE OF THE SERVER'S
 * CALLS WHEN GLOBAL_TWILIO_CALL_VOICE SETS IT (#11064), AND WHETHER
 * PROJECTS CHOOSE THEIR OWN (#11065) - on the real page, cards, Detail and
 * switch, in the Admin Dashboard's own English; only the network, the page
 * chrome and the side menu are stand-ins.
 *
 * Once the variable is set, the Call Voice card shows the voice it names,
 * with the variable's name beside it, what the voice says and costs, and
 * no Choose Voice button - the server refuses the write. A value that
 * names no voice OneUptime offers is said above it, by the variable's
 * name, in a line that keeps its own direction, and the voice it leaves is
 * the account's default. Unset, or from a server that cannot say, the
 * voice is chosen here, as before. Under it, the master admin's switch that
 * lets projects choose their own voice, with what the voices cost - never
 * drawn on OneUptime Cloud.
 */

jest.setTimeout(60000);

const mockGetItem: MockFunction = getJestMockFunction();

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
      updateById: async (): Promise<unknown> => {
        return { data: {} };
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
import {
  CALL_VOICE_CARD_COPY,
  CALL_VOICE_CARD_LOADING_TEST_ID,
  CALL_VOICE_CARD_PROBLEM_TEST_ID,
  CALL_VOICE_CARD_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/CallVoiceCardCopy";
import ProjectCallVoicesCard from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/ProjectCallVoicesCard";
import {
  PROJECT_CALL_VOICES_COPY,
  PROJECT_CALL_VOICES_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/ProjectCallVoicesCardCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import ServerTwilioEnvironment, {
  SERVER_TWILIO_CALL_VOICE_VARIABLE,
  SERVER_TWILIO_ENVIRONMENT_ROUTE,
  ServerTwilioEnvironmentAnswer,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CALL_VOICE_DEFAULT_LABEL } from "../../../UI/Components/CallVoice/CallVoiceOptions";
import {
  CALL_VOICE_DEFAULT_LANGUAGES_SENTENCE,
  CALL_VOICE_HEAR_IT_NOW_SENTENCE,
  CALL_VOICE_HEAR_IT_SENTENCE,
  CALL_VOICE_LANGUAGES_SENTENCES,
} from "../../../UI/Components/CallVoice/CallVoiceSample";
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

const ENGLISH: Locale = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as Locale;

const ENV_SID: string = "AC22222222222222222222222222222222";
const TOKEN: string = "environment-auth-token-sentinel-11064";

// The voice an admin saved, which the variable then stands in front of.
const SAVED_VOICE: string = "Polly.Amy-Neural";

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

// The answer the server gives for these variables, as it sends it.
function answerFor(
  values: Record<string, string>,
): () => Promise<HTTPResponse<JSONObject>> {
  const answer: ServerTwilioEnvironmentAnswer =
    ServerTwilioEnvironment.toAnswer(
      ServerTwilioEnvironment.read(values),
      ServerTwilioEnvironment.readCallVoice(values),
    );

  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      JSON.parse(JSON.stringify(answer)) as JSONObject,
      {},
    );
  };
}

function voiceVariable(value: string): Record<string, string> {
  return { [SERVER_TWILIO_CALL_VOICE_VARIABLE]: value };
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderInEnglish(element: ReactElement): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: ENGLISH } },
    interpolation: { escapeValue: false },
  });

  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);

  await settle();
}

async function renderPage(): Promise<void> {
  await renderInEnglish(<CallSmsSettings />);
}

// The Call Voice card, once it is past its loader.
async function voiceCard(): Promise<HTMLElement> {
  await waitFor(
    () => {
      expect(
        within(screen.getByTestId(CALL_VOICE_CARD_TEST_ID)).queryByTestId(
          CALL_VOICE_CARD_LOADING_TEST_ID,
        ),
      ).toBeNull();
      expect(
        within(screen.getByTestId(CALL_VOICE_CARD_TEST_ID)).getByTestId(
          "call-voice-summary",
        ),
      ).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return screen.getByTestId(CALL_VOICE_CARD_TEST_ID);
}

beforeEach(() => {
  savedRow = { twilioCallVoice: SAVED_VOICE };
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);

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

describe("set by GLOBAL_TWILIO_CALL_VOICE", () => {
  test("the variable's voice, by its name, with what it says and costs, and no Choose Voice button", async () => {
    environmentAnswer = answerFor(voiceVariable("Polly.Matthew-Neural"));

    await renderPage();

    const card: HTMLElement = await voiceCard();

    expect(within(card).getByText(CALL_VOICE_CARD_COPY.title)).toBeVisible();
    expect(
      within(card).getByText(CALL_VOICE_CARD_COPY.environmentDescription),
    ).toBeVisible();
    // The voice set, never the one saved.
    expect(within(card).getByTestId("call-voice-summary")).toHaveTextContent(
      "Matthew",
    );
    expect(card).not.toHaveTextContent("Amy");
    // Beside it, the variable that sets it.
    expect(
      within(card).getByText(SERVER_TWILIO_CALL_VOICE_VARIABLE),
    ).toBeVisible();
    // Nothing here changes it.
    expect(
      within(card).queryAllByRole("button", {
        name: CALL_VOICE_CARD_COPY.button,
      }),
    ).toEqual([]);
    expect(
      screen.queryByRole("button", { name: CALL_VOICE_CARD_COPY.button }),
    ).toBeNull();
    // What it says and costs, and how to hear it: it is in effect already.
    const sample: HTMLElement = within(card).getByTestId("call-voice-sample");

    expect(
      within(sample).getByText(CALL_VOICE_LANGUAGES_SENTENCES.male),
    ).toBeVisible();
    expect(
      within(sample).getByTestId("call-voice-sample-cost"),
    ).toHaveTextContent(
      "Twilio charges extra for these voices: under 3 US cents for each page's call, in any language.",
    );
    expect(
      within(sample).getByTestId("call-voice-sample-hear-it"),
    ).toHaveTextContent(CALL_VOICE_HEAR_IT_NOW_SENTENCE);
    expect(sample).not.toHaveTextContent(CALL_VOICE_HEAR_IT_SENTENCE);
    // No problem to say.
    expect(
      within(card).queryByTestId(CALL_VOICE_CARD_PROBLEM_TEST_ID),
    ).toBeNull();
  });

  test("beside the account's variables: both read-only, the token never drawn", async () => {
    environmentAnswer = answerFor({
      [ServerTwilioEnvironmentVariable.AccountSid]: ENV_SID,
      [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
      ...voiceVariable("Google.en-US-Neural2-F"),
    });

    await renderPage();

    const card: HTMLElement = await voiceCard();

    expect(within(card).getByTestId("call-voice-summary")).toHaveTextContent(
      "Neural2-F",
    );
    expect(
      screen.queryByRole("button", { name: CALL_VOICE_CARD_COPY.button }),
    ).toBeNull();
    expect(screen.getByText(ENV_SID)).toBeVisible();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  test("a voice OneUptime does not offer: said above, by the variable's name, in a line of its own direction - and the voice it leaves is the account's default", async () => {
    environmentAnswer = answerFor(voiceVariable("Polly.Joanna"));

    await renderPage();

    const card: HTMLElement = await voiceCard();
    const problem: HTMLElement = within(card).getByTestId(
      CALL_VOICE_CARD_PROBLEM_TEST_ID,
    );

    expect(
      within(problem).getByText(CALL_VOICE_CARD_COPY.environmentProblemTitle),
    ).toBeVisible();

    const line: HTMLElement = within(problem).getByText(
      /^GLOBAL_TWILIO_CALL_VOICE: "Polly\.Joanna" is not a voice OneUptime offers/,
    );

    expect(line.tagName).toBe("BDI");
    expect(line).toHaveTextContent(
      "Set it to one of Polly.Joanna-Neural, Polly.Matthew-Neural, Polly.Amy-Neural, Polly.Brian-Neural, Google.en-US-Neural2-F, Google.en-US-Neural2-J, or leave it empty to choose the voice in the Admin Dashboard.",
    );
    expect(within(card).getByTestId("call-voice-summary")).toHaveTextContent(
      CALL_VOICE_DEFAULT_LABEL,
    );
    // Not the saved voice, which nobody set the variable to.
    expect(
      within(card).getByTestId("call-voice-summary"),
    ).not.toHaveTextContent("Amy");
    expect(
      within(card).getByTestId("call-voice-sample-voice"),
    ).not.toHaveTextContent("Amy");
    expect(
      within(card).getByText(CALL_VOICE_DEFAULT_LANGUAGES_SENTENCE),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: CALL_VOICE_CARD_COPY.button }),
    ).toBeNull();
  });
});

describe("not set by it", () => {
  test("the saved voice and its Choose Voice button, as before", async () => {
    environmentAnswer = answerFor({});

    await renderPage();

    const card: HTMLElement = await voiceCard();

    expect(within(card).getByTestId("call-voice-summary")).toHaveTextContent(
      "Amy",
    );
    expect(
      within(card).getByRole("button", { name: CALL_VOICE_CARD_COPY.button }),
    ).toBeEnabled();
    expect(
      within(card).getByText(CALL_VOICE_CARD_COPY.description),
    ).toBeVisible();
    expect(
      within(card).queryByText(CALL_VOICE_CARD_COPY.environmentDescription),
    ).toBeNull();
    expect(
      within(card).queryByText(SERVER_TWILIO_CALL_VOICE_VARIABLE),
    ).toBeNull();
  });

  test("the account's variables alone leave the voice to choose here", async () => {
    environmentAnswer = answerFor({
      [ServerTwilioEnvironmentVariable.AccountSid]: ENV_SID,
      [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
    });

    await renderPage();

    const card: HTMLElement = await voiceCard();

    expect(
      within(card).getByRole("button", { name: CALL_VOICE_CARD_COPY.button }),
    ).toBeEnabled();
  });

  test.each([
    [
      "answers with an error",
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(500, { message: "Server error" }, {});
      },
    ],
    [
      "cannot be reached",
      async (): Promise<never> => {
        throw new Error("Network error");
      },
    ],
  ] as Array<[string, () => Promise<HTTPErrorResponse>]>)(
    "a server that %s: the voice to choose here, as before",
    async (_case: string, answer: () => Promise<HTTPErrorResponse>) => {
      environmentAnswer = answer;

      await renderPage();

      const card: HTMLElement = await voiceCard();

      expect(
        within(card).getByRole("button", { name: CALL_VOICE_CARD_COPY.button }),
      ).toBeEnabled();
    },
  );

  test("until the server says: the card's title over a loader, and no Choose Voice button that may not apply", async () => {
    environmentAnswer = (): Promise<never> => {
      return new Promise<never>(() => {
        // Never answers.
      });
    };

    await renderPage();

    const loading: HTMLElement = screen.getByTestId(
      CALL_VOICE_CARD_LOADING_TEST_ID,
    );

    expect(within(loading).getByText(CALL_VOICE_CARD_COPY.title)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: CALL_VOICE_CARD_COPY.button }),
    ).toBeNull();
  });
});

describe("Project Call Voices", () => {
  async function switchCard(): Promise<HTMLElement> {
    await waitFor(
      () => {
        expect(
          screen.getByRole("switch", {
            name: PROJECT_CALL_VOICES_COPY.switchTitle,
          }),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    return screen.getByTestId(`${PROJECT_CALL_VOICES_SWITCH_TEST_ID}-card`);
  }

  test("on the page, under the server's voice: off as every server starts, saying what off means and what the voices cost", async () => {
    await renderPage();

    const card: HTMLElement = await switchCard();

    expect(
      screen.getByRole("switch", {
        name: PROJECT_CALL_VOICES_COPY.switchTitle,
      }),
    ).not.toBeChecked();
    expect(document.body).toHaveTextContent(PROJECT_CALL_VOICES_COPY.cardTitle);
    expect(document.body).toHaveTextContent(
      PROJECT_CALL_VOICES_COPY.switchOffDescription,
    );
    expect(
      within(card).getByTestId(`${PROJECT_CALL_VOICES_SWITCH_TEST_ID}-cost`),
    ).toHaveTextContent(
      "Twilio charges extra for these voices: under 3 US cents for each page's call, in any language.",
    );

    // Drawn after the server's own voice.
    const voice: HTMLElement = screen.getByTestId(CALL_VOICE_CARD_TEST_ID);

    expect(
      voice.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("on: says who chooses, where, and who pays", async () => {
    savedRow = {
      twilioCallVoice: SAVED_VOICE,
      letProjectsChooseCallVoice: true,
    };

    await renderPage();
    await switchCard();

    expect(
      screen.getByRole("switch", {
        name: PROJECT_CALL_VOICES_COPY.switchTitle,
      }),
    ).toBeChecked();
    expect(document.body).toHaveTextContent(
      PROJECT_CALL_VOICES_COPY.switchOnDescription,
    );
  });

  test("set by the variable or not, the switch is the admin's to flip: it is a setting of its own", async () => {
    environmentAnswer = answerFor(voiceVariable("Polly.Matthew-Neural"));

    await renderPage();
    await switchCard();

    expect(
      screen.getByRole("switch", {
        name: PROJECT_CALL_VOICES_COPY.switchTitle,
      }),
    ).toBeEnabled();
  });

  test("never on OneUptime Cloud, whose Twilio account OneUptime pays for", async () => {
    await renderInEnglish(<ProjectCallVoicesCard isBillingEnabled={true} />);

    expect(
      screen.queryByRole("switch", {
        name: PROJECT_CALL_VOICES_COPY.switchTitle,
      }),
    ).toBeNull();
    expect(document.body).not.toHaveTextContent(
      PROJECT_CALL_VOICES_COPY.cardTitle,
    );
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  test("self-hosted, drawn on its own too", async () => {
    await renderInEnglish(<ProjectCallVoicesCard isBillingEnabled={false} />);

    await switchCard();
  });
});
