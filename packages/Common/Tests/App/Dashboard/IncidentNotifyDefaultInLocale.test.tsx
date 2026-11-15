import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * #7606 IN EVERY LANGUAGE THE DASHBOARD SPEAKS.
 *
 * Incidents -> Settings -> Subscriber Notifications, the question under
 * Declare New Incident's "Notify Status Page Subscribers" box in a project
 * that starts it unticked, and the review's "Change to Yes" are keys of the
 * Dashboard's locales. Read from the locale files themselves:
 *
 *   - every one is worded in every language, its own way (none is kept as
 *     the English), and English maps each to itself;
 *   - a sentence that names the box names it as that language's form does,
 *     so a reader finds the box the sentence talks about;
 *   - the unticked question is the box's own question, word for word, with
 *     one sentence more - nobody used to the question reads a new one;
 *   - "Change to Yes" holds the language's own "Yes", the answer the
 *     review's pill then shows.
 *
 * And drawn for real, in German and in Arabic: the settings page, and
 * Declare New Incident walked to its review, where "Change to Yes" is
 * pressed - with no English sentence of these left on the page.
 */

configure({ asyncUtilTimeout: 15000 });

// The words the hook reads; null is a unit test's English.
let activeWords: Record<string, string> | null = null;
let activeLanguage: string = "en";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          const word: string | undefined = activeWords?.[key];

          return word ?? options?.defaultValue ?? key;
        },
        i18n: { language: activeLanguage, resolvedLanguage: activeLanguage },
      };
    },
  };
});

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CRITICAL_ID: string = "22222222-2222-4222-8222-000000000001";
const CREATED_ID: string = "55555555-5555-4555-8555-000000000001";

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      create: async (): Promise<unknown> => {
        return { data: {} };
      },
    },
  };
});

// The "Will notify" audience: not what these tests are about.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async (): Promise<never> => {
        return new Promise<never>(() => {});
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: { new (id: string): unknown } = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: { new (id: string): unknown };
          }
        ).default;
        return new ObjectIDClass("11111111-1111-4111-8111-111111111111");
      },
      // No plan: a self-hosted server, where no switch waits on one.
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import IncidentSubscriberNotificationsSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentSubscriberNotificationsSettings";
import {
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY,
  NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID,
  NOTIFY_BOX_DESCRIPTION,
  NOTIFY_BOX_DESCRIPTION_UNTICKED_BY_DEFAULT,
  NOTIFY_REVIEW_CHANGE_TO_YES,
  NOTIFY_REVIEW_CHANGE_TO_YES_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/NewIncidentNotifyDefaultCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import escapeRegExp from "../../../Utils/RegExpEscape";

const BOX: string = "Notify Status Page Subscribers";

// The keys this change added, by what the code looks them up with.
const NEW_KEYS: ReadonlyArray<string> = [
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardTitle,
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardDescription,
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchTitle,
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOnDescription,
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOffDescription,
  NOTIFY_BOX_DESCRIPTION_UNTICKED_BY_DEFAULT,
  NOTIFY_REVIEW_CHANGE_TO_YES,
];

// The sentences that name the box, as the form draws its name.
const NAMING_THE_BOX: ReadonlyArray<string> = [
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardDescription,
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOnDescription,
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOffDescription,
];

// What they borrow, each a key already: the box, its question, the pill.
const BORROWED: ReadonlyArray<string> = [
  BOX,
  NOTIFY_BOX_DESCRIPTION,
  "Yes",
  "No",
];

const DASHBOARD_I18N_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/i18n",
);

function readJson<T>(...parts: Array<string>): T {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_I18N_DIR, ...parts), "utf8"),
  ) as T;
}

// Whether a language's file holds the English itself for a key.
function keptTheEnglish(language: string, key: string): boolean {
  return readDashboardLocale(language)[key] === key;
}

function word(language: string, key: string): string {
  const text: string | undefined = readDashboardLocale(language)[key];

  expect({ language, key, worded: Boolean(text) }).toEqual({
    language,
    key,
    worded: true,
  });

  return text as string;
}

