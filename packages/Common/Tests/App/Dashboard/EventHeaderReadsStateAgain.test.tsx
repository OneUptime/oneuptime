import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", {
        "data-testid": "state-change-modal",
      });
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
 * THE HEADER READS THE RECORD'S STATE AGAIN WHEN THE PAGE SAYS IT CHANGED.
 *
 * An incident's or an alert's header reads its states and its state
 * timeline once, and again after its own state actions. Somebody else may
 * acknowledge the record meanwhile: the reader's Escalate dialog then
 * answers "Already acknowledged" (usePassOnPage's onRecordChanged), and the
 * header still offered Acknowledge for a record already taken (#4914). The
 * page bumps the header's refreshToken; the header reads the timeline again,
 * quietly - it stays on screen, and does not read the states again. A read
 * that fails keeps the header as it was, buttons and all: an error in its
 * place would take away a header that was fine.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const RECORD_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RESOLVED: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

const TITLE: string = "Checkout latency above 2s";
const START: Date = new Date("2026-09-14T18:00:00.000Z");

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
  element: (refreshToken: number) => ReactElement;
}

const KINDS: Array<HeaderKind> = [
  {
    noun: "incident",
    stateModel: IncidentState,
    timelineModel: IncidentStateTimeline,
    templateModel: IncidentNoteTemplate,
    stateIdField: "incidentStateId",
    acknowledgeId: "incident-acknowledge-btn",
    element: (refreshToken: number): ReactElement => {
      return (
        <ChangeIncidentState
          incidentId={new ObjectID(RECORD_ID)}
          eventNumber="INC-42"
          title={TITLE}
          eventStartsAt={START}
          refreshToken={refreshToken}
          onActionComplete={(): void => {}}
        />
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
    element: (refreshToken: number): ReactElement => {
      return (
        <ChangeAlertState
          alertId={new ObjectID(RECORD_ID)}
          eventNumber="ALR-12"
          title={TITLE}
          eventStartsAt={START}
          refreshToken={refreshToken}
          onActionComplete={(): void => {}}
        />
      );
    },
  },
];

// How many times each kind of list was read.
let reads: Record<string, number> = {};

// The record's path through its states, as the timeline answers now.
let path: Array<string> = [CREATED];

// Whether a read of the timeline fails now.
let isTimelineDown: boolean = false;

// The project's states, and the flag that marks each.
interface StateSpec {
  id: string;
  name: string;
  order: number;
  flag: "isCreatedState" | "isAcknowledgedState" | "isResolvedState";
}

const STATE_SPECS: Array<StateSpec> = [
  { id: CREATED, name: "Created", order: 1, flag: "isCreatedState" },
  {
    id: ACKNOWLEDGED,
    name: "Acknowledged",
    order: 2,
    flag: "isAcknowledgedState",
  },
  { id: RESOLVED, name: "Resolved", order: 3, flag: "isResolvedState" },
];

function respond(kind: HeaderKind): void {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === kind.stateModel) {
      reads["states"] = (reads["states"] || 0) + 1;

      return Promise.resolve(
        listResult(
          STATE_SPECS.map((spec: StateSpec): IncidentState | AlertState => {
            const state: IncidentState | AlertState = new kind.stateModel();
            state.id = new ObjectID(spec.id);
            state.name = spec.name;
            state.color = new Color("#6366f1");
            state.order = spec.order;
            state[spec.flag] = true;
            return state;
          }),
        ),
      );
    }

    if (request.modelType === kind.timelineModel) {
      reads["timeline"] = (reads["timeline"] || 0) + 1;

      /*
       * A read that fails is an async function that throws, not
       * Promise.reject: the header's imports load zone.js, whose patched
       * Promise reports a rejected one as unhandled although the header
       * catches it.
       */
      if (isTimelineDown) {
        return (async (): Promise<never> => {
          throw new Error("Network Error");
        })();
      }

      return Promise.resolve(
        listResult(
          path.map(
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

beforeEach(() => {
  reads = {};
  path = [CREATED];
  isTimelineDown = false;
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
  jest.restoreAllMocks();
});

describe.each(KINDS)("the $noun header", (kind: HeaderKind) => {
  test("reads the state again when the page bumps its refreshToken, and stops offering Acknowledge", async () => {
    respond(kind);

    const view: ReturnType<typeof render> = render(kind.element(0));
    await screen.findByRole("heading", { level: 2, name: TITLE });

    expect(document.getElementById(kind.acknowledgeId)).not.toBeNull();
    expect(reads).toEqual({ states: 1, timeline: 1 });

    // Somebody acknowledged it meanwhile.
    path = [CREATED, ACKNOWLEDGED];

    view.rerender(kind.element(1));

    // The header stays on screen while it reads.
    expect(
      screen.getByRole("heading", { level: 2, name: TITLE }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(document.getElementById(kind.acknowledgeId)).toBeNull();
    });

    // Only the timeline is read again: the states are as they were.
    expect(reads).toEqual({ states: 1, timeline: 2 });
  });

  test("a read again that fails keeps the header as it was, buttons and all - no error in its place", async () => {
    respond(kind);

    const view: ReturnType<typeof render> = render(kind.element(0));
    await screen.findByRole("heading", { level: 2, name: TITLE });
    expect(document.getElementById(kind.acknowledgeId)).not.toBeNull();

    isTimelineDown = true;
    view.rerender(kind.element(1));

    await waitFor(() => {
      expect(reads["timeline"]).toBe(2);
    });
    // Every promise the failed read set off has settled.
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(
      screen.getByRole("heading", { level: 2, name: TITLE }),
    ).toBeInTheDocument();
    expect(document.getElementById(kind.acknowledgeId)).not.toBeNull();
    expect(screen.queryByText("Network Error")).toBeNull();

    // The next bump reads it again, and the header follows.
    isTimelineDown = false;
    path = [CREATED, ACKNOWLEDGED];
    view.rerender(kind.element(2));

    await waitFor(() => {
      expect(document.getElementById(kind.acknowledgeId)).toBeNull();
    });
    expect(reads).toEqual({ states: 1, timeline: 3 });
  });

  test("a render with the same token reads nothing again", async () => {
    respond(kind);

    const view: ReturnType<typeof render> = render(kind.element(3));
    await screen.findByRole("heading", { level: 2, name: TITLE });

    view.rerender(kind.element(3));
    await act(async () => {
      await Promise.resolve();
    });

    expect(reads).toEqual({ states: 1, timeline: 1 });
  });
});
