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
 * The notes feed every incident, alert, scheduled maintenance and episode
 * note page is built on (Components/EventNotes/EventNotes). Rendered with the
 * real note models, the real permission gates and the real menus; only the
 * data layer is an in-memory store, and the rich text editor, the file
 * picker, the AI dialog and the confirm dialog are stand-ins that expose the
 * same props.
 *
 * What is pinned: the feed asks for exactly this event's notes; a new note is
 * saved with what the composer showed (the notify flag always sent, never
 * left to the server's default); templates and AI drafts land in the
 * composer without losing what was typed; edits, deletes and notification
 * retries hit the right record and refresh the feed; and nobody is offered an
 * action their permissions will refuse.
 */

// Short timings so the debounce and the background refresh can be observed.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil",
    ) as Record<string, unknown>;
    return {
      ...actual,
      NOTES_SEARCH_DEBOUNCE_MS: 20,
      NOTIFICATION_POLL_INTERVAL_MS: 80,
    };
  },
);

type Row = Record<string, unknown>;

const store: Map<string, Array<Row>> = new Map();

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const updateMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const deleteMock: MockFunction = getJestMockFunction();

let currentPermissions: Array<string> = [];
let isMasterAdmin: boolean = true;

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
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return updateMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      deleteItem: (...args: Array<unknown>): unknown => {
        return deleteMock(...args);
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

jest.mock("../../../UI/Utils/Clipboard", () => {
  return {
    __esModule: true,
    default: {
      copyToClipboard: async (): Promise<boolean> => {
        return true;
      },
    },
  };
});

/*
 * The rich text editor as a textarea: same props, same callback, and it
 * takes `initialValue` once per mount the way the real one does.
 */
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

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <div data-testid="markdown">{props.text}</div>;
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
          <span>
            {(props.initialValue || []).length} files already attached
          </span>
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

type CapturedAIProps = {
  title: string;
  description?: string;
  templates: Array<unknown>;
  onGenerate: (data: unknown) => Promise<string>;
  onSuccess: (text: string) => void;
  onClose: () => void;
};

let capturedAIProps: CapturedAIProps | null = null;

jest.mock("../../../UI/Components/AI/GenerateFromAIModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedAIProps): ReactElement => {
      capturedAIProps = props;
      return (
        <div data-testid="ai-modal">
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

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      description: string | ReactElement;
      submitButtonText?: string;
      closeButtonText?: string;
      error?: string;
      onSubmit: () => void;
      onClose?: () => void;
    }): ReactElement => {
      return (
        <div role="dialog" aria-label={props.title}>
          <h2>{props.title}</h2>
          <div>{props.description}</div>
          {props.error && <p role="alert">{props.error}</p>}
          {props.onClose && (
            <button type="button" onClick={props.onClose}>
              {props.closeButtonText || "Cancel"}
            </button>
          )}
          <button type="button" onClick={props.onSubmit}>
            {props.submitButtonText || "OK"}
          </button>
        </div>
      );
    },
  };
});

import EventNotes, {
  ComponentProps as EventNotesProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotes";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FileModel from "../../../Models/DatabaseModels/File";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import MimeType from "../../../Types/File/MimeType";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import { FormType } from "../../../UI/Components/Forms/ModelForm";

const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const INCIDENT_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000001042",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000001029",
);
const QUIET_DESCRIPTION: string =
  "Unticked by default because status page subscribers were not notified when this incident was declared.";
const SETTINGS_ROUTE: string = "/dashboard/p/incidents/settings/note-templates";
const SIBLING_ROUTE: string = "/dashboard/p/incidents/i/internal-notes";

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function noteId(n: number): string {
  return `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function person(n: number, name: string): User {
  const user: User = new User();
  user._id = `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@example.com`);
  return user;
}

const MAYA: User = person(1, "Maya Chen");
const SAM: User = person(2, "Sam Rivera");

function tableOf(modelType: { new (): BaseModel }): Array<Row> {
  const name: string = new modelType().tableName || "";
  if (!store.has(name)) {
    store.set(name, []);
  }
  return store.get(name)!;
}

function seedPublicNotes(): void {
  const rows: Array<Row> = tableOf(IncidentPublicNote);
  rows.push(
    {
      _id: noteId(1),
      incidentId: INCIDENT_ID,
      note: "Monitoring. A fix is live.",
      createdAt: ago(12 * MINUTE),
      postedAt: ago(12 * MINUTE),
      createdByUser: MAYA,
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Success,
    },
    {
      _id: noteId(2),
      incidentId: INCIDENT_ID,
      note: "Identified. An expired certificate.",
      createdAt: ago(48 * MINUTE),
      postedAt: ago(48 * MINUTE),
      createdByUser: SAM,
      attachments: [
        Object.assign(new FileModel(), {
          _id: "72000000-0000-4000-8000-000000000001",
          name: "lb-errors.png",
          fileType: MimeType.png,
        }),
      ],
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessage: "The SMTP relay refused.",
    },
    {
      _id: noteId(3),
      incidentId: INCIDENT_ID,
      note: "Investigating reports of failed payments.",
      createdAt: ago(DAY + 2 * HOUR),
      postedAt: ago(DAY + 2 * HOUR),
      postedFromSlackMessageId: "C1:1.2",
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Success,
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Failed,
      subscriberNotificationStatusMessageOnNoteUpdated: "Update bounced.",
    },
    {
      _id: noteId(4),
      incidentId: OTHER_INCIDENT_ID,
      note: "A note on another incident.",
      createdAt: ago(5 * MINUTE),
      postedAt: ago(5 * MINUTE),
      createdByUser: MAYA,
    },
  );
}

function seedPrivateNotes(): void {
  tableOf(IncidentInternalNote).push(
    {
      _id: noteId(11),
      incidentId: INCIDENT_ID,
      note: "Rotated the cert on lb-eu-west-1b.",
      createdAt: ago(9 * MINUTE),
      createdByUser: SAM,
    },
    {
      _id: noteId(12),
      incidentId: INCIDENT_ID,
      note: "Paged the edge on-call.",
      createdAt: ago(3 * DAY),
      createdByUser: MAYA,
    },
  );
}

function seedTemplates(count: number): void {
  const rows: Array<Row> = tableOf(IncidentNoteTemplate);
  const names: Array<string> = ["Identified", "Investigating", "Resolved"];
  for (let i: number = 0; i < count; i++) {
    rows.push({
      _id: `71000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      templateName: names[i] || `Template ${i + 1}`,
      note: `## ${names[i] || `Template ${i + 1}`}\nTemplate body ${i + 1}.`,
    });
  }
}

type ListRequest = {
  modelType: { new (): BaseModel };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, SortOrder>;
  limit: number;
  skip: number;
};

