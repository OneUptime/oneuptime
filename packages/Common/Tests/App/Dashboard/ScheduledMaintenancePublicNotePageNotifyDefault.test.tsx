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
 * Scheduled Maintenance Events > View > Public Notes.
 *
 * A scheduled maintenance event created without notifying status page
 * subscribers ("Event Created: Notify Status Page Subscribers" unticked)
 * should not have its first public note be what tells them. The page
 * therefore loads the event's flag before it draws the notes table, and
 * hands the table's create form a starting value for "Notify Status Page
 * Subscribers" that follows it.
 *
 * ModelTable, BasicFormModal, ConfirmModal and GenerateFromAIModal are prop
 * recorders: what is under test is what the page hands them, and what it does
 * when their callbacks fire.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

type FormFieldEntry = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  description?: string | undefined;
  fieldType?: string | undefined;
  defaultValue?: unknown;
  required?: boolean | undefined;
  stepId?: string | undefined;
};

type CardButtonEntry = {
  title: string;
  onClick: () => void | Promise<void>;
};

type CapturedTableProps = {
  showCreateForm?: boolean | undefined;
  createInitialValues?: Record<string, unknown> | undefined;
  formFields?: Array<FormFieldEntry> | undefined;
  query?: Record<string, unknown> | undefined;
  onBeforeCreate?: ((item: unknown) => Promise<unknown>) | undefined;
  cardProps?:
    | {
        buttons?: Array<CardButtonEntry> | undefined;
      }
    | undefined;
};

type CreateFormOpening = {
  query?: Record<string, unknown> | undefined;
  createInitialValues?: Record<string, unknown> | undefined;
};

let tableRenders: Array<CapturedTableProps> = [];
let createFormOpenings: Array<CreateFormOpening> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): ReactElement => {
      tableRenders.push(props);

      /*
       * Mirrors BaseModelTable: the create form opens whenever
       * showCreateForm turns true, including when the table mounts with it.
       */
      React.useEffect(() => {
        if (props.showCreateForm) {
          createFormOpenings.push({
            query: props.query,
            createInitialValues: props.createInitialValues,
          });
        }
      }, [props.showCreateForm]);

      return <div data-testid="public-note-table" />;
    },
  };
});

type CapturedTemplateModalProps = {
  title: string;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
};

let capturedTemplateModalProps: CapturedTemplateModalProps | null = null;

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedTemplateModalProps): ReactElement => {
      capturedTemplateModalProps = props;
      return <div data-testid="template-modal" />;
    },
  };
});

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: { title: string; description: string }): ReactElement => {
      return (
        <div data-testid="confirm-modal">
          {props.title}: {props.description}
        </div>
      );
    },
  };
});

type CapturedAIModalProps = {
  onSuccess: (generatedContent: string) => void;
  onClose: () => void;
};

let capturedAIModalProps: CapturedAIModalProps | null = null;

jest.mock("../../../UI/Components/AI/GenerateFromAIModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedAIModalProps): ReactElement => {
      capturedAIModalProps = props;
      return <div data-testid="ai-modal" />;
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
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
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

import PublicNote from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/PublicNote";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceNoteTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import Navigation from "../../../UI/Utils/Navigation";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const EVENT_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_EVENT_ID: string = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_ID: string = "44444444-4444-4444-8444-444444444444";

const PAGE_ROUTE: string =
  "/dashboard/scheduled-maintenance-events/view/public-notes";
const NOTIFY_FIELD: string =
  "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";
const NOTIFYING_DESCRIPTION: string =
  "Should status page subscribers be notified?";
const TEMPLATE_NOTE: string =
  "The failover drill has started. Writes may pause for a few seconds.";

let currentEventId: string = EVENT_ID;

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

function buildEvent(
  notifyOnCreate: boolean | null | undefined,
): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = currentEventId;

  if (notifyOnCreate !== undefined) {
    event.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
      notifyOnCreate as boolean;
  }

  return event;
}

