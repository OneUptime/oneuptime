import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import {
  EMPTY_VALUE_MARK,
  EMPTY_VALUE_TEST_ID,
  isDashText,
} from "../../../UI/Components/Detail/EmptyValue";
import IssueMoment from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueMoment";
import MonitorTemplateElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTemplateElement";
import OidTemplateElement from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/OidTemplateElement";
import KubernetesLabelSelector from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesLabelSelector";
import {
  InventorySourceBadge,
  InventoryTypeBadge,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryBadges";
import { IndicatorTypeCell } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ThreatIntelIndicatorCells";
import { SecurityCasePriorityPill } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCasePills";
import StorageArrayResourceStatusBadge from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/StorageArrayResourceStatusBadge";
import MitreAttackChips from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/MitreAttackChips";
import {
  SummaryFact,
  getSummaryFactValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryFacts";

/*
 * THE DASHBOARD'S CELLS DRAW THE QUIET DASH, NOT A HYPHEN OF THEIR OWN
 * (#7603, #8209).
 *
 * A list's cell components - a data-security issue's moment, a monitor's
 * template, an OID template, a Kubernetes selector, an inventory asset's
 * type and source, a threat indicator's type, a security case's priority,
 * a storage array object's status - each drew `<span className="text-sm
 * text-gray-400">-</span>` (or "—") for a value that is not there: darker
 * or wider than the quiet dash in the next cell, with nothing for a screen
 * reader to hear. Each draws TableEmptyValue now. A monitor summary's fact
 * is handed no value and draws the card's dash itself (EmptyValue), where
 * some seventy facts wrote `value={probeName || "-"}`.
 */

afterEach(() => {
  cleanup();
});

// The marks drawn outside the quiet dash: a hyphen of a cell's own.
function ownDashesOf(container: HTMLElement): Array<string> {
  const clone: HTMLElement = container.cloneNode(true) as HTMLElement;

  for (const quiet of Array.from(
    clone.querySelectorAll(
      `[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"], [data-testid="${EMPTY_VALUE_TEST_ID}"]`,
    ),
  )) {
    quiet.remove();
  }

  return Array.from(clone.querySelectorAll("*"))
    .filter((node: Element): boolean => {
      return node.children.length === 0 && isDashText(node.textContent || "");
    })
    .map((node: Element): string => {
      return node.textContent || "";
    });
}

const EMPTY_CELLS: Array<[string, ReactElement]> = [
  [
    "a data-security issue with no moment",
    <IssueMoment key="i" value={null} />,
  ],
  [
    "a monitor with no template",
    <MonitorTemplateElement key="m" monitorTemplate={undefined} />,
  ],
  [
    "a device with no OID template",
    <OidTemplateElement key="o" oidTemplate={undefined} />,
  ],
  [
    "a Kubernetes selector with no labels",
    <KubernetesLabelSelector key="k" selector={{}} />,
  ],
  [
    "an inventory asset with no type",
    <InventoryTypeBadge key="t" entityType={undefined} />,
  ],
  [
    "an inventory asset with no source",
    <InventorySourceBadge key="s" source={undefined} />,
  ],
  [
    "a threat indicator with no type",
    <IndicatorTypeCell key="x" type={undefined} />,
  ],
  [
    "a security case with no priority",
    <SecurityCasePriorityPill key="p" value={null} />,
  ],
  [
    "a storage array object with no status",
    <StorageArrayResourceStatusBadge key="a" status={null} />,
  ],
  [
    "a case's entity with no ATT&CK mapping, in a list that wants the dash",
    <MitreAttackChips
      key="c"
      tactics={[]}
      techniques={[]}
      isEmptyDash={true}
    />,
  ],
];

describe.each(EMPTY_CELLS)("%s", (_name: string, cell: ReactElement) => {
  test("is the quiet dash, read out as 'Not set'", () => {
    const { container } = render(cell);

    expect(
      container.querySelectorAll(
        `[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`,
      ),
    ).toHaveLength(1);
    expect(container.textContent).toBe(`${EMPTY_VALUE_MARK}Not set`);
  });

  test("draws no hyphen of its own", () => {
    const { container } = render(cell);

    expect(ownDashesOf(container)).toEqual([]);
  });
});

describe("words a cell has for nothing are still its words", () => {
  test("a storage array object's own words for no status", () => {
    const { container } = render(
      <StorageArrayResourceStatusBadge
        status={null}
        emptyText="Not reported"
      />,
    );

    expect(container.textContent).toBe("Not reported");
    expect(
      container.querySelector(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
    ).toBeNull();
  });

  test("an ATT&CK mapping that is not there says so where a page wants words", () => {
    const { container } = render(
      <MitreAttackChips tactics={[]} techniques={[]} />,
    );

    expect(container.textContent).toBe("Not mapped");
    expect(
      container.querySelector(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
    ).toBeNull();
  });

  test("a cell with a value draws the value, not the dash", () => {
    const { container } = render(
      <KubernetesLabelSelector selector={{ app: "checkout" }} />,
    );

    expect(container.textContent).toContain("checkout");
    expect(
      container.querySelector(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
    ).toBeNull();
  });
});

describe("a monitor summary's fact", () => {
  test.each([[undefined], [""], ["   "], ["-"], ["–"], ["—"]])(
    "with no value (%j) draws the card's quiet dash",
    (value: string | undefined) => {
      const { container } = render(<SummaryFact title="Probe" value={value} />);

      expect(
        container.querySelector(`[data-testid="${EMPTY_VALUE_TEST_ID}"]`),
      ).not.toBeNull();
      expect(ownDashesOf(container)).toEqual([]);
    },
  );

  test("with a value draws it", () => {
    const { container } = render(
      <SummaryFact title="Probe" value="Frankfurt (eu-central-1)" />,
    );

    expect(container).toHaveTextContent("Frankfurt (eu-central-1)");
    expect(
      container.querySelector(`[data-testid="${EMPTY_VALUE_TEST_ID}"]`),
    ).toBeNull();
  });

  test("an element for a value is drawn as given, a number's 0 too", () => {
    const element: ReactElement = <span data-testid="fact-element">OK</span>;

    expect(getSummaryFactValue(element)).toBe(element);
    expect(getSummaryFactValue("0")).toBe("0");
    expect(getSummaryFactValue("-1")).toBe("-1");
    expect(getSummaryFactValue("--")).toBe("--");
  });
});

describe("the check can fail", () => {
  test("the old cell, a grey hyphen of its own, is caught", () => {
    const { container } = render(
      <span className="text-sm text-gray-400">-</span>,
    );

    expect(ownDashesOf(container)).toEqual(["-"]);
  });
});
