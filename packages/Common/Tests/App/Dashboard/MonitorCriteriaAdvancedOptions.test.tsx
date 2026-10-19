import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  hasAlertAdvancedOptions,
  hasIncidentAdvancedOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaAdvancedOptions";
import MonitorCriteriaAlertForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaAlertForm";
import MonitorCriteriaIncidentForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaIncidentForm";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  getByTextOutsideFoldedHeaders,
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * "Please always collapse the advanced section by default. Please do this for
 * entire project."
 *
 * A monitor rule's incident and alert each end in an "Advanced Options"
 * section (auto-resolve, status page visibility, privacy, remediation notes).
 * It opened whenever it "had options", and every default rule turns
 * auto-resolve on, so it was open on the Offline rule of every new monitor.
 * Now it opens only for a choice the user made, the same rule the SLO
 * burn-rate form follows: a false auto-resolve counts, a true one does not.
 */

afterEach(() => {
  cleanup();
});

// The rule every new Website monitor starts with when its site goes offline.
function defaultOfflineRule(): {
  incident: CriteriaIncident;
  alert: CriteriaAlert;
} {
  const rule: MonitorCriteriaInstance =
    MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
      monitorType: MonitorType.Website,
      monitorStatusId: ObjectID.generate(),
      incidentSeverityId: ObjectID.generate(),
      alertSeverityId: ObjectID.generate(),
      monitorName: "Storefront",
    });

  const incident: CriteriaIncident | undefined = rule.data?.incidents?.[0];
  const alert: CriteriaAlert | undefined = rule.data?.alerts?.[0];

  if (!incident || !alert) {
    throw new Error("The default Offline rule has no incident or alert.");
  }

  return { incident, alert };
}

function incident(overrides: Partial<CriteriaIncident>): CriteriaIncident {
  return {
    id: ObjectID.generate().toString(),
    title: "Storefront is offline",
    description: "Storefront is currently offline.",
    incidentSeverityId: undefined,
    ...overrides,
  };
}

function alert(overrides: Partial<CriteriaAlert>): CriteriaAlert {
  return {
    id: ObjectID.generate().toString(),
    title: "Storefront is offline",
    description: "Storefront is currently offline.",
    alertSeverityId: undefined,
    ...overrides,
  };
}

const DROPDOWNS: {
  onCallPolicyDropdownOptions: [];
  labelDropdownOptions: [];
  userDropdownOptions: [];
} = {
  onCallPolicyDropdownOptions: [],
  labelDropdownOptions: [],
  userDropdownOptions: [],
};

function renderIncidentForm(initialValue?: CriteriaIncident): void {
  render(
    <MonitorCriteriaIncidentForm
      initialValue={initialValue}
      incidentSeverityDropdownOptions={[]}
      {...DROPDOWNS}
    />,
  );
}

function renderAlertForm(initialValue?: CriteriaAlert): void {
  render(
    <MonitorCriteriaAlertForm
      initialValue={initialValue}
      alertSeverityDropdownOptions={[]}
      {...DROPDOWNS}
    />,
  );
}

function advancedOptions(): HTMLElement {
  return screen.getByRole("button", { name: "More fields" });
}

function advancedOptionsBody(): HTMLElement {
  const bodyId: string | null = advancedOptions().getAttribute("aria-controls");

  if (!bodyId) {
    throw new Error("More fields does not name the body it controls.");
  }

  return document.getElementById(bodyId)!;
}

