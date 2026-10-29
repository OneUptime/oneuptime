import {
  CAPPED_COUNT,
  PERSONAL_USAGE_ITEMS,
  PERSONAL_USAGE_ITEM_FALLBACK,
  PERSONAL_USAGE_NOTES,
  PERSONAL_USAGE_NOTE_FALLBACK,
  PersonalUsageNote as PersonalUsageNoteCopy,
  USAGE_ITEM,
} from "./ArchivableValueCopy";
import { UsageGroup } from "./ArchivableValueUsageText";
import Route from "Common/Types/API/Route";
import {
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
} from "Common/Types/ArchivableValue/ArchivableValueUsage";
import { ArchivableValueType } from "Common/Utils/ArchivableValues";
import { getSentenceSeparator } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import Link from "Common/UI/Components/Link/Link";
import { getListSeparator } from "Common/UI/Utils/ListSeparator";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The kinds of records that use a value and how many of each - "Incidents
 * (12)", "Monitors (3)" - as the Archive and Delete dialogs list them: one
 * line of their own after a sentence that says what the list is. People's
 * own settings are said as whose they are: "On-call rules of 11 people".
 */

// "12", or the count the server stopped at, "10,000+", in the reader's digits.
const getCountText: (
  item: ArchivableValueUsageItem,
  translator: Translator,
) => string = (
  item: ArchivableValueUsageItem,
  translator: Translator,
): string => {
  return item.isCountCapped
    ? translator.translateTemplate(CAPPED_COUNT, {
        count: translator.formatNumber(item.count),
      })
    : translator.formatNumber(item.count);
};

// "Incidents (12)", "On-call rules of 11 people": the kind in the reader's language.
export const getUsageItemText: (
  item: ArchivableValueUsageItem,
  translator: Translator,
) => string = (
  item: ArchivableValueUsageItem,
  translator: Translator,
): string => {
  const count: string = getCountText(item, translator);

  if (item.kind === ArchivableValueUsageKind.Personal) {
    const template: PluralTemplate =
      PERSONAL_USAGE_ITEMS[item.tableName] || PERSONAL_USAGE_ITEM_FALLBACK;

    return translator.translatePlural(template, item.count, { count: count });
  }

  return translator.translateTemplate(USAGE_ITEM, {
    title: translator.translateText(item.title) || item.title,
    count: count,
  });
};

/*
 * The Archive dialog's words for people's own settings that name a value
 * of `type`: what stays, and the link to the reader's own.
 */
export const getPersonalUsageNote: (
  type: ArchivableValueType,
  item: ArchivableValueUsageItem,
) => { sentence: PluralTemplate; linkText?: string | undefined } = (
  type: ArchivableValueType,
  item: ArchivableValueUsageItem,
): { sentence: PluralTemplate; linkText?: string | undefined } => {
  const note: PersonalUsageNoteCopy | undefined =
    PERSONAL_USAGE_NOTES[`${type}:${item.tableName}`];

  if (!note) {
    return { sentence: PERSONAL_USAGE_NOTE_FALLBACK };
  }

  return { sentence: note.sentence, linkText: note.linkText };
};

export interface UsageListProps {
  items: Array<ArchivableValueUsageItem>;
  dataTestId?: string | undefined;
}

/*
 * One line of a list, with the dot both lists draw: the Archive dialog's
 * plain list and the Delete dialog's grouped one read as the same kind of
 * list.
 */
const UsageLine: FunctionComponent<{
  children: ReactElement | string;
  dataTestId?: string | undefined;
}> = (props: {
  children: ReactElement | string;
  dataTestId?: string | undefined;
}): ReactElement => {
  return (
    <li className="flex gap-2" data-testid={props.dataTestId}>
      <span aria-hidden="true" className="text-gray-400">
        •
      </span>
      <span className="min-w-0">{props.children}</span>
    </li>
  );
};

// A plain list of kinds and counts.
export const UsageList: FunctionComponent<UsageListProps> = (
  props: UsageListProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul
      className="mt-2 space-y-1 text-sm text-gray-700"
      data-testid={props.dataTestId || "archivable-value-usage-list"}
    >
      {props.items.map((item: ArchivableValueUsageItem): ReactElement => {
        return (
          <UsageLine key={`${item.tableName}-${item.effect}`}>
            {getUsageItemText(item, translator)}
          </UsageLine>
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
          <UsageLine
            key={group.effect}
            dataTestId={`archivable-value-delete-group-${group.effect}`}
          >
            <>
              {props.showLabels ? (
                <span className="font-medium text-gray-900">
                  {translator.translateText(group.label)}:{" "}
                </span>
              ) : (
                <></>
              )}
              {items}
            </>
          </UsageLine>
        );
      })}
    </ul>
  );
};

export interface PersonalUsageNotesProps {
  type: ArchivableValueType;
  people: Array<ArchivableValueUsageItem>;
  /*
   * Where the reader sees their own settings of a table, when the product
   * has a page for them ("See your on-call rules").
   */
  getOwnSettingsRoute?: ((tableName: string) => Route | null) | undefined;
}

/*
 * The Archive dialog's paragraph about people's own settings that name the
 * value - "11 people have on-call rules for this severity. They stay as they
 * are, so incidents with it still page them. See your on-call rules" - one
 * per table, after the settings that keep using it. Nothing for none.
 */
export const PersonalUsageNotes: FunctionComponent<PersonalUsageNotesProps> = (
  props: PersonalUsageNotesProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.people.length === 0) {
    return <></>;
  }

  return (
    <div className="mt-3 space-y-2" data-testid="archivable-value-people">
      {props.people.map((item: ArchivableValueUsageItem): ReactElement => {
        const note: {
          sentence: PluralTemplate;
          linkText?: string | undefined;
        } = getPersonalUsageNote(props.type, item);
        const route: Route | null =
          note.linkText && props.getOwnSettingsRoute
            ? props.getOwnSettingsRoute(item.tableName)
            : null;
        const sentence: string = translator.translatePlural(
          note.sentence,
          item.count,
          { count: getCountText(item, translator) },
        );

        return (
          <p
            key={item.tableName}
            className="text-sm leading-6 text-gray-700"
            data-testid={`archivable-value-people-${item.tableName}`}
          >
            {sentence}
            {route && note.linkText ? (
              <>
                {/* No space after a full-width stop (Chinese, Japanese). */}
                {getSentenceSeparator(sentence)}
                <Link
                  to={route}
                  className="font-medium text-indigo-600 hover:underline"
                  dataTestId={`archivable-value-people-link-${item.tableName}`}
                >
                  {translator.translateText(note.linkText)}
                </Link>
              </>
            ) : (
              <></>
            )}
          </p>
        );
      })}
    </div>
  );
};
