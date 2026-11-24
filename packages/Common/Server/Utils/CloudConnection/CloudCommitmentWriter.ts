import CloudCommitment from "../../../Models/DatabaseModels/CloudCommitment";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  CloudCommitmentAlertState,
  readCloudCommitmentAlertState,
} from "../../../Types/Cloud/CloudCommitmentAlerts";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { roundCost } from "../../../Types/Cloud/CloudCost";
import ColumnLength from "../../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudCommitmentService from "../../Services/CloudCommitmentService";
import logger from "../Logger";
import {
  CloudCommitmentInventoryRead,
  CloudCommitmentRecord,
} from "./CloudConnectorTypes";

/*
 * KEEPS A PROJECT'S COMMITMENTS IN STEP WITH ITS CLOUDS (#11011).
 *
 * Each read of the savings lane lists the commitments its connection can
 * see (CloudCommitmentInventoryRead); they are kept as CloudCommitment
 * rows, one per commitment by its id in its cloud, each on the account
 * that bought it when OneUptime holds that account - else on the account
 * the read was made from (an organization's management account, a
 * tenant's first subscription). A commitment the cloud no longer lists is
 * removed - but only among the accounts this read covered, and only when
 * the list was read in full: a list cut short, or another connection's
 * accounts, keep what they have. Its alert state (CloudCommitment.
 * alertState) is never touched here: the alert evaluator keeps it.
 */

export interface CloudCommitmentWriteResult {
  created: number;
  updated: number;
  removed: number;
  // Commitments of accounts OneUptime holds no row for, and none to fall back on.
  withoutAccount: number;
  // The open alerts of the commitments removed: resolved by the alert evaluator.
  orphanedAlertIds: Array<string>;
}

// Text kept within its column's length.
function clamp(value: string | undefined | null, length: number): string {
  return (value || "").slice(0, length);
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? value
    : null;
}

export default class CloudCommitmentWriter {
  // A record's row fields: what one read of its cloud says of it.
  public static toFields(data: {
    record: CloudCommitmentRecord;
    cloudAccountId: ObjectID;
    now: Date;
  }): Partial<CloudCommitment> {
    const record: CloudCommitmentRecord = data.record;
    const fields: Partial<CloudCommitment> = {
      cloudAccountId: data.cloudAccountId,
      kind: record.kind,
      name:
        clamp(record.name, ColumnLength.LongText) ||
        clamp(record.commitmentId, ColumnLength.LongText),
      commitmentType: clamp(record.commitmentType, ColumnLength.LongText),
      covers: clamp(record.covers, ColumnLength.LongText),
      region: clamp(record.region, ColumnLength.ShortText),
      appliesTo: clamp(record.appliesTo, ColumnLength.LongText),
      state: record.state,
      currency: clamp(record.currency || "USD", ColumnLength.ShortText),
      lastSeenAt: data.now,
    };

    /*
     * Every other column is written as the cloud says it - null when it
     * says nothing - so a figure that is no longer read is not kept stale.
     */
    const values: Record<string, unknown> = {
      scope: record.scope,
      termMonths: finiteOrNull(record.termMonths),
      paymentOption: record.paymentOption,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      isAutoRenew: record.isAutoRenew,
      hourlyCommitment: finiteOrNull(record.hourlyCommitment),
      quantity: finiteOrNull(record.quantity),
      upfrontCost: finiteOrNull(record.upfrontCost),
      recurringHourlyCost: finiteOrNull(record.recurringHourlyCost),
      utilizationPercent:
        finiteOrNull(record.utilizationPercent) === null
          ? null
          : roundCost(record.utilizationPercent!),
      weekUtilizationPercent:
        finiteOrNull(record.weekUtilizationPercent) === null
          ? null
          : roundCost(record.weekUtilizationPercent!),
      figures: record.figures as unknown as JSONObject | null,
    };

    Object.assign(fields, values);

    return fields;
  }

