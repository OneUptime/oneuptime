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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";

const getListMock: MockFunction = getJestMockFunction();
const modelFormModalMock: MockFunction = getJestMockFunction();

// What the real state change form would POST, captured by createOrUpdate.
let capturedPayload: JSONObject | null = null;
let capturedMiscDataProps: JSONObject | null = null;
let capturedModel: ScheduledMaintenanceStateTimeline | null = null;

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
 * createOrUpdate serializes the model the way ModelAPI does before it goes on
 * the wire, and then through JSON, so an unset value is exactly as absent as
 * it would be in the request body. Only the real form tests at the bottom
 * reach it.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: ScheduledMaintenanceStateTimeline;
        modelType: typeof BaseModel;
        miscDataProps?: JSONObject | undefined;
      }): Promise<{ data: JSONObject }> => {
        capturedModel = data.model;
        capturedPayload = JSON.parse(
          JSON.stringify(BaseModel.toJSON(data.model, data.modelType)),
        ) as JSONObject;
        capturedMiscDataProps = data.miscDataProps || {};
        return { data: {} };
      },
    },
  };
});

// The real form filters its fields by the viewer's permissions.
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

/*
 * The state-change modal is a full model form with its own API traffic. These
 * tests are about what the header hands it, so the stub records its props and
 * renders the title. The payload tests at the bottom then build the real form
 * from exactly those props.
 */
jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      submitButtonText: string;
    }): ReactElement => {
      modelFormModalMock(props);
      return React.createElement(
        "div",
        { "data-testid": "state-change-modal" },
        `${props.title} / ${props.submitButtonText}`,
      );
    },
  };
});

import ChangeScheduledMaintenanceState from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenanceNoteTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault, {
  ScheduledMaintenanceStateChangeSubscriberNotificationSetting,
} from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import ModelForm, {
  ComponentProps as ModelFormComponentProps,
  FormType,
} from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A scheduled maintenance event created without notifying status page
 * subscribers ("Event Created: Notify Status Page Subscribers" unticked)
 * should not have a later state change be what tells them - unless the event
 * is set to announce that change. The header's state change form, whose
 * checkbox decides both whether the state change notifies and whether its
 * public note does, starts "Notify Status Page Subscribers" from the state it
 * moves the event to:
 *
 * - an event created with subscribers notified (or with the setting unknown)
 *   starts ticked, as before;
 * - a quiet event moved to an ongoing state starts ticked only when its
 *   "Event Ongoing: Notify Status Page Subscribers" is on, and one moved to
 *   an ended or resolved state only when "Event Ended: Notify Status Page
 *   Subscribers" is on - the automatic change would have announced it;
 * - a quiet event moved to any other state starts unticked.
 *
 * The flag is seeded through initialValues as well as the field's
 * defaultValue, because the form drops a false defaultValue and an unsent
 * flag falls back to the database default of notifying. These tests drive the
 * real header against a fake API and pin both, for every way the form opens,
 * and then submit the real form to check what is actually sent.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EVENT_ID: string = "33333333-3333-4333-8333-333333333333";
const SCHEDULED_STATE_ID: string = "44444444-4444-4444-8444-444444444441";
const ONGOING_STATE_ID: string = "44444444-4444-4444-8444-444444444442";
const VERIFYING_STATE_ID: string = "44444444-4444-4444-8444-444444444443";
const ENDED_STATE_ID: string = "44444444-4444-4444-8444-444444444444";
const COMPLETED_STATE_ID: string = "44444444-4444-4444-8444-444444444445";
const DRAFT_STATE_ID: string = "44444444-4444-4444-8444-444444444446";
const TEMPLATE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const TEMPLATE_NOTE: string =
  "The failover drill has started. Writes may pause for a few seconds.";
const NOTE_TEXT: string =
  "Failover complete. Writes are back to normal on the new primary.";

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

/*
 * A window well in the future, so the header shows a plain countdown: no
 * overdue notice and no background timeline rechecks to muddle the request
 * counts below.
 */
const STARTS_AT: Date = new Date(Date.now() + DAY);
const ENDS_AT: Date = new Date(Date.now() + DAY + 2 * HOUR);
const SCHEDULED_AT: Date = new Date(Date.now() - DAY);

const TITLE: string = "Primary database failover drill";

const NOTIFY_FIELD_KEY: string = "shouldStatusPageSubscribersBeNotified";
const ORIGINAL_DESCRIPTION: string = "Notify subscribers of this state change.";
const QUIET_DESCRIPTION: string =
  PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription;
const CHECKBOX_TITLE: string = "Notify Status Page Subscribers";

type Settings = ScheduledMaintenanceStateChangeSubscriberNotificationSetting;

// Created quietly, and set to announce neither going ongoing nor ending.
const QUIET_EVENT: Settings = {
  shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
};

// Created quietly, but set to announce that it has started.
const QUIET_ANNOUNCES_ONGOING: Settings = {
  shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
};

// Created quietly, but set to announce that it has ended.
const QUIET_ANNOUNCES_ENDED: Settings = {
  shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
};

// Created quietly, but set to announce both changes.
const QUIET_ANNOUNCES_BOTH: Settings = {
  shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
};

const NOTIFYING_EVENT: Settings = {
  shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
};

// Announced when created, but set to announce neither later change.
const NOTIFIED_ANNOUNCES_NOTHING: Settings = {
  shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
};

// The created setting not known (a row from before it existed).
const CREATED_UNKNOWN_ANNOUNCES_NOTHING: Settings = {
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
};

