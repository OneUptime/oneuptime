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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ADMIN DASHBOARD > SETTINGS > DATA RETENTION: THE SERVER'S LIMITS ON
 * RESOLVED INCIDENTS AND ALERTS (issue #6941), RENDERED.
 *
 * The real cards, with the Admin Dashboard's real locale files (English,
 * and German where it says so), over the one GlobalConfig row and the
 * projects-reached count stood in for. What is pinned is what a master
 * admin sees and what is saved:
 *
 *   - both picks read the server's row: No limit and Never until someone
 *     picks, and what each means;
 *   - "Keep for at most": a limit where there was none, or a shorter one,
 *     asks first - what goes, that it can't be brought back, and how many
 *     projects it reaches, counted as the question opens (one, several,
 *     none, still counting, or not at all when it cannot be counted) - and
 *     saves only when confirmed; cancelled, the pick goes back; a longer
 *     limit, or No limit (null), saves at once;
 *   - once a limit is saved, both settings are read back: the server lowers
 *     a new project's length that is longer than the limit;
 *   - "New projects delete after": saves at once (null for Never), and the
 *     lengths longer than the limit are shown, locked, with why;
 *   - a refused save goes back with the server's reason;
 *   - in German; and on the page, before Monitor Log Retention.
 */

const mockGetItem: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();
const mockCountProjectsReached: MockFunction = getJestMockFunction();

/*
 * react-select blurs its input after a pick on a touch screen
 * (blurInputOnSelect, decided once as it loads), and jsdom reads as one.
 * These picks are a keyboard's on a desktop, where the input keeps the focus
 * a question hands back when it closes: so react-select loads as a desktop
 * browser loads it, and is otherwise itself.
 */
jest.mock("react-select", () => {
  const createEvent: Document["createEvent"] = document.createEvent;

  document.createEvent = ((type: string): Event => {
    if (type === "TouchEvent") {
      throw new Error("No touch screen here.");
    }

    return createEvent.call(document, type);
  }) as Document["createEvent"];

  try {
    return jest.requireActual("react-select");
  } finally {
    document.createEvent = createEvent;
  }
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getItem: (...args: Array<unknown>): unknown => {
          return mockGetItem(...args);
        },
        updateById: (...args: Array<unknown>): unknown => {
          return mockUpdateById(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/DataRetention/ResolvedRecordRetentionLimitsApi",
  () => {
    return {
      __esModule: true,
      countProjectsReached: (...args: Array<unknown>): unknown => {
        return mockCountProjectsReached(...args);
      },
    };
  },
);

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

// The page's other cards read and edit GlobalConfig themselves: their name is enough here.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { name?: string | undefined }): ReactElement => {
      return <section data-testid="card-model-detail">{props.name}</section>;
    },
  };
});

import DataRetentionSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/DataRetention/Index";
import ResolvedRecordRetentionLimitsCard from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/DataRetention/ResolvedRecordRetentionLimitsCard";
import ResolvedRecordRetentionLimitsCopy, {
  ALERT_RETENTION_LIMITS_COPY,
  INCIDENT_RETENTION_LIMITS_COPY,
  RESOLVED_RECORD_RETENTION_DEFAULT_TEST_ID,
  RESOLVED_RECORD_RETENTION_LIMITS_CARD_TEST_ID,
  RESOLVED_RECORD_RETENTION_MAXIMUM_TEST_ID,
  RESOLVED_RECORD_RETENTION_REACH_TEST_ID,
  ResolvedRecordRetentionLimitsKindCopy,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/DataRetention/ResolvedRecordRetentionLimitsCopy";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ResolvedRecordKind } from "../../../Types/Retention/ResolvedRecordRetention";
import { withPlainSpaces } from "../../../Types/NoBreakSpaces";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

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
const GERMAN: Locale = readLocale("de");

// A German entry, which must be there.
function german(key: string): string {
  const value: unknown = GERMAN[key];

  if (typeof value !== "string") {
    throw new Error(`No German entry for ${key}`);
  }

  return value;
}

const MAXIMUM: string = RESOLVED_RECORD_RETENTION_MAXIMUM_TEST_ID;
const DEFAULT: string = RESOLVED_RECORD_RETENTION_DEFAULT_TEST_ID;

/*
 * The one GlobalConfig row, as the server holds it: undefined for a column
 * never written, null for one written empty.
 */
let stored: Record<string, number | null | undefined> = {};

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: JSONObject;
}

function updateCalls(): Array<UpdateCall> {
  return mockUpdateById.mock.calls.map((call: Array<unknown>): UpdateCall => {
    return call[0] as UpdateCall;
  });
}

function savedData(): Array<JSONObject> {
  return updateCalls().map((call: UpdateCall): JSONObject => {
    return call.data;
  });
}

/*
 * The server's rule for a write that sets a maximum alone
 * (GlobalConfigService.applyResolvedRecordRetentionLimitRules): a stored
 * default longer than the new maximum is lowered to it.
 */
function writeAsTheServerDoes(data: JSONObject): void {
  const pairs: Array<[string, string]> = [
    ["maxIncidentRetentionInDays", "defaultIncidentRetentionInDays"],
    ["maxAlertRetentionInDays", "defaultAlertRetentionInDays"],
  ];

  for (const [maximumColumn, defaultColumn] of pairs) {
    if (data[maximumColumn] !== undefined) {
      stored[maximumColumn] = data[maximumColumn] as number | null;

      const maximum: number | null | undefined = stored[maximumColumn];
      const defaultValue: number | null | undefined = stored[defaultColumn];

      if (
        data[defaultColumn] === undefined &&
        typeof maximum === "number" &&
        typeof defaultValue === "number" &&
        defaultValue > maximum
      ) {
        stored[defaultColumn] = maximum;
      }
    }

    if (data[defaultColumn] !== undefined) {
      stored[defaultColumn] = data[defaultColumn] as number | null;
    }
  }
}

