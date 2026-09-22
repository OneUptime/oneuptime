/*
 * https://github.com/OneUptime/oneuptime/issues/2486
 *
 * A monitor carries two probe flags that drive the "Probes Not Enabled" and
 * "Probe Disconnected" banners and the owner notifications behind them:
 *
 *   - isNoProbeEnabledOnThisMonitor: no MonitorProbe row of the monitor is
 *     enabled;
 *   - isAllProbesDisconnectedFromThisMonitor: every ENABLED probe of the
 *     monitor is Disconnected.
 *
 * MonitorService.syncMonitorProbeFlags re-derives both from the monitor's
 * MonitorProbe rows, writes the ones that moved and REPORTS them without
 * sending anything, so a probe-wide refresh can group the announcements.
 * refreshMonitorProbeStatus is the per-monitor caller (a probe attached,
 * enabled, disabled or removed, a monitor created): it announces each
 * reported change with the matching per-monitor notification.
 *
 * What this suite pins:
 *
 *   - monitors that probes do not check are left alone (null, no write);
 *   - each flag is written only when it moves, and reported with its NEW
 *     value; a flag that did not move is absent from the report;
 *   - disabled probes count for nothing when deciding "all disconnected";
 *   - losing the last enabled probe while flagged "all disconnected" clears
 *     that flag WITHOUT reporting it. Before, the owners got "No probes
 *     enabled" and, in the same breath, "Probes ... are Connected";
 *   - on SaaS a monitor checked by a global probe never has its disconnected
 *     flag touched, but self-hosted global probes still flag the monitor:
 *     for a global probe that per-monitor signal is the only one self-hosted
 *     admins get (ProbeService.notifyOwnersOnStatusChange skips probes
 *     without a project);
 *   - notifyOwnersProbesDisconnected describes the probe status on every
 *     channel. Its call text used to read "New monitor was created" and its
 *     push was the "New Monitor Created" push.
 *
 * Billing is pinned per test with TestBillingFlag: CI's config.env sets
 * BILLING_ENABLED=true and local runs have it false. Everything below the
 * service boundary is spied - no database.
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

import MonitorService, {
  MonitorProbeFlagChanges,
} from "../../../Server/Services/MonitorService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import { Say } from "../../../Types/Call/CallRequest";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OWNER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SECOND_OWNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const PROJECT_OWNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const MONITOR_NAME: string = "Checkout API";
const PROJECT_NAME: string = "Acme Corp";
const MONITOR_LINK: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/monitors/${MONITOR_ID.toString()}`;

// What the monitor row says before the sync runs.
interface MonitorState {
  isNoProbeEnabledOnThisMonitor: boolean;
  isAllProbesDisconnectedFromThisMonitor: boolean;
}

// One MonitorProbe row of the monitor, with the probe it points at.
interface ProbeRowSpec {
  isEnabled: boolean;
  status: ProbeConnectionStatus;
  isGlobalProbe?: boolean | undefined;
}

// The fields of one updateOneById call the service made.
interface CapturedWrite {
  id: ObjectID;
  data: Record<string, unknown>;
  props: { isRoot?: boolean | undefined };
}

type SentNotification = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

/*
 * The flag part of a report, without the monitorId every report carries.
 * Loose on purpose: a key the report should not have must still show up.
 */
type ReportedFlags = Record<string, unknown>;

const CONNECTED: ProbeConnectionStatus = ProbeConnectionStatus.Connected;
const DISCONNECTED: ProbeConnectionStatus = ProbeConnectionStatus.Disconnected;

type MakeMonitorFunction = (
  state: MonitorState,
  monitorType?: MonitorType | undefined,
) => Monitor;

const makeMonitor: MakeMonitorFunction = (
  state: MonitorState,
  monitorType?: MonitorType | undefined,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = monitorType || MonitorType.API;
  monitor.isNoProbeEnabledOnThisMonitor = state.isNoProbeEnabledOnThisMonitor;
  monitor.isAllProbesDisconnectedFromThisMonitor =
    state.isAllProbesDisconnectedFromThisMonitor;
  return monitor;
};

type MakeMonitorProbeFunction = (spec: ProbeRowSpec) => MonitorProbe;

