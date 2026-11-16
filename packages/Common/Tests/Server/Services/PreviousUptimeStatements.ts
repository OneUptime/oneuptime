/*
 * THE UPTIME STATEMENTS AS THEY WERE BEFORE ISSUES #6887 AND #8960, verbatim
 * from MonitorStatusTimelineService: the reference the Postgres suites hold
 * the current statements to.
 *
 *   - Issue #6887 changed how the day aggregate finds a period's days (the
 *     day grid and width_bucket, in place of a generate_series of zone
 *     conversions per row): on any rows its buckets must be these ones.
 *   - Issue #8960 leaves a monitor's time before its first check out of all
 *     four: for a monitor checked from the start, they must read exactly what
 *     these read.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// getDailyUptimeAggregate: $1 uuid[] monitors, $2 and $3 the window, $4 the zone.
export const PREVIOUS_DAILY_UPTIME_AGGREGATE_SQL: string = `
      WITH params AS (
        SELECT $2::timestamptz AS win_start,
               LEAST($3::timestamptz, now()) AS eff_end,
               $4::text AS tz
      ),
      mons AS (
        SELECT UNNEST($1::uuid[]) AS monitor_id
      ),
      src AS (
        SELECT t."monitorId" AS monitor_id,
               t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               GREATEST(t."startsAt", p.win_start) AS s,
               LEAST(
                 COALESCE(
                   t."endsAt",
                   LEAD(t."startsAt") OVER (
                     PARTITION BY t."monitorId"
                     ORDER BY t."startsAt", t."endsAt" NULLS LAST
                   ),
                   p.eff_end
                 ),
                 p.eff_end
               ) AS e
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        WHERE t."monitorId" = ANY($1::uuid[])
          AND t."deletedAt" IS NULL
          AND t."startsAt" <= p.eff_end
          AND (t."endsAt" >= p.win_start OR t."endsAt" IS NULL)
      ),
      split AS (
        SELECT src.monitor_id,
               CASE WHEN src.is_off THEN NULL ELSE src.status_id END
                 AS status_id,
               src.is_off,
               (gs AT TIME ZONE p.tz) AS day_start,
               GREATEST(src.s, (gs AT TIME ZONE p.tz)) AS seg_start,
               LEAST(src.e, ((gs + interval '1 day') AT TIME ZONE p.tz))
                 AS seg_end
        FROM src
        CROSS JOIN params p,
        LATERAL generate_series(
          date_trunc('day', src.s AT TIME ZONE p.tz),
          date_trunc('day', (src.e - interval '1 microsecond') AT TIME ZONE p.tz),
          interval '1 day'
        ) AS gs
        WHERE src.e > src.s
      ),
      agg AS (
        SELECT monitor_id,
               day_start,
               status_id,
               is_off,
               SUM(EXTRACT(EPOCH FROM (seg_end - seg_start)))::double precision
                 AS seconds
        FROM split
        WHERE seg_end > seg_start
        GROUP BY monitor_id, day_start, status_id, is_off
      ),
      buckets AS (
        SELECT (d AT TIME ZONE p.tz) AS day_start,
               GREATEST((d AT TIME ZONE p.tz), p.win_start) AS bucket_start,
               LEAST(((d + interval '1 day') AT TIME ZONE p.tz), p.eff_end)
                 AS bucket_end
        FROM params p,
             generate_series(
               date_trunc('day', p.win_start AT TIME ZONE p.tz),
               date_trunc('day', p.eff_end AT TIME ZONE p.tz),
               interval '1 day'
             ) AS d
      )
      SELECT m.monitor_id AS "monitorId",
             b.bucket_start AS "bucketStart",
             b.bucket_end AS "bucketEnd",
             EXTRACT(EPOCH FROM (b.bucket_end - b.bucket_start))::bigint
               AS "daySeconds",
             a.status_id AS "monitorStatusId",
             COALESCE(a.seconds, 0)::double precision AS "seconds",
             COALESCE(a.is_off, false) AS "isMonitoringOff"
      FROM mons m
      CROSS JOIN buckets b
      LEFT JOIN agg a ON a.monitor_id = m.monitor_id
                     AND a.day_start = b.day_start
      WHERE b.bucket_end > b.bucket_start
      ORDER BY m.monitor_id, b.bucket_start
    `;

// getMergedDowntimeSeconds: $1 uuid[] monitors, $2 and $3 the window, $4 uuid[] downtime statuses.
export const PREVIOUS_MERGED_DOWNTIME_SQL: string = `
      WITH params AS (
        SELECT $2::timestamptz AS win_start,
               LEAST($3::timestamptz, now()) AS eff_end
      ),
      src AS (
        SELECT t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               GREATEST(t."startsAt", p.win_start) AS s,
               LEAST(
                 COALESCE(
                   t."endsAt",
                   LEAD(t."startsAt") OVER (
                     PARTITION BY t."monitorId"
                     ORDER BY t."startsAt", t."endsAt" NULLS LAST
                   ),
                   p.eff_end
                 ),
                 p.eff_end
               ) AS e
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        WHERE t."monitorId" = ANY($1::uuid[])
          AND t."deletedAt" IS NULL
          AND t."startsAt" <= p.eff_end
          AND (t."endsAt" >= p.win_start OR t."endsAt" IS NULL)
      ),
      periods AS (
        SELECT s,
               e,
               status_id = ANY($4::uuid[]) AS is_downtime
        FROM src
        WHERE e > s
          AND NOT is_off
      ),
      reach AS (
        SELECT s,
               e,
               is_downtime,
               MAX(e) OVER earlier AS covered_until,
               MAX(e) FILTER (WHERE is_downtime) OVER earlier AS down_until
        FROM periods
        WINDOW earlier AS (
          ORDER BY s, e
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        )
      )
      SELECT COALESCE(
               SUM(
                 GREATEST(
                   EXTRACT(EPOCH FROM (e - GREATEST(s, COALESCE(covered_until, s)))),
                   0
                 )
               ),
               0
             )::double precision AS "coveredSeconds",
             COALESCE(
               SUM(
                 GREATEST(
                   EXTRACT(EPOCH FROM (e - GREATEST(s, COALESCE(down_until, s)))),
                   0
                 )
               ) FILTER (WHERE is_downtime),
               0
             )::double precision AS "downtimeSeconds"
      FROM reach
    `;

/*
 * getRollingUptimeTotals: $1 the monitor, $2 the end, $3 text[] the window
 * keys and $4 timestamptz[] their starts.
 */
