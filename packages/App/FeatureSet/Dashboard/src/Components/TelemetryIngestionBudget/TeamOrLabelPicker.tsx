import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { withSearch } from "Common/UI/Components/EntityDropdown/EntityDropdownQuery";
import ArchivedValuePicker from "Common/UI/Utils/ArchivedValuePicker";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getTeamOrLabelOptions,
  TEAM_OR_LABEL_LABEL_SELECT,
  TEAM_OR_LABEL_TEAM_SELECT,
} from "./TeamLabelBudgetsTable";

/*
 * WHOSE BUDGET IT IS: ONE OF THE PROJECT'S TEAMS OR LABELS, SEARCHED ON
 * THE SERVER (#10764).
 *
 * A new team or label budget's one picker - the project's teams and its
 * labels, in two groups - read the first 10,000 of each by name and offered
 * them whole, so a team or a label past them could not be given a budget.
 * It asks the server for each kind as it opens and as the person types,
 * TEAM_OR_LABEL_SEARCH_LIMIT of each by name (archived labels left out, as
 * every picker leaves them, and the server refuses a budget for one), and
 * keeps the one picked named while other searches come and go. The picker
 * itself is the form's own Dropdown, so it looks as it did.
 */

// How many of each kind a search lists, by name.
export const TEAM_OR_LABEL_SEARCH_LIMIT: number = 50;

// How long typing rests before the server is asked.
export const TEAM_OR_LABEL_SEARCH_DELAY_MS: number = 250;

/*
 * The teams and labels whose names hold the search - each kind
 * TEAM_OR_LABEL_SEARCH_LIMIT by name - grouped as the picker lists them.
 */
export const readTeamOrLabelOptions: (data: {
  search: string;
  translator: Translator;
}) => Promise<Array<DropdownOptionGroup>> = async (data: {
  search: string;
  translator: Translator;
}): Promise<Array<DropdownOptionGroup>> => {
  const search: string = data.search.trim();

  const [teams, labels]: [ListResult<Team>, ListResult<Label>] =
    await Promise.all([
      ModelAPI.getList<Team>({
        modelType: Team,
        query: withSearch({}, "name", search) as Query<Team>,
        skip: 0,
        limit: TEAM_OR_LABEL_SEARCH_LIMIT,
        select: TEAM_OR_LABEL_TEAM_SELECT,
        sort: { name: SortOrder.Ascending },
      }),
      ModelAPI.getList<Label>({
        modelType: Label,
        query: withSearch(
          ArchivedValuePicker.getPickerQuery(Label, {}),
          "name",
          search,
        ) as Query<Label>,
        skip: 0,
        limit: TEAM_OR_LABEL_SEARCH_LIMIT,
        select: TEAM_OR_LABEL_LABEL_SELECT,
        sort: { name: SortOrder.Ascending },
      }),
    ]);

  return getTeamOrLabelOptions({
    teams: teams.data,
    labels: labels.data,
    translator: data.translator,
  });
};

// Every option of the groups, in order.
const flattenGroups: (
  groups: Array<DropdownOptionGroup>,
) => Array<DropdownOption> = (
  groups: Array<DropdownOptionGroup>,
): Array<DropdownOption> => {
  return groups.flatMap((group: DropdownOptionGroup): Array<DropdownOption> => {
    return group.options;
  });
};

export interface ComponentProps {
  // "team:<id>" or "label:<id>" (getTeamOrLabelOptionValue); null for none.
  value: string | null;
  onChange: (value: string | null) => void;
  // In English, looked up where it is drawn.
  placeholder?: string | undefined;
  error?: string | undefined;
  tabIndex?: number | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  dataTestId?: string | undefined;
}

const TeamOrLabelPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [groups, setGroups] = useState<Array<DropdownOptionGroup>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // The option picked, so its name stays while other searches come and go.
  const [picked, setPicked] = useState<DropdownOption | null>(null);

  // Only the newest read lands: an answer to an older search is dropped.
  const readRef: React.MutableRefObject<number> = useRef<number>(0);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer: () => void = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const read: (search: string) => void = (search: string): void => {
    const readNumber: number = ++readRef.current;
    setIsLoading(true);

    readTeamOrLabelOptions({ search, translator })
      .then((found: Array<DropdownOptionGroup>) => {
        if (readNumber === readRef.current) {
          setGroups(found);
          setIsLoading(false);
        }
      })
      .catch(() => {
        // Not read - none to offer; the server refuses a save without one.
        if (readNumber === readRef.current) {
          setGroups([]);
          setIsLoading(false);
        }
      });
  };

  useEffect(() => {
    read("");

    return clearTimer;
  }, []);

  const options: Array<DropdownOption> = flattenGroups(groups);
  const selected: DropdownOption | undefined = props.value
    ? options.find((option: DropdownOption): boolean => {
        return option.value === props.value;
      }) || (picked && picked.value === props.value ? picked : undefined)
    : undefined;

  return (
    <Dropdown
      options={groups}
      value={selected}
      placeholder={props.placeholder}
      error={props.error}
      tabIndex={props.tabIndex}
      ariaLabelledby={props.ariaLabelledby}
      ariaDescribedby={props.ariaDescribedby}
      dataTestId={props.dataTestId}
      isLoading={isLoading}
      onSearchTextChange={(text: string) => {
        clearTimer();

        const search: string = text.trim();

        timerRef.current = setTimeout(
          () => {
            read(search);
          },
          search ? TEAM_OR_LABEL_SEARCH_DELAY_MS : 0,
        );
      }}
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        const next: string | null =
          value === null || value === undefined || Array.isArray(value)
            ? null
            : String(value);

        setPicked(
          next
            ? options.find((option: DropdownOption): boolean => {
                return option.value === next;
              }) || null
            : null,
        );
        props.onChange(next);
      }}
    />
  );
};

export default TeamOrLabelPicker;
