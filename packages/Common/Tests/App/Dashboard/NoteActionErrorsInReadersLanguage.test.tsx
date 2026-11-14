/** @timezone UTC */

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
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { drawLine, getDrawnText } from "../../Helpers/BidiLayout";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A NOTE'S POST, EDIT, DELETE AND APPROVAL, WHEN THEY FAIL (#7647).
 *
 * Each drew API.getFriendlyMessage's answer as it came: English on every
 * language's page, a failure nobody explained without #6836's explanation
 * and its reference, and on a Persian page an English refusal with its
 * full stop at its start. Each now reads like the notes feed's own
 * failures (ErrorMessageText, #7570 and #7620): words of their own are in
 * the reader's language where it has them, and read the way they are
 * written where it does not; an error nobody explained says what failed -
 * the line has no heading that says it - then why and what to do next, with
 * the reference to give. Each is one live region, as before.
 *
 * The same goes for a public note page whose event did not load
 * (useParentNotifyDefault), drawn as the Templates menu's failure is: what
 * failed is said, not "This did not finish.". And a note's name for a
 * screen reader - its author and its time - is joined the way the reader's
 * language joins two parts, with nothing left hanging when it has no time.
 *
 * Every language here is the Dashboard's own locale file, as it ships, read
 * by a self-hosted server's member: the reference goes to whoever runs the
 * server, and nothing is said about its logs.
 */

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
const getItemMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
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
      getCurrentPlan: (): null => {
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
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (props: {
      initialValue?: string;
      onChange?: (value: string) => void;
    }): ReactElement => {
      const [value, setValue] = ReactModule.useState<string>(
        props.initialValue || "",
      );
      return (
        <textarea
          aria-label="Note text"
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setValue(event.target.value);
            props.onChange?.(event.target.value);
          }}
        />
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
 * A public note page's feed, which it draws once its event has loaded: a
 * stand-in, since what is under test is the page's failure before it.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotes",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="event-notes-feed" />;
      },
    };
  },
);

import EventNoteComposerDialog from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNoteComposerDialog";
import { EventNoteKind } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNoteKind";
import {
  getNoteFullTimeLabel,
  getNotesCopy,
  NoteRecord,
  NoteVisibility,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import NoteCard, {
  NoteCardApproval,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteCard";
import NoteApprovalPanel, {
  ComponentProps as NoteApprovalPanelProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/PublicNoteApproval/NoteApprovalPanel";
import IncidentEpisodePublicNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/PublicNote";
import IncidentPublicNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/PublicNote";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ScheduledMaintenancePublicNotePage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/PublicNote";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import {
  getUnexplainedServerErrorMessage,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { PublicNoteApprovalState } from "../../../Types/StatusPage/PublicNoteApproval";
import { joinSentences } from "../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";

// The languages each failure is read in, beside English.
const LANGUAGES: Array<string> = ["de", "fa"];

const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const INCIDENT_ID: string = "20000000-0000-4000-8000-000000001042";

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

// Words of their own, which the Dashboard's languages word.
const OWN_WORDS: string = "You don't have access to this list";

const REFUSAL: HTTPErrorResponse = new HTTPErrorResponse(
  403,
  { message: OWN_WORDS },
  {},
);

// Words of their own, in English only, as most of the server's answers are.
const ENGLISH_ONLY_WORDS: string =
  "This incident was deleted, so its notes are gone.";

const ENGLISH_ONLY_REFUSAL: HTTPErrorResponse = new HTTPErrorResponse(
  400,
  { message: ENGLISH_ONLY_WORDS },
  {},
);

// The marks of the isolate a <bdi> is to a browser laying out a line.
const LRI: string = String.fromCharCode(0x2066);
const RLI: string = String.fromCharCode(0x2067);
const FSI: string = String.fromCharCode(0x2068);
const PDI: string = String.fromCharCode(0x2069);

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "fa", "ja"]) {
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
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 50,
  } as never);
  getItemMock.mockResolvedValue(null as never);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createMock.mockReset();
  jest.restoreAllMocks();
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

// What a reader sees of an element's words.
const textOf: (element: Element) => string = (element: Element): string => {
  return withoutIsolateMarks(element.textContent || "");
};

/*
 * An element's text as a browser lays it out: each <bdi> the isolate it is
 * (LRI, RLI or FSI ... PDI), as the Unicode Bidirectional Algorithm reads
 * it.
 */
const asLaidOut: (node: Node) => string = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }

  if (!(node instanceof Element)) {
    return "";
  }

  const inner: string = Array.from(node.childNodes)
    .map((child: ChildNode): string => {
      return asLaidOut(child);
    })
    .join("");

  if (node.tagName !== "BDI") {
    return inner;
  }

  const direction: string | null = node.getAttribute("dir");
  const opening: string =
    direction === "ltr" ? LRI : direction === "rtl" ? RLI : FSI;

  return `${opening}${inner}${PDI}`;
};