interface StateSpec {
  id: string;
  name: string;
  color: string;
  flag?:
    | "isScheduledState"
    | "isOngoingState"
    | "isEndedState"
    | "isResolvedState";
}

const SCHEDULED_SPEC: StateSpec = {
  id: SCHEDULED_STATE_ID,
  name: "Scheduled",
  color: "#6366f1",
  flag: "isScheduledState",
};

const ONGOING_SPEC: StateSpec = {
  id: ONGOING_STATE_ID,
  name: "Ongoing",
  color: "#f59e0b",
  flag: "isOngoingState",
};

// A custom state with no flags.
const VERIFYING_SPEC: StateSpec = {
  id: VERIFYING_STATE_ID,
  name: "Verifying",
  color: "#0ea5e9",
};

const ENDED_SPEC: StateSpec = {
  id: ENDED_STATE_ID,
  name: "Ended",
  color: "#10b981",
  flag: "isEndedState",
};

const COMPLETED_SPEC: StateSpec = {
  id: COMPLETED_STATE_ID,
  name: "Completed",
  color: "#16a34a",
  flag: "isResolvedState",
};

// A custom state ordered before Scheduled.
const DRAFT_SPEC: StateSpec = {
  id: DRAFT_STATE_ID,
  name: "Draft",
  color: "#9ca3af",
};

// A project's default states, plus a custom one between Ongoing and Ended.
const STATE_SPECS: Array<StateSpec> = [
  SCHEDULED_SPEC,
  ONGOING_SPEC,
  VERIFYING_SPEC,
  ENDED_SPEC,
  COMPLETED_SPEC,
];

// No ended state, so the header's "Mark as" button targets the resolved one.
const STATES_WITHOUT_ENDED: Array<StateSpec> = [
  SCHEDULED_SPEC,
  ONGOING_SPEC,
  COMPLETED_SPEC,
];

/*
 * An event sitting in a custom state before Scheduled, so Scheduled is a
 * forward move offered under More actions.
 */
const STATES_WITH_DRAFT: Array<StateSpec> = [
  DRAFT_SPEC,
  SCHEDULED_SPEC,
  ONGOING_SPEC,
  ENDED_SPEC,
  COMPLETED_SPEC,
];

interface StateChangeField {
  field: Record<string, boolean>;
  fieldType: FormFieldSchemaType;
  title: string;
  description?: string | undefined;
  defaultValue?: unknown;
  required?: boolean | undefined;
  overrideFieldKey?: string | undefined;
  dropdownOptions?: Array<{ value: string; label: string }> | undefined;
  showIf?: (() => boolean) | undefined;
  onChange?:
    | ((
        value: string,
        currentValues: Record<string, unknown>,
        setNewFormValues: (values: Record<string, unknown>) => void,
      ) => void)
    | undefined;
}

interface StateChangeModalProps {
  name: string;
  title: string;
  submitButtonText: string;
  modelType: unknown;
  initialValues?: Record<string, unknown> | undefined;
  onClose: () => void;
  onBeforeCreate: (
    model: ScheduledMaintenanceStateTimeline,
  ) => Promise<unknown>;
  formProps: {
    fields: Array<StateChangeField>;
  };
}

interface ListResultShape {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
}

const listResult: (data: Array<unknown>) => ListResultShape = (
  data: Array<unknown>,
): ListResultShape => {
  return { data: data, count: data.length, skip: 0, limit: 99 };
};

interface FakeApiOptions {
  withTemplate?: boolean | undefined;
  // The project's states, in order. Defaults to STATE_SPECS.
  states?: Array<StateSpec> | undefined;
  // The state the event is in. Defaults to Scheduled.
  currentStateId?: string | undefined;
}

const buildStates: (
  specs: Array<StateSpec>,
) => Array<ScheduledMaintenanceState> = (
  specs: Array<StateSpec>,
): Array<ScheduledMaintenanceState> => {
  return specs.map((spec: StateSpec): ScheduledMaintenanceState => {
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.id = new ObjectID(spec.id);
    state.name = spec.name;
    state.color = new Color(spec.color);

    if (spec.flag) {
      state[spec.flag] = true;
    }

    return state;
  });
};

const respondWith: (options?: FakeApiOptions) => void = (
  options?: FakeApiOptions,
): void => {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === ScheduledMaintenanceState) {
      return Promise.resolve(
        listResult(buildStates(options?.states || STATE_SPECS)),
      );
    }

    if (request.modelType === ScheduledMaintenanceStateTimeline) {
      const timeline: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      timeline.scheduledMaintenanceStateId = new ObjectID(
        options?.currentStateId || SCHEDULED_STATE_ID,
      );
      timeline.startsAt = SCHEDULED_AT;
      return Promise.resolve(listResult([timeline]));
    }

    if (request.modelType === ScheduledMaintenanceNoteTemplate) {
      if (!options?.withTemplate) {
        return Promise.resolve(listResult([]));
      }

      const template: ScheduledMaintenanceNoteTemplate =
        new ScheduledMaintenanceNoteTemplate();
      template.id = new ObjectID(TEMPLATE_ID);
      template.templateName = "Drill started";
      template.note = TEMPLATE_NOTE;
      return Promise.resolve(listResult([template]));
    }

    return Promise.reject(new Error("Unexpected list request"));
  });
};

const headerElement: (settings?: Settings | undefined) => ReactElement = (
  settings?: Settings | undefined,
): ReactElement => {
  return (
    <ChangeScheduledMaintenanceState
      scheduledMaintenanceId={new ObjectID(EVENT_ID)}
      eventNumber="#58"
      title={TITLE}
      eventStartsAt={STARTS_AT}
      eventEndsAt={ENDS_AT}
      onActionComplete={jest.fn()}
      subscriberNotificationSettings={settings}
    />
  );
};

