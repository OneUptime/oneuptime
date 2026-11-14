import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";

/*
 * How the probes' claims - the monitors a probe checks next
 * (MonitorProbeService.claimMonitorProbesForProbing), the network devices it
 * polls next (NetworkDeviceService.claimDevicesForPolling), and the vCenters,
 * OpenStack clouds and checks and data stores it collects or scans
 * (claimSetAsideStatement, below) - treat a row that is due but that nothing
 * may hand out right now: a paused, archived or in-maintenance monitor, a
 * device with polling off or no address, a cloud switched to its agent, a
 * check turned off, a store whose scan is off, anything of a suspended,
 * blocked, sample or deleted project.
 *
 * Each claim walks its probe's rows in the order of a (probeId, ...,
 * next-due) index and only ever moves the rows it hands out. A row nothing
 * may hand out therefore kept the next-due time it had when it stopped being
 * claimable - the oldest on the probe - and sat at the head of that index for
 * good, where every claim stepped over it, and over every other one like it,
 * before reaching a row it could hand out: from every worker of every probe
 * replica, every minute. A claim's cost grew with the number of paused
 * monitors and suspended projects, not with its batch - on a probe with
 * 60,000 monitor probes, 24,000 of them paused or in a suspended project,
 * 372 ms and 39,774 buffers to hand out 200 monitors, all from cache - and a
 * fleet whose probes autoscale on their pending count made more of those
 * claims the further behind it fell.
 *
 * So after a claim, the rows it stepped over are set aside: their next-due
 * time moves SET_ASIDE_FOR_MINUTES on, plus up to SET_ASIDE_SPREAD_IN_MINUTES
 * picked per row, so rows set aside together do not all come due again in
 * the same instant. Each is judged again in the statement that moves it, by
 * the same rule the claim hands rows out by, so a row the claim would hand
 * out is never one it moves.
 *
 * Making a row claimable again does not wait for this: turning a monitor
 * back on (MonitorService) or a device's polling back on, its address or
 * its probe (NetworkDeviceService) makes it due at once. A project that is
 * served again - paid, unblocked - has its rows picked up the next time
 * they come due, within SET_ASIDE_FOR_MINUTES plus the spread.
 */
export const SET_ASIDE_FOR_MINUTES: number = 15;
export const SET_ASIDE_SPREAD_IN_MINUTES: number = 5;

/*
 * The most rows one set-aside statement moves, and how many such statements
 * one claim runs while each moves a full batch - so a claim sets aside at
 * most SET_ASIDE_PER_CLAIM x SET_ASIDE_ROUNDS_PER_CLAIM rows.
 *
 * Bounds each statement, and the work a claim does before it answers. A
 * backlog - everything that stopped being claimable before set-aside
 * existed, on a probe's first claims after an upgrade - drains over a few
 * claims. And it keeps the head clean in steady state: rows set aside come
 * due again every SET_ASIDE_FOR_MINUTES plus the spread, and a probe whose
 * workers claim three times a minute can set aside 6,000 a minute, enough
 * for every probe short of one with ~100,000 rows nothing may claim.
 */
export const SET_ASIDE_PER_CLAIM: number = 500;
export const SET_ASIDE_ROUNDS_PER_CLAIM: number = 4;

/*
 * THE SET-ASIDE OF A ONE-STATEMENT CLAIM.
 *
 * The claims that hand a probe its vCenters (VMwareProbeCollectionStore),
 * OpenStack clouds (OpenStackProbeCollectionStore) and checks
 * (OpenStackCheckStore), and the data stores whose tables it collects
 * (DataObservabilityProbeClaim) or whose content it scans
 * (DataSecurityProbeClaim), each claim in one statement that moves only the
 * rows it hands out. They had the flaw the monitor and device claims had: a
 * row due but not claimable kept its old due time for good, at the head of
 * the probe's range, read by every claim (OneUptime issue #7919). Their
 * tables hold a row per vCenter, cloud or store, so this cost less, but the
 * fix is the same, and this statement is it, shared so the five cannot
 * drift apart.
 *
 * After the claim, it looks at the probe's SET_ASIDE_PER_CLAIM oldest due
 * rows ("oldestDue") - the claim has just moved the ones it handed out, so
 * these are the rows it stepped over and the claimable ones still behind
 * its limit - and judges each again by the claim's own rule
 * (`claimable`, IS NOT TRUE): only a row that may still not be handed out
 * is moved, SET_ASIDE_FOR_MINUTES on plus up to SET_ASIDE_SPREAD_IN_MINUTES.
 * Those rows are looked up by their ids, `= ANY(ARRAY(...))`, so the
 * statement costs what the probe's oldest due rows are, whatever the
 * table's size: with `IN (SELECT ...)` Postgres may hash them against a
 * scan of the whole table, and did for the OpenStack checks, whose probe
 * is read through their cloud and so is no index's.
 * IS NOT TRUE rather than NOT, because through the LEFT JOINs a missing
 * project or probe makes the rule NULL, and NOT NULL is NULL: such a row
 * would never move.
 *
 * Its claim reads `due <= now` in the order of a (probe, due) index and no
 * longer `due IS NULL OR`, ordered NULLS FIRST, which no btree serves. A row
 * with no due time at all is therefore never read by the claim, so this
 * statement makes the probe's such rows due now ("unscheduled", "madeDue"),
 * claimable or not: the next claim hands each out or sets it aside. Every
 * write that makes a row claimable gives it a due time, so these are rows
 * from before that, and rows that are not claimable anyway.
 *
 * One self-committing statement that locks only the rows it moves,
 * FOR NO KEY UPDATE SKIP LOCKED (OneUptime issue #7194): a row another
 * claim or a report being stored holds is left for the next claim, and a
 * write that makes a row claimable again - which sets its due time to
 * LEAST(COALESCE(due, now), now), or to now, with no filter on a future due
 * time - waits for this statement's lock and writes over it, or is seen by
 * it and left alone.
 *
 * Parameters: $1 the probe, $2 now, $3 SET_ASIDE_PER_CLAIM,
 * $4 SET_ASIDE_FOR_MINUTES, $5 SET_ASIDE_SPREAD_IN_MINUTES, and the rule's
 * own from $6 (SET_ASIDE_FIRST_RULE_PARAMETER) - see
 * getClaimSetAsideParameters.
 */