function buildTemplate(): ScheduledMaintenanceNoteTemplate {
  const template: ScheduledMaintenanceNoteTemplate =
    new ScheduledMaintenanceNoteTemplate();
  template._id = TEMPLATE_ID;
  template.templateName = "Drill started";
  template.note = TEMPLATE_NOTE;
  return template;
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

function eventRequests(): Array<ModelRequest> {
  return getItemMock.mock.calls
    .map((args: Array<unknown>) => {
      return args[0] as ModelRequest;
    })
    .filter((request: ModelRequest) => {
      return request.modelType === ScheduledMaintenance;
    });
}

/*
 * The event lookup answers with `event`; the template lookup always answers
 * with the one template, so a flow can use both.
 */
function serveEvent(event: Promise<ScheduledMaintenance | null>): void {
  getItemMock.mockImplementation((...args: Array<unknown>): unknown => {
    const request: ModelRequest = args[0] as ModelRequest;

    if (request.modelType === ScheduledMaintenanceNoteTemplate) {
      return Promise.resolve(buildTemplate());
    }

    return event;
  });

  getListMock.mockImplementation((): unknown => {
    return Promise.resolve({
      data: [buildTemplate()],
      count: 1,
      skip: 0,
      limit: 10,
    });
  });
}

function renderPage(
  currentProject: Project | null = buildProject(),
): RenderResult {
  return render(
    <PublicNote
      pageRoute={new Route(PAGE_ROUTE)}
      currentProject={currentProject}
      hasPaymentMethod={true}
    />,
  );
}

async function renderPageFor(
  notifyOnCreate: boolean | null | undefined,
): Promise<RenderResult> {
  serveEvent(Promise.resolve(buildEvent(notifyOnCreate)));
  const view: RenderResult = renderPage();

  await waitFor(() => {
    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
  });

  return view;
}

// Renders the still-mounted page again, as a route change does.
function rerenderPage(view: RenderResult): void {
  view.rerender(
    <PublicNote
      pageRoute={new Route(PAGE_ROUTE)}
      currentProject={buildProject()}
      hasPaymentMethod={true}
    />,
  );
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

async function clickCardButton(title: string): Promise<void> {
  const button: CardButtonEntry | undefined = (
    table().cardProps?.buttons || []
  ).find((entry: CardButtonEntry) => {
    return entry.title === title;
  });

  if (!button) {
    throw new Error(`The table card has no ${title} button`);
  }

  await act(async () => {
    await button.onClick();
  });
}

async function createFromTemplate(): Promise<void> {
  capturedTemplateModalProps = null;

  await clickCardButton("Create from Template");

  await waitFor(() => {
    expect(capturedTemplateModalProps).not.toBeNull();
  });

  expect(table().showCreateForm).toBe(false);

  await act(async () => {
    await capturedTemplateModalProps!.onSubmit({
      scheduledMaintenanceNoteTemplateId: new ObjectID(TEMPLATE_ID),
    });
  });
}

async function generateWithAI(text: string): Promise<void> {
  capturedAIModalProps = null;

  await clickCardButton("Generate with AI");

  await waitFor(() => {
    expect(capturedAIModalProps).not.toBeNull();
  });

  await act(async () => {
    capturedAIModalProps!.onSuccess(text);
  });
}

beforeEach(() => {
  currentEventId = EVENT_ID;
  tableRenders = [];
  createFormOpenings = [];
  capturedTemplateModalProps = null;
  capturedAIModalProps = null;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(currentEventId);
    });
  jest.spyOn(Navigation, "getCurrentRoute").mockImplementation((): Route => {
    return new Route(PAGE_ROUTE);
  });
});

afterEach(() => {
  cleanup();
  getItemMock.mockReset();
  getListMock.mockReset();
  jest.restoreAllMocks();
});

