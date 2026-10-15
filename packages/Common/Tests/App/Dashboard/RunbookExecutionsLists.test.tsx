import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { getJestSpyOn } from "../../Spy";

/*
 * THE TWO EXECUTIONS LISTS, AND WHAT STARTED EACH RUN.
 *
 * Both lists have a Triggered by column and filter. On the project's list -
 * every runbook's runs - it took the place of Completed At, which starts
 * hidden: with both, the table ran past its card at 1280px and hid each
 * row's View. The column wraps a long incident title or a catch-up run's
 * second line, and is never squeezed so narrow that a person's name breaks.
 * The runbook's own list scrolled already (a whole execution ID per row), so
 * its column stays on one line.
 *
 * The real pages run against a stand-in ModelTable that keeps what it was
 * given.
 */

interface CapturedColumn {
  title: string;
  wrapContent?: boolean;
  wrapMaxWidthClassName?: string;
  contentClassName?: string;
  isHiddenByDefault?: boolean;
  hideOnMobile?: boolean;
}

interface CapturedFilter {
  title: string;
  filterDropdownOptions?: Array<{ value: unknown }>;
}

interface CapturedTable {
  id: string;
  columns: Array<CapturedColumn>;
  filters: Array<CapturedFilter>;
}

const captured: Array<CapturedTable> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable): React.ReactElement => {
      captured.push(props);
      return <section data-testid={props.id} />;
    },
  };
});

import RunbooksExecutions from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Executions";
import RunbookExecutionsList from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Executions";
import {
  TRIGGERED_BY_MAX_WIDTH_CLASS_NAME,
  TRIGGERED_BY_MIN_WIDTH_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookExecutionTriggerCell";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { RUNBOOK_TRIGGER_TYPES } from "../../../Types/Runbook/RunbookTriggerType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "7c1e5a90-2b44-4f1d-9a63-5e0c2d9b1b01",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "7c1e5a90-2b44-4f1d-9a63-5e0c2d9b1b02",
);

beforeEach(() => {
  captured.length = 0;
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    RUNBOOK_ID,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderTable(
  Page: typeof RunbooksExecutions | typeof RunbookExecutionsList,
): CapturedTable {
  render(
    <MemoryRouter>
      <Page
        pageRoute={new Route("/dashboard/runbooks/executions")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  const table: CapturedTable | undefined = captured[captured.length - 1];
  expect(table).toBeDefined();
  return table!;
}

function column(table: CapturedTable, title: string): CapturedColumn {
  const found: CapturedColumn | undefined = table.columns.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );
  expect({ title, found: Boolean(found) }).toEqual({ title, found: true });
  return found!;
}

function filterValues(table: CapturedTable): Array<unknown> {
  const filter: CapturedFilter | undefined = table.filters.find(
    (candidate: CapturedFilter): boolean => {
      return candidate.title === "Triggered by";
    },
  );
  expect(filter).toBeDefined();
  return (filter!.filterDropdownOptions || []).map(
    (option: { value: unknown }): unknown => {
      return option.value;
    },
  );
}

describe("the project's Executions list", () => {
  test("shows what started each run, in place of Completed At, which starts hidden", () => {
    const table: CapturedTable = renderTable(RunbooksExecutions);

    expect(
      table.columns.map((candidate: CapturedColumn): string => {
        return candidate.title;
      }),
    ).toEqual([
      "Runbook",
      "Status",
      "Triggered by",
      "Started At",
      "Completed At",
    ]);
    expect(column(table, "Completed At").isHiddenByDefault).toBe(true);
    // The rest start shown.
    for (const title of ["Runbook", "Status", "Triggered by", "Started At"]) {
      expect({
        title,
        hidden: Boolean(column(table, title).isHiddenByDefault),
      }).toEqual({ title, hidden: false });
    }
  });

  test("wraps a long trigger inside its column, never narrower than a name", () => {
    const triggeredBy: CapturedColumn = column(
      renderTable(RunbooksExecutions),
      "Triggered by",
    );

    expect(triggeredBy.wrapContent).toBe(true);
    expect(triggeredBy.wrapMaxWidthClassName).toBe(
      TRIGGERED_BY_MAX_WIDTH_CLASS_NAME,
    );
    expect(triggeredBy.contentClassName).toBe(
      TRIGGERED_BY_MIN_WIDTH_CLASS_NAME,
    );
    expect(TRIGGERED_BY_MAX_WIDTH_CLASS_NAME).toBe("max-w-[18rem]");
    expect(TRIGGERED_BY_MIN_WIDTH_CLASS_NAME).toBe("min-w-[12rem]");
  });

  test("filters by every way a run starts", () => {
    expect(filterValues(renderTable(RunbooksExecutions))).toEqual([
      ...RUNBOOK_TRIGGER_TYPES,
    ]);
  });
});

describe("a runbook's own Executions list", () => {
  test("shows what started each run on one line, beside Completed At", () => {
    const table: CapturedTable = renderTable(RunbookExecutionsList);
    const triggeredBy: CapturedColumn = column(table, "Triggered by");

    expect(Boolean(triggeredBy.wrapContent)).toBe(false);
    expect(Boolean(column(table, "Completed At").isHiddenByDefault)).toBe(
      false,
    );
    expect(filterValues(table)).toEqual([...RUNBOOK_TRIGGER_TYPES]);
  });
});