describe("hasIncidentAdvancedOptions", () => {
  test("the default Offline rule's incident has nothing the user chose", () => {
    const { incident: offlineIncident } = defaultOfflineRule();

    // The templates turn auto-resolve on; that is the starting point.
    expect(offlineIncident.autoResolveIncident).toBe(true);
    expect(hasIncidentAdvancedOptions(offlineIncident)).toBe(false);
  });

  test("a new incident with nothing set has nothing", () => {
    expect(hasIncidentAdvancedOptions(incident({}))).toBe(false);
  });

  test.each([
    ["auto-resolve turned off", { autoResolveIncident: false }],
    ["remediation notes", { remediationNotes: "Restart the pod." }],
    ["hidden from status pages", { showIncidentOnStatusPage: false }],
    ["private", { isPrivate: true }],
  ])("counts %s", (_name: string, overrides: Partial<CriteriaIncident>) => {
    expect(hasIncidentAdvancedOptions(incident(overrides))).toBe(true);
  });

  test.each([
    ["auto-resolve on", { autoResolveIncident: true }],
    ["blank remediation notes", { remediationNotes: "  \n " }],
    ["shown on status pages", { showIncidentOnStatusPage: true }],
    ["not private", { isPrivate: false }],
  ])(
    "does not count %s, the way a new rule starts",
    (_name: string, overrides: Partial<CriteriaIncident>) => {
      expect(hasIncidentAdvancedOptions(incident(overrides))).toBe(false);
    },
  );
});

describe("hasAlertAdvancedOptions", () => {
  test("the default Offline rule's alert has nothing the user chose", () => {
    const { alert: offlineAlert } = defaultOfflineRule();

    expect(offlineAlert.autoResolveAlert).toBe(true);
    expect(hasAlertAdvancedOptions(offlineAlert)).toBe(false);
  });

  test.each([
    ["auto-resolve turned off", { autoResolveAlert: false }],
    ["remediation notes", { remediationNotes: "Check the queue." }],
    ["private", { isPrivate: true }],
  ])("counts %s", (_name: string, overrides: Partial<CriteriaAlert>) => {
    expect(hasAlertAdvancedOptions(alert(overrides))).toBe(true);
  });

  test.each([
    ["auto-resolve on", { autoResolveAlert: true }],
    ["nothing set", {}],
    ["blank remediation notes", { remediationNotes: " " }],
    ["not private", { isPrivate: false }],
  ])(
    "does not count %s",
    (_name: string, overrides: Partial<CriteriaAlert>) => {
      expect(hasAlertAdvancedOptions(alert(overrides))).toBe(false);
    },
  );
});

/*
 * The incident's and the alert's More fields (once "Advanced Options"):
 * folded on a new rule and on one being edited, like every More fields
 * section, and drawn like every one of them - one quiet line after the
 * rule's named folds, not a card. Folded, the line names the options
 * inside, and each one the user chose with what it is set to, a shade
 * darker - so the choice is never hidden, and the section does not open by
 * itself to show it. Only a choice that differs from what a new rule
 * starts with counts: every default rule turns auto-resolve on, so
 * auto-resolve off is the choice.
 */
