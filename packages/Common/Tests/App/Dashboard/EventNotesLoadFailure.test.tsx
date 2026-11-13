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
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import EventNotes from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotes";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import {
  getUnexplainedServerErrorMessage,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import ObjectID from "../../../Types/ObjectID";
import { joinSentences } from "../../../UI/Components/DeleteConfirmation/DeleteConsequences";

/*
 * THE NOTES FEED, WHEN ITS NOTES DO NOT LOAD (#7570).
 *
 * An incident's, alert's or case's notes feed drew "Notes could not be
 * loaded" and, under it, API.getFriendlyMessage's answer as it came. For
 * the errors the client words itself - a failure the server could not
 * explain, a "Server Error" - that is an English sentence: English on every
 * language's page, without #6836's explanation and its reference, and on a
 * Persian page with its full stop at its start. Its failure now reads like
 * every list's (ErrorMessageText): an error nobody explained says why and
 * what to do next, with the reference to copy - and not what failed, which
 * the feed's heading says; words of their own are in the reader's language
 * where it has them, and read the way they are written where it does not.
 * Its Try again still reads the notes again, and keeps the keyboard's focus
 * while it does.
 *
 * Every language here is the Dashboard's own locale file, as it ships, read
 * by a self-hosted server's member: the reference goes to whoever runs the
 * server, and nothing is said about its logs.
 */

/*
 * The background re-read while a public note's notification is on its way,
 * every 80 ms rather than every 10 seconds; no other test here has a
 * notification on its way.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil",
    ) as Record<string, unknown>;

    return { ...actual, NOTIFICATION_POLL_INTERVAL_MS: 80 };
  },
);

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "10000000-0000-4000-8000-000000000001",
        );
      },
      getCurrentProject: (): null => {
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
        const PermissionModule: any = jest.requireActual(
          "../../../Types/Permission",
        ) as any;
        return [PermissionModule.default.ProjectOwner];
      },
      getGlobalPermissions: (): null => {
        return null;
      },
      getProjectPermissions: (): null => {
        return null;
      },
    },
  };
});

// A member, not a master admin: nothing about the server's logs.
jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "80000000-0000-4000-8000-000000000001",
        );
      },
      getName: (): string => {
        return "Maya Chen";
      },
      getEmail: (): null => {
        return null;
      },
      getProfilePictureRoute: (id: { toString: () => string }): unknown => {
        return {
          toString: (): string => {
            return `/api/user/profile-picture/${id.toString()}`;
          },
        };
      },
    },
  };
});

// The rich text editor and viewer, as plain elements.
jest.mock("../../../UI/Components/Markdown.tsx/MarkdownEditor", () => {
  return {
    __esModule: true,
    default: (props: { placeholder?: string }): ReactElement => {
      return (
        <textarea aria-label="Note text" placeholder={props.placeholder} />
      );
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <div data-testid="markdown">{props.text}</div>;
    },
  };
});

/*
 * A busy page: while it is on, the failure's words take longer to draw than
 * the scheduler's slice (5 ms), so React runs the passive effects of the
 * commit that draws them in a task of their own - after a Try again pressed
 * at once. The words are ErrorMessageText's own all the same.
 */
const mockBusyPage: { isOn: boolean } = { isOn: false };

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessageText", () => {
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  const ActualErrorMessageText: React.ComponentType<Record<string, unknown>> = (
    jest.requireActual(
      "../../../UI/Components/ErrorMessage/ErrorMessageText",
    ) as { default: React.ComponentType<Record<string, unknown>> }
  ).default;

  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      if (mockBusyPage.isOn) {
        const drawnBy: number = Date.now() + 25;

        while (Date.now() < drawnBy) {
          // Drawing, slowly.
        }
      }

      return ReactModule.createElement(ActualErrorMessageText, props);
    },
  };
});

const LANGUAGES: Array<string> = ["en", "de", "fa"];

const REFERENCE: string = "a1b2c3d4";

// What the server answers for a failure it could not explain (#6836).
const SERVER_FAILURE: HTTPErrorResponse = new HTTPErrorResponse(
  500,
  {
    message: getUnexplainedServerErrorMessage(REFERENCE),
    reference: REFERENCE,
  },
  {},
);

// A failure the server answered without a word of why, or a reference.
const SERVER_ERROR: HTTPErrorResponse = new HTTPErrorResponse(
  500,
  { message: "Server Error" },
  {},
);

// Words of their own, which the Dashboard's languages word.
const OWN_WORDS: string = "You don't have access to this list";

// Words of their own, in English only, as most of the server's answers are.
const ENGLISH_ONLY_WORDS: string =
  "This incident was deleted, so its notes are gone.";

// The feed's own heading, which says what failed.
const HEADING: string = "Notes could not be loaded";

// What React says of an element HTML does not allow where it is drawn.
const MISPLACED_ELEMENT_WARNING: RegExp =
  /validateDOMNesting|cannot (appear as|be) a descendant of|cannot contain a nested/;

// Every English sentence the failure can say, but for a quoted reference.
const ENGLISH_SENTENCES: Array<string> = [
  HEADING,
  "Try again",
  getUnexplainedServerErrorMessage(REFERENCE),
  UNEXPLAINED_ERROR_MESSAGES.server,
  ...Object.values(UnexplainedErrorWords).filter((words: string): boolean => {
    return !words.includes("{{");
  }),
];

const INCIDENT_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000001042",
);

// The incident's private notes, once they load.
const NOTES: Array<Record<string, unknown>> = [
  {
    _id: "70000000-0000-4000-8000-000000000011",
    incidentId: INCIDENT_ID,
    note: "Rotated the cert on lb-eu-west-1b.",
    createdAt: new Date("2026-09-14T18:11:00.000Z"),
    postedAt: new Date("2026-09-14T18:11:00.000Z"),
  },
  {
    _id: "70000000-0000-4000-8000-000000000012",
    incidentId: INCIDENT_ID,
    note: "Paged the edge on-call.",
    createdAt: new Date("2026-09-11T18:20:00.000Z"),
    postedAt: new Date("2026-09-11T18:20:00.000Z"),
  },
];

interface NotesAnswer {
  data: Array<IncidentInternalNote>;
  count: number;
  skip: number;
  limit: number;
}

// A read of the notes that waits until the test answers it.
interface PendingRead {
  resolve: (answer: NotesAnswer) => void;
  reject: (error: unknown) => void;
}

/*
 * How the coming reads of the notes end, in order - a failure, or a read
 * left for the test to answer. Every read after them gets the notes.
 */
type NotesRead = () => Promise<NotesAnswer>;

let notesReads: Array<NotesRead> = [];

const notesAnswer: () => NotesAnswer = (): NotesAnswer => {
  return {
    data: NOTES.map((row: Record<string, unknown>) => {
      return Object.assign(new IncidentInternalNote(), row);
    }),
    count: NOTES.length,
    skip: 0,
    limit: 10,
  };
};

const failingRead: (failure: unknown) => NotesRead = (
  failure: unknown,
): NotesRead => {
  return (): Promise<NotesAnswer> => {
    return Promise.reject(failure);
  };
};