const renderHeader: (settings?: Settings | undefined) => RenderResult = (
  settings?: Settings | undefined,
): RenderResult => {
  return render(headerElement(settings));
};

const waitForHeader: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    return screen.findByRole("heading", {
      level: 2,
      name: TITLE,
    });
  };

const modalPropsHistory: () => Array<StateChangeModalProps> =
  (): Array<StateChangeModalProps> => {
    return (
      modelFormModalMock.mock.calls as Array<Array<StateChangeModalProps>>
    ).map((call: Array<StateChangeModalProps>): StateChangeModalProps => {
      return call[0]!;
    });
  };

const lastModalProps: () => StateChangeModalProps =
  (): StateChangeModalProps => {
    const history: Array<StateChangeModalProps> = modalPropsHistory();

    return history[history.length - 1]!;
  };

const fieldByKey: (
  props: StateChangeModalProps,
  key: string,
) => StateChangeField = (
  props: StateChangeModalProps,
  key: string,
): StateChangeField => {
  const field: StateChangeField | undefined = props.formProps.fields.find(
    (candidate: StateChangeField): boolean => {
      return (
        Boolean(candidate.field[key]) || candidate.overrideFieldKey === key
      );
    },
  );

  if (!field) {
    throw new Error(`The state change form has no ${key} field`);
  }

  return field;
};

type OpenModalFunction = () => void;

const clickMarkAsOngoing: OpenModalFunction = (): void => {
  fireEvent.click(document.getElementById("sm-mark-ongoing-btn")!);
};

const clickMarkAsEnded: OpenModalFunction = (): void => {
  fireEvent.click(document.getElementById("sm-mark-complete-btn")!);
};

const chooseFromMoreActions: (stateName: string) => OpenModalFunction = (
  stateName: string,
): OpenModalFunction => {
  return (): void => {
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    const choice: HTMLElement | undefined = Array.from(
      screen
        .getByRole("menu")
        .querySelectorAll<HTMLElement>('[role="menuitem"]'),
    )
      .filter((element: HTMLElement): boolean => {
        return !element.querySelector('[role="menuitem"]');
      })
      .find((element: HTMLElement): boolean => {
        return element.textContent?.trim() === stateName;
      });

    if (!choice) {
      throw new Error(`${stateName} is not offered under More actions`);
    }

    fireEvent.click(choice);
  };
};

interface OpenCase {
  label: string;
  open: OpenModalFunction;
  expectedTitle: string;
  expectedSubmitButtonText: string;
  expectedStateId: string;
  // The project's states and the event's current state for this way in.
  apiOptions?: FakeApiOptions | undefined;
}

const MARK_AS_ONGOING: OpenCase = {
  label: "Mark as Ongoing",
  open: clickMarkAsOngoing,
  expectedTitle: "Mark Scheduled Maintenance as Ongoing",
  expectedSubmitButtonText: "Mark as Ongoing",
  expectedStateId: ONGOING_STATE_ID,
};

const MARK_AS_ENDED: OpenCase = {
  label: "Mark as Ended",
  open: clickMarkAsEnded,
  expectedTitle: "Mark Scheduled Maintenance as Ended",
  expectedSubmitButtonText: "Mark as Ended",
  expectedStateId: ENDED_STATE_ID,
};

const CUSTOM_STATE_FROM_MENU: OpenCase = {
  label: "a custom state from More actions",
  open: chooseFromMoreActions("Verifying"),
  expectedTitle: "Mark Scheduled Maintenance as Verifying",
  expectedSubmitButtonText: "Mark as Verifying",
  expectedStateId: VERIFYING_STATE_ID,
};

const RESOLVED_STATE_FROM_MENU: OpenCase = {
  label: "the resolved state from More actions",
  open: chooseFromMoreActions("Completed"),
  expectedTitle: "Mark Scheduled Maintenance as Completed",
  expectedSubmitButtonText: "Mark as Completed",
  expectedStateId: COMPLETED_STATE_ID,
};

const RESOLVED_STATE_BUTTON: OpenCase = {
  label: "Mark as Completed, with no ended state in the project",
  open: clickMarkAsEnded,
  expectedTitle: "Mark Scheduled Maintenance as Completed",
  expectedSubmitButtonText: "Mark as Completed",
  expectedStateId: COMPLETED_STATE_ID,
  apiOptions: { states: STATES_WITHOUT_ENDED },
};

const SCHEDULED_STATE_FROM_MENU: OpenCase = {
  label: "the scheduled state from More actions",
  open: chooseFromMoreActions("Scheduled"),
  expectedTitle: "Mark Scheduled Maintenance as Scheduled",
  expectedSubmitButtonText: "Mark as Scheduled",
  expectedStateId: SCHEDULED_STATE_ID,
  apiOptions: { states: STATES_WITH_DRAFT, currentStateId: DRAFT_STATE_ID },
};

const OPEN_CASES: Array<OpenCase> = [
  MARK_AS_ONGOING,
  MARK_AS_ENDED,
  CUSTOM_STATE_FROM_MENU,
];

/*
 * Opens the form and checks it is the one for the chosen state. Every render
 * of the form since it opened must carry the same starting value: the form
 * reads it once when it mounts, so a first render that still saw the
 * previous (or no) target state would already have used the wrong one.
 */
