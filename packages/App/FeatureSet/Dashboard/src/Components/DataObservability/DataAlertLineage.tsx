import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import DataAlert from "Common/Models/DatabaseModels/DataAlert";
import DataAssetUsage from "Common/Models/DatabaseModels/DataAssetUsage";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DataAssetAccessKind } from "Common/Types/DataObservability/DataAssetUsage";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
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
  alertId: ObjectID;
}

// The most downstream alerts listed on a cause.
const MAX_IMPACT_LISTED: number = 50;

// How long before an alert its writers' changes are looked at, and after.
const CHANGES_BEFORE_IN_HOURS: number = 24;
const CHANGES_AFTER_IN_HOURS: number = 1;

const DATA_ALERT_SELECT: {
  _id: true;
  alertId: true;
  causeAlertId: true;
  dataAssetId: true;
  dataPipelineId: true;
  dataStoreId: true;
  alert: { title: true; alertNumberWithPrefix: true; createdAt: true };
  causeAlert: { title: true; alertNumberWithPrefix: true };
  dataAsset: { assetKey: true; dataStoreName: true };
  dataPipeline: { jobName: true };
  dataStore: { name: true };
} = {
  _id: true,
  alertId: true,
  causeAlertId: true,
  dataAssetId: true,
  dataPipelineId: true,
  dataStoreId: true,
  alert: { title: true, alertNumberWithPrefix: true, createdAt: true },
  causeAlert: { title: true, alertNumberWithPrefix: true },
  dataAsset: { assetKey: true, dataStoreName: true },
  dataPipeline: { jobName: true },
  dataStore: { name: true },
};

function alertRoute(alertId: ObjectID): Route {
  return RouteUtil.populateRouteParams(RouteMap[PageMap.ALERT_VIEW] as Route, {
    modelId: alertId,
  });
}

function alertName(alert: DataAlert["alert"] | undefined): string {
  return [alert?.alertNumberWithPrefix, alert?.title].filter(Boolean).join(" ");
}

/*
 * A read the card can do without: its answer, or null when it failed or was
 * refused, so it leaves out only what it would have shown. A reader may
 * read a data alert and not the changes of the services that write its
 * table (Read Data Asset, given to a team, does not read change events),
 * and the changes are kept in ClickHouse, which can fail while the rest
 * answers: the card still says what the alert is about and what caused it.
 */
function orNothing<T>(reading: Promise<T>): Promise<T | null> {
  return reading.catch((): null => {
    return null;
  });
}

/*
 * A data alert's place in Data Observability. What it is about - a table or
 * a pipeline, linked - and the alert upstream it is a consequence of, when
 * it started acknowledged because that one was open first. For a table: the
 * services that write it, with the writes that failed, and their deploys
 * and other changes around the alert, which are most often why it broke.
 * And, on a cause, the alerts downstream it caused: its impact. Nothing for
 * any other alert.
 */
