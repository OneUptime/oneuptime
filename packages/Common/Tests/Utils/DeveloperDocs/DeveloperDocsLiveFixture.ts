import Dictionary from "../../../Types/Dictionary";
import {
  DeveloperDocsLiveData,
  DeveloperDocsLiveRecord,
  getEmptyDeveloperDocsLiveData,
} from "../../../Utils/DeveloperDocs/LiveData";

/*
 * A project as the Developer pages see it after their lookups: the records
 * a new project starts with (severities, states, monitor statuses) and one
 * or two of everything else, with fixed ids so tests can name them.
 */

export const FIXTURE_NOW: Date = new Date("2026-10-02T15:30:00.000Z");
export const FIXTURE_USER_ID: string = "0aa1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b";
export const FIXTURE_RECORD_ID: string = "99999999-9999-4999-8999-999999999999";

// `a0000001-0000-4000-8000-000000000001` and so on: a valid UUID, prefix in hex.
export function fixtureId(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(8 - prefix.length, "0")}-0000-4000-8000-${String(
    n,
  ).padStart(12, "0")}`;
}

function records(
  prefix: string,
  rows: Array<[string, Dictionary<boolean>?]>,
): Array<DeveloperDocsLiveRecord> {
  return rows.map(
    (
      [name, flags]: [string, Dictionary<boolean>?],
      index: number,
    ): DeveloperDocsLiveRecord => {
      return { id: fixtureId(prefix, index + 1), name, flags: flags || {} };
    },
  );
}

export const FIXTURE_RECORDS: Dictionary<Array<DeveloperDocsLiveRecord>> = {
  IncidentSeverity: records("a", [
    ["Critical Incident"],
    ["Major Incident"],
    ["Minor Incident"],
  ]),
  AlertSeverity: records("b", [["High"], ["Low"]]),
  IncidentState: records("c", [
    ["Identified", { isCreatedState: true }],
    ["Acknowledged", { isAcknowledgedState: true }],
    ["Resolved", { isResolvedState: true }],
  ]),
  AlertState: records("c1", [
    ["Identified", { isCreatedState: true }],
    ["Acknowledged", { isAcknowledgedState: true }],
    ["Resolved", { isResolvedState: true }],
  ]),
  ScheduledMaintenanceState: records("c2", [
    ["Scheduled", { isScheduledState: true }],
    ["Ongoing", { isOngoingState: true }],
    ["Ended", { isEndedState: true }],
    ["Completed", { isResolvedState: true }],
  ]),
  MonitorStatus: records("d", [
    ["Operational", { isOperationalState: true, isOfflineState: false }],
    ["Degraded", { isOperationalState: false, isOfflineState: false }],
    ["Offline", { isOperationalState: false, isOfflineState: true }],
  ]),
  Monitor: records("e", [["Checkout API"], ["Website"]]),
  Label: records("f", [["production"]]),
  Team: records("1", [["Platform"]]),
  StatusPage: records("2", [["Acme status"]]),
  MonitorGroup: records("3", [["Checkout"]]),
  OnCallDutyPolicySchedule: records("4", [["Primary rotation"]]),
  Probe: records("5", [["US East"]]),
  NetworkSite: records("6", [["Head office"]]),
};

// The project, with everything looked up and the viewer known.
export function getFixtureLiveData(): DeveloperDocsLiveData {
  const live: DeveloperDocsLiveData = {
    ...getEmptyDeveloperDocsLiveData(FIXTURE_NOW),
    records: { ...FIXTURE_RECORDS },
    currentUserId: FIXTURE_USER_ID,
  };

  for (const table of Object.keys(live.records)) {
    for (const record of live.records[table] || []) {
      if (record.name) {
        live.namesById[record.id] = record.name;
      }
    }
  }

  return live;
}

// A page that could look nothing up (no permission, or every lookup failed).
export function getEmptyFixtureLiveData(): DeveloperDocsLiveData {
  return getEmptyDeveloperDocsLiveData(FIXTURE_NOW);
}

// The id of a fixture record, by table and name.
export function fixtureRecordId(table: string, name: string): string {
  const record: DeveloperDocsLiveRecord | undefined = (
    FIXTURE_RECORDS[table] || []
  ).find((item: DeveloperDocsLiveRecord): boolean => {
    return item.name === name;
  });

  if (!record) {
    throw new Error(`No ${table} called ${name} in the fixture`);
  }

  return record.id;
}