function storedConfig(select: Record<string, unknown>): GlobalConfig {
  const config: GlobalConfig = new GlobalConfig();
  config.id = ObjectID.getZeroObjectID();

  for (const column of Object.keys(select)) {
    const value: number | null | undefined = stored[column];

    if (value !== undefined) {
      (config as unknown as Record<string, unknown>)[column] = value;
    }
  }

  return config;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function instanceFor(language: string): Promise<i18n> {
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

  return instance;
}

async function renderWith(
  element: ReactElement,
  language: string = "en",
): Promise<void> {
  const instance: i18n = await instanceFor(language);

  await act(async () => {
    render(
      <I18nextProvider i18n={instance}>
        <MemoryRouter>{element}</MemoryRouter>
      </I18nextProvider>,
    );
  });
  await flush();
}

async function renderCard(
  copy: ResolvedRecordRetentionLimitsKindCopy = INCIDENT_RETENTION_LIMITS_COPY,
  language: string = "en",
): Promise<void> {
  await renderWith(<ResolvedRecordRetentionLimitsCard copy={copy} />, language);
  await screen.findByTestId(MAXIMUM);
}

// Words as a reader reads them: no isolate marks, no held spaces.
function readable(text: string | null | undefined): string {
  return withPlainSpaces(withoutIsolateMarks(text || ""));
}

// What a pick shows.
function picked(testId: string): string {
  return readable(
    within(screen.getByTestId(testId)).queryByTestId("dropdown-value-label")
      ?.textContent,
  );
}

function description(testId: string): string {
  return readable(screen.getByTestId(`${testId}-description`).textContent);
}

function saveStatus(testId: string): string {
  return readable(screen.getByTestId(`${testId}-status`).textContent);
}

function pickControl(testId: string): HTMLElement {
  return within(screen.getByTestId(testId)).getByRole("combobox");
}

async function openPick(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(pickControl(testId));
    fireEvent.keyDown(pickControl(testId), { key: "ArrowDown", keyCode: 40 });
  });
}

async function shownOptions(testId: string): Promise<Array<HTMLElement>> {
  await openPick(testId);

  return screen.findAllByRole("option");
}

async function optionTexts(testId: string): Promise<Array<string>> {
  return (await shownOptions(testId)).map((option: HTMLElement): string => {
    return readable(
      within(option).queryByTestId("dropdown-option-label")?.textContent ||
        option.textContent,
    );
  });
}

async function pick(testId: string, optionText: string): Promise<void> {
  const option: HTMLElement | undefined = (await shownOptions(testId)).find(
    (candidate: HTMLElement): boolean => {
      return (
        readable(
          within(candidate).queryByTestId("dropdown-option-label")?.textContent,
        ) === optionText
      );
    },
  );

  if (!option) {
    throw new Error(`No option ${optionText}`);
  }

  await act(async () => {
    fireEvent.click(option);
  });
  await flush();
}

function dialog(): HTMLElement | null {
  return screen.queryByRole("dialog");
}

function dialogText(): string {
  return readable(dialog()?.textContent);
}

function reachLine(): string | null {
  const line: HTMLElement | null = screen.queryByTestId(
    RESOLVED_RECORD_RETENTION_REACH_TEST_ID,
  );

  return line ? readable(line.textContent) : null;
}

async function pressInDialog(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog()!).getByRole("button", { name }));
  });
  await flush();
}

// A count the test answers when it chooses.
function deferredCount(): {
  resolve: (count: number | null) => void;
} {
  let resolve: (count: number | null) => void = (): void => {
    // Replaced below.
  };

  mockCountProjectsReached.mockImplementationOnce((): Promise<unknown> => {
    return new Promise<unknown>((done: (value: unknown) => void) => {
      resolve = done;
    });
  });

  return {
    resolve: (count: number | null): void => {
      resolve(count);
    },
  };
}

const INCIDENT_COLUMNS: Record<string, true> = {
  maxIncidentRetentionInDays: true,
  defaultIncidentRetentionInDays: true,
};

beforeEach(() => {
  stored = {};
  mockGetItem.mockReset();
  mockUpdateById.mockReset();
  mockCountProjectsReached.mockReset();

  mockGetItem.mockImplementation(
    async (data: unknown): Promise<GlobalConfig> => {
      return storedConfig((data as { select: Record<string, unknown> }).select);
    },
  );
  mockUpdateById.mockImplementation(
    async (data: unknown): Promise<undefined> => {
      writeAsTheServerDoes((data as UpdateCall).data);
      return undefined;
    },
  );
  mockCountProjectsReached.mockImplementation(
    async (): Promise<number | null> => {
      return 12;
    },
  );
});

afterEach(() => {
  cleanup();
});

