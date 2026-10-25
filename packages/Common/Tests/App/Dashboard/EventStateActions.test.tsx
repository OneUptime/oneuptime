import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { ReactElement } from "react";

/*
 * MOVE AN INCIDENT, AN ALERT, AN EPISODE OR A MAINTENANCE EVENT FROM ITS
 * LIST (EventView/useEventStateActions).
 *
 * "I dont see the button to assign to me, change priority, change status
 * here" - the maintainer. Each row's ⋯ menu now offers the moves the
 * record's page offers - Acknowledge and Resolve, or Mark as Ongoing and
 * Mark as Ended, and Change State - only when the row can make that move,
 * asking first in the record page's words. The move is a new row of the
 * record's state timeline, written once the record's state is read fresh:
 * a record that moved meanwhile is left alone, saying why. A private
 * incident takes a private note and tells no subscriber. The list reads its
 * rows again, and the side menu's counts follow.
 *
 * The real hook and dialog are rendered, with the API layer replaced.
 */

let permissionsForTest: Array<unknown> = [];

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

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

interface Created {
  modelName: string;
  row: Record<string, unknown>;
  miscDataProps: Record<string, unknown> | undefined;
}

const created: Array<Created> = [];
// What the server holds for each record now: its state and privacy.
let freshForTest: Record<string, Record<string, unknown>> = {};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getItem: async (request: {
        id: { toString: () => string };
      }): Promise<unknown> => {
        return freshForTest[request.id.toString()] || null;
      },
      create: async (request: {
        model: { tableName?: string | null } & Record<string, unknown>;
        miscDataProps?: Record<string, unknown>;
      }): Promise<unknown> => {
        const row: Record<string, unknown> = {};

        for (const key of [
          "incidentId",
          "incidentStateId",
          "scheduledMaintenanceId",
          "scheduledMaintenanceStateId",
          "projectId",
          "shouldStatusPageSubscribersBeNotified",
        ]) {
          if (request.model[key] !== undefined) {
            row[key] = String(request.model[key]);
          }
        }

        created.push({
          modelName: request.model.tableName || "",
          row: row,
          miscDataProps: request.miscDataProps,
        });

        return {};
      },
    },
  };
});

import useEventStateActions, {
  EventStateActionsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/useEventStateActions";
import {
  ALREADY_ACKNOWLEDGED,
  EventStateKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStateKinds";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { withRowActionContext } from "../../../UI/Components/ActionButton/RowActionContext";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "../../../UI/Components/SideMenu/CountModelSideMenuItem";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: string = "22222222-2222-4222-8222-222222222221";
const EVENT_ID: string = "22222222-2222-4222-8222-222222222222";

const IDENTIFIED: string = "a0000000-0000-4000-8000-000000000001";
const ACKNOWLEDGED: string = "a0000000-0000-4000-8000-000000000002";
const RESOLVED: string = "a0000000-0000-4000-8000-000000000004";
const POSTMORTEM: string = "a0000000-0000-4000-8000-000000000005";

const SCHEDULED: string = "b0000000-0000-4000-8000-000000000001";
const ONGOING: string = "b0000000-0000-4000-8000-000000000002";
const ENDED: string = "b0000000-0000-4000-8000-000000000003";

const incidentState: (
  id: string,
  name: string,
  order: number,
  flags?: Partial<IncidentState>,
) => IncidentState = (
  id: string,
  name: string,
  order: number,
  flags?: Partial<IncidentState>,
): IncidentState => {
  const state: IncidentState = new IncidentState();
  state._id = id;
  state.name = name;
  state.order = order;
  Object.assign(state, flags || {});

  return state;
};

// A project's incident states, as the incidents list reads them.
const INCIDENT_STATES: Array<IncidentState> = [
  incidentState(IDENTIFIED, "Identified", 1, { isCreatedState: true }),
  incidentState(ACKNOWLEDGED, "Acknowledged", 2, {
    isAcknowledgedState: true,
  }),
  incidentState(RESOLVED, "Resolved", 3, { isResolvedState: true }),
  incidentState(POSTMORTEM, "Postmortem", 4),
];

const maintenanceState: (
  id: string,
  name: string,
  order: number,
  flags: Partial<ScheduledMaintenanceState>,
) => ScheduledMaintenanceState = (
  id: string,
  name: string,
  order: number,
  flags: Partial<ScheduledMaintenanceState>,
): ScheduledMaintenanceState => {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = id;
  state.name = name;
  state.order = order;
  Object.assign(state, flags);

  return state;
};

const MAINTENANCE_STATES: Array<ScheduledMaintenanceState> = [
  maintenanceState(SCHEDULED, "Scheduled", 1, { isScheduledState: true }),
  maintenanceState(ONGOING, "Ongoing", 2, { isOngoingState: true }),
  maintenanceState(ENDED, "Ended", 3, { isEndedState: true }),
];

const stateLink: (id: string, name: string, order: number) => object = (
  id: string,
  name: string,
  order: number,
): object => {
  return { _id: id, name: name, order: order };
};

const incident: (data: {
  stateId: string;
  isPrivate?: boolean;
}) => Incident = (data: { stateId: string; isPrivate?: boolean }): Incident => {
  const state: IncidentState = INCIDENT_STATES.find(
    (candidate: IncidentState): boolean => {
      return candidate._id === data.stateId;
    },
  )!;
  const row: Incident = new Incident();
  row._id = INCIDENT_ID;
  row.title = "Checkout API down";
  row.currentIncidentState = stateLink(
    data.stateId,
    state.name!,
    state.order!,
  ) as IncidentState;

  if (data.isPrivate !== undefined) {
    row.isPrivate = data.isPrivate;
  }

  return row;
};

let refreshCount: number = 0;

function RowHarness<T extends BaseModel>(props: {
  kind: EventStateKind;
  states: Array<BaseModel>;
  item: T;
}): ReactElement {
  const { rowActions, modals }: EventStateActionsResult<T> =
    useEventStateActions<T>({ kind: props.kind, states: props.states });

  const view: ActionButtonSchema<T> = {
    title: "View",
    icon: IconProp.ChevronRight,
    buttonStyleType: ButtonStyleType.OUTLINE,
    onClick: (): void => {},
  };

  return (
    <>
      <RowActions<T>
        item={props.item}
        actionButtons={withRowActionContext<T>([view, ...rowActions], {
          refresh: () => {
            refreshCount++;
          },
        })}
      />
      {modals}
    </>
  );
}

const renderIncident: (item: Incident) => void = (item: Incident): void => {
  render(
    <RowHarness<Incident>
      kind={EventStateKind.Incident}
      states={INCIDENT_STATES}
      item={item}
    />,
  );
};

const menuItemNames: () => Array<string> = (): Array<string> => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));

  const names: Array<string> = within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });

  // Closed again, as a person would leave it.
  fireEvent.click(screen.getByTestId("row-actions-more-button"));

  return names;
};