// The line as a page read from the right draws it, left to right.
const drawnFromTheRight: (line: Element) => string = (
  line: Element,
): string => {
  return withoutIsolateMarks(getDrawnText(drawLine(asLaidOut(line), "rtl")));
};

// The approval's calls throw what the server answered, as its words (PublicNoteApprovalUtil).
const approvalCallFailure: (response: HTTPErrorResponse) => Error = (
  response: HTTPErrorResponse,
): Error => {
  return new Error(API.getFriendlyMessage(response));
};

/*
 * A failure the server could not explain, as the line says it in
 * `language`: what failed, then why and what to do next, then the
 * reference with its copy button - and never API.getFriendlyMessage's
 * English sentence, or "This did not finish.".
 */
const expectServerFailureExplained: (
  line: HTMLElement,
  language: string,
  whatFailed: string,
) => void = (line: HTMLElement, language: string, whatFailed: string): void => {
  expect(textOf(within(line).getByTestId("error-what-failed"))).toBe(
    wordsIn(language, whatFailed),
  );
  expect(textOf(within(line).getByTestId("error-why-and-next"))).toBe(
    joinSentences([
      wordsIn(language, UnexplainedErrorWords.serverWhy),
      wordsIn(
        language,
        UnexplainedErrorWords.serverNextWithReferenceSelfHosted,
      ),
    ]),
  );

  // The reference as written, left to right, with its copy button.
  const reference: HTMLElement = within(line).getByTestId("error-reference");
  expect(reference.querySelector("code")).toHaveTextContent(REFERENCE);
  expect(reference.querySelector("code")).toHaveAttribute("dir", "ltr");
  expect(within(reference).getAllByRole("button")).toHaveLength(1);

  // A member is told nothing about the server's logs.
  expect(within(line).queryByTestId("error-where-to-look")).toBeNull();

  const text: string = textOf(line);
  expect(text).not.toContain(getUnexplainedServerErrorMessage(REFERENCE));
  expect(text).not.toContain(
    wordsIn(language, UnexplainedErrorWords.didNotFinish),
  );

  if (language !== "en") {
    for (const english of [
      whatFailed,
      UnexplainedErrorWords.serverWhy,
      UnexplainedErrorWords.didNotFinish,
    ]) {
      expect({ language, english, left: text.includes(english) }).toEqual({
        language,
        english,
        left: false,
      });
    }
  }
};

// Words the server wrote itself, in the reader's language, as the line's own.
const expectOwnWordsInLanguage: (
  line: HTMLElement,
  language: string,
) => void = (line: HTMLElement, language: string): void => {
  expect(textOf(line)).toBe(wordsIn(language, OWN_WORDS));
  expect(textOf(line)).not.toContain(OWN_WORDS);
  // Not an error nobody explained, and not set apart from the page.
  expect(within(line).queryByTestId("error-explanation")).toBeNull();
  expect(line.querySelector("bdi")).toBeNull();
};

/*
 * English words Persian has not worded, on a Persian page: set apart, read
 * left to right, with their full stop at their end - not at their start.
 */