const openModal: (
  openCase: OpenCase,
  settings?: Settings | undefined,
  options?: FakeApiOptions,
) => Promise<StateChangeModalProps> = async (
  openCase: OpenCase,
  settings?: Settings | undefined,
  options?: FakeApiOptions,
): Promise<StateChangeModalProps> => {
  respondWith({ ...openCase.apiOptions, ...options });
  renderHeader(settings);
  await waitForHeader();

  const rendersBefore: number = modalPropsHistory().length;

  openCase.open();

  expect(screen.getByTestId("state-change-modal")).toBeInTheDocument();

  const props: StateChangeModalProps = lastModalProps();

  expect(props.title).toBe(openCase.expectedTitle);
  expect(props.submitButtonText).toBe(openCase.expectedSubmitButtonText);

  const rendersSinceOpening: Array<StateChangeModalProps> =
    modalPropsHistory().slice(rendersBefore);

  expect(rendersSinceOpening.length).toBeGreaterThan(0);

  for (const modalRender of rendersSinceOpening) {
    expect(modalRender.title).toBe(openCase.expectedTitle);
    expect(modalRender.initialValues).toEqual(props.initialValues);
  }

  return props;
};

// The checkbox's starting state, as the header handed it to the form.
interface NotifyStart {
  seededValue: unknown;
  defaultValue: unknown;
  description: string | undefined;
}

const notifyStartOf: (props: StateChangeModalProps) => NotifyStart = (
  props: StateChangeModalProps,
): NotifyStart => {
  const field: StateChangeField = fieldByKey(props, NOTIFY_FIELD_KEY);

  return {
    seededValue: props.initialValues?.[NOTIFY_FIELD_KEY],
    defaultValue: field.defaultValue,
    description: field.description,
  };
};

const expectedNotifyStart: (notify: boolean) => NotifyStart = (
  notify: boolean,
): NotifyStart => {
  return {
    seededValue: notify,
    defaultValue: notify,
    description: notify ? ORIGINAL_DESCRIPTION : QUIET_DESCRIPTION,
  };
};

beforeEach(() => {
  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);

  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  modelFormModalMock.mockReset();
  capturedPayload = null;
  capturedMiscDataProps = null;
  capturedModel = null;
  jest.restoreAllMocks();
});

describe.each(OPEN_CASES)(
  "ChangeScheduledMaintenanceState via $label",
  (openCase: OpenCase) => {
    describe("event created quietly and set to announce neither ongoing nor ended", () => {
      test("seeds the form value with notify off, so a false flag is actually sent", async () => {
        const props: StateChangeModalProps = await openModal(
          openCase,
          QUIET_EVENT,
        );

        expect(props.modelType).toBe(ScheduledMaintenanceStateTimeline);
        expect(props.initialValues).toEqual({
          [NOTIFY_FIELD_KEY]: false,
        });
        expect(props.initialValues![NOTIFY_FIELD_KEY]).toBe(false);
      });

      test("starts the notify checkbox unticked and says why", async () => {
        const field: StateChangeField = fieldByKey(
          await openModal(openCase, QUIET_EVENT),
          NOTIFY_FIELD_KEY,
        );

        expect(field.fieldType).toBe(FormFieldSchemaType.Checkbox);
        expect(field.title).toBe(CHECKBOX_TITLE);
        expect(field.required).toBe(false);
        expect(field.defaultValue).toBe(false);
        expect(field.description).toBe(QUIET_DESCRIPTION);
        expect(field.description).toBe(
          "Unticked by default because status page subscribers were not notified when this scheduled maintenance event was created.",
        );
        expect(field.description).not.toBe(ORIGINAL_DESCRIPTION);
        // Not the incident copy: this event was created, not declared.
        expect(field.description).not.toBe(
          PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
        );
      });

      test("keeps the public note next to the checkbox that governs it", async () => {
        const props: StateChangeModalProps = await openModal(
          openCase,
          QUIET_EVENT,
        );

        expect(
          props.formProps.fields.map((field: StateChangeField): string => {
            return field.title;
          }),
        ).toEqual(["Select Note Template", "Public Note", CHECKBOX_TITLE]);
        expect(fieldByKey(props, "publicNote").fieldType).toBe(
          FormFieldSchemaType.Markdown,
        );
        expect(fieldByKey(props, "publicNote").required).toBe(false);
      });

      test("still records the change on this event, in the chosen state", async () => {
        const props: StateChangeModalProps = await openModal(
          openCase,
          QUIET_EVENT,
        );
        const timeline: ScheduledMaintenanceStateTimeline =
          new ScheduledMaintenanceStateTimeline();

        const created: ScheduledMaintenanceStateTimeline =
          (await props.onBeforeCreate(
            timeline,
          )) as ScheduledMaintenanceStateTimeline;

        expect(created).toBe(timeline);
        expect(created.projectId?.toString()).toBe(PROJECT_ID);
        expect(created.scheduledMaintenanceId?.toString()).toBe(EVENT_ID);
        expect(created.scheduledMaintenanceStateId?.toString()).toBe(
          openCase.expectedStateId,
        );
        // The form's own choice is not overridden on the way out.
        expect(created.shouldStatusPageSubscribersBeNotified).toBe(undefined);
      });

      test("onBeforeCreate never rewrites a flag the user set", async () => {
        const props: StateChangeModalProps = await openModal(
          openCase,
          QUIET_EVENT,
        );
        const timeline: ScheduledMaintenanceStateTimeline =
          new ScheduledMaintenanceStateTimeline();
        timeline.shouldStatusPageSubscribersBeNotified = true;

        const created: ScheduledMaintenanceStateTimeline =
          (await props.onBeforeCreate(
            timeline,
          )) as ScheduledMaintenanceStateTimeline;

        expect(created.shouldStatusPageSubscribersBeNotified).toBe(true);
      });
    });

    describe("event created with subscribers notified", () => {
      test("seeds the form value with notify on", async () => {
        const props: StateChangeModalProps = await openModal(
          openCase,
          NOTIFYING_EVENT,
        );

        expect(props.initialValues).toEqual({
          [NOTIFY_FIELD_KEY]: true,
        });
      });

      test("starts the checkbox ticked with the original description", async () => {
        const field: StateChangeField = fieldByKey(
          await openModal(openCase, NOTIFYING_EVENT),
          NOTIFY_FIELD_KEY,
        );

        expect(field.defaultValue).toBe(true);
        expect(field.description).toBe(ORIGINAL_DESCRIPTION);
        expect(field.description).not.toBe(QUIET_DESCRIPTION);
      });

      test("records the change on this event, in the chosen state", async () => {
        const props: StateChangeModalProps = await openModal(
          openCase,
          NOTIFYING_EVENT,
        );

        const created: ScheduledMaintenanceStateTimeline =
          (await props.onBeforeCreate(
            new ScheduledMaintenanceStateTimeline(),
          )) as ScheduledMaintenanceStateTimeline;

        expect(created.projectId?.toString()).toBe(PROJECT_ID);
        expect(created.scheduledMaintenanceId?.toString()).toBe(EVENT_ID);
        expect(created.scheduledMaintenanceStateId?.toString()).toBe(
          openCase.expectedStateId,
        );
      });
    });

    describe("no settings passed (backwards compatible)", () => {
      test("seeds the form value with notify on", async () => {
        const props: StateChangeModalProps = await openModal(
          openCase,
          undefined,
        );

        expect(props.initialValues).toEqual({
          [NOTIFY_FIELD_KEY]: true,
        });
      });

      test("starts the checkbox ticked with the original description", async () => {
        const field: StateChangeField = fieldByKey(
          await openModal(openCase, undefined),
          NOTIFY_FIELD_KEY,
        );

        expect(field.defaultValue).toBe(true);
        expect(field.description).toBe(ORIGINAL_DESCRIPTION);
      });
    });
  },
);