function matches(row: Row, query: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(query)) {
    if (key === "projectId") {
      continue;
    }
    if (condition instanceof Search) {
      if (
        !String(row[key] ?? "")
          .toLowerCase()
          .includes(condition.value.toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    if (String(row[key]) !== String(condition)) {
      return false;
    }
  }
  return true;
}

function serveStore(): void {
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: ListRequest = args[0] as ListRequest;
    const [sortKey, sortOrder] = (Object.entries(request.sort || {})[0] || [
      "createdAt",
      SortOrder.Descending,
    ]) as [string, SortOrder];
    const rows: Array<Row> = tableOf(request.modelType)
      .filter((row: Row) => {
        return matches(row, request.query);
      })
      .sort((a: Row, b: Row) => {
        if (sortKey === "templateName") {
          return String(a[sortKey]).localeCompare(String(b[sortKey]));
        }
        const aTime: number = a[sortKey]
          ? new Date(a[sortKey] as Date).getTime()
          : 0;
        const bTime: number = b[sortKey]
          ? new Date(b[sortKey] as Date).getTime()
          : 0;
        return sortOrder === SortOrder.Descending
          ? bTime - aTime
          : aTime - bTime;
      });
    return {
      data: rows
        .slice(request.skip, request.skip + request.limit)
        .map((row: Row) => {
          return Object.assign(new request.modelType(), row);
        }),
      count: rows.length,
      skip: request.skip,
      limit: request.limit,
    };
  });

  let created: number = 100;

  createMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { model: BaseModel; modelType: { new (): BaseModel } } =
      args[0] as { model: BaseModel; modelType: { new (): BaseModel } };
    created++;
    tableOf(request.modelType).push({
      ...(request.model as unknown as Row),
      _id: noteId(created),
      createdAt: NOW,
      createdByUser: MAYA,
    });
    return { data: request.model };
  });

  updateMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { model: BaseModel; modelType: { new (): BaseModel } } =
      args[0] as { model: BaseModel; modelType: { new (): BaseModel } };
    const row: Row | undefined = tableOf(request.modelType).find((r: Row) => {
      return r["_id"] === request.model._id;
    });
    for (const [key, value] of Object.entries(
      request.model as unknown as Row,
    )) {
      if (value !== undefined && row) {
        row[key] = value;
      }
    }
    return { data: request.model };
  });

  updateByIdMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: {
      modelType: { new (): BaseModel };
      id: ObjectID;
      data: Row;
    } = args[0] as {
      modelType: { new (): BaseModel };
      id: ObjectID;
      data: Row;
    };
    const row: Row | undefined = tableOf(request.modelType).find((r: Row) => {
      return r["_id"] === request.id.toString();
    });
    if (row) {
      Object.assign(row, request.data);
    }
    return {};
  });

  deleteMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: { new (): BaseModel }; id: ObjectID } =
      args[0] as { modelType: { new (): BaseModel }; id: ObjectID };
    const rows: Array<Row> = tableOf(request.modelType);
    const index: number = rows.findIndex((r: Row) => {
      return r["_id"] === request.id.toString();
    });
    rows.splice(index, 1);
  });
}

function buildProject(): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID;
  return project;
}

const generateMock: MockFunction = getJestMockFunction();

function publicProps(
  overrides: Partial<EventNotesProps<IncidentPublicNote>> = {},
): EventNotesProps<IncidentPublicNote> {
  return {
    modelType: IncidentPublicNote,
    visibility: "public",
    eventNoun: "incident",
    parentIdField: "incidentId",
    parentId: INCIDENT_ID,
    currentProject: buildProject(),
    attachmentApiPath: "/incident-public-note/attachment",
    subscriberNotifications: {
      isNotifyingByDefault: true,
      quietDescription: QUIET_DESCRIPTION,
    },
    templates: {
      modelType: IncidentNoteTemplate,
      settingsRoute: new Route(SETTINGS_ROUTE),
    },
    ai: {
      title: "Generate Public Note with AI",
      description: "AI will draft a customer-facing note.",
      templates: [],
      generate: (...args: Array<unknown>): Promise<string> => {
        return generateMock(...args) as Promise<string>;
      },
    },
    siblingRoute: new Route(SIBLING_ROUTE),
    ...overrides,
  };
}

function privateProps(
  overrides: Partial<EventNotesProps<IncidentInternalNote>> = {},
): EventNotesProps<IncidentInternalNote> {
  return {
    modelType: IncidentInternalNote,
    visibility: "private",
    eventNoun: "incident",
    parentIdField: "incidentId",
    parentId: INCIDENT_ID,
    currentProject: buildProject(),
    attachmentApiPath: "/incident-internal-note/attachment",
    templates: { modelType: IncidentNoteTemplate },
    ...overrides,
  };
}

async function renderPublic(
  overrides: Partial<EventNotesProps<IncidentPublicNote>> = {},
): Promise<RenderResult> {
  const view: RenderResult = render(
    <EventNotes<IncidentPublicNote> {...publicProps(overrides)} />,
  );
  await waitFor(() => {
    expect(screen.queryByTestId("notes-loading")).toBeNull();
  });
  return view;
}

async function renderPrivate(
  overrides: Partial<EventNotesProps<IncidentInternalNote>> = {},
): Promise<RenderResult> {
  const view: RenderResult = render(
    <EventNotes<IncidentInternalNote> {...privateProps(overrides)} />,
  );
  await waitFor(() => {
    expect(screen.queryByTestId("notes-loading")).toBeNull();
  });
  return view;
}

function noteRequests(): Array<ListRequest> {
  return getListMock.mock.calls
    .map((args: Array<unknown>) => {
      return args[0] as ListRequest;
    })
    .filter((request: ListRequest) => {
      return request.modelType !== IncidentNoteTemplate;
    });
}

function templateRequests(): Array<ListRequest> {
  return getListMock.mock.calls
    .map((args: Array<unknown>) => {
      return args[0] as ListRequest;
    })
    .filter((request: ListRequest) => {
      return request.modelType === IncidentNoteTemplate;
    });
}

function cards(): Array<HTMLElement> {
  return screen.queryAllByTestId("note-card");
}

function card(text: string): HTMLElement {
  const match: HTMLElement | undefined = cards().find(
    (element: HTMLElement) => {
      return element.textContent?.includes(text);
    },
  );
  if (!match) {
    throw new Error(`No note card contains "${text}"`);
  }
  return match;
}

async function openComposer(): Promise<void> {
  fireEvent.click(
    within(screen.getByTestId("note-composer-prompt")).getAllByRole(
      "button",
    )[0]!,
  );
  await screen.findByTestId("note-composer");
}