const pendingRead: (pending: Array<PendingRead>) => NotesRead = (
  pending: Array<PendingRead>,
): NotesRead => {
  return (): Promise<NotesAnswer> => {
    return new Promise<NotesAnswer>(
      (
        resolve: (answer: NotesAnswer) => void,
        reject: (error: unknown) => void,
      ) => {
        pending.push({ resolve, reject });
      },
    );
  };
};

// How many times the feed has read the incident's notes.
const notesReadCount: () => number = (): number => {
  return getListMock.mock.calls.filter((call: Array<unknown>) => {
    return (
      (call[0] as { modelType?: unknown } | undefined)?.modelType ===
      IncidentInternalNote
    );
  }).length;
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  notesReads = [];
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType?: unknown } = (args[0] || {}) as {
      modelType?: unknown;
    };

    if (request.modelType !== IncidentInternalNote) {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }

    const read: NotesRead | undefined = notesReads.shift();

    return read ? read() : notesAnswer();
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  jest.restoreAllMocks();
  mockBusyPage.isOn = false;
});

/*
 * The words a language has for an English sentence: the sentence itself in
 * English, and a word of the language's own in every other.
 */
const wordsIn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  if (language === "en") {
    return english;
  }

  const words: string | undefined = readDashboardLocale(language)[english];

  expect({
    language,
    english,
    worded: Boolean(words) && words !== english,
  }).toEqual({ language, english, worded: true });

  return words as string;
};

/*
 * An incident's private notes page in `language`, its reads answered as
 * the test queued them. A button beside the feed stands for the rest of
 * the page.
 */
const renderNotesPage: (language: string) => void = (
  language: string,
): void => {
  const project: Project = new Project();
  project._id = "10000000-0000-4000-8000-000000000001";

  render(
    <I18nextProvider i18n={instances[language]!}>
      <button type="button" data-testid="elsewhere">
        Elsewhere on the page
      </button>
      <EventNotes<IncidentInternalNote>
        modelType={IncidentInternalNote}
        visibility="private"
        eventNoun="incident"
        parentIdField="incidentId"
        parentId={INCIDENT_ID}
        currentProject={project}
      />
    </I18nextProvider>,
  );
};

/*
 * The page, whose first read of the notes fails with `failure` - the reads
 * a test queued come after it - and its failure as the feed draws it.
 */
const renderFailedFeed: (
  language: string,
  failure: unknown,
) => Promise<HTMLElement> = async (
  language: string,
  failure: unknown,
): Promise<HTMLElement> => {
  notesReads.unshift(failingRead(failure));

  renderNotesPage(language);

  return screen.findByTestId("notes-error");
};

// The failure's words as a reader sees them.
const failureText: (failure: HTMLElement) => string = (
  failure: HTMLElement,
): string => {
  return withoutIsolateMarks(failure.textContent || "");
};

// The line under the heading: the error's own words.
const errorWords: (failure: HTMLElement) => HTMLElement = (
  failure: HTMLElement,
): HTMLElement => {
  return failure.querySelectorAll("p")[1] as HTMLElement;
};

// How many times `words` are said in `text`.
const timesSaid: (text: string, words: string) => number = (
  text: string,
  words: string,
): number => {
  return text.split(words).length - 1;
};

const expectNoEnglishSentence: (
  language: string,
  failure: HTMLElement,
) => void = (language: string, failure: HTMLElement): void => {
  const text: string = failureText(failure);

  for (const sentence of ENGLISH_SENTENCES) {
    expect({ language, sentence, left: text.includes(sentence) }).toEqual({
      language,
      sentence,
      left: false,
    });
  }
};

/*
 * What failed is said once, by the feed's heading: the explanation under it
 * does not say it again, in its words or the heading's.
 */
const expectWhatFailedSaidOnce: (
  language: string,
  failure: HTMLElement,
) => void = (language: string, failure: HTMLElement): void => {
  const text: string = failureText(failure);

  expect(within(failure).queryByTestId("error-what-failed")).toBeNull();
  expect(timesSaid(text, wordsIn(language, HEADING))).toBe(1);
  expect(text).not.toContain(
    wordsIn(language, UnexplainedErrorWords.didNotFinish),
  );
};

const tryAgainIn: (language: string, failure: HTMLElement) => HTMLElement = (
  language: string,
  failure: HTMLElement,
): HTMLElement => {
  return within(failure).getByRole("button", {
    name: wordsIn(language, "Try again"),
  });
};

// Try again reads the notes again, and the feed lists them.
const expectTryAgainReadsThemAgain: (
  language: string,
  failure: HTMLElement,
) => Promise<void> = async (
  language: string,
  failure: HTMLElement,
): Promise<void> => {
  fireEvent.click(tryAgainIn(language, failure));

  await waitFor(() => {
    expect(screen.getAllByTestId("note-card")).toHaveLength(NOTES.length);
  });
  expect(notesReadCount()).toBe(2);
  expect(screen.queryByTestId("notes-error")).toBeNull();
};

