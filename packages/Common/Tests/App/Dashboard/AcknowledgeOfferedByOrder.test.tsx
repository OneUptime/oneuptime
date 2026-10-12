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
  within,
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

// The state-change modal: the stub records what the header hands it.
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

import ChangeAlertState from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/ChangeState";
import ChangeIncidentState from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState";
import AlertNoteTemplate from "../../../Models/DatabaseModels/AlertNoteTemplate";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../Models/DatabaseModels/Project";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

/*
 * ACKNOWLEDGE IS OFFERED ONLY TO A RECORD THAT IS NOT ACKNOWLEDGED YET, BY
 * THE ORDER RULE (Common/Utils/AcknowledgedState) - in the incident and the
 * alert header alike.
 *
 * A record is acknowledged in its project's acknowledged state (the first
 * from the top flagged acknowledged), in any state placed after it -
 * "Investigating", without a flag - and once it is resolved. The header read
 * where the states came in the list it was sent: a list in another order,
 * or a record moved straight into a later state, still showed Acknowledge,
 * a move back up the list the server refuses.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const RECORD_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const INVESTIGATING: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const RESOLVED: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
// A second state flagged acknowledged, placed further down the list.
const ACKNOWLEDGED_AGAIN: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";

const TITLE: string = "Checkout latency above 2s";
const START: Date = new Date("2026-09-14T18:00:00.000Z");

interface StateSpec {
  id: string;
  name: string;
  order: number;
  flag?: "isCreatedState" | "isAcknowledgedState" | "isResolvedState";
}

const CREATED_SPEC: StateSpec = {
  id: CREATED,
  name: "Created",
  order: 1,
  flag: "isCreatedState",
};
const ACKNOWLEDGED_SPEC: StateSpec = {
  id: ACKNOWLEDGED,
  name: "Acknowledged",
  order: 2,
  flag: "isAcknowledgedState",
};
const INVESTIGATING_SPEC: StateSpec = {
  id: INVESTIGATING,
  name: "Investigating",
  order: 3,
};
const RESOLVED_SPEC: StateSpec = {
  id: RESOLVED,
  name: "Resolved",
  order: 4,
  flag: "isResolvedState",
};

const SEEDED_LIST: Array<StateSpec> = [
  CREATED_SPEC,
  ACKNOWLEDGED_SPEC,
  INVESTIGATING_SPEC,
  RESOLVED_SPEC,
];

// The same states, sent in another order: their places decide, not this.
const SHUFFLED_LIST: Array<StateSpec> = [
  INVESTIGATING_SPEC,
  RESOLVED_SPEC,
  CREATED_SPEC,
  ACKNOWLEDGED_SPEC,
];

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

interface HeaderKind {
  noun: string;
  stateModel: typeof IncidentState | typeof AlertState;
  timelineModel: typeof IncidentStateTimeline | typeof AlertStateTimeline;
  templateModel: typeof IncidentNoteTemplate | typeof AlertNoteTemplate;
  stateIdField: "incidentStateId" | "alertStateId";
  acknowledgeId: string;
  resolveId: string;
  acknowledgeTitle: string;
  renderHeader: () => void;
}

const KINDS: Array<HeaderKind> = [
  {
    noun: "incident",
    stateModel: IncidentState,
    timelineModel: IncidentStateTimeline,
    templateModel: IncidentNoteTemplate,
    stateIdField: "incidentStateId",
    acknowledgeId: "incident-acknowledge-btn",
    resolveId: "incident-resolve-btn",
    acknowledgeTitle: "Acknowledge Incident",
    renderHeader: (): void => {
      render(
        <ChangeIncidentState
          incidentId={new ObjectID(RECORD_ID)}
          eventNumber="INC-42"
          title={TITLE}
          eventStartsAt={START}
          onActionComplete={(): void => {}}
        />,
      );
    },
  },
  {
    noun: "alert",
    stateModel: AlertState,
    timelineModel: AlertStateTimeline,
    templateModel: AlertNoteTemplate,
    stateIdField: "alertStateId",
    acknowledgeId: "alert-acknowledge-btn",
    resolveId: "alert-resolve-btn",
    acknowledgeTitle: "Acknowledge Alert",
    renderHeader: (): void => {
      render(
        <ChangeAlertState
          alertId={new ObjectID(RECORD_ID)}
          eventNumber="ALR-12"
          title={TITLE}
          eventStartsAt={START}
          onActionComplete={(): void => {}}
        />,
      );
    },
  },
];

/*
 * The header's reads: the project's states (as listed), the record's state
 * timeline (one row per state it moved into, ten minutes apart) and no note
 * templates.
 */