const clickMenuItem: (name: string) => Promise<HTMLElement> = async (
  name: string,
): Promise<HTMLElement> => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", { name: name }),
  );

  return await screen.findByTestId("modal");
};

let sidebarRefreshes: number = 0;
const onSidebarRefresh: () => void = (): void => {
  sidebarRefreshes++;
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
  created.length = 0;
  freshForTest = {};
  refreshCount = 0;
  sidebarRefreshes = 0;
  window.addEventListener(REFRESH_SIDEBAR_COUNT_EVENT, onSidebarRefresh);
});

afterEach(() => {
  window.removeEventListener(REFRESH_SIDEBAR_COUNT_EVENT, onSidebarRefresh);
  cleanup();
});

jest.setTimeout(30000);

describe("which moves an incident's row offers", () => {
  test("a new incident: Acknowledge, Resolve and Change State", () => {
    renderIncident(incident({ stateId: IDENTIFIED }));

    expect(menuItemNames()).toEqual(["Acknowledge", "Resolve", "Change State"]);
  });

  test("an acknowledged one: Resolve and Change State", () => {
    renderIncident(incident({ stateId: ACKNOWLEDGED }));

    expect(menuItemNames()).toEqual(["Resolve", "Change State"]);
  });

  test("a resolved one: Change State, to the states after it", () => {
    renderIncident(incident({ stateId: RESOLVED }));

    expect(menuItemNames()).toEqual(["Change State"]);
  });

  test("the last state offers nothing to move to", () => {
    renderIncident(incident({ stateId: POSTMORTEM }));

    expect(screen.queryByTestId("row-actions-more-button")).toBeNull();
  });
});

