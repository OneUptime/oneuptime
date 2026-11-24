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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import NotificationRuleConditionFormElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCondition";
import { VALUE_NOT_FOUND_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleConditionWords";
import NotificationRuleViewCondition from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewCondition";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A WORKSPACE RULE'S "MONITOR IS ANY OF ..." FINDS AND KEEPS EVERY MONITOR,
 * HOWEVER MANY THE PROJECT HAS (#10646).
 *
 * The rules and summaries pages read every monitor of the project - the
 * first 10,000 by name - and the condition offered those as static options;
 * a rule's card named its monitors from the same list. A monitor whose name
 * sorts past the 10,000th ("WB1500KSK02") could not be picked, and one a
 * rule held read "No longer in this project".
 *
 * The condition searches the server now (MonitorConditionPicker), never
 * offers an archived monitor (#7582), and names what it holds by its ids:
 * archived ones marked, deleted ones in the card's words (#7807). The card
 * names the monitors the page read by their ids. ModelAPI answers from a
 * project faked whole (CappedListServer).
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const LATE_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000ab";
const ARCHIVED_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000ac";
const DELETED_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000dd";

const MONITORS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;
let onChange: MockFunction;

beforeEach(() => {
  server = new CappedListServer();

  server.add(
    Monitor,
    namesSortingFirst(MONITORS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Monitor, [
    { _id: LATE_MONITOR_ID, name: "WB1500KSK02", isArchived: false },
    { _id: OTHER_LATE_MONITOR_ID, name: "WB1500KSK03", isArchived: false },
    { _id: ARCHIVED_MONITOR_ID, name: "WB1500KSK09", isArchived: true },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );

  onChange = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const monitorsCondition: (ids: Array<string>) => NotificationRuleCondition = (
  ids: Array<string>,
): NotificationRuleCondition => {
  return {
    checkOn: NotificationRuleConditionCheckOn.Monitors,
    conditionType: ConditionType.ContainsAny,
    value: ids,
  };
};

async function renderCondition(ids: Array<string>): Promise<void> {
  await act(async () => {
    render(
      <ul>
        <NotificationRuleConditionFormElement
          initialValue={monitorsCondition(ids)}
          onChange={(value: NotificationRuleCondition) => {
            onChange(value);
          }}
          eventType={NotificationRuleEventType.Monitor}
          index={0}
          alertStates={[]}
          alertSeverities={[]}
          incidentSeverities={[]}
          incidentStates={[]}
          scheduledMaintenanceStates={[]}
          monitorStatus={[]}
        />
      </ul>,
    );
  });
}

function picker(): HTMLElement {
  return within(
    screen.getByTestId("notification-rule-condition-value-0"),
  ).getByRole("combobox");
}

function chips(): Array<string> {
  return within(screen.getByTestId("notification-rule-condition-value-0"))
    .queryAllByTestId("entity-dropdown-chip-label")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

// The condition's value as last reported.
function lastValue(): unknown {
  return (
    onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as
      | NotificationRuleCondition
      | undefined
  )?.value;
}

describe("the condition's picker", () => {
  test("names a monitor past the 10,000th that the condition holds, read by its id", async () => {
    await renderCondition([LATE_MONITOR_ID]);

    await waitFor(() => {
      expect(chips()).toEqual(["WB1500KSK02"]);
    });

    // Only the one held, by its id: never the project's monitors whole.
    for (const call of server.callsFor(Monitor)) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
    }
  });

  test("finds a monitor past the 10,000th by its name, and keeps the one held beside it", async () => {
    await renderCondition([LATE_MONITOR_ID]);

    await waitFor(() => {
      expect(chips()).toEqual(["WB1500KSK02"]);
    });

    await act(async () => {
      fireEvent.focus(picker());
      fireEvent.change(picker(), { target: { value: "WB1500KSK0" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB1500KSK03/,
    });

    // Asked of the server, by name, never offering an archived monitor.
    const search: Record<string, unknown> | undefined = server
      .callsFor(Monitor)
      .map((call: { query: Record<string, unknown> }) => {
        return call.query;
      })
      .find((query: Record<string, unknown>): boolean => {
        return query["name"] instanceof Search;
      });

    expect((search?.["name"] as Search<string>).toString()).toBe("WB1500KSK0");
    expect(search?.["isArchived"]).toBe(false);
    expect(
      screen.queryByRole("option", { name: /WB1500KSK09/ }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(option);
    });

    expect(lastValue()).toEqual([LATE_MONITOR_ID, OTHER_LATE_MONITOR_ID]);
    expect(chips()).toEqual(["WB1500KSK02", "WB1500KSK03"]);
  });

  test("an archived monitor the condition holds stays, marked Archived", async () => {
    await renderCondition([ARCHIVED_MONITOR_ID]);

    await waitFor(() => {
      expect(chips()).toEqual(["WB1500KSK09"]);
    });
    expect(
      within(
        screen.getByTestId("notification-rule-condition-value-0"),
      ).getByTestId("entity-dropdown-archived-tag"),
    ).toBeInTheDocument();
  });

  test("a monitor deleted since reads No longer in this project, kept until it is taken out", async () => {
    await renderCondition([DELETED_MONITOR_ID, LATE_MONITOR_ID]);

    await waitFor(() => {
      expect(chips()).toEqual([VALUE_NOT_FOUND_NAME, "WB1500KSK02"]);
    });

    // Drawing it changes nothing: the rule keeps it as it was saved.
    expect(
      (onChange.mock.calls as Array<[NotificationRuleCondition]>).every(
        ([value]: [NotificationRuleCondition]): boolean => {
          return (
            JSON.stringify(value.value) ===
            JSON.stringify([DELETED_MONITOR_ID, LATE_MONITOR_ID])
          );
        },
      ),
    ).toBe(true);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Remove ${VALUE_NOT_FOUND_NAME}`,
        }),
      );
    });

    expect(lastValue()).toEqual([LATE_MONITOR_ID]);
  });
});

describe("the rule's card", () => {
  const renderCard: (monitors: Array<Monitor> | undefined) => void = (
    monitors: Array<Monitor> | undefined,
  ): void => {
    render(
      <MemoryRouter>
        <NotificationRuleViewCondition
          notificationRuleCondition={monitorsCondition([
            LATE_MONITOR_ID,
            DELETED_MONITOR_ID,
          ])}
          monitors={monitors}
          labels={[]}
          alertStates={[]}
          alertSeverities={[]}
          incidentSeverities={[]}
          incidentStates={[]}
          scheduledMaintenanceStates={[]}
          monitorStatus={[]}
        />
      </MemoryRouter>,
    );
  };

  const named: (id: string, name: string) => Monitor = (
    id: string,
    name: string,
  ): Monitor => {
    const monitor: Monitor = new Monitor();
    monitor._id = id;
    monitor.name = name;
    return monitor;
  };

  test("names the rule's monitor past the 10,000th from the monitors read by their ids", () => {
    renderCard([named(LATE_MONITOR_ID, "WB1500KSK02")]);

    expect(screen.getByText("WB1500KSK02")).toBeInTheDocument();
    // The one the read did not find is gone, said in the card's words.
    expect(
      screen.getByTestId("notification-rule-condition-value-not-found"),
    ).toHaveTextContent(VALUE_NOT_FOUND_NAME);
  });

  test("while the monitors are being read, no monitor is said to be gone", () => {
    renderCard(undefined);

    expect(
      screen.queryByTestId("notification-rule-condition-value-not-found"),
    ).not.toBeInTheDocument();
  });
});
