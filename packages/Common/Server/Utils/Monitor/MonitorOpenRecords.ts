import GlobalCache from "../../Infrastructure/GlobalCache";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import { DataSource } from "typeorm";
import { randomUUID } from "crypto";

/*
 * Whether a monitor is known to have no open incident, or no open alert,
 * that one of its criteria raised - so a result can leave out the read of
 * them it makes only to auto-resolve them.
 *
 * Every result that meets a criteria, and every result that puts a monitor
 * back on its default status, reads the monitor's open incidents and its
 * open alerts (MonitorIncident.checkOpenIncidentsAndCloseIfResolved, and
 * the alert twin), for two things:
 *
 *   - to auto-resolve those a criteria raised (only a record with a
 *     createdCriteriaId is ever resolved there: isAutoResolveConfigured...);
 *   - for a criteria that opens records, to open none beside one already
 *     open.
 *
 * When the criteria met opens nothing - a healthy check, almost every
 * result - only the first is asked, and a monitor with no record its
 * criteria raised has nothing to resolve. So a result skips the read when
 * this says "none open" (MonitorResource), and records "none open" when the
 * read it made found none still open (markNoneOpen).
 *
 * "None open" must never outlive the truth: a result that skipped the read
 * while such a record was open would leave it open. A record a criteria
 * raised becomes open for a monitor in exactly these ways, and each one
 * makes every "none open" recorded before it unusable:
 *
 *   - a criteria raises it (MonitorIncident / MonitorAlert, under the
 *     monitor's lock), or a record is reopened, or linked to the monitor:
 *     each one is an update of the incident's current state or monitors, or
 *     the alert's current state or monitor, through IncidentService /
 *     AlertService, whose onUpdateSuccess calls forgetMonitorsOfIncidents /
 *     forgetMonitorsOfAlerts (createdCriteriaId cannot be written through the
 *     API, so only those records count; a guard test holds every other write
 *     of those columns out: MonitorOpenRecordsWrites.test.ts);
 *   - the project's states change, which can make a state that counted as
 *     resolved count as open (IncidentStateService / AlertStateService call
 *     forgetProject).
 *
 * Each of those starts a new token - of the monitor, or of its project - and
 * "none open" is recorded under the tokens read BEFORE the read that found
 * none. A change that lands between that read and the record therefore
 * leaves a stamp that no longer matches, never a stale "none open": the
 * change is committed before its token is replaced, so either the read saw
 * it, or the token it replaces is the one the record was stamped with.
 * Tokens are random, so one that comes back after it was dropped by Redis
 * can never match an old stamp, and a missing token is never matched at
 * all. A stamp also runs out after NONE_OPEN_TTL_SECONDS, the outer bound
 * for anything that ever went wrong in Redis between a change and its new
 * token.
 *
 * Kept in Redis (Valkey): every server sees every change. Nothing here
 * throws - a Redis that cannot be reached reads as "nothing known", and the
 * result reads its records as it always did.
 */

export enum MonitorRecordKind {
  Incident = "incident",
  Alert = "alert",
}

export interface MonitorOpenRecordsReading {
  // The kinds known to have no open record a criteria raised.
  noneOpen: Record<MonitorRecordKind, boolean>;
  /*
   * The tokens this reading was made under: what "none open" is recorded
   * with after a read made after this one. Null when they could not be read.
   */
  stamp: string | null;
}

export const NOTHING_KNOWN: MonitorOpenRecordsReading = {
  noneOpen: {
    [MonitorRecordKind.Incident]: false,
    [MonitorRecordKind.Alert]: false,
  },
  stamp: null,
};

export default class MonitorOpenRecords {
  public static readonly NAMESPACE: string = "monitor-open-records";

  /*
   * How long "none open" is believed at most. A monitor that stays healthy
   * reads its records once in this time: the bound on anything a lost token
   * write could leave behind.
   */
  public static readonly NONE_OPEN_TTL_SECONDS: number = 15 * 60;

  // How long a token lives; one that runs out only ends the stamps under it.
  public static readonly TOKEN_TTL_SECONDS: number = 7 * 24 * 60 * 60;