export const SET_ASIDE_FIRST_RULE_PARAMETER: number = 6;

/*
 * Where a probe's due rows are: the claim's table, read as `alias`, and
 * which of its rows are the probe's (bound as $1). Most rows name their
 * probe; an OpenStack check names its own or runs on the probe that
 * collects its cloud, so it has two sources, each a range of an index of
 * its own.
 */
export interface ClaimRowSource {
  // FROM, with any join needed to tell the probe's rows.
  from: string;
  // The probe's rows among them, with the probe bound as $1.
  where: string;
}

export interface ClaimSetAside {
  table: string;
  alias: string;
  dueColumn: string;
  sources: Array<ClaimRowSource>;
  // The LEFT JOINs the claimable rule reads, from the table read as `alias`.
  joins: string;
  // The probe's rows again, read through those joins: judged when locked.
  isProbesRow: string;
  /*
   * The claim's rule - the very SQL its claim keeps rows by - with its
   * parameters numbered from SET_ASIDE_FIRST_RULE_PARAMETER.
   */
  claimable: string;
}

export interface SetAsideCounts {
  setAside: number;
  madeDue: number;
}

// The statement that sets aside a claim's unclaimable due rows (see above).
export function getClaimSetAsideStatement(setAside: ClaimSetAside): string {
  const alias: string = setAside.alias;
  const due: string = `${alias}."${setAside.dueColumn}"`;

  // The probe's rows that meet `condition`, from each source, at most $3 each.
  const probesRows: (condition: string, orderBy: string) => string = (
    condition: string,
    orderBy: string,
  ): string => {
    const ranges: Array<string> = setAside.sources.map(
      (source: ClaimRowSource): string => {
        return `SELECT ${alias}."_id"
          FROM ${source.from}
          WHERE ${source.where}
            AND ${condition}${orderBy}
          LIMIT $3`;
      },
    );

    return ranges.length === 1
      ? ranges[0]!
      : ranges
          .map((range: string): string => {
            return `(${range})`;
          })
          .join("\n        UNION ALL\n        ");
  };

  return `
      WITH "oldestDue" AS (
        ${probesRows(`${due} <= $2`, `\n          ORDER BY ${due} ASC`)}
      ),
      "unclaimable" AS (
        SELECT ${alias}."_id"
        FROM "${setAside.table}" ${alias}
        ${setAside.joins}
        WHERE ${alias}."_id" = ANY(ARRAY(SELECT "_id" FROM "oldestDue"))
          AND ${setAside.isProbesRow}
          AND ${due} <= $2
          AND (
            ${setAside.claimable}
          ) IS NOT TRUE
        FOR NO KEY UPDATE OF ${alias} SKIP LOCKED
      ),
      "setAside" AS (
        UPDATE "${setAside.table}" AS ${alias}
        SET "${setAside.dueColumn}" = $2::timestamptz
          + ($4::double precision + random() * $5::double precision)
            * INTERVAL '1 minute'
        FROM "unclaimable"
        WHERE ${alias}."_id" = "unclaimable"."_id"
        RETURNING ${alias}."_id"
      ),
      "unscheduled" AS (
        SELECT ${alias}."_id"
        FROM "${setAside.table}" ${alias}
        WHERE ${alias}."_id" IN (
          ${probesRows(`${due} IS NULL`, "")}
        )
          AND ${due} IS NULL
        FOR NO KEY UPDATE OF ${alias} SKIP LOCKED
      ),
      "madeDue" AS (
        UPDATE "${setAside.table}" AS ${alias}
        SET "${setAside.dueColumn}" = $2::timestamptz
        FROM "unscheduled"
        WHERE ${alias}."_id" = "unscheduled"."_id"
        RETURNING ${alias}."_id"
      )
      SELECT
        (SELECT COUNT(*) FROM "setAside")::int AS "setAside",
        (SELECT COUNT(*) FROM "madeDue")::int AS "madeDue"
    `;
}

