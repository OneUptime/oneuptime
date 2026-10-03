/** @timezone UTC */

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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Add Public Note" and "Add Private Note" in the Actions menu of the
 * incident, alert, scheduled maintenance and both episode feeds open the
 * event's Notes page composer in a dialog (EventNoteComposerDialog). They
 * used to open a hand-built two-step form per feed: write the note, press
 * Next, then a Summary page repeating it, with a required Posted At up front
 * and none of the templates, Draft with AI or who the note reaches.
 *
 * Rendered here with the real feeds, the real dialog, composer, template
 * menu, permission gates and note models; only the data layer is an
 * in-memory store, and the rich text editor, file picker, AI dialog,
 * audience summary and preview button are stand-ins with the same props.
 *
 * Pinned, for every note kind on every feed: one step, named after the
 * action; the note is saved on this event and project with the posting time
 * now unless it was backdated, and - on a public note - the notify flag the
 * box showed, always sent; the dialog closes and the feed is read again;
 * Cancel asks before a draft is lost; and nobody is offered a note their
 * permissions will refuse.
 */

type Row = Record<string, unknown>;

const store: Map<string, Array<Row>> = new Map();
const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const audienceRenderMock: MockFunction = getJestMockFunction();
const previewRenderMock: MockFunction = getJestMockFunction();
const templateVariablesMock: MockFunction = getJestMockFunction();

let currentPermissions: Array<string> = [];
let isMasterAdmin: boolean = true;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
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
        return currentPermissions;
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
      getName: (): string => {
        return "Maya Chen";
      },
      getEmail: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

