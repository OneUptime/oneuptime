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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { JSONObject } from "../../../Types/JSON";

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const fetchNoteTemplateVariablesMock: MockFunction = getJestMockFunction();
const fetchRecordAccessMock: MockFunction = getJestMockFunction();
const modelFormModalMock: MockFunction = getJestMockFunction();

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

/*
 * The real dialog, drawn as it is, with what each header hands it kept:
 * whether a field is offered is its showIf, worked out as the dialog opens.
 */
jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  const actual: { default: React.FunctionComponent<JSONObject> } =
    jest.requireActual("../../../UI/Components/ModelFormModal/ModelFormModal");
  const react: typeof React = jest.requireActual("react");

  return {
    __esModule: true,
    default: (props: JSONObject): ReactElement => {
      modelFormModalMock(props);
      return react.createElement(actual.default, props);
    },
  };
});

// What the server answers for the record the page is open on (#10272).
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/RecordAccess/RecordAccessApi",
  () => {
    return {
      __esModule: true,
      fetchRecordAccess: (...args: Array<unknown>) => {
        return fetchRecordAccessMock(...args);
      },
    };
  },
);

/*
 * The reader's role may post every note and change every state in the
 * project: only the record's answer can keep them from this one's note.
 */
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
import ChangeAlertEpisodeState from "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/ChangeState";
import ChangeIncidentState from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState";
import ChangeIncidentEpisodeState from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/ChangeState";
import RecordAccessScopeProvider from "../../../../App/FeatureSet/Dashboard/src/Components/RecordAccess/RecordAccessScopeProvider";
import ChangeScheduledMaintenanceState from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  RECORD_ACCESS_TABLES,
  RecordAccessKind,
  RecordAccessOperation,
  RecordAccessRefusalReason,
  RecordAccessResult,
  RecordAccessTables,
} from "../../../Types/RecordAccess/RecordAccess";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