const expectEnglishReadAsWritten: (line: HTMLElement) => void = (
  line: HTMLElement,
): void => {
  expect(readDashboardLocale("fa")[ENGLISH_ONLY_WORDS]).toBeUndefined();

  const words: HTMLElement | null = line.querySelector("bdi");

  expect(words).toHaveAttribute("dir", "ltr");
  expect(words?.textContent).toBe(ENGLISH_ONLY_WORDS);
  // Nothing of the sentence is left outside its isolate.
  expect(textOf(line)).toBe(ENGLISH_ONLY_WORDS);
  expect(within(line).queryByTestId("error-explanation")).toBeNull();

  const drawn: string = drawnFromTheRight(line);
  expect(drawn).toBe(ENGLISH_ONLY_WORDS);
  expect(drawn.startsWith(".")).toBe(false);
};

// What React says of an element HTML does not allow where it is drawn.
const MISPLACED_ELEMENT_WARNING: RegExp =
  /validateDOMNesting|cannot (appear as|be) a descendant of|cannot contain a nested/;

const misplacedElementWarnings: (
  consoleError: ReturnType<typeof jest.spyOn>,
) => Array<Array<unknown>> = (
  consoleError: ReturnType<typeof jest.spyOn>,
): Array<Array<unknown>> => {
  return consoleError.mock.calls.filter((call: Array<unknown>) => {
    return MISPLACED_ELEMENT_WARNING.test(call.map(String).join(" "));
  });
};

// The line is the one live region where it is drawn: never two alerts.
const expectOneAlert: (where: HTMLElement, line: HTMLElement) => void = (
  where: HTMLElement,
  line: HTMLElement,
): void => {
  expect(within(where).getAllByRole("alert")).toEqual([line]);
};

const project: () => Project = (): Project => {
  const current: Project = new Project();
  current._id = "10000000-0000-4000-8000-000000000001";
  return current;
};

const diego: () => User = (): User => {
  const author: User = new User();
  author._id = "80000000-0000-4000-8000-000000000002";
  author.name = new Name("Diego Ramos");
  return author;
};

const NOTE_TEXT: string = "Rolled back the 14:05 deploy.";

const noteWritten: (at: Date | null) => NoteRecord = (
  at: Date | null,
): NoteRecord => {
  return {
    _id: "a1b2c3d4-0000-4000-8000-000000000020",
    note: NOTE_TEXT,
    ...(at ? { createdAt: at } : {}),
    createdByUser: diego(),
  };
};

/*
 * ---------------------------------------------------------------------------
 * Posting a note
 * ---------------------------------------------------------------------------
 */

