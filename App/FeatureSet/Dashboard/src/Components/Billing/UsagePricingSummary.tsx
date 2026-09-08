import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  PRICING_PAGE_URL,
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
  formatPriceInUSD,
} from "Common/Types/Billing/PayAsYouGoPricing";
import URL from "Common/Types/API/URL";
import Link from "Common/UI/Components/Link/Link";
import React, { ReactElement } from "react";

const UsagePricingSummary: () => ReactElement = (): ReactElement => {
  return (
    <div className="space-y-2 text-sm text-gray-700">
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Active monitors:{" "}
          {formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH)} per monitor
          per month. Manual monitors are free.
        </li>
        <li>
          Logs, traces, metrics, profiles and security events:{" "}
          {formatPriceInUSD(TELEMETRY_PRICE_IN_USD_PER_GB)} per GB ingested.
        </li>
        <li>
          Session replay: {formatPriceInUSD(SESSION_REPLAY_PRICE_IN_USD_PER_GB)}{" "}
          per GB. These telemetry rates include{" "}
          {TELEMETRY_PRICE_RETENTION_IN_DAYS} day retention; longer retention
          costs more.
        </li>
      </ul>
      <p>
        Other paid features have their own rates. Review the{" "}
        <Link
          to={URL.fromString(PRICING_PAGE_URL)}
          openInNewTab={true}
          className="text-indigo-600 underline"
        >
          full pricing
        </Link>{" "}
        before enabling them.
      </p>
    </div>
  );
};

export default UsagePricingSummary;
