import Host from "Common/Models/DatabaseModels/Host";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import { HostCollectorOsType } from "Common/Types/HostCollector/HostCollector";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import {
  HostCollectorHostCount,
  getHostsFailingConfigQuery,
  getHostsOnDefaultQuery,
  getHostsRunningConfigQuery,
} from "./HostCollectorConfigFleet";

/*
 * How many hosts run each Collector Config, and on how many of them it did
 * not start: the Collector Configs list's Hosts column and a config's own
 * page. Counted by the server, one config at a time, so a fleet of any size
 * reads right; a config no host runs costs one count.
 *
 * A count that cannot be read stays unknown: the cell shows a dash, and the
 * rest of the page is untouched.
 */

export interface HostCollectorConfigHostCounts {
  // By config id; a config not counted yet (or that could not be) is absent.
  counts: Dictionary<HostCollectorHostCount>;
  // Count these configs' hosts, again: after the list loads or changes.
  load: (configIds: Array<string>) => void;
}

async function countHosts(configId: string): Promise<HostCollectorHostCount> {
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
  const id: ObjectID = new ObjectID(configId);

  const hosts: number = await ModelAPI.count<Host>({
    modelType: Host,
    query: getHostsRunningConfigQuery({ projectId, configId: id }),
  });

  if (hosts === 0) {
    return { hosts: 0, failed: 0 };
  }

  const failed: number = await ModelAPI.count<Host>({
    modelType: Host,
    query: getHostsFailingConfigQuery({ projectId, configId: id }),
  });

  return { hosts, failed };
}

export function useHostCollectorConfigHostCounts(): HostCollectorConfigHostCounts {
  const [counts, setCounts] = useState<Dictionary<HostCollectorHostCount>>({});
  // Only the latest load writes: a slow answer from before a refresh is dropped.
  const generation: MutableRefObject<number> = useRef<number>(0);
  const isMounted: MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const load: (configIds: Array<string>) => void = (
    configIds: Array<string>,
  ): void => {
    generation.current += 1;
    const thisGeneration: number = generation.current;

    for (const configId of configIds) {
      if (!configId) {
        continue;
      }

      countHosts(configId)
        .then((count: HostCollectorHostCount) => {
          if (!isMounted.current || thisGeneration !== generation.current) {
            return;
          }
          setCounts(
            (
              previous: Dictionary<HostCollectorHostCount>,
            ): Dictionary<HostCollectorHostCount> => {
              return { ...previous, [configId]: count };
            },
          );
        })
        .catch(() => {
          // Unknown: the cell keeps its dash.
        });
    }
  };

  return { counts, load };
}

/*
 * How many hosts run OneUptime's default for each system: the defaults
 * card. Counted once, when the card mounts, and again with `refreshToken`.
 */
export function useHostCollectorDefaultHostCounts(data: {
  osTypes: ReadonlyArray<HostCollectorOsType>;
  refreshToken?: string | number | undefined;
}): Dictionary<number> {
  const [counts, setCounts] = useState<Dictionary<number>>({});

  useEffect(() => {
    // Cleared when the card goes or counts again: a late answer is dropped.
    const run: { isCurrent: boolean } = { isCurrent: true };
    const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

    for (const osType of data.osTypes) {
      ModelAPI.count<Host>({
        modelType: Host,
        query: getHostsOnDefaultQuery({ projectId, osType }),
      })
        .then((count: number) => {
          if (!run.isCurrent) {
            return;
          }
          setCounts((previous: Dictionary<number>): Dictionary<number> => {
            return { ...previous, [osType]: count };
          });
        })
        .catch(() => {
          // Unknown: the row keeps its dash.
        });
    }

    return () => {
      run.isCurrent = false;
    };
  }, [data.osTypes.join(","), data.refreshToken]);

  return counts;
}
