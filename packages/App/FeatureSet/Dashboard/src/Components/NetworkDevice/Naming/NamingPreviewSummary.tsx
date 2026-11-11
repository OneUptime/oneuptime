import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DeviceNamingOutcome,
  DeviceNamingPreview,
  DeviceNamingPreviewItem,
} from "Common/Types/NetworkDevice/DeviceNaming";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { isNamingProblem } from "./DeviceNamingCopy";

/*
 * One line above an import's hosts, when the project has naming rules
 * (issue #6619): how many of the selected hosts the rules name, and how many
 * a rule matched but could not name yet - each of those says why under its
 * own name. A link to the rules, for whoever wants to change them first.
 */

export interface NamingPreviewCounts {
  named: number;
  problems: number;
}

export function countNamingPreview(
  preview: DeviceNamingPreview | null,
): NamingPreviewCounts {
  const counts: NamingPreviewCounts = { named: 0, problems: 0 };

  for (const item of preview?.items || []) {
    if (item.outcome === DeviceNamingOutcome.Named) {
      counts.named++;
    } else if (isNamingProblem(item as DeviceNamingPreviewItem)) {
      counts.problems++;
    }
  }

  return counts;
}

const NamingPreviewSummary: FunctionComponent<{
  preview: DeviceNamingPreview | null;
  hostCount: number;
}> = (props: {
  preview: DeviceNamingPreview | null;
  hostCount: number;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.preview?.hasRules || props.hostCount === 0) {
    return <></>;
  }

  const counts: NamingPreviewCounts = countNamingPreview(props.preview);

  if (counts.named === 0 && counts.problems === 0) {
    return <></>;
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="naming-preview-summary"
    >
      <div className="flex items-start gap-3">
        <Icon
          icon={IconProp.Pencil}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600"
        />
        <p className="text-sm text-gray-700">
          {translator.translatePlural(
            {
              one: "Your naming rules name {{named}} of the {{count}} selected host. Each keeps the name discovery found as its discovered name.",
              other:
                "Your naming rules name {{named}} of the {{count}} selected hosts. Each keeps the name discovery found as its discovered name.",
            },
            props.hostCount,
            {
              named: translator.formatNumber(counts.named),
              count: translator.formatNumber(props.hostCount),
            },
          )}
          {counts.problems > 0 && (
            <span className="text-amber-700">
              {" "}
              {translator.translatePlural(
                {
                  one: "{{count}} cannot be named yet: see the note under it.",
                  other:
                    "{{count}} cannot be named yet: see the note under each.",
                },
                counts.problems,
                { count: translator.formatNumber(counts.problems) },
              )}
            </span>
          )}
        </p>
      </div>
      <Link
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_NAMING_RULES] as Route,
        )}
        openInNewTab={true}
        className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:text-indigo-700"
      >
        {translator.translateText("Naming rules")}
      </Link>
    </div>
  );
};

export default NamingPreviewSummary;

// How many renames the compact list shows before "and N more".
export const NAMING_PREVIEW_LIST_LIMIT: number = 6;

/*
 * The first few names an import gives, "dmb-5 → UN1216DRTPLR02", for a
 * dialog that lists its devices in a sentence rather than a table (Add to
 * Monitoring from the Discovered Devices list).
 */
export const NamingPreviewList: FunctionComponent<{
  preview: DeviceNamingPreview | null;
}> = (props: { preview: DeviceNamingPreview | null }): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.preview?.hasRules) {
    return <></>;
  }

  const named: Array<DeviceNamingPreviewItem> = props.preview.items.filter(
    (item: DeviceNamingPreviewItem): boolean => {
      return item.outcome === DeviceNamingOutcome.Named && Boolean(item.name);
    },
  );

  if (named.length === 0) {
    return <></>;
  }

  return (
    <ul
      className="mt-2 space-y-1 rounded-lg border border-gray-200 bg-white px-3 py-2"
      data-testid="naming-preview-list"
    >
      {named
        .slice(0, NAMING_PREVIEW_LIST_LIMIT)
        .map((item: DeviceNamingPreviewItem): ReactElement => {
          return (
            <li
              key={item.key}
              className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm"
            >
              <span dir="auto" className="truncate text-gray-500">
                {item.discoveredName}
              </span>
              <Icon
                icon={IconProp.ArrowRight}
                className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
              />
              <span
                dir="ltr"
                className="truncate font-mono font-medium text-indigo-700"
              >
                {item.name}
              </span>
            </li>
          );
        })}
      {named.length > NAMING_PREVIEW_LIST_LIMIT && (
        <li className="text-xs text-gray-500">
          {translator.translateTemplate("and {{count}} more", {
            count: translator.formatNumber(
              named.length - NAMING_PREVIEW_LIST_LIMIT,
            ),
          })}
        </li>
      )}
    </ul>
  );
};