function editor(): HTMLTextAreaElement {
  return within(screen.getByTestId("note-composer")).getByLabelText(
    "Note text",
  ) as HTMLTextAreaElement;
}

function type(textarea: HTMLTextAreaElement, text: string): void {
  fireEvent.change(textarea, { target: { value: text } });
}

async function submitComposer(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("note-submit"));
  });
}

function createdPayload(index: number = 0): Record<string, unknown> {
  const request: { model: BaseModel; modelType: { new (): BaseModel } } =
    createMock.mock.calls[index]![0] as {
      model: BaseModel;
      modelType: { new (): BaseModel };
    };
  // What ModelAPI would put on the wire.
  return JSON.parse(
    JSON.stringify(BaseModel.toJSON(request.model, request.modelType)),
  ) as Record<string, unknown>;
}

async function openActions(noteCard: HTMLElement): Promise<void> {
  fireEvent.click(
    within(noteCard).getByRole("button", { name: "Note actions" }),
  );
  await within(noteCard).findByRole("menuitem", { name: "Edit note" });
}

beforeEach(() => {
  store.clear();
  currentPermissions = [Permission.ProjectOwner];
  isMasterAdmin = true;
  capturedAIProps = null;
  serveStore();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  updateByIdMock.mockReset();
  deleteMock.mockReset();
  generateMock.mockReset();
  jest.restoreAllMocks();
});

describe("event notes: reading the feed", () => {
  test("asks once for this incident's public notes, newest posting time first, a page at a time", async () => {
    seedPublicNotes();
    await renderPublic();

    const requests: Array<ListRequest> = noteRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.modelType).toBe(IncidentPublicNote);
    expect(String(requests[0]!.query["incidentId"])).toBe(
      INCIDENT_ID.toString(),
    );
    expect(String(requests[0]!.query["projectId"])).toBe(PROJECT_ID);
    expect(requests[0]!.sort).toEqual({ postedAt: SortOrder.Descending });
    expect(requests[0]!.limit).toBe(25);
    expect(requests[0]!.skip).toBe(0);
    expect(requests[0]!.select).toMatchObject({
      note: true,
      postedAt: true,
      subscriberNotificationStatusOnNoteCreated: true,
      subscriberNotificationStatusMessage: true,
      attachments: { _id: true, name: true, fileType: true },
    });
  });

  test("a private feed sorts by when notes were written and asks for no public columns", async () => {
    seedPrivateNotes();
    await renderPrivate();

    const request: ListRequest = noteRequests()[0]!;
    expect(request.modelType).toBe(IncidentInternalNote);
    expect(request.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(request.select["postedAt"]).toBeUndefined();
    expect(
      request.select["subscriberNotificationStatusOnNoteCreated"],
    ).toBeUndefined();
  });

  test("shows a skeleton until the notes arrive", async () => {
    let release: () => void = (): void => {};
    getListMock.mockImplementation(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        release = () => {
          resolve({ data: [], count: 0, skip: 0, limit: 25 });
        };
      });
    });

    render(<EventNotes<IncidentPublicNote> {...publicProps()} />);

    expect(screen.getByTestId("notes-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("notes-empty")).toBeNull();

    await act(async () => {
      release();
    });

    expect(screen.queryByTestId("notes-loading")).toBeNull();
    expect(screen.getByTestId("notes-empty")).toBeInTheDocument();
  });

  test("groups this incident's notes by day with their authors and times", async () => {
    seedPublicNotes();
    await renderPublic();

    const days: Array<HTMLElement> = screen.getAllByTestId("notes-day");
    expect(days).toHaveLength(2);
    expect(within(days[0]!).getByText("Today")).toBeInTheDocument();
    expect(within(days[0]!).getByText("2 notes")).toBeInTheDocument();
    expect(within(days[1]!).getByText("Yesterday")).toBeInTheDocument();

    expect(
      cards().map((element: HTMLElement) => {
        return within(element).getByTestId("note-author").textContent;
      }),
    ).toEqual(["Maya Chen", "Sam Rivera", "OneUptime"]);
    expect(within(cards()[0]!).getByTestId("note-time")).toHaveTextContent(
      "12 minutes ago",
    );
    expect(screen.queryByText("A note on another incident.")).toBeNull();
    expect(screen.getByTestId("notes-count")).toHaveTextContent("3");
    expect(screen.getByTestId("notes-summary")).toHaveTextContent("3 notes");
  });

  test("marks notes that came from Slack", async () => {
    seedPublicNotes();
    await renderPublic();

    expect(
      within(card("Investigating reports")).getByText("via Slack"),
    ).toBeInTheDocument();
    expect(within(card("Monitoring.")).queryByText("via Slack")).toBeNull();
  });

  test("links each attachment to the note model's download route", async () => {
    seedPublicNotes();
    await renderPublic();

    const link: HTMLElement = within(card("Identified.")).getByTestId(
      "note-attachment",
    );
    expect(link).toHaveTextContent("lb-errors.png");
    expect(link.getAttribute("href")).toMatch(
      new RegExp(
        `/incident-public-note/attachment/${PROJECT_ID}/${noteId(2)}/72000000-0000-4000-8000-000000000001$`,
      ),
    );
  });

  test("shows no attachments, and asks for none, where the note type cannot serve them", async () => {
    seedPublicNotes();
    await renderPublic({ attachmentApiPath: undefined });

    expect(screen.queryByTestId("note-attachment")).toBeNull();
    expect(noteRequests()[0]!.select["attachments"]).toBeUndefined();
  });

  test("an empty public feed invites the first update", async () => {
    await renderPublic();

    const empty: HTMLElement = screen.getByTestId("notes-empty");
    expect(
      within(empty).getByText("No public updates yet"),
    ).toBeInTheDocument();
    expect(
      within(empty).getByText(/shown on the status page for this incident/),
    ).toBeInTheDocument();

    fireEvent.click(within(empty).getByText("Post the first update"));
    expect(await screen.findByTestId("note-composer")).toBeInTheDocument();
    // The call to action goes away once the composer is open.
    expect(screen.queryByTestId("notes-empty-cta")).toBeNull();
  });

  test("an empty private feed explains who can read it", async () => {
    await renderPrivate();

    const empty: HTMLElement = screen.getByTestId("notes-empty");
    expect(within(empty).getByText("No private notes yet")).toBeInTheDocument();
    expect(within(empty).getByText("Write the first note")).toBeInTheDocument();
    expect(
      within(empty).getByText(/Only people in your project/),
    ).toBeInTheDocument();
  });

  test("a failed load says so and tries again on request", async () => {
    getListMock.mockRejectedValueOnce(new Error("The notes service is down."));
    await renderPublic();

    const error: HTMLElement = screen.getByTestId("notes-error");
    expect(within(error).getByText("The notes service is down.")).toBeVisible();

    seedPublicNotes();
    await act(async () => {
      fireEvent.click(within(error).getByText("Try again"));
    });

    await waitFor(() => {
      expect(cards()).toHaveLength(3);
    });
    expect(screen.queryByTestId("notes-error")).toBeNull();
  });

  test("the refresh button reads the feed again", async () => {
    seedPublicNotes();
    await renderPublic();

    tableOf(IncidentPublicNote).push({
      _id: noteId(50),
      incidentId: INCIDENT_ID,
      note: "Posted from somewhere else.",
      createdAt: ago(MINUTE),
      postedAt: ago(MINUTE),
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("notes-refresh"));
    });

    expect(
      await screen.findByText("Posted from somewhere else."),
    ).toBeInTheDocument();
  });
});