export const PREVIOUS_ROLLING_UPTIME_TOTALS_SQL: string = `
      WITH params AS (
        SELECT LEAST($2::timestamptz, now()) AS eff_end
      ),
      windows AS (
        SELECT w.window_key, w.win_start, w.window_no
        FROM UNNEST($3::text[], $4::timestamptz[])
             WITH ORDINALITY AS w(window_key, win_start, window_no)
      ),
      widest AS (
        SELECT MIN(win_start) AS win_start FROM windows
      ),
      lower_bound AS (
        SELECT COALESCE(
                 (
                   SELECT MAX(t."startsAt")
                   FROM "MonitorStatusTimeline" t
                   WHERE t."monitorId" = $1::uuid
                     AND t."deletedAt" IS NULL
                     AND t."startsAt" < wd.win_start
                 ),
                 wd.win_start
               ) AS starts_from
        FROM widest wd
      ),
      src_rows AS (
        SELECT t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               t."startsAt" AS starts_at,
               t."endsAt" AS ends_at
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        CROSS JOIN widest wd
        WHERE t."monitorId" = $1::uuid
          AND t."deletedAt" IS NULL
          AND t."startsAt" >= (SELECT starts_from FROM lower_bound)
          AND t."startsAt" <= p.eff_end
          AND (t."endsAt" >= wd.win_start OR t."endsAt" IS NULL)
        UNION ALL
        SELECT t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               t."startsAt" AS starts_at,
               t."endsAt" AS ends_at
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        WHERE t."monitorId" = $1::uuid
          AND t."deletedAt" IS NULL
          AND t."endsAt" IS NULL
          AND t."startsAt" < (SELECT starts_from FROM lower_bound)
          AND t."startsAt" <= p.eff_end
      ),
      src AS (
        SELECT w.window_no,
               r.status_id,
               r.is_off,
               GREATEST(r.starts_at, w.win_start) AS s,
               LEAST(
                 COALESCE(
                   r.ends_at,
                   LEAD(r.starts_at) OVER (
                     PARTITION BY w.window_no
                     ORDER BY r.starts_at, r.ends_at NULLS LAST
                   ),
                   p.eff_end
                 ),
                 p.eff_end
               ) AS e
        FROM src_rows r
        CROSS JOIN windows w
        CROSS JOIN params p
        WHERE r.ends_at >= w.win_start OR r.ends_at IS NULL
      ),
      agg AS (
        SELECT window_no,
               status_id,
               SUM(EXTRACT(EPOCH FROM (e - s)))::double precision AS seconds
        FROM src
        WHERE e > s
          AND NOT is_off
        GROUP BY window_no, status_id
      )
      SELECT w.window_key AS "windowKey",
             GREATEST(EXTRACT(EPOCH FROM (p.eff_end - w.win_start)), 0)
               ::double precision AS "windowSeconds",
             a.status_id AS "monitorStatusId",
             COALESCE(a.seconds, 0)::double precision AS "seconds"
      FROM windows w
      CROSS JOIN params p
      LEFT JOIN agg a ON a.window_no = w.window_no
      ORDER BY w.window_no, a.status_id
    `;