describe("public notes page: loading the event's notify setting", () => {
  test("asks for only the event's notify-on-create flag, by the event in the route", async () => {
    await renderPageFor(false);

    const requests: Array<ModelRequest> = eventRequests();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.id?.toString()).toBe(EVENT_ID);
    expect(requests[0]!.select).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
    });
  });

  test("shows a loader and no notes table while the event is still loading", async () => {
    const event: Deferred<ScheduledMaintenance | null> =
      createDeferred<ScheduledMaintenance | null>();
    serveEvent(event.promise);

    renderPage();

    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("public-note-table")).toBeNull();
    // No create form can have been handed a starting value yet.
    expect(tableRenders).toHaveLength(0);

    await act(async () => {
      event.resolve(buildEvent(false));
    });

    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(tableRenders.length).toBeGreaterThan(0);

    // The very first table render already knows the event was quiet.
    for (const tableRender of tableRenders) {
      expect(tableRender.createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    }
  });

  test("shows the error and no notes table when the event cannot be loaded", async () => {
    serveEvent(
      Promise.reject(new Error("Scheduled maintenance could not be loaded.")),
    );

    renderPage();

    expect(
      await screen.findByText("Scheduled maintenance could not be loaded."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("public-note-table")).toBeNull();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(tableRenders).toHaveLength(0);
  });

  test("ignores a slower answer for the event the page has already moved away from", async () => {
    const firstEvent: Deferred<ScheduledMaintenance | null> =
      createDeferred<ScheduledMaintenance | null>();
    const secondEvent: Deferred<ScheduledMaintenance | null> =
      createDeferred<ScheduledMaintenance | null>();

    getItemMock.mockImplementation((...args: Array<unknown>): unknown => {
      const request: ModelRequest = args[0] as ModelRequest;
      return request.id?.toString() === EVENT_ID
        ? firstEvent.promise
        : secondEvent.promise;
    });

    const view: RenderResult = renderPage();

    currentEventId = OTHER_EVENT_ID;
    view.rerender(
      <PublicNote
        pageRoute={new Route(PAGE_ROUTE)}
        currentProject={buildProject()}
        hasPaymentMethod={true}
      />,
    );

    await waitFor(() => {
      expect(eventRequests()).toHaveLength(2);
    });
    expect(eventRequests()[1]!.id?.toString()).toBe(OTHER_EVENT_ID);

    const quietEvent: ScheduledMaintenance = new ScheduledMaintenance();
    quietEvent._id = OTHER_EVENT_ID;
    quietEvent.shouldStatusPageSubscribersBeNotifiedOnEventCreated = false;

    await act(async () => {
      secondEvent.resolve(quietEvent);
    });

    const notifyingEvent: ScheduledMaintenance = new ScheduledMaintenance();
    notifyingEvent._id = EVENT_ID;
    notifyingEvent.shouldStatusPageSubscribersBeNotifiedOnEventCreated = true;

    await act(async () => {
      firstEvent.resolve(notifyingEvent);
    });

    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    expect(notifyFormField().defaultValue).toBe(false);
    expect(notifyFormField().description).toBe(
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    );
  });

  test("moving to another event waits for that event's setting instead of keeping the last one", async () => {
    serveEvent(Promise.resolve(buildEvent(false)));

    const view: RenderResult = renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    });
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);

    const nextEvent: Deferred<ScheduledMaintenance | null> =
      createDeferred<ScheduledMaintenance | null>();

    getItemMock.mockImplementation((...args: Array<unknown>): unknown => {
      const request: ModelRequest = args[0] as ModelRequest;

      if (request.id?.toString() === OTHER_EVENT_ID) {
        return nextEvent.promise;
      }

      return Promise.resolve(buildEvent(false));
    });

    currentEventId = OTHER_EVENT_ID;
    view.rerender(
      <PublicNote
        pageRoute={new Route(PAGE_ROUTE)}
        currentProject={buildProject()}
        hasPaymentMethod={true}
      />,
    );

    // The page stays mounted, so it goes back to loading for the new event.
    await waitFor(() => {
      expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("public-note-table")).toBeNull();
    expect(eventRequests()).toHaveLength(2);
    expect(eventRequests()[1]!.id?.toString()).toBe(OTHER_EVENT_ID);

    const notifyingEvent: ScheduledMaintenance = new ScheduledMaintenance();
    notifyingEvent._id = OTHER_EVENT_ID;
    notifyingEvent.shouldStatusPageSubscribersBeNotifiedOnEventCreated = true;

    await act(async () => {
      nextEvent.resolve(notifyingEvent);
    });

    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(true);
    expect(notifyFormField().defaultValue).toBe(true);
    expect(notifyFormField().description).toBe(NOTIFYING_DESCRIPTION);
    expect(String(table().query?.["scheduledMaintenanceId"])).toBe(
      OTHER_EVENT_ID,
    );
  });
});

