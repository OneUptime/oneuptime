import AppLink from "../AppLink/AppLink";
import DataObservabilityApi from "./DataObservabilityApi";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { DataObservabilityAiAppTable } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The tables your AI apps read from that have gone late. An app retrieving from
 * a stale table still answers, quickly, from old data, and nothing in its own
 * traces says so. With none late, or none readable, it shows nothing.
 */
const StaleTablesForAiApps: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [tables, setTables] = useState<Array<DataObservabilityAiAppTable>>([]);

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getAiAppTables()
      .then((found: Array<DataObservabilityAiAppTable>): void => {
        if (isCurrent) {
          setTables(found);
        }
      })
      .catch((): void => {
        // Extra to the page it is on: when it cannot be read, the page carries on without it.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (tables.length === 0) {
    return <></>;
  }

  return (
    <Card
      title="Stale Data Behind Your AI Apps"
      description="These apps read tables that have stopped changing on their usual rhythm, so their answers may be out of date."
    >
      <ul className="divide-y divide-gray-100 px-6 pb-6">
        {tables.map((table: DataObservabilityAiAppTable): ReactElement => {
          return (
            <li
              key={`${table.dataAssetId}:${table.serviceName}`}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <AppLink
                className="font-mono text-gray-900 hover:underline"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
                  { modelId: new ObjectID(table.dataAssetId) },
                )}
              >
                {table.table}
              </AppLink>
              <span className="text-xs text-gray-500">
                {translator.translateTemplate("Read by {{service}}", {
                  service: table.serviceName,
                })}
                {table.lastChangedAt
                  ? ` · ${translator.translateTemplate(
                      "Last changed {{time}}",
                      {
                        time: OneUptimeDate.fromNow(
                          OneUptimeDate.fromString(table.lastChangedAt),
                        ),
                      },
                    )}`
                  : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

export default StaleTablesForAiApps;