describe("Resolved Incidents: what the server holds", () => {
  test("reads both settings from the server's one row: No limit and Never, where every server starts", async () => {
    await renderCard();

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockGetItem).toHaveBeenCalledWith({
      modelType: GlobalConfig,
      id: ObjectID.getZeroObjectID(),
      select: INCIDENT_COLUMNS,
    });
    expect(screen.getByText("Resolved Incidents")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Each project picks how long it keeps resolved incidents; you can hold every project to a limit and choose where new projects start.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        `${RESOLVED_RECORD_RETENTION_LIMITS_CARD_TEST_ID}-incident`,
      ),
    ).toBeInTheDocument();

    expect(picked(MAXIMUM)).toBe("No limit");
    expect(description(MAXIMUM)).toBe(
      "Each project keeps resolved incidents for as long as it chooses.",
    );
    expect(picked(DEFAULT)).toBe("Never");
    expect(description(DEFAULT)).toBe(
      "A new project keeps every resolved incident until its owners pick a length.",
    );
    // Nothing is written or counted by reading.
    expect(mockUpdateById).not.toHaveBeenCalled();
    expect(mockCountProjectsReached).not.toHaveBeenCalled();
  });

  test("each pick is named by its label", async () => {
    await renderCard();

    expect(screen.getByRole("combobox", { name: "Keep for at most" })).toBe(
      pickControl(MAXIMUM),
    );
    expect(
      screen.getByRole("combobox", { name: "New projects delete after" }),
    ).toBe(pickControl(DEFAULT));
  });

  test("reads a stored limit and length, and says what each means", async () => {
    stored = {
      maxIncidentRetentionInDays: 365,
      defaultIncidentRetentionInDays: 90,
    };

    await renderCard();

    expect(picked(MAXIMUM)).toBe("1 year");
    expect(description(MAXIMUM)).toBe(
      "No project keeps a resolved incident longer than 1 year, even one set to Never, except incidents it keeps for a completed postmortem.",
    );
    expect(picked(DEFAULT)).toBe("90 days");
    expect(description(DEFAULT)).toBe(
      "A new project deletes resolved incidents after 90 days until its owners change it. Projects that exist keep their own.",
    );
  });

  test("a limit in days is said in days", async () => {
    stored = { maxIncidentRetentionInDays: 60 };

    await renderCard();

    expect(picked(MAXIMUM)).toBe("60 days");
    expect(description(MAXIMUM)).toBe(
      "No project keeps a resolved incident longer than 60 days, even one set to Never, except incidents it keeps for a completed postmortem.",
    );
  });

  test("an empty row, or a value that is no choice, reads as No limit and Never", async () => {
    stored = {
      maxIncidentRetentionInDays: null,
      defaultIncidentRetentionInDays: 45,
    };

    await renderCard();

    expect(picked(MAXIMUM)).toBe("No limit");
    expect(picked(DEFAULT)).toBe("Never");
  });

  test("a server with no row yet reads as No limit and Never", async () => {
    mockGetItem.mockImplementation(async (): Promise<null> => {
      return null;
    });

    await renderCard();

    expect(picked(MAXIMUM)).toBe("No limit");
    expect(picked(DEFAULT)).toBe("Never");
  });

  test("Never under a limit says the limit holds a new project", async () => {
    stored = { maxIncidentRetentionInDays: 365 };

    await renderCard();

    expect(picked(DEFAULT)).toBe("Never");
    expect(description(DEFAULT)).toBe(
      "A new project starts at Never and is held to the limit above until its owners pick a length.",
    );
  });

  test("a failed read says why, and Try again reads again", async () => {
    mockGetItem.mockImplementationOnce(async (): Promise<never> => {
      throw new HTTPErrorResponse(
        403,
        { message: "Only master admins can read the server's settings." },
        {},
      );
    });

    await renderWith(
      <ResolvedRecordRetentionLimitsCard
        copy={INCIDENT_RETENTION_LIMITS_COPY}
      />,
    );

    expect(
      await screen.findByText(
        "Only master admins can read the server's settings.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(MAXIMUM)).toBeNull();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Try again|Refresh/i }),
      );
    });
    await flush();

    expect(await screen.findByTestId(MAXIMUM)).toBeInTheDocument();
    expect(mockGetItem).toHaveBeenCalledTimes(2);
  });
});

describe("Resolved Incidents: the choices", () => {
  test("Keep for at most offers No limit first, then a month to three years", async () => {
    await renderCard();

    expect(await optionTexts(MAXIMUM)).toEqual([
      "No limit",
      "30 days",
      "60 days",
      "90 days",
      "180 days",
      "1 year",
      "2 years",
      "3 years",
    ]);
  });

  test("New projects delete after offers Never first, then the same lengths, every one open while there is no limit", async () => {
    await renderCard();

    const options: Array<HTMLElement> = await shownOptions(DEFAULT);

    expect(
      options.map((option: HTMLElement): string => {
        return readable(
          within(option).queryByTestId("dropdown-option-label")?.textContent,
        );
      }),
    ).toEqual([
      "Never",
      "30 days",
      "60 days",
      "90 days",
      "180 days",
      "1 year",
      "2 years",
      "3 years",
    ]);

    for (const option of options) {
      expect(option).not.toHaveAttribute("aria-disabled", "true");
    }

    expect(screen.queryAllByTestId("dropdown-option-description")).toEqual([]);
  });

  test("the lengths longer than the limit are shown, locked, with why", async () => {
    stored = { maxIncidentRetentionInDays: 90 };

    await renderCard();

    const options: Array<HTMLElement> = await shownOptions(DEFAULT);
    const locked: Array<string> = [];
    const open: Array<string> = [];

    for (const option of options) {
      const label: string = readable(
        within(option).queryByTestId("dropdown-option-label")?.textContent,
      );

      if (option.getAttribute("aria-disabled") === "true") {
        locked.push(label);
        expect(
          readable(
            within(option).getByTestId("dropdown-option-description")
              .textContent,
          ),
        ).toBe("Longer than the limit above.");
      } else {
        open.push(label);
        expect(
          within(option).queryByTestId("dropdown-option-description"),
        ).toBeNull();
      }
    }

    expect(open).toEqual(["Never", "30 days", "60 days", "90 days"]);
    expect(locked).toEqual(["180 days", "1 year", "2 years", "3 years"]);
  });

  test("a locked length cannot be picked: nothing is saved", async () => {
    stored = { maxIncidentRetentionInDays: 90 };

    await renderCard();

    const lockedOption: HTMLElement | undefined = (
      await shownOptions(DEFAULT)
    ).find((option: HTMLElement): boolean => {
      return option.getAttribute("aria-disabled") === "true";
    });

    await act(async () => {
      fireEvent.click(lockedOption!);
    });
    await flush();

    expect(mockUpdateById).not.toHaveBeenCalled();
    expect(picked(DEFAULT)).toBe("Never");
  });
});

