import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import DataObservabilityApi from "../../../Components/DataObservability/DataObservabilityApi";
import {
  describeDataProductSla,
  getDataProductStatusPill,
} from "../../../Components/DataObservability/DataProductForm";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green500, Yellow500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { formatDataAsOf } from "Common/Types/DataObservability/DataProductBadge";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams } from "react-router-dom";

/*
 * Whether a data product's data is fresh, for the people who rely on it:
 *
 *  - its status by its SLA, what its data is as of (the oldest last change
 *    among its tables), and which tables are late;
 *  - its monitor - the product on a status page, private or public, where
 *    its consumers subscribe - and its SLO with burn-rate alerts, each one
 *    click away, or set up again when either is missing;
 *  - its "data as of" badge, with the code to embed it in a BI dashboard or
 *    a wiki page, and a new link when an old one has gone too far.
 */
const DataProductOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { id } = useParams();
  const dataProductId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);
  const [product, setProduct] = useState<DataProduct | null>(null);
  const [readCount, setReadCount] = useState<number>(0);
  const [actionError, setActionError] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<DataProduct>({
      modelType: DataProduct,
      id: dataProductId,
      select: {
        name: true,
        status: true,
        lateTableCount: true,
        lateDataAssetIds: true,
        dataAsOf: true,
        statusChangedAt: true,
        freshByTimeOfDay: true,
        maxDataAgeInMinutes: true,
        slaTargetPercentage: true,
        monitorId: true,
        serviceLevelObjectiveId: true,
        badgeToken: true,
        dataAssets: { _id: true },
      },
    })
      .then((item: DataProduct | null): void => {
        if (isCurrent) {
          setProduct(item);
        }
      })
      .catch((): void => {
        // The tiles stay empty; the page's other parts read on their own.
      });

    return () => {
      isCurrent = false;
    };
  }, [dataProductId, readCount]);

  const tableIds: Array<string> = (product?.dataAssets || [])
    .filter((asset: DataAsset) => {
      return Boolean(asset.id);
    })
    .map((asset: DataAsset): string => {
      return asset.id!.toString();
    });
  const lateIds: Set<string> = new Set(
    (product?.lateDataAssetIds || []).map((value: unknown) => {
      return String(value);
    }),
  );
  const badgeUrl: string | null =
    product?.badgeToken && product.id
      ? DataObservabilityApi.getDataProductBadgeUrl(
          product.id,
          product.badgeToken,
        )
      : null;

  const runAction: (action: () => Promise<unknown>) => Promise<void> = async (
    action: () => Promise<unknown>,
  ): Promise<void> => {
    setActionError("");
    setIsWorking(true);

    try {
      await action();
      setReadCount(readCount + 1);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="space-y-5">
      <EventStatBar columns={4} ariaLabel="Data product freshness">
        <EventStatTile
          label="Status"
          value={getDataProductStatusPill(product?.status)}
          note={
            product?.statusChangedAt
              ? translator.translateTemplate("Since {{time}}", {
                  time: OneUptimeDate.fromNow(
                    OneUptimeDate.fromString(product.statusChangedAt),
                  ),
                })
              : undefined
          }
          icon={IconProp.Signal}
        />
        <EventStatTile
          label="Data As Of"
          value={
            product?.dataAsOf
              ? OneUptimeDate.fromNow(
                  OneUptimeDate.fromString(product.dataAsOf),
                )
              : "-"
          }
          note={
            product?.dataAsOf
              ? formatDataAsOf(OneUptimeDate.fromString(product.dataAsOf))
              : undefined
          }
          icon={IconProp.Clock}
        />
        <EventStatTile
          label="SLA"
          value={product ? describeDataProductSla(translator, product) : "-"}
          note={
            product?.slaTargetPercentage !== undefined &&
            product?.slaTargetPercentage !== null
              ? translator.translateTemplate("{{target}}% of the time", {
                  target: product.slaTargetPercentage,
                })
              : undefined
          }
          icon={IconProp.Flag}
        />
        <EventStatTile
          label="Tables"
          value={translator.formatNumber(tableIds.length)}
          note={
            lateIds.size > 0 ? (
              <span className="font-medium text-yellow-700">
                {translator.translateTemplate("{{count}} late", {
                  count: lateIds.size,
                })}
              </span>
            ) : undefined
          }
          icon={IconProp.TableCells}
        />
      </EventStatBar>

      {actionError ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </p>
      ) : (
        <></>
      )}

      {tableIds.length > 0 ? (
        <ModelTable<DataAsset>
          modelType={DataAsset}
          id="data-product-tables"
          name="Data Observability > Data Product > Tables"
          userPreferencesKey="data-product-tables"
          query={{ _id: new Includes(tableIds) }}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          sortBy="lastChangedAt"
          sortOrder={SortOrder.Ascending}
          showRefreshButton={true}
          cardProps={{
            title: "Tables",
            description:
              "The data product's tables, the one that changed longest ago first: the product's data is as of it.",
          }}
          noItemsMessage="None of the data product's tables is watched any more."
          filters={[]}
          columns={[
            {
              field: { assetKey: true },
              title: "Table",
              type: FieldType.Element,
              getElement: (asset: DataAsset): ReactElement => {
                return (
                  <AppLink
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
                      { modelId: asset.id! },
                    )}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    <span>{asset.assetKey || ""}</span>
                  </AppLink>
                );
              },
            },
            {
              field: { lastChangedAt: true },
              title: "Last Changed",
              type: FieldType.Element,
              getElement: (asset: DataAsset): ReactElement => {
                return (
                  <span className="whitespace-nowrap text-sm text-gray-700">
                    {asset.lastChangedAt
                      ? OneUptimeDate.fromNow(
                          OneUptimeDate.fromString(asset.lastChangedAt),
                        )
                      : "-"}
                  </span>
                );
              },
            },
            {
              field: { _id: true },
              title: "By the SLA",
              type: FieldType.Element,
              disableSort: true,
              getElement: (asset: DataAsset): ReactElement => {
                if (!asset.lastChangedAt) {
                  return (
                    <span className="text-sm text-gray-500">
                      {translator.translateText("Not seen changing yet")}
                    </span>
                  );
                }

                return lateIds.has(asset.id!.toString()) ? (
                  <Pill text="Late" color={Yellow500} />
                ) : (
                  <Pill text="On Time" color={Green500} />
                );
              },
            },
          ]}
        />
      ) : (
        <Card
          title="Tables"
          description="The data product's tables. Add them in its Settings."
        >
          <p className="px-6 pb-6 text-sm text-gray-600">
            {translator.translateText(
              "This data product has no tables yet, so nothing says whether it is fresh.",
            )}
          </p>
        </Card>
      )}

      <Card
        title="Status Page and SLO"
        description="The data product's monitor shows it on a status page: Degraded while a table is late, with an incident its subscribers hear of. Its SLO tracks the SLA over 30 days, with fast and slow burn-rate alerts."
        buttons={[
          {
            title:
              product?.monitorId && product?.serviceLevelObjectiveId
                ? "Bring in Step"
                : "Set Up Monitor and SLO",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            disabled: isWorking,
            onClick: () => {
              runAction(() => {
                return DataObservabilityApi.syncDataProduct(dataProductId);
              }).catch(() => {});
            },
          },
        ]}
      >
        <div className="space-y-3 px-6 pb-6 text-sm text-gray-700">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {product?.monitorId ? (
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITOR_VIEW] as Route,
                  { modelId: product.monitorId },
                )}
                className="font-medium text-indigo-600 hover:underline"
              >
                <span>{translator.translateText("Open the monitor")}</span>
              </AppLink>
            ) : (
              <span className="text-gray-500">
                {translator.translateText("No monitor yet")}
              </span>
            )}
            {product?.serviceLevelObjectiveId ? (
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SLO_VIEW] as Route,
                  { modelId: product.serviceLevelObjectiveId },
                )}
                className="font-medium text-indigo-600 hover:underline"
              >
                <span>{translator.translateText("Open the SLO")}</span>
              </AppLink>
            ) : (
              <span className="text-gray-500">
                {translator.translateText("No SLO yet")}
              </span>
            )}
          </div>
          <p>
            {translator.translateText(
              "To show the data product to its consumers, open a status page, private or public, add a resource, and pick this monitor. Give it the product's name as its display name, so consumers read it as they know it.",
            )}
          </p>
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES] as Route,
            )}
            className="font-medium text-indigo-600 hover:underline"
          >
            <span>{translator.translateText("Go to Status Pages")}</span>
          </AppLink>
        </div>
      </Card>

      <Card
        title="Badge"
        description="A badge that says what the data is as of, green while it is on time and amber once it is late. Embed it in a BI dashboard, a wiki page or a README: its link needs no sign-in, so treat it like a shared link."
        buttons={[
          {
            title: "Reset Badge Link",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            disabled: isWorking,
            onClick: () => {
              runAction(() => {
                return DataObservabilityApi.resetDataProductBadge(
                  dataProductId,
                );
              }).catch(() => {});
            },
          },
        ]}
      >
        {badgeUrl ? (
          <div className="space-y-4 px-6 pb-6">
            <img
              src={badgeUrl}
              alt={translator.translateText("Data as of badge")}
              className="h-5"
            />
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">
                {translator.translateText("Markdown")}
              </p>
              <CodeBlock
                code={`![Data as of](${badgeUrl})`}
                language="markdown"
                showCopyButton={true}
                wrapLongLines={true}
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">
                {translator.translateText("HTML")}
              </p>
              <CodeBlock
                code={`<img src="${badgeUrl}" alt="Data as of" />`}
                language="html"
                showCopyButton={true}
                wrapLongLines={true}
              />
            </div>
          </div>
        ) : (
          <p className="px-6 pb-6 text-sm text-gray-600">
            {translator.translateText(
              "This data product has no badge link yet. Reset Badge Link makes one.",
            )}
          </p>
        )}
      </Card>
    </div>
  );
};

export default DataProductOverviewPage;