describe("event notes: paging, sorting and searching", () => {
  function seedMany(count: number): void {
    for (let i: number = 0; i < count; i++) {
      tableOf(IncidentInternalNote).push({
        _id: noteId(200 + i),
        incidentId: INCIDENT_ID,
        note: `Note number ${i}`,
        createdAt: ago((i + 1) * MINUTE),
        createdByUser: MAYA,
      });
    }
  }

  test("offers older notes when there are more than one page, and appends them", async () => {
    seedMany(30);
    await renderPrivate();

    expect(cards()).toHaveLength(25);
    const loadMore: HTMLElement = screen.getByTestId("notes-load-more");
    expect(loadMore).toHaveTextContent("Show older notes");
    expect(loadMore).toHaveTextContent("(5 more)");

    await act(async () => {
      fireEvent.click(loadMore);
    });

    await waitFor(() => {
      expect(cards()).toHaveLength(30);
    });
    expect(noteRequests()[1]!.skip).toBe(25);
    expect(screen.queryByTestId("notes-load-more")).toBeNull();
  });

  test("a refresh keeps every page already on screen", async () => {
    seedMany(30);
    await renderPrivate();
    await act(async () => {
      fireEvent.click(screen.getByTestId("notes-load-more"));
    });
    await waitFor(() => {
      expect(cards()).toHaveLength(30);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("notes-refresh"));
    });

    const refresh: ListRequest = noteRequests()[2]!;
    expect(refresh.skip).toBe(0);
    expect(refresh.limit).toBe(30);
    expect(cards()).toHaveLength(30);
  });

  test("switches to oldest first", async () => {
    seedPrivateNotes();
    await renderPrivate();

    expect(cards()[0]).toHaveTextContent("Rotated the cert");

    await act(async () => {
      fireEvent.click(screen.getByTestId("notes-sort"));
    });

    await waitFor(() => {
      expect(cards()[0]).toHaveTextContent("Paged the edge on-call.");
    });
    expect(noteRequests()[1]!.sort).toEqual({
      createdAt: SortOrder.Ascending,
    });
    expect(screen.getByTestId("notes-sort")).toHaveTextContent("Oldest first");
  });

  test("searches the note text on the server once typing stops", async () => {
    seedPrivateNotes();
    await renderPrivate();

    const search: HTMLElement = screen.getByTestId("notes-search");
    fireEvent.change(search, { target: { value: "c" } });
    fireEvent.change(search, { target: { value: "ce" } });
    fireEvent.change(search, { target: { value: "  cert " } });

    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });

    const searches: Array<ListRequest> = noteRequests().slice(1);
    expect(searches).toHaveLength(1);
    expect(searches[0]!.query["note"]).toBeInstanceOf(Search);
    expect((searches[0]!.query["note"] as Search<string>).value).toBe("cert");
    expect(screen.getByTestId("notes-summary")).toHaveTextContent("1 match");
    // The box stays put (and keeps its text) while results change.
    expect(screen.getByTestId("notes-search")).toHaveValue("  cert ");
  });

  test("a search with no results says so and can be cleared", async () => {
    seedPrivateNotes();
    await renderPrivate();

    fireEvent.change(screen.getByTestId("notes-search"), {
      target: { value: "nothing like this" },
    });

    const empty: HTMLElement = await screen.findByTestId("notes-search-empty");
    expect(within(empty).getByText("No notes match your search")).toBeVisible();

    await act(async () => {
      fireEvent.click(within(empty).getByText("Clear search"));
    });

    await waitFor(() => {
      expect(cards()).toHaveLength(2);
    });
    expect(screen.getByTestId("notes-search")).toHaveValue("");
  });

  test("a slow answer for an old search never replaces a newer one", async () => {
    seedPrivateNotes();
    await renderPrivate();

    let releaseSlow: () => void = (): void => {};
    const serve: MockFunction = getListMock.getMockImplementation() as never;
    getListMock.mockImplementationOnce(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        releaseSlow = () => {
          resolve({
            data: [
              Object.assign(new IncidentInternalNote(), {
                _id: noteId(99),
                note: "STALE RESULT",
                createdAt: NOW,
              }),
            ],
            count: 1,
            skip: 0,
            limit: 25,
          });
        };
      });
    });

    fireEvent.change(screen.getByTestId("notes-search"), {
      target: { value: "rotated" },
    });
    await waitFor(() => {
      expect(noteRequests()).toHaveLength(2);
    });

    getListMock.mockImplementation(serve as never);
    fireEvent.change(screen.getByTestId("notes-search"), {
      target: { value: "paged" },
    });
    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    expect(cards()[0]).toHaveTextContent("Paged the edge on-call.");

    await act(async () => {
      releaseSlow();
    });

    expect(screen.queryByText("STALE RESULT")).toBeNull();
    expect(cards()[0]).toHaveTextContent("Paged the edge on-call.");
  });
});

