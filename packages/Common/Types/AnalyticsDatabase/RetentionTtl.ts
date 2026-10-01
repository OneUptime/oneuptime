/*
 * Row TTL for the telemetry tables whose partitions mix retentions -
 * MetricItemV3, its minute rollup MetricItemAggMV1m and LogItemV3 - and so
 * expire row by row rather than a whole part at a time (no
 * ttl_only_drop_parts; DropTtlOnlyDropPartsFromMixedRetentionTables says
 * why).
 *
 * `retentionDate` is stamped per row at ingest (the ingest time plus the
 * row's retention), so one day's rows reach it spread over a whole day.
 * With `TTL retentionDate DELETE` ClickHouse rewrites the partition every
 * time merge_with_ttl_timeout (4 hours) lets it while they do: six or seven
 * rewrites per retention a daily partition holds, writing about three times
 * the partition in all, and six a day for a month on the monthly rollup.
 *
 * Rounded up to the next midnight instead, a day's rows of one retention
 * all expire at the same instant. ClickHouse tries dropping whole parts
 * before rewriting any (with or without ttl_only_drop_parts), so the last
 * retention a partition holds goes as a free drop, and each one before it
 * costs a single merge that writes only the rows that outlive it. On the
 * monthly rollup it is one merge a day instead of six.
 *
 * The cost is disk: an expired row stays up to a day longer, half a day on
 * average. Reads never see it - they filter `retentionDate >= now()`
 * (AnalyticsDatabaseService.getRetentionReadFilter, and the aggregation
 * services' own filters) - and the TTL is always later than
 * `retentionDate`, so no row is deleted while a read can still return it.
 *
 * Boot schema-sync does not reconcile TTL: RoundTtlToDayOnMixedRetentionTables
 * applies these to the tables an existing install already has.
 */
export const RETENTION_TTL_ROUNDED_UP_TO_DAY: string =
  "toStartOfDay(retentionDate) + INTERVAL 1 DAY DELETE";

/*
 * The same for the raw tables, which partition by the day the event
 * happened (`toYYYYMMDD(time)`) while `retentionDate` counts from the
 * moment the row was ingested (`createdAt`). An event stamped ahead of the
 * clock that ingested it - a host clock running fast, a syslog device's
 * local time read as UTC - lands in a later day's partition than its
 * stamp. Rounded on `retentionDate` alone it would expire a day before the
 * rest of that partition, and removing a handful of such rows would cost a
 * rewrite of the whole partition. Shifting its expiry by how far ahead it
 * is (at most a day, which bounds what a broken clock can keep on disk)
 * lines it up with the day of its partition. A late event is left alone:
 * lining it up would delete it before its retentionDate.
 *
 * Every writer of these tables stamps `createdAt` and `retentionDate` from
 * the same instant, so `createdAt` cannot be dropped while this TTL
 * references it.
 */
export const RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY: string =
  "toStartOfDay(retentionDate + toIntervalSecond(least(greatest(dateDiff('second', createdAt, time), 0), 86400))) + INTERVAL 1 DAY DELETE";
