import MonitorService, {
  MonitorProbeFlagChanges,
} from "../../../Server/Services/MonitorService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import ProbeService from "../../../Server/Services/ProbeService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import EmailRollupWriter from "../../../Server/Utils/EmailRollup/EmailRollupWriter";
import logger from "../../../Server/Utils/Logger";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";

/*
 * https://github.com/OneUptime/oneuptime/issues/2486
 *
 * A self-hosted user with ~20 monitors on one global probe got ~40 emails
 * every time the probe restarted: one "Probes for monitor X are Disconnected"
 * per monitor when the probe went quiet, and one "... are Connected" per
 * monitor when it came back. The probe's status flip ran
 * MonitorService.refreshProbeStatus, which refreshed every monitor on the
 * probe and let each one announce itself, per owner, on every channel.
 *
 * The event is the probe's, so the message is too. refreshProbeStatus now
 * re-derives every monitor's flags first, then sends ONE message per person
 * per project that names the probe and lists the monitors of theirs it took
 * down (or brought back). One restart costs a recipient 2 messages, not 2N.
 *
 * What is pinned here, all against the real MonitorService singleton with its
 * database reads and writes stubbed:
 *   - the issue itself, end to end through the real syncMonitorProbeFlags;
 *   - who receives the grouped message (monitor owners, project owners for
 *     unowned monitors, one pass per project for a shared probe);
 *   - which changes are grouped and which keep the per-monitor message
 *     (opposite-direction flips, monitors whose row for the probe is
 *     disabled, no-probe-enabled flips, an unknown probe);
 *   - that one failure (a sync, an owner lookup, a send) does not silence
 *     everybody else;
 *   - the message's shape: event type, template, count, links (the list link
 *     names the probe, so the email rollup keeps two probes apart), the
 *     25-row email cap, and the monitorId tag only for a one-monitor message;
 *   - bounded fan-out, so a probe with thousands of monitors cannot exhaust
 *     the connection pool.
 *
 * Billing is pinned off (CI's config.env turns it on): the issue is the
 * self-hosted one, and with billing on syncMonitorProbeFlags deliberately
 * ignores global probes.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

type SendUserNotificationArgs = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

interface ListedMonitor {
  monitorName: string;
  monitorViewLink: string;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const PROBE_NAME: string = "Self Hosted Probe";
const PROJECT_NAME: string = "Alpha";
const OTHER_PROJECT_NAME: string = "Beta";

type MakeIdFunction = (group: string, n: number) => ObjectID;

const makeId: MakeIdFunction = (group: string, n: number): ObjectID => {
  return new ObjectID(
    `${group}-0000-4000-8000-${n.toString().padStart(12, "0")}`,
  );
};

type MakeMonitorFunction = (
  n: number,
  projectId?: ObjectID,
  projectName?: string,
) => Monitor;

// Names are zero-padded so name order is number order.
const makeMonitor: MakeMonitorFunction = (
  n: number,
  projectId: ObjectID = PROJECT_ID,
  projectName: string = PROJECT_NAME,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.id = makeId("aaaaaaaa", n);
  monitor.name = `Monitor ${n.toString().padStart(3, "0")}`;
  monitor.projectId = projectId;

  const project: Project = new Project();
  project.name = projectName;
  monitor.project = project;

  return monitor;
};

type MakeMonitorsFunction = (
  from: number,
  count: number,
  projectId?: ObjectID,
  projectName?: string,
) => Array<Monitor>;

const makeMonitors: MakeMonitorsFunction = (
  from: number,
  count: number,
  projectId: ObjectID = PROJECT_ID,
  projectName: string = PROJECT_NAME,
): Array<Monitor> => {
  const monitors: Array<Monitor> = [];

  for (let n: number = from; n < from + count; n++) {
    monitors.push(makeMonitor(n, projectId, projectName));
  }

  return monitors;
};

type MakeUserFunction = (n: number) => User;

const makeUser: MakeUserFunction = (n: number): User => {
  const user: User = new User();
  user.id = makeId("bbbbbbbb", n);
  return user;
};

type MakeProbeFunction = (status: ProbeConnectionStatus | null) => Probe;

const makeProbe: MakeProbeFunction = (
  status: ProbeConnectionStatus | null,
): Probe => {
  const probe: Probe = new Probe();
  probe.id = PROBE_ID;
  probe.name = PROBE_NAME;

  if (status === null) {
    // What the database hands back for a probe that never reported.
    (probe as unknown as { connectionStatus: null }).connectionStatus = null;
  } else {
    probe.connectionStatus = status;
  }

  return probe;
};

type MakeMonitorProbeRowFunction = (
  monitorId?: ObjectID,
  isEnabled?: boolean,
) => MonitorProbe;

/*
 * A monitor's row for PROBE_ID. Enabled unless said otherwise: only a monitor
 * whose row for the probe is enabled uses the probe, and only those are
 * grouped under its name.
 */
const makeMonitorProbeRow: MakeMonitorProbeRowFunction = (
  monitorId?: ObjectID,
  isEnabled: boolean = true,
): MonitorProbe => {
  const row: MonitorProbe = new MonitorProbe();
  row.probeId = PROBE_ID;
  row.isEnabled = isEnabled;

  if (monitorId) {
    row.monitorId = monitorId;
  }

  return row;
};

/*
 * QueryHelper.any builds a TypeORM Raw operator whose parameters hold the ids
 * as strings. Reading them back lets the findBy stub answer only for the
 * monitors the service actually asked about.
 */
type IdsFromAnyQueryFunction = (operator: unknown) => Array<string>;

const idsFromAnyQuery: IdsFromAnyQueryFunction = (
  operator: unknown,
): Array<string> => {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      .objectLiteralParameters || {};

  const ids: Array<string> = [];

  for (const value of Object.values(parameters)) {
    if (Array.isArray(value)) {
      for (const id of value) {
        ids.push(String(id));
      }
    }
  }

  return ids;
};

type WaitATickFunction = () => Promise<void>;

// Yields to the event loop, so concurrently started work overlaps.
const waitATick: WaitATickFunction = (): Promise<void> => {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
};

/*
 * Everything the stubs answer from. Tests describe a scenario by filling
 * this in; the stubs below read it.
 */
interface World {
  // What ProbeService.findOneById returns for PROBE_ID.
  probe: Probe | null;
  // The MonitorProbe rows attaching monitors to PROBE_ID.
  monitorProbeRows: Array<MonitorProbe>;
  // Monitor rows MonitorService.findBy can return (the grouped lookup).
  monitors: Array<Monitor>;
  // What the stubbed syncMonitorProbeFlags reports. Missing = no change.
  flagChanges: Map<string, MonitorProbeFlagChanges | null | Error>;
  // MonitorService.findOwners. Missing = no owners.
  owners: Map<string, Array<User> | Error>;
  // ProjectService.getOwners. Missing = none.
  projectOwners: Map<string, Array<User>>;
  // sendUserNotification rejects for these user ids.
  failingRecipientIds: Set<string>;
  // Monitors that also have a second, connected, enabled probe.
  monitorsWithAnotherConnectedProbe: Set<string>;
  /*
   * Monitors whose row for PROBE_ID is disabled, as the real flag sync reads
   * it (the monitorId query). attach(monitors, false) fills it.
   */
  monitorsWithThisProbeDisabled: Set<string>;
}