describe("the notes feed, when its notes do not load", () => {
  test.each(LANGUAGES)(
    "in %s, a failure the server could not explain says why and what to do next, with the reference to copy, under the feed's heading - which alone says what failed",
    async (language: string) => {
      const failure: HTMLElement = await renderFailedFeed(
        language,
        SERVER_FAILURE,
      );

      expect(within(failure).getByText(wordsIn(language, HEADING))).toBe(
        failure.querySelectorAll("p")[0],
      );
      expectWhatFailedSaidOnce(language, failure);
      expect(
        withoutIsolateMarks(
          within(failure).getByTestId("error-why-and-next").textContent || "",
        ),
      ).toBe(
        joinSentences([
          wordsIn(language, UnexplainedErrorWords.serverWhy),
          wordsIn(
            language,
            UnexplainedErrorWords.serverNextWithReferenceSelfHosted,
          ),
        ]),
      );

      // The reference as written, left to right, with its copy button.
      const reference: HTMLElement =
        within(failure).getByTestId("error-reference");
      expect(reference.querySelector("code")).toHaveTextContent(REFERENCE);
      expect(reference.querySelector("code")).toHaveAttribute("dir", "ltr");
      expect(within(reference).getAllByRole("button")).toHaveLength(1);
      expect(timesSaid(failureText(failure), REFERENCE)).toBe(1);
      // Centred, as the lines around it are.
      expect(reference).toHaveClass("justify-center");

      // A member is told nothing about the server's logs.
      expect(within(failure).queryByTestId("error-where-to-look")).toBeNull();

      // Never the sentence as API.getFriendlyMessage wrote it.
      expect(failureText(failure)).not.toContain(
        getUnexplainedServerErrorMessage(REFERENCE),
      );

      if (language !== "en") {
        expectNoEnglishSentence(language, failure);
      }

      await expectTryAgainReadsThemAgain(language, failure);
    },
  );

  test.each(LANGUAGES)(
    'in %s, a server\'s "Server Error" says why and what to do next, with no reference to give',
    async (language: string) => {
      const failure: HTMLElement = await renderFailedFeed(
        language,
        SERVER_ERROR,
      );

      expectWhatFailedSaidOnce(language, failure);
      expect(
        withoutIsolateMarks(
          within(failure).getByTestId("error-why-and-next").textContent || "",
        ),
      ).toBe(
        joinSentences([
          wordsIn(language, UnexplainedErrorWords.serverWhy),
          wordsIn(language, UnexplainedErrorWords.serverNext),
        ]),
      );
      expect(within(failure).queryByTestId("error-reference")).toBeNull();
      expect(within(failure).queryByTestId("error-where-to-look")).toBeNull();
      expect(failureText(failure)).not.toContain("Server Error");
      expect(failureText(failure)).not.toContain(
        UNEXPLAINED_ERROR_MESSAGES.server,
      );

      if (language !== "en") {
        expectNoEnglishSentence(language, failure);
      }

      await expectTryAgainReadsThemAgain(language, failure);
    },
  );

  test.each(["de", "fa"])(
    "in %s, words of their own are drawn in the reader's language, as the page's own line",
    async (language: string) => {
      const failure: HTMLElement = await renderFailedFeed(
        language,
        new HTTPErrorResponse(403, { message: OWN_WORDS }, {}),
      );

      expect(errorWords(failure).textContent).toBe(
        wordsIn(language, OWN_WORDS),
      );
      expect(failureText(failure)).not.toContain(OWN_WORDS);
      // Not an error nobody explained, and not set apart from the page.
      expect(within(failure).queryByTestId("error-explanation")).toBeNull();
      expect(failure.querySelector("bdi")).toBeNull();

      await expectTryAgainReadsThemAgain(language, failure);
    },
  );

  test("on a Persian page, English words the language has not worded read left to right, with their full stop at their end", async () => {
    expect(readDashboardLocale("fa")[ENGLISH_ONLY_WORDS]).toBeUndefined();

    const failure: HTMLElement = await renderFailedFeed(
      "fa",
      new HTTPErrorResponse(400, { message: ENGLISH_ONLY_WORDS }, {}),
    );
    const words: HTMLElement | null = errorWords(failure).querySelector("bdi");

    expect(words).toHaveAttribute("dir", "ltr");
    expect(words?.textContent).toBe(ENGLISH_ONLY_WORDS);
    expect(ENGLISH_ONLY_WORDS.endsWith(".")).toBe(true);
    // Nothing of the sentence is left outside its isolate.
    expect(errorWords(failure).textContent).toBe(ENGLISH_ONLY_WORDS);
    expect(within(failure).queryByTestId("error-explanation")).toBeNull();

    await expectTryAgainReadsThemAgain("fa", failure);
  });

  test("on a German page, English words the language has not worded are drawn as they are written", async () => {
    expect(readDashboardLocale("de")[ENGLISH_ONLY_WORDS]).toBeUndefined();

    const failure: HTMLElement = await renderFailedFeed(
      "de",
      new HTTPErrorResponse(400, { message: ENGLISH_ONLY_WORDS }, {}),
    );

    expect(errorWords(failure).textContent).toBe(ENGLISH_ONLY_WORDS);
    // German reads left to right, as English does: nothing to set apart.
    expect(failure.querySelector("bdi")).toBeNull();
    expect(within(failure).queryByTestId("error-explanation")).toBeNull();
  });

  /*
   * The explanation draws block lines and a copy button inside the
   * feed's paragraph: phrasing content, which a paragraph may hold.
   */
  test("the explanation sits in the feed's paragraph as HTML allows", async () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest.spyOn(
      console,
      "error",
    );

    const failure: HTMLElement = await renderFailedFeed("en", SERVER_FAILURE);

    expect(
      errorWords(failure).querySelector("[data-testid='error-explanation']"),
    ).not.toBeNull();
    expect(
      consoleError.mock.calls.filter((call: Array<unknown>) => {
        return MISPLACED_ELEMENT_WARNING.test(call.map(String).join(" "));
      }),
    ).toEqual([]);
  });
});

/*
 * Try again gives way to the loading skeleton, which holds nothing to
 * focus. Pressed from the keyboard, it leaves the focus with the feed while
 * the notes load again - it fell to the page, and the next Tab started over
 * at the top of it - and the feed hands it back to Try again if they fail
 * once more, though the reference's copy button comes before it.
 */
describe("the notes feed's Try again, pressed from the keyboard", () => {
  /*
   * The feed on a failed read, with Try again focused and pressed: the read
   * it starts waits in `pending`.
   */
  const pressTryAgain: () => Promise<{
    feed: HTMLElement;
    pending: Array<PendingRead>;
  }> = async (): Promise<{
    feed: HTMLElement;
    pending: Array<PendingRead>;
  }> => {
    const pending: Array<PendingRead> = [];
    notesReads.push(pendingRead(pending));

    const failure: HTMLElement = await renderFailedFeed("en", SERVER_FAILURE);
    const tryAgain: HTMLElement = tryAgainIn("en", failure);

    tryAgain.focus();
    expect(document.activeElement).toBe(tryAgain);

    /*
     * Enter or Space on a focused button is a click on it, with the focus
     * where it is.
     */
    fireEvent.click(tryAgain);

    const feed: HTMLElement = screen.getByTestId("notes-feed-body");

    // Loading again, with the focus in the feed - not on the page.
    expect(within(feed).getByTestId("notes-loading")).toBeInTheDocument();
    expect(document.activeElement).toBe(feed);
    expect(pending).toHaveLength(1);

    return { feed, pending };
  };

  test("when the notes arrive, the focus stays in the feed, before them", async () => {
    const { feed, pending } = await pressTryAgain();

    await act(async () => {
      pending[0]!.resolve(notesAnswer());
    });

    await waitFor(() => {
      expect(within(feed).getAllByTestId("note-card")).toHaveLength(
        NOTES.length,
      );
    });
    expect(document.activeElement).toBe(feed);
  });

  test("when they fail once more, the focus moves on to Try again, not to the reference's copy button", async () => {
    const { feed, pending } = await pressTryAgain();

    await act(async () => {
      pending[0]!.reject(SERVER_FAILURE);
    });

    const failure: HTMLElement = await within(feed).findByTestId("notes-error");
    const tryAgain: HTMLElement = tryAgainIn("en", failure);

    expect(
      within(within(failure).getByTestId("error-reference")).getByRole(
        "button",
      ),
    ).not.toBe(tryAgain);

    await waitFor(() => {
      expect(document.activeElement).toBe(tryAgain);
    });
  });

  /*
   * On a busy page a failure takes longer to draw than the scheduler's
   * slice, and React runs the passive effects of that commit in a later
   * task - after a Try again pressed at once. Run then, the check that hands
   * the focus back to Try again found it on the feed's body, where Try again
   * had just put it, and moved it to the Try again being taken away: the
   * focus fell to the page. The check runs as the failure is drawn now.
   */
  test("on a busy page, Try again pressed as soon as the failure is drawn still keeps the focus in the feed", async () => {
    mockBusyPage.isOn = true;

    const { feed, pending } = await pressTryAgain();

    await act(async () => {
      pending[0]!.reject(SERVER_FAILURE);
    });

    const failure: HTMLElement = await within(feed).findByTestId("notes-error");

    await waitFor(() => {
      expect(document.activeElement).toBe(tryAgainIn("en", failure));
    });
  });

  test("a focus that was elsewhere on the page is left where it is", async () => {
    const pending: Array<PendingRead> = [];
    notesReads.push(pendingRead(pending), pendingRead(pending));

    const failure: HTMLElement = await renderFailedFeed("en", SERVER_FAILURE);
    const elsewhere: HTMLElement = screen.getByTestId("elsewhere");

    elsewhere.focus();
    // A click that left the focus where it was, as a click does in Safari.
    fireEvent.click(tryAgainIn("en", failure));
    expect(document.activeElement).toBe(elsewhere);

    await act(async () => {
      pending[0]!.reject(SERVER_FAILURE);
    });

    const failedAgain: HTMLElement = await screen.findByTestId("notes-error");
    expect(document.activeElement).toBe(elsewhere);

    fireEvent.click(tryAgainIn("en", failedAgain));

    await act(async () => {
      pending[1]!.resolve(notesAnswer());
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("note-card")).toHaveLength(NOTES.length);
    });
    expect(document.activeElement).toBe(elsewhere);
  });
});