describe("event notes: the composer", () => {
  test("opens from the prompt and says who will read the note", async () => {
    await renderPublic();

    expect(screen.queryByTestId("note-composer")).toBeNull();
    await openComposer();

    const composer: HTMLElement = screen.getByTestId("note-composer");
    expect(within(composer).getByTestId("note-audience")).toHaveTextContent(
      "Public·Visible on your status page",
    );
    expect(editor()).toHaveAttribute(
      "placeholder",
      expect.stringContaining("Tell your customers"),
    );
  });

  test("cannot post an empty or whitespace-only note", async () => {
    await renderPublic();
    await openComposer();

    expect(screen.getByTestId("note-submit")).toBeDisabled();
    type(editor(), "   \n  ");
    expect(screen.getByTestId("note-submit")).toBeDisabled();
    type(editor(), "Fix deployed");
    expect(screen.getByTestId("note-submit")).toBeEnabled();
  });

  test("posts the note on this incident and project, notifying subscribers explicitly", async () => {
    await renderPublic();
    await openComposer();

    type(editor(), "We are rolling out a fix.");
    expect(screen.getByTestId("note-notify-checkbox")).toBeChecked();
    await submitComposer();

    expect(createMock).toHaveBeenCalledTimes(1);
    const payload: Record<string, unknown> = createdPayload();
    expect(payload["note"]).toBe("We are rolling out a fix.");
    expect(payload["incidentId"]).toMatchObject({
      value: INCIDENT_ID.toString(),
    });
    expect(payload["projectId"]).toMatchObject({ value: PROJECT_ID });
    expect(payload["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"]).toBe(
      true,
    );
    expect(payload["postedAt"]).toMatchObject({ value: NOW.toISOString() });
    expect(payload["attachments"]).toBeUndefined();
  });

  test("after posting, the note appears and the composer is empty and ready for the next one", async () => {
    await renderPublic();
    await openComposer();
    type(editor(), "First update.");
    await submitComposer();

    expect(await screen.findByText("First update.")).toBeInTheDocument();
    expect(screen.getByTestId("note-composer")).toBeInTheDocument();
    expect(editor()).toHaveValue("");
    expect(screen.getByTestId("note-submit")).toBeDisabled();
    expect(noteRequests().length).toBeGreaterThanOrEqual(2);
  });

  test("an incident declared quietly starts unticked, says why, and posts false - not nothing", async () => {
    await renderPublic({
      subscriberNotifications: {
        isNotifyingByDefault: false,
        quietDescription: QUIET_DESCRIPTION,
      },
    });
    await openComposer();

    expect(screen.getByTestId("note-notify-checkbox")).not.toBeChecked();
    expect(screen.getByTestId("note-notify-description")).toHaveTextContent(
      QUIET_DESCRIPTION,
    );

    type(editor(), "Quiet update.");
    await submitComposer();

    const payload: Record<string, unknown> = createdPayload();
    expect(
      Object.prototype.hasOwnProperty.call(
        payload,
        "shouldStatusPageSubscribersBeNotifiedOnNoteCreated",
      ),
    ).toBe(true);
    expect(payload["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"]).toBe(
      false,
    );
  });

  test("ticking the box on a quiet incident notifies after all", async () => {
    await renderPublic({
      subscriberNotifications: {
        isNotifyingByDefault: false,
        quietDescription: QUIET_DESCRIPTION,
      },
    });
    await openComposer();

    fireEvent.click(screen.getByTestId("note-notify-checkbox"));
    expect(screen.getByTestId("note-notify-description")).toHaveTextContent(
      "Subscribers will be notified about this update as soon as you post it.",
    );

    type(editor(), "Loud update.");
    await submitComposer();

    expect(
      createdPayload()["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"],
    ).toBe(true);
  });

  test("unticking on a notifying incident explains the note still goes on the status page", async () => {
    await renderPublic();
    await openComposer();

    fireEvent.click(screen.getByTestId("note-notify-checkbox"));

    expect(screen.getByTestId("note-notify-description")).toHaveTextContent(
      "The update will appear on your status page without notifying subscribers.",
    );
  });

  test("a private note carries no notify flag and no posting time", async () => {
    await renderPrivate();
    await openComposer();

    expect(screen.queryByTestId("note-notify-checkbox")).toBeNull();
    expect(screen.queryByTestId("note-posted-at-button")).toBeNull();
    expect(screen.getByTestId("note-audience")).toHaveTextContent(
      "Private·Only your team can see this",
    );

    type(editor(), "Internal finding.");
    await submitComposer();

    const payload: Record<string, unknown> = createdPayload();
    expect(payload["note"]).toBe("Internal finding.");
    expect(
      payload["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"],
    ).toBeUndefined();
    expect(payload["postedAt"]).toBeUndefined();
  });

  test("backdates a public note to the time chosen, and can go back to now", async () => {
    await renderPublic();
    await openComposer();

    expect(screen.getByTestId("note-posted-at-button")).toHaveTextContent(
      "Posted now",
    );
    fireEvent.click(screen.getByTestId("note-posted-at-button"));

    fireEvent.change(screen.getByTestId("note-posted-at-input"), {
      target: { value: "2026-09-14T17:05" },
    });
    expect(screen.getByTestId("note-posted-at-button")).toHaveTextContent(
      "Posted Sep 14",
    );

    type(editor(), "Backdated update.");
    await submitComposer();

    expect(createdPayload()["postedAt"]).toMatchObject({
      value: "2026-09-14T17:05:00.000Z",
    });
  });

  test("'Use the current time' drops the chosen time", async () => {
    await renderPublic();
    await openComposer();

    fireEvent.click(screen.getByTestId("note-posted-at-button"));
    fireEvent.change(screen.getByTestId("note-posted-at-input"), {
      target: { value: "2026-09-14T17:05" },
    });
    fireEvent.click(screen.getByText("Use the current time"));
    expect(screen.getByTestId("note-posted-at-button")).toHaveTextContent(
      "Posted now",
    );

    type(editor(), "Now update.");
    await submitComposer();

    expect(createdPayload()["postedAt"]).toMatchObject({
      value: NOW.toISOString(),
    });
  });

  test("attaches files picked in the composer", async () => {
    await renderPublic();
    await openComposer();

    expect(screen.queryByTestId("file-picker")).toBeNull();
    fireEvent.click(screen.getByTestId("note-attach-button"));
    fireEvent.click(screen.getByText("Add fake file"));
    expect(screen.getByTestId("note-attach-button")).toHaveTextContent(
      "Attach1",
    );

    type(editor(), "With a log.");
    await submitComposer();

    expect(createdPayload()["attachments"]).toEqual([
      expect.objectContaining({
        _id: "72000000-0000-4000-8000-000000000009",
      }),
    ]);
  });

  test("offers no attachments where the note type cannot serve them back", async () => {
    await renderPrivate({ attachmentApiPath: undefined });
    await openComposer();

    expect(screen.queryByTestId("note-attach-button")).toBeNull();
  });

  test("Ctrl+Enter posts, and does nothing while the note is empty", async () => {
    await renderPrivate();
    await openComposer();

    fireEvent.keyDown(editor(), { key: "Enter", ctrlKey: true });
    expect(createMock).not.toHaveBeenCalled();

    type(editor(), "Posted from the keyboard.");
    await act(async () => {
      fireEvent.keyDown(editor(), { key: "Enter", metaKey: true });
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createdPayload()["note"]).toBe("Posted from the keyboard.");
  });

  test("Escape closes an empty composer", async () => {
    await renderPrivate();
    await openComposer();

    fireEvent.keyDown(editor(), { key: "Escape" });

    expect(screen.queryByTestId("note-composer")).toBeNull();
    expect(screen.getByTestId("note-composer-prompt")).toBeInTheDocument();
  });

  test("cancelling a draft asks first, and keeping it keeps every word", async () => {
    await renderPrivate();
    await openComposer();
    type(editor(), "Half a thought");

    fireEvent.click(
      within(screen.getByTestId("note-composer")).getByText("Cancel"),
    );
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Discard this draft?",
    });

    fireEvent.click(within(dialog).getByText("Keep writing"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor()).toHaveValue("Half a thought");
  });

  test("discarding a draft empties and closes the composer", async () => {
    await renderPrivate();
    await openComposer();
    type(editor(), "Half a thought");

    fireEvent.click(
      within(screen.getByTestId("note-composer")).getByText("Cancel"),
    );
    fireEvent.click(screen.getByText("Discard draft"));

    expect(screen.queryByTestId("note-composer")).toBeNull();
    await openComposer();
    expect(editor()).toHaveValue("");
  });

  test("a refused post shows why inside the composer and keeps the draft", async () => {
    await renderPublic();
    await openComposer();
    createMock.mockRejectedValueOnce(
      new Error("Notes cannot be posted while the incident is being merged."),
    );

    type(editor(), "Keep me.");
    await submitComposer();

    expect(screen.getByTestId("note-composer-error")).toHaveTextContent(
      "Notes cannot be posted while the incident is being merged.",
    );
    expect(editor()).toHaveValue("Keep me.");
    expect(noteRequests()).toHaveLength(1);
  });

  test("posts nothing without a current project", async () => {
    await renderPublic({ currentProject: null });
    await openComposer();

    type(editor(), "Orphan.");
    await submitComposer();

    expect(createMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("note-composer-error")).toHaveTextContent(
      "Project ID cannot be null",
    );
  });
});

