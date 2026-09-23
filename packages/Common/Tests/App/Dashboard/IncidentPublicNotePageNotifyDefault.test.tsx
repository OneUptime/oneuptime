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
 * Incidents > View > Public Notes.
 *
 * An incident declared without notifying status page subscribers (or a
 * private one, which the server forces to the same) should not have its
 * first public note be what tells them. The page therefore loads the
 * incident's flag before it draws the notes table, and hands the table's
 * create form a starting value for "Notify Status Page Subscribers" that
 * follows it.
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

import PublicNote from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/PublicNote";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import Navigation from "../../../UI/Utils/Navigation";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_INCIDENT_ID: string = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_ID: string = "44444444-4444-4444-8444-444444444444";

const NOTIFY_FIELD: string =
  "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";
const NOTIFYING_DESCRIPTION: string =
  "Should status page subscribers be notified?";
const TEMPLATE_NOTE: string = "We are investigating elevated error rates.";

let currentIncidentId: string = INCIDENT_ID;

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

function buildIncident(notifyOnCreate: boolean | undefined): Incident {
  const incident: Incident = new Incident();
  incident._id = currentIncidentId;

  if (notifyOnCreate !== undefined) {
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
      notifyOnCreate;
  }

  return incident;
}

function buildTemplate(): IncidentNoteTemplate {
  const template: IncidentNoteTemplate = new IncidentNoteTemplate();
  template._id = TEMPLATE_ID;
  template.templateName = "Investigating";
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

function incidentRequests(): Array<ModelRequest> {
  return getItemMock.mock.calls
    .map((args: Array<unknown>) => {
      return args[0] as ModelRequest;
    })
    .filter((request: ModelRequest) => {
      return request.modelType === Incident;
    });
}

/*
 * The incident lookup answers with `incident`; the template lookup always
 * answers with the one template, so a flow can use both.
 */
function serveIncident(incident: Promise<Incident | null>): void {
  getItemMock.mockImplementation((...args: Array<unknown>): unknown => {
    const request: ModelRequest = args[0] as ModelRequest;

    if (request.modelType === IncidentNoteTemplate) {
      return Promise.resolve(buildTemplate());
    }

    return incident;
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
      pageRoute={new Route("/dashboard/incidents/view/public-notes")}
      currentProject={currentProject}
      hasPaymentMethod={true}
    />,
  );
}

async function renderPageFor(
  notifyOnCreate: boolean | undefined,
): Promise<void> {
  serveIncident(Promise.resolve(buildIncident(notifyOnCreate)));
  renderPage();

  await waitFor(() => {
    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
  });
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

beforeEach(() => {
  currentIncidentId = INCIDENT_ID;
  tableRenders = [];
  capturedTemplateModalProps = null;
  capturedAIModalProps = null;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(currentIncidentId);
    });
  jest.spyOn(Navigation, "getCurrentRoute").mockImplementation((): Route => {
    return new Route("/dashboard/incidents/view/public-notes");
  });
});

afterEach(() => {
  cleanup();
  getItemMock.mockReset();
  getListMock.mockReset();
  jest.restoreAllMocks();
});

describe("public notes page: loading the incident's notify setting", () => {
  test("asks for only the incident's notify-on-declare flag, by the incident in the route", async () => {
    await renderPageFor(false);

    const requests: Array<ModelRequest> = incidentRequests();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.id?.toString()).toBe(INCIDENT_ID);
    expect(requests[0]!.select).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    });
  });

  test("shows a loader and no notes table while the incident is still loading", async () => {
    const incident: Deferred<Incident | null> =
      createDeferred<Incident | null>();
    serveIncident(incident.promise);

    renderPage();

    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("public-note-table")).toBeNull();
    // No create form can have been handed a starting value yet.
    expect(tableRenders).toHaveLength(0);

    await act(async () => {
      incident.resolve(buildIncident(false));
    });

    expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(tableRenders.length).toBeGreaterThan(0);

    // The very first table render already knows the incident was quiet.
    for (const tableRender of tableRenders) {
      expect(tableRender.createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    }
  });

  test("shows the error and no notes table when the incident cannot be loaded", async () => {
    serveIncident(Promise.reject(new Error("Incident could not be loaded.")));

    renderPage();

    expect(
      await screen.findByText("Incident could not be loaded."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("public-note-table")).toBeNull();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(tableRenders).toHaveLength(0);
  });

  test("ignores a slower answer for the incident the page has already moved away from", async () => {
    const firstIncident: Deferred<Incident | null> =
      createDeferred<Incident | null>();
    const secondIncident: Deferred<Incident | null> =
      createDeferred<Incident | null>();

    getItemMock.mockImplementation((...args: Array<unknown>): unknown => {
      const request: ModelRequest = args[0] as ModelRequest;
      return request.id?.toString() === INCIDENT_ID
        ? firstIncident.promise
        : secondIncident.promise;
    });

    const view: RenderResult = renderPage();

    currentIncidentId = OTHER_INCIDENT_ID;
    view.rerender(
      <PublicNote
        pageRoute={new Route("/dashboard/incidents/view/public-notes")}
        currentProject={buildProject()}
        hasPaymentMethod={true}
      />,
    );

    await waitFor(() => {
      expect(incidentRequests()).toHaveLength(2);
    });
    expect(incidentRequests()[1]!.id?.toString()).toBe(OTHER_INCIDENT_ID);

    const quietIncident: Incident = new Incident();
    quietIncident._id = OTHER_INCIDENT_ID;
    quietIncident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
      false;

    await act(async () => {
      secondIncident.resolve(quietIncident);
    });

    const notifyingIncident: Incident = new Incident();
    notifyingIncident._id = INCIDENT_ID;
    notifyingIncident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
      true;

    await act(async () => {
      firstIncident.resolve(notifyingIncident);
    });

    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    expect(notifyFormField().defaultValue).toBe(false);
  });
});

