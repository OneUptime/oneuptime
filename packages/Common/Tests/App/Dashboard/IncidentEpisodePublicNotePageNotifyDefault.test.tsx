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
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Incidents > Episodes > View > Public Notes.
 *
 * An episode created without notifying status page subscribers should not
 * have its first public note be what tells them. The page therefore loads the
 * episode's flag before it draws the notes table, and hands the table's create
 * form a starting value for "Notify Status Page Subscribers" that follows it.
 *
 * ModelTable is a prop recorder: what is under test is what the page hands
 * it, and what the page does when its callbacks fire.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

type FormFieldEntry = {
  field?: Record<string, unknown> | undefined;
  overrideFieldKey?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  fieldType?: string | undefined;
  defaultValue?: unknown;
  required?: boolean | undefined;
  stepId?: string | undefined;
  doNotShowWhenCreating?: boolean | undefined;
};

type ColumnEntry = {
  field?: Record<string, unknown> | undefined;
  getElement?: ((item: unknown) => ReactElement) | undefined;
};

type CapturedTableProps = {
  showCreateForm?: boolean | undefined;
  createInitialValues?: Record<string, unknown> | undefined;
  formFields?: Array<FormFieldEntry> | undefined;
  columns?: Array<ColumnEntry> | undefined;
  query?: Record<string, unknown> | undefined;
  refreshToggle?: string | undefined;
  isCreateable?: boolean | undefined;
  isEditable?: boolean | undefined;
  onBeforeCreate?: ((item: unknown) => Promise<unknown>) | undefined;
};

let tableRenders: Array<CapturedTableProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): ReactElement => {
      tableRenders.push(props);
      return <div data-testid="public-note-table" />;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
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
        return PROJECT_ID;
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

import EpisodePublicNote from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/PublicNote";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import Navigation from "../../../UI/Utils/Navigation";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const EPISODE_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_EPISODE_ID: string = "33333333-3333-4333-8333-333333333333";
const NOTE_ID: string = "44444444-4444-4444-8444-444444444444";

const NOTIFY_FIELD: string =
  "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";
const EPISODE_FLAG: string =
  "shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated";
const NOTIFYING_DESCRIPTION: string =
  "Should status page subscribers be notified?";
const PAGE_ROUTE: string = "/dashboard/incidents/episodes/view/public-notes";

let currentEpisodeId: string = EPISODE_ID;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};

  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (reason: unknown) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise: promise, resolve: resolve, reject: reject };
}

/*
 * `notifyOnCreate` of undefined leaves the flag off the row entirely; null is
 * what a row from before the setting existed reads back as.
 */
function buildEpisode(
  notifyOnCreate: boolean | null | undefined,
  id: string = currentEpisodeId,
): IncidentEpisode {
  const episode: IncidentEpisode = new IncidentEpisode();
  episode._id = id;

  if (notifyOnCreate !== undefined) {
    episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated =
      notifyOnCreate as boolean;
  }

  return episode;
}

function buildProject(): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  return project;
}

type ModelRequest = {
  modelType: unknown;
  id?: ObjectID | undefined;
  select?: Record<string, unknown> | undefined;
};

function episodeRequests(): Array<ModelRequest> {
  return getItemMock.mock.calls
    .map((args: Array<unknown>) => {
      return args[0] as ModelRequest;
    })
    .filter((request: ModelRequest) => {
      return request.modelType === IncidentEpisode;
    });
}

function serveEpisode(episode: Promise<IncidentEpisode | null>): void {
  getItemMock.mockImplementation((): unknown => {
    return episode;
  });
}

function renderPage(
  currentProject: Project | null = buildProject(),
): RenderResult {
  return render(
    <EpisodePublicNote
      pageRoute={new Route(PAGE_ROUTE)}
      currentProject={currentProject}
      hasPaymentMethod={true}
    />,
  );
}

function rerenderPage(view: RenderResult): void {
  view.rerender(
    <EpisodePublicNote
      pageRoute={new Route(PAGE_ROUTE)}
      currentProject={buildProject()}
      hasPaymentMethod={true}
    />,
  );
}

async function waitForTable(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
  });
}

async function renderPageFor(
  notifyOnCreate: boolean | null | undefined,
): Promise<RenderResult> {
  serveEpisode(Promise.resolve(buildEpisode(notifyOnCreate)));
  const view: RenderResult = renderPage();

  await waitForTable();

  return view;
}

function table(): CapturedTableProps {
  const latest: CapturedTableProps | undefined =
    tableRenders[tableRenders.length - 1];

  if (!latest) {
    throw new Error("The page rendered no ModelTable");
  }

  return latest;
}

