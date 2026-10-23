import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import {
  AssetFactDifference,
  AssetFactSource,
} from "Common/Utils/Inventory/AssetFactSource";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import {
  getAssetFactDifferenceLine,
  getAssetFactSourceLine,
} from "./AssetFactSourceText";

/*
 * One asset detail's value, where it came from, and - when a value saved on
 * the device disagrees with what discovery read - what discovery read
 * (OneUptime issue #5185):
 *
 *   core-sw-01
 *   Discovery scan Office LAN (SNMP) · 2 hours ago
 *
 *   00-1B-54-C2-7A-01
 *   Saved on this device
 *   (!) ARP table of core-rtr-01 says 00-1B-54-C2-7A-02 · 3 hours ago
 *
 * The source is one quiet line under the value, the exact time on hover; the
 * disagreement is amber, because it is the one thing here someone may want
 * to act on. Shared by Inventory's Asset Details card and the network
 * device's own Overview, so a detail reads the same on both.
 */

export interface ComponentProps {
  value: string;
  source?: AssetFactSource | undefined;
  discoveredDifferent?: AssetFactDifference | undefined;
  // Offers a copy button, named for the detail ("Copy Hostname").
  copyLabel?: string | undefined;
  // Leaves the source line out, for a card that states it once.
  hideSource?: boolean | undefined;
  testId?: string | undefined;
}

function exactTime(readAt: string | undefined): string | undefined {
  if (!readAt) {
    return undefined;
  }

  const date: Date = new Date(readAt);

  return Number.isNaN(date.getTime())
    ? undefined
    : OneUptimeDate.getDateAsLocalFormattedString(date);
}

const AssetFactValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="min-w-0" data-testid={props.testId}>
      <div className="flex min-w-0 items-start gap-x-2 text-sm text-gray-900">
        <span className="min-w-0 whitespace-pre-line break-words">
          {props.value}
        </span>
        {props.copyLabel ? (
          <CopyTextButton
            textToBeCopied={props.value}
            iconOnly={true}
            title={translator.translateTemplate("Copy {{name}}", {
              name: props.copyLabel,
            })}
          />
        ) : null}
      </div>
      {props.source && !props.hideSource ? (
        <div
          className="mt-0.5 break-words text-xs text-gray-500"
          title={exactTime(props.source.readAt)}
          data-testid={props.testId ? `${props.testId}-source` : undefined}
        >
          {getAssetFactSourceLine(props.source, translator)}
        </div>
      ) : null}
      {props.discoveredDifferent ? (
        <div
          className="mt-1 flex min-w-0 items-start gap-x-1 text-xs text-amber-700"
          title={exactTime(props.discoveredDifferent.source.readAt)}
          data-testid={props.testId ? `${props.testId}-different` : undefined}
        >
          <Icon
            icon={IconProp.ExclaimationCircle}
            size={SizeProp.Smaller}
            className="mt-px h-3.5 w-3.5 flex-none"
          />
          <span className="min-w-0 break-words">
            {getAssetFactDifferenceLine(props.discoveredDifferent, translator)}
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default AssetFactValue;