describe("the keys", () => {
  test("there is something to check: the 7 keys this change added", () => {
    expect(NEW_KEYS).toHaveLength(7);
    expect(new Set(NEW_KEYS).size).toBe(7);
    expect(NOTIFY_REVIEW_CHANGE_TO_YES).toBe("Change to Yes");
  });

  test.each([...NEW_KEYS, ...BORROWED])(
    "English maps %s to itself",
    (key: string) => {
      expect(readDashboardLocale("en")[key]).toBe(key);
    },
  );

  test("none is English a language keeps on purpose: every language words it", () => {
    const kept: Array<string> = readJson<Array<string>>("SameAsEnglish.json");

    for (const language of DASHBOARD_LANGUAGES) {
      kept.push(
        ...(
          readJson<{ sameAsEnglish?: Array<string> }>(
            "Progress",
            `${language}.json`,
          ).sameAsEnglish || []
        ).map((english: string): string => {
          return `${language}: ${english}`;
        }),
      );
    }

    for (const key of NEW_KEYS) {
      expect(
        kept.filter((entry: string): boolean => {
          return entry === key || entry.endsWith(`: ${key}`);
        }),
      ).toEqual([]);
    }
  });
});

describe.each([...DASHBOARD_LANGUAGES])("the %s locale", (language: string) => {
  test.each([...NEW_KEYS])(
    "words %s its own way, with the same placeholders",
    (key: string) => {
      const text: string = word(language, key);

      expect(isWordedInDashboardLocale(key, language)).toBe(true);
      expect({ key, keptTheEnglish: keptTheEnglish(language, key) }).toEqual({
        key,
        keptTheEnglish: false,
      });
      expect(placeholdersOf(text)).toEqual(placeholdersOf(key));
    },
  );

  test("each sentence that names the box names it as the form does", () => {
    const box: string = word(language, BOX);

    for (const key of NAMING_THE_BOX) {
      expect({ key, text: word(language, key) }).toEqual({
        key,
        text: expect.stringContaining(box),
      });
    }
  });

  test("the unticked question is the box's own question, word for word, and one sentence more", () => {
    const question: string = word(language, NOTIFY_BOX_DESCRIPTION);
    const unticked: string = word(
      language,
      NOTIFY_BOX_DESCRIPTION_UNTICKED_BY_DEFAULT,
    );

    expect(unticked.startsWith(question)).toBe(true);
    expect(unticked.slice(question.length).trim().length).toBeGreaterThan(0);
  });

  test("Change to Yes holds the language's own Yes, the answer the pill then shows, and not its No", () => {
    const changeToYes: string = word(language, NOTIFY_REVIEW_CHANGE_TO_YES);

    expect(changeToYes).toContain(word(language, "Yes"));
    expect(changeToYes.includes(word(language, "No"))).toBe(
      // A language whose No is part of its Yes (none, today) is let be.
      word(language, "Yes").includes(word(language, "No")),
    );
  });
});

describe("the checks catch what they are for", () => {
  test("English itself keeps the English: a language that kept it would fail", () => {
    for (const key of NEW_KEYS) {
      expect({ key, kept: keptTheEnglish("en", key) }).toEqual({
        key,
        kept: true,
      });
    }
  });

  test("a key no locale holds is worded in none", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect(
        isWordedInDashboardLocale(
          "Change to Yes, as no locale words it",
          language,
        ),
      ).toBe(false);
    }
  });

  test("a sentence naming the box another language's way is caught", () => {
    expect(
      word("de", NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOffDescription),
    ).not.toContain(word("fr", BOX));
  });
});

/*
 * Drawn for real: the hook reads the language's own file, as the Dashboard
 * does, and the page is walked by the words it shows in that language.
 */

function speak(language: string): void {
  activeLanguage = language;
  activeWords = language === "en" ? null : readDashboardLocale(language);
}

// Every English sentence of this change: none is left on the page.
function englishLeft(): Array<string> {
  const text: string = document.body.textContent || "";

  return [...NEW_KEYS, NOTIFY_BOX_DESCRIPTION, BOX].filter(
    (english: string): boolean => {
      return text.includes(english);
    },
  );
}