describe("the incident's More fields", () => {
  test("starts folded on a new monitor's Offline rule, naming its options, none set", () => {
    renderIncidentForm(defaultOfflineRule().incident);

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
    expect(advancedOptionsBody()).toHaveClass("max-h-0", "invisible");
    expect(listedNames(advancedOptions())).toEqual([
      "Auto Resolve Incident",
      "Show Incident on Status Page",
      "Private Incident",
      "Remediation Notes",
    ]);
    expect(setChips(advancedOptions())).toEqual([]);
  });

  test("starts folded on an incident added by hand", () => {
    renderIncidentForm();

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
  });

  test.each([
    [
      "auto-resolve was turned off",
      { autoResolveIncident: false },
      "Auto Resolve Incident: Off",
    ],
    [
      "it has remediation notes",
      { remediationNotes: "Restart the pod." },
      "Remediation Notes",
    ],
    ["it is private", { isPrivate: true }, "Private Incident: On"],
    [
      "it is kept off status pages",
      { showIncidentOnStatusPage: false },
      "Show Incident on Status Page: Off",
    ],
  ])(
    "stays folded when %s, the choice a chip on its header",
    (_name: string, overrides: Partial<CriteriaIncident>, chip: string) => {
      renderIncidentForm(incident(overrides));

      expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
      expect(setChips(advancedOptions())).toEqual([chip]);
      // What is set is a shade darker than the names around it.
      expect(
        advancedOptions().querySelector(
          "[data-testid='folded-section-item'][data-item-set='true']",
        ),
      ).toHaveClass("font-medium", "text-gray-700");
      // A line has no icon tile, set or not.
      expect(
        advancedOptions().querySelector("[data-testid='folded-section-icon']"),
      ).toBeNull();
    },
  );

  /*
   * "Can we make this more subtle, this needs to be done across the project
   * for more fields. Takes up too much real estate right now." - the
   * maintainer. The rule's own folds (Description, On-Call, Incident Roles,
   * Ownership & Labels) are named for what they hold and stay cards; More
   * fields, after them, is the quiet line.
   */
  test("is one quiet line after the rule's named folds, which stay cards", () => {
    renderIncidentForm(defaultOfflineRule().incident);

    const moreFields: HTMLElement = screen.getByTestId(
      "criteria-incident-more-fields",
    );

    expect(moreFields).toHaveAttribute("data-variant", "line");
    expect(moreFields).toContainElement(advancedOptions());
    expect(advancedOptions()).toHaveTextContent(
      /^More fields\s*·\s*Auto Resolve Incident, Show Incident on Status Page, Private Incident, Remediation Notes$/,
    );

    const named: Array<string | null> = screen
      .getAllByTestId("folded-section")
      .map((fold: HTMLElement): string | null => {
        return fold.getAttribute("data-variant");
      });

    expect(named.length).toBeGreaterThanOrEqual(3);
    expect(new Set(named)).toEqual(new Set(["card"]));
  });

  test("opens on a click, and keeps its fields while folded", () => {
    renderIncidentForm(defaultOfflineRule().incident);

    // Mounted while folded, so a value typed earlier is not lost.
    expect(
      getByTextOutsideFoldedHeaders(document.body, "Auto Resolve Incident"),
    ).toBeInTheDocument();

    fireEvent.click(advancedOptions());

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "true");
    expect(advancedOptionsBody()).not.toHaveClass("invisible");
    expect(screen.getByText("Private Incident")).toBeInTheDocument();
    // Open, the header lists nothing: the options say it themselves.
    expect(listedNames(advancedOptions())).toEqual([]);
  });

  test("shows what was chosen as a chip once folded again", () => {
    renderIncidentForm(defaultOfflineRule().incident);

    fireEvent.click(advancedOptions());
    fireEvent.click(screen.getByText("Private Incident"));
    fireEvent.click(advancedOptions());

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advancedOptions())).toEqual(["Private Incident: On"]);
  });
});

describe("the alert's More fields", () => {
  test("starts folded on a new monitor's Offline rule, naming its options, none set", () => {
    renderAlertForm(defaultOfflineRule().alert);

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
    expect(advancedOptionsBody()).toHaveClass("max-h-0", "invisible");
    expect(listedNames(advancedOptions())).toEqual([
      "Auto Resolve Alert",
      "Private Alert",
      "Remediation Notes",
    ]);
    expect(setChips(advancedOptions())).toEqual([]);
  });

  test("starts folded on an alert added by hand", () => {
    renderAlertForm();

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
  });

  test("stays folded when auto-resolve was turned off, the choice said on its line", () => {
    renderAlertForm(alert({ autoResolveAlert: false }));

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advancedOptions())).toEqual(["Auto Resolve Alert: Off"]);
    expect(screen.getByTestId("criteria-alert-more-fields")).toHaveAttribute(
      "data-variant",
      "line",
    );
  });

  test("shows remediation notes as set, without their text", () => {
    renderAlertForm(alert({ remediationNotes: "Check the queue." }));

    expect(setChips(advancedOptions())).toEqual(["Remediation Notes"]);
    expect(hasSetChip(advancedOptions())).toBe(true);
    expect(advancedOptions()).not.toHaveTextContent("Check the queue.");
  });
});