function notifyFormField(): FormFieldEntry {
  const entry: FormFieldEntry | undefined = (table().formFields || []).find(
    (field: FormFieldEntry) => {
      return Object.keys(field.field || {})[0] === NOTIFY_FIELD;
    },
  );

  if (!entry) {
    throw new Error("The create form has no notify subscribers checkbox");
  }

  return entry;
}

type ResendHandler = () => Promise<void>;

type ElementProps = {
  onResendNotification?: ResendHandler | undefined;
  children?: unknown;
};

// The first resend callback in an element tree, depth first.
function findResendHandler(node: unknown): ResendHandler | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const handler: ResendHandler | null = findResendHandler(child);

      if (handler) {
        return handler;
      }
    }

    return null;
  }

  if (!React.isValidElement(node)) {
    return null;
  }

  const props: ElementProps = node.props as ElementProps;

  if (props.onResendNotification) {
    return props.onResendNotification;
  }

  return findResendHandler(props.children);
}

/*
 * The notification status columns render SubscriberNotificationStatus with a
 * resend callback (the update column inside a small wrapper). Reading it off
 * the element the column builds is how the resend button would reach the
 * page.
 */
function resendHandlerFor(
  statusField: string,
  note: IncidentEpisodePublicNote,
): ResendHandler {
  const column: ColumnEntry | undefined = (table().columns || []).find(
    (entry: ColumnEntry) => {
      return Object.keys(entry.field || {})[0] === statusField;
    },
  );

  if (!column?.getElement) {
    throw new Error(`The table has no ${statusField} column`);
  }

  const handler: ResendHandler | null = findResendHandler(
    column.getElement(note),
  );

  if (!handler) {
    throw new Error(`The ${statusField} column offers no resend`);
  }

  return handler;
}

function buildNote(): IncidentEpisodePublicNote {
  const note: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
  note._id = NOTE_ID;
  note.subscriberNotificationStatusOnNoteCreated =
    StatusPageSubscriberNotificationStatus.Failed;
  note.subscriberNotificationStatusOnNoteUpdated =
    StatusPageSubscriberNotificationStatus.Failed;
  return note;
}

beforeEach(() => {
  currentEpisodeId = EPISODE_ID;
  tableRenders = [];

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(currentEpisodeId);
    });
  jest.spyOn(Navigation, "getCurrentRoute").mockImplementation((): Route => {
    return new Route(PAGE_ROUTE);
  });
});

afterEach(() => {
  cleanup();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  jest.restoreAllMocks();
});

