import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { ReactElement } from "react";

/*
 * A SELECTION'S STATE MOVE, FAST (issue #5299).
 *
 * A customer bulk-resolved 4,594 alerts and watched the progress bar move
 * five alerts in eleven seconds: each alert was read on its own, then moved,
 * one alert after the other. A bulk move now reads the selection's states a
 * window of fifty at a time - one list request each - and moves several
 * records at once: four for incidents, alerts and episodes, one at a time
 * for scheduled maintenance (its events share monitors and network sites).
 *
 * What each record gets is what it always got: one new row of its state
 * timeline, with the dialog's note and the subscriber flag, through the API,
 * and a record already there or past it is left alone, saying why.
 *
 * The real hook, dialog and runner are rendered, with the API layer
 * replaced by a fake that counts the requests, holds the writes in flight,
 * and answers from what the server holds.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Created {
  modelName: string;
  row: Record<string, string>;
  miscDataProps: Record<string, unknown> | undefined;
}

const created: Array<Created> = [];
// What the server holds for each record now: its current state.
let serverRecords: Record<string, Record<string, unknown>> = {};
// The list requests made for a selection's states, by the ids they named.
const listReads: Array<Array<string>> = [];
const itemReads: Array<string> = [];
// When true, a list request for the records fails.
let failListReads: boolean = false;
// Writes in flight now, and the most there ever were.
let writesInFlight: number = 0;
let mostWritesInFlight: number = 0;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (request: {
        query: Record<string, unknown>;
      }): Promise<unknown> => {
        const askedFor: unknown = request.query["_id"];

        // The note templates the dialog reads: none.
        if (!askedFor) {
          return { data: [], count: 0, skip: 0, limit: 10 };
        }

        const ids: Array<string> = (
          (askedFor as { values: Array<unknown> }).values || []
        ).map((id: unknown): string => {
          return String(id);
        });

        listReads.push(ids);

        if (failListReads) {
          throw new Error("The list could not be read.");
        }

        const rows: Array<Record<string, unknown>> = ids
          .filter((id: string): boolean => {
            return Boolean(serverRecords[id]);
          })
          .map((id: string): Record<string, unknown> => {
            return {
              _id: id,
              id: { toString: (): string => id },
              ...serverRecords[id],
            };
          });

        return { data: rows, count: rows.length, skip: 0, limit: ids.length };
      },
      getItem: async (request: {
        id: { toString: () => string };
      }): Promise<unknown> => {
        const id: string = request.id.toString();
        itemReads.push(id);

        return serverRecords[id] ? { _id: id, ...serverRecords[id] } : null;
      },
      create: async (request: {
        model: { tableName?: string | null } & Record<string, unknown>;
        miscDataProps?: Record<string, unknown>;
      }): Promise<unknown> => {
        writesInFlight++;
        mostWritesInFlight = Math.max(mostWritesInFlight, writesInFlight);

        // A write takes a moment, so several can be in flight at once.
        for (let i: number = 0; i < 5; i++) {
          await Promise.resolve();
        }

        const row: Record<string, string> = {};

        for (const key of [
          "alertId",
          "alertStateId",
          "scheduledMaintenanceId",
          "scheduledMaintenanceStateId",
          "projectId",
          "shouldStatusPageSubscribersBeNotified",
        ]) {
          if (request.model[key] !== undefined) {
            row[key] = String(request.model[key]);
          }
        }

        created.push({
          modelName: request.model.tableName || "",
          row: row,
          miscDataProps: request.miscDataProps,
        });

        writesInFlight--;

        return {};
      },
    },
  };
});

import useEventStateActions, {
  EventStateActionsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/useEventStateActions";
import {
  EVENT_STATE_KINDS,
  EventStateKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStateKinds";
import { BULK_ACTION_CONCURRENCY } from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import { BULK_READ_WINDOW_SIZE } from "../../../UI/Components/BulkUpdate/BulkReadAhead";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
  BulkActionStartOptions,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Permission from "../../../Types/Permission";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const IDENTIFIED: string = "a0000000-0000-4000-8000-000000000001";
const ACKNOWLEDGED: string = "a0000000-0000-4000-8000-000000000002";
const RESOLVED: string = "a0000000-0000-4000-8000-000000000003";

const SCHEDULED: string = "b0000000-0000-4000-8000-000000000001";
const ONGOING: string = "b0000000-0000-4000-8000-000000000002";
const ENDED: string = "b0000000-0000-4000-8000-000000000003";

function alertState(
  id: string,
  name: string,
  order: number,
  flags: Partial<AlertState>,
): AlertState {
  const state: AlertState = new AlertState();
  state._id = id;
  state.name = name;
  state.order = order;
  Object.assign(state, flags);
  return state;
}

const ALERT_STATES: Array<AlertState> = [
  alertState(IDENTIFIED, "Identified", 1, { isCreatedState: true }),
  alertState(ACKNOWLEDGED, "Acknowledged", 2, { isAcknowledgedState: true }),
  alertState(RESOLVED, "Resolved", 3, { isResolvedState: true }),
];

function maintenanceState(
  id: string,
  name: string,
  order: number,
  flags: Partial<ScheduledMaintenanceState>,
): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = id;
  state.name = name;
  state.order = order;
  Object.assign(state, flags);
  return state;
}

const MAINTENANCE_STATES: Array<ScheduledMaintenanceState> = [
  maintenanceState(SCHEDULED, "Scheduled", 1, { isScheduledState: true }),
  maintenanceState(ONGOING, "Ongoing", 2, { isOngoingState: true }),
  maintenanceState(ENDED, "Ended", 3, { isEndedState: true }),
];

function stateLink(
  id: string,
  name: string,
  order: number,
): Record<string, unknown> {
  return { _id: id, name: name, order: order };
}

// The n-th record's id: a real uuid, as every id column now must be.
function recordId(n: number): string {
  return `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function alerts(count: number): Array<Alert> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    const alert: Alert = new Alert();
    alert._id = recordId(index + 1);
    alert.title = `Alert ${index + 1}`;
    // As the list read it: Identified, all of them.
    alert.currentAlertState = stateLink(
      IDENTIFIED,
      "Identified",
      1,
    ) as unknown as AlertState;
    return alert;
  });
}

function maintenanceEvents(count: number): Array<ScheduledMaintenance> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = recordId(index + 1);
    event.title = `Window ${index + 1}`;
    event.currentScheduledMaintenanceState = stateLink(
      SCHEDULED,
      "Scheduled",
      1,
    ) as unknown as ScheduledMaintenanceState;
    return event;
  });
}

interface Run<T extends BaseModel> {
  progress: Array<ProgressInfo<T>>;
  started: Array<BulkActionStartOptions | undefined>;
  ended: number;
  stop: () => void;
}

let latestActions: Array<BulkActionButtonSchema<BaseModel>> = [];

function BulkHarness<T extends BaseModel>(props: {
  kind: EventStateKind;
  states: Array<BaseModel>;
}): ReactElement {
  const { bulkActions, modals }: EventStateActionsResult<T> =
    useEventStateActions<T>({ kind: props.kind, states: props.states });

  latestActions = bulkActions as unknown as Array<
    BulkActionButtonSchema<BaseModel>
  >;

  return <>{modals}</>;
}

/*
 * Presses a bulk action on these records, as the bulk bar does, then the
 * dialog's button, and waits for the run to end.
 */
