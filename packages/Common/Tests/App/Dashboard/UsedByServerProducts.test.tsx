import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import UsedByApi from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByApi";
import UsedByCard from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByCard";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import { getEmptyProjectProductsAnswer } from "../../../Types/Product/ProjectProductsAnswer";
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
import {
  UsedByGroup,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRowKind,
  UsedBySummary,
} from "../../../Types/UsedBy/UsedBy";
import {
  USED_BY_ROW_KIND_PRODUCTS,
  withoutGroupsOfProductsOff,
} from "../../../Types/UsedBy/UsedByServerProducts";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * "USED BY" AND THE PRODUCTS A SERVER SWITCHED OFF (#6815, #6813): the card
 * leaves out the line of a product that is off - its pages are gone - and
 * keeps every other; the Delete and Archive dialogs' summary is not
 * filtered, since what a delete does to a product that is off still counts.
 */

const RECORD: ObjectID = new ObjectID("68135555-1111-4111-8111-111111111111");

const group: (
  relation: UsedByRelation,
  rowKind: UsedByRowKind,
  count: number,
) => UsedByGroup = (
  relation: UsedByRelation,
  rowKind: UsedByRowKind,
  count: number,
): UsedByGroup => {
  return {
    relation: relation,
    rowKind: rowKind,
    count: count,
    hiddenCount: 0,
    rows: Array.from({ length: count }, (_value: unknown, index: number) => {
      return {
        id: `68135555-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `${rowKind} ${index}`,
      };
    }),
  };
};

const SUMMARY: UsedBySummary = {
  recordKind: UsedByRecordKind.Monitor,
  recordId: RECORD.toString(),
  groups: [
    group(UsedByRelation.MonitorStatusPages, UsedByRowKind.StatusPage, 2),
    group(UsedByRelation.MonitorSlos, UsedByRowKind.ServiceLevelObjective, 1),
    group(UsedByRelation.MonitorWorkflows, UsedByRowKind.Workflow, 1),
  ],
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectProducts.reset();
});

describe("which product each kind of row is", () => {
  test("every kind of row has a product", () => {
    expect(Object.keys(USED_BY_ROW_KIND_PRODUCTS).sort()).toEqual(
      Object.values(UsedByRowKind).sort(),
    );
    expect(USED_BY_ROW_KIND_PRODUCTS[UsedByRowKind.OnCallSchedule]).toBe(
      ProductKey.OnCall,
    );
    expect(USED_BY_ROW_KIND_PRODUCTS[UsedByRowKind.MonitorGroup]).toBe(
      ProductKey.Monitors,
    );
  });

  test("the lines of a product that is off go; the rest stay, in order", () => {
    expect(
      withoutGroupsOfProductsOff(SUMMARY, [ProductKey.StatusPages]).groups.map(
        (each: UsedByGroup): UsedByRelation => {
          return each.relation;
        },
      ),
    ).toEqual([UsedByRelation.MonitorSlos, UsedByRelation.MonitorWorkflows]);
  });

  test("nothing off leaves the summary as it is", () => {
    expect(withoutGroupsOfProductsOff(SUMMARY, [])).toBe(SUMMARY);
  });
});

describe("the Used by card", () => {
  const renderCard: () => void = (): void => {
    goTo(`/dashboard/${PROJECT_ID}/monitors/${RECORD.toString()}`);
    render(
      <MemoryRouter>
        <UsedByCard recordKind={UsedByRecordKind.Monitor} recordId={RECORD} />
      </MemoryRouter>,
    );
  };

  const relationsShown: () => Array<string> = (): Array<string> => {
    return screen
      .getAllByTestId("used-by-group")
      .map((element: HTMLElement): string => {
        return element.getAttribute("data-relation") || "";
      });
  };

  test("leaves out the line of a product switched off on the server", async () => {
    jest.spyOn(UsedByApi, "getSummary").mockResolvedValue(SUMMARY);
    ProjectProducts.setAnswer(PROJECT_ID, {
      ...getEmptyProjectProductsAnswer(),
      offOnServer: {
        [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff,
      },
    });

    renderCard();

    await waitFor(() => {
      expect(screen.getAllByTestId("used-by-group").length).toBeGreaterThan(0);
    });

    expect(relationsShown()).toEqual([
      UsedByRelation.MonitorSlos,
      UsedByRelation.MonitorWorkflows,
    ]);
  });

  test("shows every line while nothing is off", async () => {
    jest.spyOn(UsedByApi, "getSummary").mockResolvedValue(SUMMARY);

    renderCard();

    await waitFor(() => {
      expect(screen.getAllByTestId("used-by-group").length).toBe(3);
    });
  });

  test("says nothing uses the record when only products that are off do", async () => {
    jest.spyOn(UsedByApi, "getSummary").mockResolvedValue({
      ...SUMMARY,
      groups: [SUMMARY.groups[0]!],
    });
    ProjectProducts.setAnswer(PROJECT_ID, {
      ...getEmptyProjectProductsAnswer(),
      offOnServer: {
        [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff,
      },
    });

    renderCard();

    await waitFor(() => {
      expect(screen.getByTestId("used-by-empty")).toBeInTheDocument();
    });
  });
});