/*
 * THE FEED'S BANNER, WHEN A REFRESH, A SEARCH, THE SORT ORDER OR LOAD MORE
 * FAILS (#7620).
 *
 * A read that fails with the notes on screen keeps them, and says so in a
 * banner over the feed. The banner drew API.getFriendlyMessage's answer and
 * nothing else: English on every page, on a Persian one with its full stop
 * at its start, without #6836's why, next step and reference, and silent on
 * which of the four had failed. It says what failed now, in the reader's
 * language, then the error as the load failure reads it (ErrorMessageText).
 */

type FeedAction = "refresh" | "search" | "sort" | "more";

const ACTIONS: Array<FeedAction> = ["refresh", "search", "sort", "more"];

// What failed, as the banner's first line says it.
const ACTION_FAILED: Record<FeedAction, string> = {
  refresh: "Couldn't refresh the notes.",
  search: "Couldn't search the notes.",
  sort: "Couldn't sort the notes.",
  more: "Couldn't load more notes.",
};

// The notes, with more of them to load than came.
const notesWithMoreAnswer: () => NotesAnswer = (): NotesAnswer => {
  return { ...notesAnswer(), count: NOTES.length + 3 };
};

/*
 * The page with its notes on screen, and Load more under them: the first
 * read answers, and the next fails with `failure`.
 */
const renderLoadedFeed: (
  language: string,
  failure: unknown,
) => Promise<void> = async (
  language: string,
  failure: unknown,
): Promise<void> => {
  notesReads.push((): Promise<NotesAnswer> => {
    return Promise.resolve(notesWithMoreAnswer());
  }, failingRead(failure));

  renderNotesPage(language);

  await waitFor(() => {
    expect(screen.getAllByTestId("note-card")).toHaveLength(NOTES.length);
  });
  expect(screen.getByTestId("notes-load-more")).toBeInTheDocument();
};

// Does `action` as a reader does, and returns the banner its failure draws.
const failAction: (action: FeedAction) => Promise<HTMLElement> = async (
  action: FeedAction,
): Promise<HTMLElement> => {
  if (action === "refresh") {
    fireEvent.click(screen.getByTestId("notes-refresh"));
  } else if (action === "search") {
    // Read once typing stops.
    fireEvent.change(screen.getByTestId("notes-search"), {
      target: { value: "cert" },
    });
  } else if (action === "sort") {
    fireEvent.click(screen.getByTestId("notes-sort"));
  } else {
    fireEvent.click(screen.getByTestId("notes-load-more"));
  }

  return screen.findByTestId("notes-action-error", {}, { timeout: 3000 });
};

const bannerText: (banner: HTMLElement) => string = (
  banner: HTMLElement,
): string => {
  return withoutIsolateMarks(banner.textContent || "");
};

const dismissIn: (language: string, banner: HTMLElement) => HTMLElement = (
  language: string,
  banner: HTMLElement,
): HTMLElement => {
  return within(banner).getByRole("button", {
    name: wordsIn(language, "Dismiss"),
  });
};