describe("Resolved Incidents: Keep for at most", () => {
  test("a limit where there was none asks first, with what goes and how many projects it reaches, and saves nothing until confirmed", async () => {
    await renderCard();
    await pick(MAXIMUM, "1 year");

    expect(dialog()).not.toBeNull();
    expect(dialogText()).toContain(
      "Limit how long projects keep resolved incidents?",
    );
    expect(dialogText()).toContain(
      "Every project deletes resolved incidents older than 1 year within the hour, with their timeline, notes and logs. They can't be brought back.",
    );
    expect(mockCountProjectsReached).toHaveBeenCalledTimes(1);
    expect(mockCountProjectsReached).toHaveBeenCalledWith({
      kind: ResolvedRecordKind.Incident,
      maximumInDays: 365,
    });
    await waitFor(() => {
      expect(reachLine()).toBe("This reaches 12 projects.");
    });
    expect(mockUpdateById).not.toHaveBeenCalled();
    // The question is asked over what the server still has.
    expect(description(MAXIMUM)).toBe(
      "Each project keeps resolved incidents for as long as it chooses.",
    );

    await pressInDialog("Limit Projects");

    expect(dialog()).toBeNull();
    expect(updateCalls()).toEqual([
      {
        modelType: GlobalConfig,
        id: ObjectID.getZeroObjectID(),
        data: { maxIncidentRetentionInDays: 365 },
      },
    ]);
    await waitFor(() => {
      expect(saveStatus(MAXIMUM)).toBe("Saved");
    });
    expect(picked(MAXIMUM)).toBe("1 year");
    expect(description(MAXIMUM)).toBe(
      "No project keeps a resolved incident longer than 1 year, even one set to Never, except incidents it keeps for a completed postmortem.",
    );
  });

  test("the question's button is the danger one, beside a plain Cancel", async () => {
    await renderCard();
    await pick(MAXIMUM, "30 days");

    const limit: HTMLElement = within(dialog()!).getByRole("button", {
      name: "Limit Projects",
    });

    expect(limit.className).toMatch(/red/);
    expect(
      within(dialog()!).getByRole("button", { name: "Cancel" }).className,
    ).not.toMatch(/red/);
  });

  test("a limit in days is said in days in the question", async () => {
    await renderCard();
    await pick(MAXIMUM, "90 days");

    expect(dialogText()).toContain(
      "Every project deletes resolved incidents older than 90 days within the hour, with their timeline, notes and logs. They can't be brought back.",
    );
    expect(mockCountProjectsReached).toHaveBeenCalledWith({
      kind: ResolvedRecordKind.Incident,
      maximumInDays: 90,
    });

    await pressInDialog("Limit Projects");

    expect(savedData()).toEqual([{ maxIncidentRetentionInDays: 90 }]);
  });

  test("one project reached is said in the singular", async () => {
    mockCountProjectsReached.mockImplementation(async (): Promise<number> => {
      return 1;
    });

    await renderCard();
    await pick(MAXIMUM, "2 years");

    await waitFor(() => {
      expect(reachLine()).toBe("This reaches 1 project.");
    });
  });

  test("a count in the thousands is written as the reader writes numbers", async () => {
    mockCountProjectsReached.mockImplementation(async (): Promise<number> => {
      return 1234;
    });

    await renderCard();
    await pick(MAXIMUM, "2 years");

    await waitFor(() => {
      expect(reachLine()).toBe("This reaches 1,234 projects.");
    });
  });

  test("when no project keeps them longer, it says nothing more is deleted", async () => {
    mockCountProjectsReached.mockImplementation(async (): Promise<number> => {
      return 0;
    });

    await renderCard();
    await pick(MAXIMUM, "3 years");

    await waitFor(() => {
      expect(reachLine()).toBe(
        "No project keeps them longer, so nothing more is deleted now.",
      );
    });
  });

  test("while the projects are counted, the question says so, then says the count", async () => {
    const count: { resolve: (count: number | null) => void } = deferredCount();

    await renderCard();
    await pick(MAXIMUM, "180 days");

    expect(reachLine()).toBe("Counting the projects this reaches…");

    await act(async () => {
      count.resolve(7);
    });
    await flush();

    expect(reachLine()).toBe("This reaches 7 projects.");
  });

  test("a count that cannot be had leaves the line out, and the question still saves", async () => {
    mockCountProjectsReached.mockImplementation(async (): Promise<null> => {
      return null;
    });

    await renderCard();
    await pick(MAXIMUM, "30 days");
    await flush();

    expect(dialog()).not.toBeNull();
    expect(reachLine()).toBeNull();
    expect(dialogText()).not.toContain("This reaches");
    expect(dialogText()).not.toContain("Counting");

    await pressInDialog("Limit Projects");

    expect(savedData()).toEqual([{ maxIncidentRetentionInDays: 30 }]);
  });

  test("a count that fails outright leaves the line out too", async () => {
    mockCountProjectsReached.mockImplementation(async (): Promise<never> => {
      throw new Error("Network error");
    });

    await renderCard();
    await pick(MAXIMUM, "30 days");
    await flush();

    expect(dialog()).not.toBeNull();
    expect(reachLine()).toBeNull();
  });

  test("cancelled, nothing is saved and the pick goes back", async () => {
    await renderCard();
    await pick(MAXIMUM, "30 days");

    expect(dialog()).not.toBeNull();

    await pressInDialog("Cancel");

    expect(dialog()).toBeNull();
    expect(mockUpdateById).not.toHaveBeenCalled();
    expect(picked(MAXIMUM)).toBe("No limit");
    expect(description(MAXIMUM)).toBe(
      "Each project keeps resolved incidents for as long as it chooses.",
    );
  });

  test("cancelled, the keyboard is back on the pick it left", async () => {
    await renderCard();

    await act(async () => {
      pickControl(MAXIMUM).focus();
    });

    expect(document.activeElement).toBe(pickControl(MAXIMUM));

    await pick(MAXIMUM, "30 days");

    expect(dialog()).not.toBeNull();

    await pressInDialog("Cancel");

    expect(dialog()).toBeNull();
    expect(picked(MAXIMUM)).toBe("No limit");
    expect(document.activeElement).toBe(pickControl(MAXIMUM));
  });

  test("a count that arrives after the question is cancelled is not shown on the next one", async () => {
    const late: { resolve: (count: number | null) => void } = deferredCount();

    await renderCard();
    await pick(MAXIMUM, "30 days");
    await pressInDialog("Cancel");

    mockCountProjectsReached.mockImplementationOnce((): Promise<unknown> => {
      return new Promise<unknown>(() => {
        // Never answers.
      });
    });

    await pick(MAXIMUM, "60 days");

    await act(async () => {
      late.resolve(99);
    });
    await flush();

    expect(reachLine()).toBe("Counting the projects this reaches…");
  });

  test("a shorter limit asks first", async () => {
    stored = { maxIncidentRetentionInDays: 365 };

    await renderCard();
    await pick(MAXIMUM, "90 days");

    expect(dialogText()).toContain(
      "Every project deletes resolved incidents older than 90 days within the hour",
    );
    expect(mockUpdateById).not.toHaveBeenCalled();

    await pressInDialog("Limit Projects");

    expect(savedData()).toEqual([{ maxIncidentRetentionInDays: 90 }]);
  });

  test("a longer limit deletes nothing more, so it saves at once", async () => {
    stored = { maxIncidentRetentionInDays: 90 };

    await renderCard();
    await pick(MAXIMUM, "1 year");

    expect(dialog()).toBeNull();
    expect(mockCountProjectsReached).not.toHaveBeenCalled();
    expect(savedData()).toEqual([{ maxIncidentRetentionInDays: 365 }]);
    expect(picked(MAXIMUM)).toBe("1 year");
  });

  test("No limit saves at once, as empty", async () => {
    stored = { maxIncidentRetentionInDays: 365 };

    await renderCard();
    await pick(MAXIMUM, "No limit");

    expect(dialog()).toBeNull();
    expect(savedData()).toEqual([{ maxIncidentRetentionInDays: null }]);
    expect(description(MAXIMUM)).toBe(
      "Each project keeps resolved incidents for as long as it chooses.",
    );
  });

  test("the limit it already has sends nothing", async () => {
    stored = { maxIncidentRetentionInDays: 365 };

    await renderCard();
    await pick(MAXIMUM, "1 year");

    expect(dialog()).toBeNull();
    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  test("Saving… while the limit is on its way, then Saved", async () => {
    stored = { maxIncidentRetentionInDays: 90 };

    let finish: () => void = (): void => {
      // Replaced below.
    };

    mockUpdateById.mockImplementationOnce(
      (data: unknown): Promise<undefined> => {
        return new Promise<undefined>((done: (value: undefined) => void) => {
          finish = (): void => {
            writeAsTheServerDoes((data as UpdateCall).data);
            done(undefined);
          };
        });
      },
    );

    await renderCard();
    await pick(MAXIMUM, "2 years");

    expect(saveStatus(MAXIMUM)).toBe("Saving…");

    await act(async () => {
      finish();
    });
    await flush();

    expect(saveStatus(MAXIMUM)).toBe("Saved");
  });

  test("a limit the server refuses goes back to what it has, with the reason", async () => {
    stored = { maxIncidentRetentionInDays: 90 };
    mockUpdateById.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(
        400,
        {
          message:
            "Pick the longest a project keeps a resolved incident: 30, 60, 90, 180, 365, 730 or 1095 days, or leave it empty for no maximum.",
        },
        {},
      );
    });

    await renderCard();
    await pick(MAXIMUM, "1 year");

    await waitFor(() => {
      expect(
        readable(screen.getByTestId(`${MAXIMUM}-error`).textContent),
      ).toContain(
        "Pick the longest a project keeps a resolved incident: 30, 60, 90, 180, 365, 730 or 1095 days, or leave it empty for no maximum.",
      );
    });
    expect(picked(MAXIMUM)).toBe("90 days");
    expect(saveStatus(MAXIMUM)).toBe("");
    expect(description(MAXIMUM)).toBe(
      "No project keeps a resolved incident longer than 90 days, even one set to Never, except incidents it keeps for a completed postmortem.",
    );
    // Nothing was saved, so nothing is read back.
    expect(mockGetItem).toHaveBeenCalledTimes(1);
  });

  test("a confirmed limit the server refuses goes back too", async () => {
    mockUpdateById.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(
        403,
        { message: "Only master admins can change the server's settings." },
        {},
      );
    });

    await renderCard();
    await pick(MAXIMUM, "30 days");
    await pressInDialog("Limit Projects");

    await waitFor(() => {
      expect(
        readable(screen.getByTestId(`${MAXIMUM}-error`).textContent),
      ).toContain("Only master admins can change the server's settings.");
    });
    expect(picked(MAXIMUM)).toBe("No limit");
  });
});