  public static async write(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    inventory: CloudCommitmentInventoryRead;
    // The project's accounts of this cloud: an account's id in it (lower case) -> its row.
    accountRows: Map<string, ObjectID>;
    // The accounts this read covered (lower case): only theirs may be removed.
    accountsRead: Set<string>;
    // Where a commitment of an account OneUptime does not hold is kept.
    fallbackAccountId?: string | undefined;
    now: Date;
  }): Promise<CloudCommitmentWriteResult> {
    const result: CloudCommitmentWriteResult = {
      created: 0,
      updated: 0,
      removed: 0,
      withoutAccount: 0,
      orphanedAlertIds: [],
    };
    const fallbackRow: ObjectID | undefined = data.fallbackAccountId
      ? data.accountRows.get(data.fallbackAccountId.trim().toLowerCase())
      : undefined;
    const coveredRows: Array<ObjectID> = Array.from(data.accountsRead)
      .map((accountId: string): ObjectID | undefined => {
        return data.accountRows.get(accountId);
      })
      .filter((row: ObjectID | undefined): row is ObjectID => {
        return Boolean(row);
      });
    const existing: Array<CloudCommitment> = await CloudCommitmentService.findBy(
      {
        query: { projectId: data.projectId, provider: data.provider },
        select: {
          _id: true,
          commitmentId: true,
          cloudAccountId: true,
          alertState: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      },
    );
    const existingById: Map<string, CloudCommitment> = new Map();

    for (const row of existing) {
      if (row.commitmentId) {
        existingById.set(row.commitmentId, row);
      }
    }

    const seen: Set<string> = new Set<string>();

    for (const record of data.inventory.records) {
      const commitmentId: string = clamp(
        record.commitmentId,
        ColumnLength.LongText,
      );
      const cloudAccountId: ObjectID | undefined =
        data.accountRows.get(record.accountId.trim().toLowerCase()) ||
        fallbackRow;

      if (!commitmentId) {
        continue;
      }

      if (!cloudAccountId) {
        result.withoutAccount++;
        continue;
      }

      seen.add(commitmentId);

      const fields: Partial<CloudCommitment> = CloudCommitmentWriter.toFields({
        record,
        cloudAccountId,
        now: data.now,
      });

      try {
        const row: CloudCommitment | undefined =
          existingById.get(commitmentId);

        if (row?.id) {
          await CloudCommitmentService.updateOneById({
            id: row.id,
            data: fields as never,
            props: { isRoot: true, ignoreHooks: true },
          });
          result.updated++;
        } else {
          const created: CloudCommitment = new CloudCommitment();
          created.projectId = data.projectId;
          created.provider = data.provider;
          created.commitmentId = commitmentId;
          Object.assign(created, fields);

          await CloudCommitmentService.create({
            data: created,
            props: { isRoot: true, ignoreHooks: true },
          });
          result.created++;
        }
      } catch (error) {
        logger.error(
          `Cloud commitments: ${commitmentId} could not be kept: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // What the cloud no longer lists, among the accounts read in full.
    if (data.inventory.complete && coveredRows.length > 0) {
      const covered: Set<string> = new Set<string>(
        coveredRows.map((row: ObjectID): string => {
          return row.toString();
        }),
      );
      const goneRows: Array<CloudCommitment> = existing.filter(
        (row: CloudCommitment): boolean => {
          return (
            Boolean(row.id) &&
            Boolean(row.commitmentId) &&
            !seen.has(row.commitmentId!) &&
            covered.has(row.cloudAccountId?.toString() || "")
          );
        },
      );
      const gone: Array<ObjectID> = goneRows.map(
        (row: CloudCommitment): ObjectID => {
          return row.id!;
        },
      );

      for (const row of goneRows) {
        const state: CloudCommitmentAlertState = readCloudCommitmentAlertState(
          row.alertState,
        );

        for (const alertId of [state.expiryAlertId, state.underUseAlertId]) {
          if (alertId) {
            result.orphanedAlertIds.push(alertId);
          }
        }
      }

      if (gone.length > 0) {
        await CloudCommitmentService.deleteBy({
          query: { _id: new Includes(gone) },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
        result.removed = gone.length;
      }
    }

    return result;
  }
}