/*
 * A STATE CHANGE DIALOG OFFERS ITS NOTE ONLY WHERE THE SERVER WOULD TAKE IT,
 * ON THIS RECORD (#10790).
 *
 * A reader whose role may post a note on every event can still be kept from
 * posting one on THIS event: their grant reaches only the events carrying
 * some labels, or only those they own, or a team of theirs blocks it on the
 * event's labels (#10272). The server refuses a state change whose note its
 * sender may not post - the whole change, so nobody is recorded as told by
 * a note that was never posted (Server/Utils/StateChangeNote). A record's
 * view layout asks the server what the reader may do on the record
 * (RecordAccessScopeProvider), and each Change State dialog hands that
 * answer to its state buttons and to the note it offers (noteGateOptions).
 * The scheduled maintenance event's dialog handed it to its buttons only,
 * so it offered the public note to a reader the event's labels kept from
 * it, and the server refused the change when they pressed it.
 *
 * Every dialog of that shape is opened here, for real, from its real header
 * under the real provider, against a fake API and a fake answer: one that
 * refuses the note on this record, one that refuses nothing, and one that
 * refuses another part of the record.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EVENT_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RESOLVED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const SCHEDULED_ID: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ONGOING_ID: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const ENDED_ID: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const TITLE: string = "Checkout latency above 2s";
const START: Date = new Date(Date.now() - 20 * 60 * 1000);

const ADD_PUBLIC_NOTE: string = "Add a public note";
const ADD_PRIVATE_NOTE: string = "Add a private note";

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

function maintenanceStates(): Array<ScheduledMaintenanceState> {
  return [
    [SCHEDULED_ID, "Scheduled", "isScheduledState"],
    [ONGOING_ID, "Ongoing", "isOngoingState"],
    [ENDED_ID, "Ended", "isEndedState"],
  ].map((spec: Array<string>): ScheduledMaintenanceState => {
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.id = new ObjectID(spec[0]!);
    state.name = spec[1]!;
    state.color = new Color("#6366f1");
    (state as unknown as Record<string, unknown>)[spec[2]!] = true;
    return state;
  });
}

// One row of a state timeline, in the state the event is in now.
function timelineIn<T extends BaseModel>(
  TimelineModel: { new (): T },
  stateIdField: string,
  stateId: string,
): T {
  const timeline: T = new TimelineModel();
  (timeline as unknown as Record<string, unknown>)[stateIdField] = new ObjectID(
    stateId,
  );
  (timeline as unknown as Record<string, unknown>)["startsAt"] = START;
  return timeline;
}

interface DialogCase {
  // "a scheduled maintenance event's"
  name: string;
  // Whether it also asks "Notify Status Page Subscribers", offered either way.
  hasNotifyBox: boolean;
  kind: RecordAccessKind;
  // The note the dialog posts, by its table.
  noteTable: string;
  // Another part of the record, whose refusal says nothing of the note.
  otherTable: string;
  noteFold: string;
  noteKey: "publicNote" | "privateNote";
  // The state button that opens the dialog, the dialog, and its form.
  buttonId: string;
  dialogName: string;
  formId: string;
  stateIdField: string;
  targetStateId: string;
  respond: () => void;
  header: () => ReactElement;
}

function respondWithEvent(data: {
  stateModel: { new (): StateLike & BaseModel };
  timelineModel: { new (): BaseModel };
  stateIdField: string;
  episode?: (() => BaseModel) | undefined;
}): void {
  getItemMock.mockImplementation(() => {
    return Promise.resolve(data.episode ? data.episode() : null);
  });

  getListMock.mockImplementation((...args: Array<unknown>) => {
    const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

    if (modelType === data.stateModel) {
      return Promise.resolve(listOf(eventStates(data.stateModel)));
    }

    if (modelType === data.timelineModel) {
      return Promise.resolve(
        listOf([timelineIn(data.timelineModel, data.stateIdField, CREATED_ID)]),
      );
    }

    // No note templates, owners or anything else.
    return Promise.resolve(listOf([]));
  });
}

function episodeOf<T extends BaseModel>(EpisodeModel: { new (): T }): T {
  const episode: T = new EpisodeModel();
  const row: Record<string, unknown> = episode as unknown as Record<
    string,
    unknown
  >;
  episode.id = new ObjectID(EVENT_ID);
  row["title"] = TITLE;
  row["episodeNumber"] = 7;
  row["episodeNumberWithPrefix"] = "EP-7";
  row["declaredAt"] = START;
  row["createdAt"] = START;
  return episode;
}

const SCHEDULED_MAINTENANCE: DialogCase = {
  name: "a scheduled maintenance event's",
  hasNotifyBox: true,
  kind: RecordAccessKind.ScheduledMaintenance,
  noteTable: "ScheduledMaintenancePublicNote",
  otherTable: "ScheduledMaintenanceOwnerUser",
  noteFold: ADD_PUBLIC_NOTE,
  noteKey: "publicNote",
  buttonId: "sm-mark-ongoing-btn",
  dialogName: "Mark Scheduled Maintenance as Ongoing",
  formId: "create-scheduled-maintenance-state-timeline",
  stateIdField: "scheduledMaintenanceStateId",
  targetStateId: ONGOING_ID,
  respond: (): void => {
    getItemMock.mockImplementation(() => {
      return Promise.resolve(null);
    });

    getListMock.mockImplementation((...args: Array<unknown>) => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      if (modelType === ScheduledMaintenanceState) {
        return Promise.resolve(listOf(maintenanceStates()));
      }

      if (modelType === ScheduledMaintenanceStateTimeline) {
        return Promise.resolve(
          listOf([
            timelineIn(
              ScheduledMaintenanceStateTimeline,
              "scheduledMaintenanceStateId",
              SCHEDULED_ID,
            ),
          ]),
        );
      }

      return Promise.resolve(listOf([]));
    });
  },
  header: (): ReactElement => {
    return (
      <ChangeScheduledMaintenanceState
        scheduledMaintenanceId={new ObjectID(EVENT_ID)}
        eventNumber="#58"
        title={TITLE}
        eventStartsAt={new Date(Date.now() + 60 * 60 * 1000)}
        eventEndsAt={new Date(Date.now() + 2 * 60 * 60 * 1000)}
        onActionComplete={jest.fn()}
      />
    );
  },
};

const INCIDENT: DialogCase = {
  name: "an incident's",
  hasNotifyBox: true,
  kind: RecordAccessKind.Incident,
  noteTable: "IncidentPublicNote",
  otherTable: "IncidentOwnerUser",
  noteFold: ADD_PUBLIC_NOTE,
  noteKey: "publicNote",
  buttonId: "incident-acknowledge-btn",
  dialogName: "Acknowledge Incident",
  formId: "create-incident-state-timeline",
  stateIdField: "incidentStateId",
  targetStateId: ACKNOWLEDGED_ID,
  respond: (): void => {
    respondWithEvent({
      stateModel: IncidentState,
      timelineModel: IncidentStateTimeline,
      stateIdField: "incidentStateId",
    });
  },
  header: (): ReactElement => {
    return (
      <ChangeIncidentState
        incidentId={new ObjectID(EVENT_ID)}
        eventNumber="INC-42"
        title={TITLE}
        eventStartsAt={START}
        onActionComplete={jest.fn()}
        notifyStatusPageSubscribersByDefault={true}
      />
    );
  },
};

// A private incident takes a private note instead (PrivateRecordPublicNotes).
const PRIVATE_INCIDENT: DialogCase = {
  ...INCIDENT,
  name: "a private incident's",
  hasNotifyBox: false,
  noteTable: "IncidentInternalNote",
  noteFold: ADD_PRIVATE_NOTE,
  noteKey: "privateNote",
  header: (): ReactElement => {
    return (
      <ChangeIncidentState
        incidentId={new ObjectID(EVENT_ID)}
        eventNumber="INC-42"
        title={TITLE}
        eventStartsAt={START}
        onActionComplete={jest.fn()}
        isPrivate={true}
        notifyStatusPageSubscribersByDefault={true}
      />
    );
  },
};

const ALERT: DialogCase = {
  name: "an alert's",
  hasNotifyBox: false,
  kind: RecordAccessKind.Alert,
  noteTable: "AlertInternalNote",
  otherTable: "AlertOwnerUser",
  noteFold: ADD_PRIVATE_NOTE,
  noteKey: "privateNote",
  buttonId: "alert-acknowledge-btn",
  dialogName: "Acknowledge Alert",
  formId: "create-alert-state-timeline",
  stateIdField: "alertStateId",
  targetStateId: ACKNOWLEDGED_ID,
  respond: (): void => {
    respondWithEvent({
      stateModel: AlertState,
      timelineModel: AlertStateTimeline,
      stateIdField: "alertStateId",
    });
  },
  header: (): ReactElement => {
    return (
      <ChangeAlertState
        alertId={new ObjectID(EVENT_ID)}
        eventNumber="ALT-7"
        title={TITLE}
        eventStartsAt={START}
        onActionComplete={jest.fn()}
      />
    );
  },
};

const INCIDENT_EPISODE: DialogCase = {
  name: "an incident episode's",
  hasNotifyBox: false,
  kind: RecordAccessKind.IncidentEpisode,
  noteTable: "IncidentEpisodeInternalNote",
  otherTable: "IncidentEpisodeOwnerUser",
  noteFold: ADD_PRIVATE_NOTE,
  noteKey: "privateNote",
  buttonId: "episode-acknowledge-btn",
  dialogName: "Acknowledge Episode",
  formId: "create-episode-state-timeline",
  stateIdField: "incidentStateId",
  targetStateId: ACKNOWLEDGED_ID,
  respond: (): void => {
    respondWithEvent({
      stateModel: IncidentState,
      timelineModel: IncidentEpisodeStateTimeline,
      stateIdField: "incidentStateId",
      episode: (): BaseModel => {
        return episodeOf(IncidentEpisode);
      },
    });
  },
  header: (): ReactElement => {
    return (
      <ChangeIncidentEpisodeState
        episodeId={new ObjectID(EVENT_ID)}
        onActionComplete={(): void => {}}
      />
    );
  },
};

const ALERT_EPISODE: DialogCase = {
  name: "an alert episode's",
  hasNotifyBox: false,
  kind: RecordAccessKind.AlertEpisode,
  noteTable: "AlertEpisodeInternalNote",
  otherTable: "AlertEpisodeOwnerUser",
  noteFold: ADD_PRIVATE_NOTE,
  noteKey: "privateNote",
  buttonId: "episode-acknowledge-btn",
  dialogName: "Acknowledge Episode",
  formId: "create-episode-state-timeline",
  stateIdField: "alertStateId",
  targetStateId: ACKNOWLEDGED_ID,
  respond: (): void => {
    respondWithEvent({
      stateModel: AlertState,
      timelineModel: AlertEpisodeStateTimeline,
      stateIdField: "alertStateId",
      episode: (): BaseModel => {
        return episodeOf(AlertEpisode);
      },
    });
  },
  header: (): ReactElement => {
    return (
      <ChangeAlertEpisodeState
        episodeId={new ObjectID(EVENT_ID)}
        onActionComplete={(): void => {}}
      />
    );
  },
};

const DIALOG_CASES: Array<DialogCase> = [
  SCHEDULED_MAINTENANCE,
  INCIDENT,
  PRIVATE_INCIDENT,
  ALERT,
  INCIDENT_EPISODE,
  ALERT_EPISODE,
];

/*
 * The server's answer for the record: each of its tables allowed for every
 * write, but the creates of `refusedTables`, refused because the reader's
 * grant reaches only the records labelled Payments, which this one is not.
 */
