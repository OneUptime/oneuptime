import AppLink from "../AppLink/AppLink";
import DataObservabilityApi from "./DataObservabilityApi";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { DataObservabilityTableDashboard } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  dataAssetId: ObjectID;
  // On an alert: nothing at all when no dashboard is built on the table.
  hideWhenEmpty?: boolean | undefined;
}

// A dashboard's link, when its tool gave one that reads as a URL.
function readUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }

  try {
    return URL.fromString(value);
  } catch {
    return null;
  }
}

/*
 * The dashboards of connected BI tools built on a table, and on the tables
 * built from it (DataTableDashboards): the real impact of bad data is the
 * dashboard someone opens. Each opens in its tool; one built on a table
 * downstream says which.
 */
const TableDashboards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [dashboards, setDashboards] =
    useState<Array<DataObservabilityTableDashboard> | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getTableDashboards(props.dataAssetId)
      .then((found: Array<DataObservabilityTableDashboard>): void => {
        if (isCurrent) {
          setDashboards(found);
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setDashboards([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.dataAssetId.toString()]);

  if (!dashboards || (props.hideWhenEmpty && dashboards.length === 0)) {
    return <Fragment />;
  }

  return (
    <Card
      title="Dashboards Built On It"
      description="The dashboards of your BI tools whose charts read this table, or a table built from it: who sees bad data first."
    >
      {dashboards.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-gray-500">
          {translator.translateText(
            "No dashboard of a connected BI tool reads this table, or a table built from it. Add your BI tools under BI Dashboards.",
          )}
        </p>
      ) : (
        <ul
          className="divide-y divide-gray-100 px-6 pb-6"
          data-testid="table-dashboards"
        >
          {dashboards.map((dashboard: DataObservabilityTableDashboard) => {
            const url: URL | null = readUrl(dashboard.url);

            return (
              <li
                key={dashboard.dataDashboardId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
              >
                {url ? (
                  <Link
                    to={url}
                    openInNewTab={true}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {dashboard.name}
                  </Link>
                ) : (
                  <span className="font-medium text-gray-900">
                    {dashboard.name}
                  </span>
                )}
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                  {dashboard.tool}
                </span>
                {dashboard.folder ? (
                  <span className="text-xs text-gray-500">
                    {dashboard.folder}
                  </span>
                ) : (
                  <></>
                )}
                {dashboard.via ? (
                  <span className="text-xs text-gray-500">
                    <TranslatedSentence
                      template="Through {{table}}"
                      slots={{
                        table: (
                          <AppLink
                            to={RouteUtil.populateRouteParams(
                              RouteMap[
                                PageMap.DATA_OBSERVABILITY_TABLE_VIEW
                              ] as Route,
                              {
                                modelId: new ObjectID(
                                  dashboard.via.dataAssetId,
                                ),
                              },
                            )}
                            className="font-mono hover:underline"
                          >
                            <span>{dashboard.via.table}</span>
                          </AppLink>
                        ),
                      }}
                    />
                  </span>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

export default TableDashboards;
