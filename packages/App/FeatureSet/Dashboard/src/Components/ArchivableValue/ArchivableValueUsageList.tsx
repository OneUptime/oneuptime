import { CAPPED_COUNT, USAGE_ITEM } from "./ArchivableValueCopy";
import { UsageGroup } from "./ArchivableValueUsageText";
import { ArchivableValueUsageItem } from "Common/Types/ArchivableValue/ArchivableValueUsage";
import { getListSeparator } from "Common/UI/Utils/ListSeparator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The kinds of records that use a value and how many of each - "Incidents
 * (12)", "Monitors (3)" - as the Archive and Delete dialogs list them: one
 * line of their own after a sentence that says what the list is.
 */

// "Incidents (12)", "Incidents (10,000+)": the kind in the reader's language.
export const getUsageItemText: (
  item: ArchivableValueUsageItem,
  translator: Translator,
) => string = (
  item: ArchivableValueUsageItem,
  translator: Translator,
): string => {
  const count: string = item.isCountCapped
    ? translator.translateTemplate(CAPPED_COUNT, {
        count: translator.formatNumber(item.count),
      })
    : translator.formatNumber(item.count);

  return translator.translateTemplate(USAGE_ITEM, {
    title: translator.translateText(item.title) || item.title,
    count: count,
  });
};

export interface UsageListProps {
  items: Array<ArchivableValueUsageItem>;
  dataTestId?: string | undefined;
}

// A plain list of kinds and counts.
export const UsageList: FunctionComponent<UsageListProps> = (
  props: UsageListProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul
      className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-gray-700"
      data-testid={props.dataTestId || "archivable-value-usage-list"}
    >
      {props.items.map((item: ArchivableValueUsageItem): ReactElement => {
        return (
          <li key={`${item.tableName}-${item.effect}`}>
            {getUsageItemText(item, translator)}
          </li>
        );
      })}
    </ul>
  );
};

export interface UsageGroupsProps {
  groups: Array<UsageGroup>;
  // A refused delete lists one group, with no label: the sentence says it.
  showLabels: boolean;
}

/*
 * The Delete dialog's list: what happens to each use, the gravest first -
 * "Deleted with it: Incident State Timelines (40)".
 */
export const UsageGroups: FunctionComponent<UsageGroupsProps> = (
  props: UsageGroupsProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul
      className="mt-2 space-y-1 text-sm text-gray-700"
      data-testid="archivable-value-delete-groups"
    >
      {props.groups.map((group: UsageGroup): ReactElement => {
        const texts: Array<string> = group.items.map(
          (item: ArchivableValueUsageItem): string => {
            return getUsageItemText(item, translator);
          },
        );
        const items: string = texts.join(getListSeparator(texts));

        return (
          <li
            key={group.effect}
            className="flex gap-2"
            data-testid={`archivable-value-delete-group-${group.effect}`}
          >
            <span aria-hidden="true" className="text-gray-400">
              •
            </span>
            <span>
              {props.showLabels ? (
                <span className="font-medium text-gray-900">
                  {translator.translateText(group.label)}:{" "}
                </span>
              ) : (
                <></>
              )}
              {items}
            </span>
          </li>
        );
      })}
    </ul>
  );
};