describe("public notes page: an incident declared without notifying subscribers", () => {
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
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
    );
    expect(field.description).not.toBe(NOTIFYING_DESCRIPTION);
    expect(field.title).toBe("Notify Status Page Subscribers");
    expect(field.required).toBe(false);
  });

  test("does not open the create form on its own", async () => {
    await renderPageFor(false);

    expect(table().showCreateForm).toBe(false);
  });
});

describe.each([
  ["that notified subscribers", true],
  ["with no notify setting stored", undefined],
])(
  "public notes page: an incident %s",
  (_name: string, notifyOnCreate: boolean | undefined) => {
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

describe("public notes page: an incident the lookup does not find", () => {
  test("falls back to notifying subscribers", async () => {
    serveIncident(Promise.resolve(null));
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
  async function createFromTemplate(): Promise<void> {
    await clickCardButton("Create from Template");

    await waitFor(() => {
      expect(capturedTemplateModalProps).not.toBeNull();
    });

    expect(table().showCreateForm).toBe(false);

    await act(async () => {
      await capturedTemplateModalProps!.onSubmit({
        incidentNoteTemplateId: new ObjectID(TEMPLATE_ID),
      });
    });
  }

  test("opens the form with the template's note and notify subscribers still off", async () => {
    await renderPageFor(false);

    await createFromTemplate();

    expect(table().showCreateForm).toBe(true);
    expect(table().createInitialValues?.["note"]).toBe(TEMPLATE_NOTE);
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(false);
    expect(notifyFormField().defaultValue).toBe(false);
  });

  test("keeps notify subscribers on for an incident that notified", async () => {
    await renderPageFor(true);

    await createFromTemplate();

    expect(table().showCreateForm).toBe(true);
    expect(table().createInitialValues?.["note"]).toBe(TEMPLATE_NOTE);
    expect(table().createInitialValues?.[NOTIFY_FIELD]).toBe(true);
  });

  test("fetches the chosen template and lists templates without touching the incident again", async () => {
    await renderPageFor(false);

    await createFromTemplate();

    const templateRequest: ModelRequest | undefined = getItemMock.mock.calls
      .map((args: Array<unknown>) => {
        return args[0] as ModelRequest;
      })
      .find((request: ModelRequest) => {
        return request.modelType === IncidentNoteTemplate;
      });

    expect(templateRequest?.id?.toString()).toBe(TEMPLATE_ID);
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(incidentRequests()).toHaveLength(1);
  });
});

describe("public notes page: drafting a note with AI", () => {
  async function generateWithAI(text: string): Promise<void> {
    await clickCardButton("Generate with AI");

    await waitFor(() => {
      expect(capturedAIModalProps).not.toBeNull();
    });

    await act(async () => {
      capturedAIModalProps!.onSuccess(text);
    });
  }

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

  test("opens the form with the draft and notify subscribers on for an incident that notified", async () => {
    await renderPageFor(true);

    await generateWithAI("Drafted by AI.");

    expect(table().showCreateForm).toBe(true);
    expect(table().createInitialValues).toEqual({
      note: "Drafted by AI.",
      shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
    });
  });
});

describe("public notes page: creating a note", () => {
  test("still stamps the note with this incident and the current project", async () => {
    await renderPageFor(false);

    const note: IncidentPublicNote = (await table().onBeforeCreate!(
      new IncidentPublicNote(),
    )) as IncidentPublicNote;

    expect(note.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(note.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("refuses to create a note without a current project", async () => {
    serveIncident(Promise.resolve(buildIncident(false)));
    renderPage(null);

    await waitFor(() => {
      expect(screen.getByTestId("public-note-table")).toBeInTheDocument();
    });

    expect(() => {
      return table().onBeforeCreate!(new IncidentPublicNote());
    }).toThrow("Project ID cannot be null");
  });

  test("lists only this incident's notes", async () => {
    await renderPageFor(false);

    expect(String(table().query?.["incidentId"])).toBe(INCIDENT_ID);
    expect(String(table().query?.["projectId"])).toBe(PROJECT_ID.toString());
  });
});