let world: World;

// Successful sends, in call order.
let sent: Array<SendUserNotificationArgs>;

let syncInFlight: number;
let maxSyncInFlight: number;
let ownersInFlight: number;
let maxOwnersInFlight: number;

let syncSpy: jest.SpyInstance<any, any>;
let monitorProbeFindBySpy: jest.SpyInstance<any, any>;
let probeFindOneByIdSpy: jest.SpyInstance<any, any>;
let monitorFindBySpy: jest.SpyInstance<any, any>;
let findOwnersSpy: jest.SpyInstance<any, any>;
let projectOwnersSpy: jest.SpyInstance<any, any>;
let sendSpy: jest.SpyInstance<any, any>;
let perMonitorProbeStatusSpy: jest.SpyInstance<any, any>;
let perMonitorNoProbeSpy: jest.SpyInstance<any, any>;
let loggerErrorSpy: jest.SpyInstance<any, any>;

type AttachFunction = (monitors: Array<Monitor>, isEnabled?: boolean) => void;

/*
 * Attaches the monitors to PROBE_ID and makes them findable. With isEnabled
 * false the row exists but is disabled: the monitor is still synced when the
 * probe changes status, but does not use the probe.
 */
const attach: AttachFunction = (
  monitors: Array<Monitor>,
  isEnabled: boolean = true,
): void => {
  for (const monitor of monitors) {
    world.monitors.push(monitor);
    world.monitorProbeRows.push(makeMonitorProbeRow(monitor.id!, isEnabled));

    if (!isEnabled) {
      world.monitorsWithThisProbeDisabled.add(monitor.id!.toString());
    }
  }
};

type FlipFunction = (
  monitors: Array<Monitor>,
  isAllProbesDisconnected: boolean,
) => void;

// Makes the stubbed sync report that these monitors' flag flipped.
const flip: FlipFunction = (
  monitors: Array<Monitor>,
  isAllProbesDisconnected: boolean,
): void => {
  for (const monitor of monitors) {
    world.flagChanges.set(monitor.id!.toString(), {
      monitorId: monitor.id!,
      isAllProbesDisconnectedFromThisMonitor: isAllProbesDisconnected,
    });
  }
};

type SetOwnersFunction = (
  monitors: Array<Monitor>,
  owners: Array<User>,
) => void;

const setOwners: SetOwnersFunction = (
  monitors: Array<Monitor>,
  owners: Array<User>,
): void => {
  for (const monitor of monitors) {
    world.owners.set(monitor.id!.toString(), owners);
  }
};

type ListedFunction = (args: SendUserNotificationArgs) => Array<ListedMonitor>;

const listed: ListedFunction = (
  args: SendUserNotificationArgs,
): Array<ListedMonitor> => {
  return (
    (args.emailEnvelope.vars["monitors"] as unknown as Array<ListedMonitor>) ||
    []
  );
};

type ListedNamesFunction = (args: SendUserNotificationArgs) => Array<string>;

const listedNames: ListedNamesFunction = (
  args: SendUserNotificationArgs,
): Array<string> => {
  return listed(args).map((monitor: ListedMonitor): string => {
    return monitor.monitorName;
  });
};

type NamesOfFunction = (monitors: Array<Monitor>) => Array<string>;

const namesOf: NamesOfFunction = (monitors: Array<Monitor>): Array<string> => {
  return monitors.map((monitor: Monitor): string => {
    return monitor.name!;
  });
};

type SentToFunction = (user: User) => Array<SendUserNotificationArgs>;

const sentTo: SentToFunction = (
  user: User,
): Array<SendUserNotificationArgs> => {
  return sent.filter((args: SendUserNotificationArgs): boolean => {
    return args.userId.toString() === user.id!.toString();
  });
};

type OnlyMessageToFunction = (user: User) => SendUserNotificationArgs;

const onlyMessageTo: OnlyMessageToFunction = (
  user: User,
): SendUserNotificationArgs => {
  const messages: Array<SendUserNotificationArgs> = sentTo(user);
  expect(messages).toHaveLength(1);
  return messages[0]!;
};

type LoggedMessagesFunction = () => Array<string>;

const loggedErrors: LoggedMessagesFunction = (): Array<string> => {
  return loggerErrorSpy.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
};

type ToIdStringsFunction = (ids: Array<ObjectID>) => Array<string>;

const toIdStrings: ToIdStringsFunction = (
  ids: Array<ObjectID>,
): Array<string> => {
  return ids.map((id: ObjectID): string => {
    return id.toString();
  });
};

type SyncedMonitorIdsFunction = () => Array<string>;

const syncedMonitorIds: SyncedMonitorIdsFunction = (): Array<string> => {
  return syncSpy.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
};

