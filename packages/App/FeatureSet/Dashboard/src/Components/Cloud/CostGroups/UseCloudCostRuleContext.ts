import { addUtcDays, startOfUtcDay } from "Common/Types/Cloud/CloudCost";
import { CloudPlatformTaggedCostRow } from "Common/Types/Cloud/CloudPlatformCosts";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  CloudCostPlatformLists,
  CloudCostScope,
  CloudCostShare,
  fetchCloudCostPlatformLists,
  fetchCloudCostShares,
  fetchCloudCostTagRows,
  mergeCloudCostTagKeys,
} from "../CloudCostReads";
import { CloudAccountRow } from "../UseCloudAccounts";
import {
  CloudCostRecordNames,
  fetchCloudCostRecordNames,
} from "./CloudCostAllocationReads";
import { CloudCostRuleOptions } from "./CloudCostRuleEditor";
import {
  CloudCostRuleNames,
  emptyCloudCostRuleNames,
} from "./CloudCostRuleSummary";

/*
 * What a group's rules are written and read with: the names of the
 * records a rule can name (accounts, teams, labels, App Platforms
 * environments and apps, Kubernetes clusters), and what the costs offer to
 * pick - their tags, the services and Regions of the last 90 days, and a
 * tag's values once the tag is picked.
 */

// How far back the costs are read for what to offer.
export const RULE_SUGGESTION_DAYS: number = 90;

export interface CloudCostRuleContext {
  names: CloudCostRuleNames;
  options: CloudCostRuleOptions;
  isLoading: boolean;
}

export default function useCloudCostRuleContext(data: {
  accounts: Array<CloudAccountRow>;
  currency: string;
}): CloudCostRuleContext {
  const [records, setRecords] = useState<CloudCostRecordNames | null>(null);
  const [lists, setLists] = useState<CloudCostPlatformLists | null>(null);
  const [services, setServices] = useState<Array<string>>([]);
  const [regions, setRegions] = useState<Array<string>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const tagValues: MutableRefObject<Map<string, Promise<Array<string>>>> =
    useRef(new Map());

  const scope: Omit<CloudCostScope, "currency"> | null = useMemo(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return null;
    }

    const today: Date = startOfUtcDay(OneUptimeDate.getCurrentDate());

    return {
      projectId,
      startDate: addUtcDays(today, -RULE_SUGGESTION_DAYS),
      endDate: OneUptimeDate.getCurrentDate(),
    };
  }, []);

  useEffect(() => {
    let ignore: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const [names, platform, serviceShares, regionShares]: [
        CloudCostRecordNames,
        CloudCostPlatformLists,
        Array<CloudCostShare>,
        Array<CloudCostShare>,
      ] = await Promise.all([
        fetchCloudCostRecordNames(),
        fetchCloudCostPlatformLists().catch((): CloudCostPlatformLists => {
          return { environments: [], apps: [] };
        }),
        scope
          ? fetchCloudCostShares({
              scope: { ...scope, currency: data.currency },
              dimension: "service",
            }).catch((): Array<CloudCostShare> => {
              return [];
            })
          : Promise.resolve([]),
        scope
          ? fetchCloudCostShares({
              scope: { ...scope, currency: data.currency },
              dimension: "region",
            }).catch((): Array<CloudCostShare> => {
              return [];
            })
          : Promise.resolve([]),
      ]);

      if (ignore) {
        return;
      }

      setRecords(names);
      setLists(platform);
      setServices(
        serviceShares.map((share: CloudCostShare): string => {
          return share.key;
        }),
      );
      setRegions(
        regionShares.map((share: CloudCostShare): string => {
          return share.key;
        }),
      );
    };

    load()
      .catch((): void => {
        // Names and suggestions only: the rules can still be written.
      })
      .finally((): void => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [data.currency]);

  const names: CloudCostRuleNames = useMemo((): CloudCostRuleNames => {
    const built: CloudCostRuleNames = emptyCloudCostRuleNames();

    for (const account of data.accounts) {
      built.accounts.set(
        account.id.toString().toLowerCase(),
        account.name || account.accountId,
      );
    }

    if (records) {
      built.teams = records.teams;
      built.labels = records.labels;
      built.clusters = records.clusters;
    }

    for (const environment of lists?.environments || []) {
      built.environments.set(environment.id.toLowerCase(), environment.name);
    }

    for (const app of lists?.apps || []) {
      built.apps.set(app.id.toLowerCase(), app.name);
    }

    return built;
  }, [data.accounts, records, lists]);

  const tagKeys: Array<string> = useMemo((): Array<string> => {
    return mergeCloudCostTagKeys({
      summaries: data.accounts.map((account: CloudAccountRow) => {
        return account.costSummary;
      }),
      currency: data.currency,
    }).map((entry: { key: string }): string => {
      return entry.key;
    });
  }, [data.accounts, data.currency]);

  const options: CloudCostRuleOptions = useMemo((): CloudCostRuleOptions => {
    return {
      tagKeys,
      services,
      regions: regions.filter((region: string): boolean => {
        return region.length > 0;
      }),
      loadTagValues: (key: string): Promise<Array<string>> => {
        const known: Promise<Array<string>> | undefined =
          tagValues.current.get(key);

        if (known) {
          return known;
        }

        const read: Promise<Array<string>> = scope
          ? fetchCloudCostTagRows({
              scope: { ...scope, currency: data.currency },
              tagKey: key,
            }).then((rows: Array<CloudPlatformTaggedCostRow>) => {
              const totals: Map<string, number> = new Map();

              for (const row of rows) {
                if (row.value) {
                  totals.set(
                    row.value,
                    (totals.get(row.value) || 0) + row.amount,
                  );
                }
              }

              return Array.from(totals.entries())
                .sort((a: [string, number], b: [string, number]): number => {
                  return b[1] - a[1];
                })
                .map(([value]: [string, number]): string => {
                  return value;
                });
            })
          : Promise.resolve([]);

        tagValues.current.set(key, read);
        return read;
      },
    };
  }, [tagKeys, services, regions, data.currency]);

  return { names, options, isLoading };
}
