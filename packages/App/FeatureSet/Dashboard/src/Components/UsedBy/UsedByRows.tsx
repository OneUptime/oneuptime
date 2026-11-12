import {
  SEE_ALL,
  getUsedByHiddenNote,
  getUsedByRelationTitle,
  getUsedByRowName,
  getUsedByRowRoute,
} from "./UsedByWords";
import {
  UsedByGroup,
  UsedByRelation,
  UsedByRow,
  UsedByRowKind,
  UsedBySummary,
  getUsedByGroupsInUse,
} from "Common/Types/UsedBy/UsedBy";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The rows of "Used by": each a link to the record that refers, by its
 * name as its own page shows it, with how it refers under it when the
 * server says (a policy's escalation rules). A name is the project's own
 * words, in whatever script it was typed: it reads in its own direction.
 */

export const UsedByRowList: FunctionComponent<{
  rows: Array<UsedByRow>;
  rowKind: UsedByRowKind;
  testId?: string | undefined;
}> = (props: {
  rows: Array<UsedByRow>;
  rowKind: UsedByRowKind;
  testId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.rows.length === 0) {
    return <></>;
  }

  return (
    <ul className="space-y-1.5" data-testid={props.testId}>
      {props.rows.map((row: UsedByRow): ReactElement => {
        return (
          <li
            key={row.id}
            className="min-w-0 [overflow-wrap:anywhere]"
            data-testid="used-by-row"
          >
            <Link
              to={getUsedByRowRoute(props.rowKind, row.id)}
              className="text-sm text-gray-900 hover:underline"
            >
              <span dir="auto">{getUsedByRowName(row, translator)}</span>
            </Link>
            {row.detail ? (
              <p
                className="text-xs text-gray-500"
                dir="auto"
                data-testid="used-by-row-detail"
              >
                {row.detail}
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
              <UsedByRowList rows={group.rows} rowKind={group.rowKind} />
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
