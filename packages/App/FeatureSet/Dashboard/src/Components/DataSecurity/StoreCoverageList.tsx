import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { BILLING_ENABLED } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  DataStoreCoverageItem,
  getDataStoreCoverage,
} from "Common/Utils/DataSecurity/DataStoreCoverage";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT ONEUPTIME CHECKS ON A STORE OF THIS KIND, AND WHAT IT CANNOT
 * (#11140), as a short list: a green tick for what is checked, with how; a
 * grey mark for what is not, with why - grey, never red, as nothing broke.
 * Drawn under the Kind of a store being added, and on its Settings, from
 * one list (Common/Utils/DataSecurity/DataStoreCoverage), so a person
 * knows before setting a store up what it will and will not tell them.
 */

export interface ComponentProps {
  kind: string | undefined | null;
  isScannedFromProbe?: boolean | undefined;
  // OneUptime Cloud, whose servers reach a store over the internet. The build's own unless said.
  isOneUptimeCloud?: boolean | undefined;
}

const StoreCoverageList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const items: Array<DataStoreCoverageItem> = getDataStoreCoverage({
    kind: props.kind,
    isScannedFromProbe: props.isScannedFromProbe,
    isOneUptimeCloud:
      props.isOneUptimeCloud === undefined
        ? BILLING_ENABLED
        : props.isOneUptimeCloud,
  });

  if (items.length === 0) {
    return <></>;
  }

  return (
    <ul className="space-y-2.5" data-testid="data-store-coverage">
      {items.map((item: DataStoreCoverageItem): ReactElement => {
        return (
          <li
            key={item.key}
            className="flex items-start gap-2.5"
            data-testid={`data-store-coverage-${item.key}`}
            data-checked={item.isChecked ? "true" : "false"}
          >
            <Icon
              icon={item.isChecked ? IconProp.CheckCircle : IconProp.NoSymbol}
              className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                item.isChecked ? "text-emerald-500" : "text-gray-400"
              }`}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(item.label)}
              </p>
              <p className="text-sm text-gray-600">
                {translator.translateText(item.detail)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default StoreCoverageList;