// What getClaimSetAsideStatement binds, the rule's own parameters last.
export function getClaimSetAsideParameters(data: {
  probeId: ObjectID;
  currentDate: Date;
  ruleParameters: Array<unknown>;
}): Array<unknown> {
  return [
    data.probeId.toString(),
    data.currentDate,
    SET_ASIDE_PER_CLAIM,
    SET_ASIDE_FOR_MINUTES,
    SET_ASIDE_SPREAD_IN_MINUTES,
    ...data.ruleParameters,
  ];
}

// The counts the statement answers; none when it answers none.
export function readSetAsideCounts(rows: unknown): SetAsideCounts {
  const counts: { setAside?: unknown; madeDue?: unknown } | undefined =
    Array.isArray(rows)
      ? (rows[0] as { setAside?: unknown; madeDue?: unknown } | undefined)
      : undefined;

  return {
    setAside: Number(counts?.setAside) || 0,
    madeDue: Number(counts?.madeDue) || 0,
  };
}

/*
 * Runs a claim's set-aside after it has claimed: another round while a
 * round moved a full batch - SET_ASIDE_PER_CLAIM set aside, or made due -
 * at most SET_ASIDE_ROUNDS_PER_CLAIM. Housekeeping that must never cost a
 * probe what it was just handed, so a failure is logged and the claim
 * answers as usual: the rows stay due, and the next claim tries again.
 */
export async function setAsideAfterClaim(data: {
  // The claim, for the log: "claimDueVCenters".
  claim: string;
  probeId: ObjectID;
  // The rows, for the log: "vCenters nothing may collect now".
  rows: string;
  round: () => Promise<SetAsideCounts>;
}): Promise<void> {
  try {
    for (let round: number = 0; round < SET_ASIDE_ROUNDS_PER_CLAIM; round++) {
      const moved: SetAsideCounts = await data.round();

      if (moved.setAside > 0 || moved.madeDue > 0) {
        logger.debug(
          `${data.claim}: probe ${data.probeId.toString()} set aside ${moved.setAside} due ${data.rows}, and made due ${moved.madeDue} that had no due time.`,
        );
      }

      if (
        moved.setAside < SET_ASIDE_PER_CLAIM &&
        moved.madeDue < SET_ASIDE_PER_CLAIM
      ) {
        break;
      }
    }
  } catch (err) {
    logger.error(
      `${data.claim}: could not set aside the due ${data.rows} of probe ${data.probeId.toString()}; the next claim tries again.`,
    );
    logger.error(err);
  }
}

/*
 * Makes rows due now, unless they are due already: for a write that makes
 * a row claimable again, which the claim may have set aside for up to
 * SET_ASIDE_FOR_MINUTES plus the spread. LEAST keeps an earlier due time,
 * COALESCE gives a row with none one, and every row named is matched - not
 * only those due in the future - so a row a claim is setting aside at this
 * very moment is matched as it was, waited for, and moved back as that
 * claim left it (MonitorProbeService.makeDueNow).
 *
 * `where` narrows the rows by more than their ids, with the ids bound as $1
 * and now as $2. Returns the SQL; the caller runs it with
 * getMakeDueNowParameters.
 */
export function getMakeDueNowStatement(data: {
  table: string;
  dueColumns: Array<string>;
  // The column the ids are of: "_id", or a parent's id column.
  idColumn: string;
  where?: string | undefined;
}): string {
  const assignments: string = data.dueColumns
    .map((column: string): string => {
      return `"${column}" = LEAST(COALESCE("${column}", $2::timestamptz), $2::timestamptz)`;
    })
    .join(",\n          ");

  return `
        UPDATE "${data.table}"
        SET ${assignments}
        WHERE "${data.idColumn}" = ANY($1::uuid[])
          AND "deletedAt" IS NULL${data.where ? `\n          AND ${data.where}` : ""}
      `;
}

// The ids that are ids, as text, and now: what getMakeDueNowStatement binds.
export function getMakeDueNowParameters(data: {
  ids: Array<ObjectID>;
  currentDate: Date;
}): Array<unknown> | null {
  const ids: Array<string> = data.ids
    .map((id: ObjectID): string => {
      return id.toString();
    })
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

  return ids.length > 0 ? [ids, data.currentDate] : null;
}
