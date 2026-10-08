import Host from "../../../../Models/DatabaseModels/Host";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import {
  IN_PROGRESS_KEYS,
  NOT_IN_PROGRESS_KEYS,
  PROGRESS_PROJECT_ID,
  PROGRESS_STATE_KEYS,
  ProgressStateKey,
  eventMatchesStateQuery,
  makeEventInState,
  mockProgressStateReads,
} from "../../TestingUtils/ScheduledMaintenanceProgressWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A grouped metric monitor skips creating an incident or an alert for a
 * breaching series whose resource is under a scheduled maintenance event IN
 * PROGRESS - in its project's ongoing state, or in a state of the project's
 * own placed between Ongoing and Ended ("Verifying"), as everywhere else
 * (Common/Utils/ScheduledMaintenanceStart). It used to ask for the ongoing
 * flag alone, so a host under an event moved on to "Verifying" paged its
 * on-call people for planned work.
 *
 * The database is a stand-in that keeps the events each query lets through,
 * by their state's id or flags, as Postgres would.
 */

function hostNameOf(key: ProgressStateKey): string {
  return `host-${key}`;
}

function eventWithHost(key: ProgressStateKey): ScheduledMaintenance {
  const event: ScheduledMaintenance = makeEventInState(key);
  const host: Host = new Host();
  host._id = `5c000000-0000-4000-8000-00000000000${PROGRESS_STATE_KEYS.indexOf(key) + 1}`;
  host.hostIdentifier = hostNameOf(key);
  event.hosts = [host];
  return event;
}

// One breaching series per state's host.
function seriesFor(key: ProgressStateKey): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: "criteria-1",
    fingerprint: `fp-${key}`,
    labels: { "resource.host.name": hostNameOf(key) },
    rootCause: "breached",
  };
}

describe("telemetry series are suppressed by every event in progress", () => {
  let eventQueries: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    eventQueries = [];
    const events: Array<ScheduledMaintenance> =
      PROGRESS_STATE_KEYS.map(eventWithHost);

    mockProgressStateReads();

    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        eventQueries.push(args.query);

        return events.filter((event: ScheduledMaintenance): boolean => {
          return eventMatchesStateQuery(event, args.query);
        });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function suppressedFingerprints(): Promise<Array<string>> {
    const result: Set<string> =
      await MonitorMaintenanceSuppression.getSuppressedSeriesFingerprints({
        projectId: PROGRESS_PROJECT_ID,
        matchesPerSeries: PROGRESS_STATE_KEYS.map(seriesFor),
      });

    return Array.from(result).sort();
  }

  it("skips the series of a host under an ongoing event and under one in a state of the project's own between Ongoing and Ended", async () => {
    expect(await suppressedFingerprints()).toEqual(
      IN_PROGRESS_KEYS.map((key: ProgressStateKey): string => {
        return `fp-${key}`;
      }).sort(),
    );
  });

  it.each(NOT_IN_PROGRESS_KEYS)(
    "still raises the series of a host under an event in %s",
    async (key: ProgressStateKey) => {
      expect(await suppressedFingerprints()).not.toContain(`fp-${key}`);
    },
  );

  it("asks for the events by the states they are in progress in, within the project, not by the ongoing flag", async () => {
    await suppressedFingerprints();

    expect(eventQueries).toHaveLength(1);
    expect(eventQueries[0]!["projectId"]?.toString()).toBe(
      PROGRESS_PROJECT_ID.toString(),
    );
    expect(
      eventQueries[0]!["currentScheduledMaintenanceState"],
    ).toBeUndefined();
    expect(
      eventQueries[0]!["currentScheduledMaintenanceStateId"],
    ).toBeDefined();
  });
});
