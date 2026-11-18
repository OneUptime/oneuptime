import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";
import SloDeploymentsCell, {
  SLO_DEPLOYMENTS_CELL_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloDeploymentsCell";
import { FROZEN_SINCE_TEMPLATE } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloPolicyTier";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import OneUptimeDate from "../../../Types/Date";

/*
 * THE SLO LIST'S DEPLOYMENTS COLUMN (#6377).
 *
 * A platform team that gates many services on their SLOs asks which of them
 * are freezing deployments right now. The column answers from the row
 * itself - "Frozen since <time>" in red while the SLO's error budget policy
 * tier freezes deployments, and nothing while they are allowed - and starts
 * hidden, so a team that gates nothing sees the list as it was.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

function slo(data: {
  deploymentsAllowed?: boolean | undefined;
  deploymentsFrozenAt?: Date | undefined;
}): ServiceLevelObjective {
  const item: ServiceLevelObjective = new ServiceLevelObjective();

  if (data.deploymentsAllowed !== undefined) {
    item.deploymentsAllowed = data.deploymentsAllowed;
  }

  if (data.deploymentsFrozenAt !== undefined) {
    item.deploymentsFrozenAt = data.deploymentsFrozenAt;
  }

  return item;
}

afterEach(() => {
  cleanup();
});

describe("the Deployments cell", () => {
  test("says since when a frozen SLO has frozen deployments, in red with the lock", () => {
    const frozenAt: Date = new Date("2026-09-11T12:00:00.000Z");

    render(
      <SloDeploymentsCell
        slo={slo({ deploymentsAllowed: false, deploymentsFrozenAt: frozenAt })}
      />,
    );

    const pill: HTMLElement = screen.getByTestId(SLO_DEPLOYMENTS_CELL_TEST_ID);

    expect(pill).toHaveTextContent(
      FROZEN_SINCE_TEMPLATE.replace(
        "{{time}}",
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(frozenAt),
      ),
    );
    expect(pill.textContent || "").toMatch(/^Frozen since /);
  });

  test("says Frozen alone when the freeze time was not recorded", () => {
    render(<SloDeploymentsCell slo={slo({ deploymentsAllowed: false })} />);

    expect(screen.getByTestId(SLO_DEPLOYMENTS_CELL_TEST_ID)).toHaveTextContent(
      /^Frozen$/,
    );
  });

  test("says nothing for an SLO that allows deployments", () => {
    render(
      <SloDeploymentsCell
        slo={slo({
          deploymentsAllowed: true,
          // A freeze time left over from before is no freeze.
          deploymentsFrozenAt: new Date("2026-09-11T12:00:00.000Z"),
        })}
      />,
    );

    expect(
      screen.queryByTestId(SLO_DEPLOYMENTS_CELL_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Frozen/)).not.toBeInTheDocument();
  });

  test("says nothing for a row read without the deploy gate: only an explicit false is a freeze", () => {
    render(<SloDeploymentsCell slo={slo({})} />);

    expect(
      screen.queryByTestId(SLO_DEPLOYMENTS_CELL_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("the SLO list's wiring of the column", () => {
  // Whitespace squashed, so a re-wrapped line never fails a real check.
  const page: string = fs
    .readFileSync(path.join(DASHBOARD_SRC, "Pages", "Slo", "Slos.tsx"), "utf8")
    .replace(/\s+/g, " ");

  test("is hidden until it is switched on, and kept off a phone's card", () => {
    const column: string = page.slice(
      page.indexOf("export const getSloDeploymentsColumns"),
      page.indexOf("export const SLO_TABLE_SELECT_MORE_FIELDS"),
    );

    expect(column).toContain("deploymentsAllowed: true");
    expect(column).toContain('title: "Deployments"');
    expect(column).toContain("isHiddenByDefault: true");
    expect(column).toContain("hideOnMobile: true");
    expect(column).toContain("<SloDeploymentsCell slo={item} />");
  });

  test("is the SLO list's own, right after Status, and reads the freeze time in the list's one query", () => {
    expect(page).toContain(
      "...getSloTableColumns(), ...getSloDeploymentsColumns(), ...getSloWhatItMeasuresColumns(),",
    );
    expect(page).toContain("selectMoreFields={SLO_LIST_SELECT_MORE_FIELDS}");
    expect(page).toContain(
      "export const SLO_LIST_SELECT_MORE_FIELDS: Select<ServiceLevelObjective> = { ...SLO_TABLE_SELECT_MORE_FIELDS, deploymentsFrozenAt: true, };",
    );
  });

  test("leaves the monitor's and the service's SLO tabs as they were", () => {
    for (const tab of [
      ["Pages", "Monitor", "View", "Slos.tsx"],
      ["Pages", "Service", "View", "Slos.tsx"],
    ]) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, ...tab),
        "utf8",
      );

      expect(source).not.toContain("getSloDeploymentsColumns");
    }
  });
});
