import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

/*
 * A MONITOR'S CRITERIA PAGE: THE SERVICES A TELEMETRY STEP IS SCOPED TO,
 * PAST THE PROJECT'S FIRST 10,000 (#10921).
 *
 * A Logs, Traces, Exceptions or Metrics step names the services it is
 * scoped to by their ids. The page read them in one request capped at
 * 10,000 rows and left out any no service answered to: a service deleted
 * since vanished from the list, and the step read as scoped to fewer
 * services than it is. They are read by those ids alone now, in pages of
 * 500 (RecordsById), each named however many services the project has,
 * and one deleted since stays in the list reading "No longer available",
 * its id under the pointer. ModelAPI answers from a project faked whole
 * (CappedListServer).
 */

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import MonitorStepElement, {
  getStepServices,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStep";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorStep, {
  MonitorStepType,
} from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { RECORDS_BY_ID_PAGE_SIZE } from "../../../UI/Utils/RecordsById";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EARLY_ID: string = "a1000000-0000-4000-8000-000000000001";
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const DELETED_ID: string = "a1000000-0000-4000-8000-0000000000dd";

let server: CappedListServer;
let manyIds: Array<string>;

beforeEach(() => {
  server = new CappedListServer();

  const manyServices: Array<Record<string, unknown>> = namesSortingFirst(
    LIMIT_PER_PROJECT + 50,
  ).map((name: string): Record<string, unknown> => {
    return { _id: ObjectID.generate().toString(), name: name };
  });

  manyIds = manyServices.slice(-600).map((row: Record<string, unknown>) => {
    return String(row["_id"]);
  });

  server.add(Service, manyServices);
  server.add(Service, [
    { _id: EARLY_ID, name: "AA early api", serviceColor: "#6366f1" },
    { _id: LATE_ID, name: "WB kiosk payments", serviceColor: "#22c55e" },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function logsStep(serviceIds: Array<string>): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  monitorStep.data = {
    ...(monitorStep.data as MonitorStepType),
    monitorCriteria: new MonitorCriteria(),
    logMonitor: {
      attributes: {},
      body: "timeout",
      severityTexts: [],
      telemetryServiceIds: serviceIds.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
      lastXSecondsOfLogs: 60,
    },
  } as MonitorStepType;

  return monitorStep;
}

async function renderStep(serviceIds: Array<string>): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <MonitorStepElement
          monitorType={MonitorType.Logs}
          monitorStep={logsStep(serviceIds)}
          monitorStatusOptions={[]}
          incidentSeverityOptions={[]}
          alertSeverityOptions={[]}
          onCallPolicyOptions={[]}
          labelOptions={[]}
          teamOptions={[]}
          userOptions={[]}
          incidentRoleOptions={[]}
        />
      </MemoryRouter>,
    );
  });
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

function askedIds(): Array<string> {
  return serviceReads().flatMap((call: CappedListCall): Array<string> => {
    return (call.query["_id"] as Includes).values.map(
      (value: unknown): string => {
        return String(value).toLowerCase();
      },
    );
  });
}

describe("A telemetry step's services, on the monitor's criteria page", () => {
  test("a service past the project's first 10,000 is named, read by its id", async () => {
    await renderStep([LATE_ID, EARLY_ID]);

    const list: HTMLElement = await screen.findByTestId(
      "monitor-step-services",
    );

    await waitFor(() => {
      expect(list).toHaveTextContent("WB kiosk payments");
    });
    expect(list).toHaveTextContent("AA early api");

    // By name, as before.
    expect(list.textContent!.indexOf("AA early api")).toBeLessThan(
      list.textContent!.indexOf("WB kiosk payments"),
    );

    // By the step's own ids: never the project's first 10,000 by name.
    expect(serviceReads()).toHaveLength(1);
    expect(serviceReads()[0]!.query["_id"]).toBeInstanceOf(Includes);
    expect(serviceReads()[0]!.limit).toBeLessThan(LIMIT_PER_PROJECT);
    expect(askedIds().sort()).toEqual([EARLY_ID, LATE_ID].sort());
  });

  test("a service deleted since stays in the list, reading No longer available, its id under the pointer", async () => {
    await renderStep([DELETED_ID, LATE_ID]);

    const list: HTMLElement = await screen.findByTestId(
      "monitor-step-services",
    );

    await waitFor(() => {
      expect(list).toHaveTextContent("WB kiosk payments");
    });

    const gone: HTMLElement = within(list).getByTestId(
      "monitor-step-service-not-found",
    );

    expect(gone).toHaveTextContent("No longer available");
    expect(gone).toHaveAttribute("title", DELETED_ID);
    // The ones found first, the one gone last.
    expect(list.textContent!.indexOf("WB kiosk payments")).toBeLessThan(
      list.textContent!.indexOf("No longer available"),
    );
  });

  test("a step scoped to 600 services reads them in pages of 500, and names every one", async () => {
    await renderStep(manyIds);

    const list: HTMLElement = await screen.findByTestId(
      "monitor-step-services",
    );

    expect(
      serviceReads().map((call: CappedListCall) => {
        return call.limit;
      }),
    ).toEqual([RECORDS_BY_ID_PAGE_SIZE, 100]);
    expect(new Set(askedIds()).size).toBe(600);

    // Three named, the rest folded: none of them gone.
    expect(
      within(list).queryAllByTestId("monitor-step-service-not-found"),
    ).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByTestId("monitor-step-services-more"));
    });

    expect(
      within(list).queryAllByTestId("monitor-step-service-not-found"),
    ).toHaveLength(0);
    expect(list).toHaveTextContent(
      `AP${String(LIMIT_PER_PROJECT + 50).padStart(6, "0")}`,
    );
  });

  test("a read that fails says so, rather than a list that looks complete", async () => {
    jest.spyOn(server, "list").mockImplementation((() => {
      throw new Error("The server is unavailable.");
    }) as never);

    await renderStep([LATE_ID]);

    await waitFor(() => {
      expect(
        screen.getByText("The server is unavailable."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("monitor-step-services")).toBeNull();
  });
});

describe("getStepServices", () => {
  const late: Service = Object.assign(new Service(), {
    _id: LATE_ID,
    name: "WB kiosk payments",
  });
  const early: Service = Object.assign(new Service(), {
    _id: EARLY_ID,
    name: "AA early api",
  });

  test("each id once, whatever its case; by name; the ones gone last", () => {
    expect(
      getStepServices({
        ids: [DELETED_ID, LATE_ID.toUpperCase(), EARLY_ID, LATE_ID],
        servicesById: new Map<string, Service>([
          [LATE_ID, late],
          [EARLY_ID, early],
        ]),
      }),
    ).toEqual([
      { id: EARLY_ID, service: early },
      { id: LATE_ID, service: late },
      { id: DELETED_ID, service: undefined },
    ]);
  });

  test("no ids, no services", () => {
    expect(
      getStepServices({ ids: [], servicesById: new Map<string, Service>() }),
    ).toEqual([]);
  });
});