function answerRefusingCreateOf(
  dialogCase: DialogCase,
  refusedTables: Array<string>,
): RecordAccessResult {
  const tables: RecordAccessTables = {};

  for (const table of RECORD_ACCESS_TABLES[dialogCase.kind]) {
    const isRefused: boolean = refusedTables.includes(table);

    tables[table] = {
      [RecordAccessOperation.Create]: isRefused
        ? {
            isAllowed: false,
            refusal: {
              reason: RecordAccessRefusalReason.Labels,
              labelNames: ["Payments"],
              teamNames: [],
            },
          }
        : { isAllowed: true, refusal: null },
      [RecordAccessOperation.Update]: { isAllowed: true, refusal: null },
      [RecordAccessOperation.Delete]: { isAllowed: true, refusal: null },
    };
  }

  return { kind: dialogCase.kind, recordId: EVENT_ID, tables };
}

interface FormField {
  field?: Record<string, boolean> | undefined;
  overrideFieldKey?: string | undefined;
  showIf?: ((values: JSONObject) => boolean) | undefined;
}

// The fields of the dialog the header opened last.
function lastDialogFields(): Array<FormField> {
  const calls: Array<Array<unknown>> = modelFormModalMock.mock.calls as Array<
    Array<unknown>
  >;

  expect(calls.length).toBeGreaterThan(0);

  return (
    calls[calls.length - 1]![0] as { formProps: { fields: Array<FormField> } }
  ).formProps.fields;
}