describe("Resolved Incidents: the limit and new projects together", () => {
  test("saving the limit reads both back, and shows the length the server lowered with it", async () => {
    stored = { defaultIncidentRetentionInDays: 365 };

    await renderCard();

    expect(picked(DEFAULT)).toBe("1 year");

    await pick(MAXIMUM, "90 days");
    await pressInDialog("Limit Projects");

    expect(savedData()).toEqual([{ maxIncidentRetentionInDays: 90 }]);
    await waitFor(() => {
      expect(mockGetItem).toHaveBeenCalledTimes(2);
    });
    expect(mockGetItem).toHaveBeenLastCalledWith({
      modelType: GlobalConfig,
      id: ObjectID.getZeroObjectID(),
      select: INCIDENT_COLUMNS,
    });
    await waitFor(() => {
      expect(picked(DEFAULT)).toBe("90 days");
    });
    expect(description(DEFAULT)).toBe(
      "A new project deletes resolved incidents after 90 days until its owners change it. Projects that exist keep their own.",
    );

    // And the longer lengths are locked now.
    const lockedLabels: Array<string> = (await shownOptions(DEFAULT))
      .filter((option: HTMLElement): boolean => {
        return option.getAttribute("aria-disabled") === "true";
      })
      .map((option: HTMLElement): string => {
        return readable(
          within(option).queryByTestId("dropdown-option-label")?.textContent,
        );
      });

    expect(lockedLabels).toEqual(["180 days", "1 year", "2 years", "3 years"]);
  });

  test("where they cannot be read back, the length is lowered as the server lowers it", async () => {
    stored = { defaultIncidentRetentionInDays: 730 };

    await renderCard();

    mockGetItem.mockImplementation(async (): Promise<never> => {
      throw new Error("Network error");
    });

    await pick(MAXIMUM, "1 year");
    await pressInDialog("Limit Projects");
    await flush();

    await waitFor(() => {
      expect(picked(DEFAULT)).toBe("1 year");
    });
  });

  test("a length within the new limit stays as it was", async () => {
    stored = { defaultIncidentRetentionInDays: 30 };

    await renderCard();
    await pick(MAXIMUM, "90 days");
    await pressInDialog("Limit Projects");

    await waitFor(() => {
      expect(mockGetItem).toHaveBeenCalledTimes(2);
    });
    expect(picked(DEFAULT)).toBe("30 days");
  });

  test("raising the limit opens the longer lengths for new projects", async () => {
    stored = { maxIncidentRetentionInDays: 90 };

    await renderCard();
    await pick(MAXIMUM, "1 year");

    await waitFor(() => {
      expect(mockGetItem).toHaveBeenCalledTimes(2);
    });

    const openLabels: Array<string> = (await shownOptions(DEFAULT))
      .filter((option: HTMLElement): boolean => {
        return option.getAttribute("aria-disabled") !== "true";
      })
      .map((option: HTMLElement): string => {
        return readable(
          within(option).queryByTestId("dropdown-option-label")?.textContent,
        );
      });

    expect(openLabels).toEqual([
      "Never",
      "30 days",
      "60 days",
      "90 days",
      "180 days",
      "1 year",
    ]);
  });

  test("removing the limit says Never keeps every resolved incident again", async () => {
    stored = { maxIncidentRetentionInDays: 90 };

    await renderCard();

    expect(description(DEFAULT)).toBe(
      "A new project starts at Never and is held to the limit above until its owners pick a length.",
    );

    await pick(MAXIMUM, "No limit");

    await waitFor(() => {
      expect(description(DEFAULT)).toBe(
        "A new project keeps every resolved incident until its owners pick a length.",
      );
    });
  });
});