describe("episode public notes page: loading the episode's notify setting", () => {
  test("asks for only the episode's notify-on-create flag, by the episode in the route", async () => {
    await renderPageFor(false);

    const requests: Array<ModelRequest> = episodeRequests();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.id?.toString()).toBe(EPISODE_ID);
    expect(requests[0]!.select).toEqual({
      [EPISODE_FLAG]: true,
    });
    // The episode id is the parent segment of the public notes route.
    expect(Navigation.getLastParamAsObjectID).toHaveBeenCalledWith(1);
  });

  test("shows a loader and no notes table while the episode is still loading", async () => {
    const episode: Deferred<IncidentEpisode | null> =
      createDeferred<IncidentEpisode | null>();
    serveEpisode(episode.promise);

    renderPage();

    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("public-note-table")).toBeNull();
    // No create form can have been handed a starting value yet.
    expect(tableRenders).toHaveLength(0);

    await act(async () => {
      episode.resolve(buildEpisode(false));
    });

    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(tableRenders.length).toBeGreaterThan(0);

    // The very first table render already knows the episode was quiet.
    for (const tableRender of tableRenders) {
      expect(tableRender.createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    }
  });

  test("shows the error and no notes table when the episode cannot be loaded", async () => {
    serveEpisode(Promise.reject(new Error("Episode could not be loaded.")));

    renderPage();

    expect(
      await screen.findByText("Episode could not be loaded."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("public-note-table")).toBeNull();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(tableRenders).toHaveLength(0);
  });

  test("ignores a slower answer for the episode the page has already moved away from", async () => {
    const firstEpisode: Deferred<IncidentEpisode | null> =
      createDeferred<IncidentEpisode | null>();
    const secondEpisode: Deferred<IncidentEpisode | null> =
      createDeferred<IncidentEpisode | null>();

    getItemMock.mockImplementation((...args: Array<unknown>): unknown => {
      const request: ModelRequest = args[0] as ModelRequest;
      return request.id?.toString() === EPISODE_ID
        ? firstEpisode.promise
        : secondEpisode.promise;
    });

    const view: RenderResult = renderPage();

    currentEpisodeId = OTHER_EPISODE_ID;
    rerenderPage(view);

    await waitFor(() => {
      expect(episodeRequests()).toHaveLength(2);
    });
    expect(episodeRequests()[1]!.id?.toString()).toBe(OTHER_EPISODE_ID);

    await act(async () => {
      secondEpisode.resolve(buildEpisode(false, OTHER_EPISODE_ID));
    });

    await act(async () => {
      firstEpisode.resolve(buildEpisode(true, EPISODE_ID));
    });

    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    expect(notifyFormField().defaultValue).toBe(false);
    expect(notifyFormField().description).toBe(
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
    );
    expect(String(table().query?.["incidentEpisodeId"])).toBe(OTHER_EPISODE_ID);
  });

  test("ignores a slower failure for the episode the page has already moved away from", async () => {
    const firstEpisode: Deferred<IncidentEpisode | null> =
      createDeferred<IncidentEpisode | null>();

    getItemMock.mockImplementation((...args: Array<unknown>): unknown => {
      const request: ModelRequest = args[0] as ModelRequest;
      return request.id?.toString() === EPISODE_ID
        ? firstEpisode.promise
        : Promise.resolve(buildEpisode(true, OTHER_EPISODE_ID));
    });

    const view: RenderResult = renderPage();

    currentEpisodeId = OTHER_EPISODE_ID;
    rerenderPage(view);

    await waitForTable();

    await act(async () => {
      firstEpisode.reject(new Error("The previous episode failed late."));
    });

    expect(screen.queryByText("The previous episode failed late.")).toBeNull();
    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(true);
  });

  test("moving to another episode loads its flag before the table comes back", async () => {
    const view: RenderResult = await renderPageFor(true);

    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(true);

    const nextEpisode: Deferred<IncidentEpisode | null> =
      createDeferred<IncidentEpisode | null>();
    serveEpisode(nextEpisode.promise);

    currentEpisodeId = OTHER_EPISODE_ID;
    await act(async () => {
      rerenderPage(view);
    });

    // The previous episode's "notify" is gone; nothing to open a form from.
    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("public-note-table")).toBeNull();

    await act(async () => {
      nextEpisode.resolve(buildEpisode(false, OTHER_EPISODE_ID));
    });

    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    expect(String(table().query?.["incidentEpisodeId"])).toBe(OTHER_EPISODE_ID);
  });

  test("an error for one episode does not stick to the next one", async () => {
    serveEpisode(Promise.reject(new Error("Episode could not be loaded.")));

    const view: RenderResult = renderPage();

    expect(
      await screen.findByText("Episode could not be loaded."),
    ).toBeInTheDocument();

    serveEpisode(Promise.resolve(buildEpisode(false, OTHER_EPISODE_ID)));
    currentEpisodeId = OTHER_EPISODE_ID;
    rerenderPage(view);

    await waitForTable();

    expect(screen.queryByText("Episode could not be loaded.")).toBeNull();
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);
  });
});

describe("episode public notes page: an episode created without notifying subscribers", () => {
  test("seeds the create form with notify subscribers off", async () => {
    await renderPageFor(false);

    expect(table().createInitialValues).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
    });
  });

  test("starts the checkbox unticked and says why", async () => {
    await renderPageFor(false);

    const field: FormFieldEntry = notifyFormField();

    expect(field.defaultValue).toBe(false);
    expect(field.description).toBe(
      PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
    );
    expect(field.description).toBe(
      "Unticked by default because status page subscribers were not notified when this episode was created.",
    );
    expect(field.description).not.toBe(NOTIFYING_DESCRIPTION);
    expect(field.title).toBe("Notify Status Page Subscribers");
    expect(field.required).toBe(false);
    expect(field.stepId).toBe("more");
  });

  test("does not open the create form on its own", async () => {
    await renderPageFor(false);

    expect(table().showCreateForm).toBeFalsy();
    expect(table().isCreateable).toBe(true);
  });

  test("leaves the other form fields as they were", async () => {
    await renderPageFor(false);

    expect(
      (table().formFields || []).map((field: FormFieldEntry) => {
        return field.title;
      }),
    ).toEqual([
      "Public Episode Note",
      "Attachments",
      "Notify Status Page Subscribers",
      SubscriberUpdateNotification.formFieldTitle,
      "Posted At",
    ]);

    /*
     * The edit form's "notify about this update" box is a separate choice:
     * it stays unticked and off the create form whatever the episode did.
     */
    const updateField: FormFieldEntry | undefined = (
      table().formFields || []
    ).find((field: FormFieldEntry) => {
      return (
        field.overrideFieldKey === SubscriberUpdateNotification.miscDataKey
      );
    });

    expect(updateField?.defaultValue).toBe(false);
    expect(updateField?.doNotShowWhenCreating).toBe(true);
    expect(table().createInitialValues).not.toHaveProperty(
      SubscriberUpdateNotification.miscDataKey,
    );
  });
});