describe("posting a note", () => {
  const privateKind: () => EventNoteKind<IncidentInternalNote> =
    (): EventNoteKind<IncidentInternalNote> => {
      return {
        modelType: IncidentInternalNote,
        visibility: "private",
        eventNoun: "incident",
        parentIdField: "incidentId",
        parentId: new ObjectID(INCIDENT_ID),
        templates: { modelType: IncidentNoteTemplate },
      };
    };

  // A public note in a project that asks for its public notes to be approved.
  const publicKindWithApproval: () => EventNoteKind<IncidentPublicNote> =
    (): EventNoteKind<IncidentPublicNote> => {
      return {
        modelType: IncidentPublicNote,
        visibility: "public",
        eventNoun: "incident",
        parentIdField: "incidentId",
        parentId: new ObjectID(INCIDENT_ID),
        subscriberNotifications: {
          isNotifyingByDefault: true,
          quietDescription: "Quiet because the incident was declared quietly.",
        },
        templates: { modelType: IncidentNoteTemplate },
        approval: { apiPath: "/incident-public-note" },
      };
    };

  /*
   * The Add Note dialog in `language`, a note typed and posted, and the
   * post refused with `failure`: the dialog, and the composer's error line.
   */
  const postFailing: (
    language: string,
    failure: unknown,
    kind?: EventNoteKind<IncidentInternalNote | IncidentPublicNote>,
  ) => Promise<{ dialog: HTMLElement; line: HTMLElement }> = async (
    language: string,
    failure: unknown,
    kind: EventNoteKind<
      IncidentInternalNote | IncidentPublicNote
    > = privateKind(),
  ): Promise<{ dialog: HTMLElement; line: HTMLElement }> => {
    createMock.mockRejectedValueOnce(failure as never);

    render(
      <I18nextProvider i18n={instances[language]!}>
        <EventNoteComposerDialog
          kind={kind}
          onClose={() => {}}
          onPosted={() => {}}
        />
      </I18nextProvider>,
    );

    const dialog: HTMLElement = screen.getByRole("dialog");

    if (kind.approval) {
      // The project's approval is read before the note is sent for it.
      await within(dialog).findByTestId("note-composer-approval-notice");
    }

    fireEvent.change(within(dialog).getByLabelText("Note text"), {
      target: { value: "Paged the edge on-call." },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    const line: HTMLElement = await within(dialog).findByTestId(
      "note-composer-error",
    );

    expect(createMock).toHaveBeenCalledTimes(1);

    return { dialog, line };
  };

  test.each(LANGUAGES)(
    "in %s, words the server wrote itself are in the reader's language, the composer's one alert",
    async (language: string) => {
      const { dialog, line } = await postFailing(language, REFUSAL);

      expectOwnWordsInLanguage(line, language);
      expect(line).toHaveAttribute("role", "alert");
      expectOneAlert(dialog, line);
      // The draft is kept, to post again.
      expect(within(dialog).getByLabelText("Note text")).toHaveValue(
        "Paged the edge on-call.",
      );
    },
  );

  test("on a Persian page, English words the language has not worded read left to right, with their full stop at their end", async () => {
    const { line } = await postFailing("fa", ENGLISH_ONLY_REFUSAL);

    expectEnglishReadAsWritten(line);
  });

  test.each(["en", ...LANGUAGES])(
    "in %s, a failure the server could not explain says the note was not posted, why, what to do next and the reference",
    async (language: string) => {
      const { dialog, line } = await postFailing(language, SERVER_FAILURE);

      expectServerFailureExplained(line, language, "Couldn't post the note.");
      expectOneAlert(dialog, line);
    },
  );

  // Block lines and a copy button, in the line's span: phrasing content.
  test("the explanation sits in the composer's line as HTML allows", async () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest.spyOn(
      console,
      "error",
    );

    const { line } = await postFailing("en", SERVER_FAILURE);

    expect(within(line).getByTestId("error-explanation")).toBeInTheDocument();
    expect(misplacedElementWarnings(consoleError)).toEqual([]);
  });

  test.each(LANGUAGES)(
    "in %s, a public note that waits for approval says it was not sent for approval",
    async (language: string) => {
      jest.spyOn(API, "post").mockResolvedValue({
        data: { isRequired: true, steps: [] },
      } as never);

      const { line } = await postFailing(
        language,
        SERVER_FAILURE,
        publicKindWithApproval(),
      );

      expectServerFailureExplained(
        line,
        language,
        "Couldn't send the note for approval.",
      );
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Editing and deleting a note
 * ---------------------------------------------------------------------------
 */

describe("editing and deleting a note", () => {
  interface CardOptions {
    language: string;
    onSaveEdit?: (() => Promise<void>) | undefined;
    onDelete?: (() => Promise<void>) | undefined;
    approval?: NoteCardApproval | undefined;
  }

  // A note's card in a feed, which opens its edit composer when asked.
  const FeedCard: FunctionComponent<CardOptions> = (
    props: CardOptions,
  ): ReactElement => {
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const visibility: NoteVisibility = props.approval ? "public" : "private";

    return (
      <ul>
        <NoteCard
          note={noteWritten(new Date(NOW.getTime() - 20 * 60 * 1000))}
          visibility={visibility}
          copy={getNotesCopy(
            visibility,
            "incident",
            dashboardTranslator(props.language),
          )}
          now={NOW}
          isLastInFeed={true}
          editGate={{ isShown: true, isDisabled: false }}
          deleteGate={{ isShown: true, isDisabled: false }}
          isEditing={isEditing}
          onStartEdit={() => {
            setIsEditing(true);
          }}
          onCancelEdit={() => {
            setIsEditing(false);
          }}
          onSaveEdit={async () => {
            await props.onSaveEdit?.();
          }}
          onDelete={async () => {
            await props.onDelete?.();
          }}
          isPostedAtEditable={false}
          approval={props.approval}
        />
      </ul>
    );
  };

  const renderCard: (options: CardOptions) => HTMLElement = (
    options: CardOptions,
  ): HTMLElement => {
    render(
      <I18nextProvider i18n={instances[options.language]!}>
        <FeedCard {...options} />
      </I18nextProvider>,
    );

    return screen.getByTestId("note-card");
  };

  // Picks `action` from the note's actions menu, in the reader's words.
  const pickAction: (
    card: HTMLElement,
    language: string,
    action: string,
  ) => Promise<void> = async (
    card: HTMLElement,
    language: string,
    action: string,
  ): Promise<void> => {
    fireEvent.click(
      within(card).getByRole("button", {
        name: wordsIn(language, "Note actions"),
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: wordsIn(language, action) }),
    );
  };

  /*
   * The note's card in `language`, its edit saved and refused with
   * `failure`: the card, and the edit composer's error line.
   */
  const editFailing: (
    language: string,
    failure: unknown,
    approval?: NoteCardApproval,
  ) => Promise<{ card: HTMLElement; line: HTMLElement }> = async (
    language: string,
    failure: unknown,
    approval?: NoteCardApproval,
  ): Promise<{ card: HTMLElement; line: HTMLElement }> => {
    const card: HTMLElement = renderCard({
      language,
      approval,
      onSaveEdit: (): Promise<void> => {
        return Promise.reject(failure);
      },
    });

    await pickAction(card, language, "Edit note");

    const composer: HTMLElement =
      await within(card).findByTestId("note-edit-composer");

    await act(async () => {
      fireEvent.click(within(composer).getByTestId("note-submit"));
    });

    const line: HTMLElement = await within(composer).findByTestId(
      "note-composer-error",
    );

    // Still editing, with what was typed.
    expect(within(composer).getByLabelText("Note text")).toHaveValue(NOTE_TEXT);

    return { card, line };
  };

  /*
   * The note's card in `language`, its delete confirmed and refused with
   * `failure`: the dialog, and its error.
   */
  const deleteFailing: (
    language: string,
    failure: unknown,
  ) => Promise<{ dialog: HTMLElement; line: HTMLElement }> = async (
    language: string,
    failure: unknown,
  ): Promise<{ dialog: HTMLElement; line: HTMLElement }> => {
    const card: HTMLElement = renderCard({
      language,
      onDelete: (): Promise<void> => {
        return Promise.reject(failure);
      },
    });

    await pickAction(card, language, "Delete note");

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    const line: HTMLElement = await within(dialog).findByTestId("modal-error");

    // The note is kept, and so is the dialog, to try again.
    expect(within(card).getByText(NOTE_TEXT)).toBeInTheDocument();

    return { dialog, line };
  };

  // A public note in a project that asks for its edits to be approved.
  const heldEditApproval: () => NoteCardApproval = (): NoteCardApproval => {
    return {
      state: PublicNoteApprovalState.Published,
      isRequired: true,
      isEditHeld: true,
      canEdit: true,
      onApprove: async () => {},
      onReject: async () => {},
      onResubmit: async () => {},
      onWithdrawEdit: async () => {},
    };
  };

  describe("an edit", () => {
    test.each(LANGUAGES)(
      "in %s, words the server wrote itself are in the reader's language, the card's one alert",
      async (language: string) => {
        const { card, line } = await editFailing(language, REFUSAL);

        expectOwnWordsInLanguage(line, language);
        expect(line).toHaveAttribute("role", "alert");
        expectOneAlert(card, line);
      },
    );

    test("on a Persian page, English words the language has not worded read left to right, with their full stop at their end", async () => {
      const { line } = await editFailing("fa", ENGLISH_ONLY_REFUSAL);

      expectEnglishReadAsWritten(line);
    });

    test.each(["en", ...LANGUAGES])(
      "in %s, a failure the server could not explain says the changes were not saved, why, what to do next and the reference",
      async (language: string) => {
        const { card, line } = await editFailing(language, SERVER_FAILURE);

        expectServerFailureExplained(
          line,
          language,
          "Couldn't save your changes.",
        );
        expectOneAlert(card, line);
      },
    );

    test.each(LANGUAGES)(
      "in %s, an edit that waits for approval says it was not sent for approval",
      async (language: string) => {
        const { line } = await editFailing(
          language,
          SERVER_FAILURE,
          heldEditApproval(),
        );

        expectServerFailureExplained(
          line,
          language,
          "Couldn't send the edit for approval.",
        );
      },
    );
  });

  describe("a delete", () => {
    test.each(LANGUAGES)(
      "in %s, words the server wrote itself are in the reader's language, the dialog's one alert",
      async (language: string) => {
        const { dialog, line } = await deleteFailing(language, REFUSAL);

        expectOwnWordsInLanguage(line, language);
        expect(line).toHaveAttribute("role", "alert");
        expectOneAlert(dialog, line);
      },
    );

    test("on a Persian page, English words the language has not worded read left to right, with their full stop at their end", async () => {
      const { line } = await deleteFailing("fa", ENGLISH_ONLY_REFUSAL);

      expectEnglishReadAsWritten(line);
    });

    test.each(["en", ...LANGUAGES])(
      "in %s, a failure the server could not explain says the note was not deleted, why, what to do next and the reference",
      async (language: string) => {
        const { dialog, line } = await deleteFailing(language, SERVER_FAILURE);

        expectServerFailureExplained(
          line,
          language,
          "Couldn't delete the note.",
        );
        expectOneAlert(dialog, line);
      },
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * A public note's approval
 * ---------------------------------------------------------------------------
 */

describe("a public note's approval", () => {
  const renderPanel: (
    language: string,
    props: Partial<NoteApprovalPanelProps>,
  ) => HTMLElement = (
    language: string,
    props: Partial<NoteApprovalPanelProps>,
  ): HTMLElement => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <NoteApprovalPanel
          state={PublicNoteApprovalState.WaitingForApproval}
          isRequired={true}
          canEdit={true}
          onApprove={async () => {}}
          onReject={async () => {}}
          onResubmit={async () => {}}
          onWithdrawEdit={async () => {}}
          {...props}
        />
      </I18nextProvider>,
    );

    return screen.getByTestId("note-approval-panel");
  };

  // Waiting for the reader, who may approve or reject it.
  const waitingForTheReader: Partial<NoteApprovalPanelProps> = {
    state: PublicNoteApprovalState.WaitingForApproval,
    summary: {
      noteId: "a1b2c3d4-0000-4000-8000-000000000020",
      state: PublicNoteApprovalState.WaitingForApproval,
      isEdit: false,
      approvals: [],
      canApprove: true,
      canReject: true,
    },
  };

  /*
   * A rejected note sent again (or, once approval is not asked for,
   * published) and refused with `failure`: the panel, and its error line.
   */
  const resubmitFailing: (
    language: string,
    failure: Error,
    isRequired?: boolean,
  ) => Promise<{ panel: HTMLElement; line: HTMLElement }> = async (
    language: string,
    failure: Error,
    isRequired: boolean = true,
  ): Promise<{ panel: HTMLElement; line: HTMLElement }> => {
    const panel: HTMLElement = renderPanel(language, {
      state: PublicNoteApprovalState.Rejected,
      isRequired,
      onResubmit: (): Promise<void> => {
        return Promise.reject(failure);
      },
    });

    await act(async () => {
      fireEvent.click(within(panel).getByTestId("note-approval-resubmit"));
    });

    const line: HTMLElement = await within(panel).findByTestId(
      "note-approval-error",
    );

    return { panel, line };
  };

  /*
   * One of the approval's dialogs - Approve, Reject or Withdraw edit -
   * confirmed and refused: the dialog, and its error.
   */
  const confirmFailing: (
    button: string,
    fillIn?: (dialog: HTMLElement) => void,
  ) => Promise<{ dialog: HTMLElement; line: HTMLElement }> = async (
    button: string,
    fillIn?: (dialog: HTMLElement) => void,
  ): Promise<{ dialog: HTMLElement; line: HTMLElement }> => {
    fireEvent.click(screen.getByTestId(button));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    fillIn?.(dialog);

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    const line: HTMLElement = await within(dialog).findByTestId("modal-error");

    return { dialog, line };
  };

  test.each(LANGUAGES)(
    "in %s, words the server wrote itself are in the reader's language, the panel's one alert",
    async (language: string) => {
      const { panel, line } = await resubmitFailing(
        language,
        approvalCallFailure(REFUSAL),
      );

      expectOwnWordsInLanguage(line, language);
      expect(line).toHaveAttribute("role", "alert");
      expectOneAlert(panel, line);
    },
  );

  test("on a Persian page, English words the language has not worded read left to right, with their full stop at their end", async () => {
    const { line } = await resubmitFailing(
      "fa",
      approvalCallFailure(ENGLISH_ONLY_REFUSAL),
    );

    expectEnglishReadAsWritten(line);
  });

  test.each(["en", ...LANGUAGES])(
    "in %s, sending a rejected note again, a failure the server could not explain says it was not sent for approval, why, what to do next and the reference",
    async (language: string) => {
      const { panel, line } = await resubmitFailing(
        language,
        approvalCallFailure(SERVER_FAILURE),
      );

      expectServerFailureExplained(
        line,
        language,
        "Couldn't send the note for approval.",
      );
      expectOneAlert(panel, line);
    },
  );

  // Block lines and a copy button, in the panel's paragraph: phrasing content.
  test("the explanation sits in the panel's paragraph as HTML allows", async () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest.spyOn(
      console,
      "error",
    );

    const { line } = await resubmitFailing(
      "en",
      approvalCallFailure(SERVER_FAILURE),
    );

    expect(line.tagName).toBe("P");
    expect(within(line).getByTestId("error-explanation")).toBeInTheDocument();
    expect(misplacedElementWarnings(consoleError)).toEqual([]);
  });

  test.each(LANGUAGES)(
    "in %s, publishing a note once approval is not asked for, the failure says it was not published",
    async (language: string) => {
      const { line } = await resubmitFailing(
        language,
        approvalCallFailure(SERVER_FAILURE),
        false,
      );

      expectServerFailureExplained(
        line,
        language,
        "Couldn't publish the note.",
      );
    },
  );

  test.each(LANGUAGES)(
    "in %s, Approve's dialog says the note was not approved - and so does the panel once the dialog is closed",
    async (language: string) => {
      renderPanel(language, {
        ...waitingForTheReader,
        onApprove: (): Promise<void> => {
          return Promise.reject(approvalCallFailure(SERVER_FAILURE));
        },
      });

      const { dialog, line } = await confirmFailing("note-approval-approve");

      expectServerFailureExplained(
        line,
        language,
        "Couldn't approve the note.",
      );
      expectOneAlert(dialog, line);

      // Closed, the panel says what failed: the approval, not the dialog.
      fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));

      const panel: HTMLElement = screen.getByTestId("note-approval-panel");
      const panelLine: HTMLElement = await within(panel).findByTestId(
        "note-approval-error",
      );

      expect(screen.queryByRole("dialog")).toBeNull();
      expectServerFailureExplained(
        panelLine,
        language,
        "Couldn't approve the note.",
      );
    },
  );

  test.each(LANGUAGES)(
    "in %s, Reject's dialog says the note was not rejected",
    async (language: string) => {
      renderPanel(language, {
        ...waitingForTheReader,
        onReject: (): Promise<void> => {
          return Promise.reject(approvalCallFailure(SERVER_FAILURE));
        },
      });

      const { dialog, line } = await confirmFailing(
        "note-approval-reject",
        (rejectDialog: HTMLElement): void => {
          fireEvent.change(within(rejectDialog).getByRole("textbox"), {
            target: { value: "The ETA is wrong." },
          });
        },
      );

      expectServerFailureExplained(line, language, "Couldn't reject the note.");
      expectOneAlert(dialog, line);
    },
  );

  test.each(LANGUAGES)(
    "in %s, Withdraw edit's dialog says the edit was not withdrawn",
    async (language: string) => {
      renderPanel(language, {
        state: PublicNoteApprovalState.EditWaitingForApproval,
        pendingNote: "Monitoring. A fix is live.",
        onWithdrawEdit: (): Promise<void> => {
          return Promise.reject(approvalCallFailure(SERVER_FAILURE));
        },
      });

      const { dialog, line } = await confirmFailing(
        "note-approval-withdraw-edit",
      );

      expectServerFailureExplained(
        line,
        language,
        "Couldn't withdraw the edit.",
      );
      expectOneAlert(dialog, line);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * A public note page whose event did not load
 * ---------------------------------------------------------------------------
 */

describe.each([
  ["an incident", IncidentPublicNotePage],
  ["a scheduled maintenance event", ScheduledMaintenancePublicNotePage],
  ["an incident episode", IncidentEpisodePublicNotePage],
])(
  "%s's public notes page whose event did not load",
  (_name: string, Page: FunctionComponent<PageComponentProps>) => {
    test.each(["en", ...LANGUAGES])(
      "in %s, says the public notes were not loaded, why, what to do next and the reference - and draws no feed",
      async (language: string) => {
        jest
          .spyOn(Navigation, "getLastParamAsObjectID")
          .mockReturnValue(new ObjectID(INCIDENT_ID));
        getItemMock.mockRejectedValue(SERVER_FAILURE as never);

        render(
          <I18nextProvider i18n={instances[language]!}>
            <Page
              pageRoute={new Route("/dashboard/notes")}
              currentProject={project()}
              hasPaymentMethod={true}
            />
          </I18nextProvider>,
        );

        const failure: HTMLElement =
          await screen.findByTestId("error-explanation");

        expectServerFailureExplained(
          failure,
          language,
          "Couldn't load the public notes.",
        );
        expect(screen.queryByTestId("event-notes-feed")).toBeNull();
      },
    );
  },
);

/*
 * ---------------------------------------------------------------------------
 * A note's name for a screen reader
 * ---------------------------------------------------------------------------
 */

describe("a note's name for a screen reader", () => {
  const WRITTEN_AT: Date = new Date(NOW.getTime() - 20 * 60 * 1000);

  const renderNote: (language: string, at: Date | null) => HTMLElement = (
    language: string,
    at: Date | null,
  ): HTMLElement => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <ul>
          <NoteCard
            note={noteWritten(at)}
            visibility="private"
            copy={getNotesCopy(
              "private",
              "incident",
              dashboardTranslator(language),
            )}
            now={NOW}
            isLastInFeed={true}
            editGate={{ isShown: false, isDisabled: false }}
            deleteGate={{ isShown: false, isDisabled: false }}
            isEditing={false}
            onStartEdit={() => {}}
            onCancelEdit={() => {}}
            onSaveEdit={async () => {}}
            onDelete={async () => {}}
            isPostedAtEditable={false}
          />
        </ul>
      </I18nextProvider>,
    );

    return screen.getByRole("article");
  };

  test.each([
    ["en", ", "],
    ["fa", "، "],
    ["ja", "、"],
  ])(
    "in %s, its author and its time are joined as the language joins two parts (%p)",
    (language: string, separator: string) => {
      const name: string = `Diego Ramos${separator}${getNoteFullTimeLabel(
        WRITTEN_AT,
      )}`;

      expect(renderNote(language, WRITTEN_AT)).toHaveAttribute(
        "aria-label",
        name,
      );
      expect(screen.getByRole("article", { name })).toBeInTheDocument();
    },
  );

  test.each(["en", "fa", "ja"])(
    "in %s, a note with no time is named by its author alone",
    (language: string) => {
      expect(renderNote(language, null)).toHaveAttribute(
        "aria-label",
        "Diego Ramos",
      );
    },
  );
});

/*
 * What the failures guard against: drawn bare on a page read from the
 * right, an English sentence's full stop is drawn at its start.
 */
test("negative control: on a page read from the right, English words drawn bare have their full stop at their start", () => {
  const drawn: string = withoutIsolateMarks(
    getDrawnText(drawLine(ENGLISH_ONLY_WORDS, "rtl")),
  );

  expect(drawn.startsWith(".")).toBe(true);
  expect(drawn).not.toBe(ENGLISH_ONLY_WORDS);
});
