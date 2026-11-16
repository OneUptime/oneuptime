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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A monitor's Logs and SLOs pages, before there is anything on them
 * (#9124).
 *
 * Logs said "No logs found for this resource. Please check back later.",
 * with no word of when later is. It says when the first check runs now, and
 * offers Probes & Interval for a monitor probes check.
 *
 * SLOs told the reader to "Create one on the SLOs page", with no way there.
 * The page creates one itself now: the SLOs page's Objective step, and the
 * new SLO measures this monitor's uptime from the start.
 *
 * Only the props each page hands to its table are under test, so the table
 * is captured instead of rendered.
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

// The disabled-monitor banner reads the monitor; it is not under test here.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

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

import MonitorSlos, {
  getMonitorSloCreateFormFields,
  measureMonitorUptime,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Slos";
import {
  getFirstCheckSentence,
  getMonitorLogsEmptyState,
  MONITOR_LOGS_EMPTY_TITLE,
  MONITOR_LOGS_PROBES_LINK_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/MonitorLogsEmptyState";
import { SLO_CREATE_INITIAL_VALUES } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import EmptyStateOptions from "../../../UI/Components/ModelTable/EmptyStateOptions";
import { TableEmptyStateActionStyle } from "../../../UI/Components/Table/TableEmptyState";
import Navigation from "../../../UI/Utils/Navigation";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import { refuseRequestsTo } from "../../Helpers/RealNetworkRequests";
import { getJestSpyOn } from "../../Spy";

refuseRequestsTo(["/label/get-list"]);

const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
  undefined,
  "en",
);

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const MONITOR_ID: string = "20000000-0000-4000-8000-0000000000b2";

type TableProps = Record<string, unknown>;

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a monitor's Logs page, before its first check", () => {
  const emptyState: (
    monitorType: MonitorType,
    data?: { interval?: string; isDisabled?: boolean },
  ) => EmptyStateOptions = (
    monitorType: MonitorType,
    data?: { interval?: string; isDisabled?: boolean },
  ): EmptyStateOptions => {
    return getMonitorLogsEmptyState({
      monitorId: new ObjectID(MONITOR_ID),
      monitorType: monitorType,
      monitoringInterval: data?.interval,
      isDisabled: Boolean(data?.isDisabled),
      translator: ENGLISH,
    });
  };

  test("is headed 'No checks yet', never 'found'", () => {
    const state: EmptyStateOptions = emptyState(MonitorType.Website, {
      interval: "*/5 * * * *",
    });

    expect(state.title).toBe(MONITOR_LOGS_EMPTY_TITLE);
    expect(MONITOR_LOGS_EMPTY_TITLE).toBe("No checks yet");
  });

  test("says when a probed monitor's first check runs, from its interval", () => {
    expect(
      emptyState(MonitorType.Website, { interval: "*/5 * * * *" }).description,
    ).toBe("The first check runs within 5 minutes.");
    expect(
      emptyState(MonitorType.API, { interval: "* * * * *" }).description,
    ).toBe("The first check runs within 1 minute.");
    expect(
      emptyState(MonitorType.Ping, { interval: "0 * * * *" }).description,
    ).toBe("The first check runs within 1 hour.");
    expect(
      emptyState(MonitorType.SSLCertificate, { interval: "0 0 * * *" })
        .description,
    ).toBe("The first check runs within 1 day.");
  });

  test("offers Probes & Interval for a monitor probes check, as a link", () => {
    const navigate: jest.Mock = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation((): void => {
      return undefined;
    }) as unknown as jest.Mock;

    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}/logs`,
    );

    const actions: EmptyStateOptions["actions"] = emptyState(
      MonitorType.Website,
      { interval: "*/5 * * * *" },
    ).actions;

    expect(actions).toHaveLength(1);
    expect(actions![0]!.title).toBe("Probes & Interval");
    expect(actions![0]!.style).toBe(TableEmptyStateActionStyle.Link);
    expect(actions![0]!.dataTestId).toBe(MONITOR_LOGS_PROBES_LINK_TEST_ID);

    actions![0]!.onClick();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toContain(
      `/monitors/${MONITOR_ID}/probes`,
    );
  });

  test("a disabled monitor is not promised a check", () => {
    const state: EmptyStateOptions = emptyState(MonitorType.Website, {
      interval: "*/5 * * * *",
      isDisabled: true,
    });

    expect(state.title).toBe("No checks yet");
    // The card's description says what the list holds; the banner, why it is empty.
    expect(state.description).toBeUndefined();
  });

  test("a monitor checked when something reaches it keeps the card's description, and has no Probes & Interval", () => {
    const state: EmptyStateOptions = emptyState(MonitorType.IncomingRequest);

    expect(state.description).toBeUndefined();
    expect(state.actions).toEqual([]);
  });

  test("a telemetry monitor is evaluated on its interval, and has no Probes & Interval page", () => {
    const state: EmptyStateOptions = emptyState(MonitorType.Logs, {
      interval: "*/10 * * * *",
    });

    expect(state.description).toBe("The first check runs within 10 minutes.");
    expect(state.actions).toEqual([]);
  });

  test("an interval the scheduler cannot read is checked every minute, as it says", () => {
    expect(
      getFirstCheckSentence({
        monitoringInterval: "not a cron",
        translator: ENGLISH,
      }),
    ).toBe("The first check runs within 1 minute.");
  });
});

describe("a monitor's SLOs page", () => {
  function renderPage(): TableProps {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}/slos`,
    );

    render(
      <MemoryRouter>
        <MonitorSlos {...({} as PageComponentProps)} />
      </MemoryRouter>,
    );

    expect(mockCapturedTableProps.length).toBeGreaterThan(0);

    return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
  }

  test("offers Create, and its empty sentence says so instead of pointing elsewhere", () => {
    const props: TableProps = renderPage();

    expect(props["isCreateable"]).toBe(true);
    expect(props["id"]).toBe("monitor-slos-table");
    expect(props["noItemsMessage"]).toBe(
      "No SLO measures this monitor yet. Create one to set an uptime target for it, with an error budget its downtime spends.",
    );
    expect(String(props["noItemsMessage"])).not.toContain("SLOs page");
  });

  test("asks only the Objective step: what it measures is this monitor", () => {
    const props: TableProps = renderPage();

    type FieldKeys = {
      field?: Record<string, unknown>;
      overrideFieldKey?: string;
      stepId?: string;
    };

    const fields: Array<FieldKeys> = props["formFields"] as Array<FieldKeys>;

    expect(
      fields.map((field: FieldKeys): string => {
        return (
          field.overrideFieldKey ||
          (Object.keys(field.field || {})[0] as string)
        );
      }),
    ).toEqual([
      "name",
      "targetPercentage",
      "description",
      "atRiskThresholdPercentage",
      "windowType",
      "windowDays",
      "timezone",
      "labels",
    ]);
    // One page: no stepper for a form this short.
    expect(props["formSteps"]).toBeUndefined();
    expect(
      fields.every((field: FieldKeys): boolean => {
        return field.stepId === undefined;
      }),
    ).toBe(true);
    expect(getMonitorSloCreateFormFields()).toHaveLength(fields.length);
    expect(props["createInitialValues"]).toBe(SLO_CREATE_INITIAL_VALUES);
  });

  test("the new SLO measures this monitor's uptime, with the monitor attached", async () => {
    const props: TableProps = renderPage();
    const onBeforeCreate: (
      item: ServiceLevelObjective,
    ) => Promise<ServiceLevelObjective> = props["onBeforeCreate"] as (
      item: ServiceLevelObjective,
    ) => Promise<ServiceLevelObjective>;

    const item: ServiceLevelObjective = new ServiceLevelObjective();
    item.name = "Checkout uptime";

    const created: ServiceLevelObjective = await onBeforeCreate(item);

    expect(created.sliType).toBe(SliType.MonitorUptime);
    expect(
      (created.monitors || []).map((monitor: Monitor): string => {
        return monitor._id!.toString();
      }),
    ).toEqual([MONITOR_ID]);
    expect(created.name).toBe("Checkout uptime");
  });

  test("measureMonitorUptime replaces whatever the form held", () => {
    const item: ServiceLevelObjective = new ServiceLevelObjective();
    item.sliType = SliType.RequestSuccess;

    const created: ServiceLevelObjective = measureMonitorUptime(
      item,
      new ObjectID(MONITOR_ID),
    );

    expect(created.sliType).toBe(SliType.MonitorUptime);
    expect(created.monitors).toHaveLength(1);
  });
});