describe("the notes feed's banner, when a refresh, a search, the sort order or Load more fails", () => {
  const CASES: Array<[FeedAction, string]> = ACTIONS.flatMap(
    (action: FeedAction): Array<[FeedAction, string]> => {
      return [
        [action, "de"],
        [action, "fa"],
      ];
    },
  );

  test.each(CASES)(
    "a failed %s, in %s, says what failed, then why and what to do next, with the reference to copy",
    async (action: FeedAction, language: string) => {
      await renderLoadedFeed(language, SERVER_FAILURE);

      const banner: HTMLElement = await failAction(action);

      expect(banner).toHaveAttribute("role", "alert");
      expect(
        within(banner).getByTestId("notes-action-error-what-failed"),
      ).toHaveTextContent(wordsIn(language, ACTION_FAILED[action]));
      // Said once: the explanation under it has no first line of its own.
      expect(within(banner).queryByTestId("error-what-failed")).toBeNull();
      expect(bannerText(banner)).not.toContain(
        wordsIn(language, UnexplainedErrorWords.didNotFinish),
      );
      expect(
        withoutIsolateMarks(
          within(banner).getByTestId("error-why-and-next").textContent || "",
        ),
      ).toBe(
        joinSentences([
          wordsIn(language, UnexplainedErrorWords.serverWhy),
          wordsIn(
            language,
            UnexplainedErrorWords.serverNextWithReferenceSelfHosted,
          ),
        ]),
      );

      // The reference as written, left to right, with its copy button.
      const reference: HTMLElement =
        within(banner).getByTestId("error-reference");
      expect(reference.querySelector("code")).toHaveTextContent(REFERENCE);
      expect(reference.querySelector("code")).toHaveAttribute("dir", "ltr");
      expect(within(reference).getAllByRole("button")).toHaveLength(1);
      expect(timesSaid(bannerText(banner), REFERENCE)).toBe(1);

      // Never the sentence as API.getFriendlyMessage wrote it, nor English.
      expect(bannerText(banner)).not.toContain(
        getUnexplainedServerErrorMessage(REFERENCE),
      );
      expectNoEnglishSentence(language, banner);
      for (const english of Object.values(ACTION_FAILED)) {
        expect(bannerText(banner)).not.toContain(english);
      }

      // The notes stay where they were.
      expect(screen.getAllByTestId("note-card")).toHaveLength(NOTES.length);
      expect(screen.queryByTestId("notes-error")).toBeNull();
    },
  );

  test.each(LANGUAGES)(
    'in %s, a server\'s "Server Error" says what failed, why and what to do next, with no reference to give',
    async (language: string) => {
      await renderLoadedFeed(language, SERVER_ERROR);

      const banner: HTMLElement = await failAction("refresh");

      expect(
        within(banner).getByTestId("notes-action-error-what-failed"),
      ).toHaveTextContent(wordsIn(language, ACTION_FAILED.refresh));
      expect(within(banner).queryByTestId("error-what-failed")).toBeNull();
      expect(
        withoutIsolateMarks(
          within(banner).getByTestId("error-why-and-next").textContent || "",
        ),
      ).toBe(
        joinSentences([
          wordsIn(language, UnexplainedErrorWords.serverWhy),
          wordsIn(language, UnexplainedErrorWords.serverNext),
        ]),
      );
      expect(within(banner).queryByTestId("error-reference")).toBeNull();
      expect(bannerText(banner)).not.toContain("Server Error");
      expect(bannerText(banner)).not.toContain(
        UNEXPLAINED_ERROR_MESSAGES.server,
      );

      if (language !== "en") {
        expectNoEnglishSentence(language, banner);
      }
    },
  );

  test.each(["de", "fa"])(
    "in %s, words of their own are drawn in the reader's language, under what failed",
    async (language: string) => {
      await renderLoadedFeed(
        language,
        new HTTPErrorResponse(403, { message: OWN_WORDS }, {}),
      );

      const banner: HTMLElement = await failAction("search");

      expect(
        within(banner).getByTestId("notes-action-error-what-failed"),
      ).toHaveTextContent(wordsIn(language, ACTION_FAILED.search));
      expect(
        within(banner).getByTestId("notes-action-error-words").textContent,
      ).toBe(wordsIn(language, OWN_WORDS));
      expect(bannerText(banner)).not.toContain(OWN_WORDS);
      expect(within(banner).queryByTestId("error-explanation")).toBeNull();
      expect(banner.querySelector("bdi")).toBeNull();
    },
  );

  test("on a Persian page, English words the language has not worded read left to right, with their full stop at their end", async () => {
    expect(readDashboardLocale("fa")[ENGLISH_ONLY_WORDS]).toBeUndefined();

    await renderLoadedFeed(
      "fa",
      new HTTPErrorResponse(400, { message: ENGLISH_ONLY_WORDS }, {}),
    );

    const banner: HTMLElement = await failAction("more");
    const words: HTMLElement = within(banner).getByTestId(
      "notes-action-error-words",
    );
    const isolate: HTMLElement | null = words.querySelector("bdi");

    expect(
      within(banner).getByTestId("notes-action-error-what-failed"),
    ).toHaveTextContent(wordsIn("fa", ACTION_FAILED.more));
    expect(isolate).toHaveAttribute("dir", "ltr");
    expect(isolate?.textContent).toBe(ENGLISH_ONLY_WORDS);
    expect(ENGLISH_ONLY_WORDS.endsWith(".")).toBe(true);
    // Nothing of the sentence is left outside its isolate.
    expect(words.textContent).toBe(ENGLISH_ONLY_WORDS);
  });

  /*
   * The explanation draws block lines and a copy button inside the
   * banner's paragraph: phrasing content, which a paragraph may hold.
   */
  test("the explanation sits in the banner's paragraph as HTML allows", async () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest.spyOn(
      console,
      "error",
    );

    await renderLoadedFeed("en", SERVER_FAILURE);
    const banner: HTMLElement = await failAction("sort");

    expect(
      within(banner)
        .getByTestId("notes-action-error-words")
        .querySelector("[data-testid='error-explanation']"),
    ).not.toBeNull();
    expect(
      consoleError.mock.calls.filter((call: Array<unknown>) => {
        return MISPLACED_ELEMENT_WARNING.test(call.map(String).join(" "));
      }),
    ).toEqual([]);
  });

  /*
   * A search and the sort order read the notes the same way: what the read
   * was for is told by what changed since the notes on screen were read.
   */
  test("the sort order changed after a search says the sort order failed, not the search", async () => {
    notesReads.push(
      (): Promise<NotesAnswer> => {
        return Promise.resolve(notesWithMoreAnswer());
      },
      (): Promise<NotesAnswer> => {
        return Promise.resolve(notesWithMoreAnswer());
      },
      failingRead(SERVER_FAILURE),
    );

    renderNotesPage("en");

    await waitFor(() => {
      expect(screen.getAllByTestId("note-card")).toHaveLength(NOTES.length);
    });

    // The search answers.
    fireEvent.change(screen.getByTestId("notes-search"), {
      target: { value: "cert" },
    });
    await waitFor(() => {
      expect(notesReadCount()).toBe(2);
      expect(screen.getByTestId("notes-refresh")).not.toBeDisabled();
    });
    expect(screen.queryByTestId("notes-action-error")).toBeNull();

    const banner: HTMLElement = await failAction("sort");

    expect(notesReadCount()).toBe(3);
    expect(
      within(banner).getByTestId("notes-action-error-what-failed"),
    ).toHaveTextContent(ACTION_FAILED.sort);
  });
});

/*
 * Dismiss takes the banner away, and the focus on it fell to the page: a
 * keyboard or screen reader user started over from the top. It goes back
 * to where the reader was - Load more after Load more failed, the feed's
 * body, just before the notes, after the others.
 */
