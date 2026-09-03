import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

import MonitorCriteriaElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria";
import MonitorCriteriaDuplicateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorCriteriaDuplicate";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * The criteria list, driven the way a user drives it.
 *
 * Two things about this list were the whole complaint about the monitor
 * form: every criteria opened expanded, so a monitor's two shipped
 * criteria buried everything under them; and a collapsed row said "3
 * filters | status change, incidents", which is how MUCH is hidden, not
 * WHICH criteria it is. Both are pinned here, along with the two actions
 * that used to require expanding a criteria first (delete) or refilling
 * the whole form (duplicate).
 */

const ONLINE_STATUS_ID: string = "11111111-1111-4111-8111-111111111111";
const OFFLINE_STATUS_ID: string = "22222222-2222-4222-8222-222222222222";

const MONITOR_STATUS_OPTIONS: Array<DropdownOption> = [
  { value: ONLINE_STATUS_ID, label: "Operational" },
  { value: OFFLINE_STATUS_ID, label: "Offline" },
];

function buildCriteriaInstance(data: {
  id: string;
  name: string;
  monitorStatusId?: string | undefined;
  isEnabled?: boolean | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: data.id,
    monitorStatusId: data.monitorStatusId
      ? new ObjectID(data.monitorStatusId)
      : undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        value: undefined,
      },
    ],
    incidents: [],
    alerts: [],
    name: data.name,
    description: `Description of ${data.name}`,
    changeMonitorStatus: Boolean(data.monitorStatusId),
    createAlerts: false,
    createIncidents: false,
    isEnabled: data.isEnabled ?? true,
  };

  return instance;
}

function buildCriteria(
  instances: Array<MonitorCriteriaInstance>,
): MonitorCriteria {
  return MonitorCriteria.fromJSON({
    _type: "MonitorCriteria",
    value: {
      monitorCriteriaInstanceArray: instances,
    },
  });
}

interface Harness {
  latest: () => MonitorCriteria;
}

/*
 * The real parent (MonitorStep) rebuilds MonitorCriteria from JSON on
 * every change and hands the new object straight back down, so the list
 * is re-rendered from its own output. Reproduced here, because the
 * collapse state has to survive that round trip.
 */
function renderList(
  initial: MonitorCriteria,
  monitorType?: MonitorType,
): Harness {
  let latest: MonitorCriteria = initial;

  const Wrapper: FunctionComponent = (): ReactElement => {
    const [value, setValue] = React.useState<MonitorCriteria>(initial);

    return (
      <MonitorCriteriaElement
        monitorType={monitorType || MonitorType.Website}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={MONITOR_STATUS_OPTIONS}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        teamDropdownOptions={[]}
        userDropdownOptions={[]}
        value={value}
        onChange={(newValue: MonitorCriteria) => {
          latest = newValue;
          setValue(newValue);
        }}
      />
    );
  };

  render(<Wrapper />);

  return {
    latest: (): MonitorCriteria => {
      return latest;
    },
  };
}

/**
 * The criteria's own form fields, which only exist while the row is
 * expanded. "Criteria Name" is the first field of MonitorCriteriaInstance.
 */
function expandedCriteriaCount(): number {
  return screen.queryAllByText("Criteria Name").length;
}

function twoCriteria(): MonitorCriteria {
  return buildCriteria([
    buildCriteriaInstance({
      id: "criteria-one",
      name: "Online Criteria",
      monitorStatusId: ONLINE_STATUS_ID,
    }),
    buildCriteriaInstance({
      id: "criteria-two",
      name: "Offline Criteria",
      monitorStatusId: OFFLINE_STATUS_ID,
    }),
  ]);
}

