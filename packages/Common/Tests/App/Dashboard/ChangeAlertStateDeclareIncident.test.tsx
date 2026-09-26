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

/*
 * The state-change modal is a full model form with its own API traffic. The
 * stub records its props and renders the title, so a test can tell whether a
 * click opened it.
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

import ChangeAlertState from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/ChangeState";
import ChangeIncidentState from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState";
import AlertNoteTemplate from "../../../Models/DatabaseModels/AlertNoteTemplate";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

/*
 * "Declare Incident" in the alert header (the real ChangeAlertState, against
 * a fake API). It sits in the "Event actions" row after Acknowledge and
 * Resolve, in the neutral look so the state action stays the one primary
 * button, and it stays there once the alert is resolved - declaring after
 * the fact is allowed everywhere else too. It is gated on permissions alone
 * (Incident create, then IncidentAlert create), so it adds no request to the
 * header's three reads. The incident header never gets one.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const ALERT_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: string = "33333333-3333-4333-8333-333333333333";
const CREATED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RESOLVED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const DECLARE_ID: string = "alert-declare-incident-btn";
const DECLARE_WRAPPER_TEST_ID: string = `${DECLARE_ID}-disabled-wrapper`;
const ACKNOWLEDGE_ID: string = "alert-acknowledge-btn";
const RESOLVE_ID: string = "alert-resolve-btn";
const TITLE: string = "Checkout latency above 2s";

const CREATE_PAGE_URL: string = `/dashboard/${PROJECT_ID}/incidents/create?alertIds=${ALERT_ID}`;

const INCIDENT_CREATE_REASON: string =
  "You do not have permission to create this Incident. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident.";

const INCIDENT_ALERT_CREATE_REASON: string =
  "You do not have permission to create this Incident Alert. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Alert Admin, Alert Member, Create Incident Alert.";

const START: Date = new Date("2026-09-14T18:00:00.000Z");

type StageName = "created" | "acknowledged" | "resolved";

const STAGE_STATE_IDS: Record<StageName, Array<string>> = {
  created: [CREATED_STATE_ID],
  acknowledged: [CREATED_STATE_ID, ACKNOWLEDGED_STATE_ID],
  resolved: [CREATED_STATE_ID, ACKNOWLEDGED_STATE_ID, RESOLVED_STATE_ID],
};

interface StateSpec {
  id: string;
  name: string;
  color: string;
  flag: "isCreatedState" | "isAcknowledgedState" | "isResolvedState";
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
    id: RESOLVED_STATE_ID,
    name: "Resolved",
    color: "#10b981",
    flag: "isResolvedState",
  },
];

type BuildAlertStatesFunction = () => Array<AlertState>;

const buildAlertStates: BuildAlertStatesFunction = (): Array<AlertState> => {
  return STATE_SPECS.map((spec: StateSpec): AlertState => {
    const state: AlertState = new AlertState();
    state.id = new ObjectID(spec.id);
    state.name = spec.name;
    state.color = new Color(spec.color);
    state[spec.flag] = true;
    return state;
  });
};

type BuildAlertTimelinesFunction = (
  stage: StageName,
) => Array<AlertStateTimeline>;

const buildAlertTimelines: BuildAlertTimelinesFunction = (
  stage: StageName,
): Array<AlertStateTimeline> => {
  return STAGE_STATE_IDS[stage].map(
    (stateId: string, index: number): AlertStateTimeline => {
      const timeline: AlertStateTimeline = new AlertStateTimeline();
      timeline.alertStateId = new ObjectID(stateId);
      timeline.startsAt = new Date(START.getTime() + index * 10 * 60 * 1000);
      return timeline;
    },
  );
};

type BuildIncidentStatesFunction = () => Array<IncidentState>;

const buildIncidentStates: BuildIncidentStatesFunction =
  (): Array<IncidentState> => {
    return STATE_SPECS.map((spec: StateSpec): IncidentState => {
      const state: IncidentState = new IncidentState();
      state.id = new ObjectID(spec.id);
      state.name = spec.name;
      state.color = new Color(spec.color);
      state[spec.flag] = true;
      return state;
    });
  };

type BuildIncidentTimelinesFunction = (
  stage: StageName,
) => Array<IncidentStateTimeline>;

const buildIncidentTimelines: BuildIncidentTimelinesFunction = (
  stage: StageName,
): Array<IncidentStateTimeline> => {
  return STAGE_STATE_IDS[stage].map(
    (stateId: string, index: number): IncidentStateTimeline => {
      const timeline: IncidentStateTimeline = new IncidentStateTimeline();
      timeline.incidentStateId = new ObjectID(stateId);
      timeline.startsAt = new Date(START.getTime() + index * 10 * 60 * 1000);
      return timeline;
    },
  );
};

interface ListResultShape {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
}

type ListResultFunction = (data: Array<unknown>) => ListResultShape;

const listResult: ListResultFunction = (
  data: Array<unknown>,
): ListResultShape => {
  return { data: data, count: data.length, skip: 0, limit: 99 };
};

/*
 * Read at call time, so a test can move the alert on (acknowledge it) and
 * the header's timeline re-read sees the new stage.
 */