describe("Resolved Incidents: New projects delete after", () => {
  test("a length saves at once, with no question: it changes no project that exists", async () => {
    await renderCard();
    await pick(DEFAULT, "30 days");

    expect(dialog()).toBeNull();
    expect(mockCountProjectsReached).not.toHaveBeenCalled();
    expect(updateCalls()).toEqual([
      {
        modelType: GlobalConfig,
        id: ObjectID.getZeroObjectID(),
        data: { defaultIncidentRetentionInDays: 30 },
      },
    ]);
    await waitFor(() => {
      expect(saveStatus(DEFAULT)).toBe("Saved");
    });
    expect(picked(DEFAULT)).toBe("30 days");
    expect(description(DEFAULT)).toBe(
      "A new project deletes resolved incidents after 30 days until its owners change it. Projects that exist keep their own.",
    );
    // A new project's length is not the limit's business: nothing is read back.
    expect(mockGetItem).toHaveBeenCalledTimes(1);
  });

  test("a length in whole years is said in years", async () => {
    await renderCard();
    await pick(DEFAULT, "2 years");

    expect(savedData()).toEqual([{ defaultIncidentRetentionInDays: 730 }]);
    expect(description(DEFAULT)).toBe(
      "A new project deletes resolved incidents after 2 years until its owners change it. Projects that exist keep their own.",
    );
  });

  test("Never saves at once, as empty", async () => {
    stored = { defaultIncidentRetentionInDays: 180 };

    await renderCard();
    await pick(DEFAULT, "Never");

    expect(dialog()).toBeNull();
    expect(savedData()).toEqual([{ defaultIncidentRetentionInDays: null }]);
    expect(description(DEFAULT)).toBe(
      "A new project keeps every resolved incident until its owners pick a length.",
    );
  });

  test("a length the server refuses goes back to what it has, with the reason", async () => {
    stored = { defaultIncidentRetentionInDays: 60 };
    mockUpdateById.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(
        400,
        {
          message:
            "A new project can keep a resolved incident for at most 90 days, the server's maximum. Pick that or less.",
        },
        {},
      );
    });

    await renderCard();
    await pick(DEFAULT, "180 days");

    await waitFor(() => {
      expect(
        readable(screen.getByTestId(`${DEFAULT}-error`).textContent),
      ).toContain(
        "A new project can keep a resolved incident for at most 90 days, the server's maximum. Pick that or less.",
      );
    });
    expect(picked(DEFAULT)).toBe("60 days");
    expect(saveStatus(DEFAULT)).toBe("");
  });

  test("refused, the keyboard stays on the pick", async () => {
    mockUpdateById.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(400, { message: "Not this time." }, {});
    });

    await renderCard();

    await act(async () => {
      pickControl(DEFAULT).focus();
    });
    await pick(DEFAULT, "90 days");

    await waitFor(() => {
      expect(screen.queryByTestId(`${DEFAULT}-error`)).not.toBeNull();
    });
    expect(picked(DEFAULT)).toBe("Never");
    expect(document.activeElement).toBe(pickControl(DEFAULT));
  });

  test("a pick after a refusal clears the reason", async () => {
    mockUpdateById.mockImplementationOnce(async (): Promise<never> => {
      throw new HTTPErrorResponse(400, { message: "Not this time." }, {});
    });

    await renderCard();
    await pick(DEFAULT, "90 days");

    await waitFor(() => {
      expect(screen.queryByTestId(`${DEFAULT}-error`)).not.toBeNull();
    });

    await pick(DEFAULT, "60 days");

    expect(screen.queryByTestId(`${DEFAULT}-error`)).toBeNull();
    expect(savedData()).toEqual([
      { defaultIncidentRetentionInDays: 90 },
      { defaultIncidentRetentionInDays: 60 },
    ]);
  });
});

