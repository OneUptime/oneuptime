import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import DataTableAnswerer, {
  DataTableAnswer,
} from "../../../../Server/Utils/DataObservability/DataTableAnswer";
import DataTableDashboards from "../../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataProductService from "../../../../Server/Services/DataProductService";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import ObjectID from "../../../../Types/ObjectID";
import {
  StoredRow,
  rowMatchesWhere,
} from "../../TestingUtils/InMemoryRepository";

/*
 * "IS THIS TABLE FRESH?" NAMES ONLY THE TABLE'S ALERTS STILL OPEN.
 *
 * An alert is resolved when its state is at or below its project's resolved
 * state, or carries the resolved flag (Common/Utils/ResolvedState). The
 * answer used to read the flag alone, so an alert moved on to a state the
 * project placed after Resolved - "Closed" - was told to Ask AI, Slack and
 * Teams as an open alert on the table. It asks for the alerts in the
 * project's open states now (AlertStateService.getUnresolvedAlertStateIds),
 * the states read as the project orders them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ASSET_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

const CREATED: string = "33333333-3333-4333-8333-000000000001";
const ACKNOWLEDGED: string = "33333333-3333-4333-8333-000000000002";
const RESOLVED: string = "33333333-3333-4333-8333-000000000003";
// A state of the project's own, placed after Resolved, without the flag.
const CLOSED: string = "33333333-3333-4333-8333-000000000004";

function state(
  id: string,
  name: string,
  order: number,
  flags: Partial<
    Pick<
      AlertState,
      "isCreatedState" | "isAcknowledgedState" | "isResolvedState"
    >
  > = {},
): AlertState {
  const alertState: AlertState = new AlertState();
  alertState._id = id;
  alertState.name = name;
  alertState.order = order;
  alertState.isCreatedState = flags.isCreatedState === true;
  alertState.isAcknowledgedState = flags.isAcknowledgedState === true;
  alertState.isResolvedState = flags.isResolvedState === true;

  return alertState;
}

const STATES: Array<AlertState> = [
  state(CREATED, "Created", 1, { isCreatedState: true }),
  state(ACKNOWLEDGED, "Acknowledged", 2, { isAcknowledgedState: true }),
  state(RESOLVED, "Resolved", 3, { isResolvedState: true }),
  state(CLOSED, "Closed", 4),
];

// The table's alerts, newest first, each in one of the states above.
const ALERTS: Array<StoredRow> = [
  ["44444444-4444-4444-8444-000000000004", 4, CLOSED, "Closed"],
  ["44444444-4444-4444-8444-000000000003", 3, RESOLVED, "Resolved"],
  ["44444444-4444-4444-8444-000000000002", 2, ACKNOWLEDGED, "Acknowledged"],
  ["44444444-4444-4444-8444-000000000001", 1, CREATED, "Created"],
].map(([id, number, stateId, stateName]: Array<string | number>): StoredRow => {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    title: `orders is late (${stateName})`,
    alertNumberWithPrefix: `ALT-${number}`,
    currentAlertStateId: stateId,
    currentAlertState: {
      name: stateName,
      isResolvedState: stateId === RESOLVED,
    },
  };
});

function toAlert(row: StoredRow): Alert {
  const alert: Alert = new Alert();

  for (const [column, value] of Object.entries(row)) {
    (alert as unknown as StoredRow)[column] = value;
  }

  return alert;
}

let statesRead: SpyInstance<typeof AlertStateService.getAllAlertStates>;
let alertsRead: SpyInstance<typeof AlertService.findBy>;

function stubTable(alertIds: Array<string>): void {
  const asset: DataAsset = new DataAsset();
  asset._id = ASSET_ID.toString();
  asset.assetKey = "public.orders";
  asset.dataStoreName = "Orders DB";
  asset.assetKind = DataAssetKind.Table;
  asset.lastChangedAt = new Date("2026-11-04T09:00:00.000Z");
  asset.updateIntervalInSeconds = 900;
  asset.isDropped = false;

  jest.spyOn(DataAssetService, "findOneBy").mockResolvedValue(asset as never);
  jest.spyOn(DataAlertService, "findBy").mockResolvedValue(
    alertIds.map((id: string): DataAlert => {
      const row: DataAlert = new DataAlert();
      row.alertId = new ObjectID(id);

      return row;
    }) as never,
  );
  jest.spyOn(DataAssetLineageService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataProductService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataTableDashboards, "find").mockResolvedValue([] as never);

  statesRead = jest
    .spyOn(AlertStateService, "getAllAlertStates")
    .mockResolvedValue(STATES as never);

  // The alerts the query names, as the database reads it.
  alertsRead = jest
    .spyOn(AlertService, "findBy")
    .mockImplementation((async (findBy: {
      query: unknown;
    }): Promise<Array<Alert>> => {
      return ALERTS.filter((row: StoredRow): boolean => {
        return rowMatchesWhere(row, findBy.query);
      }).map(toAlert);
    }) as never);
}

async function openAlertsOf(
  alertIds: Array<string>,
): Promise<DataTableAnswer["openAlerts"]> {
  stubTable(alertIds);

  const answer: DataTableAnswer | null = await DataTableAnswerer.answer(
    PROJECT_ID,
    ASSET_ID,
    NOW,
  );

  expect(answer).not.toBeNull();

  return answer!.openAlerts;
}

describe("a table's open alerts, in the answer", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("are its alerts in a state that is not resolved, and none past Resolved, flagged or not", async () => {
    const open: DataTableAnswer["openAlerts"] = await openAlertsOf(
      ALERTS.map((row: StoredRow): string => {
        return String(row["_id"]);
      }),
    );

    expect(
      open.map((alert: DataTableAnswer["openAlerts"][number]) => {
        return [alert.number, alert.state];
      }),
    ).toEqual([
      ["ALT-2", "Acknowledged"],
      ["ALT-1", "Created"],
    ]);
  });

  test("a table whose alerts are all over has none open", async () => {
    const open: DataTableAnswer["openAlerts"] = await openAlertsOf([
      String(ALERTS[0]!["_id"]),
      String(ALERTS[1]!["_id"]),
    ]);

    expect(open).toEqual([]);
  });

  test("the project's states are read as the project orders them, once", async () => {
    await openAlertsOf([String(ALERTS[3]!["_id"])]);

    expect(statesRead).toHaveBeenCalledTimes(1);
    expect(statesRead.mock.calls[0]![0].projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a table with no data alert reads neither alerts nor states", async () => {
    const open: DataTableAnswer["openAlerts"] = await openAlertsOf([]);

    expect(open).toEqual([]);
    expect(alertsRead).not.toHaveBeenCalled();
    expect(statesRead).not.toHaveBeenCalled();
  });
});