/*
 * getMonitorGroupDailyUptimeAggregateSql for `levelCount` ranked statuses:
 * $1 int[] and $2 uuid[] each group's number beside one of its monitors, $3
 * and $4 the window, $5 the zone, $6 uuid[] the ranked statuses, $7 how many
 * groups there are.
 */
export function previousMonitorGroupDailyUptimeAggregateSql(data: {
  levelCount: number;
}): string {
  const levelCount: number = Math.max(1, Math.floor(data.levelCount) || 0);

  const reachedColumns: Array<string> = [];
  const unionColumns: Array<string> = [];

  /*
   * Level 1 is every period of a status (rank 1 and up); a period with
   * monitoring off is ranked 0, so only the union of every period, off
   * included (reached_all), counts it - the time with monitoring off is
   * that union less level 1's.
   */
  for (let level: number = 1; level <= levelCount; level++) {
    const filter: string = ` FILTER (WHERE status_rank >= ${level})`;

    reachedColumns.push(
      `MAX(seg_end)${filter} OVER earlier AS reached_${level}`,
    );
    unionColumns.push(
      `COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (seg_end - GREATEST(seg_start, COALESCE(reached_${level}, seg_start)))), 0))${filter}, 0)`,
    );
  }

  return `
      WITH params AS (
        SELECT $3::timestamptz AS win_start,
               LEAST($4::timestamptz, now()) AS eff_end,
               $5::text AS tz
      ),
      grid AS (
        SELECT array_agg((d AT TIME ZONE p.tz) ORDER BY d) AS starts
        FROM params p,
             generate_series(
               date_trunc('day', p.win_start AT TIME ZONE p.tz),
               date_trunc('day', p.eff_end AT TIME ZONE p.tz) + interval '1 day',
               interval '1 day'
             ) AS d
      ),
      members AS (
        SELECT DISTINCT m.group_key, m.monitor_id
        FROM UNNEST($1::int[], $2::uuid[]) AS m(group_key, monitor_id)
      ),
      ranks AS (
        SELECT r.status_id, r.status_rank::int AS status_rank
        FROM UNNEST($6::uuid[]) WITH ORDINALITY AS r(status_id, status_rank)
      ),
      src AS (
        SELECT t."monitorId" AS monitor_id,
               t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               GREATEST(t."startsAt", p.win_start) AS s,
               LEAST(
                 COALESCE(
                   t."endsAt",
                   LEAD(t."startsAt") OVER (
                     PARTITION BY t."monitorId"
                     ORDER BY t."startsAt", t."endsAt" NULLS LAST
                   ),
                   p.eff_end
                 ),
                 p.eff_end
               ) AS e
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        WHERE t."monitorId" = ANY($2::uuid[])
          AND t."deletedAt" IS NULL
          AND t."startsAt" <= p.eff_end
          AND (t."endsAt" >= p.win_start OR t."endsAt" IS NULL)
      ),
      periods AS (
        SELECT mb.group_key,
               CASE WHEN src.is_off THEN 0 ELSE rk.status_rank END
                 AS status_rank,
               src.s,
               src.e,
               width_bucket(src.s, g.starts) AS first_day,
               width_bucket(src.e - interval '1 microsecond', g.starts) AS last_day
        FROM src
        JOIN members mb ON mb.monitor_id = src.monitor_id
        LEFT JOIN ranks rk ON rk.status_id = src.status_id
        CROSS JOIN grid g
        WHERE src.e > src.s
          AND (src.is_off OR rk.status_rank IS NOT NULL)
      ),
      split AS (
        SELECT group_key,
               status_rank,
               first_day AS day_index,
               s AS seg_start,
               e AS seg_end
        FROM periods
        WHERE first_day = last_day
        UNION ALL
        SELECT pr.group_key,
               pr.status_rank,
               di AS day_index,
               GREATEST(pr.s, g.starts[di]) AS seg_start,
               LEAST(pr.e, g.starts[di + 1]) AS seg_end
        FROM periods pr
        CROSS JOIN grid g,
        LATERAL generate_series(pr.first_day, pr.last_day) AS di
        WHERE pr.first_day <> pr.last_day
      ),
      reach AS (
        SELECT group_key,
               day_index,
               status_rank,
               seg_start,
               seg_end,
               MAX(seg_end) OVER earlier AS reached_all,
               ${reachedColumns.join(",\n               ")}
        FROM split
        WHERE seg_end > seg_start
        WINDOW earlier AS (
          PARTITION BY group_key, day_index
          ORDER BY seg_start, seg_end
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        )
      ),
      day_unions AS (
        SELECT group_key,
               day_index,
               ARRAY[
                 ${unionColumns.join(",\n                 ")}
               ]::double precision[] AS unions,
               COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (seg_end - GREATEST(seg_start, COALESCE(reached_all, seg_start)))), 0)), 0)::double precision
                 AS union_all
        FROM reach
        GROUP BY group_key, day_index
      ),
      days AS (
        SELECT di AS day_index,
               GREATEST(g.starts[di], p.win_start) AS bucket_start,
               LEAST(g.starts[di + 1], p.eff_end) AS bucket_end
        FROM grid g
        CROSS JOIN params p,
        LATERAL generate_series(1, array_length(g.starts, 1) - 1) AS di
      )
      SELECT gk.group_key AS "groupKey",
             d.bucket_start AS "bucketStart",
             d.bucket_end AS "bucketEnd",
             EXTRACT(EPOCH FROM (d.bucket_end - d.bucket_start))::bigint
               AS "daySeconds",
             u.unions AS "unions",
             u.union_all AS "unionWithMonitoringOff"
      FROM generate_series(1, $7::int) AS gk(group_key)
      CROSS JOIN days d
      LEFT JOIN day_unions u ON u.group_key = gk.group_key
                            AND u.day_index = d.day_index
      WHERE d.bucket_end > d.bucket_start
      ORDER BY gk.group_key, d.bucket_start
    `;
}