describe("Resolved Alerts", () => {
  test("reads and writes the alerts' own columns, and says no word of postmortems", async () => {
    stored = { maxAlertRetentionInDays: 180, defaultAlertRetentionInDays: 30 };

    await renderCard(ALERT_RETENTION_LIMITS_COPY);

    expect(mockGetItem).toHaveBeenCalledWith({
      modelType: GlobalConfig,
      id: ObjectID.getZeroObjectID(),
      select: {
        maxAlertRetentionInDays: true,
        defaultAlertRetentionInDays: true,
      },
    });
    expect(screen.getByText("Resolved Alerts")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Each project picks how long it keeps resolved alerts; you can hold every project to a limit and choose where new projects start.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        `${RESOLVED_RECORD_RETENTION_LIMITS_CARD_TEST_ID}-alert`,
      ),
    ).toBeInTheDocument();
    expect(picked(MAXIMUM)).toBe("180 days");
    expect(description(MAXIMUM)).toBe(
      "No project keeps a resolved alert longer than 180 days, including projects set to Never.",
    );
    expect(picked(DEFAULT)).toBe("30 days");
    expect(description(DEFAULT)).toBe(
      "A new project deletes resolved alerts after 30 days until its owners change it. Projects that exist keep their own.",
    );

    await pick(MAXIMUM, "60 days");

    expect(dialogText()).toContain(
      "Limit how long projects keep resolved alerts?",
    );
    expect(dialogText()).toContain(
      "Every project deletes resolved alerts older than 60 days within the hour, with their timeline, notes and logs. They can't be brought back.",
    );
    expect(mockCountProjectsReached).toHaveBeenCalledWith({
      kind: ResolvedRecordKind.Alert,
      maximumInDays: 60,
    });

    await pressInDialog("Limit Projects");

    expect(savedData()).toEqual([{ maxAlertRetentionInDays: 60 }]);

    await pick(DEFAULT, "Never");

    expect(savedData()).toEqual([
      { maxAlertRetentionInDays: 60 },
      { defaultAlertRetentionInDays: null },
    ]);
  });

  test("with no limit and Never, says each project chooses and a new one keeps every resolved alert", async () => {
    await renderCard(ALERT_RETENTION_LIMITS_COPY);

    expect(description(MAXIMUM)).toBe(
      "Each project keeps resolved alerts for as long as it chooses.",
    );
    expect(description(DEFAULT)).toBe(
      "A new project keeps every resolved alert until its owners pick a length.",
    );
  });

  test("a limit in years is said in years", async () => {
    stored = { maxAlertRetentionInDays: 1095 };

    await renderCard(ALERT_RETENTION_LIMITS_COPY);

    expect(description(MAXIMUM)).toBe(
      "No project keeps a resolved alert longer than 3 years, including projects set to Never.",
    );
  });
});