let alertStage: StageName = "created";
let permissionsForTest: Array<Permission> = [];
let navigateSpy: ReturnType<typeof jest.spyOn>;

interface AlertApiOptions {
  statesFail?: boolean | undefined;
}

/*
 * A call that throws from inside rather than a promise that is already
 * rejected: zone.js sees an eagerly rejected promise before the header's
 * catch is attached and prints its stack on every run.
 */
type FailWithFunction = (message: string) => Promise<never>;

const failWith: FailWithFunction = async (message: string): Promise<never> => {
  throw new Error(message);
};

type RespondForAlertFunction = (options?: AlertApiOptions) => void;

const respondForAlert: RespondForAlertFunction = (
  options?: AlertApiOptions,
): void => {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === AlertState) {
      if (options?.statesFail) {
        return failWith("States are unavailable");
      }

      return Promise.resolve(listResult(buildAlertStates()));
    }

    if (request.modelType === AlertStateTimeline) {
      return Promise.resolve(listResult(buildAlertTimelines(alertStage)));
    }

    if (request.modelType === AlertNoteTemplate) {
      return Promise.resolve(listResult([]));
    }

    return Promise.reject(new Error("Unexpected list request"));
  });
};

type RespondForIncidentFunction = (stage: StageName) => void;

const respondForIncident: RespondForIncidentFunction = (
  stage: StageName,
): void => {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentState) {
      return Promise.resolve(listResult(buildIncidentStates()));
    }

    if (request.modelType === IncidentStateTimeline) {
      return Promise.resolve(listResult(buildIncidentTimelines(stage)));
    }

    if (request.modelType === IncidentNoteTemplate) {
      return Promise.resolve(listResult([]));
    }

    return Promise.reject(new Error("Unexpected list request"));
  });
};

type RenderAlertHeaderFunction = (onActionComplete?: () => void) => void;

const renderAlertHeader: RenderAlertHeaderFunction = (
  onActionComplete?: () => void,
): void => {
  render(
    <ChangeAlertState
      alertId={new ObjectID(ALERT_ID)}
      eventNumber="ALR-12"
      title={TITLE}
      eventStartsAt={START}
      onActionComplete={onActionComplete || ((): void => {})}
    />,
  );
};

type RenderIncidentHeaderFunction = () => void;

const renderIncidentHeader: RenderIncidentHeaderFunction = (): void => {
  render(
    <ChangeIncidentState
      incidentId={new ObjectID(INCIDENT_ID)}
      eventNumber="INC-42"
      title={TITLE}
      eventStartsAt={START}
      onActionComplete={(): void => {}}
    />,
  );
};

type WaitForHeaderFunction = () => Promise<HTMLElement>;

const waitForHeader: WaitForHeaderFunction = async (): Promise<HTMLElement> => {
  return screen.findByRole("heading", { level: 2, name: TITLE });
};

type GetActionGroupFunction = () => HTMLElement;

const getActionGroup: GetActionGroupFunction = (): HTMLElement => {
  return screen.getByRole("group", { name: "Event actions" });
};

type ActionIdsFunction = () => Array<string>;

// The ids of every button in the header's action row, in DOM order.
const actionIds: ActionIdsFunction = (): Array<string> => {
  return within(getActionGroup())
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return button.id;
    });
};

type GetDeclareButtonFunction = () => HTMLElement;

const getDeclareButton: GetDeclareButtonFunction = (): HTMLElement => {
  const button: HTMLElement | null = document.getElementById(DECLARE_ID);

  if (!button) {
    throw new Error("The Declare Incident button is not rendered.");
  }

  return button;
};

type RequestedModelsFunction = () => Array<unknown>;

const requestedModels: RequestedModelsFunction = (): Array<unknown> => {
  return getListMock.mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as { modelType: unknown }).modelType;
  });
};

beforeEach(() => {
  alertStage = "created";
  permissionsForTest = [Permission.ProjectMember];
  PermissionGate.clearPermissionPropsCache();

  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);

  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissionsForTest;
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  modelFormModalMock.mockReset();
  jest.restoreAllMocks();
});

