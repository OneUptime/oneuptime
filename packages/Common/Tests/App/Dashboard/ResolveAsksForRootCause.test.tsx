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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { JSONObject } from "../../../Types/JSON";

const getListMock: MockFunction = getJestMockFunction();
const fetchNoteTemplateVariablesMock: MockFunction = getJestMockFunction();

// What the real dialog's form sends, captured by createOrUpdate.
let capturedModel: JSONObject | null = null;
let capturedMiscDataProps: JSONObject | null = null;

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

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock consts above are still unassigned when the factory
 * runs. Dereferencing them lazily, at call time, is what makes this work.
 *
 * createOrUpdate serialises the model the way ModelAPI does, and then through
 * JSON, so an unset value is exactly as absent as in the request body.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: BaseModel;
        modelType: typeof BaseModel;
        miscDataProps?: JSONObject | undefined;
      }): Promise<{ data: JSONObject }> => {
        capturedModel = JSON.parse(
          JSON.stringify(BaseModel.toJSON(data.model, data.modelType)),
        ) as JSONObject;
        capturedMiscDataProps = data.miscDataProps || {};
        return { data: {} };
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentNoteTemplateVariables",
  () => {
    return {
      __esModule: true,
      fetchIncidentNoteTemplateVariables: (...args: Array<unknown>) => {
        return fetchNoteTemplateVariablesMock(...args);
      },
    };
  },
);

// The reader owns the project: every field the dialogs draw is theirs to set.
jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

import ChangeAlertState from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/ChangeState";
import ChangeIncidentState from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../Models/DatabaseModels/Project";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
  PermissionGateOptions,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { hasSetChip } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * RESOLVING ASKS FOR THE ROOT CAUSE (#7765).
 *
 * Resolving an incident or an alert from its header folds an optional
 * "Add the root cause" after the note: why it happened, which becomes the
 * record's root cause and what OneUptime AI's investigation is graded
 * against. Optional, like the note - Resolve straight away resolves as
 * before - and offered only to someone who may edit the record, since the
 * server refuses a change whose root cause its sender may not write. These
 * tests open the real dialogs from the real headers, against a fake API,
 * and check what they show and what they send.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EVENT_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RESOLVED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const TITLE: string = "Checkout latency above 2s";
const START: Date = new Date(Date.now() - 20 * 60 * 1000);
const ROOT_CAUSE_TEXT: string =
  "The nightly reindex starved the orders database of IOPS.";

const ADD_ROOT_CAUSE: string = "Add the root cause";
const NOT_ALLOWED: string =
  "You do not have permission to edit this record. You need this permission: Edit.";

type ListResultShape = {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

function listOf(data: Array<unknown>): ListResultShape {
  return { data, count: data.length, skip: 0, limit: 99 };
}

type StateLike = {
  id: ObjectID | null;
  name?: string | undefined;
  color?: Color | undefined;
};

function eventStates<T extends StateLike>(StateModel: { new (): T }): Array<T> {
  return [
    [CREATED_ID, "Created", "#ef4444", "isCreatedState"],
    [ACKNOWLEDGED_ID, "Acknowledged", "#f59e0b", "isAcknowledgedState"],
    [RESOLVED_ID, "Resolved", "#10b981", "isResolvedState"],
  ].map((spec: Array<string>): T => {
    const state: T = new StateModel();
    state.id = new ObjectID(spec[0]!);
    state.name = spec[1]!;
    state.color = new Color(spec[2]!);
    (state as Record<string, unknown>)[spec[3]!] = true;
    return state;
  });
}

function dialogNamed(name: string): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name });
}

function fold(dialog: HTMLElement, name: string): HTMLElement {
  return within(dialog).getByRole("button", { name });
}

function submitButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByTestId("modal-footer-submit-button");
}

// What one folded section holds, found through the fold's own control.
function foldBody(dialog: HTMLElement, name: string): HTMLElement {
  const bodyId: string | null = fold(dialog, name).getAttribute(
    "aria-controls",
  );

  expect(bodyId).toBeTruthy();

  const body: HTMLElement | null = document.getElementById(bodyId!);

  expect(body).not.toBeNull();

  return body!;
}

async function writeRootCauseIn(dialog: HTMLElement): Promise<void> {
  fireEvent.click(fold(dialog, ADD_ROOT_CAUSE));

  const body: HTMLElement = foldBody(dialog, ADD_ROOT_CAUSE);

  // The markdown source view is a plain textarea.
  fireEvent.click(within(body).getByTitle("Switch to markdown source"));
  fireEvent.change(
    await within(body).findByPlaceholderText("Type your markdown here..."),
    { target: { value: ROOT_CAUSE_TEXT } },
  );
}

async function sent(): Promise<{ model: JSONObject; misc: JSONObject }> {
  await waitFor(() => {
    expect(capturedModel).not.toBeNull();
  });

  return { model: capturedModel!, misc: capturedMiscDataProps! };
}

