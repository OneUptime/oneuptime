import { getNumberLocale } from "Common/Types/DateLanguage";
import PageComponentProps from "../../PageComponentProps";
import OpenStackProjectUsage from "Common/Models/DatabaseModels/OpenStackProjectUsage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCollectionMethod from "Common/Types/OpenStack/OpenStackCollectionMethod";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackSpendDay,
  OpenStackSpendDomain,
  OpenStackSpendFlavorRow,
  OpenStackSpendProject,
  OpenStackSpendSnapshot,
  OpenStackSpendVolumeTypeRow,
} from "Common/Types/OpenStack/OpenStackSpendSnapshot";
import { OpenStackWasteFinding } from "Common/Types/OpenStack/OpenStackWaste";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import CloudStatStrip, {
  CloudStatTile,
} from "../../../Components/Cloud/CloudStatStrip";
import OpenStackBudgetsCard from "../../../Components/OpenStack/OpenStackBudgetsCard";
import OpenStackDailyUsageChart from "../../../Components/OpenStack/OpenStackDailyUsageChart";
import OpenStackPriceListModal from "../../../Components/OpenStack/OpenStackPriceListModal";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "../../../Components/OpenStack/Part/OpenStackPartRoutes";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  OPENSTACK_SPEND_AGENT_CLOUDKITTY_TEXT,
  OPENSTACK_SPEND_NOT_BILLING_TEXT,
  OPENSTACK_SPEND_NO_SNAPSHOTS_TEXT,
  OPENSTACK_SPEND_SOURCE_TEXT,
  OpenStackSpendRead,
  fetchOpenStackSpend,
  fetchOpenStackSpendRows,
  formatOpenStackSpendMoney,
  formatOpenStackUsageNumber,
  getOpenStackCoverageNote,
  getOpenStackSpendCsv,
} from "../Utils/OpenStackSpendView";

/*
 * WHO'S USING WHAT, AND WHAT COULD BE RECLAIMED.
 *
 * The questions a private cloud's operator gets asked, in the shape of Cloud > Spend: this month
 * against last at the top, then who's growing, then each project. What it was used on, and the
 * domains, sit beneath them. Usage works with no prices at all. With them, it's an estimate, and with
 * CloudKitty, what CloudKitty rated, and the page says which.
 *
 * This reads one row for everything but the list of projects, which reads a page at a time. So a
 * cloud of 10,000 projects costs this page what a cloud of ten does. It's never an invoice: it says
 * estimate wherever it says money, and it doesn't ask anyone for anything.
 */

const TABLE_CLASS_NAME: string = "min-w-full text-start text-sm";
const HEAD_CLASS_NAME: string =
  "border-b border-gray-200 text-xs font-medium uppercase tracking-wide text-gray-500";
const CELL_CLASS_NAME: string = "py-2 pe-4 text-start align-top";
const WIDE_CELL_CLASS_NAME: string = `${CELL_CLASS_NAME} max-md:hidden md:table-cell`;
const ROW_CLASS_NAME: string = "border-b border-gray-100 last:border-0";
const LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

function getWasteCount(snapshot: OpenStackSpendSnapshot): number {
  return (snapshot.waste || []).reduce(
    (count: number, finding: OpenStackWasteFinding): number => {
      return count + finding.count;
    },
    0,
  );
}