function respondWith(
  kind: HeaderKind,
  data: { states: Array<StateSpec>; path: Array<string> },
): void {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === kind.stateModel) {
      return Promise.resolve(
        listResult(
          data.states.map((spec: StateSpec): IncidentState | AlertState => {
            const state: IncidentState | AlertState = new kind.stateModel();
            state.id = new ObjectID(spec.id);
            state.name = spec.name;
            state.color = new Color("#6366f1");
            state.order = spec.order;

            if (spec.flag) {
              state[spec.flag] = true;
            }

            return state;
          }),
        ),
      );
    }

    if (request.modelType === kind.timelineModel) {
      return Promise.resolve(
        listResult(
          data.path.map(
            (
              stateId: string,
              index: number,
            ): IncidentStateTimeline | AlertStateTimeline => {
              const timeline: IncidentStateTimeline | AlertStateTimeline =
                new kind.timelineModel();
              (timeline as unknown as Record<string, unknown>)[
                kind.stateIdField
              ] = new ObjectID(stateId);
              timeline.startsAt = new Date(
                START.getTime() + index * 10 * 60 * 1000,
              );
              return timeline;
            },
          ),
        ),
      );
    }

    if (request.modelType === kind.templateModel) {
      return Promise.resolve(listResult([]));
    }

    return Promise.reject(new Error("Unexpected list request"));
  });
}

async function renderLoaded(kind: HeaderKind): Promise<void> {
  kind.renderHeader();
  await screen.findByRole("heading", { level: 2, name: TITLE });
}

/*
 * The ids of the state actions in the header's action row, in DOM order.
 * A row can hold no button at all: a resolved record is offered no action,
 * and - its states compared by their places - no state after Resolved in the
 * More actions menu either.
 */
function stateActionIds(kind: HeaderKind): Array<string> {
  return within(screen.getByRole("group", { name: "Event actions" }))
    .queryAllByRole("button")
    .map((button: HTMLElement): string => {
      return button.id;
    })
    .filter((id: string): boolean => {
      return id === kind.acknowledgeId || id === kind.resolveId;
    });
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();

  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);

  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return [Permission.ProjectMember];
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  modelFormModalMock.mockReset();
  jest.restoreAllMocks();
});

describe.each(KINDS)("the $noun header", (kind: HeaderKind) => {
  test("a record not acknowledged yet is offered Acknowledge, then Resolve", async () => {
    respondWith(kind, { states: SEEDED_LIST, path: [CREATED] });

    await renderLoaded(kind);

    expect(stateActionIds(kind)).toEqual([kind.acknowledgeId, kind.resolveId]);
  });

  test("a record moved straight into a state placed after Acknowledged is not offered Acknowledge", async () => {
    respondWith(kind, {
      states: SEEDED_LIST,
      path: [CREATED, INVESTIGATING],
    });

    await renderLoaded(kind);

    expect(stateActionIds(kind)).toEqual([kind.resolveId]);
    expect(document.getElementById(kind.acknowledgeId)).toBeNull();
  });

  test("a record in that state is not offered Acknowledge when the states come in another order", async () => {
    respondWith(kind, {
      states: SHUFFLED_LIST,
      path: [CREATED, ACKNOWLEDGED, INVESTIGATING],
    });

    await renderLoaded(kind);

    expect(stateActionIds(kind)).toEqual([kind.resolveId]);
  });

  test("a record not acknowledged yet is still offered Acknowledge when the states come in another order", async () => {
    respondWith(kind, { states: SHUFFLED_LIST, path: [CREATED] });

    await renderLoaded(kind);

    expect(stateActionIds(kind)).toEqual([kind.acknowledgeId, kind.resolveId]);
  });

  test("a resolved record is offered neither", async () => {
    respondWith(kind, {
      states: SHUFFLED_LIST,
      path: [CREATED, INVESTIGATING, RESOLVED],
    });

    await renderLoaded(kind);

    expect(stateActionIds(kind)).toEqual([]);
  });

  test("Acknowledge moves the record into the first state from the top flagged acknowledged", async () => {
    respondWith(kind, {
      states: [
        {
          id: ACKNOWLEDGED_AGAIN,
          name: "Paged",
          order: 3.5,
          flag: "isAcknowledgedState",
        },
        ...SHUFFLED_LIST,
      ],
      path: [CREATED],
    });

    await renderLoaded(kind);

    fireEvent.click(document.getElementById(kind.acknowledgeId)!);

    expect(screen.getByTestId("state-change-modal")).toHaveTextContent(
      `${kind.acknowledgeTitle} / Acknowledge`,
    );

    const calls: Array<
      Array<{ onBeforeCreate: (model: unknown) => Promise<unknown> }>
    > = modelFormModalMock.mock.calls as Array<
      Array<{ onBeforeCreate: (model: unknown) => Promise<unknown> }>
    >;
    const timeline: IncidentStateTimeline | AlertStateTimeline =
      new kind.timelineModel();
    await calls[calls.length - 1]![0]!.onBeforeCreate(timeline);

    expect(
      String(
        (timeline as unknown as Record<string, unknown>)[kind.stateIdField],
      ),
    ).toBe(ACKNOWLEDGED);
  });
});