describe("ChangeAlertState Declare Incident button", () => {
  describe("placement in each alert state", () => {
    test.each([
      ["created", [ACKNOWLEDGE_ID, RESOLVE_ID, DECLARE_ID]],
      ["acknowledged", [RESOLVE_ID, DECLARE_ID]],
      ["resolved", [DECLARE_ID]],
    ])(
      "is offered last in the %s state",
      async (stage: string, expectedIds: Array<string>) => {
        alertStage = stage as StageName;
        respondForAlert();

        renderAlertHeader();

        await waitForHeader();

        expect(actionIds()).toEqual(expectedIds);

        const declare: HTMLElement = getDeclareButton();

        expect(declare.tagName).toBe("BUTTON");
        expect(declare).toHaveAttribute("type", "button");
        expect(declare).toHaveTextContent("Declare Incident");
        expect(declare).toHaveAttribute("title", "Declare Incident");
        expect(declare).toBeEnabled();
        expect(declare.querySelector("svg")).not.toBeNull();
        expect(screen.queryByTestId(DECLARE_WRAPPER_TEST_ID)).toBeNull();
      },
    );

    test.each([
      ["created", ACKNOWLEDGE_ID],
      ["acknowledged", RESOLVE_ID],
    ])(
      "leaves the %s state's own action as the one primary button",
      async (stage: string, primaryId: string) => {
        alertStage = stage as StageName;
        respondForAlert();

        renderAlertHeader();

        await waitForHeader();

        const declare: HTMLElement = getDeclareButton();
        const primaryIds: Array<string> = within(getActionGroup())
          .getAllByRole("button")
          .filter((button: HTMLElement): boolean => {
            return button.classList.contains("bg-indigo-600");
          })
          .map((button: HTMLElement): string => {
            return button.id;
          });

        expect(primaryIds).toEqual([primaryId]);
        expect(declare).toHaveClass(
          "h-9",
          "border-gray-300",
          "bg-white",
          "text-gray-700",
        );
        expect(declare).not.toHaveClass("bg-indigo-600", "text-white");
      },
    );

    test("is the only control on a resolved alert, with no More actions menu", async () => {
      alertStage = "resolved";
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      expect(within(getActionGroup()).getAllByRole("button")).toEqual([
        getDeclareButton(),
      ]);
      expect(
        screen.queryByRole("button", { name: "More actions" }),
      ).not.toBeInTheDocument();
      expect(document.getElementById(ACKNOWLEDGE_ID)).toBeNull();
      expect(document.getElementById(RESOLVE_ID)).toBeNull();
    });
  });

  describe("clicking it", () => {
    test.each(["created", "acknowledged", "resolved"])(
      "opens the create-incident page for this alert from the %s state",
      async (stage: string) => {
        alertStage = stage as StageName;
        respondForAlert();

        renderAlertHeader();

        await waitForHeader();

        fireEvent.click(getDeclareButton());

        expect(navigateSpy).toHaveBeenCalledTimes(1);

        const call: Array<unknown> = navigateSpy.mock
          .calls[0] as Array<unknown>;

        expect(call[0]).toBeInstanceOf(Route);
        expect((call[0] as Route).toString()).toBe(CREATE_PAGE_URL);
      },
    );

    test("does not open the state-change modal or report a state change", async () => {
      respondForAlert();

      const onActionComplete: MockFunction = getJestMockFunction();

      renderAlertHeader(onActionComplete);

      await waitForHeader();

      const listCallsBeforeClick: number = getListMock.mock.calls.length;

      fireEvent.click(getDeclareButton());

      expect(modelFormModalMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("state-change-modal")).toBeNull();
      expect(onActionComplete).not.toHaveBeenCalled();
      // Nothing is read or reloaded: it is a navigation.
      expect(getListMock.mock.calls.length).toBe(listCallsBeforeClick);
      expect(screen.queryByTestId("alert-state-placeholder")).toBeNull();
    });

    test("leaves Acknowledge opening its own modal", async () => {
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      fireEvent.click(document.getElementById(ACKNOWLEDGE_ID)!);

      expect(screen.getByTestId("state-change-modal")).toHaveTextContent(
        "Acknowledge Alert / Acknowledge",
      );
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });

  test("stays in the row, after Resolve, once the alert is acknowledged from the header", async () => {
    respondForAlert();

    const onActionComplete: MockFunction = getJestMockFunction();

    renderAlertHeader(onActionComplete);

    await waitForHeader();

    expect(actionIds()).toEqual([ACKNOWLEDGE_ID, RESOLVE_ID, DECLARE_ID]);

    fireEvent.click(document.getElementById(ACKNOWLEDGE_ID)!);

    const modalProps: { onSuccess: () => Promise<void> } = modelFormModalMock
      .mock.calls[modelFormModalMock.mock.calls.length - 1]![0] as {
      onSuccess: () => Promise<void>;
    };

    alertStage = "acknowledged";

    await act(async () => {
      await modalProps.onSuccess();
    });

    expect(onActionComplete).toHaveBeenCalledTimes(1);
    expect(actionIds()).toEqual([RESOLVE_ID, DECLARE_ID]);
    expect(getDeclareButton()).toBeEnabled();
  });

  describe("permissions", () => {
    test.each([
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Admin", [Permission.ProjectAdmin]],
      ["Project Member", [Permission.ProjectMember]],
      [
        "Alert Member + Create Incident",
        [Permission.AlertMember, Permission.CreateProjectIncident],
      ],
    ])(
      "is enabled for %s",
      async (_label: string, permissions: Array<Permission>) => {
        permissionsForTest = permissions;
        respondForAlert();

        renderAlertHeader();

        await waitForHeader();

        expect(getDeclareButton()).toBeEnabled();
        expect(screen.queryByTestId(DECLARE_WRAPPER_TEST_ID)).toBeNull();

        fireEvent.click(getDeclareButton());

        expect(navigateSpy).toHaveBeenCalledTimes(1);
      },
    );

    test("is locked for a viewer, saying which Incident permission is missing", async () => {
      permissionsForTest = [Permission.Viewer];
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      const wrapper: HTMLElement = screen.getByTestId(DECLARE_WRAPPER_TEST_ID);
      const declare: HTMLElement = getDeclareButton();

      // Still in its place in the row.
      expect(actionIds()).toEqual([ACKNOWLEDGE_ID, RESOLVE_ID, DECLARE_ID]);
      expect(wrapper).toHaveAttribute("tabindex", "0");
      expect(declare.parentElement).toBe(wrapper);
      expect(wrapper.parentElement).toBe(getActionGroup());
      expect(declare).toBeDisabled();
      expect(declare).toHaveAttribute("aria-disabled", "true");
      expect(declare).toHaveClass("pointer-events-none");
      expect(declare).not.toHaveAttribute("title");

      fireEvent.mouseEnter(wrapper);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        INCIDENT_CREATE_REASON,
      );

      fireEvent.click(wrapper);
      fireEvent.click(declare);

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(modelFormModalMock).not.toHaveBeenCalled();
      // The state actions are not gated by this button's permissions.
      expect(document.getElementById(ACKNOWLEDGE_ID)).toBeEnabled();
      expect(document.getElementById(RESOLVE_ID)).toBeEnabled();
    });

    test("is locked for an alert member, saying which Incident permission is missing", async () => {
      permissionsForTest = [Permission.AlertMember];
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      expect(getDeclareButton()).toBeDisabled();

      fireEvent.mouseEnter(screen.getByTestId(DECLARE_WRAPPER_TEST_ID));

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        INCIDENT_CREATE_REASON,
      );
    });

    test("is locked for someone who may create incidents but not link alerts", async () => {
      permissionsForTest = [Permission.CreateProjectIncident];
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      const declare: HTMLElement = getDeclareButton();

      expect(declare).toBeDisabled();

      fireEvent.focus(screen.getByTestId(DECLARE_WRAPPER_TEST_ID));

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        INCIDENT_ALERT_CREATE_REASON,
      );

      fireEvent.click(declare);

      expect(navigateSpy).not.toHaveBeenCalled();
    });

    test("stays locked, and explained, on a resolved alert", async () => {
      alertStage = "resolved";
      permissionsForTest = [Permission.Viewer];
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      expect(actionIds()).toEqual([DECLARE_ID]);
      expect(getDeclareButton()).toBeDisabled();
      expect(screen.getByTestId(DECLARE_WRAPPER_TEST_ID)).toBeInTheDocument();
    });

    test("is not rendered before the permission snapshot has loaded", async () => {
      permissionsForTest = [];
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      expect(document.getElementById(DECLARE_ID)).toBeNull();
      expect(screen.queryByTestId(DECLARE_WRAPPER_TEST_ID)).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Declare Incident" }),
      ).not.toBeInTheDocument();
      // The state actions are unaffected.
      expect(actionIds()).toEqual([ACKNOWLEDGE_ID, RESOLVE_ID]);
    });

    test("leaves a resolved alert with no buttons before the snapshot has loaded", async () => {
      alertStage = "resolved";
      permissionsForTest = [];
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      expect(within(getActionGroup()).queryAllByRole("button")).toEqual([]);
    });

    test("is enabled for a master admin, even with an empty snapshot", async () => {
      permissionsForTest = [];
      jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      expect(actionIds()).toEqual([ACKNOWLEDGE_ID, RESOLVE_ID, DECLARE_ID]);
      expect(getDeclareButton()).toBeEnabled();

      fireEvent.click(getDeclareButton());

      expect((navigateSpy.mock.calls[0]![0] as Route).toString()).toBe(
        CREATE_PAGE_URL,
      );
    });
  });

  describe("requests", () => {
    test.each([
      ["a project member", [Permission.ProjectMember]],
      ["a viewer", [Permission.Viewer]],
      ["an empty snapshot", []],
    ])(
      "adds no request for %s: still exactly the three header reads",
      async (_label: string, permissions: Array<Permission>) => {
        permissionsForTest = permissions;
        respondForAlert();

        renderAlertHeader();

        await waitForHeader();

        expect(getListMock).toHaveBeenCalledTimes(3);
        expect(requestedModels()).toEqual(
          expect.arrayContaining([
            AlertNoteTemplate,
            AlertState,
            AlertStateTimeline,
          ]),
        );
      },
    );

    test("issues the same three reads on a resolved alert", async () => {
      alertStage = "resolved";
      respondForAlert();

      renderAlertHeader();

      await waitForHeader();

      expect(getDeclareButton()).toBeEnabled();
      expect(getListMock).toHaveBeenCalledTimes(3);
      expect(requestedModels()).toEqual(
        expect.arrayContaining([
          AlertNoteTemplate,
          AlertState,
          AlertStateTimeline,
        ]),
      );
    });
  });

  describe("loading and errors", () => {
    test("the placeholder holds room for three buttons", () => {
      getListMock.mockImplementation(() => {
        return new Promise<never>(() => {
          // never settles: the header stays loading
        });
      });

      renderAlertHeader();

      const placeholder: HTMLElement = screen.getByTestId(
        "alert-state-placeholder",
      );
      const buttonSkeletons: Array<Element> = Array.from(
        placeholder.querySelectorAll(".h-9.rounded-md"),
      );

      expect(buttonSkeletons).toHaveLength(3);

      const row: Element = buttonSkeletons[0]!.parentElement as Element;

      expect(row).toHaveClass("flex", "gap-2");
      expect(Array.from(row.children)).toEqual(buttonSkeletons);
      expect(buttonSkeletons[0]).toHaveClass("w-28");
      expect(buttonSkeletons[1]).toHaveClass("w-24");
      expect(buttonSkeletons[2]).toHaveClass("w-36");
      // Skeletons only: no real button until the header has loaded.
      expect(document.getElementById(DECLARE_ID)).toBeNull();
      expect(within(placeholder).queryAllByRole("button")).toEqual([]);
    });

    test("is not offered while the header shows a load error", async () => {
      respondForAlert({ statesFail: true });

      renderAlertHeader();

      expect(
        await screen.findByText("States are unavailable"),
      ).toBeInTheDocument();
      expect(document.getElementById(DECLARE_ID)).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });
});

describe("ChangeIncidentState header", () => {
  test.each([
    ["created", ["incident-acknowledge-btn", "incident-resolve-btn"]],
    ["acknowledged", ["incident-resolve-btn"]],
    ["resolved", []],
  ])(
    "never offers Declare Incident in the %s state",
    async (stage: string, expectedIds: Array<string>) => {
      respondForIncident(stage as StageName);

      renderIncidentHeader();

      await waitForHeader();

      expect(
        within(getActionGroup())
          .queryAllByRole("button")
          .map((button: HTMLElement): string => {
            return button.id;
          }),
      ).toEqual(expectedIds);
      expect(document.getElementById(DECLARE_ID)).toBeNull();
      expect(screen.queryByTestId(DECLARE_WRAPPER_TEST_ID)).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Declare Incident" }),
      ).not.toBeInTheDocument();
    },
  );

  test("never offers it to a master admin either", async () => {
    permissionsForTest = [Permission.ProjectOwner];
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    respondForIncident("resolved");

    renderIncidentHeader();

    await waitForHeader();

    expect(within(getActionGroup()).queryAllByRole("button")).toEqual([]);
    expect(screen.queryByText("Declare Incident")).toBeNull();
  });
});
