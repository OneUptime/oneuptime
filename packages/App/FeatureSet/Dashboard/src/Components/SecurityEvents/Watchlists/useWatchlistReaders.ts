import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import {
  WatchlistReadingRule,
  getRulesReadingWatchlists,
} from "Common/Utils/SecurityEvent/Sigma/SigmaWatchlists";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

export interface WatchlistReadersResult {
  // The rules that read each list, by its name key (getSecurityWatchlistNameKey).
  readersByKey: Map<string, Array<{ id: string; name: string }>>;
  isLoaded: boolean;
  // The rules could not be read: lists show without their readers.
  hasError: boolean;
}

/*
 * Which of the project's detection rules read each watchlist: one read of
 * the rules - their names and YAML - and their `expand` values read as the
 * server reads them (getRulesReadingWatchlists). The Watchlists list shows
 * them in its Read By column, and a list's page under its rule snippet.
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
      try {
        const rules: ListResult<DetectionRule> =
          await ModelAPI.getList<DetectionRule>({
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
          });

        if (isCurrent) {
          setResult({
            readersByKey: getRulesReadingWatchlists(
              rules.data.map((rule: DetectionRule): WatchlistReadingRule => {
                return {
                  id: rule.id?.toString() || "",
                  name: rule.name || "",
                  sigmaRuleYaml: rule.sigmaRuleYaml,
                };
              }),
            ),
            isLoaded: true,
            hasError: false,
          });
        }
      } catch {
        if (isCurrent) {
          setResult({
            readersByKey: new Map(),
            isLoaded: true,
            hasError: true,
          });
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [projectId?.toString(), refreshKey]);

  return result;
}
