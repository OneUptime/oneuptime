import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import {
  DataCheckHealth,
  DataCheckHealthAnswer,
  getDataCheckHealthRank,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import ObjectID from "../../../Types/ObjectID";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import DataCheckService from "../../Services/DataCheckService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import DataObservabilityAttentionReader from "./DataObservabilityAttentionReader";
import { DataSource } from "typeorm";

/*
 * A CHECK'S HEALTH, KEPT ON THE CHECK (#6554).
 *
 * Checks lists failing checks first and filters by health on the server, so
 * a failing check is never on the third page while the first shows passing
 * ones. Health is worked out by the rule the Status column reads
 * (getDataCheckHealth: failing while an alert of its monitor is open, could
 * not run when its query failed, ...), and written to DataCheck.health and
 * healthRank whenever what it is worked out from changes:
 *
 *   - the check runs, or dbt reports its test (DataCheckIngest, DbtIngest);
 *   - an alert of its monitor opens, changes state or resolves, by the
 *     monitor or by a person (AlertService.onUpdateSuccess: every state an
 *     alert moves to is written there, its first one included);
 *   - it is turned on or off, or its alert is set up or removed
 *     (DataCheckService, DataCheckAlerts).
 *
 * Every run reads the alerts again, so a change missed in between - an
 * alert deleted, or made private - is put right at the check's next run.
 *
 * Only an alert every reader may see counts (read as no one: the alerts
 * that are not private), so a check whose open alert is private is listed
 * as its last run says to those it is private from; the Status column still
 * reads each person's own alerts (DataObservabilityAttentionReader
 * .getCheckHealth with the reader).
 *
 * Nothing here throws: a health that cannot be written stays as it was, and
 * the next change writes it.
 */

// The most checks one refresh reads: far more than one alert or one run touches.
const MAX_CHECKS_PER_REFRESH: number = 1_000;

export interface StoredDataCheckHealth {
  health: DataCheckHealth;
  healthRank: number;
}

export default class DataCheckHealthSync {
  // The columns a check's health is worked out from.
  public static readonly SELECT: {
    _id: true;
    projectId: true;
    checkType: true;
    isEnabled: true;
    lastRunAt: true;
    lastRunStatus: true;
    monitorId: true;
    health: true;
    healthRank: true;
  } = {
    _id: true,
    projectId: true,
    checkType: true,
    isEnabled: true,
    lastRunAt: true,
    lastRunStatus: true,
    monitorId: true,
    health: true,
    healthRank: true,
  };

  // What is stored for a health: the health, and its place worst first.
  public static toStored(health: DataCheckHealth): StoredDataCheckHealth {
    return { health, healthRank: getDataCheckHealthRank(health) };
  }

  // Whether what a check holds is already what it should.
  public static isStored(
    check: Pick<DataCheck, "health" | "healthRank">,
    stored: StoredDataCheckHealth,
  ): boolean {
    return (
      check.health === stored.health && check.healthRank === stored.healthRank
    );
  }

  /*
   * Works out the health of these checks now and writes each one that
   * changed. Returns how many were written. Never throws.
   */
  public static async refreshChecks(data: {
    checkIds: Array<ObjectID | string>;
    projectId?: ObjectID | undefined;
  }): Promise<number> {
    const ids: Array<string> = Array.from(
      new Set(
        data.checkIds
          .map((id: ObjectID | string): string => {
            return id.toString();
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    ).slice(0, MAX_CHECKS_PER_REFRESH);

    if (ids.length === 0) {
      return 0;
    }

    try {
      const checks: Array<DataCheck> = await DataCheckService.findBy({
        query: {
          _id: QueryHelper.any(ids),
          ...(data.projectId ? { projectId: data.projectId } : {}),
        },
        select: this.SELECT,
        skip: 0,
        limit: ids.length,
        props: { isRoot: true },
      });

      return await this.writeHealthOf(checks);
    } catch (error) {
      logger.error(
        `Data Observability: could not keep the health of ${ids.length} checks: ${error}`,
      );
      return 0;
    }
  }

  /*
   * For alerts whose state or monitor was just written: the health of the
   * checks their monitors alert for. One indexed read finds them; an alert
   * of any other monitor - nearly every alert - costs that read alone.
   * Never throws.
   */
  public static async refreshForAlerts(
    alertIds: Array<ObjectID | string>,
  ): Promise<number> {
    const ids: Array<string> = Array.from(
      new Set(
        alertIds
          .map((id: ObjectID | string): string => {
            return id.toString();
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    );

    if (ids.length === 0) {
      return 0;
    }

    try {
      const checkIds: Array<string> = await this.findChecksOfAlerts(ids);

      if (checkIds.length === 0) {
        return 0;
      }

      return await this.refreshChecks({ checkIds });
    } catch (error) {
      logger.error(
        `Data Observability: could not keep the health of the checks of ${ids.length} alerts: ${error}`,
      );
      return 0;
    }
  }

  /*
   * For alerts that were just deleted: the health of the checks of the
   * monitors that raised them. A deleted alert is open no more, so a check
   * it kept failing passes again. Its monitors were read before the delete
   * (AlertService.onBeforeDelete): the alert may no longer be there to
   * join through. Never throws.
   */
  public static async refreshForMonitors(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID | string>;
  }): Promise<number> {
    const monitorIds: Array<string> = Array.from(
      new Set(
        data.monitorIds
          .map((id: ObjectID | string): string => {
            return id.toString();
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    );

    if (monitorIds.length === 0) {
      return 0;
    }

    try {
      const checks: Array<DataCheck> = await DataCheckService.findBy({
        query: {
          projectId: data.projectId,
          monitorId: QueryHelper.any(monitorIds),
        },
        select: { _id: true },
        skip: 0,
        limit: MAX_CHECKS_PER_REFRESH,
        props: { isRoot: true },
      });

      if (checks.length === 0) {
        return 0;
      }

      return await this.refreshChecks({
        projectId: data.projectId,
        checkIds: checks
          .map((check: DataCheck): string => {
            return check.id?.toString() || "";
          })
          .filter(Boolean),
      });
    } catch (error) {
      logger.error(
        `Data Observability: could not keep the health of the checks of ${monitorIds.length} monitors: ${error}`,
      );
      return 0;
    }
  }

  // The checks whose monitor raised one of these alerts.
  public static async findChecksOfAlerts(
    alertIds: Array<string>,
  ): Promise<Array<string>> {
    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return [];
    }

    const rows: Array<{ checkId: string }> = (await dataSource.query(
      `SELECT DISTINCT check_row."_id" AS "checkId"
         FROM "Alert" alert_row
         JOIN "DataCheck" check_row
           ON check_row."monitorId" = alert_row."monitorId"
          AND check_row."projectId" = alert_row."projectId"
          AND check_row."deletedAt" IS NULL
        WHERE alert_row."_id" = ANY($1::uuid[])
          AND alert_row."monitorId" IS NOT NULL`,
      [alertIds],
    )) as Array<{ checkId: string }>;

    return rows
      .map((row: { checkId: string }): string => {
        return String(row.checkId || "");
      })
      .filter(Boolean);
  }

  /*
   * Works out each check's health with the alerts no one is kept from (the
   * attention reader, read as no one), and writes those that changed.
   */
  public static async writeHealthOf(checks: Array<DataCheck>): Promise<number> {
    const byProject: Map<string, Array<DataCheck>> = new Map();

    for (const check of checks) {
      if (!check.id || !check.projectId) {
        continue;
      }

      const key: string = check.projectId.toString();
      const list: Array<DataCheck> = byProject.get(key) || [];
      list.push(check);
      byProject.set(key, list);
    }

    let written: number = 0;

    for (const [projectId, projectChecks] of byProject) {
      const answers: Map<string, DataCheckHealthAnswer> =
        await DataObservabilityAttentionReader.getCheckHealth({
          projectId: new ObjectID(projectId),
          // No one: only the alerts that are not private count.
          reader: {},
          checks: projectChecks,
          throwsWhenAlertsUnreadable: true,
        });

      for (const check of projectChecks) {
        const answer: DataCheckHealthAnswer | undefined = answers.get(
          check.id!.toString(),
        );

        if (!answer) {
          continue;
        }

        const stored: StoredDataCheckHealth = this.toStored(answer.health);

        if (this.isStored(check, stored)) {
          continue;
        }

        try {
          await DataCheckService.updateColumnsByIdWithoutHooks({
            id: check.id!,
            data: stored as never,
          });
          written++;
        } catch (error) {
          logger.error(
            `Data Observability: could not write the health of check ${check.id!.toString()}: ${error}`,
          );
        }
      }
    }

    return written;
  }
}