describe("the notes feed's banner, dismissed from the keyboard", () => {
  test.each(ACTIONS)(
    "after a failed %s, Dismiss leaves the focus where the reader was, never on the page",
    async (action: FeedAction) => {
      await renderLoadedFeed("en", SERVER_FAILURE);

      const banner: HTMLElement = await failAction(action);
      const dismiss: HTMLElement = dismissIn("en", banner);

      dismiss.focus();
      expect(document.activeElement).toBe(dismiss);

      // Enter or Space on a focused button is a click on it.
      fireEvent.click(dismiss);

      expect(screen.queryByTestId("notes-action-error")).toBeNull();
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(
        action === "more"
          ? screen.getByTestId("notes-load-more")
          : screen.getByTestId("notes-feed-body"),
      );
    },
  );

  test("a focus that was elsewhere on the page is left where it is", async () => {
    await renderLoadedFeed("en", SERVER_FAILURE);

    const banner: HTMLElement = await failAction("more");
    const elsewhere: HTMLElement = screen.getByTestId("elsewhere");

    elsewhere.focus();
    // A click that left the focus where it was, as a click does in Safari.
    fireEvent.click(dismissIn("en", banner));

    expect(screen.queryByTestId("notes-action-error")).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  /*
   * Load more pressed once more, its read on the way: the button is
   * disabled until it answers, and takes no focus - the feed's body does.
   */
  test("with Load more reading the notes once more, Dismiss after it failed leaves the focus on the feed's body", async () => {
    const pending: Array<PendingRead> = [];

    await renderLoadedFeed("en", SERVER_FAILURE);
    notesReads.push(pendingRead(pending));

    const banner: HTMLElement = await failAction("more");
    const loadMore: HTMLElement = screen.getByTestId("notes-load-more");

    fireEvent.click(loadMore);
    await waitFor(() => {
      expect(loadMore).toBeDisabled();
    });
    expect(pending).toHaveLength(1);

    const dismiss: HTMLElement = dismissIn("en", banner);

    dismiss.focus();
    fireEvent.click(dismiss);

    expect(screen.queryByTestId("notes-action-error")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("notes-feed-body"));

    // The read answers: no notes after the ones on screen.
    await act(async () => {
      pending[0]!.resolve({ ...notesAnswer(), data: [] });
    });
  });

  /*
   * A private incident's public notes, none written yet: no feed is drawn
   * under the composer's place, only the header's refresh button - which a
   * failed refresh came from.
   */
  test("with no feed drawn, Dismiss after a failed refresh leaves the focus on the refresh button", async () => {
    let publicNoteReads: number = 0;

    getListMock.mockImplementation(async (...args: Array<unknown>) => {
      const request: { modelType?: unknown } = (args[0] || {}) as {
        modelType?: unknown;
      };

      if (request.modelType === IncidentPublicNote) {
        publicNoteReads++;

        if (publicNoteReads === 2) {
          throw SERVER_FAILURE;
        }
      }

      return { data: [], count: 0, skip: 0, limit: 10 };
    });

    const project: Project = new Project();
    project._id = "10000000-0000-4000-8000-000000000001";

    render(
      <I18nextProvider i18n={instances["en"]!}>
        <EventNotes<IncidentPublicNote>
          modelType={IncidentPublicNote}
          visibility="public"
          eventNoun="incident"
          parentIdField="incidentId"
          parentId={INCIDENT_ID}
          currentProject={project}
          isPrivateEvent={true}
        />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(publicNoteReads).toBe(1);
      expect(screen.queryByTestId("notes-loading")).toBeNull();
    });
    expect(screen.queryByTestId("notes-feed-body")).toBeNull();

    const banner: HTMLElement = await failAction("refresh");
    const dismiss: HTMLElement = dismissIn("en", banner);

    dismiss.focus();
    fireEvent.click(dismiss);

    expect(screen.queryByTestId("notes-action-error")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("notes-refresh"));
  });
});

/*
 * THE FEED ONCE A LATER READ ANSWERS, AND ITS TOOLBAR AFTER A FAILED SORT OR
 * SEARCH (#7646).
 *
 * The banner of a failed read stayed up until it was dismissed: Load more
 * pressed again brought the notes under "Couldn't load more notes.", and a
 * refresh that answered left "Couldn't refresh the notes." over them. A
 * read the reader starts that answers takes it away now - Load more a Load
 * more's alone - and a focus on it goes where Dismiss puts it.
 *
 * A sort or a search set what the toolbar draws before its read, so a read
 * that failed left the toolbar describing notes that were not on screen:
 * the sort button named the order it had failed to read in, and pressing it
 * again read the order on screen instead of trying again; a search that
 * never ran counted its matches. The toolbar describes the notes on screen
 * now, and takes a sort or a search up when its notes arrive.
 *
 * And the count by the feed's heading is in the reader's digits.
 */

// Three notes older than the incident's two: the page after them.
const OLDER_NOTES: Array<Record<string, unknown>> = [
  {
    _id: "70000000-0000-4000-8000-000000000013",
    incidentId: INCIDENT_ID,
    note: "Opened a ticket with the certificate authority.",
    createdAt: new Date("2026-09-10T09:00:00.000Z"),
    postedAt: new Date("2026-09-10T09:00:00.000Z"),
  },
  {
    _id: "70000000-0000-4000-8000-000000000014",
    incidentId: INCIDENT_ID,
    note: "Saw the first handshake failures.",
    createdAt: new Date("2026-09-09T09:00:00.000Z"),
    postedAt: new Date("2026-09-09T09:00:00.000Z"),
  },
  {
    _id: "70000000-0000-4000-8000-000000000015",
    incidentId: INCIDENT_ID,
    note: "The alert fired on lb-eu-west-1b.",
    createdAt: new Date("2026-09-08T09:00:00.000Z"),
    postedAt: new Date("2026-09-08T09:00:00.000Z"),
  },
];

// Every note, the incident's two and the three before them.
const ALL_NOTES_COUNT: number = NOTES.length + OLDER_NOTES.length;

// An answer of `rows`, of `count` notes in all.
const answerOf: (
  rows: Array<Record<string, unknown>>,
  count: number,
) => NotesAnswer = (
  rows: Array<Record<string, unknown>>,
  count: number,
): NotesAnswer => {
  return {
    data: rows.map((row: Record<string, unknown>) => {
      return Object.assign(new IncidentInternalNote(), row);
    }),
    count,
    skip: 0,
    limit: 25,
  };
};

// A read that answers with `answer`.
const answeredRead: (answer: NotesAnswer) => NotesRead = (
  answer: NotesAnswer,
): NotesRead => {
  return (): Promise<NotesAnswer> => {
    return Promise.resolve(answer);
  };
};

// What the feed asked for in a read of the notes.
interface NotesRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  sort: Record<string, SortOrder>;
  skip: number;
  limit: number;
}

// The reads of `modelType`'s notes, in the order the feed made them.
const notesRequests: (modelType?: unknown) => Array<NotesRequest> = (
  modelType: unknown = IncidentInternalNote,
): Array<NotesRequest> => {
  return getListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as NotesRequest;
    })
    .filter((request: NotesRequest) => {
      return request.modelType === modelType;
    });
};

// The words a read searched the notes for, or null when it read every note.
const searchOf: (request: NotesRequest) => string | null = (
  request: NotesRequest,
): string | null => {
  const condition: unknown = request.query["note"];

  return condition instanceof Search ? String(condition.value) : null;
};

const NEWEST_FIRST: Record<string, SortOrder> = {
  postedAt: SortOrder.Descending,
};
const OLDEST_FIRST: Record<string, SortOrder> = {
  postedAt: SortOrder.Ascending,
};

const noteCards: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.queryAllByTestId("note-card");
};

const whatFailed: () => string = (): string => {
  return (
    within(screen.getByTestId("notes-action-error")).getByTestId(
      "notes-action-error-what-failed",
    ).textContent || ""
  );
};

