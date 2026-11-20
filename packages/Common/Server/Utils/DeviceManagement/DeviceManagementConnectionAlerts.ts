import Monitor from "../../../Models/DatabaseModels/Monitor";
import { MonitorFeedEventType } from "../../../Models/DatabaseModels/MonitorFeed";
import { Gray500 } from "../../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { DeviceManagementConnectionReadOutcome } from "../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import { getDeviceManagementProviderTitle } from "../../../Types/DeviceManagement/DeviceManagementProvider";
import {
  MonitorConnectionReads,
  getMonitorConnectionReads,
} from "../../../Types/DeviceManagement/ManagedDeviceAlertScope";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import MonitorFeedService from "../../Services/MonitorFeedService";
import MonitorService from "../../Services/MonitorService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import LlmConnectionPullRunner from "../LlmObservability/LlmConnectionPullRunner";
import logger, { LogAttributes } from "../Logger";
import MonitorTurnedOff, {
  MonitorTurnedOffRecordKind,
  MonitorTurnedOffResult,
} from "../Monitor/MonitorTurnedOff";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DeviceManagementConnectionReadMetrics, {
  DeviceManagementConnectionReadRecord,
} from "./DeviceManagementConnectionReadMetrics";

/*
 * WHAT A DEVICE MANAGEMENT CONNECTION'S ALERTS DO WHEN IT GOES AWAY (#10286).
 *
 * A connection's monitors read only what its reads write: its own reading
 * (Connection Stopped Reading) and its devices' (Stopped Checking In, Low
 * Battery, Storage Nearly Full, Security Patch Out of Date). A window with
 * no reading keeps their alerts as they are - silence is not recovery
 * (ManagedDeviceCheckInSilence) - so once nothing reads the connection,
 * nothing could ever resolve what they had open.
 *
 * TURNED OFF (isEnabled true to false) is a deliberate "stop reading this",
 * neither a recovery nor an outage:
 *
 *   - the connection writes one last reading of its own: 0 minutes, outcome
 *     "off" - no read of it is due, so none is overdue. Its monitor's next
 *     check reads it as the connection's newest reading, so it goes back to
 *     healthy and opens nothing again while the readings before it are
 *     still in its window;
 *   - what its Connection Stopped Reading monitors opened about it - each
 *     monitor that reads the connection's own reading and nothing else - is
 *     resolved now, those set to resolve on their own, saying who turned the
 *     connection off and that a new one opens if, turned back on, its reads
 *     still fail;
 *   - its devices' alerts stay as they are: the devices are still there, as
 *     the last read left them, and the next read once it is back on says how
 *     they are (the Inventory overview says so).
 *
 * DELETED: its devices go with it, and its id is never read again. Every
 * monitor that reads this connection alone - its own reading or its
 * devices' - has nothing left to watch: what it had open is resolved, saying
 * the connection was deleted, its monitoring is turned off (so nothing opens
 * again from the readings still in its window), and its feed says why. A
 * monitor that also reads something else is left as it is: a device of the
 * deleted connection drops out of it while the others read on, and resolves
 * as any device that left its fleet does.
 *
 * What a person set to stay open until they close it (auto-resolve off)
 * stays open, as when a monitor's monitoring is turned off
 * (MonitorTurnedOff). Nothing here fails the change that turned the
 * connection off or deleted it: each connection, and each monitor, in a try
 * of its own.
 */

// A connection that was turned off or deleted, as its service read it.
export interface DeviceManagementConnectionGone {
  connectionId: ObjectID;
  projectId: ObjectID;
  name?: string | null | undefined;
  provider?: string | null | undefined;
  // How often it was read, in minutes: on its last reading.
  readIntervalInMinutes?: number | undefined;
  lastSuccessfulPullAt?: Date | string | null | undefined;
  createdAt?: Date | string | null | undefined;
}

export interface DeviceManagementConnectionAlertsOutcome {
  connectionId: string;
  // Whether the connection's last reading, at 0, was written (turned off only).
  wroteLastReading: boolean;
  resolvedIncidentIds: Array<string>;
  resolvedAlertIds: Array<string>;
  // The monitors whose monitoring was turned off (deleted only).
  monitorIdsTurnedOff: Array<string>;
}

export interface DeviceManagementConnectionAlertsDependencies {
  // Test seam for whether the project may read telemetry.
  isTelemetryAllowed?: ((projectId: ObjectID) => Promise<boolean>) | undefined;
  // Test seam for the connection's own reading.
  recordConnectionReadings?:
    | ((
        records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
      ) => Promise<number>)
    | undefined;
  now?: (() => Date) | undefined;
}