// The rich text editor as a textarea that takes `initialValue` once per mount.
jest.mock("../../../UI/Components/Markdown.tsx/MarkdownEditor", () => {
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (props: {
      initialValue?: string;
      placeholder?: string;
      onChange?: (value: string) => void;
    }): ReactElement => {
      const [value, setValue] = ReactModule.useState<string>(
        props.initialValue || "",
      );
      return (
        <textarea
          aria-label="Note text"
          placeholder={props.placeholder}
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

jest.mock("../../../UI/Components/FilePicker/FilePicker", () => {
  return {
    __esModule: true,
    default: (props: {
      initialValue?: Array<unknown>;
      onChange?: (files: Array<unknown>) => void;
    }): ReactElement => {
      return (
        <div data-testid="file-picker">
          <button
            type="button"
            onClick={() => {
              const FileModelClass: any = jest.requireActual(
                "../../../Models/DatabaseModels/File",
              ) as any;
              const file: any = new FileModelClass.default();
              file._id = "72000000-0000-4000-8000-000000000009";
              file.name = "trace.log";
              file.fileType = "text/plain";
              props.onChange?.([...(props.initialValue || []), file]);
            }}
          >
            Add fake file
          </button>
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/AI/GenerateFromAIModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      onSuccess: (text: string) => void;
    }): ReactElement => {
      return (
        <div data-testid="ai-modal">
          <span>{props.title}</span>
          <button
            type="button"
            onClick={() => {
              props.onSuccess("Drafted by AI.");
            }}
          >
            Use AI draft
          </button>
        </div>
      );
    },
  };
});

// Keep the tests about the note dialog, not the timeline's markdown.
jest.mock("../../../UI/Components/Feed/Feed", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="rendered-feed" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/SubscriberAudienceSummary",
  () => {
    return {
      __esModule: true,
      default: (props: {
        request: { incidentId: { toString: () => string } };
        dataTestId?: string;
      }): ReactElement => {
        audienceRenderMock(props);
        return (
          <div data-testid={props.dataTestId}>
            Will notify the incident&apos;s status pages
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/SubscriberNotificationPreviewButton",
  () => {
    return {
      __esModule: true,
      default: (props: {
        dataTestId?: string;
        getRequest: () => unknown;
      }): ReactElement => {
        previewRenderMock(props);
        return (
          <button type="button" data-testid={props.dataTestId}>
            Preview notification
          </button>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentNoteTemplateVariables",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentNoteTemplateVariables",
    ) as Record<string, unknown>;
    return {
      ...actual,
      fetchIncidentNoteTemplateVariables: (...args: Array<unknown>) => {
        return templateVariablesMock(...args);
      },
    };
  },
);

import AlertFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertFeed";
import AlertEpisodeFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisodeFeed";
import IncidentFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed";
import IncidentEpisodeFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeFeed";
import ScheduledMaintenanceFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceFeed";
import AlertEpisodeFeed from "../../../Models/DatabaseModels/AlertEpisodeFeed";
import AlertEpisodeInternalNote from "../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertFeed from "../../../Models/DatabaseModels/AlertFeed";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AlertNoteTemplate from "../../../Models/DatabaseModels/AlertNoteTemplate";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeFeed from "../../../Models/DatabaseModels/IncidentEpisodeFeed";
import IncidentEpisodeInternalNote from "../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentFeed from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenanceFeed from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import ScheduledMaintenanceInternalNote from "../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceNoteTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";

const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const EVENT_ID: string = "20000000-0000-4000-8000-000000001042";
const OTHER_EVENT_ID: string = "20000000-0000-4000-8000-000000001029";
const NOTIFY_FLAG: string =
  "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";

type ModelClass = { new (): BaseModel };

interface NoteCase {
  menuText: "Add Public Note" | "Add Private Note";
  modelType: ModelClass;
  parentIdField: string;
  isPublic: boolean;
  submitLabel: string;
  templateModel: ModelClass;
  hasAttachments: boolean;
  hasAI: boolean;
  quietDescription?: string | undefined;
}

interface RenderOptions {
  eventId?: string | undefined;
  isNotifyingByDefault?: boolean | undefined;
}

interface FeedCase {
  name: string;
  feedModel: ModelClass;
  // The Actions menu, in order.
  actions: Array<string>;
  render: (options: RenderOptions) => ReactElement;
  notes: Array<NoteCase>;
}

function eventObjectId(options: RenderOptions): ObjectID {
  return new ObjectID(options.eventId || EVENT_ID);
}

const FEEDS: Array<FeedCase> = [
  {
    name: "Incident Feed",
    feedModel: IncidentFeed,
    actions: [
      "Execute Runbook",
      "Execute On-Call Policy",
      "Add Public Note",
      "Add Private Note",
    ],
    render: (options: RenderOptions): ReactElement => {
      return (
        <IncidentFeedElement
          incidentId={eventObjectId(options)}
          refreshToken={0}
          notifyStatusPageSubscribersByDefault={options.isNotifyingByDefault}
        />
      );
    },
    notes: [
      {
        menuText: "Add Public Note",
        modelType: IncidentPublicNote,
        parentIdField: "incidentId",
        isPublic: true,
        submitLabel: "Post update",
        templateModel: IncidentNoteTemplate,
        hasAttachments: true,
        hasAI: true,
        quietDescription:
          PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
      },
      {
        menuText: "Add Private Note",
        modelType: IncidentInternalNote,
        parentIdField: "incidentId",
        isPublic: false,
        submitLabel: "Add note",
        templateModel: IncidentNoteTemplate,
        hasAttachments: true,
        hasAI: true,
      },
    ],
  },
  {
    name: "Alert Feed",
    feedModel: AlertFeed,
    actions: ["Execute Runbook", "Execute On-Call Policy", "Add Private Note"],
    render: (options: RenderOptions): ReactElement => {
      return (
        <AlertFeedElement alertId={eventObjectId(options)} refreshToken={0} />
      );
    },
    notes: [
      {
        menuText: "Add Private Note",
        modelType: AlertInternalNote,
        parentIdField: "alertId",
        isPublic: false,
        submitLabel: "Add note",
        templateModel: AlertNoteTemplate,
        hasAttachments: true,
        hasAI: true,
      },
    ],
  },
  {
    name: "Scheduled Maintenance Feed",
    feedModel: ScheduledMaintenanceFeed,
    actions: ["Execute Runbook", "Add Public Note", "Add Private Note"],
    render: (options: RenderOptions): ReactElement => {
      return (
        <ScheduledMaintenanceFeedElement
          scheduledMaintenanceId={eventObjectId(options)}
          refreshToken={0}
          notifyStatusPageSubscribersByDefault={options.isNotifyingByDefault}
        />
      );
    },
    notes: [
      {
        menuText: "Add Public Note",
        modelType: ScheduledMaintenancePublicNote,
        parentIdField: "scheduledMaintenanceId",
        isPublic: true,
        submitLabel: "Post update",
        templateModel: ScheduledMaintenanceNoteTemplate,
        hasAttachments: true,
        hasAI: true,
        quietDescription:
          PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
      },
      {
        menuText: "Add Private Note",
        modelType: ScheduledMaintenanceInternalNote,
        parentIdField: "scheduledMaintenanceId",
        isPublic: false,
        submitLabel: "Add note",
        templateModel: ScheduledMaintenanceNoteTemplate,
        hasAttachments: true,
        hasAI: true,
      },
    ],
  },
  {
    name: "Incident Episode Feed",
    feedModel: IncidentEpisodeFeed,
    actions: ["Execute On-Call Policy", "Add Public Note", "Add Private Note"],
    render: (options: RenderOptions): ReactElement => {
      return (
        <IncidentEpisodeFeedElement
          incidentEpisodeId={eventObjectId(options)}
          refreshToken={0}
          notifyStatusPageSubscribersByDefault={options.isNotifyingByDefault}
        />
      );
    },
    notes: [
      {
        menuText: "Add Public Note",
        modelType: IncidentEpisodePublicNote,
        parentIdField: "incidentEpisodeId",
        isPublic: true,
        submitLabel: "Post update",
        templateModel: IncidentNoteTemplate,
        hasAttachments: true,
        hasAI: false,
        quietDescription:
          PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
      },
      {
        menuText: "Add Private Note",
        modelType: IncidentEpisodeInternalNote,
        parentIdField: "incidentEpisodeId",
        isPublic: false,
        submitLabel: "Add note",
        templateModel: IncidentNoteTemplate,
        // Episode private notes have no download route.
        hasAttachments: false,
        hasAI: false,
      },
    ],
  },
  {
    name: "Alert Episode Feed",
    feedModel: AlertEpisodeFeed,
    actions: ["Execute On-Call Policy", "Add Private Note"],
    render: (options: RenderOptions): ReactElement => {
      return (
        <AlertEpisodeFeedElement
          alertEpisodeId={eventObjectId(options)}
          refreshToken={0}
        />
      );
    },
    notes: [
      {
        menuText: "Add Private Note",
        modelType: AlertEpisodeInternalNote,
        parentIdField: "alertEpisodeId",
        isPublic: false,
        submitLabel: "Add note",
        templateModel: AlertNoteTemplate,
        hasAttachments: false,
        hasAI: false,
      },
    ],
  },
];

interface DialogCase {
  feed: FeedCase;
  note: NoteCase;
  label: string;
}

const DIALOGS: Array<DialogCase> = FEEDS.flatMap(
  (feed: FeedCase): Array<DialogCase> => {
    return feed.notes.map((note: NoteCase): DialogCase => {
      return { feed, note, label: `${feed.name}: ${note.menuText}` };
    });
  },
);

const PUBLIC_DIALOGS: Array<DialogCase> = DIALOGS.filter(
  (dialogCase: DialogCase): boolean => {
    return dialogCase.note.isPublic;
  },
);

function tableOf(modelType: ModelClass): Array<Row> {
  const name: string = new modelType().tableName || "";
  if (!store.has(name)) {
    store.set(name, []);
  }
  return store.get(name)!;
}

function seedTemplates(modelType: ModelClass): void {
  tableOf(modelType).push(
    {
      _id: "71000000-0000-4000-8000-000000000001",
      templateName: "Identified",
      note: "**Identified.** {{incident.title}} has a known cause.",
    },
    {
      _id: "71000000-0000-4000-8000-000000000002",
      templateName: "Resolved",
      note: "**Resolved.** Everything is back to normal.",
    },
  );
}

interface ListRequest {
  modelType: ModelClass;
  query: Record<string, unknown>;
}

function serveStore(): void {
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: ListRequest = args[0] as ListRequest;
    const rows: Array<Row> = tableOf(request.modelType);
    return {
      data: rows.map((row: Row) => {
        return Object.assign(new request.modelType(), row);
      }),
      count: rows.length,
      skip: 0,
      limit: 50,
    };
  });

  createMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { model: BaseModel } = args[0] as { model: BaseModel };
    return { data: request.model };
  });
}

function listRequestsFor(modelType: ModelClass): Array<ListRequest> {
  return getListMock.mock.calls
    .map((args: Array<unknown>): ListRequest => {
      return args[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType === modelType;
    });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderFeed(
  feed: FeedCase,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const view: RenderResult = render(feed.render(options));
  await flush();
  return view;
}

function actionsTrigger(): HTMLElement {
  return screen
    .getByText("Actions")
    .closest('[aria-haspopup="menu"]') as HTMLElement;
}

async function openActionsMenu(): Promise<HTMLElement> {
  fireEvent.click(actionsTrigger());
  return await screen.findByRole("menu");
}

async function openDialog(menuText: string): Promise<HTMLElement> {
  const menu: HTMLElement = await openActionsMenu();
  fireEvent.click(within(menu).getByRole("menuitem", { name: menuText }));
  await flush();
  return screen.getByRole("dialog", { name: menuText });
}

function editorIn(dialog: HTMLElement): HTMLTextAreaElement {
  return within(dialog).getByLabelText("Note text") as HTMLTextAreaElement;
}

function type(textarea: HTMLTextAreaElement, text: string): void {
  fireEvent.change(textarea, { target: { value: text } });
}

function submitButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByTestId("modal-footer-submit-button");
}

async function post(dialog: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(submitButton(dialog));
  });
  await flush();
}

function createdPayload(index: number = 0): Record<string, unknown> {
  const request: { model: BaseModel; modelType: ModelClass } = createMock.mock
    .calls[index]![0] as { model: BaseModel; modelType: ModelClass };
  // What ModelAPI would put on the wire.
  return JSON.parse(
    JSON.stringify(BaseModel.toJSON(request.model, request.modelType)),
  ) as Record<string, unknown>;
}

function createdModelType(index: number = 0): ModelClass {
  return (createMock.mock.calls[index]![0] as { modelType: ModelClass })
    .modelType;
}

beforeEach(() => {
  store.clear();
  window.localStorage.clear();
  currentPermissions = [Permission.ProjectOwner];
  isMasterAdmin = true;
  serveStore();
  templateVariablesMock.mockResolvedValue({
    "incident.title": "Checkout API returning 502s",
  } as never);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createMock.mockReset();
  audienceRenderMock.mockReset();
  previewRenderMock.mockReset();
  templateVariablesMock.mockReset();
  jest.restoreAllMocks();
});

describe("feed Actions: where the note actions sit", () => {
  test.each(FEEDS)(
    "$name lists its actions, the notes last",
    async (feed: FeedCase) => {
      await renderFeed(feed);
      const menu: HTMLElement = await openActionsMenu();

      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item: HTMLElement): string => {
            return item.textContent || "";
          }),
      ).toEqual(feed.actions);
    },
  );

  test.each(DIALOGS)(
    "$label wears the icon of who will read it",
    async (dialogCase: DialogCase) => {
      await renderFeed(dialogCase.feed);
      const menu: HTMLElement = await openActionsMenu();
      const item: HTMLElement = within(menu).getByRole("menuitem", {
        name: dialogCase.note.menuText,
      });

      // The same globe and lock the composer's audience badge wears.
      expect(item.querySelector("svg")).not.toBeNull();
    },
  );
});

describe.each(DIALOGS)("$label", (dialogCase: DialogCase) => {
  const feed: FeedCase = dialogCase.feed;
  const note: NoteCase = dialogCase.note;

  test("opens one step: the note's composer, in a dialog named after the action", async () => {
    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    expect(within(dialog).getByTestId("note-composer")).toBeInTheDocument();
    expect(within(dialog).getByTestId("note-audience")).toHaveTextContent(
      note.isPublic ? "Public" : "Private",
    );

    // No wizard: no Next, no Back, no Summary page, no review.
    expect(within(dialog).queryByRole("button", { name: "Next" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Back" })).toBeNull();
    expect(within(dialog).queryByText("Summary")).toBeNull();

    // The dialog's own footer: Cancel and the composer's action.
    expect(submitButton(dialog)).toHaveTextContent(note.submitLabel);
    expect(
      within(dialog).getByTestId("modal-footer-close-button"),
    ).toHaveTextContent("Cancel");

    // The composer's own Cancel and submit are not drawn a second time.
    expect(within(dialog).queryByTestId("note-submit")).toBeNull();
    expect(
      within(dialog).getAllByRole("button", { name: "Cancel" }),
    ).toHaveLength(1);
  });

  test("puts the cursor in the note", async () => {
    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    await waitFor(() => {
      expect(document.activeElement).toBe(editorIn(dialog));
    });
  });

  test("cannot post an empty or whitespace-only note", async () => {
    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    expect(submitButton(dialog)).toBeDisabled();

    type(editorIn(dialog), "   \n ");
    expect(submitButton(dialog)).toBeDisabled();

    type(editorIn(dialog), "Something real.");
    expect(submitButton(dialog)).toBeEnabled();
  });

  test("posts the note on this event and project, closes, and reads the feed again", async () => {
    await renderFeed(feed);
    const feedReadsBefore: number = listRequestsFor(feed.feedModel).length;
    const dialog: HTMLElement = await openDialog(note.menuText);

    type(editorIn(dialog), "We have rolled back the deploy.");
    await post(dialog);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createdModelType()).toBe(note.modelType);

    const payload: Record<string, unknown> = createdPayload();
    expect(payload["note"]).toBe("We have rolled back the deploy.");
    expect(payload[note.parentIdField]).toMatchObject({ value: EVENT_ID });
    expect(payload["projectId"]).toMatchObject({ value: PROJECT_ID });
    expect(payload["attachments"]).toBeUndefined();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: note.menuText })).toBeNull();
    });
    await waitFor(() => {
      expect(listRequestsFor(feed.feedModel).length).toBeGreaterThan(
        feedReadsBefore,
      );
    });
  });

  test("Ctrl+Enter in the note posts it, as on the Notes page", async () => {
    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    type(editorIn(dialog), "Posted from the keyboard.");
    await act(async () => {
      fireEvent.keyDown(editorIn(dialog), { key: "Enter", ctrlKey: true });
    });
    await flush();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createdPayload()["note"]).toBe("Posted from the keyboard.");
  });

  test("a refused post says why inside the dialog and keeps the draft", async () => {
    createMock.mockRejectedValueOnce(
      new Error("The note was refused.") as never,
    );

    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    type(editorIn(dialog), "Keep me.");
    await post(dialog);

    expect(within(dialog).getByTestId("note-composer-error")).toHaveTextContent(
      "The note was refused.",
    );
    expect(screen.getByRole("dialog", { name: note.menuText })).toBe(dialog);
    expect(editorIn(dialog)).toHaveValue("Keep me.");
  });

  test("Cancel closes an empty note straight away", async () => {
    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));

    expect(screen.queryByRole("dialog", { name: note.menuText })).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  test("Escape closes an empty note", async () => {
    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    fireEvent.keyDown(editorIn(dialog), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: note.menuText })).toBeNull();
  });

  test("Cancel with a draft asks first; Keep writing keeps every word", async () => {
    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    type(editorIn(dialog), "Half an update.");
    fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));

    const confirm: HTMLElement = screen.getByRole("dialog", {
      name: "Discard this draft?",
    });
    fireEvent.click(within(confirm).getByText("Keep writing"));

    expect(
      screen.queryByRole("dialog", { name: "Discard this draft?" }),
    ).toBeNull();
    expect(
      editorIn(screen.getByRole("dialog", { name: note.menuText })),
    ).toHaveValue("Half an update.");
  });

  test("discarding a draft closes the dialog and posts nothing", async () => {
    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    type(editorIn(dialog), "Half an update.");
    fireEvent.click(within(dialog).getByTestId("close-button"));

    const confirm: HTMLElement = screen.getByRole("dialog", {
      name: "Discard this draft?",
    });
    fireEvent.click(within(confirm).getByText("Discard draft"));

    expect(screen.queryByRole("dialog", { name: note.menuText })).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  test("a dialog opened again starts empty", async () => {
    await renderFeed(feed);
    let dialog: HTMLElement = await openDialog(note.menuText);

    type(editorIn(dialog), "Posted once.");
    await post(dialog);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: note.menuText })).toBeNull();
    });

    dialog = await openDialog(note.menuText);
    expect(editorIn(dialog)).toHaveValue("");
  });

  test("offers the note's templates, and a picked one goes into the note", async () => {
    seedTemplates(note.templateModel);
    await renderFeed(feed);
    const dialog: HTMLElement = await openDialog(note.menuText);

    type(editorIn(dialog), "Our words first.");
    fireEvent.click(within(dialog).getByTestId("note-template-menu-button"));

    const menu: HTMLElement = await screen.findByTestId("note-template-menu");
    // Drawn over the dialog, not inside its scrolling body.
    expect(dialog.contains(menu)).toBe(false);

    fireEvent.click(
      (await within(menu).findAllByText("Resolved"))[0]!.closest("button")!,
    );

    await waitFor(() => {
      expect(
        editorIn(screen.getByRole("dialog", { name: note.menuText })),
      ).toHaveValue(
        "Our words first.\n\n**Resolved.** Everything is back to normal.",
      );
    });
    expect(screen.queryByTestId("note-template-menu")).toBeNull();

    const templateRequest: ListRequest = listRequestsFor(
      note.templateModel,
    )[0]!;
    expect(String(templateRequest.query["projectId"])).toBe(PROJECT_ID);
  });

  if (note.hasAI) {
    test("drafts with AI into the note, inside the dialog", async () => {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog(note.menuText);

      fireEvent.click(within(dialog).getByTestId("note-ai-button"));
      fireEvent.click(await screen.findByText("Use AI draft"));

      expect(screen.queryByTestId("ai-modal")).toBeNull();
      expect(
        editorIn(screen.getByRole("dialog", { name: note.menuText })),
      ).toHaveValue("Drafted by AI.");
    });
  } else {
    test("offers no Draft with AI, as its Notes page does not", async () => {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog(note.menuText);

      expect(within(dialog).queryByTestId("note-ai-button")).toBeNull();
    });
  }

  if (note.hasAttachments) {
    test("attaches files to the note", async () => {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog(note.menuText);

      fireEvent.click(within(dialog).getByTestId("note-attach-button"));
      fireEvent.click(within(dialog).getByText("Add fake file"));
      type(editorIn(dialog), "With a log.");
      await post(dialog);

      expect(createdPayload()["attachments"]).toEqual([
        expect.objectContaining({
          _id: "72000000-0000-4000-8000-000000000009",
        }),
      ]);
    });
  } else {
    test("offers no attachments, which this note could never serve back", async () => {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog(note.menuText);

      expect(within(dialog).queryByTestId("note-attach-button")).toBeNull();
    });
  }

  if (note.isPublic) {
    test("the posting time is now, behind 'Posted now', closed until asked", async () => {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog(note.menuText);

      expect(
        within(dialog).getByTestId("note-posted-at-button"),
      ).toHaveTextContent("Posted now");
      expect(within(dialog).queryByTestId("note-posted-at-input")).toBeNull();
      expect(within(dialog).queryByText("Posted At")).toBeNull();

      type(editorIn(dialog), "Now.");
      await post(dialog);

      expect(createdPayload()["postedAt"]).toMatchObject({
        value: NOW.toISOString(),
      });
    });

    test("backdates the note to the time chosen", async () => {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog(note.menuText);

      fireEvent.click(within(dialog).getByTestId("note-posted-at-button"));
      fireEvent.change(within(dialog).getByTestId("note-posted-at-input"), {
        target: { value: "2026-09-14T17:05" },
      });
      type(editorIn(dialog), "Catching the status page up.");
      await post(dialog);

      expect(createdPayload()["postedAt"]).toMatchObject({
        value: "2026-09-14T17:05:00.000Z",
      });
    });

    test("notifies subscribers by default, and always says so in the request", async () => {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog(note.menuText);

      expect(within(dialog).getByTestId("note-notify-checkbox")).toBeChecked();

      type(editorIn(dialog), "Notifying.");
      await post(dialog);

      expect(createdPayload()[NOTIFY_FLAG]).toBe(true);
    });

    test("unticking the box posts the note quietly, with false - not nothing", async () => {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog(note.menuText);

      fireEvent.click(within(dialog).getByTestId("note-notify-checkbox"));
      type(editorIn(dialog), "Quietly.");
      await post(dialog);

      const payload: Record<string, unknown> = createdPayload();
      expect(Object.keys(payload)).toContain(NOTIFY_FLAG);
      expect(payload[NOTIFY_FLAG]).toBe(false);
    });

    test("an event that started without notifying starts unticked and says why", async () => {
      await renderFeed(feed, { isNotifyingByDefault: false });
      const dialog: HTMLElement = await openDialog(note.menuText);

      expect(
        within(dialog).getByTestId("note-notify-checkbox"),
      ).not.toBeChecked();
      expect(
        within(dialog).getByTestId("note-notify-description"),
      ).toHaveTextContent(note.quietDescription!);

      type(editorIn(dialog), "Quiet event.");
      await post(dialog);

      expect(createdPayload()[NOTIFY_FLAG]).toBe(false);
    });
  } else {
    test("is never sent to subscribers and has no posting time to set", async () => {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog(note.menuText);

      expect(within(dialog).queryByTestId("note-notify-checkbox")).toBeNull();
      expect(within(dialog).queryByTestId("note-posted-at-button")).toBeNull();

      type(editorIn(dialog), "For the team.");
      await post(dialog);

      const payload: Record<string, unknown> = createdPayload();
      expect(Object.keys(payload)).not.toContain(NOTIFY_FLAG);
      expect(payload["postedAt"]).toBeUndefined();
    });
  }
});

