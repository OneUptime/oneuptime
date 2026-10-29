import {
  formatMonth,
  formatUSD,
  getMonthTotalInUSD,
  parseMarketplaceUsage,
} from "./MarketplaceUsage";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import {
  MARKETPLACE_USAGE_ROUTE,
  MarketplaceUsageMonth,
  MarketplaceUsageSummary,
} from "Common/Types/Marketplace/MarketplaceUsageSummary";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * On the Billing page of a project a cloud marketplace bills: what its
 * marketplace charges of the last three months were made of. The
 * marketplace's own bill shows one line - usage units of $0.01 - and this
 * says which users, active monitors, telemetry and balance top-ups they were
 * (GET /marketplace/usage, read by whoever reads the project's usage).
 */
export interface ComponentProps {
  marketplace: CloudMarketplace;
}

// The usage table's columns, in order, as their widths are remembered.
const MARKETPLACE_USAGE_COLUMN_IDS: Array<string> = [
  "month",
  "users",
  "activeMonitors",
  "telemetry",
  "smsAndCallBalance",
  "aiCredits",
  "total",
];

const MarketplaceUsageCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { i18n } = useTranslation();

  const [summary, setSummary] = useState<MarketplaceUsageSummary | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /*
   * The months' columns as wide as a person makes them (Common's
   * Table/ColumnResize): a month or an amount is never cut short.
   */
  const usageColumns: ResizableColumns = useResizableColumns({
    tableKey: "marketplace-usage-table",
    columns: MARKETPLACE_USAGE_COLUMN_IDS.map(
      (id: string, index: number): { id: string; cellNumber: number } => {
        return { id: id, cellNumber: index + 1 };
      },
    ),
  });

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              MARKETPLACE_USAGE_ROUTE,
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (!isCurrent) {
          return;
        }

        if (response instanceof HTTPErrorResponse || response.isFailure()) {
          setError(API.getFriendlyMessage(response));
        } else {
          setSummary(parseMarketplaceUsage(response.data));
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return (): void => {
      isCurrent = false;
    };
  }, []);

  const marketplaceName: string = CloudMarketplaceUtil.getDisplayName(
    props.marketplace,
  );

  const months: Array<MarketplaceUsageMonth> = summary?.months || [];
  const unit: number = summary?.usageUnitInUSD || 0.01;
  const hasCharges: boolean = months.some(
    (month: MarketplaceUsageMonth): boolean => {
      return month.billedUnits + month.pendingUnits > 0;
    },
  );

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!hasCharges) {
      return (
        <p
          className="text-sm text-gray-500"
          data-testid="marketplace-usage-empty"
        >
          {translator.translateTemplate(
            "Nothing has been billed through {{marketplace}} yet.",
            { marketplace: marketplaceName },
          )}
        </p>
      );
    }

    const headers: Array<string> = [
      translator.translateText("Month") || "Month",
      translator.translateText("Users") || "Users",
      translator.translateText("Active Monitors") || "Active Monitors",
      translator.translateText("Telemetry") || "Telemetry",
      translator.translateText("SMS and Call Balance") ||
        "SMS and Call Balance",
      translator.translateText("AI Credits") || "AI Credits",
      translator.translateText("Total") || "Total",
    ];

    return (
      <div className="overflow-x-auto">
        {usageColumns.styles}
        <table
          className={`${usageColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-sm`}
          data-testid="marketplace-usage-table"
          {...usageColumns.tableAttributes}
        >
          <thead>
            <tr>
              {headers.map((header: string, index: number) => {
                return (
                  <ResizableHeaderCell
                    key={header}
                    scope="col"
                    className={`py-2 px-3 font-medium text-gray-900 ${index === 0 ? "text-start" : "text-end"}`}
                    resize={usageColumns.getResize(
                      MARKETPLACE_USAGE_COLUMN_IDS[index] || `column-${index}`,
                      header,
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{header}</span>
                  </ResizableHeaderCell>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {months.map((month: MarketplaceUsageMonth) => {
              const pendingInUSD: number =
                Math.round(month.pendingUnits * unit * 100) / 100;

              return (
                <tr key={month.month} data-testid="marketplace-usage-month">
                  <td className="py-2 px-3 text-gray-900 whitespace-nowrap">
                    {formatMonth(month.month, i18n.language)}
                  </td>
                  <td className="py-2 px-3 text-end text-gray-700">
                    {formatUSD(month.usersInUSD)}
                  </td>
                  <td className="py-2 px-3 text-end text-gray-700">
                    {formatUSD(month.activeMonitorsInUSD)}
                  </td>
                  <td className="py-2 px-3 text-end text-gray-700">
                    {formatUSD(month.telemetryInUSD)}
                  </td>
                  <td className="py-2 px-3 text-end text-gray-700">
                    {formatUSD(month.smsOrCallBalanceInUSD)}
                  </td>
                  <td className="py-2 px-3 text-end text-gray-700">
                    {formatUSD(month.aiBalanceInUSD)}
                  </td>
                  <td className="py-2 px-3 text-end font-medium text-gray-900">
                    <div>{formatUSD(getMonthTotalInUSD(month, unit))}</div>
                    {pendingInUSD > 0 ? (
                      <div className="text-xs font-normal text-gray-500">
                        {translator.translateTemplate(
                          "{{amount}} not confirmed yet",
                          { amount: formatUSD(pendingInUSD) },
                        )}
                      </div>
                    ) : (
                      <></>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-gray-500">
          {translator.translateText(
            "Each item is before the hour's charges were rounded to whole usage units, so the items can differ from the total by a cent.",
          )}
        </p>
      </div>
    );
  };

  return (
    <Card
      title="Marketplace Usage"
      description={translator.translateTemplate(
        "What this project's {{marketplace}} bill was made of. {{marketplace}} shows these charges as usage units of $0.01 each.",
        { marketplace: marketplaceName },
      )}
    >
      {getBody()}
    </Card>
  );
};

export default MarketplaceUsageCard;