describe.each([
  ["that notified subscribers", true],
  ["with no notify setting stored", undefined],
  ["whose notify setting reads back as null", null],
])(
  "episode public notes page: an episode %s",
  (_name: string, notifyOnCreate: boolean | null | undefined) => {
    test("seeds the create form with notify subscribers on", async () => {
      await renderPageFor(notifyOnCreate);

      expect(table().createInitialValues).toEqual({
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
      });
      expect(table().showCreateForm).toBeFalsy();
    });

    test("starts the checkbox ticked with the usual description", async () => {
      await renderPageFor(notifyOnCreate);

      const field: FormFieldEntry = notifyFormField();

      expect(field.defaultValue).toBe(true);
      expect(field.description).toBe(NOTIFYING_DESCRIPTION);
      expect(field.description).not.toBe(
        PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
      );
    });
  },
);

describe("episode public notes page: an episode the lookup does not find", () => {
  test("falls back to notifying subscribers", async () => {
    serveEpisode(Promise.resolve(null));
    renderPage();

    await waitForTable();

    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(true);
    expect(notifyFormField().defaultValue).toBe(true);
    expect(notifyFormField().description).toBe(NOTIFYING_DESCRIPTION);
  });
});

describe("episode public notes page: creating a note", () => {
  test("still stamps the note with this episode and the current project", async () => {
    await renderPageFor(false);

    const note: IncidentEpisodePublicNote = (await table().onBeforeCreate!(
      new IncidentEpisodePublicNote(),
    )) as IncidentEpisodePublicNote;

    expect(note.incidentEpisodeId?.toString()).toBe(EPISODE_ID);
    expect(note.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("leaves the flag the form sends alone", async () => {
    await renderPageFor(false);

    const draft: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
    draft.shouldStatusPageSubscribersBeNotifiedOnNoteCreated = true;

    const note: IncidentEpisodePublicNote = (await table().onBeforeCreate!(
      draft,
    )) as IncidentEpisodePublicNote;

    expect(note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);
  });

  test("refuses to create a note without a current project", async () => {
    serveEpisode(Promise.resolve(buildEpisode(false)));
    renderPage(null);

    await waitForTable();

    expect(() => {
      return table().onBeforeCreate!(new IncidentEpisodePublicNote());
    }).toThrow("Project ID cannot be null");
  });

  test("lists only this episode's notes", async () => {
    await renderPageFor(false);

    expect(String(table().query?.["incidentEpisodeId"])).toBe(EPISODE_ID);
    expect(String(table().query?.["projectId"])).toBe(PROJECT_ID.toString());
    expect(table().isEditable).toBe(true);
  });
});

/*
 * The page now has two errors: the episode load, which replaces the page, and
 * a failed resend, which is shown under the notes. A resend failure must not
 * take the table away.
 */
describe("episode public notes page: resending notifications", () => {
  test("queues the note's notification again and reloads the table", async () => {
    await renderPageFor(false);
    updateByIdMock.mockImplementation((): unknown => {
      return Promise.resolve(undefined);
    });

    const toggleBefore: string | undefined = table().refreshToggle;

    await act(async () => {
      await resendHandlerFor(
        "subscriberNotificationStatusOnNoteCreated",
        buildNote(),
      )();
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateByIdMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(request.modelType).toBe(IncidentEpisodePublicNote);
    expect(request.id.toString()).toBe(NOTE_ID);
    expect(request.data).toEqual({
      subscriberNotificationStatusOnNoteCreated:
        StatusPageSubscriberNotificationStatus.Pending,
      subscriberNotificationStatusMessage: null,
    });
    expect(table().refreshToggle).not.toBe(toggleBefore);
    // Resending does not read the episode again.
    expect(episodeRequests()).toHaveLength(1);
  });

  test("a failed resend shows its error under the notes and keeps the table", async () => {
    await renderPageFor(false);
    updateByIdMock.mockImplementation((): unknown => {
      return Promise.reject(new Error("Resend failed."));
    });

    await act(async () => {
      await resendHandlerFor(
        "subscriberNotificationStatusOnNoteUpdated",
        buildNote(),
      )();
    });

    // The update notification was the one asked for again.
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: Record<string, unknown> })
        .data,
    ).toEqual({
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
      subscriberNotificationStatusMessageOnNoteUpdated:
        SubscriberUpdateNotification.resendQueuedMessage,
    });

    expect(await screen.findByText("Resend failed.")).toBeInTheDocument();
    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    // Still the quiet episode's starting value.
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);
  });
});