describe("in German", () => {
  test("the card, its picks, their sentences and the question are German", async () => {
    stored = { defaultIncidentRetentionInDays: 30 };
    mockCountProjectsReached.mockImplementation(async (): Promise<number> => {
      return 3;
    });

    await renderCard(INCIDENT_RETENTION_LIMITS_COPY, "de");

    expect(screen.getByText(german("Resolved Incidents"))).toBeInTheDocument();
    expect(german("Resolved Incidents")).not.toBe("Resolved Incidents");
    expect(
      screen.getByRole("combobox", { name: german("Keep for at most") }),
    ).toBe(pickControl(MAXIMUM));
    expect(
      screen.getByRole("combobox", {
        name: german("New projects delete after"),
      }),
    ).toBe(pickControl(DEFAULT));
    expect(picked(MAXIMUM)).toBe(german("No limit"));
    expect(description(MAXIMUM)).toBe(
      german(
        "Each project keeps resolved incidents for as long as it chooses.",
      ),
    );
    expect(picked(DEFAULT)).toBe(
      german("{{count}} days").replace("{{count}}", "30"),
    );
    expect(description(DEFAULT)).toBe(
      german(
        "A new project deletes resolved incidents after {{count}} days until its owners change it. Projects that exist keep their own.",
      ).replace("{{count}}", "30"),
    );

    expect(await optionTexts(MAXIMUM)).toEqual([
      german("No limit"),
      ...[30, 60, 90, 180].map((count: number): string => {
        return german("{{count}} days").replace("{{count}}", String(count));
      }),
      german("{{count}} years_one").replace("{{count}}", "1"),
      german("{{count}} years").replace("{{count}}", "2"),
      german("{{count}} years").replace("{{count}}", "3"),
    ]);

    await pick(
      MAXIMUM,
      german("{{count}} years_one").replace("{{count}}", "1"),
    );

    expect(dialogText()).toContain(
      german("Limit how long projects keep resolved incidents?"),
    );
    expect(dialogText()).toContain(
      german(
        "Every project deletes resolved incidents older than {{count}} years within the hour, with their timeline, notes and logs. They can't be brought back._one",
      ).replace("{{count}}", "1"),
    );
    await waitFor(() => {
      expect(reachLine()).toBe(
        german("This reaches {{count}} projects.").replace("{{count}}", "3"),
      );
    });
    expect(
      within(dialog()!).getByRole("button", {
        name: german("Limit Projects"),
      }),
    ).toBeInTheDocument();

    await pressInDialog(german("Limit Projects"));

    expect(savedData()).toEqual([{ maxIncidentRetentionInDays: 365 }]);
    await waitFor(() => {
      expect(saveStatus(MAXIMUM)).toBe(german("Saved"));
    });
    expect(description(MAXIMUM)).toBe(
      german(
        "No project keeps a resolved incident longer than {{count}} years, even one set to Never, except incidents it keeps for a completed postmortem._one",
      ).replace("{{count}}", "1"),
    );
  });

  test("the locked lengths say why in German", async () => {
    stored = { maxIncidentRetentionInDays: 30 };

    await renderCard(INCIDENT_RETENTION_LIMITS_COPY, "de");

    expect(description(DEFAULT)).toBe(
      german(
        "A new project starts at Never and is held to the limit above until its owners pick a length.",
      ),
    );

    await openPick(DEFAULT);

    const reasons: Array<string> = (
      await screen.findAllByTestId("dropdown-option-description")
    ).map((reason: HTMLElement): string => {
      return readable(reason.textContent);
    });

    expect(reasons.length).toBe(6);
    expect(new Set(reasons)).toEqual(
      new Set([german("Longer than the limit above.")]),
    );
  });
});

describe("Settings > Data Retention", () => {
  test("starts with Resolved Incidents and Resolved Alerts, before Monitor Log Retention", async () => {
    await renderWith(<DataRetentionSettings />);
    await screen.findAllByTestId(MAXIMUM);

    const cards: Array<string> = Array.from(
      screen
        .getByTestId("admin-page")
        .querySelectorAll(
          `[data-testid^="${RESOLVED_RECORD_RETENTION_LIMITS_CARD_TEST_ID}-"], [data-testid="card-model-detail"]`,
        ),
    ).map((card: Element): string => {
      return card.getAttribute("data-testid") === "card-model-detail"
        ? card.textContent || ""
        : card.getAttribute("data-testid") || "";
    });

    expect(cards).toEqual([
      `${RESOLVED_RECORD_RETENTION_LIMITS_CARD_TEST_ID}-incident`,
      `${RESOLVED_RECORD_RETENTION_LIMITS_CARD_TEST_ID}-alert`,
      "Monitor Log Retention Settings",
      "Monitor Metric Retention Settings",
      "Telemetry Usage Retention Settings",
    ]);
    expect(screen.getByText("Resolved Incidents")).toBeInTheDocument();
    expect(screen.getByText("Resolved Alerts")).toBeInTheDocument();
    // Each card reads its own two columns of the one row.
    expect(mockGetItem).toHaveBeenCalledTimes(2);
  });

  test("the cards' words are the copy's, as English keys of the Admin Dashboard's locale", () => {
    for (const copy of [
      INCIDENT_RETENTION_LIMITS_COPY,
      ALERT_RETENTION_LIMITS_COPY,
    ]) {
      expect(ENGLISH[copy.cardTitle]).toBe(copy.cardTitle);
      expect(ENGLISH[copy.confirmTitle]).toBe(copy.confirmTitle);
    }

    expect(ENGLISH[ResolvedRecordRetentionLimitsCopy.confirmButton]).toBe(
      "Limit Projects",
    );
  });
});