describe("Monitor criteria list", () => {
  afterEach(() => {
    cleanup();
  });

  describe("how much of the form is open on arrival", () => {
    test("a list of several criteria opens collapsed", () => {
      renderList(twoCriteria());

      expect(screen.getByText("Online Criteria")).toBeInTheDocument();
      expect(screen.getByText("Offline Criteria")).toBeInTheDocument();
      expect(expandedCriteriaCount()).toBe(0);
    });

    test("a single criteria opens expanded - there is nothing to scroll past", () => {
      renderList(
        buildCriteria([
          buildCriteriaInstance({ id: "only", name: "Only Criteria" }),
        ]),
      );

      expect(expandedCriteriaCount()).toBe(1);
    });

    test("clicking a collapsed row opens that criteria and only that one", () => {
      renderList(twoCriteria());

      fireEvent.click(screen.getByText("Online Criteria"));

      expect(expandedCriteriaCount()).toBe(1);
    });

    test("clicking an open row closes it again", () => {
      renderList(twoCriteria());

      fireEvent.click(screen.getByText("Online Criteria"));
      expect(expandedCriteriaCount()).toBe(1);

      fireEvent.click(screen.getByText("Online Criteria"));
      expect(expandedCriteriaCount()).toBe(0);
    });

    test("the header row is operable from the keyboard", () => {
      renderList(twoCriteria());

      const header: HTMLElement = screen
        .getByText("Online Criteria")
        .closest('[role="button"]') as HTMLElement;

      fireEvent.keyDown(header, { key: "Enter" });

      expect(expandedCriteriaCount()).toBe(1);
    });
  });

  describe("expand all / collapse all", () => {
    test("Expand all opens every criteria at once", () => {
      renderList(twoCriteria());

      fireEvent.click(screen.getByText("Expand all"));

      expect(expandedCriteriaCount()).toBe(2);
    });

    test("once everything is open the control offers to close it again", () => {
      renderList(twoCriteria());

      fireEvent.click(screen.getByText("Expand all"));
      expect(screen.getByText("Collapse all")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Collapse all"));
      expect(expandedCriteriaCount()).toBe(0);
    });

    test("a single criteria gets no expand-all control", () => {
      renderList(
        buildCriteria([
          buildCriteriaInstance({ id: "only", name: "Only Criteria" }),
        ]),
      );

      expect(screen.queryByText("Expand all")).not.toBeInTheDocument();
      expect(screen.queryByText("Collapse all")).not.toBeInTheDocument();
    });
  });

  describe("what a collapsed row says", () => {
    test("the row spells out what the criteria looks for and what it does", () => {
      renderList(twoCriteria());

      expect(
        screen.getByText("If Is Online is true → Status → Operational"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("If Is Online is true → Status → Offline"),
      ).toBeInTheDocument();
    });

    test("the summary is still there once the row is expanded", () => {
      // Otherwise the row's identity disappears the moment you open it.
      renderList(twoCriteria());

      fireEvent.click(screen.getByText("Online Criteria"));

      expect(
        screen.getByText("If Is Online is true → Status → Operational"),
      ).toBeInTheDocument();
    });

    test("a disabled criteria is marked as such without being opened", () => {
      renderList(
        buildCriteria([
          buildCriteriaInstance({ id: "one", name: "First" }),
          buildCriteriaInstance({
            id: "two",
            name: "Switched Off",
            isEnabled: false,
          }),
        ]),
      );

      expect(screen.getByText("Disabled")).toBeInTheDocument();
    });

    test("the list says how many criteria there are and how they are read", () => {
      renderList(twoCriteria());

      expect(screen.getByText("2 criteria")).toBeInTheDocument();
      expect(
        screen.getByText(/first criteria that matches wins/),
      ).toBeInTheDocument();
    });
  });

  describe("row actions", () => {
    test("a criteria can be deleted without expanding it first", () => {
      const harness: Harness = renderList(twoCriteria());

      fireEvent.click(screen.getByLabelText("Delete Offline Criteria"));

      const remaining: Array<MonitorCriteriaInstance> =
        harness.latest().data?.monitorCriteriaInstanceArray || [];

      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.data?.name).toBe("Online Criteria");
    });

    test("the last remaining criteria cannot be deleted", () => {
      const harness: Harness = renderList(
        buildCriteria([
          buildCriteriaInstance({ id: "only", name: "Only Criteria" }),
        ]),
      );

      fireEvent.click(screen.getByLabelText("Delete Only Criteria"));

      expect(
        screen.getByText("Cannot delete last remaining criteria."),
      ).toBeInTheDocument();
      expect(harness.latest().data?.monitorCriteriaInstanceArray).toHaveLength(
        1,
      );
    });

    test("duplicating a criteria puts the copy right after the original", () => {
      const harness: Harness = renderList(twoCriteria());

      fireEvent.click(screen.getByLabelText("Duplicate Online Criteria"));

      const instances: Array<MonitorCriteriaInstance> =
        harness.latest().data?.monitorCriteriaInstanceArray || [];

      expect(
        instances.map((instance: MonitorCriteriaInstance) => {
          return instance.data?.name;
        }),
      ).toEqual([
        "Online Criteria",
        `Online Criteria${MonitorCriteriaDuplicateUtil.COPY_SUFFIX}`,
        "Offline Criteria",
      ]);
    });

    test("the copy is opened, because it is what the user is about to edit", () => {
      renderList(twoCriteria());

      fireEvent.click(screen.getByLabelText("Duplicate Online Criteria"));

      expect(expandedCriteriaCount()).toBe(1);
      expect(
        screen.getByText(
          `Online Criteria${MonitorCriteriaDuplicateUtil.COPY_SUFFIX}`,
        ),
      ).toBeInTheDocument();
    });

    test("the row actions do not also toggle the row they sit on", () => {
      /*
       * They live inside the header, which is itself a click target.
       * Without stopPropagation, duplicating would silently collapse or
       * expand the row underneath the user's cursor.
       */
      renderList(twoCriteria());

      fireEvent.click(screen.getByLabelText("Duplicate Offline Criteria"));

      // Only the new copy is open - the row that was clicked stays closed.
      expect(expandedCriteriaCount()).toBe(1);
      expect(
        screen.getByText(
          `Offline Criteria${MonitorCriteriaDuplicateUtil.COPY_SUFFIX}`,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("adding criteria", () => {
    test("a newly added criteria opens even though the list defaults to collapsed", () => {
      renderList(twoCriteria());

      expect(expandedCriteriaCount()).toBe(0);

      fireEvent.click(screen.getByText("Add Criteria"));

      expect(expandedCriteriaCount()).toBe(1);
    });

    test("the new criteria is appended to the list", () => {
      const harness: Harness = renderList(twoCriteria());

      fireEvent.click(screen.getByText("Add Criteria"));

      expect(harness.latest().data?.monitorCriteriaInstanceArray).toHaveLength(
        3,
      );
    });

    test("the new criteria is seeded with a filter this monitor type can render", () => {
      /*
       * A Ping monitor has no "Is Online" check, which is what a bare
       * MonitorCriteriaInstance seeds. Regression guard for the default
       * that CriteriaFilterUtil supplies instead.
       */
      const harness: Harness = renderList(twoCriteria(), MonitorType.Ping);

      fireEvent.click(screen.getByText("Add Criteria"));

      const instances: Array<MonitorCriteriaInstance> =
        harness.latest().data?.monitorCriteriaInstanceArray || [];
      const added: MonitorCriteriaInstance | undefined = instances[2];

      expect(added?.data?.filters).toHaveLength(1);
      expect(added?.data?.filters?.[0]?.checkOn).toBeTruthy();
      expect(added?.data?.filters?.[0]?.filterType).toBeTruthy();
    });
  });

  describe("the evaluation order hint", () => {
    test("a metric monitor grouped per series is told every criteria runs", () => {
      const monitorStep: MonitorStep = new MonitorStep();
      monitorStep.setMetricMonitor({
        metricViewConfig: {
          queryConfigs: [
            {
              metricQueryData: {
                filterData: {},
                groupByAttributeKeys: ["host.name"],
              },
            },
          ],
          formulaConfigs: [],
        },
        rollingTime: undefined as never,
      });

      render(
        <MonitorCriteriaElement
          monitorType={MonitorType.Metrics}
          monitorStep={monitorStep}
          monitorStatusDropdownOptions={MONITOR_STATUS_OPTIONS}
          incidentSeverityDropdownOptions={[]}
          alertSeverityDropdownOptions={[]}
          onCallPolicyDropdownOptions={[]}
          labelDropdownOptions={[]}
          teamDropdownOptions={[]}
          userDropdownOptions={[]}
          value={twoCriteria()}
        />,
      );

      expect(screen.getByText(/Every criteria is checked/)).toBeInTheDocument();
    });
  });
});