describe("the notes feed's banner, once a later read answers", () => {
  test("after a failed Load more, Load more pressed again brings the notes, and the banner goes", async () => {
    await renderLoadedFeed("en", SERVER_FAILURE);
    notesReads.push(answeredRead(answerOf(OLDER_NOTES, ALL_NOTES_COUNT)));

    await failAction("more");
    fireEvent.click(screen.getByTestId("notes-load-more"));

    await waitFor(() => {
      expect(noteCards()).toHaveLength(ALL_NOTES_COUNT);
    });
    expect(screen.queryByTestId("notes-action-error")).toBeNull();
    // Every note is on screen: nothing more to load.
    expect(screen.queryByTestId("notes-load-more")).toBeNull();
  });

  test("after a failed refresh, the refresh pressed again reads the notes, and the banner goes", async () => {
    await renderLoadedFeed("en", SERVER_FAILURE);
    notesReads.push(answeredRead(notesWithMoreAnswer()));

    await failAction("refresh");
    const refresh: HTMLElement = screen.getByTestId("notes-refresh");

    fireEvent.click(refresh);
    expect(refresh).toBeDisabled();

    await waitFor(() => {
      expect(notesReadCount()).toBe(3);
      expect(refresh).not.toBeDisabled();
    });
    expect(screen.queryByTestId("notes-action-error")).toBeNull();
    expect(noteCards()).toHaveLength(NOTES.length);
  });

  /*
   * Load more reads the next page of the notes on screen, for their own
   * search: the one that failed has still not run after it.
   */
  test("after a failed search, Load more brings the next page of the notes on screen - not of the search that failed - and the search's banner stays", async () => {
    await renderLoadedFeed("en", SERVER_FAILURE);
    notesReads.push(answeredRead(answerOf(OLDER_NOTES, ALL_NOTES_COUNT)));

    await failAction("search");
    fireEvent.click(screen.getByTestId("notes-load-more"));

    await waitFor(() => {
      expect(noteCards()).toHaveLength(ALL_NOTES_COUNT);
    });

    const loadMore: NotesRequest = notesRequests()[2]!;
    expect(loadMore.skip).toBe(NOTES.length);
    expect(searchOf(loadMore)).toBeNull();
    expect(loadMore.sort).toEqual(NEWEST_FIRST);

    expect(whatFailed()).toBe(ACTION_FAILED.search);
    expect(screen.getByTestId("notes-summary")).toHaveTextContent(
      `${ALL_NOTES_COUNT} notes`,
    );
  });

  /*
   * A public note whose notification is on its way: the feed reads its
   * notes again in the background every so often, for the notes on screen,
   * and none of those reads is the reader's.
   */
  test("a background re-read goes on with the notes on screen, and leaves the banner up", async () => {
    let publicNoteReads: number = 0;

    getListMock.mockImplementation(async (...args: Array<unknown>) => {
      const request: NotesRequest = args[0] as NotesRequest;

      if (request.modelType !== IncidentPublicNote) {
        return { data: [], count: 0, skip: 0, limit: 10 };
      }

      publicNoteReads++;

      // The search fails; every other read answers.
      if (searchOf(request) !== null) {
        throw SERVER_FAILURE;
      }

      return {
        data: NOTES.map((row: Record<string, unknown>) => {
          return Object.assign(new IncidentPublicNote(), row, {
            subscriberNotificationStatusOnNoteCreated:
              StatusPageSubscriberNotificationStatus.Pending,
          });
        }),
        count: NOTES.length,
        skip: 0,
        limit: 25,
      };
    });

    const project: Project = new Project();
    project._id = "10000000-0000-4000-8000-000000000001";

    render(
      <I18nextProvider i18n={instances["en"]!}>
        <EventNotes<IncidentPublicNote>
          modelType={IncidentPublicNote}
          visibility="public"
          eventNoun="incident"
          parentIdField="incidentId"
          parentId={INCIDENT_ID}
          currentProject={project}
        />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(noteCards()).toHaveLength(NOTES.length);
    });

    await failAction("search");
    const readsByTheBanner: number = publicNoteReads;

    // Two reads in the background since: the first has answered.
    await waitFor(
      () => {
        expect(publicNoteReads).toBeGreaterThanOrEqual(readsByTheBanner + 2);
      },
      { timeout: 3000 },
    );

    const since: Array<NotesRequest> =
      notesRequests(IncidentPublicNote).slice(readsByTheBanner);
    expect(
      since.map((request: NotesRequest) => {
        return searchOf(request);
      }),
    ).toEqual(
      since.map(() => {
        return null;
      }),
    );
    expect(whatFailed()).toBe(ACTION_FAILED.search);
    expect(screen.getByTestId("notes-summary")).toHaveTextContent(
      `${NOTES.length} notes`,
    );
  });
});

/*
 * The banner goes away as Dismiss takes it away: a focus left on it fell to
 * the page, and goes where Dismiss puts it instead.
 */