describe("public notes page: an event created without notifying subscribers", () => {
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
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    );
    expect(field.description).not.toBe(NOTIFYING_DESCRIPTION);
    expect(field.title).toBe("Notify Status Page Subscribers");
    expect(field.required).toBe(false);
    // Still on the same step of the form as before.
    expect(field.stepId).toBe("more");
  });

  test("does not open the create form on its own", async () => {
    await renderPageFor(false);

    expect(table().showCreateForm).toBe(false);
  });
});

describe.each([
  ["that notified subscribers", true],
  ["with no notify setting stored", undefined],
  ["whose notify setting reads back as null", null],
])(
  "public notes page: an event %s",
  (_name: string, notifyOnCreate: boolean | null | undefined) => {
    test("seeds the create form with notify subscribers on", async () => {
      await renderPageFor(notifyOnCreate);

      expect(table().createInitialValues).toEqual({
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
      });
      expect(table().showCreateForm).toBe(false);
    });

    test("starts the checkbox ticked with the usual description", async () => {
      await renderPageFor(notifyOnCreate);

      const field: FormFieldEntry = notifyFormField();

      expect(field.defaultValue).toBe(true);
      expect(field.description).toBe(NOTIFYING_DESCRIPTION);
    });
  },
);

describe("public notes page: an event the lookup does not find", () => {
  test("falls back to notifying subscribers", async () => {
    serveEvent(Promise.resolve(null));
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    });

    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(true);
    expect(notifyFormField().defaultValue).toBe(true);
    expect(notifyFormField().description).toBe(NOTIFYING_DESCRIPTION);
  });
});

describe("public notes page: drafting a note from a template", () => {
  test("opens the form with the template's note and notify subscribers still off", async () => {
    await renderPageFor(false);

    await createFromTemplate();

    expect(table().showCreateForm).toBe(true);
    expect(table().createInitialValues?.["note"]).toBe(TEMPLATE_NOTE);
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    expect(notifyFormField().defaultValue).toBe(false);
  });

  test("keeps notify subscribers on for an event that notified", async () => {
    await renderPageFor(true);

    await createFromTemplate();

    expect(table().showCreateForm).toBe(true);
    expect(table().createInitialValues?.["note"]).toBe(TEMPLATE_NOTE);
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(true);
  });

  test("fetches the chosen template and lists templates without touching the event again", async () => {
    await renderPageFor(false);

    await createFromTemplate();

    const templateRequest: ModelRequest | undefined = getItemMock.mock.calls
      .map((args: Array<unknown>) => {
        return args[0] as ModelRequest;
      })
      .find((request: ModelRequest) => {
        return request.modelType === ScheduledMaintenanceNoteTemplate;
      });

    expect(templateRequest?.id?.toString()).toBe(TEMPLATE_ID);
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(eventRequests()).toHaveLength(1);
  });
});

describe("public notes page: drafting a note with AI", () => {
  test("opens the form with the draft and notify subscribers still off", async () => {
    await renderPageFor(false);

    await generateWithAI("Drafted by AI.");

    expect(table().showCreateForm).toBe(true);
    expect(table().createInitialValues).toEqual({
      note: "Drafted by AI.",
      shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
    });
    expect(screen.queryByTestId("ai-modal")).toBeNull();
  });

  test("opens the form with the draft and notify subscribers on for an event that notified", async () => {
    await renderPageFor(true);

    await generateWithAI("Drafted by AI.");

    expect(table().showCreateForm).toBe(true);
    expect(table().createInitialValues).toEqual({
      note: "Drafted by AI.",
      shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
    });
  });
});

