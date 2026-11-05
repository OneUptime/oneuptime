import OpenStackProjectUsage from "Common/Models/DatabaseModels/OpenStackProjectUsage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_COST_LINE_TITLES,
  OPENSTACK_COST_LINE_UNITS,
  OpenStackCostLine,
  OpenStackUsageCost,
  getOpenStackUsageCost,
  readOpenStackPriceList,
} from "Common/Types/OpenStack/OpenStackPriceList";
import { readOpenStackUsageQuantities } from "Common/Types/OpenStack/OpenStackProjectUsage";
import { OpenStackCostSource } from "Common/Types/OpenStack/OpenStackSpendSnapshot";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import useOpenStackRead, { OpenStackRead } from "./Part/UseOpenStackRead";
import OpenStackDailyUsageChart from "./OpenStackDailyUsageChart";
import {
  formatOpenStackSpendMoney,
  formatOpenStackUsageNumber,
  getOpenStackDailyVcpuHours,
} from "../../Pages/OpenStack/Utils/OpenStackSpendView";

/*
 * ONE PROJECT'S USAGE OVER TIME, on its own page: this month line by line, and the months before it.
 * Thirteen rows at most, read when someone opens this project. Nothing's shown until something's been
 * counted, because a project that's used nothing has nothing to say here.
 */

const MONTHS_READ: number = 13;
const TABLE_CLASS_NAME: string = "min-w-full text-start text-sm";
const HEAD_CLASS_NAME: string =
  "border-b border-gray-200 text-xs font-medium uppercase tracking-wide text-gray-500";
const CELL_CLASS_NAME: string = "py-2 pe-4 text-start align-top";
const WIDE_CELL_CLASS_NAME: string = `${CELL_CLASS_NAME} max-md:hidden md:table-cell`;
const ROW_CLASS_NAME: string = "border-b border-gray-100 last:border-0";

interface ProjectUsageRead {
  months: Array<OpenStackProjectUsage>;
  days: Array<{ day: string; vcpuHours: number }>;
  cost: OpenStackUsageCost | null;
  currency: string | null;
}

export interface ComponentProps {
  openStackCloudId: ObjectID;
  openStackProjectId: string;
}

const OpenStackProjectUsageCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const read: OpenStackRead<ProjectUsageRead> =
    useOpenStackRead<ProjectUsageRead>(async () => {
      const rows: ListResult<OpenStackProjectUsage> =
        await ModelAPI.getList<OpenStackProjectUsage>({
          modelType: OpenStackProjectUsage,
          query: {
            openStackCloudId: props.openStackCloudId,
            openStackProjectId: props.openStackProjectId,
          },
          select: {
            period: true,
            quantities: true,
            vcpuHours: true,
            memoryGbHours: true,
            volumeGbHours: true,
            floatingIpHours: true,
            estimatedCost: true,
            costSource: true,
          },
          sort: { period: SortOrder.Descending },
          skip: 0,
          // Days hold the same project too, and there can be 62 of them between two months.
          limit: MONTHS_READ + 62,
        });
      const cloud: OpenStackCloud | null =
        await ModelAPI.getItem<OpenStackCloud>({
          modelType: OpenStackCloud,
          id: props.openStackCloudId,
          select: { priceList: true },
        });
      const months: Array<OpenStackProjectUsage> = rows.data
        .filter((row: OpenStackProjectUsage): boolean => {
          return (row.period || "").length === 7;
        })
        .slice(0, MONTHS_READ);
      const latest: OpenStackProjectUsage | undefined = months[0];
      const priceList: ReturnType<typeof readOpenStackPriceList> =
        readOpenStackPriceList(cloud?.priceList);

      return {
        months,
        days: getOpenStackDailyVcpuHours(rows.data),
        currency: priceList?.currency ?? null,
        cost: latest
          ? getOpenStackUsageCost({
              quantities: readOpenStackUsageQuantities(latest.quantities),
              priceList:
                latest.costSource === OpenStackCostSource.CloudKitty
                  ? null
                  : priceList,
            })
          : null,
      };
    }, [props.openStackCloudId.toString(), props.openStackProjectId]);

  if (read.isLoading && !read.data) {
    return <ComponentLoader />;
  }

  const data: ProjectUsageRead | null = read.data;

  if (!data || data.months.length === 0) {
    return <></>;
  }

  const money: (amount: number | null | undefined) => string = (
    amount: number | null | undefined,
  ): string => {
    return formatOpenStackSpendMoney({
      amount,
      currency: data.currency,
      translator,
    });
  };

  return (
    <div className="mt-6" data-testid="openstack-project-usage">
      <Card
        title={translationKey("Usage")}
        description={translationKey(
          "What this project has used, worked out from the cloud's inventory. Any cost is an estimate, not a bill.",
        )}
      >
        {data.cost && data.cost.lines.length > 0 ? (
          <div className="overflow-x-auto">
            <table className={TABLE_CLASS_NAME}>
              <thead>
                <tr className={HEAD_CLASS_NAME}>
                  <th className={CELL_CLASS_NAME}>
                    {translator.translateText(translationKey("This month"))}
                  </th>
                  <th className={CELL_CLASS_NAME}>
                    {translator.translateText(translationKey("Used"))}
                  </th>
                  <th className={CELL_CLASS_NAME}>
                    {translator.translateText(translationKey("Estimate"))}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.cost.lines.map(
                  (line: OpenStackCostLine, index: number): ReactElement => {
                    return (
                      <tr
                        key={`${line.kind}/${line.name || ""}/${index}`}
                        className={ROW_CLASS_NAME}
                        data-testid="openstack-project-usage-line"
                      >
                        <td className={CELL_CLASS_NAME}>
                          {translator.translateText(
                            OPENSTACK_COST_LINE_TITLES[line.kind],
                          )}
                          {line.name ? (
                            <span className="ms-1 text-gray-500">
                              <bdi>{line.name}</bdi>
                            </span>
                          ) : (
                            <></>
                          )}
                        </td>
                        <td className={CELL_CLASS_NAME}>
                          {formatOpenStackUsageNumber(
                            line.quantity,
                            translator,
                          )}{" "}
                          {OPENSTACK_COST_LINE_UNITS[line.kind]}
                        </td>
                        <td className={CELL_CLASS_NAME}>
                          {money(line.amount)}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <></>
        )}
        {data.days.length > 0 ? (
          <div className="mt-6">
            <OpenStackDailyUsageChart
              testId="openstack-project-usage-days"
              days={data.days}
            />
          </div>
        ) : (
          <></>
        )}
        <div className="mt-6 overflow-x-auto">
          <table className={TABLE_CLASS_NAME}>
            <thead>
              <tr className={HEAD_CLASS_NAME}>
                <th className={CELL_CLASS_NAME}>
                  {translator.translateText(translationKey("Month"))}
                </th>
                <th className={CELL_CLASS_NAME}>
                  {translator.translateText(translationKey("vCPU-hours"))}
                </th>
                <th className={WIDE_CELL_CLASS_NAME}>
                  {translator.translateText(translationKey("Memory GB-hours"))}
                </th>
                <th className={WIDE_CELL_CLASS_NAME}>
                  {translator.translateText(translationKey("Volume GB-hours"))}
                </th>
                <th className={CELL_CLASS_NAME}>
                  {translator.translateText(translationKey("Estimate"))}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((row: OpenStackProjectUsage): ReactElement => {
                return (
                  <tr
                    key={row.period}
                    className={ROW_CLASS_NAME}
                    data-testid="openstack-project-usage-month"
                  >
                    <td className={CELL_CLASS_NAME}>{row.period}</td>
                    <td className={CELL_CLASS_NAME}>
                      {formatOpenStackUsageNumber(row.vcpuHours, translator)}
                    </td>
                    <td className={WIDE_CELL_CLASS_NAME}>
                      {formatOpenStackUsageNumber(
                        row.memoryGbHours,
                        translator,
                      )}
                    </td>
                    <td className={WIDE_CELL_CLASS_NAME}>
                      {formatOpenStackUsageNumber(
                        row.volumeGbHours,
                        translator,
                      )}
                    </td>
                    <td className={CELL_CLASS_NAME}>
                      {money(row.estimatedCost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default OpenStackProjectUsageCard;
