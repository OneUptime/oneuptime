import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Asking people, in the Dashboard (issue #6832): when each question
 * appears and when it does not, the switches, what an answer is sent with,
 * and the self-hosted path that sends nothing off the server.
 *
 *   - the end of every guided setup (GuidedSetupFrame): "How easy was
 *     that?" when the server says to ask, never otherwise; "Stuck?" before
 *     the end, wherever the server takes feedback;
 *   - Give feedback in Help, on every page and in the phone's menu;
 *   - "Was this clear?" under How OneUptime works;
 *   - the first-week check-in on Home, its links in the reader's words;
 *   - the page an answer carries: a route pattern with no ids.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const captureMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

let billingEnabled: boolean = false;

/*
 * The reader's language: English, each word as written, unless a test hands
 * t() a locale's words. t() then answers from them as i18next answers from a
 * loaded locale file, and a word they lack falls back to its English, as
 * i18next's defaultValue does.
 */
let readerLanguage: string = "en";
let readerWords: Readonly<Record<string, string>> = {};

/*
 * Words a stand-in translateText answers nothing for. Its type allows it
 * (Translator.translateText answers string | undefined, the reason #7407's
 * links failed the Dashboard's type check); the real lookup answers a
 * missing word in English, so only a stand-in does this.
 */
let wordsTranslateTextAnswersNothingFor: ReadonlySet<string> =
  new Set<string>();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (Object.prototype.hasOwnProperty.call(readerWords, key)) {
            return readerWords[key] as string;
          }

          if (typeof options === "string") {
            return options;
          }

          if (
            options &&
            typeof options === "object" &&
            typeof (options as { defaultValue?: unknown }).defaultValue ===
              "string"
          ) {
            return (options as { defaultValue: string }).defaultValue;
          }

          return key;
        },
        i18n: { resolvedLanguage: readerLanguage, language: readerLanguage },
      };
    },
  };
});

// The real useTranslator, whose translateText answers nothing for some words.
jest.mock("../../../UI/Utils/UseTranslator", () => {
  const actual: { default: () => Translator } = jest.requireActual(
    "../../../UI/Utils/UseTranslator",
  ) as { default: () => Translator };

  return {
    __esModule: true,
    default: (): Translator => {
      const translator: Translator = actual.default();

      if (wordsTranslateTextAnswersNothingFor.size === 0) {
        return translator;
      }

      return {
        ...translator,
        translateText: (text: string | undefined): string | undefined => {
          return text !== undefined &&
            wordsTranslateTextAnswersNothingFor.has(text)
            ? undefined
            : translator.translateText(text);
        },
      };
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
      return billingEnabled;
    },
  });

  return mockedConfig;
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return getMock(...args);
      },
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return String(err);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return captureMock(...args);
      },
    },
  };
});