// A monitor of the project that reads the connection, and what it reads of it.
export interface MonitorOfConnection {
  monitor: Monitor;
  reads: MonitorConnectionReads;
}

// The name a sentence calls the connection by: its own, or its service's.
function nameOf(connection: DeviceManagementConnectionGone): string {
  const name: string = (connection.name || "").trim();

  return (
    name || getDeviceManagementProviderTitle(connection.provider || undefined)
  );
}

export default class DeviceManagementConnectionAlerts {
  /*
   * Why an incident or alert of a Connection Stopped Reading monitor was
   * resolved when its connection was turned off, as its state timeline
   * says it: Markdown, the names placed as text.
   */
  public static getTurnedOffRootCause(data: {
    connectionName: string;
    turnedOffBy: MarkdownText;
  }): string {
    const turnedOff: MarkdownText = data.turnedOffBy.isEmpty()
      ? mdText`The device management connection **${data.connectionName}** was turned off.`
      : mdText`${data.turnedOffBy} turned off the device management connection **${data.connectionName}**.`;

    return mdText`${turnedOff} Nothing reads a connection while it is off, so none of its reads is overdue, and this was resolved. If the connection is turned back on and its reads still fail, its monitor opens a new one.`.toString();
  }

  /*
   * Why an incident or alert of a monitor that read a deleted connection
   * alone was resolved.
   */
  public static getDeletedRootCause(data: {
    connectionName: string;
    deletedBy: MarkdownText;
  }): string {
    const deleted: MarkdownText = data.deletedBy.isEmpty()
      ? mdText`The device management connection **${data.connectionName}** was deleted, and its devices with it.`
      : mdText`${data.deletedBy} deleted the device management connection **${data.connectionName}**, and its devices with it.`;

    return mdText`${deleted} Nothing is read for the monitor that opened this any more, so its monitoring was turned off, and this was resolved.`.toString();
  }

  // What the feed of a monitor turned off with its deleted connection says.
  public static getDeletedMonitorFeedMarkdown(data: {
    connectionName: string;
    deletedBy: MarkdownText;
  }): string {
    const deleted: MarkdownText = data.deletedBy.isEmpty()
      ? mdText`The device management connection **${data.connectionName}** this monitor reads was deleted, and its devices with it.`
      : mdText`${data.deletedBy} deleted the device management connection **${data.connectionName}** this monitor reads, and its devices with it.`;

    return mdText`🔌 **Monitoring was turned off: nothing is read for this monitor any more.**\n\n${deleted} Its open incidents and alerts that were set to resolve on their own were resolved. To watch the devices again, connect their device manager on Inventory, Managed Devices, and set up its alerts.`.toString();
  }

