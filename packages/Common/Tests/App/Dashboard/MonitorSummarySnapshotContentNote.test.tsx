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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE MONITOR SUMMARY CARD OF AN INCIDENT OR AN ALERT, FOR A MONITOR THAT
 * KEEPS NO RESPONSE CONTENT.
 *
 * The card shows what the monitor reported when the record opened, from the
 * snapshot stored on it. A monitor set to keep no response content
 * (Monitor.keepResponseContent) leaves the body out of that snapshot, and
 * the card says so - of a response for a Website or API monitor, of a
 * request for an Incoming Request monitor, which reads the request it
 * receives. A snapshot that kept its content says nothing about it.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

// The per-type view of the check is beside the point here.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import MonitorSummarySnapshotCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSummarySnapshotCard";
import Incident from "../../../Models/DatabaseModels/Incident";
import { JSONObject } from "../../../Types/JSON";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorSummarySnapshot, {
  MonitorSummarySnapshotSource,
  MonitorSummarySnapshotVersion,
} from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import MonitorSummarySnapshotUtil from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";

const INCIDENT_ID: string = "6f0e1c2a-0000-4000-8000-0000000000a1";
const NOTE_TEST_ID: string = "monitor-summary-response-content-omitted";

let stored: MonitorSummarySnapshot | null = null;

function snapshot(
  overrides: Partial<MonitorSummarySnapshot>,
): MonitorSummarySnapshot {
  return {
    version: MonitorSummarySnapshotVersion,
    source: MonitorSummarySnapshotSource.Captured,
    monitorType: MonitorType.API,
    capturedAt: new Date("2026-11-08T10:04:12.000Z"),
    evaluationSummary: {
      evaluatedAt: new Date("2026-11-08T10:04:12.000Z"),
      criteriaResults: [
        {
          criteriaId: "criteria-1",
          criteriaName: "Payments degraded",
          filterCondition: FilterCondition.All,
          met: true,
          message: "All filters met.",
          filters: [],
        },
      ],
      events: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  stored = null;
  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID;
    incident.monitorSummary = MonitorSummarySnapshotUtil.serialize(
      stored,
    ) as JSONObject;
    incident.createdAt = new Date("2026-11-08T10:04:13.000Z");
    return incident;
  });
});

afterEach(() => {
  cleanup();
});

async function renderCard(): Promise<void> {
  render(<MonitorSummarySnapshotCard incidentId={new ObjectID(INCIDENT_ID)} />);

  await act(async () => {
    for (let index: number = 0; index < 10; index++) {
      await Promise.resolve();
    }
  });
}

describe("a monitor that keeps no response content", () => {
  test("a Website or API monitor's card says it kept no response content", async () => {
    stored = snapshot({ isResponseContentOmitted: true });

    await renderCard();

    expect(await screen.findByTestId(NOTE_TEST_ID)).toHaveTextContent(
      "The monitor keeps no response content on its incidents and alerts.",
    );
  });

  test("an Incoming Request monitor's card says it kept no request content", async () => {
    stored = snapshot({
      monitorType: MonitorType.IncomingRequest,
      isResponseContentOmitted: true,
    });

    await renderCard();

    expect(await screen.findByTestId(NOTE_TEST_ID)).toHaveTextContent(
      "The monitor keeps no request content on its incidents and alerts.",
    );
  });

  test("a snapshot that kept its content says nothing about it", async () => {
    stored = snapshot({});

    await renderCard();

    expect(await screen.findByText("Monitor Summary")).toBeInTheDocument();
    expect(screen.queryByTestId(NOTE_TEST_ID)).toBeNull();
  });
});