import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import {
  PRODUCT_FEEDBACK_ASK_ROUTE,
  PRODUCT_FEEDBACK_DETAILS_ROUTE,
  PRODUCT_FEEDBACK_ROUTE,
} from "../../../Types/ProductFeedback/ProductFeedback";
import Project from "../../../Models/DatabaseModels/Project";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProductFeedback from "../../../UI/Utils/ProductFeedback";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import {
  WAS_THIS_CLEAR_NO_TEST_ID,
  WAS_THIS_CLEAR_TEST_ID,
  WAS_THIS_CLEAR_THANKS_TEST_ID,
  WAS_THIS_CLEAR_YES_TEST_ID,
  forgetAnsweredExplanations,
} from "../../../UI/Components/Feedback/WasThisClear";
import GuidedSetupFrame, {
  GuidedSetupFrameStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupFrame";
import {
  EASE_QUESTION_CLOSE_TEST_ID,
  EASE_QUESTION_DETAILS_TEST_ID,
  EASE_QUESTION_FAILED_TEST_ID,
  EASE_QUESTION_GITHUB_TEST_ID,
  EASE_QUESTION_SCORE_TEST_ID,
  EASE_QUESTION_SEND_TEST_ID,
  EASE_QUESTION_STOP_ASKING_TEST_ID,
  EASE_QUESTION_TEST_ID,
  EASE_QUESTION_THANKS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Feedback/EaseQuestion";
import { SETUP_FEEDBACK_STUCK_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Feedback/SetupFeedback";
import GiveFeedbackDialog, {
  GIVE_FEEDBACK_ATTACHED_TEST_ID,
  GIVE_FEEDBACK_DETAILS_TEST_ID,
  GIVE_FEEDBACK_DIALOG_TEST_ID,
  GIVE_FEEDBACK_GITHUB_TEST_ID,
  GIVE_FEEDBACK_SENT_TEST_ID,
  GiveFeedbackOpenedFrom,
  openGiveFeedback,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Feedback/GiveFeedbackDialog";
import SetupCheckInCard, {
  SETUP_CHECK_IN_CLOSE_TEST_ID,
  SETUP_CHECK_IN_DETAILS_TEST_ID,
  SETUP_CHECK_IN_NOT_YET_TEST_ID,
  SETUP_CHECK_IN_SEND_TEST_ID,
  SETUP_CHECK_IN_SETUPS_TEST_ID,
  SETUP_CHECK_IN_SETUP_HEALTH_TEST_ID,
  SETUP_CHECK_IN_TEST_ID,
  SETUP_CHECK_IN_THANKS_TEST_ID,
  SETUP_CHECK_IN_YES_TEST_ID,
  isCheckInForReader,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Feedback/SetupCheckInCard";
import {
  getFeedbackGitHubIssueUrl,
  getFeedbackPageFor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Feedback/FeedbackPage";
import Help, {
  HELP_ASK_GROUP_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Help";
import HowOneUptimeWorksDialog, {
  HOW_ONEUPTIME_WORKS_FEEDBACK_TOPIC,
  HowOneUptimeWorksOpenedFrom,
  openHowOneUptimeWorks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog";
import { getVisibleActionIds } from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000006832";
const USER_ID: string = "40000000-0000-4000-8000-000000000001";
const ANSWER_ID: string = "33333333-3333-4333-8333-333333333333";
const DAY_MS: number = 24 * 60 * 60 * 1000;

const ok: (data: JSONObject) => HTTPResponse<JSONObject> = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

const postsTo: (route: string) => Array<JSONObject> = (
  route: string,
): Array<JSONObject> => {
  return postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { url: { toString: () => string }; data: JSONObject };
    })
    .filter((call: { url: { toString: () => string } }): boolean => {
      return new URL(call.url.toString()).pathname.endsWith(route);
    })
    .map((call: { data: JSONObject }): JSONObject => {
      return call.data;
    });
};

// The server: says ask (or not), keeps answers, adds words.
let serverSaysAsk: boolean = true;

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  billingEnabled = false;
  readerLanguage = "en";
  readerWords = {};
  wordsTranslateTextAnswersNothingFor = new Set<string>();
  serverSaysAsk = true;
  ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
  ProductFeedback.setPageResolver(() => {
    return "/dashboard/:projectId/monitors/setup";
  });
  forgetAnsweredExplanations();

  postMock.mockImplementation(async (...args: Array<unknown>) => {
    const call: { url: { toString: () => string } } = args[0] as {
      url: { toString: () => string };
    };
    const path: string = new URL(call.url.toString()).pathname;

    if (path.endsWith(PRODUCT_FEEDBACK_ASK_ROUTE)) {
      return ok({ ask: serverSaysAsk, reason: serverSaysAsk ? "ask" : "x" });
    }

    if (path.endsWith(PRODUCT_FEEDBACK_DETAILS_ROUTE)) {
      return ok({ added: true });
    }

    if (path.endsWith(PRODUCT_FEEDBACK_ROUTE)) {
      return ok({ answerId: ANSWER_ID });
    }

    return ok({});
  });

  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (
    ...args: Array<unknown>
  ) => {
    updateByIdMock(...args);
    return ok({});
  }) as never);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  getMock.mockReset();
  postMock.mockReset();
  captureMock.mockReset();
  updateByIdMock.mockReset();
});

const steps: (isDone: boolean) => Array<GuidedSetupFrameStep> = (
  isDone: boolean,
): Array<GuidedSetupFrameStep> => {
  return [
    {
      key: "check",
      title: "Check the address",
      isDone: isDone,
      content: <p>asks</p>,
    },
  ];
};

const drawSetup: (isFinished: boolean) => void = (
  isFinished: boolean,
): void => {
  render(
    <GuidedSetupFrame
      setup="website_down"
      steps={steps(isFinished)}
      openStepKey={isFinished ? null : "check"}
      onOpenStep={() => {}}
      summary={<p>All set</p>}
      isFinished={isFinished}
    />,
  );
};

describe("the end of a guided setup asks once", () => {
  test("finished, and the server says ask: How easy was that?", async () => {
    drawSetup(true);

    expect(await screen.findByTestId(EASE_QUESTION_TEST_ID)).toHaveTextContent(
      "How easy was that?",
    );
    expect(postsTo(PRODUCT_FEEDBACK_ASK_ROUTE)).toEqual([
      { question: "setup_flow:website_down" },
    ]);
    // OneUptime asked, so the person may tell it to stop.
    expect(
      screen.getByTestId(EASE_QUESTION_STOP_ASKING_TEST_ID),
    ).toBeInTheDocument();
  });

  test("the server says no (asked this week, asked before, an open incident): nothing shows", async () => {
    serverSaysAsk = false;
    drawSetup(true);

    await waitFor(() => {
      expect(postsTo(PRODUCT_FEEDBACK_ASK_ROUTE).length).toBe(1);
    });
    expect(screen.queryByTestId(EASE_QUESTION_TEST_ID)).toBeNull();
  });

  test("a person who switched questions off is never asked, and the server is not asked either", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: false });
    drawSetup(true);

    await act(async () => {
      await Promise.resolve();
    });
    expect(postMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId(EASE_QUESTION_TEST_ID)).toBeNull();
  });

  test("a server that switched feedback off asks nothing and offers nothing", async () => {
    ProductFeedback.setSettings({ isOn: false, isAskingMe: false });
    drawSetup(false);

    expect(screen.queryByTestId(SETUP_FEEDBACK_STUCK_TEST_ID)).toBeNull();
    cleanup();
    drawSetup(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  test("settings that arrive after the end still ask, once", async () => {
    ProductFeedback.setSettings(null);
    drawSetup(true);

    await act(async () => {
      await Promise.resolve();
    });
    expect(postMock).not.toHaveBeenCalled();

    act(() => {
      ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    });

    expect(
      await screen.findByTestId(EASE_QUESTION_TEST_ID),
    ).toBeInTheDocument();
    expect(postsTo(PRODUCT_FEEDBACK_ASK_ROUTE).length).toBe(1);
  });

  test("one click answers it: the score is kept at once, then the words are optional", async () => {
    drawSetup(true);
    fireEvent.click(
      await screen.findByTestId(`${EASE_QUESTION_SCORE_TEST_ID}-2`),
    );

    await screen.findByTestId(EASE_QUESTION_DETAILS_TEST_ID);
    expect(postsTo(PRODUCT_FEEDBACK_ROUTE)).toEqual([
      {
        kind: "setup_flow",
        topic: "website_down",
        score: 2,
        isPositive: null,
        details: null,
        page: "/dashboard/:projectId/monitors/setup",
        version: ProductFeedback.getVersion(),
      },
    ]);
    expect(screen.getByTestId(EASE_QUESTION_TEST_ID)).toHaveTextContent(
      "Thanks. What got in the way?",
    );

    fireEvent.change(
      screen
        .getByTestId(EASE_QUESTION_DETAILS_TEST_ID)
        .querySelector("textarea") ||
        screen.getByTestId(EASE_QUESTION_DETAILS_TEST_ID),
      { target: { value: "The test page took a minute." } },
    );
    fireEvent.click(screen.getByTestId(EASE_QUESTION_SEND_TEST_ID));

    await screen.findByTestId(EASE_QUESTION_THANKS_TEST_ID);
    expect(postsTo(PRODUCT_FEEDBACK_DETAILS_ROUTE)).toEqual([
      { answerId: ANSWER_ID, details: "The test page took a minute." },
    ]);
  });

  test("self-hosted: once words are sent, the person may also tell OneUptime on GitHub - a pre-filled issue they read first", async () => {
    drawSetup(true);
    fireEvent.click(
      await screen.findByTestId(`${EASE_QUESTION_SCORE_TEST_ID}-1`),
    );
    await screen.findByTestId(EASE_QUESTION_DETAILS_TEST_ID);
    fireEvent.change(
      screen
        .getByTestId(EASE_QUESTION_DETAILS_TEST_ID)
        .querySelector("textarea") ||
        screen.getByTestId(EASE_QUESTION_DETAILS_TEST_ID),
      { target: { value: "No email arrived." } },
    );
    fireEvent.click(screen.getByTestId(EASE_QUESTION_SEND_TEST_ID));

    const link: HTMLElement = await screen.findByTestId(
      EASE_QUESTION_GITHUB_TEST_ID,
    );
    const url: URL = new URL(link.getAttribute("href") || "");

    expect(url.hostname).toBe("github.com");
    expect(url.searchParams.get("body")).toContain("No email arrived.");
    expect(url.searchParams.get("body")).toContain(
      "Page: /dashboard/:projectId/monitors/setup",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("on OneUptime Cloud there is no GitHub link: the answer already reached the team", async () => {
    billingEnabled = true;
    drawSetup(true);
    fireEvent.click(
      await screen.findByTestId(`${EASE_QUESTION_SCORE_TEST_ID}-1`),
    );
    await screen.findByTestId(EASE_QUESTION_DETAILS_TEST_ID);
    fireEvent.change(
      screen
        .getByTestId(EASE_QUESTION_DETAILS_TEST_ID)
        .querySelector("textarea") ||
        screen.getByTestId(EASE_QUESTION_DETAILS_TEST_ID),
      { target: { value: "Hard." } },
    );
    fireEvent.click(screen.getByTestId(EASE_QUESTION_SEND_TEST_ID));

    await screen.findByTestId(EASE_QUESTION_THANKS_TEST_ID);
    expect(screen.queryByTestId(EASE_QUESTION_GITHUB_TEST_ID)).toBeNull();
  });

  test("an answer that could not be sent says so, and the question stays", async () => {
    postMock.mockImplementation(async (...args: Array<unknown>) => {
      const path: string = new URL(
        (args[0] as { url: { toString: () => string } }).url.toString(),
      ).pathname;

      if (path.endsWith(PRODUCT_FEEDBACK_ASK_ROUTE)) {
        return ok({ ask: true, reason: "ask" });
      }

      throw new Error("network");
    });

    drawSetup(true);
    fireEvent.click(
      await screen.findByTestId(`${EASE_QUESTION_SCORE_TEST_ID}-3`),
    );

    expect(
      await screen.findByTestId(EASE_QUESTION_FAILED_TEST_ID),
    ).toHaveTextContent("Your answer could not be sent.");
    expect(screen.queryByTestId(EASE_QUESTION_DETAILS_TEST_ID)).toBeNull();
  });

  test("Don't ask me again switches every question off for the person, and puts it away", async () => {
    drawSetup(true);
    fireEvent.click(
      await screen.findByTestId(EASE_QUESTION_STOP_ASKING_TEST_ID),
    );

    expect(screen.queryByTestId(EASE_QUESTION_TEST_ID)).toBeNull();
    expect(ProductFeedback.isAskingMe()).toBe(false);
    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: JSONObject }).data,
    ).toEqual({ disableFeedbackQuestions: true });
  });

  test("an easy score is not asked what got in the way, but what could be easier", async () => {
    drawSetup(true);
    fireEvent.click(
      await screen.findByTestId(`${EASE_QUESTION_SCORE_TEST_ID}-5`),
    );

    await screen.findByTestId(EASE_QUESTION_DETAILS_TEST_ID);
    expect(screen.getByTestId(EASE_QUESTION_TEST_ID)).toHaveTextContent(
      "Thanks. Anything we could make easier?",
    );
    expect(screen.getByTestId(EASE_QUESTION_TEST_ID)).not.toHaveTextContent(
      "What got in the way?",
    );
  });

  test("the X puts it away, and nothing is kept", async () => {
    drawSetup(true);
    fireEvent.click(await screen.findByTestId(EASE_QUESTION_CLOSE_TEST_ID));

    expect(screen.queryByTestId(EASE_QUESTION_TEST_ID)).toBeNull();
    expect(postsTo(PRODUCT_FEEDBACK_ROUTE)).toEqual([]);
  });
});

describe("before the end of a setup: Stuck?", () => {
  test("offered under the steps, it opens the same question without asking the server", async () => {
    drawSetup(false);

    fireEvent.click(screen.getByTestId(SETUP_FEEDBACK_STUCK_TEST_ID));

    expect(screen.getByTestId(EASE_QUESTION_TEST_ID)).toHaveTextContent(
      "How easy is this so far?",
    );
    // The person opened it: not a question OneUptime asked.
    expect(postsTo(PRODUCT_FEEDBACK_ASK_ROUTE)).toEqual([]);
    expect(screen.queryByTestId(EASE_QUESTION_STOP_ASKING_TEST_ID)).toBeNull();
  });

  test("offered even to a person who switched questions off: they open it themselves", () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: false });
    drawSetup(false);

    expect(
      screen.getByTestId(SETUP_FEEDBACK_STUCK_TEST_ID),
    ).toBeInTheDocument();
  });

  test("not offered until the settings say the server takes feedback", () => {
    ProductFeedback.setSettings(null);
    drawSetup(false);

    expect(screen.queryByTestId(SETUP_FEEDBACK_STUCK_TEST_ID)).toBeNull();
  });
});