  /*
   * The project's Metrics monitors whose steps name the connection, each
   * with what it reads of it (getMonitorConnectionReads). Their steps are
   * read as text first - a monitor that names the connection's id anywhere
   * is a candidate, never a match - then each is held to what its queries
   * read.
   */
  @CaptureSpan()
  public static async findMonitorsOfConnection(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
  }): Promise<Array<MonitorOfConnection>> {
    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        monitorType: MonitorType.Metrics,
        monitorSteps: QueryHelper.textContainsAnyOf([
          data.connectionId.toString(),
        ]),
      } as never,
      select: {
        _id: true,
        projectId: true,
        name: true,
        monitorSteps: true,
        disableActiveMonitoring: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    return monitors
      .filter((monitor: Monitor): boolean => {
        return Boolean(monitor.id && monitor.projectId);
      })
      .map((monitor: Monitor): MonitorOfConnection => {
        return {
          monitor,
          reads: getMonitorConnectionReads({
            monitorSteps: monitor.monitorSteps,
            connectionId: data.connectionId.toString(),
          }),
        };
      })
      .filter((candidate: MonitorOfConnection): boolean => {
        return (
          candidate.reads.readsConnectionReading ||
          candidate.reads.readsDeviceReadings
        );
      });
  }

  /*
   * Connections turned off: each writes its last reading, and what its
   * Connection Stopped Reading monitors opened about it is resolved.
   */
  @CaptureSpan()
  public static async onConnectionsTurnedOff(data: {
    connections: ReadonlyArray<DeviceManagementConnectionGone>;
    turnedOffByUserId?: ObjectID | null | undefined;
    dependencies?: DeviceManagementConnectionAlertsDependencies | undefined;
  }): Promise<Array<DeviceManagementConnectionAlertsOutcome>> {
    const outcomes: Array<DeviceManagementConnectionAlertsOutcome> = [];

    for (const connection of data.connections) {
      const outcome: DeviceManagementConnectionAlertsOutcome =
        DeviceManagementConnectionAlerts.newOutcome(connection);

      outcome.wroteLastReading =
        await DeviceManagementConnectionAlerts.recordLastReading({
          connection,
          dependencies: data.dependencies || {},
        });

      try {
        const getTurnedOffBy: () => Promise<MarkdownText> =
          DeviceManagementConnectionAlerts.whoDidIt({
            userId: data.turnedOffByUserId,
            projectId: connection.projectId,
          });

        for (const candidate of await DeviceManagementConnectionAlerts.findMonitorsOfConnection(
          {
            projectId: connection.projectId,
            connectionId: connection.connectionId,
          },
        )) {
          // Connection Stopped Reading's: the connection's own reading, alone.
          if (
            !candidate.reads.readsThisConnectionAlone ||
            !candidate.reads.readsConnectionReading ||
            candidate.reads.readsDeviceReadings
          ) {
            continue;
          }

          DeviceManagementConnectionAlerts.addResolved(
            outcome,
            await MonitorTurnedOff.resolveWhatItWouldResolve({
              monitor: candidate.monitor,
              why: "after its device management connection was turned off",
              getRootCause: async (
                _kind: MonitorTurnedOffRecordKind,
              ): Promise<string> => {
                return DeviceManagementConnectionAlerts.getTurnedOffRootCause({
                  connectionName: nameOf(connection),
                  turnedOffBy: await getTurnedOffBy(),
                });
              },
            }),
          );
        }
      } catch (error) {
        logger.error(
          `Device management connection ${connection.connectionId.toString()} was turned off, but what its monitors had open about it could not be resolved: ${
            error instanceof Error ? error.message : String(error)
          }`,
          DeviceManagementConnectionAlerts.logAttributesOf(connection),
        );
      }

      outcomes.push(outcome);
    }

    return outcomes;
  }

  /*
   * Connections deleted: every monitor that read one of them alone has what
   * it had open resolved and its monitoring turned off, and its feed says
   * why.
   */
  @CaptureSpan()
  public static async onConnectionsDeleted(data: {
    connections: ReadonlyArray<DeviceManagementConnectionGone>;
    deletedByUserId?: ObjectID | null | undefined;
  }): Promise<Array<DeviceManagementConnectionAlertsOutcome>> {
    const outcomes: Array<DeviceManagementConnectionAlertsOutcome> = [];

    for (const connection of data.connections) {
      const outcome: DeviceManagementConnectionAlertsOutcome =
        DeviceManagementConnectionAlerts.newOutcome(connection);
      const getDeletedBy: () => Promise<MarkdownText> =
        DeviceManagementConnectionAlerts.whoDidIt({
          userId: data.deletedByUserId,
          projectId: connection.projectId,
        });

      let monitors: Array<MonitorOfConnection> = [];

      try {
        monitors = (
          await DeviceManagementConnectionAlerts.findMonitorsOfConnection({
            projectId: connection.projectId,
            connectionId: connection.connectionId,
          })
        ).filter((candidate: MonitorOfConnection): boolean => {
          return candidate.reads.readsThisConnectionAlone;
        });
      } catch (error) {
        logger.error(
          `Device management connection ${connection.connectionId.toString()} was deleted, but its monitors could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
          DeviceManagementConnectionAlerts.logAttributesOf(connection),
        );
      }

      for (const candidate of monitors) {
        const monitor: Monitor = candidate.monitor;

        try {
          DeviceManagementConnectionAlerts.addResolved(
            outcome,
            await MonitorTurnedOff.resolveWhatItWouldResolve({
              monitor,
              why: "after its device management connection was deleted",
              getRootCause: async (
                _kind: MonitorTurnedOffRecordKind,
              ): Promise<string> => {
                return DeviceManagementConnectionAlerts.getDeletedRootCause({
                  connectionName: nameOf(connection),
                  deletedBy: await getDeletedBy(),
                });
              },
            }),
          );

          if (monitor.disableActiveMonitoring === true) {
            continue;
          }

          /*
           * Its monitoring off, so nothing opens again from the readings
           * still in its window. As OneUptime: the person deleted the
           * connection, not the monitor's switch. MonitorService marks the
           * switch on its status timeline, and resolves anything a check on
           * its way opened meanwhile.
           */
          await MonitorService.updateOneById({
            id: monitor.id!,
            data: { disableActiveMonitoring: true },
            props: { isRoot: true, tenantId: connection.projectId },
          });

          outcome.monitorIdsTurnedOff.push(monitor.id!.toString());

          await MonitorFeedService.createMonitorFeedItem({
            monitorId: monitor.id!,
            projectId: connection.projectId,
            monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
            displayColor: Gray500,
            feedInfoInMarkdown:
              DeviceManagementConnectionAlerts.getDeletedMonitorFeedMarkdown({
                connectionName: nameOf(connection),
                deletedBy: await getDeletedBy(),
              }),
          });
        } catch (error) {
          logger.error(
            `Device management connection ${connection.connectionId.toString()} was deleted, but monitor ${monitor.id?.toString()} that read it could not be turned off: ${
              error instanceof Error ? error.message : String(error)
            }`,
            DeviceManagementConnectionAlerts.logAttributesOf(connection),
          );
        }
      }

      outcomes.push(outcome);
    }

    return outcomes;
  }

  /*
   * The connection's last reading (#10006's reading, outcome "off"): 0 -
   * nothing is due of a connection that is off. Written for a project that
   * may read telemetry, as every reading of it is. Guarded: false when it
   * could not be written, which leaves its monitor to resolve what was
   * resolved here once the readings before it leave its window.
   */
  private static async recordLastReading(data: {
    connection: DeviceManagementConnectionGone;
    dependencies: DeviceManagementConnectionAlertsDependencies;
  }): Promise<boolean> {
    const connection: DeviceManagementConnectionGone = data.connection;
    const now: Date = data.dependencies.now
      ? data.dependencies.now()
      : new Date();

    try {
      const isAllowed: boolean = await (
        data.dependencies.isTelemetryAllowed ||
        ((projectId: ObjectID): Promise<boolean> => {
          return LlmConnectionPullRunner.isTelemetryAllowed(projectId);
        })
      )(connection.projectId);

      if (!isAllowed) {
        return false;
      }

      await (
        data.dependencies.recordConnectionReadings ||
        ((
          records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
        ): Promise<number> => {
          return DeviceManagementConnectionReadMetrics.record(records);
        })
      )([
        {
          projectId: connection.projectId,
          connectionId: connection.connectionId,
          reading: {
            connectionName: connection.name,
            provider: connection.provider,
            readIntervalInMinutes: connection.readIntervalInMinutes || 15,
            outcome: DeviceManagementConnectionReadOutcome.Off,
            lastSuccessfulReadAt: connection.lastSuccessfulPullAt,
            createdAt: connection.createdAt,
            asOf: now,
          },
        },
      ]);

      return true;
    } catch (error) {
      logger.error(
        `Device management connection ${connection.connectionId.toString()} was turned off, but its last reading could not be recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
        DeviceManagementConnectionAlerts.logAttributesOf(connection),
      );

      return false;
    }
  }

  // Who turned the connection off or deleted it, read once and only when needed.
  private static whoDidIt(data: {
    userId?: ObjectID | null | undefined;
    projectId: ObjectID;
  }): () => Promise<MarkdownText> {
    let who: MarkdownText | null = null;

    return async (): Promise<MarkdownText> => {
      if (who) {
        return who;
      }

      who = data.userId
        ? await UserService.getUserMarkdownString({
            userId: data.userId,
            projectId: data.projectId,
          })
        : FeedMarkdown.empty();

      return who;
    };
  }

  private static newOutcome(
    connection: DeviceManagementConnectionGone,
  ): DeviceManagementConnectionAlertsOutcome {
    return {
      connectionId: connection.connectionId.toString(),
      wroteLastReading: false,
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
      monitorIdsTurnedOff: [],
    };
  }

  private static addResolved(
    outcome: DeviceManagementConnectionAlertsOutcome,
    result: MonitorTurnedOffResult,
  ): void {
    outcome.resolvedIncidentIds.push(...result.resolvedIncidentIds);
    outcome.resolvedAlertIds.push(...result.resolvedAlertIds);
  }

  private static logAttributesOf(
    connection: DeviceManagementConnectionGone,
  ): LogAttributes {
    return {
      projectId: connection.projectId.toString(),
      deviceManagementConnectionId: connection.connectionId.toString(),
    } as LogAttributes;
  }
}