describe("Acknowledge from an incident's row", () => {
  test("asks in the incident page's words, naming the incident, with the notify box", async () => {
    renderIncident(incident({ stateId: IDENTIFIED }));

    const modal: HTMLElement = await clickMenuItem("Acknowledge");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "Acknowledge Incident",
    );
    expect(modal).toHaveTextContent(
      "This records an acknowledgement on the incident timeline and stops any on-call escalation for this incident.",
    );
    expect(
      within(modal).getByTestId("form-modal-before-form"),
    ).toHaveTextContent("Checkout API down");
    expect(modal).toHaveTextContent("Notify Status Page Subscribers");
    expect(
      within(modal).getByRole("button", { name: "Add a public note" }),
    ).toBeInTheDocument();
    // The state is the move's own: nothing to pick.
    expect(within(modal).queryByText("Select State")).toBeNull();
    expect(
      within(modal).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Acknowledge");
  });

  test("moves the incident on its timeline, reads the list again, and the side menu's counts follow", async () => {
    freshForTest[INCIDENT_ID] = {
      currentIncidentState: stateLink(IDENTIFIED, "Identified", 1),
      isPrivate: false,
    };

    renderIncident(incident({ stateId: IDENTIFIED }));

    const modal: HTMLElement = await clickMenuItem("Acknowledge");

    await act(async () => {
      fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    expect(created).toEqual([
      {
        modelName: "IncidentStateTimeline",
        row: {
          incidentId: INCIDENT_ID,
          incidentStateId: ACKNOWLEDGED,
          projectId: PROJECT_ID,
          shouldStatusPageSubscribersBeNotified: "true",
        },
        miscDataProps: expect.anything() as unknown as Record<string, unknown>,
      },
    ]);
    expect(refreshCount).toBe(1);
    expect(sidebarRefreshes).toBe(1);
  });

  test("an incident acknowledged meanwhile is left alone, and the dialog says why", async () => {
    // The list still shows it new; the server has it resolved.
    freshForTest[INCIDENT_ID] = {
      currentIncidentState: stateLink(RESOLVED, "Resolved", 3),
      isPrivate: false,
    };

    renderIncident(incident({ stateId: IDENTIFIED }));

    const modal: HTMLElement = await clickMenuItem("Acknowledge");

    await act(async () => {
      fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toHaveTextContent(
        ALREADY_ACKNOWLEDGED,
      );
    });
    expect(created).toEqual([]);
    expect(refreshCount).toBe(0);
  });

  test("a private incident takes a private note and tells no subscriber", async () => {
    freshForTest[INCIDENT_ID] = {
      currentIncidentState: stateLink(IDENTIFIED, "Identified", 1),
      isPrivate: true,
    };

    renderIncident(incident({ stateId: IDENTIFIED, isPrivate: true }));

    const modal: HTMLElement = await clickMenuItem("Acknowledge");

    expect(modal).not.toHaveTextContent("Notify Status Page Subscribers");
    expect(
      within(modal).getByRole("button", { name: "Add a private note" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0]!.row["shouldStatusPageSubscribersBeNotified"]).toBe(
      "false",
    );
  });
});

describe("Change State from an incident's row", () => {
  test("names the incident and offers the states it may move to", async () => {
    renderIncident(incident({ stateId: ACKNOWLEDGED }));

    const modal: HTMLElement = await clickMenuItem("Change State");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "Change Incident State",
    );
    expect(modal).toHaveTextContent(
      "Pick the next state for Checkout API down.",
    );

    fireEvent.keyDown(await within(modal).findByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });

    expect(
      (await screen.findAllByRole("option")).map(
        (option: HTMLElement): string => {
          return (option.textContent || "").trim();
        },
      ),
    ).toEqual(["Resolved", "Postmortem"]);
  });
});

describe("a scheduled maintenance event's row", () => {
  const event: (stateId: string) => ScheduledMaintenance = (
    stateId: string,
  ): ScheduledMaintenance => {
    const state: ScheduledMaintenanceState = MAINTENANCE_STATES.find(
      (candidate: ScheduledMaintenanceState): boolean => {
        return candidate._id === stateId;
      },
    )!;
    const row: ScheduledMaintenance = new ScheduledMaintenance();
    row._id = EVENT_ID;
    row.title = "Database upgrade";
    row.currentScheduledMaintenanceState = stateLink(
      stateId,
      state.name!,
      state.order!,
    ) as ScheduledMaintenanceState;

    return row;
  };

  test("offers the event page's buttons, named after the project's states", () => {
    render(
      <RowHarness<ScheduledMaintenance>
        kind={EventStateKind.ScheduledMaintenance}
        states={MAINTENANCE_STATES}
        item={event(SCHEDULED)}
      />,
    );

    expect(menuItemNames()).toEqual([
      "Mark as Ongoing",
      "Mark as Ended",
      "Change State",
    ]);
  });

  test("an ongoing event is offered Mark as Ended alone of the two", () => {
    render(
      <RowHarness<ScheduledMaintenance>
        kind={EventStateKind.ScheduledMaintenance}
        states={MAINTENANCE_STATES}
        item={event(ONGOING)}
      />,
    );

    expect(menuItemNames()).toEqual(["Mark as Ended", "Change State"]);
  });
});

describe("permissions", () => {
  test("someone who may not move incidents finds the moves locked, saying which permission it takes", () => {
    permissionsForTest = [Permission.Viewer];

    renderIncident(incident({ stateId: IDENTIFIED }));

    fireEvent.click(screen.getByTestId("row-actions-more-button"));

    const acknowledge: HTMLElement = within(screen.getByRole("menu")).getByRole(
      "menuitem",
      { name: "Acknowledge" },
    );

    expect(acknowledge).toHaveAttribute("aria-disabled", "true");
    expect(
      document.getElementById(acknowledge.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("permission");

    fireEvent.click(acknowledge);

    expect(screen.queryByTestId("modal")).toBeNull();
  });
});