describe("event notes: permissions", () => {
  test("someone who may read but not write sees why, and no composer", async () => {
    isMasterAdmin = false;
    currentPermissions = [Permission.Viewer];
    seedPublicNotes();
    await renderPublic();

    expect(screen.getByTestId("note-composer-locked")).toHaveTextContent(
      "You do not have permission to create",
    );
    expect(screen.queryByTestId("note-composer-prompt")).toBeNull();
    expect(screen.queryByTestId("notes-empty-cta")).toBeNull();

    // Edit and delete stay in the menu, locked, next to the id copier.
    await act(async () => {
      fireEvent.click(
        within(card("Monitoring.")).getByRole("button", {
          name: "Note actions",
        }),
      );
    });
    expect(
      within(card("Monitoring.")).getByRole("menuitem", { name: "Edit note" }),
    ).toBeDisabled();
    expect(
      within(card("Monitoring.")).getByRole("menuitem", {
        name: "Delete note",
      }),
    ).toBeDisabled();
    expect(
      within(card("Monitoring.")).getByRole("menuitem", {
        name: "Copy note ID",
      }),
    ).toBeEnabled();
  });

  test("a failed notification cannot be retried by someone who may not edit", async () => {
    isMasterAdmin = false;
    currentPermissions = [Permission.Viewer];
    seedPublicNotes();
    await renderPublic();

    fireEvent.click(
      within(card("Identified.")).getByTestId("note-notification-status"),
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Subscriber notification",
    });
    expect(within(dialog).getByText("The SMTP relay refused.")).toBeVisible();
    expect(within(dialog).queryByText("Retry notification")).toBeNull();
  });

  test("while permissions are still loading nothing is offered, and nobody is accused", async () => {
    isMasterAdmin = false;
    currentPermissions = [];
    await renderPublic();

    expect(screen.queryByTestId("note-composer-prompt")).toBeNull();
    expect(screen.queryByTestId("note-composer-locked")).toBeNull();
  });

  test("a project member writes notes through the real permission checks", async () => {
    isMasterAdmin = false;
    currentPermissions = [Permission.ProjectMember];
    await renderPublic();
    await openComposer();

    expect(screen.getByTestId("note-notify-checkbox")).toBeInTheDocument();
    expect(screen.getByTestId("note-posted-at-button")).toBeInTheDocument();
    expect(screen.getByTestId("note-attach-button")).toBeInTheDocument();
  });
});