function startingWithText(text: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}`);
}

let projectSetting: boolean = false;

function listOf(data: Array<BaseModel>): unknown {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

beforeEach(() => {
  projectSetting = false;
  getListMock.mockReset().mockImplementation((async (request: {
    modelType: unknown;
  }): Promise<unknown> => {
    if (request.modelType === IncidentSeverity) {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = CRITICAL_ID;
      severity.name = "Critical Incident";
      severity.order = 1;
      return listOf([severity]);
    }

    return listOf([]);
  }) as never);
  getItemMock.mockReset().mockImplementation((async (request: {
    modelType: unknown;
  }): Promise<unknown> => {
    if (request.modelType === Project) {
      const project: Project = new Project();
      project._id = PROJECT_ID;
      project.notifyStatusPageSubscribersOfNewIncidentsByDefault =
        projectSetting;
      return project;
    }

    return null;
  }) as never);
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    data.model._id = CREATED_ID;
    return Promise.resolve({ data: data.model });
  }) as never);

  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue(null);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  speak("en");
});

describe.each(["de", "ar"])("drawn in %s", (language: string) => {
  test("Incidents > Settings > Subscriber Notifications says it all in the language", async () => {
    speak(language);
    projectSetting = true;

    render(
      <MemoryRouter>
        <IncidentSubscriberNotificationsSettings
          pageRoute={new Route("/dashboard/incidents/settings")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );

    const control: HTMLElement = await screen.findByTestId(
      NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID,
    );

    expect(
      screen.getByText(
        word(language, NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardTitle),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        word(
          language,
          NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardDescription,
        ),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: word(
          language,
          NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchTitle,
        ),
      }),
    ).toBe(control);
    expect(
      screen.getByTestId(`${NEW_INCIDENT_NOTIFY_DEFAULT_SWITCH_TEST_ID}-row`),
    ).toHaveTextContent(
      word(
        language,
        NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOnDescription,
      ),
    );
    expect(englishLeft()).toEqual([]);
  });

  test("Declare New Incident, in a project that starts the box unticked: its question, the review's No and Change to Yes, all in the language", async () => {
    speak(language);
    projectSetting = false;

    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <IncidentCreate
            pageRoute={new Route("/dashboard/incidents/create")}
            currentProject={new Project()}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });

    const user: UserEvent = userEvent.setup({ delay: null });
    const next: () => Promise<void> = async (): Promise<void> => {
      await user.click(
        screen.getByRole("button", {
          name: word(language, "Next"),
          exact: true,
        }),
      );
    };

    // The first step, by its words in the language.
    await user.type(
      await screen.findByRole("textbox", {
        name: startingWithText(word(language, "Title")),
      }),
      "Checkout is down",
    );
    await user.click(
      screen.getByRole("combobox", {
        name: startingWithText(word(language, "Incident Severity")),
      }),
    );
    const options: Array<HTMLElement> = await screen.findAllByText(
      "Critical Incident",
      { exact: true },
    );
    await user.click(options[options.length - 1]!);
    await next();

    // Resources Affected: the box, folded, unticked, its question saying so.
    await user.click(
      await screen.findByRole("button", {
        name: word(language, "More fields"),
      }),
    );
    const box: HTMLElement = await screen.findByRole("checkbox", {
      name: new RegExp(escapeRegExp(word(language, BOX))),
    });
    expect(box).not.toBeChecked();
    expect(
      screen.getAllByText(
        word(language, NOTIFY_BOX_DESCRIPTION_UNTICKED_BY_DEFAULT),
      ).length,
    ).toBeGreaterThan(0);

    // On to the review.
    await next();
    await next();
    await screen.findByRole("button", {
      name: word(language, "Declare Incident"),
    });

    const pill: HTMLElement = screen.getByTestId(
      "incident-create-notify-subscribers-value",
    );
    expect(pill).toHaveTextContent(word(language, "No"));

    const changeToYes: HTMLElement = screen.getByRole("button", {
      name: word(language, NOTIFY_REVIEW_CHANGE_TO_YES),
    });
    expect(changeToYes).toHaveAttribute(
      "data-testid",
      NOTIFY_REVIEW_CHANGE_TO_YES_TEST_ID,
    );

    // The review row says the box's name and its question in the language.
    const line: HTMLElement = screen.getByTestId(
      "incident-create-notify-subscribers-line",
    );
    let row: HTMLElement | null = line.parentElement;
    while (row && !within(row).queryByText(word(language, BOX))) {
      row = row.parentElement;
    }
    expect(row).not.toBeNull();
    expect(row!).toHaveTextContent(
      word(language, NOTIFY_BOX_DESCRIPTION_UNTICKED_BY_DEFAULT),
    );
    expect(englishLeft()).toEqual([]);

    await user.click(changeToYes);

    await waitFor(() => {
      expect(
        screen.getByTestId("incident-create-notify-subscribers-value"),
      ).toHaveTextContent(word(language, "Yes"));
    });
    expect(
      screen.queryByRole("button", {
        name: word(language, NOTIFY_REVIEW_CHANGE_TO_YES),
      }),
    ).toBeNull();
    expect(englishLeft()).toEqual([]);

    // And the incident it declares tells its subscribers.
    await user.click(
      screen.getByRole("button", { name: word(language, "Declare Incident") }),
    );
    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (createOrUpdateMock.mock.calls[0]?.[0] as { model: Incident }).model
        .shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBe(true);
  });
});
