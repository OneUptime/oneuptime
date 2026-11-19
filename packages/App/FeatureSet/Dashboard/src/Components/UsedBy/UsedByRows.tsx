import {
  ROW_IS_OFF,
  SEE_ALL,
  getUsedByHiddenNote,
  getUsedByRelationTitle,
  getUsedByRowKindName,
  getUsedByRowName,
  getUsedByRowRoute,
} from "./UsedByWords";
import Route from "Common/Types/API/Route";
import {
  UsedByGroup,
  UsedByRelation,
  UsedByRow,
  UsedByRowKind,
  UsedBySummary,
  getUsedByGroupsInUse,
  getUsedByRowKindOfRow,
} from "Common/Types/UsedBy/UsedBy";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The rows of "Used by": each a link to the record that refers, by its
 * name as its own page shows it, with a quiet line under it of what more
 * the server says - the kind of record a family's row is ("Incident
 * On-Call Rule"), "Off" for a rule switched off or a monitor not checked,
 * and how it refers (a policy's escalation rules). A name is the project's
 * own words, in whatever script it was typed: it reads in its own
 * direction. A kind with no page of its own is its name, not a link.
 */

// The quiet line under a row's name: its kind, Off, its detail.
export function getUsedByRowFacts(
  row: UsedByRow,
  translator: Translator,
): Array<string> {
  const facts: Array<string> = [];

  if (row.rowKind) {
    facts.push(getUsedByRowKindName(row.rowKind, translator));
  }

  if (row.isOff) {
    facts.push(translator.translateText(ROW_IS_OFF) || ROW_IS_OFF);
  }

  if (row.detail) {
    facts.push(row.detail);
  }

  return facts;
}

export const UsedByRowList: FunctionComponent<{
  rows: Array<UsedByRow>;
  rowKind: UsedByRowKind;
  // The relation the rows are of: it may open them on a page of its own.
  relation?: UsedByRelation | undefined;
  testId?: string | undefined;
}> = (props: {
  rows: Array<UsedByRow>;
  rowKind: UsedByRowKind;
  relation?: UsedByRelation | undefined;
  testId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.rows.length === 0) {
    return <></>;
  }

  return (
    <ul className="space-y-1.5" data-testid={props.testId}>
      {props.rows.map((row: UsedByRow): ReactElement => {
        const route: Route | null = getUsedByRowRoute(
          getUsedByRowKindOfRow(row, props.rowKind),
          row.id,
          row.linkId,
          props.relation,
        );
        const name: ReactElement = (
          <span dir="auto">{getUsedByRowName(row, translator)}</span>
        );
        const facts: Array<string> = getUsedByRowFacts(row, translator);

        return (
          <li
            key={`${row.rowKind || props.rowKind}-${row.id}`}
            className="min-w-0 [overflow-wrap:anywhere]"
            data-testid="used-by-row"
            data-row-kind={getUsedByRowKindOfRow(row, props.rowKind)}
          >
            {route ? (
              <Link
                to={route}
                className="text-sm text-gray-900 hover:underline"
              >
                {name}
              </Link>
            ) : (
              <span
                className="text-sm text-gray-900"
                data-testid="used-by-row-name"
              >
                {name}
              </span>
            )}
            {facts.length > 0 ? (
              /*
               * The line keeps the page's side, under its name: only its
               * words read in their own direction. On the paragraph, a
               * rule named in Latin letters put the line on the left of a
               * Persian page, its name on the right.
               */
              <p
                className="text-xs text-gray-500"
                data-testid="used-by-row-detail"
              >
                <span dir="auto">{facts.join(" · ")}</span>
              </p>
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ul>
  );
};

/*
 * Every kind of record that refers to this one, in the kind's order: its
 * title and how many the reader may see, the first few as links, how many
 * more they may not see (never named), and "See all" when there are more
 * than it shows.
 */
const UsedByGroups: FunctionComponent<{
  summary: UsedBySummary;
  onSeeAll: (relation: UsedByRelation) => void;
}> = (props: {
  summary: UsedBySummary;
  onSeeAll: (relation: UsedByRelation) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const groups: Array<UsedByGroup> = getUsedByGroupsInUse(props.summary);

  return (
    <ul
      className="divide-y divide-gray-100"
      data-testid="used-by-groups"
      aria-label={translator.translateText("Used by")}
    >
      {groups.map((group: UsedByGroup): ReactElement => {
        const title: string = getUsedByRelationTitle(
          group.relation,
          translator,
        );
        const hiddenNote: string = getUsedByHiddenNote(group, translator);
        const hasMore: boolean = group.count > group.rows.length;

        return (
          <li
            key={group.relation}
            className="py-3 first:pt-0 last:pb-0"
            data-testid="used-by-group"
            data-relation={group.relation}
          >
            <div className="flex items-baseline justify-between gap-3">
              {/*
               * In the case it is written: in capitals "SLOs" read "SLOS".
               */}
              <h3 className="min-w-0 text-xs font-semibold text-gray-500 hyphens-auto [overflow-wrap:anywhere]">
                {title}
              </h3>
              <span
                className="shrink-0 text-sm font-semibold tabular-nums text-gray-900"
                data-testid="used-by-count"
              >
                {translator.formatNumber(group.count)}
              </span>
            </div>
            <div className="mt-1.5">
              <UsedByRowList
                rows={group.rows}
                rowKind={group.rowKind}
                relation={group.relation}
              />
            </div>
            {hiddenNote ? (
              <p
                className="mt-1 text-xs text-gray-500"
                data-testid="used-by-hidden"
              >
                {hiddenNote}
              </p>
            ) : (
              <></>
            )}
            {hasMore ? (
              <button
                type="button"
                className="mt-1.5 text-sm font-medium text-indigo-700 hover:underline"
                data-testid="used-by-see-all"
                onClick={() => {
                  props.onSeeAll(group.relation);
                }}
              >
                {translator.translateText(SEE_ALL)}
              </button>
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default UsedByGroups;