export function getOpenStackSpendTiles(data: {
  snapshot: OpenStackSpendSnapshot;
  recommendationsRoute: Route;
  translator: Translator;
}): Array<CloudStatTile> {
  const { snapshot, translator } = data;
  const money: (amount: number | null) => string = (
    amount: number | null,
  ): string => {
    return formatOpenStackSpendMoney({
      amount,
      currency: snapshot.currency,
      translator,
    });
  };
  const reclaim: CloudStatTile = {
    key: "reclaim",
    title: translationKey("Could Be Reclaimed"),
    // The rules run hourly, and a first reading may not have run them yet.
    value: snapshot.waste ? getWasteCount(snapshot).toLocaleString() : "–",
    sublabel: translationKey("See Recommendations"),
    icon: IconProp.Archive,
    color: "amber",
    to: data.recommendationsRoute,
  };

  if (snapshot.thisMonth === null) {
    return [
      {
        key: "vcpu",
        title: translationKey("vCPU-Hours This Month"),
        value: formatOpenStackUsageNumber(snapshot.usage.vcpuHours, translator),
        ...(snapshot.lastMonthUsage
          ? {
              sublabel: translator.translateTemplate(
                translationKey("{{count}} last month"),
                {
                  count: formatOpenStackUsageNumber(
                    snapshot.lastMonthUsage.vcpuHours,
                    translator,
                  ),
                },
              ),
              sublabelIsTranslated: true,
            }
          : {}),
        icon: IconProp.CPUChip,
        color: "indigo",
      },
      {
        key: "memory",
        title: translationKey("Memory GB-Hours This Month"),
        value: formatOpenStackUsageNumber(
          snapshot.usage.memoryGbHours,
          translator,
        ),
        icon: IconProp.SquareStack,
        color: "blue",
      },
      {
        key: "volume",
        title: translationKey("Volume GB-Hours This Month"),
        value: formatOpenStackUsageNumber(
          snapshot.usage.volumeGbHours,
          translator,
        ),
        icon: IconProp.Database,
        color: "sky",
      },
      reclaim,
    ];
  }

  const comparison: OpenStackSpendSnapshot["comparison"] = snapshot.comparison;
  const lastMonthFrom: string | null | undefined =
    snapshot.lastMonthCoverage?.firstReadAt;
  const isLastMonthPartial: boolean = Boolean(
    lastMonthFrom && new Date(lastMonthFrom).getUTCDate() > 1,
  );
  const change: number | null =
    comparison &&
    comparison.thisMonth !== null &&
    comparison.lastMonth !== null &&
    comparison.lastMonth > 0
      ? Math.round(
          ((comparison.thisMonth - comparison.lastMonth) /
            comparison.lastMonth) *
            100,
        )
      : null;

  return [
    {
      key: "thisMonth",
      title: translationKey("This Month So Far"),
      value: money(snapshot.thisMonth),
      description: translationKey(
        "An estimate: your prices applied to usage, or what CloudKitty rated.",
      ),
      ...(change !== null
        ? {
            sublabel: translator.translateTemplate(
              change >= 0
                ? translationKey("Up {{percent}}% on the same days last month")
                : translationKey(
                    "Down {{percent}}% on the same days last month",
                  ),
              { percent: Math.abs(change).toString() },
            ),
            sublabelIsTranslated: true,
          }
        : {}),
      icon: IconProp.Wallet,
      color: "indigo",
    },
    {
      key: "onCourse",
      title: translationKey("On Course For"),
      value: money(snapshot.onCourseFor),
      description: translationKey(
        "If what's held now is held until the month ends.",
      ),
      icon: IconProp.ChartBar,
      color: "blue",
    },
    {
      key: "lastMonth",
      title: translationKey("Last Month"),
      value: money(snapshot.lastMonth),
      ...(isLastMonthPartial
        ? {
            sublabel: translator.translateTemplate(
              translationKey("Only counted from {{date}}"),
              {
                date: new Date(lastMonthFrom as string).toLocaleDateString(
                  getNumberLocale(translator.language || "en"),
                ),
              },
            ),
            sublabelIsTranslated: true,
          }
        : {
            sublabel:
              snapshot.lastMonth === null
                ? translationKey("Not enough history yet")
                : translationKey("At today's prices"),
          }),
      icon: IconProp.Calendar,
      color: "sky",
    },
    reclaim,
  ];
}