describe("ChangeScheduledMaintenanceState: the default follows the state the event moves to", () => {
  interface TargetCase {
    name: string;
    settings: Settings | undefined;
    target: OpenCase;
    expected: boolean;
  }

  const cases: Array<TargetCase> = [
    /*
     * Created quietly: moving it to ongoing or ended follows the event's own
     * setting for that change, like the worker that would otherwise make it.
     */
    {
      name: "quiet event set to announce going ongoing: Mark as Ongoing starts ticked",
      settings: QUIET_ANNOUNCES_ONGOING,
      target: MARK_AS_ONGOING,
      expected: true,
    },
    {
      name: "quiet event set to announce both: Mark as Ongoing starts ticked",
      settings: QUIET_ANNOUNCES_BOTH,
      target: MARK_AS_ONGOING,
      expected: true,
    },
    {
      name: "quiet event set to announce only ending: Mark as Ongoing starts unticked",
      settings: QUIET_ANNOUNCES_ENDED,
      target: MARK_AS_ONGOING,
      expected: false,
    },
    {
      name: "quiet event set to announce neither: Mark as Ongoing starts unticked",
      settings: QUIET_EVENT,
      target: MARK_AS_ONGOING,
      expected: false,
    },
    {
      name: "quiet event set to announce ending: Mark as Ended starts ticked",
      settings: QUIET_ANNOUNCES_ENDED,
      target: MARK_AS_ENDED,
      expected: true,
    },
    {
      name: "quiet event set to announce both: Mark as Ended starts ticked",
      settings: QUIET_ANNOUNCES_BOTH,
      target: MARK_AS_ENDED,
      expected: true,
    },
    {
      name: "quiet event set to announce only going ongoing: Mark as Ended starts unticked",
      settings: QUIET_ANNOUNCES_ONGOING,
      target: MARK_AS_ENDED,
      expected: false,
    },
    {
      name: "quiet event set to announce ending: the resolved state from More actions starts ticked",
      settings: QUIET_ANNOUNCES_ENDED,
      target: RESOLVED_STATE_FROM_MENU,
      expected: true,
    },
    {
      name: "quiet event set to announce only going ongoing: the resolved state from More actions starts unticked",
      settings: QUIET_ANNOUNCES_ONGOING,
      target: RESOLVED_STATE_FROM_MENU,
      expected: false,
    },
    {
      name: "quiet event set to announce ending: Mark as Completed (resolved) starts ticked",
      settings: QUIET_ANNOUNCES_ENDED,
      target: RESOLVED_STATE_BUTTON,
      expected: true,
    },
    {
      name: "quiet event set to announce only going ongoing: Mark as Completed (resolved) starts unticked",
      settings: QUIET_ANNOUNCES_ONGOING,
      target: RESOLVED_STATE_BUTTON,
      expected: false,
    },
    // Any other state has no setting of its own, so it stays quiet.
    {
      name: "quiet event set to announce both: a custom state starts unticked",
      settings: QUIET_ANNOUNCES_BOTH,
      target: CUSTOM_STATE_FROM_MENU,
      expected: false,
    },
    {
      name: "quiet event set to announce both: the scheduled state starts unticked",
      settings: QUIET_ANNOUNCES_BOTH,
      target: SCHEDULED_STATE_FROM_MENU,
      expected: false,
    },
    // Announced when created: every change starts ticked, as before.
    {
      name: "notified event set to announce neither: Mark as Ongoing still starts ticked",
      settings: NOTIFIED_ANNOUNCES_NOTHING,
      target: MARK_AS_ONGOING,
      expected: true,
    },
    {
      name: "notified event set to announce neither: Mark as Ended still starts ticked",
      settings: NOTIFIED_ANNOUNCES_NOTHING,
      target: MARK_AS_ENDED,
      expected: true,
    },
    {
      name: "notified event set to announce neither: the resolved state still starts ticked",
      settings: NOTIFIED_ANNOUNCES_NOTHING,
      target: RESOLVED_STATE_FROM_MENU,
      expected: true,
    },
    {
      name: "notified event set to announce neither: a custom state still starts ticked",
      settings: NOTIFIED_ANNOUNCES_NOTHING,
      target: CUSTOM_STATE_FROM_MENU,
      expected: true,
    },
    {
      name: "notified event set to announce neither: the scheduled state still starts ticked",
      settings: NOTIFIED_ANNOUNCES_NOTHING,
      target: SCHEDULED_STATE_FROM_MENU,
      expected: true,
    },
    // An unknown created setting keeps the long-standing default.
    {
      name: "created setting unknown, set to announce neither: Mark as Ongoing starts ticked",
      settings: CREATED_UNKNOWN_ANNOUNCES_NOTHING,
      target: MARK_AS_ONGOING,
      expected: true,
    },
    {
      name: "created setting unknown, set to announce neither: Mark as Ended starts ticked",
      settings: CREATED_UNKNOWN_ANNOUNCES_NOTHING,
      target: MARK_AS_ENDED,
      expected: true,
    },
    {
      name: "created setting unknown, set to announce neither: a custom state starts ticked",
      settings: CREATED_UNKNOWN_ANNOUNCES_NOTHING,
      target: CUSTOM_STATE_FROM_MENU,
      expected: true,
    },
    // No settings passed at all: notifying, whatever the target.
    {
      name: "no settings passed: the resolved state starts ticked",
      settings: undefined,
      target: RESOLVED_STATE_FROM_MENU,
      expected: true,
    },
    {
      name: "no settings passed: the scheduled state starts ticked",
      settings: undefined,
      target: SCHEDULED_STATE_FROM_MENU,
      expected: true,
    },
  ];

  test.each(cases)("$name", async (targetCase: TargetCase) => {
    const props: StateChangeModalProps = await openModal(
      targetCase.target,
      targetCase.settings,
    );

    expect(props.initialValues).toEqual({
      [NOTIFY_FIELD_KEY]: targetCase.expected,
    });
    expect(notifyStartOf(props)).toEqual(
      expectedNotifyStart(targetCase.expected),
    );

    // Still recorded against the state that was chosen.
    const created: ScheduledMaintenanceStateTimeline =
      (await props.onBeforeCreate(
        new ScheduledMaintenanceStateTimeline(),
      )) as ScheduledMaintenanceStateTimeline;

    expect(created.scheduledMaintenanceStateId?.toString()).toBe(
      targetCase.target.expectedStateId,
    );
  });

  test("each form opened in one visit starts from its own target", async () => {
    const props: StateChangeModalProps = await openModal(
      MARK_AS_ONGOING,
      QUIET_ANNOUNCES_ONGOING,
    );

    expect(notifyStartOf(props)).toEqual(expectedNotifyStart(true));

    const closeAndOpen: (openCase: OpenCase) => StateChangeModalProps = (
      openCase: OpenCase,
    ): StateChangeModalProps => {
      act(() => {
        lastModalProps().onClose();
      });

      expect(screen.queryByTestId("state-change-modal")).toBeNull();

      const rendersBefore: number = modalPropsHistory().length;

      openCase.open();

      const rendersSinceOpening: Array<StateChangeModalProps> =
        modalPropsHistory().slice(rendersBefore);

      expect(rendersSinceOpening.length).toBeGreaterThan(0);

      // Not one render with the previous target's value.
      for (const modalRender of rendersSinceOpening) {
        expect(modalRender.title).toBe(openCase.expectedTitle);
        expect(modalRender.initialValues).toEqual(
          lastModalProps().initialValues,
        );
      }

      return lastModalProps();
    };

    expect(notifyStartOf(closeAndOpen(MARK_AS_ENDED))).toEqual(
      expectedNotifyStart(false),
    );
    expect(notifyStartOf(closeAndOpen(CUSTOM_STATE_FROM_MENU))).toEqual(
      expectedNotifyStart(false),
    );
    expect(notifyStartOf(closeAndOpen(MARK_AS_ONGOING))).toEqual(
      expectedNotifyStart(true),
    );
  });
});

