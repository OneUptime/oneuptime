import DataObservabilityApi from "./DataObservabilityApi";
import { getDatabaseAgentOptions } from "./DatabaseConnectionFields";
import Probe from "Common/Models/DatabaseModels/Probe";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DataObservabilityDatabaseAgent } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { useEffect, useMemo, useState } from "react";

/*
 * The project's own probes and its Database Agents, read once for a form
 * that asks how a database is reached (DatabaseConnectionFields). A list
 * that cannot be read is an empty one: the other ways in still work.
 */
export interface DatabaseConnectionChoices {
  isLoading: boolean;
  probeOptions: Array<DropdownOption>;
  agents: Array<DataObservabilityDatabaseAgent>;
  agentOptions: Array<DropdownOption>;
}

export default function useDatabaseConnectionChoices(): DatabaseConnectionChoices {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [probeOptions, setProbeOptions] = useState<Array<DropdownOption>>([]);
  const [agents, setAgents] = useState<Array<DataObservabilityDatabaseAgent>>(
    [],
  );

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    const readProbes: Promise<void> = ModelAPI.getList<Probe>({
      modelType: Probe,
      query: projectId ? { projectId: projectId } : {},
      select: { _id: true, name: true },
      limit: 100,
      skip: 0,
      sort: { name: SortOrder.Ascending },
    })
      .then((result: ListResult<Probe>): void => {
        if (!isCurrent) {
          return;
        }

        setProbeOptions(
          result.data
            .filter((probe: Probe): boolean => {
              return Boolean(probe.id);
            })
            .map((probe: Probe): DropdownOption => {
              return {
                value: probe.id!.toString(),
                label: probe.name || probe.id!.toString(),
                isUserContent: true,
              };
            }),
        );
      })
      .catch((): void => {
        // Without probes, the other ways in remain.
      });

    const readAgents: Promise<void> = DataObservabilityApi.getDatabaseAgents()
      .then((result: Array<DataObservabilityDatabaseAgent>): void => {
        if (isCurrent) {
          setAgents(result);
        }
      })
      .catch((): void => {
        // Without agents, the other ways in remain.
      });

    void Promise.all([readProbes, readAgents]).finally((): void => {
      if (isCurrent) {
        setIsLoading(false);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, []);

  const agentOptions: Array<DropdownOption> = useMemo(() => {
    return getDatabaseAgentOptions(agents, translator);
  }, [agents, translator]);

  return { isLoading, probeOptions, agents, agentOptions };
}