function idOf(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return String((value as JSONObject)["value"] ?? value);
}

/*
 * The fold buttons of a dialog, in the order it draws them: what it folds,
 * read from the page as a reader meets it.
 */
function foldNames(dialog: HTMLElement): Array<string> {
  return within(dialog)
    .queryAllByTestId("folded-section-header")
    .map((header: HTMLElement): string => {
      const titleId: string | null = header.getAttribute("aria-labelledby");

      return (
        (titleId && document.getElementById(titleId)?.textContent?.trim()) || ""
      );
    });
}

// Someone who may change the state but not edit the record.
function forbidEditing(RecordModel: {
  new (): PermissionCheckableModel;
}): void {
  const realCheck: typeof PermissionGate.check =
    PermissionGate.check.bind(PermissionGate);

  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (
        model: PermissionCheckableModel,
        action: ModelAction,
        options?: PermissionGateOptions | undefined,
      ): PermissionGateResult => {
        if (action === ModelAction.Update && model instanceof RecordModel) {
          return { isAllowed: false, disabledReason: NOT_ALLOWED };
        }

        return realCheck(model, action, options);
      },
    );
}

beforeEach(() => {
  capturedModel = null;
  capturedMiscDataProps = null;
  PermissionGate.clearPermissionPropsCache();

  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);

  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);

  fetchNoteTemplateVariablesMock.mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  fetchNoteTemplateVariablesMock.mockReset();
  jest.restoreAllMocks();
});

describe("Resolve on an alert", () => {
  beforeEach(() => {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      if (modelType === AlertState) {
        return Promise.resolve(listOf(eventStates(AlertState)));
      }

      if (modelType === AlertStateTimeline) {
        const timeline: AlertStateTimeline = new AlertStateTimeline();
        timeline.alertStateId = new ObjectID(CREATED_ID);
        timeline.startsAt = START;
        return Promise.resolve(listOf([timeline]));
      }

      return Promise.resolve(listOf([]));
    });
  });

  async function openHeader(): Promise<void> {
    render(
      <ChangeAlertState
        alertId={new ObjectID(EVENT_ID)}
        eventNumber="ALT-7"
        title={TITLE}
        eventStartsAt={START}
        onActionComplete={jest.fn()}
      />,
    );

    await screen.findByRole("heading", { level: 2, name: TITLE });
  }

  async function openResolve(): Promise<HTMLElement> {
    await openHeader();
    fireEvent.click(document.getElementById("alert-resolve-btn")!);

    const dialog: HTMLElement = await dialogNamed("Resolve Alert");
    await within(dialog).findByRole("button", { name: "Add a private note" });

    return dialog;
  }

  test("folds the root cause after the note, both closed, and stays a short confirm", async () => {
    const dialog: HTMLElement = await openResolve();

    expect(foldNames(dialog)).toEqual(["Add a private note", ADD_ROOT_CAUSE]);
    expect(fold(dialog, ADD_ROOT_CAUSE)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(dialog).toHaveClass("sm:max-w-lg");
    expect(submitButton(dialog)).toHaveTextContent("Resolve");
  });

  test("opened, it says what the root cause becomes, and the dialog widens for the editor", async () => {
    const dialog: HTMLElement = await openResolve();

    fireEvent.click(fold(dialog, ADD_ROOT_CAUSE));

    expect(fold(dialog, ADD_ROOT_CAUSE)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(dialog).toHaveClass("sm:max-w-7xl");

    const body: HTMLElement = foldBody(dialog, ADD_ROOT_CAUSE);

    expect(body).toHaveTextContent("Root Cause");
    expect(body).toHaveTextContent(
      "Why did this alert happen? It is saved as the alert's root cause, and OneUptime AI's investigation is graded against it.",
    );
    expect(
      await within(body).findByTestId("markdown-editor-toolbar"),
    ).toBeVisible();
  });

  test("Resolve straight away resolves the alert and sends no root cause", async () => {
    const dialog: HTMLElement = await openResolve();

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(idOf(request.model["alertStateId"])).toBe(RESOLVED_ID);
    expect(idOf(request.model["alertId"])).toBe(EVENT_ID);
    expect(request.misc["writtenRootCause"] || "").toBe("");
    expect(request.model["writtenRootCause"]).toBeUndefined();
  });

  test("a root cause written in the fold is sent with the change, folded again it says it is set", async () => {
    const dialog: HTMLElement = await openResolve();

    await writeRootCauseIn(dialog);

    // Folded again it keeps what was written, and says something is in it.
    fireEvent.click(fold(dialog, ADD_ROOT_CAUSE));
    expect(hasSetChip(fold(dialog, ADD_ROOT_CAUSE))).toBe(true);
    expect(dialog).toHaveClass("sm:max-w-lg");

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(idOf(request.model["alertStateId"])).toBe(RESOLVED_ID);
    expect(request.misc["writtenRootCause"]).toBe(ROOT_CAUSE_TEXT);
    // Not a column of the state change: it travels beside it.
    expect(request.model["writtenRootCause"]).toBeUndefined();
    expect(request.model["rootCause"]).toBeUndefined();
    // The note stays the note's.
    expect(request.misc["privateNote"] || "").toBe("");
  });

  test("Acknowledge does not ask for the root cause", async () => {
    await openHeader();
    fireEvent.click(document.getElementById("alert-acknowledge-btn")!);

    const dialog: HTMLElement = await dialogNamed("Acknowledge Alert");
    await within(dialog).findByRole("button", { name: "Add a private note" });

    expect(foldNames(dialog)).toEqual(["Add a private note"]);
    expect(within(dialog).queryByText("Root Cause")).toBeNull();
  });

  test("someone who may not edit the alert resolves it without being offered the root cause", async () => {
    forbidEditing(Alert);

    const dialog: HTMLElement = await openResolve();

    expect(foldNames(dialog)).toEqual(["Add a private note"]);

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(idOf(request.model["alertStateId"])).toBe(RESOLVED_ID);
    expect(request.misc["writtenRootCause"] || "").toBe("");
  });
});