describe("the incident's public note dialog says who it reaches", () => {
  test("shows the incident's audience and Preview notification while notifying", async () => {
    await renderFeed(FEEDS[0]!);
    const dialog: HTMLElement = await openDialog("Add Public Note");

    expect(
      within(dialog).getByTestId("incident-public-note-audience"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("incident-public-note-preview-notification"),
    ).toBeInTheDocument();

    const audience: { request: { incidentId: { toString: () => string } } } =
      audienceRenderMock.mock.calls[
        audienceRenderMock.mock.calls.length - 1
      ]![0] as {
        request: { incidentId: { toString: () => string } };
      };
    expect(audience.request.incidentId.toString()).toBe(EVENT_ID);

    // Unticked, there is no one to show.
    fireEvent.click(within(dialog).getByTestId("note-notify-checkbox"));
    expect(
      within(dialog).queryByTestId("incident-public-note-audience"),
    ).toBeNull();
    expect(
      within(dialog).queryByTestId("incident-public-note-preview-notification"),
    ).toBeNull();
  });

  test("the preview is asked for the note as it is being written", async () => {
    await renderFeed(FEEDS[0]!);
    const dialog: HTMLElement = await openDialog("Add Public Note");

    type(editorIn(dialog), "Preview me.");

    const preview: { getRequest: () => Record<string, unknown> | null } =
      previewRenderMock.mock.calls[
        previewRenderMock.mock.calls.length - 1
      ]![0] as {
        getRequest: () => Record<string, unknown> | null;
      };
    const request: Record<string, unknown> | null = preview.getRequest();

    expect(request).not.toBeNull();
    expect(JSON.stringify(request)).toContain("Preview me.");
    expect(JSON.stringify(request)).toContain(EVENT_ID);
  });

  test("a picked template's placeholders are filled with the incident's values", async () => {
    seedTemplates(IncidentNoteTemplate);
    await renderFeed(FEEDS[0]!);
    const dialog: HTMLElement = await openDialog("Add Public Note");

    fireEvent.click(within(dialog).getByTestId("note-template-menu-button"));
    const menu: HTMLElement = await screen.findByTestId("note-template-menu");
    fireEvent.click(
      (await within(menu).findAllByText("Identified"))[0]!.closest("button")!,
    );

    await waitFor(() => {
      expect(
        editorIn(screen.getByRole("dialog", { name: "Add Public Note" })),
      ).toHaveValue(
        "**Identified.** Checkout API returning 502s has a known cause.",
      );
    });
    expect(String(templateVariablesMock.mock.calls[0]![0])).toBe(EVENT_ID);
  });

  test("the other public note dialogs show no incident audience", async () => {
    for (const feed of [FEEDS[2]!, FEEDS[3]!]) {
      await renderFeed(feed);
      const dialog: HTMLElement = await openDialog("Add Public Note");

      expect(
        within(dialog).queryByTestId("incident-public-note-audience"),
      ).toBeNull();
      cleanup();
    }
  });
});

describe("the notify default follows the event", () => {
  test.each(PUBLIC_DIALOGS)(
    "$label: a feed given no default notifies",
    async (dialogCase: DialogCase) => {
      await renderFeed(dialogCase.feed, { isNotifyingByDefault: undefined });
      const dialog: HTMLElement = await openDialog(dialogCase.note.menuText);

      expect(within(dialog).getByTestId("note-notify-checkbox")).toBeChecked();
    },
  );

  test.each(PUBLIC_DIALOGS)(
    "$label: a dialog opened after the default changes starts from the new one",
    async (dialogCase: DialogCase) => {
      const view: RenderResult = await renderFeed(dialogCase.feed, {
        isNotifyingByDefault: true,
      });

      view.rerender(dialogCase.feed.render({ isNotifyingByDefault: false }));
      await flush();
      let dialog: HTMLElement = await openDialog(dialogCase.note.menuText);
      expect(
        within(dialog).getByTestId("note-notify-checkbox"),
      ).not.toBeChecked();

      fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));

      view.rerender(dialogCase.feed.render({ isNotifyingByDefault: true }));
      await flush();
      dialog = await openDialog(dialogCase.note.menuText);
      expect(within(dialog).getByTestId("note-notify-checkbox")).toBeChecked();
    },
  );
});

