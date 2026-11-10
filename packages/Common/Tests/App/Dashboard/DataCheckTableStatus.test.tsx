import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A CHECK'S STATUS ON THE CHECKS PAGE: WHETHER IT PASSES, NOT WHETHER ITS
 * QUERY RAN.
 *
 * "Ran", in green, said only that a check's query worked - a check whose
 * values broke its alert read exactly as one that passed. Its Status now
 * comes from Data Observability's own route, by the check's alert: open,
 * it is Failing, with the alert's number linking to it; not, Passing.
 * Until that route answers - or when it cannot - a check that ran says
 * only that, in grey. Only the props the table hands to ModelTable are
 * under test, so the table is captured instead of rendered.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import DataObservabilityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import DataCheckTable from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckTable";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import Route from "../../../Types/API/Route";
import {
  DataCheckRunStatus,
  DataCheckType,
} from "../../../Types/DataObservability/DataCheckType";
import {
  DataCheckHealth,
  DataCheckHealthAnswer,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import ObjectID from "../../../Types/ObjectID";
import FieldType from "../../../UI/Components/Types/FieldType";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

interface CapturedColumn {
  field?: Record<string, unknown>;
  title?: string;
  type?: FieldType;
  getElement?: (item: DataCheck) => ReactElement;
  getExportValue?: (item: DataCheck) => string;
}

interface CapturedFilter {
  field?: Record<string, unknown>;
  title?: string;
  type?: FieldType;
  filterDropdownOptions?: Array<{ value: unknown; label: string }>;
}

const FAILING: string = "10000000-0000-4000-8000-000000000301";
const PASSING: string = "10000000-0000-4000-8000-000000000302";
const COULD_NOT_RUN: string = "10000000-0000-4000-8000-000000000303";
const ALERT: string = "10000000-0000-4000-8000-000000000801";

function check(id: string, fields: Record<string, unknown> = {}): DataCheck {
  const row: DataCheck = new DataCheck();
  Object.assign(row, {
    _id: id,
    name: "a check",
    checkType: DataCheckType.NullPercent,
    isEnabled: true,
    lastRunAt: new Date(Date.now() - 60 * 60 * 1000),
    lastRunStatus: DataCheckRunStatus.Ran,
    ...fields,
  });
  return row;
}

const CHECKS: Array<DataCheck> = [
  check(FAILING),
  check(PASSING),
  check(COULD_NOT_RUN, {
    lastRunStatus: DataCheckRunStatus.Failed,
    lastRunMessage: 'column "email" does not exist',
  }),
];

let healthAnswer: Map<string, DataCheckHealthAnswer> | Error;
let healthAsked: Array<Array<string>>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-observability/checks`);
  mockCapturedTableProps.length = 0;
  healthAsked = [];
  healthAnswer = new Map<string, DataCheckHealthAnswer>([
    [
      FAILING,
      {
        health: DataCheckHealth.Failing,
        alert: { alertId: ALERT, number: "ALT-7", title: "nulls" },
      },
    ],
    [PASSING, { health: DataCheckHealth.Passing, alert: null }],
    [COULD_NOT_RUN, { health: DataCheckHealth.CouldNotRun, alert: null }],
  ]);

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  jest
    .spyOn(DataObservabilityApi, "getCheckHealth")
    .mockImplementation(async (ids: Array<string>) => {
      healthAsked.push(ids);

      if (healthAnswer instanceof Error) {
        throw healthAnswer;
      }

      return healthAnswer;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function latestProps(): Record<string, unknown> {
  expect(mockCapturedTableProps.length).toBeGreaterThan(0);
  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

function statusColumn(): CapturedColumn {
  const found: CapturedColumn | undefined = (
    latestProps()["columns"] as Array<CapturedColumn>
  ).find((column: CapturedColumn): boolean => {
    return column.title === "Status";
  });

  expect(found).toBeDefined();

  return found!;
}

function renderStatus(item: DataCheck): HTMLElement {
  cleanup();

  const { container } = render(
    <MemoryRouter>{statusColumn().getElement!(item)}</MemoryRouter>,
  );

  return container.querySelector("[data-check-health]") as HTMLElement;
}

async function openTable(): Promise<void> {
  await act(async () => {
    render(<DataCheckTable />);
  });
}

async function fetched(checks: Array<DataCheck>): Promise<void> {
  await act(async () => {
    (latestProps()["onFetchSuccess"] as (rows: Array<DataCheck>) => void)(
      checks,
    );
  });
}

describe("before the alerts are read", () => {
  test("a check that ran says only that it ran, in grey - never Passing", async () => {
    await openTable();

    const status: HTMLElement = renderStatus(CHECKS[0]!);

    expect(status).toHaveAttribute(
      "data-check-health",
      DataCheckHealth.NoAlert,
    );
    expect(screen.getByText("Ran")).toBeInTheDocument();
    expect(screen.getByText(/^Last ran /)).toBeInTheDocument();
  });

  test("a check whose query failed could not run, with its error - it was tried, not run", async () => {
    await openTable();

    renderStatus(CHECKS[2]!);

    expect(screen.getByText("Could Not Run")).toBeInTheDocument();
    expect(
      screen.getByText('column "email" does not exist'),
    ).toBeInTheDocument();
    // As the Overview's Needs Attention says of it: "Last tried 3 hours ago".
    expect(screen.getByText(/^Last tried /)).toBeInTheDocument();
    expect(screen.queryByText(/^Last ran /)).toBeNull();
  });

  test("a check never run is waiting", async () => {
    await openTable();

    renderStatus(check(FAILING, { lastRunAt: null, lastRunStatus: null }));

    expect(screen.getByText("Waiting for first run")).toBeInTheDocument();
  });
});

describe("once the page of checks is fetched", () => {
  test("their health is asked for, by id, once", async () => {
    await openTable();
    await fetched(CHECKS);

    expect(healthAsked).toEqual([[FAILING, PASSING, COULD_NOT_RUN]]);
  });

  test("a check whose alert is open is Failing, its alert one click away", async () => {
    await openTable();
    await fetched(CHECKS);

    const status: HTMLElement = renderStatus(CHECKS[0]!);

    expect(status).toHaveAttribute(
      "data-check-health",
      DataCheckHealth.Failing,
    );
    expect(screen.getByText("Failing")).toBeInTheDocument();

    const link: HTMLElement = screen.getByText("Alert ALT-7 is open");

    expect(link.closest("a")).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(RouteMap[PageMap.ALERT_VIEW] as Route, {
        modelId: new ObjectID(ALERT),
      }).toString(),
    );
    expect(statusColumn().getExportValue!(CHECKS[0]!)).toBe("Failing");
  });

  test("a check whose alert is not open is Passing", async () => {
    await openTable();
    await fetched(CHECKS);

    expect(renderStatus(CHECKS[1]!)).toHaveAttribute(
      "data-check-health",
      DataCheckHealth.Passing,
    );
    expect(screen.getByText("Passing")).toBeInTheDocument();
    expect(screen.queryByText(/is open$/)).toBeNull();
  });

  test("an empty page asks nothing", async () => {
    await openTable();
    await fetched([]);

    expect(healthAsked).toEqual([]);
  });

  test("when it cannot be asked, each says what its last run alone says", async () => {
    healthAnswer = new Error("timeout");

    await openTable();
    await fetched(CHECKS);

    expect(renderStatus(CHECKS[0]!)).toHaveAttribute(
      "data-check-health",
      DataCheckHealth.NoAlert,
    );
    expect(statusColumn().getExportValue!(CHECKS[0]!)).toBe("Ran");
  });
});

describe("the table", () => {
  test("reads what a check's Status is worked out from", async () => {
    await openTable();

    expect(latestProps()["selectMoreFields"]).toMatchObject({
      checkType: true,
      isEnabled: true,
      lastRunAt: true,
      lastRunMessage: true,
    });
  });

  test("filters by how the last run went: ran, or could not", async () => {
    await openTable();

    const filter: CapturedFilter | undefined = (
      latestProps()["filters"] as Array<CapturedFilter>
    ).find((each: CapturedFilter): boolean => {
      return each.title === "Last Run";
    });

    expect(filter?.type).toBe(FieldType.Dropdown);
    expect(filter?.filterDropdownOptions).toEqual([
      { value: DataCheckRunStatus.Ran, label: "Ran" },
      { value: DataCheckRunStatus.Failed, label: "Could Not Run" },
    ]);
  });

  test("says what Status means, on the page of every check", async () => {
    await openTable();

    expect(
      (latestProps()["cardProps"] as { description: string }).description,
    ).toBe(
      "Every check on your tables' values, and whether each passes now: a check whose alert is open is failing.",
    );
  });
});
