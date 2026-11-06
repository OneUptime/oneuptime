import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Route from "Common/Types/API/Route";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import {
  DatabaseHealthAssessment,
  assessDatabase,
  compareDatabasesByUrgency,
} from "Common/Types/DatabaseServer/DatabaseHealth";
import { DATABASE_ENGINE_READINGS_STALE_MS } from "Common/Types/DatabaseServer/DatabaseEngineReadings";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import { getDatabaseFleetAttentionItem } from "./DatabaseHealthPresentation";
import { getDatabaseEngineLabel } from "./DatabaseServerPresentation";

/*
 * WHICH DATABASES NEED SOMEONE, FOR THE DATABASES LIST.
 *
 * The ingest stores each database's verdict with its readings
 * (DatabaseServer.engineHealth), so the list's Needs attention card asks
 * for exactly the databases that may need someone instead of judging every
 * row: those whose fresh verdict is Degraded or Unhealthy, and those whose
 * engine metrics stopped. Each row read is then judged again by the same
 * rules (DatabaseHealth), so a verdict whose readings went stale since is
 * never shown as current, and the reasons are the ones the database's own
 * page gives.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

// The most databases each read returns; the card says when there are more.
export const DATABASE_FLEET_ATTENTION_LIMIT: number = 200;

export const DATABASE_FLEET_ATTENTION_SELECT: Select<DatabaseServer> = {
  _id: true,
  name: true,
  dbSystem: true,
  otelCollectorStatus: true,
  collectorLastSeenAt: true,
  engineReadings: true,
  engineReadingsAt: true,
};

/*
 * The two reads: a fresh verdict past a line, and engine metrics that
 * stopped. Archived databases are left out, as in the list.
 */
export function getDatabaseFleetAttentionQueries(
  now: Date,
): Array<Query<DatabaseServer>> {
  return [
    {
      isArchived: false,
      otelCollectorStatus: "connected",
      engineHealth: new Includes(["unhealthy", "degraded"]),
      engineReadingsAt: new GreaterThanOrEqual(
        new Date(now.getTime() - DATABASE_ENGINE_READINGS_STALE_MS),
      ),
    } as Query<DatabaseServer>,
    {
      isArchived: false,
      otelCollectorStatus: new NotEqual("connected"),
      collectorLastSeenAt: new NotNull(),
    } as Query<DatabaseServer>,
  ];
}

// Says so when a read came back full: there may be more than the card shows.
export const DATABASE_FLEET_ATTENTION_TRUNCATED_DESCRIPTION: string =
  translationKey(
    "What is broken or needs a look, the most urgent first. The first {{count}} of each kind are shown; filter the list below for the rest.",
  );

// Whether a read came back full, so the card may not show every database.
export function isDatabaseFleetAttentionTruncated(
  readCounts: Array<number>,
): boolean {
  return readCounts.some((count: number): boolean => {
    return count >= DATABASE_FLEET_ATTENTION_LIMIT;
  });
}

/*
 * The card's rows from what the reads returned: each database once, judged
 * by the rules, only those that need someone, the most urgent first.
 */
export function getDatabaseFleetAttentionItems(data: {
  databases: Array<DatabaseServer>;
  now: Date;
  getDatabaseRoute: (databaseId: string) => Route;
}): Array<ResourceAttentionItem> {
  const seen: Set<string> = new Set<string>();
  const judged: Array<{
    id: string;
    name: string;
    engineLabel: string;
    assessment: DatabaseHealthAssessment;
  }> = [];

  for (const database of data.databases) {
    const id: string = database._id ? database._id.toString() : "";
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const assessment: DatabaseHealthAssessment = assessDatabase(database, {
      now: data.now,
    });
    if (!assessment.severity) {
      continue;
    }
    judged.push({
      id: id,
      name: database.name || getDatabaseEngineLabel(database.dbSystem),
      engineLabel: getDatabaseEngineLabel(database.dbSystem),
      assessment: assessment,
    });
  }

  judged.sort(compareDatabasesByUrgency);

  const items: Array<ResourceAttentionItem> = [];
  for (const entry of judged) {
    const item: ResourceAttentionItem | null = getDatabaseFleetAttentionItem({
      id: entry.id,
      name: entry.name,
      engineLabel: entry.engineLabel,
      assessment: entry.assessment,
      route: data.getDatabaseRoute(entry.id),
    });
    if (item) {
      items.push(item);
    }
  }
  return items;
}