describe("the notes feed's banner, taken away by a read while the focus is on it", () => {
  test("Load more's notes arrive: the focus goes to the feed's body, where Dismiss puts it while Load more reads - never to the page", async () => {
    const pending: Array<PendingRead> = [];

    await renderLoadedFeed("en", SERVER_FAILURE);
    notesReads.push(pendingRead(pending));

    const banner: HTMLElement = await failAction("more");
    const dismiss: HTMLElement = dismissIn("en", banner);

    dismiss.focus();
    // A click that leaves the focus where it was, as a click does in Safari.
    fireEvent.click(screen.getByTestId("notes-load-more"));
    expect(pending).toHaveLength(1);
    expect(document.activeElement).toBe(dismiss);

    await act(async () => {
      pending[0]!.resolve(answerOf(OLDER_NOTES, ALL_NOTES_COUNT));
    });

    expect(noteCards()).toHaveLength(ALL_NOTES_COUNT);
    expect(screen.queryByTestId("notes-action-error")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByTestId("notes-feed-body"));
  });

  test("a refresh answers with the focus on a Load more's banner: it goes to Load more, one key from trying again", async () => {
    await renderLoadedFeed("en", SERVER_FAILURE);
    notesReads.push(answeredRead(notesWithMoreAnswer()));

    const banner: HTMLElement = await failAction("more");
    const copy: HTMLElement = within(
      within(banner).getByTestId("error-reference"),
    ).getByRole("button");

    copy.focus();
    fireEvent.click(screen.getByTestId("notes-refresh"));

    await waitFor(() => {
      expect(screen.queryByTestId("notes-action-error")).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByTestId("notes-load-more"));
  });
});

describe("the notes feed's toolbar, after a failed sort or search", () => {
  test("after a failed sort, the sort button names the order of the notes on screen, and pressing it again tries the order asked for once more", async () => {
    await renderLoadedFeed("en", SERVER_FAILURE);
    const oldestFirst: NotesAnswer = notesWithMoreAnswer();
    oldestFirst.data.reverse();
    notesReads.push(answeredRead(oldestFirst));

    await failAction("sort");
    expect(notesRequests()[1]!.sort).toEqual(OLDEST_FIRST);

    // Newest first, as the notes on screen are, and as Load more goes on.
    const sort: HTMLElement = screen.getByTestId("notes-sort");
    expect(sort).toHaveTextContent("Newest first");
    expect(noteCards()[0]).toHaveTextContent(NOTES[0]!["note"] as string);
    expect(screen.getByTestId("notes-load-more")).toHaveTextContent(
      "Show older notes",
    );

    fireEvent.click(sort);

    await waitFor(() => {
      expect(sort).toHaveTextContent("Oldest first");
    });
    expect(notesRequests()[2]!.sort).toEqual(OLDEST_FIRST);
    expect(noteCards()[0]).toHaveTextContent(NOTES[1]!["note"] as string);
    expect(screen.getByTestId("notes-load-more")).toHaveTextContent(
      "Show newer notes",
    );
    expect(screen.queryByTestId("notes-action-error")).toBeNull();
  });

  // The button names the order of the notes on screen: nothing else is taken up.
  test("after a failed sort, the refresh reads the order on screen", async () => {
    await renderLoadedFeed("en", SERVER_FAILURE);
    notesReads.push(answeredRead(notesWithMoreAnswer()));

    await failAction("sort");
    fireEvent.click(screen.getByTestId("notes-refresh"));

    await waitFor(() => {
      expect(notesReadCount()).toBe(3);
      expect(screen.getByTestId("notes-refresh")).not.toBeDisabled();
    });
    expect(notesRequests()[2]!.sort).toEqual(NEWEST_FIRST);
    expect(screen.getByTestId("notes-sort")).toHaveTextContent("Newest first");
    expect(screen.queryByTestId("notes-action-error")).toBeNull();
  });

  /*
   * A read from the top started before a sort's notes arrive - a search
   * here - reads in the order asked for, so the sort is not lost to it.
   */
  test("a search typed while a sort's notes are on their way is read in the order asked for", async () => {
    const pending: Array<PendingRead> = [];
    notesReads.push(answeredRead(notesWithMoreAnswer()), pendingRead(pending));

    renderNotesPage("en");
    await waitFor(() => {
      expect(noteCards()).toHaveLength(NOTES.length);
    });

    const sort: HTMLElement = screen.getByTestId("notes-sort");
    fireEvent.click(sort);
    expect(pending).toHaveLength(1);
    // On their way: the button names the order on screen still.
    expect(sort).toHaveTextContent("Newest first");

    fireEvent.change(screen.getByTestId("notes-search"), {
      target: { value: "cert" },
    });
    await waitFor(
      () => {
        expect(notesReadCount()).toBe(3);
      },
      { timeout: 3000 },
    );

    const search: NotesRequest = notesRequests()[2]!;
    expect(searchOf(search)).toBe("cert");
    expect(search.sort).toEqual(OLDEST_FIRST);

    await waitFor(() => {
      expect(sort).toHaveTextContent("Oldest first");
    });

    // The sort's own answer, come late, is dropped.
    await act(async () => {
      pending[0]!.resolve(notesWithMoreAnswer());
    });
    expect(sort).toHaveTextContent("Oldest first");
    expect(screen.getByTestId("notes-summary")).toHaveTextContent(
      `${NOTES.length} matches`,
    );
  });

  // Load more goes on with the notes on screen, in their order.
  test("Load more pressed while a sort's notes are on their way reads on in the order on screen", async () => {
    const pending: Array<PendingRead> = [];
    notesReads.push(
      answeredRead(notesWithMoreAnswer()),
      pendingRead(pending),
      answeredRead(answerOf(OLDER_NOTES, ALL_NOTES_COUNT)),
    );

    renderNotesPage("en");
    await waitFor(() => {
      expect(noteCards()).toHaveLength(NOTES.length);
    });

    fireEvent.click(screen.getByTestId("notes-sort"));
    expect(pending).toHaveLength(1);
    fireEvent.click(screen.getByTestId("notes-load-more"));

    await waitFor(() => {
      expect(noteCards()).toHaveLength(ALL_NOTES_COUNT);
    });

    const loadMore: NotesRequest = notesRequests()[2]!;
    expect(loadMore.skip).toBe(NOTES.length);
    expect(loadMore.sort).toEqual(NEWEST_FIRST);
    expect(screen.getByTestId("notes-sort")).toHaveTextContent("Newest first");
  });

  test("after a failed search, the toolbar counts the notes on screen - never matches of a search that did not run - and the refresh tries the search again", async () => {
    await renderLoadedFeed("en", SERVER_FAILURE);
    const total: number = notesWithMoreAnswer().count;

    await failAction("search");

    const summary: HTMLElement = screen.getByTestId("notes-summary");
    expect(summary).toHaveTextContent(`${total} notes`);
    expect(summary).not.toHaveTextContent("match");
    // Counted by the heading too, as every note is.
    expect(screen.getByTestId("notes-count")).toHaveTextContent(String(total));
    // The box keeps the reader's words.
    expect(screen.getByTestId("notes-search")).toHaveValue("cert");

    notesReads.push(answeredRead(answerOf([NOTES[0]!], 1)));
    fireEvent.click(screen.getByTestId("notes-refresh"));

    await waitFor(() => {
      expect(screen.getByTestId("notes-summary")).toHaveTextContent("1 match");
    });
    expect(searchOf(notesRequests()[2]!)).toBe("cert");
    expect(noteCards()).toHaveLength(1);
    expect(screen.queryByTestId("notes-count")).toBeNull();
    expect(screen.queryByTestId("notes-action-error")).toBeNull();
  });

  /*
   * A search with no matches, cleared, and the read of every note fails:
   * the feed still shows the search's (no) matches, and its Clear search
   * has nothing left in the box to change.
   */
  test("Clear search, once clearing the search failed, reads every note again", async () => {
    notesReads.push(
      answeredRead(notesAnswer()),
      answeredRead(answerOf([], 0)),
      failingRead(SERVER_FAILURE),
    );

    renderNotesPage("en");
    await waitFor(() => {
      expect(noteCards()).toHaveLength(NOTES.length);
    });

    fireEvent.change(screen.getByTestId("notes-search"), {
      target: { value: "nothing like this" },
    });
    const empty: HTMLElement = await screen.findByTestId(
      "notes-search-empty",
      {},
      { timeout: 3000 },
    );

    fireEvent.click(
      within(empty).getByRole("button", { name: "Clear search" }),
    );
    await screen.findByTestId("notes-action-error");
    expect(whatFailed()).toBe(ACTION_FAILED.search);
    expect(screen.getByTestId("notes-summary")).toHaveTextContent("0 matches");
    expect(screen.getByTestId("notes-search")).toHaveValue("");

    fireEvent.click(
      within(screen.getByTestId("notes-search-empty")).getByRole("button", {
        name: "Clear search",
      }),
    );

    await waitFor(() => {
      expect(noteCards()).toHaveLength(NOTES.length);
    });
    expect(notesReadCount()).toBe(4);
    expect(searchOf(notesRequests()[3]!)).toBeNull();
    expect(screen.queryByTestId("notes-action-error")).toBeNull();
  });
});

/*
 * The count by the feed's heading was drawn as it came: a Latin "2" on a
 * Persian page, whose count over the notes read "۲ یادداشت".
 */
describe("the count by the notes feed's heading", () => {
  test.each([
    ["en", "2"],
    ["de", "2"],
    ["fa", "۲"],
  ])(
    "in %s, it is written in the reader's digits: %s",
    async (language: string, two: string) => {
      renderNotesPage(language);
      await waitFor(() => {
        expect(noteCards()).toHaveLength(NOTES.length);
      });

      expect(screen.getByTestId("notes-count").textContent).toBe(two);
      // As the count over the notes writes it.
      expect(screen.getByTestId("notes-summary")).toHaveTextContent(two);
    },
  );
});