const OpenStackCloudSpend: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [isPricesOpen, setIsPricesOpen] = useState<boolean>(false);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);
  const [csvError, setCsvError] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const read: OpenStackRead<OpenStackSpendRead> =
    useOpenStackRead<OpenStackSpendRead>(() => {
      return fetchOpenStackSpend(modelId);
    }, [modelId.toString()]);

  if (read.isLoading && !read.data) {
    return <PageLoader isVisible={true} />;
  }

  if (read.error && !read.data) {
    return (
      <ResourcePartReadError
        testId="openstack-spend-read-error"
        title={translationKey("Couldn't load this cloud's usage")}
        message={read.error}
        onRetry={read.reload}
      />
    );
  }

  const spend: OpenStackSpendRead | null = read.data;
  const snapshot: OpenStackSpendSnapshot | null = spend?.snapshot || null;

  if (!spend || !snapshot) {
    return (
      <OpenStackPartNotice
        testId="openstack-spend-not-yet"
        text={translationKey(
          "This cloud's usage is read every quarter of an hour while it reports, and it hasn't been yet. Come back in a little while.",
        )}
      />
    );
  }

  const routes: OpenStackPartRoutes = getOpenStackPartRoutes(modelId);
  const money: (amount: number | null | undefined) => string = (
    amount: number | null | undefined,
  ): string => {
    return formatOpenStackSpendMoney({
      amount,
      currency: snapshot.currency,
      translator,
    });
  };
  const isPriced: boolean = snapshot.thisMonth !== null;
  const coverageNote: string | null = getOpenStackCoverageNote({
    snapshot,
    translator,
  });
  const isAgent: boolean =
    spend.collectionMethod !== OpenStackCollectionMethod.Probe;
  const flavorNames: Array<string> = Array.from(
    new Set(
      snapshot.byFlavor
        .map((row: OpenStackSpendFlavorRow): string => {
          return row.name || "";
        })
        .filter((name: string): boolean => {
          return name.length > 0;
        }),
    ),
  );
  const volumeTypes: Array<string> = snapshot.byVolumeType.map(
    (row: OpenStackSpendVolumeTypeRow): string => {
      return row.type;
    },
  );

  const projectLink: (project: {
    openStackProjectId?: string | undefined;
    name?: string | null | undefined;
  }) => ReactElement = (project: {
    openStackProjectId?: string | undefined;
    name?: string | null | undefined;
  }): ReactElement => {
    const id: string = project.openStackProjectId || "";
    const route: Route | undefined = routes.getPartRoute(
      OpenStackResourceKind.Project,
      id,
    );
    const name: ReactElement = <bdi>{project.name || id}</bdi>;

    return route ? (
      <Link to={route} className={`${LINK_CLASS_NAME} break-all`}>
        {name}
      </Link>
    ) : (
      <span className="break-all font-medium text-gray-900">{name}</span>
    );
  };

  return (
    <Fragment>
      <CloudStatStrip
        testId="openstack-spend-strip"
        tiles={getOpenStackSpendTiles({
          snapshot,
          translator,
          recommendationsRoute: RouteUtil.populateRouteParams(
            RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_RECOMMENDATIONS] as Route,
            { modelId },
          ),
        })}
      />

      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Button
          dataTestId="openstack-spend-prices"
          title={translationKey("Prices")}
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.Wallet}
          onClick={() => {
            setIsPricesOpen(true);
          }}
        />
        <Button
          dataTestId="openstack-spend-export"
          title={translationKey("Export CSV")}
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.Download}
          isLoading={isExporting}
          onClick={() => {
            setIsExporting(true);
            setCsvError("");
            fetchOpenStackSpendRows({
              openStackCloudId: modelId,
              month: snapshot.month,
            })
              .then((rows: Array<OpenStackProjectUsage>) => {
                TableColumnsToCsv.downloadCsv({
                  csv: getOpenStackSpendCsv({
                    rows,
                    month: snapshot.month,
                    priceList: spend.priceList,
                    currency: snapshot.currency,
                  }),
                  filename: `openstack-usage-${snapshot.month}.csv`,
                });
                setIsExporting(false);
              })
              .catch((err: unknown) => {
                setCsvError(API.getFriendlyErrorMessage(err as Error));
                setIsExporting(false);
              });
          }}
        />
      </div>

      {csvError ? (
        <p
          className="mb-4 text-sm text-red-700"
          data-testid="openstack-spend-csv-error"
        >
          {csvError}
        </p>
      ) : (
        <></>
      )}

      <OpenStackPartNotice testId="openstack-spend-source">
        <span data-source={snapshot.source}>
          {translator.translateText(
            OPENSTACK_SPEND_SOURCE_TEXT[snapshot.source],
          )}{" "}
          {translator.translateText(OPENSTACK_SPEND_NOT_BILLING_TEXT)}
          {isAgent ? (
            <>
              {" "}
              {translator.translateText(OPENSTACK_SPEND_AGENT_CLOUDKITTY_TEXT)}
            </>
          ) : (
            <></>
          )}
          {snapshot.cloudKittyReadAt ? (
            <>
              {" "}
              {translator.translateTemplate(
                translationKey("CloudKitty was last read at {{time}}."),
                {
                  time: new Date(snapshot.cloudKittyReadAt).toLocaleString(
                    getNumberLocale(translator.language || "en"),
                  ),
                },
              )}
            </>
          ) : (
            <></>
          )}
        </span>
      </OpenStackPartNotice>

      {coverageNote ? (
        <OpenStackPartNotice testId="openstack-spend-coverage" tone="warning">
          {coverageNote}
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      {snapshot.projectsPartlyPriced > 0 ? (
        <OpenStackPartNotice testId="openstack-spend-partly-priced">
          {translator.translateTemplate(
            translationKey(
              "{{count}} projects used something with no price set, so a total here isn't all of it.",
            ),
            { count: snapshot.projectsPartlyPriced.toLocaleString() },
          )}
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      {snapshot.growers.length > 0 ? (
        <div className="mb-6">
          <Card
            title={translationKey("Top Growers")}
            description={
              isPriced
                ? translationKey(
                    "Who's on course to add the most on last month.",
                  )
                : translationKey(
                    "Who's on course to use the most vCPU-hours more than last month.",
                  )
            }
          >
            <ul
              className="divide-y divide-gray-100 text-sm"
              data-testid="openstack-spend-growers"
            >
              {snapshot.growers.map(
                (project: OpenStackSpendProject): ReactElement => {
                  return (
                    <li
                      key={project.openStackProjectId}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 py-2"
                      data-testid="openstack-spend-grower"
                      data-project={project.name || project.openStackProjectId}
                    >
                      {projectLink(project)}
                      <span className="text-gray-700">
                        {translator.translateTemplate(
                          translationKey("{{amount}} more"),
                          {
                            amount: isPriced
                              ? money(project.growth)
                              : translator.translateTemplate(
                                  translationKey("{{count}} vCPU-hours"),
                                  {
                                    count: formatOpenStackUsageNumber(
                                      project.growth,
                                      translator,
                                    ),
                                  },
                                ),
                          },
                        )}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          </Card>
        </div>
      ) : (
        <></>
      )}

      {snapshot.days.length > 0 ? (
        <div className="mb-6">
          <Card
            title={translationKey("Each Day")}
            description={translationKey(
              "vCPU-hours each day across this cloud, over the last two months.",
            )}
          >
            <OpenStackDailyUsageChart
              testId="openstack-spend-days"
              days={snapshot.days.map((day: OpenStackSpendDay) => {
                return { day: day.day, vcpuHours: day.vcpuHours };
              })}
            />
          </Card>
        </div>
      ) : (
        <></>
      )}

      <div className="mb-6" data-testid="openstack-spend-projects">
        <ModelTable<OpenStackProjectUsage>
          modelType={OpenStackProjectUsage}
          id="openstack-spend-projects-table"
          userPreferencesKey="openstack-spend-projects-table"
          name="OpenStack > Spend > Projects"
          singularName="project"
          pluralName="projects"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          showRefreshButton={true}
          query={{ openStackCloudId: modelId, period: snapshot.month }}
          sortBy="sortValue"
          sortOrder={SortOrder.Descending}
          cardProps={{
            title: translationKey("By Project"),
            description: translationKey(
              "What each project has used this month, the largest first.",
            ),
          }}
          noItemsMessage={translationKey(
            "Nothing has been used yet this month, as far as this cloud's inventory shows.",
          )}
          selectMoreFields={{
            openStackProjectId: true,
            domainName: true,
            costSource: true,
            unpricedLineCount: true,
          }}
          filters={[
            {
              field: { name: true },
              title: "Project",
              type: FieldType.Text,
            },
            {
              field: { domainName: true },
              title: "Domain",
              type: FieldType.Text,
            },
          ]}
          columns={[
            {
              field: { name: true },
              title: "Project",
              type: FieldType.Element,
              isNotCustomizable: true,
              wrapContent: true,
              getElement: (item: OpenStackProjectUsage): ReactElement => {
                return (
                  <div
                    className="min-w-0"
                    data-testid="openstack-spend-project"
                  >
                    {projectLink(item)}
                    {item.domainName ? (
                      <div className="mt-0.5 text-xs text-gray-500">
                        <bdi>{item.domainName}</bdi>
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
            {
              field: { estimatedCost: true },
              title: "This Month",
              type: FieldType.Element,
              getElement: (item: OpenStackProjectUsage): ReactElement => {
                return (
                  <span data-testid="openstack-spend-project-this-month">
                    {money(item.estimatedCost)}
                    {item.costSource === "cloudkitty" ? (
                      <span className="ms-1 text-xs text-gray-500">
                        {translator.translateText(translationKey("CloudKitty"))}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                );
              },
            },
            {
              field: { onCourseFor: true },
              title: "On Course For",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: OpenStackProjectUsage): ReactElement => {
                return <span>{money(item.onCourseFor)}</span>;
              },
            },
            {
              field: { lastMonthCost: true },
              title: "Last Month",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: OpenStackProjectUsage): ReactElement => {
                return <span>{money(item.lastMonthCost)}</span>;
              },
            },
            {
              field: { vcpuHours: true },
              title: "vCPU-Hours",
              type: FieldType.Element,
              getElement: (item: OpenStackProjectUsage): ReactElement => {
                return (
                  <span>
                    {formatOpenStackUsageNumber(item.vcpuHours, translator)}
                  </span>
                );
              },
            },
            {
              field: { memoryGbHours: true },
              title: "Memory GB-Hours",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: OpenStackProjectUsage): ReactElement => {
                return (
                  <span>
                    {formatOpenStackUsageNumber(item.memoryGbHours, translator)}
                  </span>
                );
              },
            },
            {
              field: { volumeGbHours: true },
              title: "Volume GB-Hours",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: OpenStackProjectUsage): ReactElement => {
                return (
                  <span>
                    {formatOpenStackUsageNumber(item.volumeGbHours, translator)}
                  </span>
                );
              },
            },
            {
              field: { floatingIpHours: true },
              title: "Floating IP-Hours",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: OpenStackProjectUsage): ReactElement => {
                return (
                  <span>
                    {formatOpenStackUsageNumber(
                      item.floatingIpHours,
                      translator,
                    )}
                  </span>
                );
              },
            },
          ]}
        />
      </div>

      {snapshot.domainCount > 1 ? (
        <div className="mb-6">
          <Card
            title={translationKey("By Domain")}
            description={translationKey(
              "This month's usage of each domain's projects, the largest first.",
            )}
          >
            <div className="overflow-x-auto">
              <table className={TABLE_CLASS_NAME}>
                <thead>
                  <tr className={HEAD_CLASS_NAME}>
                    <th className={CELL_CLASS_NAME}>
                      {translator.translateText(translationKey("Domain"))}
                    </th>
                    <th className={CELL_CLASS_NAME}>
                      {translator.translateText(translationKey("This Month"))}
                    </th>
                    <th className={WIDE_CELL_CLASS_NAME}>
                      {translator.translateText(translationKey("Last Month"))}
                    </th>
                    <th className={WIDE_CELL_CLASS_NAME}>
                      {translator.translateText(translationKey("Projects"))}
                    </th>
                    <th className={CELL_CLASS_NAME}>
                      {translator.translateText(translationKey("vCPU-Hours"))}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.domains.map(
                    (domain: OpenStackSpendDomain): ReactElement => {
                      return (
                        <tr
                          key={domain.domainId || "none"}
                          className={ROW_CLASS_NAME}
                          data-testid="openstack-spend-domain"
                          data-domain={domain.name || domain.domainId || ""}
                        >
                          <td className={`${CELL_CLASS_NAME} break-all`}>
                            <bdi>
                              {domain.name ||
                                domain.domainId ||
                                translator.translateText(
                                  translationKey("No domain"),
                                )}
                            </bdi>
                          </td>
                          <td className={CELL_CLASS_NAME}>
                            {money(domain.thisMonth)}
                          </td>
                          <td className={WIDE_CELL_CLASS_NAME}>
                            {money(domain.lastMonth)}
                          </td>
                          <td className={WIDE_CELL_CLASS_NAME}>
                            {domain.projectCount.toLocaleString()}
                          </td>
                          <td className={CELL_CLASS_NAME}>
                            {formatOpenStackUsageNumber(
                              domain.vcpuHours,
                              translator,
                            )}
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
            {snapshot.domainCount > snapshot.domains.length ? (
              <p className="mt-2 text-sm text-gray-500">
                {translator.translateTemplate(
                  translationKey("The largest {{count}} of {{total}}."),
                  {
                    count: snapshot.domains.length.toLocaleString(),
                    total: snapshot.domainCount.toLocaleString(),
                  },
                )}
              </p>
            ) : (
              <></>
            )}
          </Card>
        </div>
      ) : (
        <></>
      )}

      <div className="mb-6">
        <OpenStackBudgetsCard
          openStackCloudId={modelId}
          month={snapshot.month}
          currency={snapshot.currency}
          isPriced={isPriced}
        />
      </div>

      <div className="mb-6">
        <Card
          title={translationKey("What It Was Used On")}
          description={translationKey(
            "This month's vCPU-hours and memory-hours by flavor, and volume GB-hours by type.",
          )}
          buttons={[
            {
              title: isDetailOpen
                ? translationKey("Hide")
                : translationKey("Show"),
              buttonStyle: ButtonStyleType.OUTLINE,
              icon: isDetailOpen ? IconProp.ChevronUp : IconProp.ChevronDown,
              onClick: (): void => {
                setIsDetailOpen(!isDetailOpen);
              },
            },
          ]}
        >
          {isDetailOpen ? (
            <div data-testid="openstack-spend-detail">
              {isAgent ? (
                <p className="mb-4 text-sm text-gray-600">
                  {translator.translateText(OPENSTACK_SPEND_NO_SNAPSHOTS_TEXT)}
                </p>
              ) : (
                <></>
              )}
              <div className="overflow-x-auto">
                <table className={TABLE_CLASS_NAME}>
                  <thead>
                    <tr className={HEAD_CLASS_NAME}>
                      <th className={CELL_CLASS_NAME}>
                        {translator.translateText(translationKey("Flavor"))}
                      </th>
                      <th className={CELL_CLASS_NAME}>
                        {translator.translateText(
                          translationKey("Instance-Hours"),
                        )}
                      </th>
                      <th className={CELL_CLASS_NAME}>
                        {translator.translateText(translationKey("vCPU-Hours"))}
                      </th>
                      <th className={WIDE_CELL_CLASS_NAME}>
                        {translator.translateText(
                          translationKey("Memory GB-Hours"),
                        )}
                      </th>
                      <th className={CELL_CLASS_NAME}>
                        {translator.translateText(translationKey("Estimate"))}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.byFlavor.map(
                      (row: OpenStackSpendFlavorRow): ReactElement => {
                        return (
                          <tr
                            key={`${row.regionName || ""}/${row.flavorId || ""}`}
                            className={ROW_CLASS_NAME}
                            data-testid="openstack-spend-flavor"
                            data-flavor={row.name || row.flavorId || ""}
                          >
                            <td className={`${CELL_CLASS_NAME} break-all`}>
                              <bdi>
                                {row.name ||
                                  translator.translateText(
                                    translationKey(
                                      "A flavor this cloud no longer lists",
                                    ),
                                  )}
                              </bdi>
                            </td>
                            <td className={CELL_CLASS_NAME}>
                              {formatOpenStackUsageNumber(
                                row.instanceHours,
                                translator,
                              )}
                            </td>
                            <td className={CELL_CLASS_NAME}>
                              {formatOpenStackUsageNumber(
                                row.vcpuHours,
                                translator,
                              )}
                            </td>
                            <td className={WIDE_CELL_CLASS_NAME}>
                              {formatOpenStackUsageNumber(
                                row.memoryGbHours,
                                translator,
                              )}
                            </td>
                            <td className={CELL_CLASS_NAME}>
                              {money(row.amount)}
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 overflow-x-auto">
                <table className={TABLE_CLASS_NAME}>
                  <thead>
                    <tr className={HEAD_CLASS_NAME}>
                      <th className={CELL_CLASS_NAME}>
                        {translator.translateText(
                          translationKey("Volume Type"),
                        )}
                      </th>
                      <th className={CELL_CLASS_NAME}>
                        {translator.translateText(translationKey("GB-Hours"))}
                      </th>
                      <th className={CELL_CLASS_NAME}>
                        {translator.translateText(translationKey("Estimate"))}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.byVolumeType.map(
                      (row: OpenStackSpendVolumeTypeRow): ReactElement => {
                        return (
                          <tr
                            key={row.type}
                            className={ROW_CLASS_NAME}
                            data-testid="openstack-spend-volume-type"
                            data-type={row.type}
                          >
                            <td className={`${CELL_CLASS_NAME} break-all`}>
                              <bdi>
                                {row.type ||
                                  translator.translateText(
                                    translationKey("No type"),
                                  )}
                              </bdi>
                            </td>
                            <td className={CELL_CLASS_NAME}>
                              {formatOpenStackUsageNumber(
                                row.gbHours,
                                translator,
                              )}
                            </td>
                            <td className={CELL_CLASS_NAME}>
                              {money(row.amount)}
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <></>
          )}
        </Card>
      </div>

      {isPricesOpen ? (
        <OpenStackPriceListModal
          openStackCloudId={modelId}
          stored={spend.storedPriceList}
          flavorNames={flavorNames}
          volumeTypes={volumeTypes}
          onClose={() => {
            setIsPricesOpen(false);
          }}
          onSaved={() => {
            setIsPricesOpen(false);
            read.reload();
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default OpenStackCloudSpend;