describe("Resolve on an incident", () => {
  beforeEach(() => {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      if (modelType === IncidentState) {
        return Promise.resolve(listOf(eventStates(IncidentState)));
      }

      if (modelType === IncidentStateTimeline) {
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.incidentStateId = new ObjectID(ACKNOWLEDGED_ID);
        timeline.startsAt = START;
        return Promise.resolve(listOf([timeline]));
      }

      return Promise.resolve(listOf([]));
    });
  });

  async function openResolve(
    isPrivate?: boolean | undefined,
  ): Promise<HTMLElement> {
    render(
      <ChangeIncidentState
        incidentId={new ObjectID(EVENT_ID)}
        eventNumber="INC-42"
        title={TITLE}
        eventStartsAt={START}
        onActionComplete={jest.fn()}
        isPrivate={isPrivate}
        notifyStatusPageSubscribersByDefault={true}
      />,
    );

    await screen.findByRole("heading", { level: 2, name: TITLE });
    fireEvent.click(document.getElementById("incident-resolve-btn")!);

    const dialog: HTMLElement = await dialogNamed("Resolve Incident");
    await within(dialog).findByRole("button", { name: ADD_ROOT_CAUSE });

    return dialog;
  }

  test("keeps the notify box open and folds the public note, then the root cause", async () => {
    const dialog: HTMLElement = await openResolve();

    expect(
      within(dialog).getByRole("checkbox", {
        name: "Notify Status Page Subscribers",
      }),
    ).toBeChecked();
    expect(foldNames(dialog)).toEqual(["Add a public note", ADD_ROOT_CAUSE]);
    expect(dialog).toHaveClass("sm:max-w-lg");

    fireEvent.click(fold(dialog, ADD_ROOT_CAUSE));

    expect(foldBody(dialog, ADD_ROOT_CAUSE)).toHaveTextContent(
      "Why did this incident happen? It is saved as the incident's root cause, and OneUptime AI's investigation is graded against it.",
    );
  });

  test("a written root cause goes with the change, beside the notify flag", async () => {
    const dialog: HTMLElement = await openResolve();

    await writeRootCauseIn(dialog);
    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(idOf(request.model["incidentStateId"])).toBe(RESOLVED_ID);
    expect(idOf(request.model["incidentId"])).toBe(EVENT_ID);
    expect(request.model["shouldStatusPageSubscribersBeNotified"]).toBe(true);
    expect(request.misc["writtenRootCause"]).toBe(ROOT_CAUSE_TEXT);
    expect(request.model["rootCause"]).toBeUndefined();
    expect(request.misc["publicNote"] || "").toBe("");
  });

  test("a private incident folds a private note, then the root cause", async () => {
    const dialog: HTMLElement = await openResolve(true);

    expect(foldNames(dialog)).toEqual(["Add a private note", ADD_ROOT_CAUSE]);
    expect(within(dialog).queryByRole("checkbox")).toBeNull();

    await writeRootCauseIn(dialog);
    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(request.misc["writtenRootCause"]).toBe(ROOT_CAUSE_TEXT);
    expect(request.model["shouldStatusPageSubscribersBeNotified"]).toBe(false);
  });

  test("someone who may not edit the incident is not offered the root cause", async () => {
    forbidEditing(Incident);

    render(
      <ChangeIncidentState
        incidentId={new ObjectID(EVENT_ID)}
        eventNumber="INC-42"
        title={TITLE}
        eventStartsAt={START}
        onActionComplete={jest.fn()}
        notifyStatusPageSubscribersByDefault={true}
      />,
    );

    await screen.findByRole("heading", { level: 2, name: TITLE });
    fireEvent.click(document.getElementById("incident-resolve-btn")!);

    const dialog: HTMLElement = await dialogNamed("Resolve Incident");
    await within(dialog).findByRole("button", { name: "Add a public note" });

    expect(foldNames(dialog)).toEqual(["Add a public note"]);
  });
});
