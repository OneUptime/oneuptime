import { FieldFooterProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  PeoplePickerValue,
  readPeoplePickerFormValue,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ADD_ALL_MY_TEAMS,
  ADD_MY_TEAM_LABEL,
  ADDED_MY_TEAM_ANNOUNCEMENT,
  ADDED_MY_TEAMS_ANNOUNCEMENT,
  addTeamsToPicked,
  getTeamsToSuggest,
  MY_TEAM_SUGGESTIONS_LABEL,
  MyTeam,
} from "./OwnersOnCreateRules";
import useMyTeams, { MyTeamsState } from "./useMyTeams";

/*
 * "Your teams: [+ Platform] [+ SRE] Add all" - drawn under the Owners picker
 * of a create form (OwnersOnCreateField), so making the creator's team an
 * owner is one click. One click adds a team, Add all adds every one; nothing
 * is picked by itself (the project's Members and Owners teams are teams
 * too). A team's button goes once it is picked, and the line is not there
 * while there is nothing to add - no team, every one picked, or the teams
 * still being read.
 *
 * As the status page suggestions do: focus moves on to the next button, or
 * to where the line was once none is left, and a polite status says what was
 * added.
 */

export interface MyTeamSuggestionsProps {
  // The teams picked, as the form holds them.
  pickedTeamIds: unknown;
  // The picker's teams once the suggested ones are added.
  onChange: (teamIds: Array<string>) => void;
}

const MyTeamSuggestions: FunctionComponent<MyTeamSuggestionsProps> = (
  props: MyTeamSuggestionsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `my-team-suggestions-${useId()}`;
  const rootRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  // Where focus goes once an add is drawn: the button now there, or the line.
  const focusAfterAddRef: MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  const [announcement, setAnnouncement] = useState<string>("");

  const { teams }: MyTeamsState = useMyTeams();

  const toSuggest: Array<MyTeam> = getTeamsToSuggest({
    myTeams: teams,
    pickedTeamIds: props.pickedTeamIds,
  });

  useLayoutEffect(() => {
    const position: number | null = focusAfterAddRef.current;

    if (position === null) {
      return;
    }

    focusAfterAddRef.current = null;

    const buttons: Array<HTMLElement> = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        "[data-my-team-suggestion]",
      ) || [],
    );

    const next: HTMLElement | undefined =
      buttons[Math.min(position, buttons.length - 1)];

    if (next) {
      next.focus();
      return;
    }

    rootRef.current?.focus();
  });

  const add: (added: Array<MyTeam>, focusPosition: number) => void = (
    added: Array<MyTeam>,
    focusPosition: number,
  ): void => {
    if (added.length === 0) {
      return;
    }

    focusAfterAddRef.current = focusPosition;

    props.onChange(
      addTeamsToPicked({
        pickedTeamIds: props.pickedTeamIds,
        teamIds: added.map((team: MyTeam): string => {
          return team.id;
        }),
      }),
    );

    setAnnouncement(
      added.length === 1
        ? translator.translateTemplate(ADDED_MY_TEAM_ANNOUNCEMENT, {
            teamName: added[0]!.name,
          })
        : translator.translatePlural(ADDED_MY_TEAMS_ANNOUNCEMENT, added.length),
    );
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="focus:outline-none"
      data-testid="my-team-suggestions"
    >
      {toSuggest.length > 0 ? (
        <div
          role="group"
          aria-labelledby={labelId}
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5"
          data-testid="my-team-suggestions-line"
        >
          <span id={labelId} className="text-sm text-gray-600">
            {translator.translatePlural(
              MY_TEAM_SUGGESTIONS_LABEL,
              toSuggest.length,
            )}
          </span>
          {toSuggest.map((team: MyTeam, position: number) => {
            return (
              <button
                key={team.id}
                type="button"
                data-my-team-suggestion={team.id}
                data-testid="my-team-suggestion"
                aria-label={translator.translateTemplate(ADD_MY_TEAM_LABEL, {
                  teamName: team.name,
                })}
                title={team.name}
                onClick={() => {
                  add([team], position);
                }}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <svg
                  className="h-3 w-3 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                <span className="truncate">{team.name}</span>
              </button>
            );
          })}
          {toSuggest.length > 1 ? (
            <button
              type="button"
              data-testid="my-team-suggestions-add-all"
              onClick={() => {
                add(toSuggest, 0);
              }}
              className="rounded text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {translator.translateText(ADD_ALL_MY_TEAMS)}
            </button>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      <span
        role="status"
        className="sr-only"
        data-testid="my-team-suggestions-status"
      >
        {announcement}
      </span>
    </div>
  );
};

export default MyTeamSuggestions;

/*
 * The getFooterElement of an Owners people picker: the suggestions, adding
 * to its teams through the footer's setValue (FieldFooterProps), with the
 * people picked kept as they are.
 */
export const getMyTeamSuggestionsFooter: <TEntity>(
  config: PeoplePickerFieldConfig,
) => (
  values: FormValues<TEntity>,
  error?: string,
  footer?: FieldFooterProps,
) => ReactElement | undefined = <TEntity,>(
  config: PeoplePickerFieldConfig,
): ((
  values: FormValues<TEntity>,
  error?: string,
  footer?: FieldFooterProps,
) => ReactElement | undefined) => {
  const getFooterElement: (
    values: FormValues<TEntity>,
    error?: string,
    footer?: FieldFooterProps,
  ) => ReactElement | undefined = (
    values: FormValues<TEntity>,
    _error?: string,
    footer?: FieldFooterProps,
  ): ReactElement | undefined => {
    // Drawn outside a form, there is no field to add to.
    if (!footer) {
      return undefined;
    }

    const picked: PeoplePickerValue = readPeoplePickerFormValue(config, values);

    return (
      <MyTeamSuggestions
        pickedTeamIds={picked[PeoplePickerKind.Team] || []}
        onChange={(teamIds: Array<string>) => {
          footer.setValue({
            ...picked,
            [PeoplePickerKind.Team]: teamIds,
          });
        }}
      />
    );
  };

  return getFooterElement;
};