describe("ChangeScheduledMaintenanceState note template", () => {
  test("offers the project's templates in the form", async () => {
    const props: StateChangeModalProps = await openModal(
      MARK_AS_ONGOING,
      QUIET_EVENT,
      { withTemplate: true },
    );
    const templateField: StateChangeField = fieldByKey(
      props,
      "publicNoteTemplate",
    );

    expect(templateField.showIf!()).toBe(true);
    expect(templateField.dropdownOptions).toEqual([
      { value: TEMPLATE_ID, label: "Drill started" },
    ]);
  });

  test("picking a template fills the public note and keeps notify off", async () => {
    const props: StateChangeModalProps = await openModal(
      MARK_AS_ONGOING,
      QUIET_EVENT,
      { withTemplate: true },
    );
    const templateField: StateChangeField = fieldByKey(
      props,
      "publicNoteTemplate",
    );
    const setNewFormValues: MockFunction = getJestMockFunction();

    templateField.onChange!(
      TEMPLATE_ID,
      {
        [NOTIFY_FIELD_KEY]: props.initialValues![NOTIFY_FIELD_KEY],
        publicNote: "",
      },
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues).toHaveBeenCalledWith({
      [NOTIFY_FIELD_KEY]: false,
      publicNote: TEMPLATE_NOTE,
    });
  });

  test("picking a template keeps a ticked box ticked", async () => {
    const props: StateChangeModalProps = await openModal(
      MARK_AS_ENDED,
      NOTIFYING_EVENT,
      {
        withTemplate: true,
      },
    );
    const setNewFormValues: MockFunction = getJestMockFunction();

    fieldByKey(props, "publicNoteTemplate").onChange!(
      TEMPLATE_ID,
      { [NOTIFY_FIELD_KEY]: true },
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledWith({
      [NOTIFY_FIELD_KEY]: true,
      publicNote: TEMPLATE_NOTE,
    });
  });

  test("picking a template keeps a box the user ticked by hand", async () => {
    const props: StateChangeModalProps = await openModal(
      MARK_AS_ONGOING,
      QUIET_EVENT,
      { withTemplate: true },
    );
    const setNewFormValues: MockFunction = getJestMockFunction();

    // Notify was ticked by hand before the template was picked.
    fieldByKey(props, "publicNoteTemplate").onChange!(
      TEMPLATE_ID,
      { [NOTIFY_FIELD_KEY]: true, publicNote: "draft" },
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledWith({
      [NOTIFY_FIELD_KEY]: true,
      publicNote: TEMPLATE_NOTE,
    });
  });

  test("an unknown template changes nothing", async () => {
    const props: StateChangeModalProps = await openModal(
      MARK_AS_ONGOING,
      QUIET_EVENT,
      { withTemplate: true },
    );
    const setNewFormValues: MockFunction = getJestMockFunction();

    fieldByKey(props, "publicNoteTemplate").onChange!(
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      { [NOTIFY_FIELD_KEY]: false },
      setNewFormValues,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("with no templates the picker stays hidden and notify still starts off", async () => {
    const props: StateChangeModalProps = await openModal(
      MARK_AS_ONGOING,
      QUIET_EVENT,
    );

    expect(fieldByKey(props, "publicNoteTemplate").showIf!()).toBe(false);
    expect(props.initialValues).toEqual({ [NOTIFY_FIELD_KEY]: false });
  });
});

describe("ChangeScheduledMaintenanceState: the default follows the page", () => {
  /*
   * The page passes the event's settings once it has loaded, and again after
   * each refresh. A form opened after that must use the current values,
   * without the header reloading.
   */
  type RerenderToFunction = (
    first: Settings | undefined,
    next: Settings | undefined,
  ) => Promise<number>;

  // Returns how many list requests the header made before the rerender.
  const rerenderTo: RerenderToFunction = async (
    first: Settings | undefined,
    next: Settings | undefined,
  ): Promise<number> => {
    respondWith();

    const view: RenderResult = renderHeader(first);
    await waitForHeader();

    const listCallsBefore: number = getListMock.mock.calls.length;

    view.rerender(headerElement(next));

    clickMarkAsOngoing();

    return listCallsBefore;
  };

  test("a form opened after the event turns quiet starts unticked", async () => {
    const listCallsBefore: number = await rerenderTo(
      NOTIFYING_EVENT,
      QUIET_EVENT,
    );

    await waitFor(() => {
      expect(lastModalProps().initialValues).toEqual({
        [NOTIFY_FIELD_KEY]: false,
      });
    });

    expect(notifyStartOf(lastModalProps())).toEqual(expectedNotifyStart(false));
    expect(getListMock.mock.calls.length).toBe(listCallsBefore);
  });

  test("a form opened after the event notifies again starts ticked", async () => {
    const listCallsBefore: number = await rerenderTo(
      QUIET_EVENT,
      NOTIFYING_EVENT,
    );

    await waitFor(() => {
      expect(lastModalProps().initialValues).toEqual({
        [NOTIFY_FIELD_KEY]: true,
      });
    });

    expect(notifyStartOf(lastModalProps())).toEqual(expectedNotifyStart(true));
    expect(getListMock.mock.calls.length).toBe(listCallsBefore);
  });

  test("a form opened after only the Event Ongoing setting turns on starts ticked", async () => {
    const listCallsBefore: number = await rerenderTo(
      QUIET_EVENT,
      QUIET_ANNOUNCES_ONGOING,
    );

    await waitFor(() => {
      expect(lastModalProps().initialValues).toEqual({
        [NOTIFY_FIELD_KEY]: true,
      });
    });

    expect(notifyStartOf(lastModalProps())).toEqual(expectedNotifyStart(true));
    expect(getListMock.mock.calls.length).toBe(listCallsBefore);
  });
});

/*
 * The real form, built from exactly the props the header handed the modal
 * (ModelFormModal passes them straight to ModelForm), submitted down to the
 * request it would send. The state change form has no checkbox of its own
 * for its public note: the server posts the note with Boolean(the state
 * change's flag). So the one checkbox's starting value is what decides
 * whether both the change and its note reach subscribers.
 */
describe("ChangeScheduledMaintenanceState: what the real form sends", () => {
  const renderRealForm: (
    props: StateChangeModalProps,
  ) => Promise<void> = async (props: StateChangeModalProps): Promise<void> => {
    const formProps: ModelFormComponentProps<ScheduledMaintenanceStateTimeline> =
      props.formProps as unknown as ModelFormComponentProps<ScheduledMaintenanceStateTimeline>;

    expect(formProps.formType).toBe(FormType.Create);

    render(
      <ModelForm<ScheduledMaintenanceStateTimeline>
        {...formProps}
        modelType={ScheduledMaintenanceStateTimeline}
        initialValues={
          props.initialValues as FormValues<ScheduledMaintenanceStateTimeline>
        }
        onBeforeCreate={
          props.onBeforeCreate as (
            item: ScheduledMaintenanceStateTimeline,
          ) => Promise<ScheduledMaintenanceStateTimeline>
        }
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Save"
      />,
    );

    await screen.findByRole("checkbox", { name: CHECKBOX_TITLE });
  };

  const openRealForm: (
    openCase: OpenCase,
    settings: Settings | undefined,
  ) => Promise<void> = async (
    openCase: OpenCase,
    settings: Settings | undefined,
  ): Promise<void> => {
    await renderRealForm(await openModal(openCase, settings));
  };

  const notifyCheckbox: () => HTMLInputElement = (): HTMLInputElement => {
    return screen.getByRole("checkbox", {
      name: CHECKBOX_TITLE,
    }) as HTMLInputElement;
  };

  const writeNote: () => Promise<void> = async (): Promise<void> => {
    // The markdown source view is a plain textarea.
    fireEvent.click(screen.getByTitle("Switch to markdown source"));

    fireEvent.change(
      await screen.findByPlaceholderText("Type your markdown here..."),
      {
        target: { value: NOTE_TEXT },
      },
    );
  };

  const toggleNotify: () => void = (): void => {
    fireEvent.click(notifyCheckbox());
  };

  const submit: () => Promise<JSONObject> = async (): Promise<JSONObject> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(capturedPayload).not.toBeNull();
    });

    return capturedPayload!;
  };

  test("quiet event set to announce going ongoing: Mark as Ongoing sends true, so the change and its note notify", async () => {
    await openRealForm(MARK_AS_ONGOING, QUIET_ANNOUNCES_ONGOING);

    expect(notifyCheckbox()).toBeChecked();
    expect(screen.getByText(ORIGINAL_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(QUIET_DESCRIPTION)).toBeNull();

    await writeNote();
    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD_KEY]).toBe(true);
    // The note travels beside the timeline row, not inside it.
    expect(capturedMiscDataProps?.["publicNote"]).toBe(NOTE_TEXT);
    expect(payload["publicNote"]).toBeUndefined();
    expect(capturedModel?.scheduledMaintenanceStateId?.toString()).toBe(
      ONGOING_STATE_ID,
    );
    expect(capturedModel?.scheduledMaintenanceId?.toString()).toBe(EVENT_ID);
  });

  test("quiet event set to announce only going ongoing: Mark as Ended sends an explicit false, so the change and its note stay quiet", async () => {
    await openRealForm(MARK_AS_ENDED, QUIET_ANNOUNCES_ONGOING);

    expect(notifyCheckbox()).not.toBeChecked();
    expect(screen.getByText(QUIET_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(ORIGINAL_DESCRIPTION)).toBeNull();

    await writeNote();
    const payload: JSONObject = await submit();

    expect(Object.keys(payload)).toContain(NOTIFY_FIELD_KEY);
    expect(payload[NOTIFY_FIELD_KEY]).toBe(false);
    expect(capturedMiscDataProps?.["publicNote"]).toBe(NOTE_TEXT);
    expect(capturedModel?.scheduledMaintenanceStateId?.toString()).toBe(
      ENDED_STATE_ID,
    );
  });

  test("quiet event: ticking the box by hand sends true with the note", async () => {
    await openRealForm(MARK_AS_ENDED, QUIET_EVENT);

    expect(notifyCheckbox()).not.toBeChecked();

    await writeNote();
    toggleNotify();

    expect(notifyCheckbox()).toBeChecked();

    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD_KEY]).toBe(true);
    expect(capturedMiscDataProps?.["publicNote"]).toBe(NOTE_TEXT);
  });

  test("quiet event set to announce going ongoing: unticking the box by hand sends false with the note", async () => {
    await openRealForm(MARK_AS_ONGOING, QUIET_ANNOUNCES_ONGOING);

    expect(notifyCheckbox()).toBeChecked();

    await writeNote();
    toggleNotify();

    expect(notifyCheckbox()).not.toBeChecked();

    const payload: JSONObject = await submit();

    expect(Object.keys(payload)).toContain(NOTIFY_FIELD_KEY);
    expect(payload[NOTIFY_FIELD_KEY]).toBe(false);
    expect(capturedMiscDataProps?.["publicNote"]).toBe(NOTE_TEXT);
  });

  test("quiet event set to announce both: a custom state sends an explicit false", async () => {
    await openRealForm(CUSTOM_STATE_FROM_MENU, QUIET_ANNOUNCES_BOTH);

    expect(notifyCheckbox()).not.toBeChecked();

    await writeNote();
    const payload: JSONObject = await submit();

    expect(Object.keys(payload)).toContain(NOTIFY_FIELD_KEY);
    expect(payload[NOTIFY_FIELD_KEY]).toBe(false);
    expect(capturedMiscDataProps?.["publicNote"]).toBe(NOTE_TEXT);
    expect(capturedModel?.scheduledMaintenanceStateId?.toString()).toBe(
      VERIFYING_STATE_ID,
    );
  });

  test("notified event set to announce neither: Mark as Ongoing still sends true", async () => {
    await openRealForm(MARK_AS_ONGOING, NOTIFIED_ANNOUNCES_NOTHING);

    expect(notifyCheckbox()).toBeChecked();

    await writeNote();
    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD_KEY]).toBe(true);
    expect(capturedMiscDataProps?.["publicNote"]).toBe(NOTE_TEXT);
  });
});
