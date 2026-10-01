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
  teamDropdownOptions: [];
  userDropdownOptions: [];
} = {
  onCallPolicyDropdownOptions: [],
  labelDropdownOptions: [],
  teamDropdownOptions: [],
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
  return screen.getByRole("button", { name: "Advanced Options" });
}

function advancedOptionsBody(): HTMLElement {
  const bodyId: string | null = advancedOptions().getAttribute("aria-controls");

  if (!bodyId) {
    throw new Error("Advanced Options does not name the body it controls.");
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

describe("the incident's Advanced Options", () => {
  test("starts collapsed on a new monitor's Offline rule, with no badge", () => {
    renderIncidentForm(defaultOfflineRule().incident);

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
    expect(advancedOptionsBody()).toHaveClass("max-h-0", "invisible");
    expect(advancedOptions()).not.toHaveTextContent("Configured");
  });

  test("starts collapsed on an incident added by hand", () => {
    renderIncidentForm();

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
  });

  test.each([
    ["auto-resolve was turned off", { autoResolveIncident: false }],
    ["it has remediation notes", { remediationNotes: "Restart the pod." }],
    ["it is private", { isPrivate: true }],
  ])(
    "opens by itself when %s, so the choice is not hidden",
    (_name: string, overrides: Partial<CriteriaIncident>) => {
      renderIncidentForm(incident(overrides));

      expect(advancedOptions()).toHaveAttribute("aria-expanded", "true");
      expect(advancedOptionsBody()).not.toHaveClass("invisible");
    },
  );

  test("opens on a click, and keeps its fields while folded", () => {
    renderIncidentForm(defaultOfflineRule().incident);

    // Mounted while folded, so a value typed earlier is not lost.
    expect(screen.getByText("Auto Resolve Incident")).toBeInTheDocument();

    fireEvent.click(advancedOptions());

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "true");
    expect(advancedOptionsBody()).not.toHaveClass("invisible");
    expect(screen.getByText("Private Incident")).toBeInTheDocument();
  });

  test("badges a folded section that holds a choice", () => {
    renderIncidentForm(incident({ isPrivate: true }));

    fireEvent.click(advancedOptions());

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
    expect(advancedOptions()).toHaveTextContent("Configured");
  });
});

describe("the alert's Advanced Options", () => {
  test("starts collapsed on a new monitor's Offline rule, with no badge", () => {
    renderAlertForm(defaultOfflineRule().alert);

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
    expect(advancedOptionsBody()).toHaveClass("max-h-0", "invisible");
    expect(advancedOptions()).not.toHaveTextContent("Configured");
  });

  test("starts collapsed on an alert added by hand", () => {
    renderAlertForm();

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "false");
  });

  test("opens by itself when auto-resolve was turned off", () => {
    renderAlertForm(alert({ autoResolveAlert: false }));

    expect(advancedOptions()).toHaveAttribute("aria-expanded", "true");
  });

  test("badges a folded section that holds a choice", () => {
    renderAlertForm(alert({ remediationNotes: "Check the queue." }));

    fireEvent.click(advancedOptions());

    expect(advancedOptions()).toHaveTextContent("Configured");
  });
});