describe("public notes page: a draft does not follow you to another event", () => {
  /*
   * The page stays mounted when the route moves to another event, but the
   * notes table is swapped for a loader until that event's flag arrives and
   * then mounts afresh - and a table that mounts with a draft opens its
   * create form by itself. A draft left from the last event would open
   * there, and saving it would post it on this one.
   */
  async function moveToOtherEvent(
    view: RenderResult,
    notifyOnCreate: boolean,
  ): Promise<void> {
    const nextEvent: Deferred<ScheduledMaintenance | null> =
      createDeferred<ScheduledMaintenance | null>();

    getItemMock.mockImplementation((...args: Array<unknown>): unknown => {
      const request: ModelRequest = args[0] as ModelRequest;

      if (request.modelType === ScheduledMaintenanceNoteTemplate) {
        return Promise.resolve(buildTemplate());
      }

      if (request.id?.toString() === OTHER_EVENT_ID) {
        return nextEvent.promise;
      }

      return Promise.resolve(buildEvent(false));
    });

    currentEventId = OTHER_EVENT_ID;
    rerenderPage(view);

    await waitFor(() => {
      expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("public-note-table")).toBeNull();

    // From here on, only the table mounted for the new event is recorded.
    tableRenders = [];

    await act(async () => {
      nextEvent.resolve(buildEvent(notifyOnCreate));
    });

    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    expect(String(table().query?.["scheduledMaintenanceId"])).toBe(
      OTHER_EVENT_ID,
    );
  }

  function expectNoDraftOnTheNewTable(notifyOnCreate: boolean): void {
    // The form opened once, on the first event, and not again.
    expect(createFormOpenings.slice(1)).toEqual([]);

    for (const tableRender of tableRenders) {
      expect(tableRender.showCreateForm).toBe(false);
      expect(tableRender.createInitialValues).toEqual({
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: notifyOnCreate,
      });
    }
  }

  test("a template chosen on one event does not open the create form on the next", async () => {
    const view: RenderResult = await renderPageFor(false);

    await createFromTemplate();

    expect(createFormOpenings).toHaveLength(1);
    expect(createFormOpenings[0]!.createInitialValues?.["note"]).toBe(
      TEMPLATE_NOTE,
    );

    await moveToOtherEvent(view, true);

    expectNoDraftOnTheNewTable(true);
  });

  test("an AI draft written on one event does not open the create form on the next", async () => {
    const view: RenderResult = await renderPageFor(false);

    await generateWithAI("Drafted by AI for the first event.");

    expect(createFormOpenings).toHaveLength(1);

    await moveToOtherEvent(view, false);

    expectNoDraftOnTheNewTable(false);
  });

  test("a template chosen after moving opens the form with the new event's flag", async () => {
    const view: RenderResult = await renderPageFor(false);

    await createFromTemplate();
    await moveToOtherEvent(view, true);
    await createFromTemplate();

    expect(table().showCreateForm).toBe(true);
    expect(table().createInitialValues?.["note"]).toBe(TEMPLATE_NOTE);
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(true);
    expect(createFormOpenings).toHaveLength(2);
    expect(
      String(createFormOpenings[1]!.query?.["scheduledMaintenanceId"]),
    ).toBe(OTHER_EVENT_ID);
    expect(createFormOpenings[1]!.createInitialValues?.[NOTIFY_FIELD]).toBe(
      true,
    );
  });

  test("rendering the same event again keeps the draft and the open form", async () => {
    const view: RenderResult = await renderPageFor(false);

    await createFromTemplate();
    rerenderPage(view);

    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(table().showCreateForm).toBe(true);
    expect(table().createInitialValues?.["note"]).toBe(TEMPLATE_NOTE);
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    expect(createFormOpenings).toHaveLength(1);
    expect(eventRequests()).toHaveLength(1);
  });
});

describe("public notes page: creating a note", () => {
  test("still stamps the note with this event and the current project", async () => {
    await renderPageFor(false);

    const note: ScheduledMaintenancePublicNote = (await table().onBeforeCreate!(
      new ScheduledMaintenancePublicNote(),
    )) as ScheduledMaintenancePublicNote;

    expect(note.scheduledMaintenanceId?.toString()).toBe(EVENT_ID);
    expect(note.projectId?.toString()).toBe(PROJECT_ID.toString());
    // The page leaves the flag to the form; it does not force one.
    expect(note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      undefined,
    );
  });

  test("refuses to create a note without a current project", async () => {
    serveEvent(Promise.resolve(buildEvent(false)));
    renderPage(null);

    await waitFor(() => {
      expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    });

    expect(() => {
      return table().onBeforeCreate!(new ScheduledMaintenancePublicNote());
    }).toThrow("Project ID cannot be null");
  });

  test("lists only this event's notes", async () => {
    await renderPageFor(false);

    expect(String(table().query?.["scheduledMaintenanceId"])).toBe(EVENT_ID);
    expect(String(table().query?.["projectId"])).toBe(PROJECT_ID.toString());
  });
});
