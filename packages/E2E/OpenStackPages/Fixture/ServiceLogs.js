/*
 * What real DevStacks' services wrote (Common/Tests/Fixtures/OpenStack/service-logs), as a cloud's
 * logs and change events: `?logs=epoxy-ovn`. Each recorded line goes through the ingest's own
 * stamp, and each notification through the code that writes its change event, here in the page,
 * so a walk reads what those really make of them. Only the clock moves: the newest line of a
 * recording was written a minute ago.
 */
import serviceLogs from "openstack-service-logs";
import SortOrder from "../../../Common/Types/BaseDatabase/SortOrder";
import { buildOpenStackChangeEntry } from "../../../Common/Server/Utils/OpenStack/OpenStackEventEntries";
import { OpenStackEventImportance } from "../../../Common/Utils/OpenStack/OpenStackNotifications";
import { OpenStackLogAttribute } from "../../../Common/Utils/OpenStack/OpenStackLogs";
import {
  journalTime,
  storedRowOf,
} from "../../../Common/Tests/Helpers/OpenStackJournalEntry";

const MINUTE = 60 * 1000;

export function hasServiceLogs(release) {
  return Boolean(release && serviceLogs[release]);
}

// What the drop filters every project starts with take out: see OpenStackLogDefaults.
function isDropped(stamp) {
  return (
    stamp.attributes[OpenStackLogAttribute.Level] === "DEBUG" ||
    Boolean(stamp.attributes[OpenStackLogAttribute.Noise]) ||
    Boolean(
      stamp.event && stamp.event.importance === OpenStackEventImportance.Routine,
    )
  );
}

export function readServiceLogs(release, data) {
  const recorded = serviceLogs[release];
  const entries = [...recorded.journal, ...recorded.notifications]
    .filter((entry) => {
      return journalTime(entry) > 0;
    })
    .sort((a, b) => {
      return journalTime(a) - journalTime(b);
    });
  const newest = entries.length ? journalTime(entries[entries.length - 1]) : 0;
  const shift = data.loadedAt - MINUTE - newest;
  const logs = [];
  const changes = [];

  entries.forEach((entry, index) => {
    const row = storedRowOf(entry, data.cloudName);
    const stamp = row.stamp;

    if (isDropped(stamp)) {
      return;
    }

    const time = new Date(journalTime(entry) + shift);
    const stored = row.attributes;

    logs.push({
      _id: `log-${index}`,
      time,
      severityNumber: row.severityNumber,
      severityText: row.severityText,
      body: row.body,
      attributes: stored,
    });

    if (
      stamp.event &&
      stamp.event.importance === OpenStackEventImportance.Change
    ) {
      const change = buildOpenStackChangeEntry({
        recorded: {
          event: stamp.event,
          time: stamp.event.time
            ? new Date(stamp.event.time.getTime() + shift)
            : time,
          region: "",
          service: stored[OpenStackLogAttribute.Service] || "",
          host: stored[OpenStackLogAttribute.Host] || "",
        },
        cloudId: data.cloudId,
        cloudName: data.cloudName,
      });

      changes.push({ _id: `change-${index}`, ...change });
    }
  });

  return { ids: recorded.ids.ids.devstack || {}, logs, changes };
}

function holds(row, query) {
  for (const [key, value] of Object.entries(query.attributes || {})) {
    if (String(row.attributes[key]) !== String(value)) {
      return false;
    }
  }

  const time = query.time;

  if (time && time.startValue && time.endValue) {
    const at = row.time.getTime();

    if (
      at < new Date(time.startValue).getTime() ||
      at > new Date(time.endValue).getTime()
    ) {
      return false;
    }
  }

  return true;
}

// A read of logs or change events, as the store would answer it.
export function answerRows(rows, options) {
  const found = rows.filter((row) => {
    return holds(row, options.query || {});
  });
  const newestFirst = Object.values(options.sort || {})[0] === SortOrder.Descending;

  found.sort((a, b) => {
    const order = a.time.getTime() - b.time.getTime();

    return newestFirst ? -order : order;
  });

  const skip = options.skip || 0;
  const limit = options.limit || 10;

  return {
    data: found.slice(skip, skip + limit).map((row) => {
      return Object.assign(new options.modelType(), row);
    }),
    count: found.length,
    skip,
    limit,
  };
}
