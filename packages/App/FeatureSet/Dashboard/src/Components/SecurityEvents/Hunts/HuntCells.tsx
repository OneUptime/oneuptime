import {
  COULD_NOT_RUN,
  FILTER_COUNT,
  FOUND_EVENT_COUNT,
  HUNTS_TEST_IDS,
  NEXT_RUN,
  NOTHING_FOUND_YET,
  NOT_RUN_YET,
  SCHEDULE_LABELS,
  TELLS,
  TELLS_AND_MORE,
  TELLS_NOBODY,
} from "./HuntsCopy";
import {
  HuntRecipientsLine,
  HuntRunState,
  getHuntRecipientsLine,
  getHuntRunState,
} from "./HuntsModel";
import RelativeTime from "../../EpisodeView/RelativeTime";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import {
  SecurityHuntSchedule,
  countSecurityHuntFilterValues,
  isScheduledSecurityHunt,
  readSecurityHuntFilters,
} from "Common/Types/SecurityEvent/SecurityHunt";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { useAreTableColumnsFolded } from "Common/UI/Components/Table/TableCellContext";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { getListSeparator } from "Common/UI/Utils/ListSeparator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface HuntCellProps {
  hunt: SecurityHunt;
}

// The names of who a hunt tells, as its row lists them: people, then teams.
export function getHuntRecipientNames(hunt: SecurityHunt): Array<string> {
  return [
    ...(hunt.notifyUsers || []).map((user: User): string => {
      return user.name?.toString() || user.email?.toString() || "";
    }),
    ...(hunt.notifyTeams || []).map((team: Team): string => {
      return team.name || "";
    }),
  ];
}

/*
 * A hunt's search on one line, as written - the mono type, never looked up
 * as words - and how many filters it keeps beside it. A hunt saved from a
 * sidebar click alone is its filters.
 */
