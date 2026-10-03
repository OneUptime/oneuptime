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
const getItemMock: MockFunction = getJestMockFunction();
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
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
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

// The real form shows the notify checkbox to someone allowed to set it.
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
import ChangeIncidentEpisodeState from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/ChangeState";
import ChangeScheduledMaintenanceState from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState";
import AlertNoteTemplate from "../../../Models/DatabaseModels/AlertNoteTemplate";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenanceNoteTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

/*
 * "Please also find similar issues across the project and fix them as well.
 * The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * Acknowledge and Resolve opened a wide form led by an optional Markdown
 * editor for a status page note. Now they open as a confirm: one sentence on
 * what the change does, "Notify Status Page Subscribers" where the event
 * reaches a status page, and the note folded under "Add a public note" /
 * "Add a private note". These tests open the real dialogs from the real
 * headers, against a fake API, and check what they show and what they send.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EVENT_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RESOLVED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const TEMPLATE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const TITLE: string = "Checkout latency above 2s";
const NOTE_TEXT: string = "Rolled back the deploy; watching error rates.";
const START: Date = new Date(Date.now() - 20 * 60 * 1000);

const NOTIFY: string = "Notify Status Page Subscribers";

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
  isCreatedState?: boolean | undefined;
  isAcknowledgedState?: boolean | undefined;
  isResolvedState?: boolean | undefined;
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

function template<T extends BaseModel>(
  TemplateModel: { new (): T },
  note: string,
): T {
  const row: T = new TemplateModel();
  row.id = new ObjectID(TEMPLATE_ID);
  (row as unknown as Record<string, unknown>)["templateName"] =
    "Investigating update";
  (row as unknown as Record<string, unknown>)["note"] = note;
  return row;
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

async function writeNoteIn(dialog: HTMLElement): Promise<void> {
  // The markdown source view is a plain textarea.
  fireEvent.click(within(dialog).getByTitle("Switch to markdown source"));
  fireEvent.change(
    await within(dialog).findByPlaceholderText("Type your markdown here..."),
    { target: { value: NOTE_TEXT } },
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
  getItemMock.mockReset();
  fetchNoteTemplateVariablesMock.mockReset();
  jest.restoreAllMocks();
});

describe("Acknowledge on an incident", () => {
  function respond(options?: { templateNote?: string | undefined }): void {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      if (modelType === IncidentState) {
        return Promise.resolve(listOf(eventStates(IncidentState)));
      }

      if (modelType === IncidentStateTimeline) {
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.incidentStateId = new ObjectID(CREATED_ID);
        timeline.startsAt = START;
        return Promise.resolve(listOf([timeline]));
      }

      if (modelType === IncidentNoteTemplate) {
        return Promise.resolve(
          listOf(
            options?.templateNote
              ? [template(IncidentNoteTemplate, options.templateNote)]
              : [],
          ),
        );
      }

      return Promise.resolve(listOf([]));
    });
  }

  async function openAcknowledge(
    notifyByDefault?: boolean | undefined,
  ): Promise<HTMLElement> {
    render(
      <ChangeIncidentState
        incidentId={new ObjectID(EVENT_ID)}
        eventNumber="INC-42"
        title={TITLE}
        eventStartsAt={START}
        onActionComplete={jest.fn()}
        notifyStatusPageSubscribersByDefault={notifyByDefault}
      />,
    );

    await screen.findByRole("heading", { level: 2, name: TITLE });
    fireEvent.click(document.getElementById("incident-acknowledge-btn")!);

    const dialog: HTMLElement = await dialogNamed("Acknowledge Incident");
    await within(dialog).findByRole("checkbox", { name: NOTIFY });

    return dialog;
  }

  test("opens a short confirm: one sentence, the notify checkbox and the folded note", async () => {
    respond();
    const dialog: HTMLElement = await openAcknowledge(true);

    expect(dialog).toHaveTextContent(
      "This records an acknowledgement on the incident timeline and stops any on-call escalation for this incident.",
    );
    expect(dialog).not.toHaveTextContent("You can add an optional public note");

    expect(
      within(dialog).getByRole("checkbox", { name: NOTIFY }),
    ).toBeChecked();

    const note: HTMLElement = fold(dialog, "Add a public note");
    expect(note).toHaveAttribute("aria-expanded", "false");
    // The editor is there, folded away.
    expect(
      within(dialog).getByTestId("markdown-editor-toolbar"),
    ).not.toBeVisible();

    // A confirm, not the wide editor dialog.
    expect(dialog).toHaveClass("sm:max-w-lg");
    expect(submitButton(dialog)).toHaveTextContent("Acknowledge");
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });

  test("Acknowledge straight away records the change and notifies, with no note", async () => {
    respond();
    const dialog: HTMLElement = await openAcknowledge(true);

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(idOf(request.model["incidentStateId"])).toBe(ACKNOWLEDGED_ID);
    expect(idOf(request.model["incidentId"])).toBe(EVENT_ID);
    expect(request.model["shouldStatusPageSubscribersBeNotified"]).toBe(true);
    expect(request.misc["publicNote"] || "").toBe("");
  });

  test("a quiet incident starts the box off, says why, and sends false", async () => {
    respond();
    const dialog: HTMLElement = await openAcknowledge(false);

    expect(
      within(dialog).getByRole("checkbox", { name: NOTIFY }),
    ).not.toBeChecked();
    expect(dialog).toHaveTextContent(
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
    );

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(request.model["shouldStatusPageSubscribersBeNotified"]).toBe(false);
  });

  test("opening the note widens the dialog for the editor, and the note is sent", async () => {
    respond();
    const dialog: HTMLElement = await openAcknowledge(true);

    fireEvent.click(fold(dialog, "Add a public note"));

    expect(fold(dialog, "Add a public note")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(dialog).toHaveClass("sm:max-w-7xl");
    expect(within(dialog).getByTestId("markdown-editor-toolbar")).toBeVisible();
    // No templates in this project: no picker.
    expect(within(dialog).queryByText("Select Note Template")).toBeNull();

    await writeNoteIn(dialog);

    // Folded again it keeps the note, and says something is in it.
    fireEvent.click(fold(dialog, "Add a public note"));
    expect(dialog).toHaveClass("sm:max-w-lg");
    expect(fold(dialog, "Add a public note")).toHaveTextContent("Configured");

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(request.misc["publicNote"]).toBe(NOTE_TEXT);
    expect(request.model["publicNote"]).toBeUndefined();
    expect(request.model["shouldStatusPageSubscribersBeNotified"]).toBe(true);
  });

  test("a template picked in the folded note goes in with this incident's values", async () => {
    fetchNoteTemplateVariablesMock.mockResolvedValue({
      "incident.title": TITLE,
    } as never);
    respond({ templateNote: "Looking into {{incident.title}}." });

    const dialog: HTMLElement = await openAcknowledge(true);

    await waitFor(() => {
      expect(fetchNoteTemplateVariablesMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(fold(dialog, "Add a public note"));

    const picker: HTMLElement = within(dialog).getByRole("combobox");
    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(
      await screen.findByRole("option", { name: "Investigating update" }),
    );

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(request.misc["publicNote"]).toBe(`Looking into ${TITLE}.`);
  });
});

describe("Acknowledge on an alert", () => {
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

      if (modelType === AlertNoteTemplate) {
        return Promise.resolve(
          listOf([template(AlertNoteTemplate, "Paged the database team.")]),
        );
      }

      return Promise.resolve(listOf([]));
    });
  });

  async function openAcknowledge(): Promise<HTMLElement> {
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
    fireEvent.click(document.getElementById("alert-acknowledge-btn")!);

    const dialog: HTMLElement = await dialogNamed("Acknowledge Alert");
    await within(dialog).findByRole("button", { name: "Add a private note" });

    return dialog;
  }

  test("reads as a plain confirm: one sentence, then Cancel / Acknowledge", async () => {
    const dialog: HTMLElement = await openAcknowledge();

    expect(dialog).toHaveTextContent(
      "This records an acknowledgement on the alert timeline and stops any on-call escalation for this alert.",
    );
    // Nothing to decide but the change itself.
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).queryByText(NOTIFY)).toBeNull();
    expect(fold(dialog, "Add a private note")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(dialog).getByText("Select Note Template")).not.toBeVisible();
    expect(dialog).toHaveClass("sm:max-w-lg");
    expect(submitButton(dialog)).toHaveTextContent("Acknowledge");
  });

  test("Acknowledge straight away sends the change without a note", async () => {
    const dialog: HTMLElement = await openAcknowledge();

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(idOf(request.model["alertStateId"])).toBe(ACKNOWLEDGED_ID);
    expect(idOf(request.model["alertId"])).toBe(EVENT_ID);
    expect(request.misc["privateNote"] || "").toBe("");
  });

  test("a private note written in the fold is sent with the change", async () => {
    const dialog: HTMLElement = await openAcknowledge();

    fireEvent.click(fold(dialog, "Add a private note"));
    expect(dialog).toHaveClass("sm:max-w-7xl");
    expect(within(dialog).getByText("Select Note Template")).toBeVisible();

    await writeNoteIn(dialog);
    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(request.misc["privateNote"]).toBe(NOTE_TEXT);
  });
});

describe("Mark as Ongoing on a scheduled maintenance event", () => {
  const SCHEDULED_ID: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  const ONGOING_ID: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
  const ENDED_ID: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

  beforeEach(() => {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      if (modelType === ScheduledMaintenanceState) {
        return Promise.resolve(
          listOf(
            [
              [SCHEDULED_ID, "Scheduled", "isScheduledState"],
              [ONGOING_ID, "Ongoing", "isOngoingState"],
              [ENDED_ID, "Ended", "isEndedState"],
            ].map((spec: Array<string>): ScheduledMaintenanceState => {
              const state: ScheduledMaintenanceState =
                new ScheduledMaintenanceState();
              state.id = new ObjectID(spec[0]!);
              state.name = spec[1]!;
              state.color = new Color("#6366f1");
              (state as unknown as Record<string, unknown>)[spec[2]!] = true;
              return state;
            }),
          ),
        );
      }

      if (modelType === ScheduledMaintenanceStateTimeline) {
        const timeline: ScheduledMaintenanceStateTimeline =
          new ScheduledMaintenanceStateTimeline();
        timeline.scheduledMaintenanceStateId = new ObjectID(SCHEDULED_ID);
        timeline.startsAt = START;
        return Promise.resolve(listOf([timeline]));
      }

      if (modelType === ScheduledMaintenanceNoteTemplate) {
        return Promise.resolve(listOf([]));
      }

      return Promise.resolve(listOf([]));
    });
  });

  test("names the state in whole sentences and folds the public note", async () => {
    render(
      <ChangeScheduledMaintenanceState
        scheduledMaintenanceId={new ObjectID(EVENT_ID)}
        eventNumber="#58"
        title={TITLE}
        eventStartsAt={new Date(Date.now() + 60 * 60 * 1000)}
        eventEndsAt={new Date(Date.now() + 2 * 60 * 60 * 1000)}
        onActionComplete={jest.fn()}
      />,
    );

    await screen.findByRole("heading", { level: 2, name: TITLE });

    const markAsOngoing: HTMLElement = document.getElementById(
      "sm-mark-ongoing-btn",
    )!;
    expect(markAsOngoing).toHaveTextContent("Mark as Ongoing");
    expect(document.getElementById("sm-mark-complete-btn")).toHaveTextContent(
      "Mark as Ended",
    );

    fireEvent.click(markAsOngoing);

    const dialog: HTMLElement = await dialogNamed(
      "Mark Scheduled Maintenance as Ongoing",
    );
    await within(dialog).findByRole("checkbox", { name: NOTIFY });

    expect(dialog).toHaveTextContent("This updates the event timeline.");
    expect(dialog).not.toHaveTextContent("You can add an optional public note");
    expect(fold(dialog, "Add a public note")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(dialog).toHaveClass("sm:max-w-lg");
    expect(submitButton(dialog)).toHaveTextContent("Mark as Ongoing");

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(idOf(request.model["scheduledMaintenanceStateId"])).toBe(ONGOING_ID);
    expect(request.model["shouldStatusPageSubscribersBeNotified"]).toBe(true);
  });
});

describe("Acknowledge on an incident episode", () => {
  beforeEach(() => {
    getItemMock.mockImplementation(() => {
      const episode: IncidentEpisode = new IncidentEpisode();
      episode.id = new ObjectID(EVENT_ID);
      episode.title = TITLE;
      episode.episodeNumber = 7;
      episode.declaredAt = START;
      return Promise.resolve(episode);
    });

    getListMock.mockImplementation((...args: Array<unknown>) => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      if (modelType === IncidentState) {
        return Promise.resolve(listOf(eventStates(IncidentState)));
      }

      if (modelType === IncidentEpisodeStateTimeline) {
        const timeline: IncidentEpisodeStateTimeline =
          new IncidentEpisodeStateTimeline();
        timeline.incidentStateId = new ObjectID(CREATED_ID);
        timeline.startsAt = START;
        return Promise.resolve(listOf([timeline]));
      }

      if (modelType === IncidentNoteTemplate) {
        return Promise.resolve(listOf([]));
      }

      return Promise.resolve(listOf([]));
    });
  });

  test("says escalation stops for the episode and its incidents, and folds the private note", async () => {
    render(
      <ChangeIncidentEpisodeState
        episodeId={new ObjectID(EVENT_ID)}
        onActionComplete={(): void => {}}
      />,
    );

    await screen.findByRole("heading", { level: 2, name: TITLE });
    fireEvent.click(document.getElementById("episode-acknowledge-btn")!);

    const dialog: HTMLElement = await dialogNamed("Acknowledge Episode");
    await within(dialog).findByRole("button", { name: "Add a private note" });

    expect(dialog).toHaveTextContent(
      "This records an acknowledgement on the episode timeline and also updates all incidents in this episode. Any on-call escalation for the episode and its incidents stops.",
    );
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(dialog).toHaveClass("sm:max-w-lg");

    fireEvent.click(submitButton(dialog));

    const request: { model: JSONObject; misc: JSONObject } = await sent();

    expect(idOf(request.model["incidentStateId"])).toBe(ACKNOWLEDGED_ID);
    expect(idOf(request.model["incidentEpisodeId"])).toBe(EVENT_ID);
  });
});
