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
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();
const modelFormModalMock: MockFunction = getJestMockFunction();

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
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

/*
 * The state-change modal is a full model form with its own API traffic. These
 * tests are about what the header hands it, so the stub records its props and
 * renders the title.
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

import ChangeIncidentState from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../Models/DatabaseModels/Project";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * An incident declared without notifying status page subscribers (the box
 * unticked, or a private incident) should not have a later state change be
 * what tells them. The header's state change form now starts with "Notify
 * Status Page Subscribers" off for such an incident. The flag is seeded
 * through initialValues as well as the field's defaultValue, because the
 * form drops a false defaultValue and an unsent flag falls back to the
 * database default of notifying. These tests drive the real header against
 * a fake API and pin both, for every way the form opens.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const INCIDENT_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const INVESTIGATING_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const RESOLVED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const TEMPLATE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const TEMPLATE_NOTE: string = "We are looking into elevated checkout latency.";

const START: Date = new Date("2026-09-14T18:00:00.000Z");

const NOTIFY_FIELD_KEY: string = "shouldStatusPageSubscribersBeNotified";
const ORIGINAL_DESCRIPTION: string = "Notify subscribers of this state change.";

interface StateSpec {
  id: string;
  name: string;
  color: string;
  flag?: "isCreatedState" | "isAcknowledgedState" | "isResolvedState";
}

const STATE_SPECS: Array<StateSpec> = [
  {
    id: CREATED_STATE_ID,
    name: "Created",
    color: "#ef4444",
    flag: "isCreatedState",
  },
  {
    id: ACKNOWLEDGED_STATE_ID,
    name: "Acknowledged",
    color: "#f59e0b",
    flag: "isAcknowledgedState",
  },
  {
    id: INVESTIGATING_STATE_ID,
    name: "Investigating",
    color: "#6366f1",
  },
  {
    id: RESOLVED_STATE_ID,
    name: "Resolved",
    color: "#10b981",
    flag: "isResolvedState",
  },
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
  onBeforeCreate: (model: IncidentStateTimeline) => Promise<unknown>;
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
}

const buildStates: () => Array<IncidentState> = (): Array<IncidentState> => {
  return STATE_SPECS.map((spec: StateSpec): IncidentState => {
    const state: IncidentState = new IncidentState();
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

    if (request.modelType === IncidentState) {
      return Promise.resolve(listResult(buildStates()));
    }

    if (request.modelType === IncidentStateTimeline) {
      const timeline: IncidentStateTimeline = new IncidentStateTimeline();
      timeline.incidentStateId = new ObjectID(CREATED_STATE_ID);
      timeline.startsAt = START;
      return Promise.resolve(listResult([timeline]));
    }

    if (request.modelType === IncidentNoteTemplate) {
      if (!options?.withTemplate) {
        return Promise.resolve(listResult([]));
      }

      const template: IncidentNoteTemplate = new IncidentNoteTemplate();
      template.id = new ObjectID(TEMPLATE_ID);
      template.templateName = "Investigating update";
      template.note = TEMPLATE_NOTE;
      return Promise.resolve(listResult([template]));
    }

    return Promise.reject(new Error("Unexpected list request"));
  });
};

const renderHeader: (
  notifyStatusPageSubscribersByDefault?: boolean | undefined,
) => RenderResult = (
  notifyStatusPageSubscribersByDefault?: boolean | undefined,
): RenderResult => {
  return render(
    <ChangeIncidentState
      incidentId={new ObjectID(INCIDENT_ID)}
      eventNumber="INC-42"
      title="Checkout latency above 2s"
      eventStartsAt={START}
      onActionComplete={jest.fn()}
      notifyStatusPageSubscribersByDefault={
        notifyStatusPageSubscribersByDefault
      }
    />,
  );
};

const waitForHeader: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    return screen.findByRole("heading", {
      level: 2,
      name: "Checkout latency above 2s",
    });
  };

const lastModalProps: () => StateChangeModalProps =
  (): StateChangeModalProps => {
    const calls: Array<Array<StateChangeModalProps>> = modelFormModalMock.mock
      .calls as Array<Array<StateChangeModalProps>>;

    return calls[calls.length - 1]![0]!;
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

const clickAcknowledge: OpenModalFunction = (): void => {
  fireEvent.click(document.getElementById("incident-acknowledge-btn")!);
};

const clickResolve: OpenModalFunction = (): void => {
  fireEvent.click(document.getElementById("incident-resolve-btn")!);
};

const chooseInvestigatingFromMoreActions: OpenModalFunction = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));

  const choice: HTMLElement | undefined = Array.from(
    screen.getByRole("menu").querySelectorAll<HTMLElement>('[role="menuitem"]'),
  )
    .filter((element: HTMLElement): boolean => {
      return !element.querySelector('[role="menuitem"]');
    })
    .find((element: HTMLElement): boolean => {
      return element.textContent?.trim() === "Investigating";
    });

  if (!choice) {
    throw new Error("Investigating is not offered under More actions");
  }

  fireEvent.click(choice);
};

interface OpenCase {
  label: string;
  open: OpenModalFunction;
  expectedTitle: string;
  expectedStateId: string;
}

const OPEN_CASES: Array<OpenCase> = [
  {
    label: "Acknowledge",
    open: clickAcknowledge,
    expectedTitle: "Acknowledge Incident",
    expectedStateId: ACKNOWLEDGED_STATE_ID,
  },
  {
    label: "Resolve",
    open: clickResolve,
    expectedTitle: "Resolve Incident",
    expectedStateId: RESOLVED_STATE_ID,
  },
  {
    label: "a state from More actions",
    open: chooseInvestigatingFromMoreActions,
    expectedTitle: "Mark Incident as Investigating",
    expectedStateId: INVESTIGATING_STATE_ID,
  },
];

const openModal: (
  openCase: OpenCase,
  notifyStatusPageSubscribersByDefault?: boolean | undefined,
  options?: FakeApiOptions,
) => Promise<StateChangeModalProps> = async (
  openCase: OpenCase,
  notifyStatusPageSubscribersByDefault?: boolean | undefined,
  options?: FakeApiOptions,
): Promise<StateChangeModalProps> => {
  respondWith(options);
  renderHeader(notifyStatusPageSubscribersByDefault);
  await waitForHeader();

  openCase.open();

  expect(screen.getByTestId("state-change-modal")).toBeInTheDocument();

  const props: StateChangeModalProps = lastModalProps();

  expect(props.title).toBe(openCase.expectedTitle);

  return props;
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
  jest.restoreAllMocks();
});

describe.each(OPEN_CASES)(
  "ChangeIncidentState via $label",
  (openCase: OpenCase) => {
    describe("incident declared without notifying subscribers", () => {
      test("seeds the form value with notify off, so a false flag is actually sent", async () => {
        const props: StateChangeModalProps = await openModal(openCase, false);

        expect(props.modelType).toBe(IncidentStateTimeline);
        expect(props.initialValues).toEqual({
          [NOTIFY_FIELD_KEY]: false,
        });
        expect(props.initialValues![NOTIFY_FIELD_KEY]).toBe(false);
      });

      test("starts the notify checkbox unticked and says why", async () => {
        const field: StateChangeField = fieldByKey(
          await openModal(openCase, false),
          NOTIFY_FIELD_KEY,
        );

        expect(field.fieldType).toBe(FormFieldSchemaType.Checkbox);
        expect(field.title).toBe("Notify Status Page Subscribers");
        expect(field.required).toBe(false);
        expect(field.defaultValue).toBe(false);
        expect(field.description).toBe(
          PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
        );
        expect(field.description).not.toBe(ORIGINAL_DESCRIPTION);
      });

      test("still records the change on this incident, in the chosen state", async () => {
        const props: StateChangeModalProps = await openModal(openCase, false);
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();

        const created: IncidentStateTimeline = (await props.onBeforeCreate(
          timeline,
        )) as IncidentStateTimeline;

        expect(created).toBe(timeline);
        expect(created.projectId?.toString()).toBe(PROJECT_ID);
        expect(created.incidentId?.toString()).toBe(INCIDENT_ID);
        expect(created.incidentStateId?.toString()).toBe(
          openCase.expectedStateId,
        );
        // The form's own choice is not overridden on the way out.
        expect(created.shouldStatusPageSubscribersBeNotified).toBe(undefined);
      });

      test("onBeforeCreate never rewrites a flag the user set", async () => {
        const props: StateChangeModalProps = await openModal(openCase, false);
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.shouldStatusPageSubscribersBeNotified = true;

        const created: IncidentStateTimeline = (await props.onBeforeCreate(
          timeline,
        )) as IncidentStateTimeline;

        expect(created.shouldStatusPageSubscribersBeNotified).toBe(true);
      });
    });

    describe("incident declared with subscribers notified", () => {
      test("seeds the form value with notify on", async () => {
        const props: StateChangeModalProps = await openModal(openCase, true);

        expect(props.initialValues).toEqual({
          [NOTIFY_FIELD_KEY]: true,
        });
      });

      test("starts the checkbox ticked with the original description", async () => {
        const field: StateChangeField = fieldByKey(
          await openModal(openCase, true),
          NOTIFY_FIELD_KEY,
        );

        expect(field.defaultValue).toBe(true);
        expect(field.description).toBe(ORIGINAL_DESCRIPTION);
      });

      test("records the change on this incident, in the chosen state", async () => {
        const props: StateChangeModalProps = await openModal(openCase, true);

        const created: IncidentStateTimeline = (await props.onBeforeCreate(
          new IncidentStateTimeline(),
        )) as IncidentStateTimeline;

        expect(created.projectId?.toString()).toBe(PROJECT_ID);
        expect(created.incidentId?.toString()).toBe(INCIDENT_ID);
        expect(created.incidentStateId?.toString()).toBe(
          openCase.expectedStateId,
        );
      });
    });

    describe("no default passed (backwards compatible)", () => {
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

describe("ChangeIncidentState note template", () => {
  test("offers the project's templates in the form", async () => {
    const props: StateChangeModalProps = await openModal(
      OPEN_CASES[0]!,
      false,
      { withTemplate: true },
    );
    const templateField: StateChangeField = fieldByKey(
      props,
      "publicNoteTemplate",
    );

    expect(templateField.showIf!()).toBe(true);
    expect(templateField.dropdownOptions).toEqual([
      { value: TEMPLATE_ID, label: "Investigating update" },
    ]);
  });

  test("picking a template fills the public note and keeps notify off", async () => {
    const props: StateChangeModalProps = await openModal(
      OPEN_CASES[0]!,
      false,
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
    const props: StateChangeModalProps = await openModal(OPEN_CASES[1]!, true, {
      withTemplate: true,
    });
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
      OPEN_CASES[0]!,
      false,
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
      OPEN_CASES[0]!,
      false,
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
    const props: StateChangeModalProps = await openModal(OPEN_CASES[0]!, false);

    expect(fieldByKey(props, "publicNoteTemplate").showIf!()).toBe(false);
    expect(props.initialValues).toEqual({ [NOTIFY_FIELD_KEY]: false });
  });
});

describe("ChangeIncidentState: the default follows the page", () => {
  /*
   * The page passes the flag once the incident has loaded. A form opened
   * after that must use the current value, without the header reloading.
   */
  test("a form opened after the default turns off starts unticked", async () => {
    respondWith();

    const view: RenderResult = renderHeader(true);
    await waitForHeader();

    const listCallsBefore: number = getListMock.mock.calls.length;

    view.rerender(
      <ChangeIncidentState
        incidentId={new ObjectID(INCIDENT_ID)}
        eventNumber="INC-42"
        title="Checkout latency above 2s"
        eventStartsAt={START}
        onActionComplete={jest.fn()}
        notifyStatusPageSubscribersByDefault={false}
      />,
    );

    clickAcknowledge();

    await waitFor(() => {
      expect(lastModalProps().initialValues).toEqual({
        [NOTIFY_FIELD_KEY]: false,
      });
    });

    const field: StateChangeField = fieldByKey(
      lastModalProps(),
      NOTIFY_FIELD_KEY,
    );

    expect(field.defaultValue).toBe(false);
    expect(field.description).toBe(
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
    );
    expect(getListMock.mock.calls.length).toBe(listCallsBefore);
  });
});
