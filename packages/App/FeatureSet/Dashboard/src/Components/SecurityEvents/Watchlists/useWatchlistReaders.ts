import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import {
  getSecurityWatchlistNameKey,
  isSecurityWatchlistName,
} from "Common/Types/SecurityEvent/SecurityWatchlist";
import {
  WatchlistReader,
  WatchlistReaderKind,
  readSecurityWatchlistFilters,
} from "Common/Types/SecurityEvent/SecurityWatchlistFilter";
import {
  WatchlistReadingRule,
  getRulesReadingWatchlists,
} from "Common/Utils/SecurityEvent/Sigma/SigmaWatchlists";
import { getSecurityHuntWatchlistNames } from "Common/Utils/SecurityEvent/SecurityHuntSearch";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

export interface WatchlistReadersResult {
  // What reads each list, by its name key (getSecurityWatchlistNameKey).
  readersByKey: Map<string, Array<WatchlistReader>>;
  isLoaded: boolean;
  // The rules could not be read: lists show without their readers.
  hasError: boolean;
}

// What reads a list, added under its name key.
function addReader(
  readersByKey: Map<string, Array<WatchlistReader>>,
  name: string,
  reader: WatchlistReader,
): void {
  const key: string = getSecurityWatchlistNameKey(name);
  const readers: Array<WatchlistReader> = readersByKey.get(key) || [];
  readers.push(reader);
  readersByKey.set(key, readers);
}

/*
 * The lists a Security Events monitor's steps read, by name, each once:
 * its watchlist filters (Types/SecurityEvent/SecurityWatchlistFilter).
 */
export function getMonitorWatchlistNames(monitor: Monitor): Array<string> {
  const names: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const step of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
    []) {
    for (const filter of readSecurityWatchlistFilters(
      (step as MonitorStep).data?.securityEventsMonitor?.watchlistFilters,
    )) {
      const key: string = getSecurityWatchlistNameKey(filter.watchlist);

      if (isSecurityWatchlistName(filter.watchlist) && !seen.has(key)) {
        seen.add(key);
        names.push(filter.watchlist);
      }
    }
  }

  return names;
}

/*
 * What reads each of the project's watchlists, by name, as the server
 * counts it when a list is renamed or deleted
 * (SecurityWatchlists.findReaders): its detection rules' `expand` values,
 * its Security Events monitors' watchlist filters and its hunts' searches
 * (`user:%vip_users%`). The Watchlists list shows them in its Read By
 * column, and a list's page in About This List.
 *
 * The rules are the list's own business, read by every Security role: when
 * they cannot be read the readers are not known. Monitors and hunts are
 * read when the reader may read them, and left out when not.
 */
export default function useWatchlistReaders(
  projectId: ObjectID | null,
  refreshKey?: string | undefined,
): WatchlistReadersResult {
  const [result, setResult] = useState<WatchlistReadersResult>({
    readersByKey: new Map(),
    isLoaded: false,
    hasError: false,
  });

  useEffect(() => {
    if (!projectId) {
      return () => {};
    }

    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const [rules, monitors, hunts] = await Promise.allSettled([
        ModelAPI.getList<DetectionRule>({
          modelType: DetectionRule,
          query: { projectId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            sigmaRuleYaml: true,
          },
          sort: { name: SortOrder.Ascending },
        }),
        ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: { projectId, monitorType: MonitorType.SecurityEvents },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            monitorSteps: true,
          },
          sort: { name: SortOrder.Ascending },
        }),
        ModelAPI.getList<SecurityHunt>({
          modelType: SecurityHunt,
          query: { projectId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            searchQuery: true,
          },
          sort: { name: SortOrder.Ascending },
        }),
      ]);

      if (!isCurrent) {
        return;
      }

      if (rules.status === "rejected") {
        setResult({
          readersByKey: new Map(),
          isLoaded: true,
          hasError: true,
        });
        return;
      }

      const readersByKey: Map<string, Array<WatchlistReader>> = new Map();

      for (const [key, readers] of getRulesReadingWatchlists(
        (rules.value as ListResult<DetectionRule>).data.map(
          (rule: DetectionRule): WatchlistReadingRule => {
            return {
              id: rule.id?.toString() || "",
              name: rule.name || "",
              sigmaRuleYaml: rule.sigmaRuleYaml,
            };
          },
        ),
      )) {
        for (const reader of readers) {
          addReader(readersByKey, key, {
            kind: WatchlistReaderKind.DetectionRule,
            id: reader.id,
            name: reader.name,
          });
        }
      }

      if (monitors.status === "fulfilled") {
        for (const monitor of (monitors.value as ListResult<Monitor>).data) {
          for (const name of getMonitorWatchlistNames(monitor)) {
            addReader(readersByKey, name, {
              kind: WatchlistReaderKind.Monitor,
              id: monitor.id?.toString() || "",
              name: monitor.name || "",
            });
          }
        }
      }

      if (hunts.status === "fulfilled") {
        for (const hunt of (hunts.value as ListResult<SecurityHunt>).data) {
          for (const name of getSecurityHuntWatchlistNames(hunt.searchQuery)) {
            addReader(readersByKey, name, {
              kind: WatchlistReaderKind.Hunt,
              id: hunt.id?.toString() || "",
              name: hunt.name || "",
            });
          }
        }
      }

      setResult({
        readersByKey,
        isLoaded: true,
        hasError: false,
      });
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [projectId?.toString(), refreshKey]);

  return result;
}
