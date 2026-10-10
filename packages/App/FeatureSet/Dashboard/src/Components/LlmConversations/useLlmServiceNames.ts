import { useEffect, useState } from "react";
import Service from "Common/Models/DatabaseModels/Service";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * The project's apps (telemetry services) by id, for naming the app a
 * conversation ran in and for the app filter. A failed read leaves the map
 * empty: rows then simply leave the app out.
 */

export interface LlmServiceOption {
  id: string;
  name: string;
}

export interface LlmServiceNames {
  names: Map<string, string>;
  options: Array<LlmServiceOption>;
}

export function useLlmServiceNames(): LlmServiceNames {
  const [state, setState] = useState<LlmServiceNames>({
    names: new Map<string, string>(),
    options: [],
  });

  useEffect(() => {
    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return;
      }

      try {
        const result: ListResult<Service> = await ModelAPI.getList({
          modelType: Service,
          query: { projectId: projectId },
          select: { name: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: { name: SortOrder.Ascending },
        });

        if (cancelled) {
          return;
        }

        const options: Array<LlmServiceOption> = (result.data || [])
          .filter((service: Service): boolean => {
            return Boolean(service.id && service.name);
          })
          .map((service: Service): LlmServiceOption => {
            return { id: service.id!.toString(), name: service.name! };
          });

        setState({
          names: new Map<string, string>(
            options.map((option: LlmServiceOption): [string, string] => {
              return [option.id, option.name];
            }),
          ),
          options: options,
        });
      } catch {
        // Names are a nicety: the page works without them.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