  /*
   * What is known of the monitor's open records, read with the tokens it
   * holds under. Called under the monitor's lock, before the result reads
   * or skips its records. Never throws.
   */
  public static async read(input: {
    monitorId: ObjectID;
    projectId: ObjectID;
  }): Promise<MonitorOpenRecordsReading> {
    try {
      const tokenKeys: Array<string> = this.getTokenKeys(input);

      const values: Array<string | null> = await GlobalCache.getStrings(
        this.NAMESPACE,
        [
          ...tokenKeys,
          this.getNoneOpenKey(input.monitorId, MonitorRecordKind.Incident),
          this.getNoneOpenKey(input.monitorId, MonitorRecordKind.Alert),
        ],
      );

      let tokens: Array<string | null> = values.slice(0, tokenKeys.length);

      if (tokens.some(this.isMissing)) {
        /*
         * A token not set yet, or dropped: nothing recorded can match it.
         * Set it now, so the read this result makes can be recorded under
         * it, and read back the one that stands if another server set it
         * first.
         */
        await Promise.all(
          tokenKeys.map(async (key: string, index: number): Promise<void> => {
            if (this.isMissing(tokens[index] || null)) {
              await GlobalCache.setStringIfNotExists(
                this.NAMESPACE,
                key,
                randomUUID(),
                { expiresInSeconds: this.TOKEN_TTL_SECONDS },
              );
            }
          }),
        );

        tokens = await GlobalCache.getStrings(this.NAMESPACE, tokenKeys);

        if (tokens.some(this.isMissing)) {
          return NOTHING_KNOWN;
        }

        // Nothing recorded before can match a token set just now.
        return {
          noneOpen: {
            [MonitorRecordKind.Incident]: false,
            [MonitorRecordKind.Alert]: false,
          },
          stamp: tokens.join("."),
        };
      }

      const stamp: string = tokens.join(".");

      return {
        noneOpen: {
          [MonitorRecordKind.Incident]: values[tokenKeys.length] === stamp,
          [MonitorRecordKind.Alert]: values[tokenKeys.length + 1] === stamp,
        },
        stamp: stamp,
      };
    } catch (err) {
      logger.debug(
        `${input.monitorId.toString()} - Could not read what is known of the monitor's open records. Reading them instead.`,
      );
      logger.debug(err);
      return NOTHING_KNOWN;
    }
  }

  /*
   * Records that the monitor has no open record of `kind` a criteria
   * raised, as of a read made after `reading`. Called under the monitor's
   * lock. Never throws.
   */
  public static async markNoneOpen(input: {
    monitorId: ObjectID;
    kind: MonitorRecordKind;
    reading: MonitorOpenRecordsReading;
  }): Promise<void> {
    if (!input.reading.stamp) {
      return;
    }

    try {
      await GlobalCache.setString(
        this.NAMESPACE,
        this.getNoneOpenKey(input.monitorId, input.kind),
        input.reading.stamp,
        { expiresInSeconds: this.NONE_OPEN_TTL_SECONDS },
      );
    } catch (err) {
      logger.debug(
        `${input.monitorId.toString()} - Could not record that the monitor has no open ${input.kind}. Its next result reads them.`,
      );
      logger.debug(err);
    }
  }

  /*
   * A record a criteria raised may have become open for these monitors:
   * nothing recorded of them before counts. Never throws.
   */
  public static async forgetMonitors(
    monitorIds: Array<ObjectID | string | null | undefined>,
  ): Promise<void> {
    const ids: Array<string> = this.toIds(monitorIds);

    await Promise.all(
      ids.map(async (id: string): Promise<void> => {
        await this.replaceToken(this.getMonitorTokenKey(id));
      }),
    );
  }

  /*
   * The project's states changed: nothing recorded of its monitors before
   * counts. Never throws.
   */
  public static async forgetProject(
    projectId: ObjectID | string | null | undefined,
  ): Promise<void> {
    if (!projectId?.toString()) {
      return;
    }

    await this.replaceToken(this.getProjectTokenKey(projectId.toString()));
  }