const makeMonitorProbe: MakeMonitorProbeFunction = (
  spec: ProbeRowSpec,
): MonitorProbe => {
  const probe: Probe = new Probe();
  probe.id = ObjectID.generate();
  probe.connectionStatus = spec.status;
  probe.isGlobalProbe = spec.isGlobalProbe === true;

  const monitorProbe: MonitorProbe = new MonitorProbe();
  monitorProbe.id = ObjectID.generate();
  monitorProbe.monitorId = MONITOR_ID;
  monitorProbe.projectId = PROJECT_ID;
  monitorProbe.probeId = probe.id;
  monitorProbe.isEnabled = spec.isEnabled;
  monitorProbe.probe = probe;
  return monitorProbe;
};

type MakeUserFunction = (id: ObjectID) => User;

const makeUser: MakeUserFunction = (id: ObjectID): User => {
  const user: User = new User();
  user.id = id;
  return user;
};

describe("MonitorService probe flags", () => {
  let monitorToReturn: Monitor | null = null;
  let probeRows: Array<MonitorProbe> = [];
  let writes: Array<CapturedWrite> = [];
  let monitorLookups: Array<Record<string, unknown>> = [];
  let probeRowLookups: Array<Record<string, unknown>> = [];

  type ArrangeFunction = (
    state: MonitorState,
    rows: Array<ProbeRowSpec>,
    monitorType?: MonitorType | undefined,
  ) => void;

  const arrange: ArrangeFunction = (
    state: MonitorState,
    rows: Array<ProbeRowSpec>,
    monitorType?: MonitorType | undefined,
  ): void => {
    monitorToReturn = makeMonitor(state, monitorType);
    probeRows = rows.map((spec: ProbeRowSpec): MonitorProbe => {
      return makeMonitorProbe(spec);
    });
  };

  /*
   * The data of every write, in order. Every write must be a root write to
   * THIS monitor: the sync runs from hooks and workers with no user scope.
   */
  type WrittenFlagsFunction = () => Array<Record<string, unknown>>;

  const writtenFlags: WrittenFlagsFunction = (): Array<
    Record<string, unknown>
  > => {
    for (const write of writes) {
      expect(write.id.toString()).toBe(MONITOR_ID.toString());
      expect(write.props.isRoot).toBe(true);
    }

    return writes.map((write: CapturedWrite): Record<string, unknown> => {
      return write.data;
    });
  };

  type SyncFunction = () => Promise<MonitorProbeFlagChanges | null>;

  const sync: SyncFunction =
    async (): Promise<MonitorProbeFlagChanges | null> => {
      return await MonitorService.syncMonitorProbeFlags(MONITOR_ID);
    };

  // The report minus its monitorId, after checking the monitorId is ours.
  type ReportedFunction = (
    changes: MonitorProbeFlagChanges | null,
  ) => ReportedFlags;

  const reported: ReportedFunction = (
    changes: MonitorProbeFlagChanges | null,
  ): ReportedFlags => {
    expect(changes).not.toBeNull();
    expect(changes!.monitorId.toString()).toBe(MONITOR_ID.toString());

    // Every other key is kept, even one holding undefined, so extras show up.
    const flags: ReportedFlags = {};

    for (const [key, value] of Object.entries(changes!)) {
      if (key !== "monitorId") {
        flags[key] = value;
      }
    }

    return flags;
  };

  beforeEach(() => {
    setTestBillingEnabled(false);
    monitorToReturn = null;
    probeRows = [];
    writes = [];
    monitorLookups = [];
    probeRowLookups = [];

    getJestSpyOn(MonitorService, "findOneById").mockImplementation(
      async (findOneById: Record<string, unknown>): Promise<Monitor | null> => {
        monitorLookups.push(findOneById);
        return monitorToReturn;
      },
    );

    getJestSpyOn(MonitorService, "updateOneById").mockImplementation(
      async (updateById: CapturedWrite): Promise<number> => {
        writes.push(updateById);
        return 1;
      },
    );

    getJestSpyOn(MonitorProbeService, "findBy").mockImplementation(
      async (findBy: Record<string, unknown>): Promise<Array<MonitorProbe>> => {
        probeRowLookups.push(findBy);
        return probeRows;
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setTestBillingEnabled(false);
  });

  describe("syncMonitorProbeFlags: monitors that probes do not check", () => {
    /*
     * Nothing to derive: these monitors have no probes by design, so flagging
     * them "no probes enabled" would put a false banner on them and notify
     * their owners about it.
     */
    const notProbed: Array<{ name: string; monitor: () => Monitor | null }> = [
      {
        name: "a monitor that no longer exists",
        monitor: (): Monitor | null => {
          return null;
        },
      },
      {
        name: "a monitor row without an id",
        monitor: (): Monitor | null => {
          const monitor: Monitor = new Monitor();
          monitor.monitorType = MonitorType.API;
          monitor.isNoProbeEnabledOnThisMonitor = false;
          return monitor;
        },
      },
      {
        name: "a monitor without a monitor type",
        monitor: (): Monitor | null => {
          const monitor: Monitor = new Monitor();
          monitor.id = MONITOR_ID;
          monitor.isNoProbeEnabledOnThisMonitor = false;
          return monitor;
        },
      },
      {
        name: "an Incoming Request monitor",
        monitor: (): Monitor | null => {
          return makeMonitor(
            {
              isNoProbeEnabledOnThisMonitor: false,
              isAllProbesDisconnectedFromThisMonitor: false,
            },
            MonitorType.IncomingRequest,
          );
        },
      },
      {
        name: "a Manual monitor",
        monitor: (): Monitor | null => {
          return makeMonitor(
            {
              isNoProbeEnabledOnThisMonitor: false,
              isAllProbesDisconnectedFromThisMonitor: false,
            },
            MonitorType.Manual,
          );
        },
      },
      {
        name: "a Server monitor",
        monitor: (): Monitor | null => {
          return makeMonitor(
            {
              isNoProbeEnabledOnThisMonitor: false,
              isAllProbesDisconnectedFromThisMonitor: true,
            },
            MonitorType.Server,
          );
        },
      },
    ];

    notProbed.forEach(
      (testCase: { name: string; monitor: () => Monitor | null }): void => {
        it(`returns null and writes nothing for ${testCase.name}`, async () => {
          monitorToReturn = testCase.monitor();

          await expect(sync()).resolves.toBeNull();

          expect(writes).toEqual([]);
          // It never even looks at probe rows.
          expect(probeRowLookups).toEqual([]);
        });
      },
    );

    it("does derive the flags for a probe-checked monitor (control for the cases above)", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [],
        MonitorType.Ping,
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(probeRowLookups).toHaveLength(1);
      expect(reported(changes)).toStrictEqual({
        isNoProbeEnabledOnThisMonitor: true,
      });
    });
  });

  describe("syncMonitorProbeFlags: what it reads", () => {
    it("reads the monitor's type and BOTH flags, as root", async () => {
      /*
       * The sync compares the stored flags with the derived ones. A select
       * that dropped a flag would read it as undefined (= false) and rewrite
       * and re-announce it on every refresh.
       */
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [{ isEnabled: true, status: CONNECTED }],
      );

      await sync();

      expect(monitorLookups).toHaveLength(1);
      const lookup: Record<string, unknown> = monitorLookups[0]!;
      expect((lookup["id"] as ObjectID).toString()).toBe(MONITOR_ID.toString());
      expect(lookup["select"]).toMatchObject({
        monitorType: true,
        isNoProbeEnabledOnThisMonitor: true,
        isAllProbesDisconnectedFromThisMonitor: true,
      });
      expect(lookup["props"]).toMatchObject({ isRoot: true });
    });

    it("reads this monitor's probe rows with each probe's status and scope, as root", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [{ isEnabled: true, status: CONNECTED }],
      );

      await sync();

      expect(probeRowLookups).toHaveLength(1);
      const lookup: Record<string, unknown> = probeRowLookups[0]!;
      expect(
        (
          (lookup["query"] as Record<string, unknown>)["monitorId"] as ObjectID
        ).toString(),
      ).toBe(MONITOR_ID.toString());
      expect(lookup["select"]).toMatchObject({
        isEnabled: true,
        probe: {
          connectionStatus: true,
          isGlobalProbe: true,
        },
      });
      expect(lookup["props"]).toMatchObject({ isRoot: true });
    });
  });

  describe("syncMonitorProbeFlags: the no-probe-enabled flag", () => {
    it("sets the flag and reports it when the monitor has no probe rows", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([{ isNoProbeEnabledOnThisMonitor: true }]);
      expect(reported(changes)).toStrictEqual({
        isNoProbeEnabledOnThisMonitor: true,
      });
    });

    it("sets the flag and reports it when every probe row is disabled", async () => {
      // A disabled probe does not check the monitor, however healthy it is.
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [
          { isEnabled: false, status: CONNECTED },
          { isEnabled: false, status: DISCONNECTED },
        ],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([{ isNoProbeEnabledOnThisMonitor: true }]);
      expect(reported(changes)).toStrictEqual({
        isNoProbeEnabledOnThisMonitor: true,
      });
    });

    it("writes and reports nothing when the flag is already set", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([]);
      expect(reported(changes)).toStrictEqual({});
    });

    it("clears the flag and reports false once a probe is enabled again", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [
          { isEnabled: true, status: CONNECTED },
          { isEnabled: false, status: CONNECTED },
        ],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isNoProbeEnabledOnThisMonitor: false },
      ]);
      expect(reported(changes)).toStrictEqual({
        isNoProbeEnabledOnThisMonitor: false,
      });
    });

    it("writes and reports nothing in the steady state (enabled, connected, flags clear)", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [{ isEnabled: true, status: CONNECTED }],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([]);
      expect(reported(changes)).toStrictEqual({});
    });
  });

  describe("syncMonitorProbeFlags: the all-probes-disconnected flag", () => {
    it("sets the flag and reports it when every enabled probe is Disconnected", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [
          { isEnabled: true, status: DISCONNECTED },
          { isEnabled: true, status: DISCONNECTED },
        ],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isAllProbesDisconnectedFromThisMonitor: true },
      ]);
      expect(reported(changes)).toStrictEqual({
        isAllProbesDisconnectedFromThisMonitor: true,
      });
    });

    it("writes and reports nothing when the flag is already set", async () => {
      // Re-announcing an outage the owners already heard about is the spam.
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        [{ isEnabled: true, status: DISCONNECTED }],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([]);
      expect(reported(changes)).toStrictEqual({});
    });

    it("clears the flag and reports false once one enabled probe is Connected", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        [
          { isEnabled: true, status: DISCONNECTED },
          { isEnabled: true, status: CONNECTED },
        ],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isAllProbesDisconnectedFromThisMonitor: false },
      ]);
      expect(reported(changes)).toStrictEqual({
        isAllProbesDisconnectedFromThisMonitor: false,
      });
    });

    it("does not flag a monitor that still has one Connected enabled probe", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [
          { isEnabled: true, status: DISCONNECTED },
          { isEnabled: true, status: CONNECTED },
        ],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([]);
      expect(reported(changes)).toStrictEqual({});
    });

    it("flags the monitor when its only enabled probe is down, even beside a disabled Connected probe", async () => {
      // The disabled probe is not checking the monitor, so it cannot keep it "connected".
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [
          { isEnabled: true, status: DISCONNECTED },
          { isEnabled: false, status: CONNECTED },
        ],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isAllProbesDisconnectedFromThisMonitor: true },
      ]);
      expect(reported(changes)).toStrictEqual({
        isAllProbesDisconnectedFromThisMonitor: true,
      });
    });

    it("keeps the flag set when the only Connected probe is disabled", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        [
          { isEnabled: true, status: DISCONNECTED },
          { isEnabled: false, status: CONNECTED },
        ],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([]);
      expect(reported(changes)).toStrictEqual({});
    });

    it("does not count a disabled Disconnected probe against a Connected enabled one", async () => {
      /*
       * One enabled probe, Connected. If disabled rows were counted as
       * "disconnected", 1 disconnected == 1 enabled would flag this healthy
       * monitor.
       */
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [
          { isEnabled: true, status: CONNECTED },
          { isEnabled: false, status: DISCONNECTED },
        ],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([]);
      expect(reported(changes)).toStrictEqual({});
    });

    it("moves both flags in one sync when probes come back enabled but all down", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [{ isEnabled: true, status: DISCONNECTED }],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isNoProbeEnabledOnThisMonitor: false },
        { isAllProbesDisconnectedFromThisMonitor: true },
      ]);
      expect(reported(changes)).toStrictEqual({
        isNoProbeEnabledOnThisMonitor: false,
        isAllProbesDisconnectedFromThisMonitor: true,
      });
    });
  });

  describe("syncMonitorProbeFlags: losing the last enabled probe while flagged all-disconnected", () => {
    /*
     * With no enabled probe there is nothing to be connected or disconnected.
     * The stale "all disconnected" flag is cleared so the monitor stops
     * showing up under "Probe Disconnected", but the clearing is NOT reported:
     * reporting it would announce "Probes ... are Connected" for a monitor
     * that nothing checks any more, next to the "no probes enabled" notice.
     */
    it("clears the flag without reporting it, and reports the no-probe change", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        [],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isNoProbeEnabledOnThisMonitor: true },
        { isAllProbesDisconnectedFromThisMonitor: false },
      ]);
      expect(reported(changes)).toStrictEqual({
        isNoProbeEnabledOnThisMonitor: true,
      });
    });

    it("clears the flag without reporting anything when the no-probe flag was already set", async () => {
      // The last enabled row was disabled earlier; only the stale flag is left to fix.
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        [{ isEnabled: false, status: DISCONNECTED }],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isAllProbesDisconnectedFromThisMonitor: false },
      ]);
      expect(reported(changes)).toStrictEqual({});
    });

    it("does not write the disconnected flag when it was already clear", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [{ isEnabled: false, status: DISCONNECTED }],
      );

      await sync();

      expect(writtenFlags()).toEqual([{ isNoProbeEnabledOnThisMonitor: true }]);
    });
  });

  describe("syncMonitorProbeFlags: global probes and billing", () => {
    /*
     * On SaaS the global probes are OneUptime's own fleet. Their outages are
     * OneUptime's to handle, so a monitor checked by a global probe is never
     * flagged (or unflagged) as disconnected there. Self-hosted, a "global"
     * probe is the customer's own, and flagging the monitor is the only
     * signal they get about it.
     */
    const globalDownRows: Array<ProbeRowSpec> = [
      { isEnabled: true, status: DISCONNECTED, isGlobalProbe: true },
      { isEnabled: true, status: DISCONNECTED },
    ];

    it("SaaS: never sets the disconnected flag when a global probe is enabled", async () => {
      setTestBillingEnabled(true);
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        globalDownRows,
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([]);
      expect(reported(changes)).toStrictEqual({});
    });

    it("self-hosted: sets the disconnected flag for the same rows", async () => {
      setTestBillingEnabled(false);
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        globalDownRows,
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isAllProbesDisconnectedFromThisMonitor: true },
      ]);
      expect(reported(changes)).toStrictEqual({
        isAllProbesDisconnectedFromThisMonitor: true,
      });
    });

    it("SaaS: never clears the disconnected flag either when a global probe is enabled", async () => {
      setTestBillingEnabled(true);
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        [{ isEnabled: true, status: CONNECTED, isGlobalProbe: true }],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([]);
      expect(reported(changes)).toStrictEqual({});
    });

    it("self-hosted: clears the disconnected flag once the global probe reconnects", async () => {
      setTestBillingEnabled(false);
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        [{ isEnabled: true, status: CONNECTED, isGlobalProbe: true }],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isAllProbesDisconnectedFromThisMonitor: false },
      ]);
      expect(reported(changes)).toStrictEqual({
        isAllProbesDisconnectedFromThisMonitor: false,
      });
    });

    it("SaaS: still flags a monitor whose enabled probes are all custom", async () => {
      // Billing alone does not silence the flag; only an enabled global probe does.
      setTestBillingEnabled(true);
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [
          { isEnabled: true, status: DISCONNECTED },
          { isEnabled: false, status: DISCONNECTED, isGlobalProbe: true },
        ],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isAllProbesDisconnectedFromThisMonitor: true },
      ]);
      expect(reported(changes)).toStrictEqual({
        isAllProbesDisconnectedFromThisMonitor: true,
      });
    });

    it("SaaS: still reports the no-probe change of a monitor with a global probe", async () => {
      /*
       * The global-probe early return comes after the no-probe flag was
       * written; the report must still carry it, or the write happens and
       * the owners never hear that the monitor is being checked again.
       */
      setTestBillingEnabled(true);
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [{ isEnabled: true, status: DISCONNECTED, isGlobalProbe: true }],
      );

      const changes: MonitorProbeFlagChanges | null = await sync();

      expect(writtenFlags()).toEqual([
        { isNoProbeEnabledOnThisMonitor: false },
      ]);
      expect(reported(changes)).toStrictEqual({
        isNoProbeEnabledOnThisMonitor: false,
      });
    });
  });

  describe("refreshMonitorProbeStatus announces exactly what the sync reported", () => {
    let noProbeNotices: Array<{
      monitorId: ObjectID;
      isNoProbesEnabled: boolean;
    }> = [];
    let probeStatusNotices: Array<{
      monitorId: ObjectID;
      isProbeDisconnected: boolean;
    }> = [];

    beforeEach(() => {
      noProbeNotices = [];
      probeStatusNotices = [];

      getJestSpyOn(
        MonitorService,
        "notifyOwnersWhenNoProbeIsEnabled",
      ).mockImplementation(
        async (data: {
          monitorId: ObjectID;
          isNoProbesEnabled: boolean;
        }): Promise<void> => {
          noProbeNotices.push(data);
        },
      );

      getJestSpyOn(
        MonitorService,
        "notifyOwnersProbesDisconnected",
      ).mockImplementation(
        async (data: {
          monitorId: ObjectID;
          isProbeDisconnected: boolean;
        }): Promise<void> => {
          probeStatusNotices.push(data);
        },
      );
    });

    type RefreshCase = {
      name: string;
      state: MonitorState;
      rows: Array<ProbeRowSpec>;
      billing?: boolean | undefined;
      noProbe: Array<boolean>;
      probeStatus: Array<boolean>;
    };

    const cases: Array<RefreshCase> = [
      {
        name: "nothing changed: no notification at all",
        state: {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        rows: [{ isEnabled: true, status: CONNECTED }],
        noProbe: [],
        probeStatus: [],
      },
      {
        name: "outage already announced: no notification at all",
        state: {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        rows: [{ isEnabled: true, status: DISCONNECTED }],
        noProbe: [],
        probeStatus: [],
      },
      {
        name: "last probe disabled: the no-probe notice, isNoProbesEnabled true",
        state: {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        rows: [{ isEnabled: false, status: CONNECTED }],
        noProbe: [true],
        probeStatus: [],
      },
      {
        name: "a probe enabled again: the no-probe notice, isNoProbesEnabled false",
        state: {
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        rows: [{ isEnabled: true, status: CONNECTED }],
        noProbe: [false],
        probeStatus: [],
      },
      {
        name: "every enabled probe down: the probe notice, isProbeDisconnected true",
        state: {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        rows: [{ isEnabled: true, status: DISCONNECTED }],
        noProbe: [],
        probeStatus: [true],
      },
      {
        name: "a probe back up: the probe notice, isProbeDisconnected false",
        state: {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        rows: [{ isEnabled: true, status: CONNECTED }],
        noProbe: [],
        probeStatus: [false],
      },
      {
        name: "probes enabled again but all down: both notices",
        state: {
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        rows: [{ isEnabled: true, status: DISCONNECTED }],
        noProbe: [false],
        probeStatus: [true],
      },
      {
        name: "last enabled probe removed while flagged all-disconnected: ONLY the no-probe notice, never 'Connected'",
        state: {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        rows: [],
        noProbe: [true],
        probeStatus: [],
      },
      {
        name: "SaaS, global probe down: no probe notice",
        state: {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        rows: [{ isEnabled: true, status: DISCONNECTED, isGlobalProbe: true }],
        billing: true,
        noProbe: [],
        probeStatus: [],
      },
      {
        name: "self-hosted, global probe down: the probe notice",
        state: {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        rows: [{ isEnabled: true, status: DISCONNECTED, isGlobalProbe: true }],
        billing: false,
        noProbe: [],
        probeStatus: [true],
      },
    ];

    cases.forEach((testCase: RefreshCase): void => {
      it(testCase.name, async () => {
        setTestBillingEnabled(testCase.billing === true);
        arrange(testCase.state, testCase.rows);

        await MonitorService.refreshMonitorProbeStatus(MONITOR_ID);

        expect(noProbeNotices).toEqual(
          testCase.noProbe.map(
            (
              isNoProbesEnabled: boolean,
            ): { monitorId: ObjectID; isNoProbesEnabled: boolean } => {
              return { monitorId: MONITOR_ID, isNoProbesEnabled };
            },
          ),
        );
        expect(probeStatusNotices).toEqual(
          testCase.probeStatus.map(
            (
              isProbeDisconnected: boolean,
            ): { monitorId: ObjectID; isProbeDisconnected: boolean } => {
              return { monitorId: MONITOR_ID, isProbeDisconnected };
            },
          ),
        );
      });
    });

    it("sends nothing for a monitor that no longer exists", async () => {
      monitorToReturn = null;

      await MonitorService.refreshMonitorProbeStatus(MONITOR_ID);

      expect(noProbeNotices).toEqual([]);
      expect(probeStatusNotices).toEqual([]);
    });

    it("sends nothing for a monitor that probes do not check, even with no probe rows", async () => {
      arrange(
        {
          isNoProbeEnabledOnThisMonitor: false,
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        [],
        MonitorType.IncomingRequest,
      );

      await MonitorService.refreshMonitorProbeStatus(MONITOR_ID);

      expect(noProbeNotices).toEqual([]);
      expect(probeStatusNotices).toEqual([]);
      expect(writes).toEqual([]);
    });
  });

  describe("notifyOwnersProbesDisconnected", () => {
    let sent: Array<SentNotification> = [];
    let ownersToReturn: Array<User> = [];
    let projectOwnersToReturn: Array<User> = [];
    let projectOwnerLookups: Array<ObjectID> = [];

    beforeEach(() => {
      sent = [];
      ownersToReturn = [makeUser(OWNER_ID), makeUser(SECOND_OWNER_ID)];
      projectOwnersToReturn = [makeUser(PROJECT_OWNER_ID)];
      projectOwnerLookups = [];

      const project: Project = new Project();
      project.name = PROJECT_NAME;

      const monitor: Monitor = new Monitor();
      monitor.id = MONITOR_ID;
      monitor.projectId = PROJECT_ID;
      monitor.name = MONITOR_NAME;
      monitor.project = project;
      monitor.description = "Takes the money.";
      monitor.monitorType = MonitorType.API;
      monitorToReturn = monitor;

      getJestSpyOn(MonitorService, "findOwners").mockImplementation(
        async (): Promise<Array<User>> => {
          return ownersToReturn;
        },
      );

      getJestSpyOn(ProjectService, "getOwners").mockImplementation(
        async (projectId: ObjectID): Promise<Array<User>> => {
          projectOwnerLookups.push(projectId);
          return projectOwnersToReturn;
        },
      );

      getJestSpyOn(
        MonitorService,
        "getMonitorLinkInDashboard",
      ).mockImplementation(async (): Promise<URL> => {
        return URL.fromString(MONITOR_LINK);
      });

      getJestSpyOn(
        UserNotificationSettingService,
        "sendUserNotification",
      ).mockImplementation(async (data: SentNotification): Promise<void> => {
        sent.push(data);
      });
    });

    /*
     * The messages to the monitor's two owners. Asserting the count first
     * keeps the per-message checks below from passing on an empty list.
     */
    type SentToOwnersFunction = () => Array<SentNotification>;

    const sentToOwners: SentToOwnersFunction = (): Array<SentNotification> => {
      expect(sent).toHaveLength(2);
      return sent;
    };

    const statuses: Array<{ isProbeDisconnected: boolean; status: string }> = [
      { isProbeDisconnected: true, status: "Disconnected" },
      { isProbeDisconnected: false, status: "Connected" },
    ];

    statuses.forEach(
      ({
        isProbeDisconnected,
        status,
      }: {
        isProbeDisconnected: boolean;
        status: string;
      }): void => {
        describe(`probes ${status}`, () => {
          beforeEach(async () => {
            await MonitorService.notifyOwnersProbesDisconnected({
              monitorId: MONITOR_ID,
              isProbeDisconnected: isProbeDisconnected,
            });
          });

          it("sends one message per monitor owner, tagged with the monitor, under the probe-status event", async () => {
            expect(
              sent.map((notification: SentNotification): string => {
                return notification.userId.toString();
              }),
            ).toEqual([OWNER_ID.toString(), SECOND_OWNER_ID.toString()]);

            for (const notification of sentToOwners()) {
              expect(notification.projectId.toString()).toBe(
                PROJECT_ID.toString(),
              );
              expect(notification.eventType).toBe(
                NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
              );
              expect(notification.monitorId?.toString()).toBe(
                MONITOR_ID.toString(),
              );
            }

            // The monitor has owners, so the project owners are not consulted.
            expect(projectOwnerLookups).toEqual([]);
          });

          it(`the phone call says the probes are ${status}, not that a monitor was created`, async () => {
            for (const notification of sentToOwners()) {
              const sayMessage: string = (
                notification.callRequestMessage.data[0] as Say
              ).sayMessage;

              expect(sayMessage).toBe(
                `This is a message from OneUptime. Probes for monitor ${MONITOR_NAME} are ${status}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
              );
              expect(sayMessage).not.toContain("New monitor was created");
            }
          });

          it(`the SMS says the probes are ${status}`, async () => {
            for (const notification of sentToOwners()) {
              expect(notification.smsMessage.message).toBe(
                `This is a message from OneUptime. Probes for monitor ${MONITOR_NAME} are ${status}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
              );
            }
          });

          it("the push is a monitor-probe-status push, not the monitor-created one", async () => {
            for (const notification of sentToOwners()) {
              const push: SentNotification["pushNotificationMessage"] =
                notification.pushNotificationMessage;

              expect(push.title).toBe("OneUptime: Monitor Probe Status");
              expect(push.body).toBe(
                `Probes for monitor ${MONITOR_NAME} are ${status}`,
              );
              expect(push.tag).toBe("monitor-probe-status");
              expect(push.data).toEqual({
                type: "monitor-probe-status",
                monitorId: MONITOR_ID.toString(),
                monitorName: MONITOR_NAME,
              });
              expect(push.title).not.toBe("OneUptime: New Monitor Created");
              expect(push.body).not.toContain("New monitor was created");
            }
          });

          it(`the email is the probe-status email for ${status}, marked as sent to an owner`, async () => {
            for (const notification of sentToOwners()) {
              expect(notification.emailEnvelope.templateType).toBe(
                EmailTemplateType.MonitorProbesStatus,
              );
              expect(notification.emailEnvelope.subject).toBe(
                `[${status} Monitor Probes] ${MONITOR_NAME}`,
              );
              expect(notification.emailEnvelope.vars).toMatchObject({
                monitorName: MONITOR_NAME,
                currentStatus: status,
                projectName: PROJECT_NAME,
                monitorViewLink: MONITOR_LINK,
                isOwner: "true",
              });
            }
          });

          it(`the WhatsApp message carries the ${status} status and the monitor link`, async () => {
            for (const notification of sentToOwners()) {
              expect(
                notification.whatsAppMessage?.templateVariables,
              ).toMatchObject({
                monitor_name: MONITOR_NAME,
                probe_status: status,
                monitor_link: MONITOR_LINK,
              });
            }
          });
        });
      },
    );

    it("falls back to the project owners when the monitor has no owners", async () => {
      ownersToReturn = [];

      await MonitorService.notifyOwnersProbesDisconnected({
        monitorId: MONITOR_ID,
        isProbeDisconnected: true,
      });

      expect(
        projectOwnerLookups.map((projectId: ObjectID): string => {
          return projectId.toString();
        }),
      ).toEqual([PROJECT_ID.toString()]);
      expect(
        sent.map((notification: SentNotification): string => {
          return notification.userId.toString();
        }),
      ).toEqual([PROJECT_OWNER_ID.toString()]);

      // A project owner is not this monitor's owner; the email must not say so.
      expect(sent[0]!.emailEnvelope.vars).not.toHaveProperty("isOwner");
      expect((sent[0]!.callRequestMessage.data[0] as Say).sayMessage).toContain(
        `Probes for monitor ${MONITOR_NAME} are Disconnected`,
      );
    });

    it("sends nothing when neither the monitor nor the project has owners", async () => {
      ownersToReturn = [];
      projectOwnersToReturn = [];

      await MonitorService.notifyOwnersProbesDisconnected({
        monitorId: MONITOR_ID,
        isProbeDisconnected: true,
      });

      expect(sent).toEqual([]);
    });

    it("sends nothing for a monitor that no longer exists", async () => {
      monitorToReturn = null;

      await MonitorService.notifyOwnersProbesDisconnected({
        monitorId: MONITOR_ID,
        isProbeDisconnected: true,
      });

      expect(sent).toEqual([]);
    });
  });
});