describe("Give feedback, from any page", () => {
  const openDialog: () => void = (): void => {
    render(<GiveFeedbackDialog />);
    act(() => {
      openGiveFeedback(GiveFeedbackOpenedFrom.Help);
    });
  };

  test("says what it is sent with - the page as a route and the version - before anything is sent", () => {
    openDialog();

    expect(
      screen.getByTestId(GIVE_FEEDBACK_DIALOG_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(GIVE_FEEDBACK_ATTACHED_TEST_ID),
    ).toHaveTextContent("/dashboard/:projectId/monitors/setup");
    expect(
      screen.getByTestId(GIVE_FEEDBACK_ATTACHED_TEST_ID),
    ).toHaveTextContent(ProductFeedback.getVersion());
    expect(screen.getByTestId(GIVE_FEEDBACK_DIALOG_TEST_ID)).toHaveTextContent(
      "this server's admins",
    );
  });

  test("sends the words with the page and the version, and where it was opened from", async () => {
    openDialog();

    fireEvent.change(
      screen
        .getByTestId(GIVE_FEEDBACK_DETAILS_TEST_ID)
        .querySelector("textarea") ||
        screen.getByTestId(GIVE_FEEDBACK_DETAILS_TEST_ID),
      { target: { value: "I wanted to page Grace and could not find how." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send Feedback" }));

    await screen.findByTestId(GIVE_FEEDBACK_SENT_TEST_ID);
    expect(postsTo(PRODUCT_FEEDBACK_ROUTE)).toEqual([
      {
        kind: "general",
        topic: "help",
        score: null,
        isPositive: null,
        details: "I wanted to page Grace and could not find how.",
        page: "/dashboard/:projectId/monitors/setup",
        version: ProductFeedback.getVersion(),
      },
    ]);
    // Self-hosted: nothing left the server; GitHub is the person's choice.
    expect(screen.getByTestId(GIVE_FEEDBACK_GITHUB_TEST_ID)).toHaveAttribute(
      "href",
      expect.stringContaining("github.com/OneUptime/oneuptime/issues/new"),
    );
  });

  test("on OneUptime Cloud it goes to the team, and offers no GitHub link", async () => {
    billingEnabled = true;
    openDialog();

    expect(screen.getByTestId(GIVE_FEEDBACK_DIALOG_TEST_ID)).toHaveTextContent(
      "OneUptime team",
    );
    fireEvent.change(
      screen
        .getByTestId(GIVE_FEEDBACK_DETAILS_TEST_ID)
        .querySelector("textarea") ||
        screen.getByTestId(GIVE_FEEDBACK_DETAILS_TEST_ID),
      { target: { value: "Words." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send Feedback" }));

    await screen.findByTestId(GIVE_FEEDBACK_SENT_TEST_ID);
    expect(screen.queryByTestId(GIVE_FEEDBACK_GITHUB_TEST_ID)).toBeNull();
  });

  test("nothing written is not sent, and the dialog says what to write", async () => {
    openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Send Feedback" }));

    expect(
      await screen.findByText(
        "Write what you were trying to do and what happened, then send it.",
      ),
    ).toBeInTheDocument();
    expect(postsTo(PRODUCT_FEEDBACK_ROUTE)).toEqual([]);
  });

  test("Help offers it where the server takes feedback, and opens the dialog", async () => {
    render(
      <>
        <Help />
        <GiveFeedbackDialog />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "help.label" }));
    expect(screen.getByTestId(HELP_ASK_GROUP_TEST_ID)).toHaveTextContent(
      "Give feedback",
    );

    fireEvent.click(screen.getByText("Give feedback"));

    expect(
      await screen.findByTestId(GIVE_FEEDBACK_DIALOG_TEST_ID),
    ).toBeInTheDocument();
  });

  test("Help offers nothing where the server takes no feedback, or before the settings arrive", () => {
    for (const settings of [{ isOn: false, isAskingMe: false }, null]) {
      ProductFeedback.setSettings(settings);
      render(<Help />);
      fireEvent.click(screen.getByRole("button", { name: "help.label" }));

      expect(screen.getByTestId(HELP_ASK_GROUP_TEST_ID)).not.toHaveTextContent(
        "Give feedback",
      );
      cleanup();
    }
  });

  test("a person who said stop asking still finds Give feedback in Help", () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: false });
    render(<Help />);
    fireEvent.click(screen.getByRole("button", { name: "help.label" }));

    expect(screen.getByTestId(HELP_ASK_GROUP_TEST_ID)).toHaveTextContent(
      "Give feedback",
    );
  });

  test("Search offers it beside the Glossary only where the server takes feedback", () => {
    const base: Parameters<typeof getVisibleActionIds>[0] = {
      hasProjectSelected: true,
      isMasterAdmin: false,
      canCreateIncident: false,
      canCreateMonitor: false,
      canCreateAlert: false,
      canCreateScheduledMaintenance: false,
      canCreateAnnouncement: false,
    };

    const withFeedback: Array<string> = getVisibleActionIds({
      ...base,
      canGiveFeedback: true,
    });

    expect(withFeedback).toContain("action-give-feedback");
    expect(withFeedback.indexOf("action-give-feedback")).toBe(
      withFeedback.indexOf("action-glossary") + 1,
    );
    expect(getVisibleActionIds(base)).not.toContain("action-give-feedback");
    expect(
      getVisibleActionIds({ ...base, canGiveFeedback: false }),
    ).not.toContain("action-give-feedback");
  });
});

describe("Was this clear? under How OneUptime works", () => {
  const openMap: () => void = (): void => {
    render(
      <MemoryRouter>
        <HowOneUptimeWorksDialog />
      </MemoryRouter>,
    );
    act(() => {
      openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Help);
    });
  };

  test("a thumb answers it, under the map's own topic, with no words", async () => {
    openMap();

    fireEvent.click(screen.getByTestId(WAS_THIS_CLEAR_NO_TEST_ID));

    expect(
      screen.getByTestId(WAS_THIS_CLEAR_THANKS_TEST_ID),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(postsTo(PRODUCT_FEEDBACK_ROUTE)).toEqual([
        {
          kind: "explanation",
          topic: HOW_ONEUPTIME_WORKS_FEEDBACK_TOPIC,
          score: null,
          isPositive: false,
          details: null,
          page: "/dashboard/:projectId/monitors/setup",
          version: ProductFeedback.getVersion(),
        },
      ]);
    });
  });

  test("answered once, it says thanks the next time the map opens, rather than asking again", async () => {
    openMap();
    fireEvent.click(screen.getByTestId(WAS_THIS_CLEAR_YES_TEST_ID));
    cleanup();

    openMap();

    expect(
      screen.getByTestId(WAS_THIS_CLEAR_THANKS_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(WAS_THIS_CLEAR_YES_TEST_ID)).toBeNull();
  });

  test("not drawn for a person who switched questions off, or on a server that takes none", () => {
    for (const settings of [
      { isOn: true, isAskingMe: false },
      { isOn: false, isAskingMe: false },
      null,
    ]) {
      ProductFeedback.setSettings(settings);
      openMap();

      expect(screen.queryByTestId(WAS_THIS_CLEAR_TEST_ID)).toBeNull();
      cleanup();
    }
  });
});

describe("the first-week check-in on Home", () => {
  const projectMadeDaysAgo: (days: number, creatorId?: string) => void = (
    days: number,
    creatorId?: string,
  ): void => {
    const project: Project = new Project();
    project.id = new ObjectID(PROJECT_ID);
    project.createdAt = new Date(Date.now() - days * DAY_MS);
    project.createdByUserId = new ObjectID(creatorId || USER_ID);
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  };

  const drawCheckIn: (
    isInIncident: boolean | null,
    setupHealthCount?: number | null,
  ) => void = (
    isInIncident: boolean | null,
    setupHealthCount?: number | null,
  ): void => {
    render(
      <MemoryRouter>
        <SetupCheckInCard
          projectId={PROJECT_ID}
          isInIncident={isInIncident}
          setupHealthCount={setupHealthCount}
        />
      </MemoryRouter>,
    );
  };

  /*
   * Clicks Not yet and waits until the answer it sends is kept, so the card
   * is at rest when a test reads it: nothing updates it outside act.
   */
  const answerNotYet: () => Promise<void> = async (): Promise<void> => {
    const answersKept: number = postsTo(PRODUCT_FEEDBACK_ROUTE).length;

    const notYet: HTMLElement = await screen.findByTestId(
      SETUP_CHECK_IN_NOT_YET_TEST_ID,
    );

    await act(async () => {
      fireEvent.click(notYet);
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(postsTo(PRODUCT_FEEDBACK_ROUTE)).toHaveLength(answersKept + 1);
  };

  test("Not yet leads to Setup health when it found something, without repeating its findings", async () => {
    projectMadeDaysAgo(8);
    drawCheckIn(false, 3);

    await answerNotYet();

    const line: HTMLElement = screen.getByTestId(
      SETUP_CHECK_IN_SETUP_HEALTH_TEST_ID,
    );

    expect(line).toHaveTextContent("Open Setup Health");
    expect(line.querySelector("a")?.getAttribute("href")).toContain(
      "/home/setup-health",
    );
    expect(line.querySelector("a")?.getAttribute("href")).toContain(
      "from=home",
    );
  });

  test("Not yet says nothing of Setup health when it found nothing, or could not be read", async () => {
    for (const count of [0, null]) {
      projectMadeDaysAgo(8);
      drawCheckIn(false, count);

      await answerNotYet();

      expect(screen.queryByTestId(SETUP_CHECK_IN_SETUP_HEALTH_TEST_ID)).toBe(
        null,
      );
      expect(
        screen.getByTestId(SETUP_CHECK_IN_SETUPS_TEST_ID),
      ).toBeInTheDocument();
      cleanup();
    }
  });

  test("its creator, on the project's 8th day, with nothing open: asked, once per project", async () => {
    projectMadeDaysAgo(8);
    drawCheckIn(false);

    expect(await screen.findByTestId(SETUP_CHECK_IN_TEST_ID)).toHaveTextContent(
      "Is OneUptime set up the way you wanted?",
    );
    expect(postsTo(PRODUCT_FEEDBACK_ASK_ROUTE)).toEqual([
      { question: `check_in:${PROJECT_ID}` },
    ]);
  });

  test("not before the 7th day, not after the 30th, and never to someone who did not make the project", async () => {
    for (const [days, creator] of [
      [3, USER_ID],
      [45, USER_ID],
      [10, "40000000-0000-4000-8000-000000000002"],
    ] as Array<[number, string]>) {
      projectMadeDaysAgo(days, creator);
      drawCheckIn(false);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByTestId(SETUP_CHECK_IN_TEST_ID)).toBeNull();
      cleanup();
      jest.restoreAllMocks();
      jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
    }

    expect(postsTo(PRODUCT_FEEDBACK_ASK_ROUTE)).toEqual([]);
  });

  test("never while an incident or alert is open, nor before Home knows", async () => {
    projectMadeDaysAgo(8);

    for (const isInIncident of [true, null]) {
      drawCheckIn(isInIncident);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByTestId(SETUP_CHECK_IN_TEST_ID)).toBeNull();
      cleanup();
    }

    expect(postsTo(PRODUCT_FEEDBACK_ASK_ROUTE)).toEqual([]);
  });

  test("the server's no (asked before, another question this week) shows nothing", async () => {
    serverSaysAsk = false;
    projectMadeDaysAgo(8);
    drawCheckIn(false);

    await waitFor(() => {
      expect(postsTo(PRODUCT_FEEDBACK_ASK_ROUTE).length).toBe(1);
    });
    expect(screen.queryByTestId(SETUP_CHECK_IN_TEST_ID)).toBeNull();
  });

  test("Yes is kept and thanked", async () => {
    projectMadeDaysAgo(8);
    drawCheckIn(false);

    fireEvent.click(await screen.findByTestId(SETUP_CHECK_IN_YES_TEST_ID));

    expect(screen.getByTestId(SETUP_CHECK_IN_TEST_ID)).toHaveTextContent(
      "Thanks for telling us.",
    );
    await waitFor(() => {
      expect(postsTo(PRODUCT_FEEDBACK_ROUTE)).toEqual([
        {
          kind: "check_in",
          topic: "",
          score: null,
          isPositive: true,
          details: null,
          page: "/dashboard/:projectId/monitors/setup",
          version: ProductFeedback.getVersion(),
        },
      ]);
    });
  });

  test("Not yet shows the guided setups and a box for what is missing, sent with the answer", async () => {
    projectMadeDaysAgo(8);
    drawCheckIn(false);

    fireEvent.click(await screen.findByTestId(SETUP_CHECK_IN_NOT_YET_TEST_ID));

    expect(screen.getByTestId(SETUP_CHECK_IN_SETUPS_TEST_ID)).toHaveTextContent(
      "Know when my website or API is down",
    );
    await waitFor(() => {
      expect(postsTo(PRODUCT_FEEDBACK_ROUTE)[0]).toMatchObject({
        kind: "check_in",
        isPositive: false,
      });
    });

    fireEvent.change(
      screen
        .getByTestId(SETUP_CHECK_IN_DETAILS_TEST_ID)
        .querySelector("textarea") ||
        screen.getByTestId(SETUP_CHECK_IN_DETAILS_TEST_ID),
      { target: { value: "Nobody on my team gets paged yet." } },
    );
    await waitFor(() => {
      expect(
        screen.getByTestId(SETUP_CHECK_IN_SEND_TEST_ID),
      ).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId(SETUP_CHECK_IN_SEND_TEST_ID));

    await screen.findByTestId(SETUP_CHECK_IN_THANKS_TEST_ID);
    expect(postsTo(PRODUCT_FEEDBACK_DETAILS_ROUTE)).toEqual([
      { answerId: ANSWER_ID, details: "Nobody on my team gets paged yet." },
    ]);
  });

  test("the X puts it away", async () => {
    projectMadeDaysAgo(8);
    drawCheckIn(false);

    fireEvent.click(await screen.findByTestId(SETUP_CHECK_IN_CLOSE_TEST_ID));
    expect(screen.queryByTestId(SETUP_CHECK_IN_TEST_ID)).toBeNull();
  });

  test("who it is for, without the server", () => {
    const project: Project = new Project();
    project.createdAt = new Date(Date.now() - 8 * DAY_MS);
    project.createdByUserId = new ObjectID(USER_ID);

    expect(
      isCheckInForReader({
        project: project,
        userId: USER_ID,
        now: new Date(),
      }),
    ).toBe(true);
    expect(
      isCheckInForReader({
        project: project,
        userId: USER_ID.toUpperCase(),
        now: new Date(),
      }),
    ).toBe(true);
    expect(
      isCheckInForReader({ project: null, userId: USER_ID, now: new Date() }),
    ).toBe(false);
    expect(
      isCheckInForReader({ project: project, userId: "", now: new Date() }),
    ).toBe(false);
  });

  /*
   * THE LINKS UNDER NOT YET, IN THE READER'S WORDS (#7407).
   *
   * Open Setup Health and the four guided setups are AppLinks, whose words
   * must be a string. translateText answers string | undefined, so each
   * link falls back to its English words: in German every link reads
   * German, a word the locale lacks reads English, and a translateText that
   * answers nothing never leaves an empty link.
   */
  describe("its links, in the reader's words", () => {
    const DE: Readonly<Record<string, string>> =
      germanLocale as unknown as Record<string, string>;

    // The guided setups the card offers, in its order.
    const GUIDED_SETUP_TITLES: ReadonlyArray<string> = [
      "Know when my website or API is down",
      "Page the right person when something breaks",
      "Publish a status page",
      "Send logs, metrics and traces, then get alerted",
    ];

    const OPEN_SETUP_HEALTH: string = "Open Setup Health";

    const SETUP_HEALTH_SENTENCE: string =
      "Setup health lists what in your project's setup needs a look.";

    const GUIDED_SETUPS_SENTENCE: string =
      "These guided setups do the most common jobs from start to finish:";

    // A locale's words, less the ones a test says it lacks.
    const withoutWords: (
      words: Readonly<Record<string, string>>,
      missing: ReadonlyArray<string>,
    ) => Record<string, string> = (
      words: Readonly<Record<string, string>>,
      missing: ReadonlyArray<string>,
    ): Record<string, string> => {
      const kept: Record<string, string> = { ...words };

      for (const word of missing) {
        delete kept[word];
      }

      return kept;
    };

    // Not yet, with Setup health's finding: both kinds of link are drawn.
    const openNotYet: () => Promise<void> = async (): Promise<void> => {
      projectMadeDaysAgo(8);
      drawCheckIn(false, 3);

      await answerNotYet();
    };

    const setupHealthLink: () => HTMLAnchorElement = (): HTMLAnchorElement => {
      const links: Array<HTMLAnchorElement> = Array.from(
        screen
          .getByTestId(SETUP_CHECK_IN_SETUP_HEALTH_TEST_ID)
          .querySelectorAll("a"),
      );

      expect(links).toHaveLength(1);

      return links[0] as HTMLAnchorElement;
    };

    const guidedSetupLinks: () => Array<HTMLAnchorElement> =
      (): Array<HTMLAnchorElement> => {
        return Array.from(
          screen
            .getByTestId(SETUP_CHECK_IN_SETUPS_TEST_ID)
            .querySelectorAll("a"),
        );
      };

    const wordsOf: (links: Array<HTMLAnchorElement>) => Array<string> = (
      links: Array<HTMLAnchorElement>,
    ): Array<string> => {
      return links.map((link: HTMLAnchorElement): string => {
        return link.textContent || "";
      });
    };

    const pagesOf: (links: Array<HTMLAnchorElement>) => Array<string> = (
      links: Array<HTMLAnchorElement>,
    ): Array<string> => {
      return links.map((link: HTMLAnchorElement): string => {
        return link.getAttribute("href") || "";
      });
    };

    test("German has its own words for every link and the sentences above them", () => {
      for (const words of [
        OPEN_SETUP_HEALTH,
        SETUP_HEALTH_SENTENCE,
        GUIDED_SETUPS_SENTENCE,
        ...GUIDED_SETUP_TITLES,
      ]) {
        expect(typeof DE[words]).toBe("string");
        expect((DE[words] as string).trim()).not.toBe("");
        expect(DE[words]).not.toBe(words);
      }
    });

    test("in English, each link reads its own words", async () => {
      await openNotYet();

      expect(wordsOf([setupHealthLink()])).toEqual([OPEN_SETUP_HEALTH]);
      expect(wordsOf(guidedSetupLinks())).toEqual([...GUIDED_SETUP_TITLES]);
    });

    test("in German, Open Setup Health and each guided setup are links in German, to the same pages as in English", async () => {
      await openNotYet();

      const englishPages: Array<string> = pagesOf([
        setupHealthLink(),
        ...guidedSetupLinks(),
      ]);

      cleanup();
      readerLanguage = "de";
      readerWords = DE;
      await openNotYet();

      expect(
        screen.getByRole("link", { name: DE[OPEN_SETUP_HEALTH] as string }),
      ).toBe(setupHealthLink());
      expect(wordsOf([setupHealthLink()])).toEqual([DE[OPEN_SETUP_HEALTH]]);
      expect(wordsOf(guidedSetupLinks())).toEqual(
        GUIDED_SETUP_TITLES.map((title: string): string => {
          return DE[title] as string;
        }),
      );

      for (const title of GUIDED_SETUP_TITLES) {
        expect(
          screen.getByRole("link", { name: DE[title] as string }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: title })).toBeNull();
      }

      // The words change; the pages they open do not.
      expect(englishPages.every(Boolean)).toBe(true);
      expect(pagesOf([setupHealthLink(), ...guidedSetupLinks()])).toEqual(
        englishPages,
      );
    });

    test("a word the German locale lacks is a link in English, while the words around it stay German", async () => {
      readerLanguage = "de";
      readerWords = withoutWords(DE, [
        OPEN_SETUP_HEALTH,
        "Publish a status page",
      ]);
      await openNotYet();

      expect(wordsOf([setupHealthLink()])).toEqual([OPEN_SETUP_HEALTH]);
      expect(wordsOf(guidedSetupLinks())).toEqual([
        DE["Know when my website or API is down"],
        DE["Page the right person when something breaks"],
        "Publish a status page",
        DE["Send logs, metrics and traces, then get alerted"],
      ]);
      expect(
        screen.getByTestId(SETUP_CHECK_IN_SETUP_HEALTH_TEST_ID),
      ).toHaveTextContent(DE[SETUP_HEALTH_SENTENCE] as string);
      expect(
        screen.getByTestId(SETUP_CHECK_IN_SETUPS_TEST_ID),
      ).toHaveTextContent(DE[GUIDED_SETUPS_SENTENCE] as string);
    });

    test("a translateText that answers nothing for a link (its type allows it) leaves the link in English, never empty", async () => {
      readerLanguage = "de";
      readerWords = DE;
      wordsTranslateTextAnswersNothingFor = new Set<string>([
        OPEN_SETUP_HEALTH,
        ...GUIDED_SETUP_TITLES,
      ]);
      await openNotYet();

      expect(wordsOf([setupHealthLink()])).toEqual([OPEN_SETUP_HEALTH]);
      expect(wordsOf(guidedSetupLinks())).toEqual([...GUIDED_SETUP_TITLES]);

      for (const link of [setupHealthLink(), ...guidedSetupLinks()]) {
        expect((link.textContent || "").trim()).not.toBe("");
        expect(link.getAttribute("href")).toBeTruthy();
      }

      // The stand-in took only those words: the sentences are still German.
      expect(
        screen.getByTestId(SETUP_CHECK_IN_SETUP_HEALTH_TEST_ID),
      ).toHaveTextContent(DE[SETUP_HEALTH_SENTENCE] as string);
      expect(
        screen.getByTestId(SETUP_CHECK_IN_SETUPS_TEST_ID),
      ).toHaveTextContent(DE[GUIDED_SETUPS_SENTENCE] as string);
    });
  });
});

describe("the page an answer carries", () => {
  const ROUTES: Array<string> = [
    "/dashboard/:projectId/monitors",
    "/dashboard/:projectId/monitors/create",
    "/dashboard/:projectId/monitors/:id",
    "/dashboard/:projectId/monitors/:id/criteria",
  ];

  test("the pattern of the Dashboard route the address matched, never the address", () => {
    expect(
      getFeedbackPageFor(`/dashboard/${PROJECT_ID}/monitors`, ROUTES),
    ).toBe("/dashboard/:projectId/monitors");
    expect(
      getFeedbackPageFor(
        `/dashboard/${PROJECT_ID}/monitors/50000000-0000-4000-8000-000000000001/criteria?x=1`,
        ROUTES,
      ),
    ).toBe("/dashboard/:projectId/monitors/:id/criteria");
  });

  test("of the routes that match, the one with fewest parameters: create is not a monitor called create", () => {
    expect(
      getFeedbackPageFor(`/dashboard/${PROJECT_ID}/monitors/create`, ROUTES),
    ).toBe("/dashboard/:projectId/monitors/create");
  });

  test("an address no route matches is scrubbed of every id", () => {
    expect(
      getFeedbackPageFor(`/dashboard/${PROJECT_ID}/unknown/42`, ROUTES),
    ).toBe("/dashboard/:id/unknown/:id");
  });

  test("the real Dashboard routes name the guided setup's page", () => {
    expect(getFeedbackPageFor(`/dashboard/${PROJECT_ID}/monitors/setup`)).toBe(
      "/dashboard/:projectId/monitors/setup",
    );
  });

  test("the GitHub issue a self-hosted person may send holds their words, the page and the version", () => {
    const url: URL = new URL(
      getFeedbackGitHubIssueUrl({
        details: "Could not find the importer.\nSecond line.",
        page: "/dashboard/:projectId/home",
        version: "14.0.108",
      }),
    );

    expect(url.searchParams.get("title")).toBe(
      "Feedback: Could not find the importer.",
    );
    expect(url.searchParams.get("body")).toBe(
      "Could not find the importer.\nSecond line.\n\nPage: /dashboard/:projectId/home\nVersion: 14.0.108\n",
    );
    expect(url.searchParams.get("labels")).toBe("feedback");
  });
});