describe("MonitorService probe status notifications (issue #2486)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);

    world = {
      probe: makeProbe(ProbeConnectionStatus.Disconnected),
      monitorProbeRows: [],
      monitors: [],
      flagChanges: new Map(),
      owners: new Map(),
      projectOwners: new Map(),
      failingRecipientIds: new Set(),
      monitorsWithAnotherConnectedProbe: new Set(),
      monitorsWithThisProbeDisabled: new Set(),
    };
    sent = [];
    syncInFlight = 0;
    maxSyncInFlight = 0;
    ownersInFlight = 0;
    maxOwnersInFlight = 0;

    monitorProbeFindBySpy = getJestSpyOn(
      MonitorProbeService,
      "findBy",
    ).mockImplementation(async (findBy: any): Promise<Array<MonitorProbe>> => {
      // refreshProbeStatus: every monitor on the probe.
      if (findBy.query.probeId) {
        return world.monitorProbeRows;
      }

      // The real syncMonitorProbeFlags: one monitor's probes.
      const monitorId: string = findBy.query.monitorId.toString();

      const probe: Probe = new Probe();
      probe.isGlobalProbe = true;

      if (world.probe?.connectionStatus) {
        probe.connectionStatus = world.probe.connectionStatus;
      }

      const row: MonitorProbe = new MonitorProbe();
      row.monitorId = new ObjectID(monitorId);
      row.probeId = PROBE_ID;
      row.isEnabled = !world.monitorsWithThisProbeDisabled.has(monitorId);
      row.probe = probe;

      const rows: Array<MonitorProbe> = [row];

      if (world.monitorsWithAnotherConnectedProbe.has(monitorId)) {
        const otherProbe: Probe = new Probe();
        otherProbe.isGlobalProbe = false;
        otherProbe.connectionStatus = ProbeConnectionStatus.Connected;

        const otherRow: MonitorProbe = new MonitorProbe();
        otherRow.monitorId = new ObjectID(monitorId);
        otherRow.probeId = OTHER_PROBE_ID;
        otherRow.isEnabled = true;
        otherRow.probe = otherProbe;

        rows.push(otherRow);
      }

      return rows;
    });

    probeFindOneByIdSpy = getJestSpyOn(
      ProbeService,
      "findOneById",
    ).mockImplementation(async (): Promise<Probe | null> => {
      return world.probe;
    });

    syncSpy = getJestSpyOn(
      MonitorService,
      "syncMonitorProbeFlags",
    ).mockImplementation(
      async (monitorId: ObjectID): Promise<MonitorProbeFlagChanges | null> => {
        syncInFlight++;
        maxSyncInFlight = Math.max(maxSyncInFlight, syncInFlight);

        try {
          await waitATick();

          const key: string = monitorId.toString();

          if (!world.flagChanges.has(key)) {
            return { monitorId: monitorId };
          }

          const changes: MonitorProbeFlagChanges | null | Error | undefined =
            world.flagChanges.get(key);

          if (changes instanceof Error) {
            throw changes;
          }

          return changes || null;
        } finally {
          syncInFlight--;
        }
      },
    );

    monitorFindBySpy = getJestSpyOn(
      MonitorService,
      "findBy",
    ).mockImplementation(async (findBy: any): Promise<Array<Monitor>> => {
      const requested: Array<string> = idsFromAnyQuery(findBy.query._id);

      return world.monitors.filter((monitor: Monitor): boolean => {
        return requested.includes(monitor.id!.toString());
      });
    });

    findOwnersSpy = getJestSpyOn(
      MonitorService,
      "findOwners",
    ).mockImplementation(async (monitorId: ObjectID): Promise<Array<User>> => {
      ownersInFlight++;
      maxOwnersInFlight = Math.max(maxOwnersInFlight, ownersInFlight);

      try {
        await waitATick();

        const owners: Array<User> | Error | undefined = world.owners.get(
          monitorId.toString(),
        );

        if (owners instanceof Error) {
          throw owners;
        }

        return owners || [];
      } finally {
        ownersInFlight--;
      }
    });

    projectOwnersSpy = getJestSpyOn(
      ProjectService,
      "getOwners",
    ).mockImplementation(async (projectId: ObjectID): Promise<Array<User>> => {
      return world.projectOwners.get(projectId.toString()) || [];
    });

    sendSpy = getJestSpyOn(
      UserNotificationSettingService,
      "sendUserNotification",
    ).mockImplementation(
      async (args: SendUserNotificationArgs): Promise<void> => {
        if (world.failingRecipientIds.has(args.userId.toString())) {
          throw new Error("notification provider is down");
        }

        sent.push(args);
      },
    );

    perMonitorProbeStatusSpy = getJestSpyOn(
      MonitorService,
      "notifyOwnersProbesDisconnected",
    ).mockResolvedValue(undefined);

    perMonitorNoProbeSpy = getJestSpyOn(
      MonitorService,
      "notifyOwnersWhenNoProbeIsEnabled",
    ).mockResolvedValue(undefined);

    loggerErrorSpy = getJestSpyOn(logger, "error").mockImplementation(
      (): void => {
        // Silenced; tests that care read the calls.
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the issue, end to end through the real flag sync", () => {
    /*
     * The reporter's setup: 20 monitors, all on the one global probe that
     * ships with a self-hosted install, no monitor owners, one project
     * owner. syncMonitorProbeFlags runs for real here; only its database
     * reads and writes are stubbed, backed by a small in-memory flag store.
     */
    let isAllProbesDisconnected: Map<string, boolean>;
    let flagWrites: Array<{ monitorId: string; value: boolean }>;
    let monitors: Array<Monitor>;
    const projectOwner: User = makeUser(1);

    beforeEach(() => {
      // The real method, not the stub installed above.
      syncSpy.mockRestore();

      isAllProbesDisconnected = new Map();
      flagWrites = [];

      monitors = makeMonitors(1, 20);
      attach(monitors);

      for (const monitor of monitors) {
        isAllProbesDisconnected.set(monitor.id!.toString(), false);
      }

      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      getJestSpyOn(MonitorService, "findOneById").mockImplementation(
        async (findOneById: any): Promise<Monitor | null> => {
          const key: string = findOneById.id.toString();
          const flag: boolean | undefined = isAllProbesDisconnected.get(key);

          if (flag === undefined) {
            return null;
          }

          const monitor: Monitor = new Monitor();
          monitor.id = new ObjectID(key);
          monitor.monitorType = MonitorType.Ping;
          monitor.isAllProbesDisconnectedFromThisMonitor = flag;
          monitor.isNoProbeEnabledOnThisMonitor = false;

          return monitor;
        },
      );

      getJestSpyOn(MonitorService, "updateOneById").mockImplementation(
        async (updateOneById: any): Promise<void> => {
          const value: unknown =
            updateOneById.data.isAllProbesDisconnectedFromThisMonitor;

          if (typeof value === "boolean") {
            const key: string = updateOneById.id.toString();
            flagWrites.push({ monitorId: key, value: value });
            isAllProbesDisconnected.set(key, value);
          }
        },
      );
    });

    test("a probe disconnect sends ONE message listing all 20 monitors, not 20 messages", async () => {
      world.probe = makeProbe(ProbeConnectionStatus.Disconnected);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      // Every monitor's flag was still written: the banners stay correct.
      expect(flagWrites).toHaveLength(20);
      expect(
        flagWrites.every((write: { value: boolean }): boolean => {
          return write.value === true;
        }),
      ).toBe(true);

      // ...but the project owner hears about it once.
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(perMonitorProbeStatusSpy).not.toHaveBeenCalled();
      expect(perMonitorNoProbeSpy).not.toHaveBeenCalled();

      const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);

      expect(message.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(message.eventType).toBe(
        NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
      );
      expect(message.emailEnvelope.templateType).toBe(
        EmailTemplateType.MonitorsAffectedByProbeStatus,
      );
      expect(message.emailEnvelope.vars["monitorCount"]).toBe("20");
      expect(message.emailEnvelope.vars["probeStatus"]).toBe("Disconnected");
      expect(listedNames(message)).toEqual(namesOf(monitors));
      expect(message.emailEnvelope.subject).toContain(PROBE_NAME);
      expect(message.emailEnvelope.subject).toContain("20 monitors");
      expect(message.emailEnvelope.subject).toContain("Disconnected");

      // A 20-monitor message is not about any one monitor.
      expect(message.monitorId).toBeUndefined();

      // The short channels name the probe and the count too.
      expect(message.smsMessage.message).toContain(PROBE_NAME);
      expect(message.smsMessage.message).toContain("20 monitors");
    });

    test("the reconnect sends ONE 'connected' message, so a restart costs 2 messages instead of 40", async () => {
      world.probe = makeProbe(ProbeConnectionStatus.Disconnected);
      await MonitorService.refreshProbeStatus(PROBE_ID);

      world.probe = makeProbe(ProbeConnectionStatus.Connected);
      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(perMonitorProbeStatusSpy).not.toHaveBeenCalled();

      // The flags went down and came back up for every monitor.
      expect(flagWrites).toHaveLength(40);
      expect(
        Array.from(isAllProbesDisconnected.values()).every(
          (flag: boolean): boolean => {
            return flag === false;
          },
        ),
      ).toBe(true);

      const messages: Array<SendUserNotificationArgs> = sentTo(projectOwner);
      expect(messages).toHaveLength(2);

      const reconnect: SendUserNotificationArgs = messages[1]!;

      expect(reconnect.eventType).toBe(
        NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
      );
      expect(reconnect.emailEnvelope.templateType).toBe(
        EmailTemplateType.MonitorsAffectedByProbeStatus,
      );
      expect(reconnect.emailEnvelope.vars["probeStatus"]).toBe("Connected");
      expect(reconnect.emailEnvelope.vars["monitorCount"]).toBe("20");
      expect(reconnect.emailEnvelope.subject).toContain(PROBE_NAME);
      expect(reconnect.emailEnvelope.subject).toContain("Connected");
      expect(reconnect.emailEnvelope.subject).not.toContain("Disconnected");
      expect(listedNames(reconnect)).toEqual(namesOf(monitors));
      expect(reconnect.monitorId).toBeUndefined();
    });

    test("a probe that stays disconnected is not announced again on the next refresh", async () => {
      world.probe = makeProbe(ProbeConnectionStatus.Disconnected);

      await MonitorService.refreshProbeStatus(PROBE_ID);
      await MonitorService.refreshProbeStatus(PROBE_ID);

      // The second pass found every flag already set: nothing to say.
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(flagWrites).toHaveLength(20);
    });

    test("monitors still covered by another connected probe are not listed", async () => {
      const covered: Array<Monitor> = monitors.slice(0, 2);

      for (const monitor of covered) {
        world.monitorsWithAnotherConnectedProbe.add(monitor.id!.toString());
      }

      world.probe = makeProbe(ProbeConnectionStatus.Disconnected);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);

      expect(message.emailEnvelope.vars["monitorCount"]).toBe("18");
      expect(listedNames(message)).toEqual(namesOf(monitors.slice(2)));

      for (const monitor of covered) {
        expect(isAllProbesDisconnected.get(monitor.id!.toString())).toBe(false);
      }
    });

    test("a monitor that does not use the probe (its row is disabled) is not announced as brought back by it", async () => {
      /*
       * The monitor's row for this probe is disabled; it is checked by
       * another probe, which is connected, but its "all disconnected" flag
       * is stale. This probe reconnecting re-derives the flag, and it
       * clears. The flag moved the same way as the probe, but the probe had
       * nothing to do with it: the monitor never used it.
       */
      const notUsing: Monitor = monitors[0]!;
      const key: string = notUsing.id!.toString();

      for (const row of world.monitorProbeRows) {
        if (row.monitorId?.toString() === key) {
          row.isEnabled = false;
        }
      }

      world.monitorsWithThisProbeDisabled.add(key);
      world.monitorsWithAnotherConnectedProbe.add(key);
      isAllProbesDisconnected.set(key, true);
      world.probe = makeProbe(ProbeConnectionStatus.Connected);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      // The stale flag was corrected...
      expect(flagWrites).toEqual([{ monitorId: key, value: false }]);

      // ...and announced on its own, without naming this probe.
      expect(perMonitorProbeStatusSpy).toHaveBeenCalledTimes(1);
      expect(perMonitorProbeStatusSpy).toHaveBeenCalledWith({
        monitorId: notUsing.id,
        isProbeDisconnected: false,
      });
      expect(monitorFindBySpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe("who receives the grouped message", () => {
    test("each monitor owner hears only about their own monitors, and project owners are not looked up", async () => {
      const ownerA: User = makeUser(1);
      const ownerB: User = makeUser(2);
      const monitors: Array<Monitor> = makeMonitors(1, 3);

      attach(monitors);
      flip(monitors, true);
      setOwners(monitors.slice(0, 2), [ownerA]);
      setOwners(monitors.slice(2), [ownerB]);
      world.projectOwners.set(PROJECT_ID.toString(), [makeUser(9)]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(listedNames(onlyMessageTo(ownerA))).toEqual(
        namesOf(monitors.slice(0, 2)),
      );
      expect(listedNames(onlyMessageTo(ownerB))).toEqual(
        namesOf(monitors.slice(2)),
      );

      // Every monitor has owners, so the project owners are not involved.
      expect(projectOwnersSpy).not.toHaveBeenCalled();
      expect(sentTo(makeUser(9))).toHaveLength(0);
    });

    test("a monitor with no owners goes to the project owners, the same fallback as the per-monitor message", async () => {
      const monitorOwner: User = makeUser(1);
      const projectOwnerP: User = makeUser(2);
      const projectOwnerQ: User = makeUser(3);
      const owned: Monitor = makeMonitor(1);
      const unowned: Monitor = makeMonitor(2);

      attach([owned, unowned]);
      flip([owned, unowned], true);
      setOwners([owned], [monitorOwner]);
      world.projectOwners.set(PROJECT_ID.toString(), [
        projectOwnerP,
        projectOwnerQ,
      ]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(sendSpy).toHaveBeenCalledTimes(3);
      expect(listedNames(onlyMessageTo(monitorOwner))).toEqual([owned.name]);
      expect(listedNames(onlyMessageTo(projectOwnerP))).toEqual([unowned.name]);
      expect(listedNames(onlyMessageTo(projectOwnerQ))).toEqual([unowned.name]);
      expect(projectOwnersSpy).toHaveBeenCalledTimes(1);
      expect(String(projectOwnersSpy.mock.calls[0]![0])).toBe(
        PROJECT_ID.toString(),
      );
    });

    test("someone who owns one monitor and is project owner for an unowned one gets one message with both", async () => {
      const person: User = makeUser(1);
      const owned: Monitor = makeMonitor(1);
      const unowned: Monitor = makeMonitor(2);

      attach([owned, unowned]);
      flip([owned, unowned], true);
      setOwners([owned], [person]);
      world.projectOwners.set(PROJECT_ID.toString(), [person]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(listedNames(onlyMessageTo(person))).toEqual([
        owned.name,
        unowned.name,
      ]);
    });

    test("nothing is sent when the monitors have no owners and the project has none either", async () => {
      const monitors: Array<Monitor> = makeMonitors(1, 3);

      attach(monitors);
      flip(monitors, true);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(projectOwnersSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).not.toHaveBeenCalled();
      expect(perMonitorProbeStatusSpy).not.toHaveBeenCalled();
    });
  });

  describe("a shared probe serving several projects", () => {
    test("each project gets its own message, with its own project id and name and only its own monitors", async () => {
      const alphaOwner: User = makeUser(1);
      const betaOwner: User = makeUser(2);
      const ownerOfBoth: User = makeUser(3);
      const alphaMonitors: Array<Monitor> = makeMonitors(
        1,
        2,
        PROJECT_ID,
        PROJECT_NAME,
      );
      const betaMonitors: Array<Monitor> = makeMonitors(
        3,
        1,
        OTHER_PROJECT_ID,
        OTHER_PROJECT_NAME,
      );

      attach([...alphaMonitors, ...betaMonitors]);
      flip([...alphaMonitors, ...betaMonitors], true);
      world.projectOwners.set(PROJECT_ID.toString(), [alphaOwner, ownerOfBoth]);
      world.projectOwners.set(OTHER_PROJECT_ID.toString(), [
        betaOwner,
        ownerOfBoth,
      ]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(sendSpy).toHaveBeenCalledTimes(4);

      const alphaMessage: SendUserNotificationArgs = onlyMessageTo(alphaOwner);
      expect(alphaMessage.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(alphaMessage.emailEnvelope.vars["projectName"]).toBe(PROJECT_NAME);
      expect(listedNames(alphaMessage)).toEqual(namesOf(alphaMonitors));
      expect(alphaMessage.smsMessage.message).toContain(PROJECT_NAME);
      expect(alphaMessage.smsMessage.message).not.toContain(OTHER_PROJECT_NAME);
      expect(
        String(alphaMessage.emailEnvelope.vars["viewMonitorsLink"]),
      ).toContain(`/${PROJECT_ID.toString()}/`);

      const betaMessage: SendUserNotificationArgs = onlyMessageTo(betaOwner);
      expect(betaMessage.projectId.toString()).toBe(
        OTHER_PROJECT_ID.toString(),
      );
      expect(betaMessage.emailEnvelope.vars["projectName"]).toBe(
        OTHER_PROJECT_NAME,
      );
      expect(listedNames(betaMessage)).toEqual(namesOf(betaMonitors));
      expect(
        String(betaMessage.emailEnvelope.vars["viewMonitorsLink"]),
      ).toContain(`/${OTHER_PROJECT_ID.toString()}/`);

      // An owner of both projects gets one message per project, never mixed.
      const bothMessages: Array<SendUserNotificationArgs> = sentTo(ownerOfBoth);
      expect(bothMessages).toHaveLength(2);

      for (const message of bothMessages) {
        const expected: Array<Monitor> =
          message.projectId.toString() === PROJECT_ID.toString()
            ? alphaMonitors
            : betaMonitors;
        expect(listedNames(message)).toEqual(namesOf(expected));
      }

      expect(
        bothMessages
          .map((message: SendUserNotificationArgs): string => {
            return message.projectId.toString();
          })
          .sort(),
      ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort());
    });
  });

  describe("which changes are grouped under the probe", () => {
    test("only monitors whose flag flipped are listed; unchanged and non-probe monitors are left out", async () => {
      const projectOwner: User = makeUser(1);
      const flipped: Monitor = makeMonitor(1);
      const unchanged: Monitor = makeMonitor(2);
      const notProbeable: Monitor = makeMonitor(3);

      attach([flipped, unchanged, notProbeable]);
      flip([flipped], true);
      world.flagChanges.set(unchanged.id!.toString(), {
        monitorId: unchanged.id!,
      });
      world.flagChanges.set(notProbeable.id!.toString(), null);
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      // Every monitor on the probe was re-derived...
      expect(syncedMonitorIds().sort()).toEqual(
        toIdStrings([flipped.id!, unchanged.id!, notProbeable.id!]).sort(),
      );

      // ...but only the one that flipped was looked up and listed.
      expect(monitorFindBySpy).toHaveBeenCalledTimes(1);
      expect(
        idsFromAnyQuery(monitorFindBySpy.mock.calls[0]![0].query._id),
      ).toEqual([flipped.id!.toString()]);

      const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);
      expect(listedNames(message)).toEqual([flipped.name]);
      expect(message.emailEnvelope.vars["monitorCount"]).toBe("1");
    });

    test("nothing is sent when no monitor's flag changed (another probe still covers them)", async () => {
      const monitors: Array<Monitor> = makeMonitors(1, 3);

      attach(monitors);
      world.flagChanges.set(monitors[2]!.id!.toString(), null);
      world.projectOwners.set(PROJECT_ID.toString(), [makeUser(1)]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(syncSpy).toHaveBeenCalledTimes(3);
      expect(monitorFindBySpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
      expect(perMonitorProbeStatusSpy).not.toHaveBeenCalled();
      expect(perMonitorNoProbeSpy).not.toHaveBeenCalled();
    });

    test.each([
      {
        probeStatus: ProbeConnectionStatus.Disconnected,
        withProbe: true,
      },
      {
        probeStatus: ProbeConnectionStatus.Connected,
        withProbe: false,
      },
    ])(
      "probe $probeStatus: a monitor that moved the other way keeps its own per-monitor message",
      async (scenario: {
        probeStatus: ProbeConnectionStatus;
        withProbe: boolean;
      }) => {
        const projectOwner: User = makeUser(1);
        const followsProbe: Monitor = makeMonitor(1);
        const staleFlag: Monitor = makeMonitor(2);

        world.probe = makeProbe(scenario.probeStatus);
        attach([followsProbe, staleFlag]);
        flip([followsProbe], scenario.withProbe);
        flip([staleFlag], !scenario.withProbe);
        world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

        await MonitorService.refreshProbeStatus(PROBE_ID);

        // The stale-flag correction does not name this probe.
        expect(perMonitorProbeStatusSpy).toHaveBeenCalledTimes(1);
        expect(perMonitorProbeStatusSpy).toHaveBeenCalledWith({
          monitorId: staleFlag.id,
          isProbeDisconnected: !scenario.withProbe,
        });

        // The monitor that moved with the probe is grouped, alone.
        const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);
        expect(listedNames(message)).toEqual([followsProbe.name]);
        expect(message.emailEnvelope.vars["probeStatus"]).toBe(
          scenario.withProbe ? "Disconnected" : "Connected",
        );
      },
    );

    test.each([
      {
        probeStatus: ProbeConnectionStatus.Disconnected,
        isProbeDisconnected: true,
      },
      {
        probeStatus: ProbeConnectionStatus.Connected,
        isProbeDisconnected: false,
      },
    ])(
      "probe $probeStatus: a monitor whose row for this probe is disabled keeps its per-monitor message, even when its flag moved the same way",
      async (scenario: {
        probeStatus: ProbeConnectionStatus;
        isProbeDisconnected: boolean;
      }) => {
        const projectOwner: User = makeUser(1);
        const usesProbe: Monitor = makeMonitor(1);
        const notUsingProbe: Monitor = makeMonitor(2);

        world.probe = makeProbe(scenario.probeStatus);
        attach([usesProbe]);
        attach([notUsingProbe], false);
        flip([usesProbe, notUsingProbe], scenario.isProbeDisconnected);
        world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

        await MonitorService.refreshProbeStatus(PROBE_ID);

        // Both were re-derived: the disabled row's monitor may be stale too.
        expect(syncedMonitorIds().sort()).toEqual(
          toIdStrings([usesProbe.id!, notUsingProbe.id!]).sort(),
        );

        // Whatever moved its flag, it was not this probe.
        expect(perMonitorProbeStatusSpy).toHaveBeenCalledTimes(1);
        expect(perMonitorProbeStatusSpy).toHaveBeenCalledWith({
          monitorId: notUsingProbe.id,
          isProbeDisconnected: scenario.isProbeDisconnected,
        });

        // Only the monitor that uses the probe is grouped under it.
        expect(monitorFindBySpy).toHaveBeenCalledTimes(1);
        expect(
          idsFromAnyQuery(monitorFindBySpy.mock.calls[0]![0].query._id),
        ).toEqual([usesProbe.id!.toString()]);

        const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);
        expect(listedNames(message)).toEqual([usesProbe.name]);
        expect(message.emailEnvelope.vars["monitorCount"]).toBe("1");
        expect(message.emailEnvelope.vars["probeStatus"]).toBe(
          scenario.isProbeDisconnected ? "Disconnected" : "Connected",
        );
      },
    );

    test("when only monitors with a disabled row for the probe changed, no grouped message is sent at all", async () => {
      const monitors: Array<Monitor> = makeMonitors(1, 2);

      attach(monitors, false);
      flip(monitors, true);
      world.projectOwners.set(PROJECT_ID.toString(), [makeUser(1)]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(perMonitorProbeStatusSpy).toHaveBeenCalledTimes(2);
      expect(perMonitorProbeStatusSpy).toHaveBeenCalledWith({
        monitorId: monitors[0]!.id,
        isProbeDisconnected: true,
      });
      expect(perMonitorProbeStatusSpy).toHaveBeenCalledWith({
        monitorId: monitors[1]!.id,
        isProbeDisconnected: true,
      });
      expect(monitorFindBySpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    test.each([
      { order: "the disabled row first", enabledFirst: false },
      { order: "the enabled row first", enabledFirst: true },
    ])(
      "a monitor with two rows for the probe, one of them enabled, is grouped ($order)",
      async (scenario: { order: string; enabledFirst: boolean }) => {
        const projectOwner: User = makeUser(1);
        const twoRows: Monitor = makeMonitor(1);

        world.monitors.push(twoRows);
        world.monitorProbeRows.push(
          makeMonitorProbeRow(twoRows.id!, scenario.enabledFirst),
        );
        world.monitorProbeRows.push(
          makeMonitorProbeRow(twoRows.id!, !scenario.enabledFirst),
        );
        flip([twoRows], true);
        world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

        await MonitorService.refreshProbeStatus(PROBE_ID);

        // Synced once, and the enabled row counts whichever row came first.
        expect(syncedMonitorIds()).toEqual([twoRows.id!.toString()]);
        expect(perMonitorProbeStatusSpy).not.toHaveBeenCalled();

        const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);
        expect(listedNames(message)).toEqual([twoRows.name]);
        expect(message.emailEnvelope.vars["monitorCount"]).toBe("1");
      },
    );

    test("the probe's rows are read with isEnabled, the field that decides who is grouped", async () => {
      attach(makeMonitors(1, 1));

      await MonitorService.refreshProbeStatus(PROBE_ID);

      const probeQueries: Array<any> = monitorProbeFindBySpy.mock.calls
        .map((call: Array<any>): any => {
          return call[0];
        })
        .filter((findBy: any): boolean => {
          return Boolean(findBy.query.probeId);
        });

      expect(probeQueries).toHaveLength(1);
      expect(String(probeQueries[0].query.probeId)).toBe(PROBE_ID.toString());

      /*
       * The stubs above hand back whatever rows a test builds, selected or
       * not. Against the database, a row read without isEnabled has it
       * undefined, and no monitor would ever be grouped.
       */
      expect(probeQueries[0].select).toMatchObject({
        monitorId: true,
        isEnabled: true,
      });
    });

    test("a no-probe-enabled flip keeps its per-monitor message and is not listed under the probe", async () => {
      const projectOwner: User = makeUser(1);
      const lostLastProbe: Monitor = makeMonitor(1);
      const regainedAndDown: Monitor = makeMonitor(2);

      attach([lostLastProbe, regainedAndDown]);
      world.flagChanges.set(lostLastProbe.id!.toString(), {
        monitorId: lostLastProbe.id!,
        isNoProbeEnabledOnThisMonitor: true,
      });
      world.flagChanges.set(regainedAndDown.id!.toString(), {
        monitorId: regainedAndDown.id!,
        isNoProbeEnabledOnThisMonitor: false,
        isAllProbesDisconnectedFromThisMonitor: true,
      });
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(perMonitorNoProbeSpy).toHaveBeenCalledTimes(2);
      expect(perMonitorNoProbeSpy).toHaveBeenCalledWith({
        monitorId: lostLastProbe.id,
        isNoProbesEnabled: true,
      });
      expect(perMonitorNoProbeSpy).toHaveBeenCalledWith({
        monitorId: regainedAndDown.id,
        isNoProbesEnabled: false,
      });

      // Only the disconnect flip is about this probe.
      expect(perMonitorProbeStatusSpy).not.toHaveBeenCalled();
      expect(listedNames(onlyMessageTo(projectOwner))).toEqual([
        regainedAndDown.name,
      ]);
    });

    test.each([
      { label: "the probe row is gone (deleted mid-refresh)", status: "gone" },
      { label: "the probe has no connection status", status: "null" },
    ])(
      "when $label, every change falls back to the per-monitor message",
      async (scenario: { label: string; status: string }) => {
        const monitors: Array<Monitor> = makeMonitors(1, 3);

        world.probe = scenario.status === "gone" ? null : makeProbe(null);
        attach(monitors);
        flip(monitors.slice(0, 2), true);
        flip(monitors.slice(2), false);
        world.projectOwners.set(PROJECT_ID.toString(), [makeUser(1)]);

        await MonitorService.refreshProbeStatus(PROBE_ID);

        expect(perMonitorProbeStatusSpy).toHaveBeenCalledTimes(3);
        expect(perMonitorProbeStatusSpy).toHaveBeenCalledWith({
          monitorId: monitors[0]!.id,
          isProbeDisconnected: true,
        });
        expect(perMonitorProbeStatusSpy).toHaveBeenCalledWith({
          monitorId: monitors[1]!.id,
          isProbeDisconnected: true,
        });
        expect(perMonitorProbeStatusSpy).toHaveBeenCalledWith({
          monitorId: monitors[2]!.id,
          isProbeDisconnected: false,
        });

        // Nothing is attributed to a probe nobody can name.
        expect(monitorFindBySpy).not.toHaveBeenCalled();
        expect(sendSpy).not.toHaveBeenCalled();
      },
    );

    test("with no monitors on the probe, it returns before loading the probe or sending anything", async () => {
      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(probeFindOneByIdSpy).not.toHaveBeenCalled();
      expect(syncSpy).not.toHaveBeenCalled();
      expect(monitorFindBySpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
      expect(perMonitorProbeStatusSpy).not.toHaveBeenCalled();
    });

    test("a monitor attached twice is synced and listed once", async () => {
      const projectOwner: User = makeUser(1);
      const twice: Monitor = makeMonitor(1);
      const once: Monitor = makeMonitor(2);

      attach([twice, once]);
      world.monitorProbeRows.push(makeMonitorProbeRow(twice.id!));
      // A row without a monitor is skipped, not synced as "undefined".
      world.monitorProbeRows.push(makeMonitorProbeRow());
      flip([twice, once], true);
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(syncedMonitorIds().sort()).toEqual(
        toIdStrings([twice.id!, once.id!]).sort(),
      );

      const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);
      expect(listedNames(message)).toEqual([twice.name, once.name]);
      expect(message.emailEnvelope.vars["monitorCount"]).toBe("2");
    });

    test("notifyOwnersOfMonitorsAffectedByProbeStatusChange does nothing for an empty list", async () => {
      world.projectOwners.set(PROJECT_ID.toString(), [makeUser(1)]);

      await MonitorService.notifyOwnersOfMonitorsAffectedByProbeStatusChange({
        probeId: PROBE_ID,
        probeName: PROBE_NAME,
        isProbeDisconnected: true,
        monitorIds: [],
      });

      expect(monitorFindBySpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe("one failure does not silence everybody else", () => {
    test("a monitor whose sync throws is logged and skipped; the others are still synced and announced", async () => {
      const projectOwner: User = makeUser(1);
      const monitors: Array<Monitor> = makeMonitors(1, 3);
      const broken: Monitor = monitors[1]!;

      attach(monitors);
      flip(monitors, true);
      world.flagChanges.set(
        broken.id!.toString(),
        new Error("connection terminated"),
      );
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await expect(
        MonitorService.refreshProbeStatus(PROBE_ID),
      ).resolves.toBeUndefined();

      expect(syncSpy).toHaveBeenCalledTimes(3);
      expect(listedNames(onlyMessageTo(projectOwner))).toEqual([
        monitors[0]!.name,
        monitors[2]!.name,
      ]);
      expect(
        loggedErrors().some((message: string): boolean => {
          return message.includes(broken.id!.toString());
        }),
      ).toBe(true);
    });

    test("one recipient's send failing does not stop the other recipients", async () => {
      const failing: User = makeUser(1);
      const healthy: User = makeUser(2);
      const monitors: Array<Monitor> = makeMonitors(1, 2);

      attach(monitors);
      flip(monitors, true);
      world.projectOwners.set(PROJECT_ID.toString(), [failing, healthy]);
      world.failingRecipientIds.add(failing.id!.toString());

      await expect(
        MonitorService.refreshProbeStatus(PROBE_ID),
      ).resolves.toBeUndefined();

      // Both were attempted; the healthy one got theirs.
      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(sentTo(failing)).toHaveLength(0);
      expect(listedNames(onlyMessageTo(healthy))).toEqual(namesOf(monitors));
    });

    test("a monitor whose owners cannot be read is left out rather than sent to the project owners", async () => {
      const projectOwner: User = makeUser(1);
      const monitorOwner: User = makeUser(2);
      const unowned: Monitor = makeMonitor(1);
      const ownersUnknown: Monitor = makeMonitor(2);
      const owned: Monitor = makeMonitor(3);

      attach([unowned, ownersUnknown, owned]);
      flip([unowned, ownersUnknown, owned], true);
      world.owners.set(
        ownersUnknown.id!.toString(),
        new Error("owner lookup failed"),
      );
      setOwners([owned], [monitorOwner]);
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(listedNames(onlyMessageTo(projectOwner))).toEqual([unowned.name]);
      expect(listedNames(onlyMessageTo(monitorOwner))).toEqual([owned.name]);

      for (const message of sent) {
        expect(listedNames(message)).not.toContain(ownersUnknown.name);
      }

      expect(
        loggedErrors().some((message: string): boolean => {
          return message.includes(ownersUnknown.id!.toString());
        }),
      ).toBe(true);
    });

    test("a per-monitor notification failing does not stop the grouped message", async () => {
      const projectOwner: User = makeUser(1);
      const followsProbe: Monitor = makeMonitor(1);
      const staleFlag: Monitor = makeMonitor(2);

      attach([followsProbe, staleFlag]);
      flip([followsProbe], true);
      flip([staleFlag], false);
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);
      perMonitorProbeStatusSpy.mockRejectedValue(new Error("smtp timeout"));

      await expect(
        MonitorService.refreshProbeStatus(PROBE_ID),
      ).resolves.toBeUndefined();

      expect(perMonitorProbeStatusSpy).toHaveBeenCalledTimes(1);
      expect(listedNames(onlyMessageTo(projectOwner))).toEqual([
        followsProbe.name,
      ]);
    });
  });

  describe("what the grouped message carries", () => {
    test("the monitorId tag is set only when the recipient's list has exactly one monitor", async () => {
      const ownerOfOne: User = makeUser(1);
      const ownerOfTwo: User = makeUser(2);
      const monitors: Array<Monitor> = makeMonitors(1, 3);

      attach(monitors);
      flip(monitors, true);
      setOwners(monitors.slice(0, 1), [ownerOfOne]);
      setOwners(monitors.slice(1), [ownerOfTwo]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      const single: SendUserNotificationArgs = onlyMessageTo(ownerOfOne);
      expect(single.monitorId?.toString()).toBe(monitors[0]!.id!.toString());
      expect(single.emailEnvelope.vars["monitorCount"]).toBe("1");

      const multiple: SendUserNotificationArgs = onlyMessageTo(ownerOfTwo);
      expect(multiple.monitorId).toBeUndefined();
      expect(multiple.emailEnvelope.vars["monitorCount"]).toBe("2");
    });

    test("a disconnect links to the monitors-with-disconnected-probes list, and each monitor to its own page", async () => {
      const projectOwner: User = makeUser(1);
      const monitors: Array<Monitor> = makeMonitors(1, 2);

      world.probe = makeProbe(ProbeConnectionStatus.Disconnected);
      attach(monitors);
      flip(monitors, true);
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);

      expect(
        String(message.emailEnvelope.vars["viewMonitorsLink"]).endsWith(
          `/${PROJECT_ID.toString()}/monitors/probe-disconnected?probeId=${PROBE_ID.toString()}`,
        ),
      ).toBe(true);

      const links: Array<string> = listed(message).map(
        (monitor: ListedMonitor): string => {
          return monitor.monitorViewLink;
        },
      );

      expect(links).toHaveLength(2);
      monitors.forEach((monitor: Monitor, index: number): void => {
        expect(
          links[index]!.endsWith(
            `/${PROJECT_ID.toString()}/monitors/${monitor.id!.toString()}`,
          ),
        ).toBe(true);
      });
    });

    test("a reconnect links to the monitors list", async () => {
      const projectOwner: User = makeUser(1);
      const monitors: Array<Monitor> = makeMonitors(1, 2);

      world.probe = makeProbe(ProbeConnectionStatus.Connected);
      attach(monitors);
      flip(monitors, false);
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);
      const link: string = String(
        message.emailEnvelope.vars["viewMonitorsLink"],
      );

      expect(
        link.endsWith(
          `/${PROJECT_ID.toString()}/monitors?probeId=${PROBE_ID.toString()}`,
        ),
      ).toBe(true);
      expect(link).not.toContain("probe-disconnected");
    });

    test.each([
      { direction: "disconnect", isProbeDisconnected: true },
      { direction: "reconnect", isProbeDisconnected: false },
    ])(
      "$direction: the list link names the probe, so two probes stay apart in the email rollup while one probe's link is stable",
      async (scenario: { direction: string; isProbeDisconnected: boolean }) => {
        const projectOwner: User = makeUser(1);
        const monitors: Array<Monitor> = makeMonitors(1, 2);
        const listPath: string = scenario.isProbeDisconnected
          ? `/${PROJECT_ID.toString()}/monitors/probe-disconnected`
          : `/${PROJECT_ID.toString()}/monitors`;

        world.monitors.push(...monitors);
        world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

        const monitorIds: Array<ObjectID> = monitors.map(
          (monitor: Monitor): ObjectID => {
            return monitor.id!;
          },
        );

        // The same probe twice, then a second probe over the same monitors.
        for (const probeId of [PROBE_ID, PROBE_ID, OTHER_PROBE_ID]) {
          await MonitorService.notifyOwnersOfMonitorsAffectedByProbeStatusChange(
            {
              probeId: probeId,
              probeName: PROBE_NAME,
              isProbeDisconnected: scenario.isProbeDisconnected,
              monitorIds: monitorIds,
            },
          );
        }

        const messages: Array<SendUserNotificationArgs> = sentTo(projectOwner);
        expect(messages).toHaveLength(3);

        const links: Array<string> = messages.map(
          (message: SendUserNotificationArgs): string => {
            return String(message.emailEnvelope.vars["viewMonitorsLink"]);
          },
        );

        expect(
          links[0]!.endsWith(`${listPath}?probeId=${PROBE_ID.toString()}`),
        ).toBe(true);
        expect(links[1]).toBe(links[0]);
        expect(
          links[2]!.endsWith(
            `${listPath}?probeId=${OTHER_PROBE_ID.toString()}`,
          ),
        ).toBe(true);
        expect(links[2]).not.toBe(links[0]);

        /*
         * The rollup folds deferred emails on the link it reads from the
         * envelope. That link is the list link here, so the same probe folds
         * into one digest row and two probes keep a row each.
         */
        const rollupKeys: Array<string | undefined> = messages.map(
          (message: SendUserNotificationArgs): string | undefined => {
            return EmailRollupWriter.extractViewLink(
              message.emailEnvelope.vars,
            );
          },
        );

        expect(rollupKeys).toEqual(links);
        expect(new Set(rollupKeys).size).toBe(2);
      },
    );

    test("the email lists at most 25 monitors and says how many more there are", async () => {
      const projectOwner: User = makeUser(1);
      const monitors: Array<Monitor> = makeMonitors(1, 30);

      attach(monitors);
      flip(monitors, true);
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(sendSpy).toHaveBeenCalledTimes(1);

      const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);

      expect(message.emailEnvelope.vars["monitorCount"]).toBe("30");
      expect(listedNames(message)).toEqual(namesOf(monitors.slice(0, 25)));
      expect(message.emailEnvelope.vars["hasMore"]).toBe("true");
      expect(message.emailEnvelope.vars["remainingCount"]).toBe("5");
      expect(message.emailEnvelope.subject).toContain("30 monitors");
    });

    test("a list of 25 or fewer is shown in full", async () => {
      const projectOwner: User = makeUser(1);
      const monitors: Array<Monitor> = makeMonitors(1, 25);

      attach(monitors);
      flip(monitors, true);
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      const message: SendUserNotificationArgs = onlyMessageTo(projectOwner);

      expect(listedNames(message)).toEqual(namesOf(monitors));
      expect(message.emailEnvelope.vars["hasMore"]).toBe("false");
      expect(message.emailEnvelope.vars["remainingCount"]).toBe("0");
    });
  });

  describe("bounded fan-out", () => {
    test("120 monitors are all synced, never more than 50 at once, and still announced in one message", async () => {
      const projectOwner: User = makeUser(1);
      const monitors: Array<Monitor> = makeMonitors(1, 120);

      attach(monitors);
      flip(monitors, true);
      world.projectOwners.set(PROJECT_ID.toString(), [projectOwner]);

      await MonitorService.refreshProbeStatus(PROBE_ID);

      expect(syncSpy).toHaveBeenCalledTimes(120);
      expect(new Set(syncedMonitorIds()).size).toBe(120);
      expect(maxSyncInFlight).toBeLessThanOrEqual(50);
      // Bounded, not serial: the syncs do overlap.
      expect(maxSyncInFlight).toBeGreaterThan(1);

      // The owner lookups for the grouped message are bounded the same way.
      expect(findOwnersSpy).toHaveBeenCalledTimes(120);
      expect(maxOwnersInFlight).toBeLessThanOrEqual(50);
      expect(maxOwnersInFlight).toBeGreaterThan(1);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(
        onlyMessageTo(projectOwner).emailEnvelope.vars["monitorCount"],
      ).toBe("120");
    });
  });
});