/*
 * Whether the dialog offers its note and the note's template picker: the
 * two fields "Add a public note" / "Add a private note" folds, each shown
 * only while its showIf says so.
 */
function noteFieldsOffered(dialogCase: DialogCase): Record<string, boolean> {
  const offered: Record<string, boolean> = {};

  for (const field of lastDialogFields()) {
    const key: string =
      field.overrideFieldKey || Object.keys(field.field || {})[0] || "";

    if (key === dialogCase.noteKey || key === `${dialogCase.noteKey}Template`) {
      offered[key] = !field.showIf || field.showIf({});
    }
  }

  return offered;
}

function dialogNamed(name: string): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name });
}

function submitButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByTestId("modal-footer-submit-button");
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
 * The dialog, opened from its header on the record's page once the
 * server's answer for the record has landed: the layout reads it as the
 * page opens, long before anyone presses a state button.
 */
async function openDialog(
  dialogCase: DialogCase,
  answer: RecordAccessResult,
): Promise<HTMLElement> {
  dialogCase.respond();
  fetchRecordAccessMock.mockResolvedValue(answer as never);

  render(
    <RecordAccessScopeProvider
      kind={dialogCase.kind}
      modelId={new ObjectID(EVENT_ID)}
    >
      {dialogCase.header()}
    </RecordAccessScopeProvider>,
  );

  await screen.findByRole("heading", { level: 2, name: TITLE });

  await waitFor(() => {
    expect(fetchRecordAccessMock).toHaveBeenCalledWith({
      kind: dialogCase.kind,
      recordId: EVENT_ID,
    });
  });

  // The answer is in the page's scope before anyone presses anything.
  await act(async () => {
    await Promise.resolve();
  });

  const button: HTMLElement | null = document.getElementById(
    dialogCase.buttonId,
  );

  expect(button).not.toBeNull();
  expect(button).not.toBeDisabled();

  fireEvent.click(button!);

  const dialog: HTMLElement = await dialogNamed(dialogCase.dialogName);

  await waitFor(() => {
    expect(dialog.querySelector(`[id="${dialogCase.formId}"]`)).not.toBeNull();
  });

  /*
   * The form draws its fields a moment after it opens. Where it asks
   * "Notify Status Page Subscribers" - offered either way - that box says
   * they are drawn.
   */
  if (dialogCase.hasNotifyBox) {
    await within(dialog).findByRole("checkbox", {
      name: "Notify Status Page Subscribers",
    });
  }

  return dialog;
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
  fetchRecordAccessMock.mockReset();
  modelFormModalMock.mockReset();
  jest.restoreAllMocks();
});