export const HuntSearchLine: FunctionComponent<{
  searchQuery: string | undefined | null;
  filters: unknown;
}> = (props: {
  searchQuery: string | undefined | null;
  filters: unknown;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const search: string = (props.searchQuery || "").trim();
  const filterCount: number = countSecurityHuntFilterValues(
    readSecurityHuntFilters(props.filters),
  );
  const filters: string =
    filterCount > 0
      ? translator.translatePlural(FILTER_COUNT, filterCount)
      : "";

  return (
    <span
      className="flex min-w-0 items-baseline gap-1.5 text-xs text-gray-600"
      data-testid={HUNTS_TEST_IDS.searchLine}
    >
      {search ? (
        <code
          className="min-w-0 truncate font-mono text-xs text-gray-700"
          dir="ltr"
          title={search}
        >
          {search}
        </code>
      ) : (
        <></>
      )}
      {filters ? (
        <span className="shrink-0 whitespace-nowrap text-gray-500">
          {search ? `+ ${filters}` : filters}
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

/*
 * The Schedule and Last Found columns in one line, under a hunt's name
 * where the list folds them away (below lg): how often it runs, and what
 * its last run found - in red when it could not be made.
 */
export const HuntFoldedFacts: FunctionComponent<HuntCellProps> = (
  props: HuntCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const hunt: SecurityHunt = props.hunt;
  const schedule: SecurityHuntSchedule =
    hunt.schedule || SecurityHuntSchedule.NotScheduled;
  const label: string = SCHEDULE_LABELS[schedule] || schedule;
  const state: HuntRunState = getHuntRunState(hunt);
  const separator: ReactElement = <span aria-hidden="true">·</span>;

  let found: ReactElement = <></>;

  if (state === HuntRunState.Failed) {
    found = (
      <>
        {separator}
        <span className="font-medium text-red-700">
          {translator.translateText(COULD_NOT_RUN) || COULD_NOT_RUN}
        </span>
      </>
    );
  } else if (state === HuntRunState.Found && hunt.lastFoundAt) {
    found = (
      <>
        {separator}
        <span className="tabular-nums">
          {translator.translatePlural(
            FOUND_EVENT_COUNT,
            hunt.lastFoundEventCount || 0,
          )}
        </span>
        {separator}
        <RelativeTime date={hunt.lastFoundAt} className="whitespace-nowrap" />
      </>
    );
  } else if (state === HuntRunState.NothingFound) {
    found = (
      <>
        {separator}
        <span>
          {translator.translateText(NOTHING_FOUND_YET) || NOTHING_FOUND_YET}
        </span>
      </>
    );
  } else if (state === HuntRunState.NotRunYet) {
    found = (
      <>
        {separator}
        <span>{translator.translateText(NOT_RUN_YET) || NOT_RUN_YET}</span>
      </>
    );
  }

  return (
    <span
      className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-600"
      data-testid={HUNTS_TEST_IDS.nameFacts}
      data-state={state}
    >
      <span>{translator.translateText(label) || label}</span>
      {found}
    </span>
  );
};

/*
 * The list's Hunt column: the hunt's name, its search under it, and what it
 * is for in two lines at most. A long name wraps between its words. Below
 * lg, where the list folds its other columns away, how often it runs and
 * what it last found come under them (HuntFoldedFacts).
 */
export const HuntNameCell: FunctionComponent<HuntCellProps> = (
  props: HuntCellProps,
): ReactElement => {
  const hunt: SecurityHunt = props.hunt;
  const areColumnsFolded: boolean = useAreTableColumnsFolded();

  return (
    <div className="grid min-w-0 grid-cols-1 gap-0.5">
      <span
        className="break-words font-medium text-gray-900"
        data-testid={HUNTS_TEST_IDS.nameCell}
      >
        <IsolatedText text={hunt.name || ""} />
      </span>
      <HuntSearchLine searchQuery={hunt.searchQuery} filters={hunt.filters} />
      {hunt.description ? (
        <span className="line-clamp-2 break-words text-xs text-gray-500">
          <IsolatedText text={hunt.description} />
        </span>
      ) : (
        <></>
      )}
      {areColumnsFolded ? <HuntFoldedFacts hunt={hunt} /> : <></>}
    </div>
  );
};

// Who a scheduled hunt tells: "Tells Maya Chen and 2 more".
export const HuntRecipients: FunctionComponent<{
  names: Array<string>;
  className?: string | undefined;
}> = (props: {
  names: Array<string>;
  className?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const line: HuntRecipientsLine = getHuntRecipientsLine(props.names);

  if (line.names.length === 0) {
    return (
      <span className={props.className}>
        {translator.translateText(TELLS_NOBODY) || TELLS_NOBODY}
      </span>
    );
  }

  // "Maya Chen, SOC Tier 2"; names written in Persian are listed with ،.
  const separator: string = getListSeparator(line.names);
  const names: ReactElement = (
    <>
      {line.names.map((name: string, index: number): ReactElement => {
        return (
          <React.Fragment key={`${name}-${index}`}>
            {index > 0 ? separator : ""}
            <IsolatedText text={name} />
          </React.Fragment>
        );
      })}
    </>
  );

  return (
    <span className={props.className}>
      {line.moreCount > 0 ? (
        <TranslatedSentence
          template={TELLS_AND_MORE}
          count={line.moreCount}
          slots={{ names }}
        />
      ) : (
        <TranslatedSentence template={TELLS} slots={{ names }} />
      )}
    </span>
  );
};

/*
 * The list's Schedule column: how often the hunt runs, who it tells and when
 * it runs next. A hunt that is not scheduled says so, and nothing more.
 */
export const HuntScheduleCell: FunctionComponent<HuntCellProps> = (
  props: HuntCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const hunt: SecurityHunt = props.hunt;
  const schedule: SecurityHuntSchedule =
    hunt.schedule || SecurityHuntSchedule.NotScheduled;
  const label: string = SCHEDULE_LABELS[schedule] || schedule;

  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-0.5"
      data-testid={HUNTS_TEST_IDS.scheduleCell}
    >
      <span
        className={
          isScheduledSecurityHunt(schedule)
            ? "text-sm text-gray-900"
            : "text-sm text-gray-500"
        }
      >
        {translator.translateText(label) || label}
      </span>
      {isScheduledSecurityHunt(schedule) ? (
        <>
          <HuntRecipients
            names={getHuntRecipientNames(hunt)}
            className="break-words text-xs text-gray-500"
          />
          {hunt.nextRunAt ? (
            <span className="text-xs text-gray-500">
              <TranslatedSentence
                template={NEXT_RUN}
                slots={{
                  time: (
                    <RelativeTime
                      date={hunt.nextRunAt}
                      className="whitespace-nowrap"
                    />
                  ),
                }}
              />
            </span>
          ) : (
            <></>
          )}
        </>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * The list's Last Found column: what the last run that found something
 * found, and when; that its runs have found nothing yet; or, in red, that
 * its last run could not be made, and why. A hunt opened by hand only says
 * nothing here.
 */
export const HuntLastFoundCell: FunctionComponent<HuntCellProps> = (
  props: HuntCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const hunt: SecurityHunt = props.hunt;
  const state: HuntRunState = getHuntRunState(hunt);

  let content: ReactElement;

  if (state === HuntRunState.Failed) {
    const error: string = hunt.lastRunError || "";

    content = (
      <>
        <span className="text-sm font-medium text-red-700">
          {translator.translateText(COULD_NOT_RUN) || COULD_NOT_RUN}
        </span>
        <span
          className="line-clamp-2 break-words text-xs text-red-700"
          title={translator.translateText(error) || error}
        >
          {translator.translateText(error) || error}
        </span>
      </>
    );
  } else if (state === HuntRunState.Found && hunt.lastFoundAt) {
    content = (
      <>
        <span className="text-sm font-medium tabular-nums text-gray-900">
          {translator.translatePlural(
            FOUND_EVENT_COUNT,
            hunt.lastFoundEventCount || 0,
          )}
        </span>
        <RelativeTime
          date={hunt.lastFoundAt}
          className="whitespace-nowrap text-xs text-gray-500"
        />
      </>
    );
  } else if (state === HuntRunState.NothingFound) {
    content = (
      <span className="text-sm text-gray-500">
        {translator.translateText(NOTHING_FOUND_YET) || NOTHING_FOUND_YET}
      </span>
    );
  } else if (state === HuntRunState.NotRunYet) {
    content = (
      <span className="text-sm text-gray-500">
        {translator.translateText(NOT_RUN_YET) || NOT_RUN_YET}
      </span>
    );
  } else {
    content = <span className="text-sm text-gray-400">-</span>;
  }

  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-0.5"
      data-testid={HUNTS_TEST_IDS.lastFoundCell}
      data-state={state}
    >
      {content}
    </div>
  );
};
