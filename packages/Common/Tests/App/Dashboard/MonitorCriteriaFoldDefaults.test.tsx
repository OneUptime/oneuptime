import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import MonitorCriteriaElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

/*
 * Create Monitor's criteria step opened every default criteria at full
 * length - two of them for a website, filters, actions, an incident with a
 * Markdown editor - about six thousand pixels, before the one thing a new
 * website monitor needs: its URL. Those criteria are defaults that suit most
 * monitors, so Create Monitor now asks the list to fold each one to its
 * header (foldDefaultCriteria): the name, what it checks and what it does.
 *
 *   - a criteria made with Add Criteria opens, to be filled in;
 *   - a criteria that would not save as it stands opens, where its problem is;
 *   - pressing a header always wins;
 *   - folded, a criteria is out of sight of the keyboard and screen readers
 *     too, not only clipped to no height;
 *   - without the flag (a monitor's Criteria page, a template) every
 *     criteria still opens, as before.
 */

const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

// The criteria a new website monitor starts with.
function defaultWebsiteCriteria(): MonitorCriteria {
  return MonitorCriteria.getDefaultMonitorCriteria({
    monitorType: MonitorType.Website,
    monitorName: "Marketing site",
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
  });
}

// A criteria that cannot be saved: it declares an incident with no title.
function brokenCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 3000,
      },
    ],
    incidents: [
      {
        id: ObjectID.generate().toString(),
        title: "",
        description: "",
        incidentSeverityId: INCIDENT_SEVERITY_ID,
      },
    ],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: true,
    createAlerts: false,
    isEnabled: true,
    name: "Checkout is slow",
    description: "",
  };

  return instance;
}

interface RenderOptions {
  foldDefaultCriteria?: boolean | undefined;
  criteria?: MonitorCriteria | undefined;
}

function renderCriteria(options: RenderOptions = {}): void {
  const initial: MonitorCriteria = options.criteria || defaultWebsiteCriteria();

  const Wrapper: FunctionComponent = (): ReactElement => {
    const [value, setValue] = React.useState<MonitorCriteria>(initial);

    return (
      <MonitorCriteriaElement
        monitorType={MonitorType.Website}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={[]}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        value={value}
        foldDefaultCriteria={options.foldDefaultCriteria}
        onChange={(changed: MonitorCriteria) => {
          setValue(changed);
        }}
      />
    );
  };

  render(<Wrapper />);
}

function headers(): Array<HTMLElement> {
  return screen.getAllByTestId("monitor-criteria-header");
}

function toggleOf(header: HTMLElement): HTMLElement {
  const toggle: HTMLElement | undefined = within(header)
    .getAllByRole("button")
    .find((button: HTMLElement): boolean => {
      return button.hasAttribute("aria-expanded");
    });

  if (!toggle) {
    throw new Error("The criteria header has no open/close button.");
  }

  return toggle;
}

function bodies(): Array<HTMLElement> {
  return screen.getAllByTestId("monitor-criteria-body");
}

function expanded(): Array<string | null> {
  return headers().map((header: HTMLElement): string | null => {
    return toggleOf(header).getAttribute("aria-expanded");
  });
}

afterEach(() => {
  cleanup();
});

describe("a new monitor's default criteria", () => {
  test("start folded to their headers", () => {
    renderCriteria({ foldDefaultCriteria: true });

    expect(headers()).toHaveLength(2);
    expect(expanded()).toEqual(["false", "false"]);
  });

  test("still say what each one is and does while folded", () => {
    renderCriteria({ foldDefaultCriteria: true });

    const [offline, online] = headers() as [HTMLElement, HTMLElement];

    expect(offline).toHaveTextContent("Check if Marketing site is offline");
    expect(offline).toHaveTextContent("status change");
    expect(offline).toHaveTextContent("incidents");
    expect(online).toHaveTextContent("Check if Marketing site is online");
    expect(online).toHaveTextContent("status change");
  });

  /*
   * A height of zero alone still let Tab walk into every field of a folded
   * criteria; invisible takes them out of the tab order and away from
   * screen readers. relative keeps their absolutely placed pieces (screen
   * reader text, a picker's live region) inside the clip: left to the page,
   * they stretched it by the folded criteria's whole height.
   */
  test("are out of sight of the keyboard and screen readers while folded", () => {
    renderCriteria({ foldDefaultCriteria: true });

    for (const body of bodies()) {
      expect(body).toHaveClass("max-h-0", "invisible", "relative");
      expect(body).toHaveAttribute("aria-hidden", "true");
    }

    // Folded away, a criteria's fields are not offered to assistive technology.
    expect(
      screen.queryByRole("textbox", { name: /Criteria Name/ }),
    ).not.toBeInTheDocument();
  });

  test("open when their header is pressed, and fold again on a second press", () => {
    renderCriteria({ foldDefaultCriteria: true });

    const offlineToggle: HTMLElement = toggleOf(headers()[0]!);

    fireEvent.click(offlineToggle);

    expect(expanded()).toEqual(["true", "false"]);
    expect(bodies()[0]).not.toHaveClass("invisible");
    expect(bodies()[0]).toHaveAttribute("aria-hidden", "false");
    expect(bodies()[1]).toHaveClass("invisible");
    // Only the open criteria's fields are offered.
    expect(
      screen.getAllByRole("textbox", { name: /Criteria Name/ }),
    ).toHaveLength(1);

    fireEvent.click(offlineToggle);

    expect(expanded()).toEqual(["false", "false"]);
    expect(bodies()[0]).toHaveClass("invisible");
  });

  test("a criteria made with Add Criteria opens, to be filled in", () => {
    renderCriteria({ foldDefaultCriteria: true });

    fireEvent.click(screen.getByRole("button", { name: "Add Criteria" }));

    expect(headers()).toHaveLength(3);
    expect(expanded()).toEqual(["false", "false", "true"]);
  });

  test("a criteria made with Add Criteria can still be folded by hand", () => {
    renderCriteria({ foldDefaultCriteria: true });

    fireEvent.click(screen.getByRole("button", { name: "Add Criteria" }));
    fireEvent.click(toggleOf(headers()[2]!));

    expect(expanded()).toEqual(["false", "false", "false"]);
  });

  test("a criteria that would not save opens, where its problem is", () => {
    const criteria: MonitorCriteria = defaultWebsiteCriteria();

    criteria.data!.monitorCriteriaInstanceArray.push(brokenCriteria());

    expect(
      MonitorCriteriaInstance.getValidationError(
        criteria.data!.monitorCriteriaInstanceArray[2]!,
        MonitorType.Website,
      ),
    ).toBeTruthy();

    renderCriteria({ foldDefaultCriteria: true, criteria });

    expect(expanded()).toEqual(["false", "false", "true"]);
  });
});

describe("criteria anywhere else (a monitor's Criteria page, a template)", () => {
  test("every criteria opens, as before", () => {
    renderCriteria();

    expect(expanded()).toEqual(["true", "true"]);

    for (const body of bodies()) {
      expect(body).toHaveClass("max-h-[5000px]");
      expect(body).not.toHaveClass("invisible");
      expect(body).toHaveAttribute("aria-hidden", "false");
    }
  });

  test("folding one by hand hides it from the keyboard too", () => {
    renderCriteria();

    fireEvent.click(toggleOf(headers()[1]!));

    expect(expanded()).toEqual(["true", "false"]);
    expect(bodies()[1]).toHaveClass("max-h-0", "invisible", "relative");
    expect(bodies()[1]).toHaveAttribute("aria-hidden", "true");
  });
});