const DataAlertLineage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [own, setOwn] = useState<DataAlert | null>(null);
  const [impact, setImpact] = useState<Array<DataAlert>>([]);
  const [impactCount, setImpactCount] = useState<number>(0);
  const [writers, setWriters] = useState<Array<DataAssetUsage>>([]);
  /*
   * Null when the writers' changes were not read - the read failed or was
   * refused, or the alert's time was not there to read around: then the
   * card says nothing of them, rather than that there were none.
   */
  const [changes, setChanges] = useState<Array<ChangeEvent> | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const mine: ListResult<DataAlert> | null = await orNothing(
        ModelAPI.getList<DataAlert>({
          modelType: DataAlert,
          query: { alertId: props.alertId },
          select: DATA_ALERT_SELECT,
          limit: 1,
          skip: 0,
          sort: {},
        }),
      );
      const caused: ListResult<DataAlert> | null = await orNothing(
        ModelAPI.getList<DataAlert>({
          modelType: DataAlert,
          query: { causeAlertId: props.alertId },
          select: DATA_ALERT_SELECT,
          limit: MAX_IMPACT_LISTED,
          skip: 0,
          sort: { createdAt: SortOrder.Ascending },
        }),
      );
      const row: DataAlert | null = mine?.data[0] || null;
      let writing: Array<DataAssetUsage> = [];
      let changed: Array<ChangeEvent> | null = null;

      if (row?.dataAssetId) {
        const usages: ListResult<DataAssetUsage> | null = await orNothing(
          ModelAPI.getList<DataAssetUsage>({
            modelType: DataAssetUsage,
            query: {
              dataAssetId: row.dataAssetId,
              accessKind: DataAssetAccessKind.Write,
            },
            select: {
              serviceId: true,
              serviceName: true,
              callCount: true,
              errorCount: true,
              lastSeenAt: true,
            },
            limit: 10,
            skip: 0,
            sort: { lastSeenAt: SortOrder.Descending },
          }),
        );

        writing = usages?.data || [];
      }

      const serviceIds: Array<string> = writing
        .map((usage: DataAssetUsage): string => {
          return usage.serviceId?.toString() || "";
        })
        .filter(Boolean);
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (serviceIds.length > 0 && projectId && row?.alert?.createdAt) {
        const alertedAt: Date = OneUptimeDate.fromString(row.alert.createdAt);
        const found: AnalyticsListResult<ChangeEvent> | null = await orNothing(
          AnalyticsModelAPI.getList<ChangeEvent>({
            modelType: ChangeEvent,
            query: {
              projectId,
              primaryEntityId: new Includes(serviceIds),
              time: new InBetween<Date>(
                OneUptimeDate.addRemoveHours(
                  alertedAt,
                  -CHANGES_BEFORE_IN_HOURS,
                ),
                OneUptimeDate.addRemoveHours(alertedAt, CHANGES_AFTER_IN_HOURS),
              ),
            } as unknown as Query<ChangeEvent>,
            select: {
              _id: true,
              time: true,
              title: true,
              eventType: true,
              primaryEntityId: true,
            },
            sort: { time: SortOrder.Descending },
            limit: 20,
            skip: 0,
          }),
        );

        changed = found ? found.data : null;
      }

      if (isCurrent) {
        setOwn(row);
        setImpact(caused?.data || []);
        setImpactCount(caused?.count || 0);
        setWriters(writing);
        setChanges(changed);
      }
    };

    read().catch(() => {
      /*
       * A read that failed or was refused is already left out above (not a
       * data alert, or not readable here: nothing to show). Anything else
       * that throws leaves the card out, never the page.
       */
    });

    return () => {
      isCurrent = false;
    };
  }, [props.alertId.toString()]);

  if (!own && impact.length === 0) {
    return <Fragment />;
  }

  const subject: (row: DataAlert) => ReactElement = (
    row: DataAlert,
  ): ReactElement => {
    if (row.dataAssetId) {
      return (
        <AppLink
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
            { modelId: row.dataAssetId },
          )}
          className="font-medium text-gray-900 hover:underline"
        >
          <span>
            {[row.dataAsset?.assetKey, row.dataAsset?.dataStoreName]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </AppLink>
      );
    }

    if (row.dataPipelineId) {
      return (
        <AppLink
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW] as Route,
            { modelId: row.dataPipelineId },
          )}
          className="font-medium text-gray-900 hover:underline"
        >
          <span>{row.dataPipeline?.jobName || ""}</span>
        </AppLink>
      );
    }

    return (
      <span className="font-medium text-gray-900">
        {row.dataStore?.name || ""}
      </span>
    );
  };

  const writerName: (serviceId: string | undefined) => string = (
    serviceId: string | undefined,
  ): string => {
    return (
      writers.find((usage: DataAssetUsage) => {
        return usage.serviceId?.toString() === serviceId;
      })?.serviceName || ""
    );
  };

  const label: (text: string) => ReactElement = (
    text: string,
  ): ReactElement => {
    return (
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(text)}
      </dt>
    );
  };

  return (
    <Fragment>
      {own ? (
        <Card
          title="Data"
          description="What this alert is about in Data Observability, what caused it upstream, and what changed around it."
        >
          <dl className="space-y-4 px-6 pb-6 text-sm text-gray-700">
            <div>
              {label("About")}
              <dd className="mt-1">{subject(own)}</dd>
            </div>
            {own.causeAlertId ? (
              <div>
                {label("Caused Upstream")}
                <dd className="mt-1 space-y-1">
                  <AppLink
                    to={alertRoute(own.causeAlertId)}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    <span>{alertName(own.causeAlert)}</span>
                  </AppLink>
                  <p className="text-xs text-gray-500">
                    {translator.translateText(
                      "That alert was open first, on what this one's table or pipeline is built from, so this alert started acknowledged: nobody was paged twice.",
                    )}
                  </p>
                </dd>
              </div>
            ) : (
              <></>
            )}
            {writers.length > 0 ? (
              <div>
                {label("Written By")}
                <dd className="mt-1 space-y-1">
                  {writers.map((usage: DataAssetUsage) => {
                    return (
                      <div
                        key={usage.serviceId?.toString()}
                        className="flex flex-wrap items-baseline gap-x-2"
                      >
                        <span className="font-medium text-gray-900">
                          {usage.serviceName}
                        </span>
                        <span
                          className={`text-xs ${
                            usage.errorCount
                              ? "font-medium text-red-600"
                              : "text-gray-500"
                          }`}
                        >
                          {translator.translateTemplate(
                            "{{writes}} writes, {{failed}} failed, in the hour last seen {{time}}",
                            {
                              writes: translator.formatNumber(
                                usage.callCount || 0,
                              ),
                              failed: translator.formatNumber(
                                usage.errorCount || 0,
                              ),
                              time: usage.lastSeenAt
                                ? OneUptimeDate.fromNow(
                                    OneUptimeDate.fromString(usage.lastSeenAt),
                                  )
                                : "",
                            },
                          )}
                        </span>
                      </div>
                    );
                  })}
                </dd>
              </div>
            ) : (
              <></>
            )}
            {writers.length > 0 && changes ? (
              <div>
                {label("Changes Around It")}
                <dd className="mt-1 space-y-1">
                  {changes.length > 0 ? (
                    changes.map((change: ChangeEvent) => {
                      return (
                        <div
                          key={change._id?.toString()}
                          className="flex flex-wrap items-baseline gap-x-2"
                        >
                          <span className="whitespace-nowrap text-xs text-gray-500">
                            {change.time
                              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                                  OneUptimeDate.fromString(change.time),
                                )
                              : ""}
                          </span>
                          <span className="text-gray-900">{change.title}</span>
                          <span className="text-xs text-gray-500">
                            {writerName(change.primaryEntityId?.toString())}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-gray-500">
                      {translator.translateText(
                        "No deploy or other change of these services in the day before the alert.",
                      )}
                    </p>
                  )}
                </dd>
              </div>
            ) : (
              <></>
            )}
          </dl>
        </Card>
      ) : (
        <Fragment />
      )}
      {impact.length > 0 ? (
        <Card
          title="Downstream Impact"
          description="The alerts on tables and pipelines built from this alert's, each a consequence of it: they started acknowledged, so this alert is the one that paged."
        >
          <ul className="divide-y divide-gray-100 px-6 pb-6">
            {impact.map((row: DataAlert) => {
              return (
                <li
                  key={row.id?.toString()}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                >
                  {subject(row)}
                  {row.alertId ? (
                    <AppLink
                      to={alertRoute(row.alertId)}
                      className="text-gray-500 hover:underline"
                    >
                      <span>{alertName(row.alert)}</span>
                    </AppLink>
                  ) : (
                    <></>
                  )}
                </li>
              );
            })}
          </ul>
          {impactCount > impact.length ? (
            <p className="px-6 pb-6 text-xs text-gray-500">
              {translator.translateTemplate("And {{count}} more.", {
                count: impactCount - impact.length,
              })}
            </p>
          ) : (
            <></>
          )}
        </Card>
      ) : (
        <Fragment />
      )}
    </Fragment>
  );
};

export default DataAlertLineage;