describe("event notes: templates", () => {
  test("loads templates only when the menu first opens", async () => {
    seedTemplates(3);
    await renderPublic();

    expect(templateRequests()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    const menu: HTMLElement = await screen.findByTestId("note-template-menu");
    await within(menu).findAllByText("Identified");

    const request: ListRequest = templateRequests()[0]!;
    expect(String(request.query["projectId"])).toBe(PROJECT_ID);
    expect(request.select).toEqual({
      _id: true,
      templateName: true,
      note: true,
    });
    expect(request.sort).toEqual({ templateName: SortOrder.Ascending });
    // The preview is the first line, without its markdown.
    expect(within(menu).getAllByText("Identified")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    await screen.findByTestId("note-template-menu");
    expect(templateRequests()).toHaveLength(1);
  });

  test("picking a template opens the composer with it", async () => {
    seedTemplates(3);
    await renderPublic();

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    fireEvent.click(
      (await screen.findAllByText("Investigating"))[0]!.closest("button")!,
    );

    expect(await screen.findByTestId("note-composer")).toBeInTheDocument();
    expect(editor()).toHaveValue("## Investigating\nTemplate body 2.");
    expect(screen.queryByTestId("note-template-menu")).toBeNull();
    // Notify still follows the incident, not the template.
    expect(screen.getByTestId("note-notify-checkbox")).toBeChecked();
  });

  test("a template never replaces what was already typed", async () => {
    seedTemplates(3);
    await renderPublic();
    await openComposer();
    type(editor(), "Our own words.");

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    fireEvent.click(
      (await screen.findAllByText("Resolved"))[0]!.closest("button")!,
    );

    await waitFor(() => {
      expect(editor()).toHaveValue(
        "Our own words.\n\n## Resolved\nTemplate body 3.",
      );
    });
  });

  test("with no templates, says so and links to where they are made", async () => {
    await renderPublic();

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    const empty: HTMLElement = await screen.findByTestId(
      "note-templates-empty",
    );

    expect(within(empty).getByText("No note templates yet")).toBeVisible();
    expect(
      within(empty).getByText("Create a template").closest("a"),
    ).toHaveAttribute("href", SETTINGS_ROUTE);
  });

  test("a failed template load can be retried from the menu", async () => {
    seedTemplates(1);
    await renderPublic();
    getListMock.mockRejectedValueOnce(new Error("No access to templates."));

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    expect(await screen.findByText("No access to templates.")).toBeVisible();

    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findAllByText("Identified")).not.toHaveLength(0);
  });

  test("a long list of templates can be filtered", async () => {
    seedTemplates(8);
    await renderPublic();

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    const filter: HTMLElement =
      await screen.findByLabelText("Filter templates");

    fireEvent.change(filter, { target: { value: "template 7" } });

    const menu: HTMLElement = screen.getByTestId("note-template-menu");
    expect(within(menu).getAllByRole("option")).toHaveLength(1);
    expect(within(menu).getAllByText("Template 7")).not.toHaveLength(0);

    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(
      within(menu).getByText("No templates match your filter."),
    ).toBeVisible();
  });

  test("a feed with no templates configured offers no menu", async () => {
    await renderPublic({ templates: undefined });

    expect(screen.queryByTestId("note-template-menu-button")).toBeNull();
  });
});

describe("event notes: drafting with AI", () => {
  test("hands the dialog this page's generator and puts the draft in the composer", async () => {
    await renderPublic();

    fireEvent.click(screen.getByTestId("note-ai-button"));
    expect(screen.getByTestId("ai-modal")).toBeInTheDocument();
    expect(capturedAIProps!.title).toBe("Generate Public Note with AI");

    generateMock.mockResolvedValueOnce("generated");
    await expect(capturedAIProps!.onGenerate({ template: "t" })).resolves.toBe(
      "generated",
    );
    expect(generateMock).toHaveBeenCalledWith({ template: "t" });

    fireEvent.click(screen.getByText("Use AI draft"));

    expect(screen.queryByTestId("ai-modal")).toBeNull();
    expect(await screen.findByTestId("note-composer")).toBeInTheDocument();
    expect(editor()).toHaveValue("Drafted by AI.");
    // Drafting is not posting.
    expect(createMock).not.toHaveBeenCalled();
  });

  test("a feed without AI offers no AI button", async () => {
    await renderPrivate();

    expect(screen.queryByTestId("note-ai-button")).toBeNull();
  });
});

describe("event notes: editing", () => {
  async function startEditing(text: string): Promise<HTMLElement> {
    const noteCard: HTMLElement = card(text);
    await openActions(noteCard);
    fireEvent.click(
      within(noteCard).getByRole("menuitem", { name: "Edit note" }),
    );
    return within(noteCard).findByTestId("note-edit-composer");
  }

  test("edits a note in place with its current text", async () => {
    seedPublicNotes();
    await renderPublic();

    const composer: HTMLElement = await startEditing("Monitoring.");

    expect(within(composer).getByLabelText("Note text")).toHaveValue(
      "Monitoring. A fix is live.",
    );
    expect(within(composer).getByText("Editing")).toBeVisible();
    expect(
      within(composer).getByTestId("note-notify-checkbox"),
    ).not.toBeChecked();
    expect(
      within(composer).getByText("Notify subscribers about this update"),
    ).toBeVisible();
  });

  test("saves the edit to the same note without notifying anyone", async () => {
    seedPublicNotes();
    await renderPublic();

    const composer: HTMLElement = await startEditing("Monitoring.");
    type(
      within(composer).getByLabelText("Note text") as HTMLTextAreaElement,
      "Monitoring. A fix is live everywhere.",
    );
    await act(async () => {
      fireEvent.click(within(composer).getByTestId("note-submit"));
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const request: {
      model: IncidentPublicNote;
      formType: FormType;
      miscDataProps: Record<string, unknown>;
    } = updateMock.mock.calls[0]![0] as {
      model: IncidentPublicNote;
      formType: FormType;
      miscDataProps: Record<string, unknown>;
    };
    expect(request.formType).toBe(FormType.Update);
    expect(request.model._id).toBe(noteId(1));
    expect(request.model.note).toBe("Monitoring. A fix is live everywhere.");
    expect(request.miscDataProps).toEqual({});
    // The posting time was not touched, so it is not sent.
    expect(request.model.postedAt).toBeUndefined();

    expect(
      await screen.findByText("Monitoring. A fix is live everywhere."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("note-edit-composer")).toBeNull();
  });

  test("ticking 'notify subscribers about this update' asks the server to send one", async () => {
    seedPublicNotes();
    await renderPublic();

    const composer: HTMLElement = await startEditing("Monitoring.");
    fireEvent.click(within(composer).getByTestId("note-notify-checkbox"));
    await act(async () => {
      fireEvent.click(within(composer).getByTestId("note-submit"));
    });

    expect(
      (updateMock.mock.calls[0]![0] as { miscDataProps: unknown })
        .miscDataProps,
    ).toEqual(SubscriberUpdateNotification.getMiscDataProps());
  });

  test("keeps the note's files when it is edited", async () => {
    seedPublicNotes();
    await renderPublic();

    const composer: HTMLElement = await startEditing("Identified.");

    expect(
      within(composer).getByTestId("note-attachment-summary"),
    ).toHaveTextContent("lb-errors.png");
    await act(async () => {
      fireEvent.click(within(composer).getByTestId("note-submit"));
    });

    const model: IncidentPublicNote = (
      updateMock.mock.calls[0]![0] as { model: IncidentPublicNote }
    ).model;
    expect(
      (model.attachments || []).map((file: FileModel) => {
        return file._id;
      }),
    ).toEqual(["72000000-0000-4000-8000-000000000001"]);
  });

  test("a refused edit shows why and stays open", async () => {
    seedPublicNotes();
    await renderPublic();
    updateMock.mockRejectedValueOnce(new Error("Changed by someone else."));

    const composer: HTMLElement = await startEditing("Monitoring.");
    await act(async () => {
      fireEvent.click(within(composer).getByTestId("note-submit"));
    });

    expect(
      within(composer).getByTestId("note-composer-error"),
    ).toHaveTextContent("Changed by someone else.");
    expect(screen.getByTestId("note-edit-composer")).toBeInTheDocument();
  });

  test("cancelling an edit puts the note back as it was", async () => {
    seedPublicNotes();
    await renderPublic();

    const composer: HTMLElement = await startEditing("Monitoring.");
    type(
      within(composer).getByLabelText("Note text") as HTMLTextAreaElement,
      "Something else",
    );
    fireEvent.click(within(composer).getByText("Cancel"));

    expect(screen.queryByTestId("note-edit-composer")).toBeNull();
    expect(screen.getByText("Monitoring. A fix is live.")).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("private notes have no update notification to ask for", async () => {
    seedPrivateNotes();
    await renderPrivate();

    const composer: HTMLElement = await startEditing("Rotated the cert");

    expect(within(composer).queryByTestId("note-notify-checkbox")).toBeNull();
    expect(within(composer).getByText("Save changes")).toBeVisible();
  });
});

describe("event notes: deleting", () => {
  test("asks first, says the note leaves the status page, then deletes that note", async () => {
    seedPublicNotes();
    await renderPublic();

    const noteCard: HTMLElement = card("Monitoring.");
    await openActions(noteCard);
    fireEvent.click(
      within(noteCard).getByRole("menuitem", { name: "Delete note" }),
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Delete this public note?",
    });
    expect(
      within(dialog).getByText(/removed from your status page/),
    ).toBeVisible();

    await act(async () => {
      fireEvent.click(within(dialog).getByText("Delete note"));
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    const request: { modelType: unknown; id: ObjectID } = deleteMock.mock
      .calls[0]![0] as { modelType: unknown; id: ObjectID };
    expect(request.modelType).toBe(IncidentPublicNote);
    expect(request.id.toString()).toBe(noteId(1));

    await waitFor(() => {
      expect(screen.queryByText("Monitoring. A fix is live.")).toBeNull();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("'Keep note' deletes nothing", async () => {
    seedPrivateNotes();
    await renderPrivate();

    const noteCard: HTMLElement = card("Rotated the cert");
    await openActions(noteCard);
    fireEvent.click(
      within(noteCard).getByRole("menuitem", { name: "Delete note" }),
    );
    fireEvent.click(screen.getByText("Keep note"));

    expect(deleteMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("Rotated the cert on lb-eu-west-1b."),
    ).toBeVisible();
  });

  test("a refused delete shows why and keeps the note", async () => {
    seedPrivateNotes();
    await renderPrivate();
    deleteMock.mockRejectedValueOnce(
      new Error("You can only delete your own."),
    );

    const noteCard: HTMLElement = card("Rotated the cert");
    await openActions(noteCard);
    fireEvent.click(
      within(noteCard).getByRole("menuitem", { name: "Delete note" }),
    );
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByText("Delete note"),
      );
    });

    expect(
      within(screen.getByRole("dialog")).getByRole("alert"),
    ).toHaveTextContent("You can only delete your own.");
    expect(
      screen.getByText("Rotated the cert on lb-eu-west-1b."),
    ).toBeVisible();
  });
});

describe("event notes: subscriber notifications", () => {
  test("each public note says what happened to its notification", async () => {
    seedPublicNotes();
    await renderPublic();

    expect(
      within(card("Monitoring.")).getByTestId("note-notification-status"),
    ).toHaveTextContent("Subscribers notified");
    expect(
      within(card("Identified.")).getByTestId("note-notification-status"),
    ).toHaveTextContent("Notification failed");
    expect(
      within(card("Investigating reports")).getByTestId(
        "note-update-notification-status",
      ),
    ).toHaveTextContent("Update failed");
    expect(
      within(card("Monitoring.")).queryByTestId(
        "note-update-notification-status",
      ),
    ).toBeNull();
  });

  test("private notes show no notification state at all", async () => {
    seedPrivateNotes();
    await renderPrivate();

    expect(screen.queryByTestId("note-notification-status")).toBeNull();
  });

  test("retrying a failed notification queues it again and refreshes the note", async () => {
    seedPublicNotes();
    await renderPublic();

    fireEvent.click(
      within(card("Identified.")).getByTestId("note-notification-status"),
    );
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Subscriber notification",
    });
    expect(within(dialog).getByText("The SMTP relay refused.")).toBeVisible();

    await act(async () => {
      fireEvent.click(within(dialog).getByText("Retry notification"));
    });

    expect(updateByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: IncidentPublicNote,
        data: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessage: null,
        },
      }),
    );
    expect(
      (updateByIdMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(noteId(2));

    await waitFor(() => {
      expect(
        within(card("Identified.")).getByTestId("note-notification-status"),
      ).toHaveTextContent("Notifying subscribers soon");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("retrying a failed update notification queues the update again", async () => {
    seedPublicNotes();
    await renderPublic();

    fireEvent.click(
      within(card("Investigating reports")).getByTestId(
        "note-update-notification-status",
      ),
    );
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("dialog", { name: "Update notification" }),
        ).getByText("Retry notification"),
      );
    });

    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
    ).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
      subscriberNotificationStatusMessageOnNoteUpdated:
        SubscriberUpdateNotification.resendQueuedMessage,
    });
  });

  test("a refused retry keeps the dialog open with the reason", async () => {
    seedPublicNotes();
    await renderPublic();
    updateByIdMock.mockRejectedValueOnce(new Error("SMTP relay still down."));

    fireEvent.click(
      within(card("Identified.")).getByTestId("note-notification-status"),
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Retry notification"));
    });

    expect(
      within(screen.getByRole("dialog")).getByRole("alert"),
    ).toHaveTextContent("SMTP relay still down.");
  });

  test("while a notification is on its way the feed re-reads itself until it settles", async () => {
    tableOf(IncidentPublicNote).push({
      _id: noteId(30),
      incidentId: INCIDENT_ID,
      note: "Just posted.",
      createdAt: ago(MINUTE),
      postedAt: ago(MINUTE),
      createdByUser: MAYA,
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Pending,
    });
    await renderPublic();

    expect(
      within(card("Just posted.")).getByTestId("note-notification-status"),
    ).toHaveTextContent("Notifying subscribers soon");

    tableOf(IncidentPublicNote)[0]![
      "subscriberNotificationStatusOnNoteCreated"
    ] = StatusPageSubscriberNotificationStatus.Success;

    await waitFor(() => {
      expect(
        within(card("Just posted.")).getByTestId("note-notification-status"),
      ).toHaveTextContent("Subscribers notified");
    });

    const settledAt: number = noteRequests().length;
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 300);
    });
    expect(noteRequests().length).toBe(settledAt);
  });

  test("a settled feed never polls", async () => {
    seedPublicNotes();
    await renderPublic();

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 300);
    });

    expect(noteRequests()).toHaveLength(1);
  });
});

describe("event notes: the page header", () => {
  test("links to the other kind of note on the same event", async () => {
    await renderPublic();

    const switcher: HTMLElement = screen.getByTestId("notes-visibility-switch");
    expect(switcher.querySelector('[aria-current="page"]')).toHaveTextContent(
      "Public",
    );
    expect(within(switcher).getByText("Private").closest("a")).toHaveAttribute(
      "href",
      SIBLING_ROUTE,
    );
  });

  test("an event with only private notes shows no switch", async () => {
    await renderPrivate({ siblingRoute: undefined });

    expect(screen.queryByTestId("notes-visibility-switch")).toBeNull();
  });

  test("names the kind of note and who reads it", async () => {
    await renderPrivate({ eventNoun: "alert" });

    const header: HTMLElement = screen.getByTestId("notes-header");
    expect(within(header).getByText("Private notes")).toBeVisible();
    expect(
      within(header).getByText(/about this alert\. They are never shown/),
    ).toBeVisible();
  });
});
