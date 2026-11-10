import { hasAlertCount } from "./OverviewAttention";
import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Whether anyone is told when a database's tables break: how many of its
 * monitors are on - its recommended alerts, or ones made like them - or
 * that none is, so nobody is. A database not watched needs none, and a
 * server that does not say shows nothing rather than a guess.
 */

export const STORE_ALERT_STATUS_TEST_ID: string =
  "data-observability-store-alert-status";

export interface ComponentProps {
  store: DataObservabilityStoreSummary;
}

// Whether a watched database has no alert on, so nobody hears of its tables.
export function isStoreWithoutAlerts(
  store: DataObservabilityStoreSummary,
): boolean {
  return (
    store.isTableHealthEnabled &&
    hasAlertCount(store) &&
    store.alertMonitorCount === 0
  );
}

const StoreAlertStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.store.isTableHealthEnabled || !hasAlertCount(props.store)) {
    return <></>;
  }

  if (props.store.alertMonitorCount === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"
        data-testid={STORE_ALERT_STATUS_TEST_ID}
        data-alerts="none"
      >
        <Icon icon={IconProp.BellSlash} className="h-3.5 w-3.5" />
        <span>{translator.translateText("No alerts on")}</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-gray-600"
      data-testid={STORE_ALERT_STATUS_TEST_ID}
      data-alerts="on"
    >
      <Icon icon={IconProp.Bell} className="h-3.5 w-3.5 text-emerald-600" />
      <span>
        {translator.translatePlural(
          { one: "{{count}} alert on", other: "{{count}} alerts on" },
          props.store.alertMonitorCount,
        )}
      </span>
    </span>
  );
};

export default StoreAlertStatus;