async function runBulkMove<T extends BaseModel>(data: {
  title: string;
  items: Array<T>;
  stopAfterWrites?: number | undefined;
}): Promise<Run<T>> {
  const stopController: AbortController = new AbortController();
  const run: Run<T> = {
    progress: [],
    started: [],
    ended: 0,
    stop: (): void => {
      stopController.abort();
    },
  };

  const actionProps: BulkActionOnClickProps<T> = {
    items: data.items,
    stopSignal: stopController.signal,
    onProgressInfo: (info: ProgressInfo<T>): void => {
      run.progress.push(info);

      if (
        data.stopAfterWrites !== undefined &&
        created.length >= data.stopAfterWrites
      ) {
        stopController.abort();
      }
    },
    onBulkActionStart: (options?: BulkActionStartOptions): void => {
      run.started.push(options);
    },
    onBulkActionEnd: (): void => {
      run.ended++;
    },
  };

  const action: BulkActionButtonSchema<BaseModel> | undefined =
    latestActions.find((candidate: BulkActionButtonSchema<BaseModel>) => {
      return candidate.title === data.title;
    });

  if (!action) {
    throw new Error(`No bulk action named ${data.title}`);
  }

  await act(async () => {
    await action.onClick(
      actionProps as unknown as BulkActionOnClickProps<BaseModel>,
    );
  });

  const modal: HTMLElement = await screen.findByTestId("modal");

  await act(async () => {
    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(
    () => {
      expect(run.ended).toBe(1);
    },
    { timeout: 20000 },
  );

  return run;
}

function lastProgress<T extends BaseModel>(run: Run<T>): ProgressInfo<T> {
  return run.progress[run.progress.length - 1]!;
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/alerts`);
  created.length = 0;
  listReads.length = 0;
  itemReads.length = 0;
  serverRecords = {};
  failListReads = false;
  writesInFlight = 0;
  mostWritesInFlight = 0;
  latestActions = [];
});

afterEach(() => {
  cleanup();
});

jest.setTimeout(60000);

function holdIdentified(items: Array<BaseModel>, column: string): void {
  for (const item of items) {
    serverRecords[item._id!.toString()] = {
      [column]: stateLink(IDENTIFIED, "Identified", 1),
    };
  }
}

describe("a bulk Resolve of alerts", () => {
  test("reads the selection's states fifty at a time, never one alert at a time", async () => {
    const selection: Array<Alert> = alerts(120);
    holdIdentified(selection, "currentAlertState");

    render(
      <BulkHarness<Alert> kind={EventStateKind.Alert} states={ALERT_STATES} />,
    );

    await runBulkMove<Alert>({ title: "Resolve", items: selection });

    expect(BULK_READ_WINDOW_SIZE).toBe(50);
    expect(
      listReads.map((ids: Array<string>) => {
        return ids.length;
      }),
    ).toEqual([50, 50, 20]);
    // Every alert named once, in the order selected.
    expect(listReads.flat()).toEqual(
      selection.map((alert: Alert) => {
        return alert._id;
      }),
    );
    expect(itemReads).toEqual([]);
  });

  test("moves each alert by one new row of its timeline, exactly as one alert's Resolve does", async () => {
    const selection: Array<Alert> = alerts(9);
    holdIdentified(selection, "currentAlertState");

    render(
      <BulkHarness<Alert> kind={EventStateKind.Alert} states={ALERT_STATES} />,
    );

    const run: Run<Alert> = await runBulkMove<Alert>({
      title: "Resolve",
      items: selection,
    });

    expect(created).toHaveLength(9);

    const rows: Array<Record<string, string>> = created
      .map((write: Created) => {
        return write.row;
      })
      .sort((a: Record<string, string>, b: Record<string, string>) => {
        return a["alertId"]!.localeCompare(b["alertId"]!);
      });

    expect(rows).toEqual(
      selection.map((alert: Alert) => {
        return {
          alertId: alert._id!,
          alertStateId: RESOLVED,
          projectId: PROJECT_ID,
        };
      }),
    );

    for (const write of created) {
      expect(write.modelName).toBe("AlertStateTimeline");
    }

    // Each listed as resolved, in the order selected.
    expect(
      lastProgress(run).successItems.map((alert: Alert) => {
        return alert._id;
      }),
    ).toEqual(
      selection.map((alert: Alert) => {
        return alert._id;
      }),
    );
    expect(lastProgress(run).failed).toEqual([]);
  });

  test(`moves ${BULK_ACTION_CONCURRENCY} alerts at once, no more`, async () => {
    const selection: Array<Alert> = alerts(24);
    holdIdentified(selection, "currentAlertState");

    render(
      <BulkHarness<Alert> kind={EventStateKind.Alert} states={ALERT_STATES} />,
    );

    await runBulkMove<Alert>({ title: "Resolve", items: selection });

    expect(EVENT_STATE_KINDS[EventStateKind.Alert].bulkConcurrency).toBe(
      BULK_ACTION_CONCURRENCY,
    );
    expect(mostWritesInFlight).toBe(BULK_ACTION_CONCURRENCY);
    expect(created).toHaveLength(24);
  });

  test("leaves an alert resolved meanwhile alone, saying why, and writes nothing for it", async () => {
    const selection: Array<Alert> = alerts(5);
    holdIdentified(selection, "currentAlertState");
    // Resolved by someone else since the list was read.
    serverRecords[selection[2]!._id!.toString()] = {
      currentAlertState: stateLink(RESOLVED, "Resolved", 3),
    };

    render(
      <BulkHarness<Alert> kind={EventStateKind.Alert} states={ALERT_STATES} />,
    );

    const run: Run<Alert> = await runBulkMove<Alert>({
      title: "Resolve",
      items: selection,
    });

    expect(created).toHaveLength(4);
    expect(
      created.some((write: Created) => {
        return write.row["alertId"] === selection[2]!._id;
      }),
    ).toBe(false);

    const unchanged: Array<BulkActionUnchanged<Alert>> =
      lastProgress(run).unchanged || [];
    expect(
      unchanged.map((entry: BulkActionUnchanged<Alert>) => {
        return entry.item._id;
      }),
    ).toEqual([selection[2]!._id]);
    expect(String(unchanged[0]!.reason)).toMatch(/resolved/i);
  });

  test("a window whose read fails reads its alerts one by one, and moves them all the same", async () => {
    const selection: Array<Alert> = alerts(6);
    holdIdentified(selection, "currentAlertState");
    failListReads = true;

    render(
      <BulkHarness<Alert> kind={EventStateKind.Alert} states={ALERT_STATES} />,
    );

    const run: Run<Alert> = await runBulkMove<Alert>({
      title: "Resolve",
      items: selection,
    });

    expect(listReads).toHaveLength(1);
    expect(itemReads.sort()).toEqual(
      selection
        .map((alert: Alert) => {
          return alert._id!;
        })
        .sort(),
    );
    expect(created).toHaveLength(6);
    expect(lastProgress(run).failed).toEqual([]);
  });

  test("can be stopped part-way: no alert is moved after the Stop, and the rest are listed as not started", async () => {
    const selection: Array<Alert> = alerts(40);
    holdIdentified(selection, "currentAlertState");

    render(
      <BulkHarness<Alert> kind={EventStateKind.Alert} states={ALERT_STATES} />,
    );

    const run: Run<Alert> = await runBulkMove<Alert>({
      title: "Resolve",
      items: selection,
      stopAfterWrites: 1,
    });

    expect(run.started).toEqual([{ isStoppable: true }]);

    const last: ProgressInfo<Alert> = lastProgress(run);
    const notStarted: Array<Alert> = last.notStartedItems || [];

    // The ones already running when Stop came finish; no others start.
    expect(created.length).toBeLessThanOrEqual(1 + BULK_ACTION_CONCURRENCY);
    expect(notStarted.length).toBe(selection.length - created.length);
    expect(last.successItems.length + notStarted.length).toBe(
      selection.length,
    );

    // Not one alert that was not started was written.
    const writtenIds: Set<string> = new Set(
      created.map((write: Created) => {
        return write.row["alertId"]!;
      }),
    );
    for (const alert of notStarted) {
      expect(writtenIds.has(alert._id!)).toBe(false);
    }
  });
});

describe("a bulk move of scheduled maintenance events", () => {
  test("moves one event at a time: they share monitors and network sites", async () => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/scheduled-maintenance-events`,
    );
    const selection: Array<ScheduledMaintenance> = maintenanceEvents(6);
    holdIdentified(selection, "currentScheduledMaintenanceState");
    for (const event of selection) {
      serverRecords[event._id!.toString()] = {
        currentScheduledMaintenanceState: stateLink(SCHEDULED, "Scheduled", 1),
      };
    }

    render(
      <BulkHarness<ScheduledMaintenance>
        kind={EventStateKind.ScheduledMaintenance}
        states={MAINTENANCE_STATES}
      />,
    );

    await runBulkMove<ScheduledMaintenance>({
      title: "Mark as Ongoing",
      items: selection,
    });

    expect(
      EVENT_STATE_KINDS[EventStateKind.ScheduledMaintenance].bulkConcurrency,
    ).toBe(1);
    expect(mostWritesInFlight).toBe(1);
    expect(created).toHaveLength(6);
    // Read a window at a time all the same.
    expect(listReads).toHaveLength(1);
    expect(itemReads).toEqual([]);
  });
});

describe("how many records each kind moves at once", () => {
  test("incidents, alerts and episodes several; scheduled maintenance one", () => {
    expect(
      Object.values(EVENT_STATE_KINDS).map(
        (kind: { kind: EventStateKind; bulkConcurrency: number }) => {
          return [kind.kind, kind.bulkConcurrency];
        },
      ),
    ).toEqual([
      [EventStateKind.Incident, BULK_ACTION_CONCURRENCY],
      [EventStateKind.Alert, BULK_ACTION_CONCURRENCY],
      [EventStateKind.IncidentEpisode, BULK_ACTION_CONCURRENCY],
      [EventStateKind.AlertEpisode, BULK_ACTION_CONCURRENCY],
      [EventStateKind.ScheduledMaintenance, 1],
    ]);
  });
});