describe("a Change State dialog's note follows what the server says of the record", () => {
  test.each(DIALOG_CASES)(
    "$name: a reader whose labels or owners keep them from posting its note on this record is not offered one, and still changes the state",
    async (dialogCase: DialogCase) => {
      const dialog: HTMLElement = await openDialog(
        dialogCase,
        answerRefusingCreateOf(dialogCase, [dialogCase.noteTable]),
      );

      // Neither the note nor its template picker: no "Add a ... note" line.
      expect(noteFieldsOffered(dialogCase)).toEqual({
        [dialogCase.noteKey]: false,
        [`${dialogCase.noteKey}Template`]: false,
      });

      if (dialogCase.hasNotifyBox) {
        expect(foldNames(dialog)).not.toContain(dialogCase.noteFold);
      }

      expect(
        within(dialog).queryByRole("button", { name: dialogCase.noteFold }),
      ).toBeNull();

      fireEvent.click(submitButton(dialog));

      const request: { model: JSONObject; misc: JSONObject } = await sent();

      expect(idOf(request.model[dialogCase.stateIdField])).toBe(
        dialogCase.targetStateId,
      );
      expect(request.misc[dialogCase.noteKey] || "").toBe("");
    },
  );

  test.each(DIALOG_CASES)(
    "$name: a reader the server lets post its note on this record is offered it",
    async (dialogCase: DialogCase) => {
      const dialog: HTMLElement = await openDialog(
        dialogCase,
        answerRefusingCreateOf(dialogCase, []),
      );

      expect(noteFieldsOffered(dialogCase)).toEqual({
        [dialogCase.noteKey]: true,
        // The project has no note templates: no picker either way.
        [`${dialogCase.noteKey}Template`]: false,
      });
      expect(
        await within(dialog).findByRole("button", {
          name: dialogCase.noteFold,
        }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(foldNames(dialog)).toContain(dialogCase.noteFold);
    },
  );

  test.each(DIALOG_CASES)(
    "$name: a refusal of another part of the record leaves the note offered: the note asks of its own table",
    async (dialogCase: DialogCase) => {
      const dialog: HTMLElement = await openDialog(
        dialogCase,
        answerRefusingCreateOf(dialogCase, [dialogCase.otherTable]),
      );

      expect(noteFieldsOffered(dialogCase)[dialogCase.noteKey]).toBe(true);
      expect(
        await within(dialog).findByRole("button", {
          name: dialogCase.noteFold,
        }),
      ).toBeInTheDocument();
    },
  );
});

describe("the answer the dialogs read", () => {
  test("covers every note a Change State dialog posts, so none is offered unasked", () => {
    for (const dialogCase of DIALOG_CASES) {
      expect({
        dialog: dialogCase.name,
        isAnswered: RECORD_ACCESS_TABLES[dialogCase.kind].includes(
          dialogCase.noteTable,
        ),
      }).toEqual({ dialog: dialogCase.name, isAnswered: true });
    }
  });
});