describe("a draft never follows the reader to another event", () => {
  test.each(DIALOGS)(
    "$label: moving to another event closes the dialog, and coming back does not reopen it",
    async (dialogCase: DialogCase) => {
      const view: RenderResult = await renderFeed(dialogCase.feed);
      const dialog: HTMLElement = await openDialog(dialogCase.note.menuText);
      type(editorIn(dialog), "Written on the first event.");

      view.rerender(dialogCase.feed.render({ eventId: OTHER_EVENT_ID }));
      await flush();

      expect(
        screen.queryByRole("dialog", { name: dialogCase.note.menuText }),
      ).toBeNull();

      view.rerender(dialogCase.feed.render({ eventId: EVENT_ID }));
      await flush();

      expect(
        screen.queryByRole("dialog", { name: dialogCase.note.menuText }),
      ).toBeNull();
      expect(createMock).not.toHaveBeenCalled();
    },
  );
});

describe("nobody is offered a note their permissions will refuse", () => {
  test.each(DIALOGS)(
    "$label is locked, saying why, for someone who may only read",
    async (dialogCase: DialogCase) => {
      isMasterAdmin = false;
      currentPermissions = [Permission.Viewer];

      await renderFeed(dialogCase.feed);
      const menu: HTMLElement = await openActionsMenu();
      const item: HTMLElement = within(menu).getByRole("menuitem", {
        name: dialogCase.note.menuText,
      });

      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveAccessibleDescription(
        /You do not have permission to create/,
      );

      fireEvent.click(item);
      await flush();

      expect(
        screen.queryByRole("dialog", { name: dialogCase.note.menuText }),
      ).toBeNull();
    },
  );

  test.each(FEEDS)(
    "$name offers no note while the permissions have not arrived, and accuses nobody",
    async (feed: FeedCase) => {
      isMasterAdmin = false;
      currentPermissions = [];

      await renderFeed(feed);
      const menu: HTMLElement = await openActionsMenu();
      const items: Array<string> = within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        });

      expect(items).not.toContain("Add Public Note");
      expect(items).not.toContain("Add Private Note");
      // The other actions are not the notes' to hide.
      expect(items.length).toBe(
        feed.actions.filter((action: string): boolean => {
          return !action.startsWith("Add ");
        }).length,
      );
    },
  );

  test.each(DIALOGS)(
    "$label: a project member writes through the real permission checks",
    async (dialogCase: DialogCase) => {
      isMasterAdmin = false;
      currentPermissions = [Permission.ProjectMember];

      await renderFeed(dialogCase.feed);
      const dialog: HTMLElement = await openDialog(dialogCase.note.menuText);

      type(editorIn(dialog), "From a member.");
      await post(dialog);

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(createdModelType()).toBe(dialogCase.note.modelType);
    },
  );
});