  /*
   * Incidents whose current state or monitors were just written: the
   * monitors of those a criteria raised are forgotten. When they cannot be
   * found, nothing recorded anywhere counts any more. Never throws.
   */
  public static async forgetMonitorsOfIncidents(
    incidentIds: Array<ObjectID>,
  ): Promise<void> {
    await this.forgetMonitorsFound({
      ids: incidentIds,
      sql: `SELECT DISTINCT im."monitorId" AS "monitorId"
              FROM "IncidentMonitor" im
              INNER JOIN "Incident" i ON i."_id" = im."incidentId"
             WHERE im."incidentId" = ANY($1::uuid[])
               AND i."createdCriteriaId" IS NOT NULL`,
      description: "incidents",
    });
  }

  // The same for alerts, whose current state or monitor was just written.
  public static async forgetMonitorsOfAlerts(
    alertIds: Array<ObjectID>,
  ): Promise<void> {
    await this.forgetMonitorsFound({
      ids: alertIds,
      sql: `SELECT DISTINCT "monitorId" AS "monitorId"
              FROM "Alert"
             WHERE "_id" = ANY($1::uuid[])
               AND "createdCriteriaId" IS NOT NULL
               AND "monitorId" IS NOT NULL`,
      description: "alerts",
    });
  }

  /*
   * Nothing recorded of any monitor counts any more: for a change whose
   * monitors could not be found. Never throws.
   */
  public static async forgetAll(): Promise<void> {
    await this.replaceToken(this.getAllTokenKey());
  }

  private static async forgetMonitorsFound(input: {
    ids: Array<ObjectID>;
    sql: string;
    description: string;
  }): Promise<void> {
    const ids: Array<string> = this.toIds(input.ids);

    if (ids.length === 0) {
      return;
    }

    try {
      const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

      if (!dataSource) {
        throw new Error("The database is not connected.");
      }

      const rows: Array<{ monitorId: string }> = (await dataSource.query(
        input.sql,
        [ids],
      )) as Array<{ monitorId: string }>;

      await this.forgetMonitors(
        rows.map((row: { monitorId: string }) => {
          return row.monitorId;
        }),
      );
    } catch (err) {
      // Safe either way: every monitor reads its open records again.
      logger.warn(
        `Could not find the monitors of ${input.description} that changed, so every monitor reads its open records again: ${String(err)}`,
      );
      await this.forgetAll();
    }
  }

  private static async replaceToken(key: string): Promise<void> {
    try {
      await GlobalCache.setString(this.NAMESPACE, key, randomUUID(), {
        expiresInSeconds: this.TOKEN_TTL_SECONDS,
      });
    } catch (err) {
      /*
       * Lost: a "none open" recorded before stays usable until it runs out
       * (NONE_OPEN_TTL_SECONDS). A warning, as CacheGenerations says a change
       * Redis did not take - it is the one way a skipped read can miss a
       * record. Names no monitor or project: the key does.
       */
      logger.warn(
        `Monitors' open records: Redis did not take a change, so a monitor may skip reading its open records for up to ${this.NONE_OPEN_TTL_SECONDS} seconds: ${String(err)}`,
      );
    }
  }

  private static getTokenKeys(input: {
    monitorId: ObjectID;
    projectId: ObjectID;
  }): Array<string> {
    return [
      this.getAllTokenKey(),
      this.getProjectTokenKey(input.projectId.toString()),
      this.getMonitorTokenKey(input.monitorId.toString()),
    ];
  }

  private static getAllTokenKey(): string {
    return "token-all";
  }

  private static getProjectTokenKey(projectId: string): string {
    return `token-project-${projectId.toLowerCase()}`;
  }

  private static getMonitorTokenKey(monitorId: string): string {
    return `token-monitor-${monitorId.toLowerCase()}`;
  }

  private static getNoneOpenKey(
    monitorId: ObjectID,
    kind: MonitorRecordKind,
  ): string {
    return `none-open-${kind}-${monitorId.toString().toLowerCase()}`;
  }

  private static isMissing(this: void, value: string | null): boolean {
    return !value;
  }

  private static toIds(
    ids: Array<ObjectID | string | null | undefined>,
  ): Array<string> {
    return Array.from(
      new Set<string>(
        ids
          .map((id: ObjectID | string | null | undefined) => {
            return id?.toString().toLowerCase() || "";
          })
          .filter((id: string) => {
            return Boolean(id);
          }),
      ),
    );
  }
}
