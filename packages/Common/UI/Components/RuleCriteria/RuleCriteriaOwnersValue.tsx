import Team from "../../../Models/DatabaseModels/Team";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Includes from "../../../Types/BaseDatabase/Includes";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { getOwnersPeoplePickerConfig } from "../PeoplePicker/OwnersFormField";
import LazyPeoplePicker from "../PeoplePicker/LazyPeoplePicker";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  PeoplePickerValue,
} from "../PeoplePicker/PeoplePickerTypes";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { RuleCriteriaCopy } from "./RuleCriteriaFields";

/*
 * AN OWNER CONDITION'S VALUE: PEOPLE AND TEAMS, PICKED AS OWNERS ARE (#9353).
 *
 *   If  [Alert Owner v]  [Is any of v]  (+ Add owner) (Platform) (Jane)  (bin)
 *                                       Matches the people and teams added
 *                                       as owners. Team membership does not
 *                                       count.
 *
 * The condition holds the ids of the people and teams picked in one list,
 * as a workspace rule's owner condition does (#7583). The picker keeps
 * people and teams apart, so the teams among the ids are looked up once -
 * a team picked since is known by its pick - and every other id is a
 * person. A person who left or a team since deleted reads "No longer in
 * this project", as every rule's value that names nothing now does.
 */

// Picked as owners are everywhere: people and teams, in one search list.
const OWNERS_PICKER_CONFIG: PeoplePickerFieldConfig =
  getOwnersPeoplePickerConfig();

export const RULE_CRITERIA_OWNER_KINDS: Array<PeoplePickerKind> = [
  PeoplePickerKind.User,
  PeoplePickerKind.Team,
];

// The ids as the picker holds them: the teams among them as teams.
export const getRuleCriteriaOwnerPickerValue: (data: {
  ids: Array<string>;
  teamIds: Set<string>;
}) => PeoplePickerValue = (data: {
  ids: Array<string>;
  teamIds: Set<string>;
}): PeoplePickerValue => {
  const users: Array<string> = [];
  const teams: Array<string> = [];

  for (const id of data.ids) {
    if (data.teamIds.has(id.toLowerCase())) {
      teams.push(id);
    } else {
      users.push(id);
    }
  }

  return {
    [PeoplePickerKind.User]: users,
    [PeoplePickerKind.Team]: teams,
  };
};

// The picks as the condition holds them: people, then teams, in one list.
export const getRuleCriteriaOwnerIds: (
  value: PeoplePickerValue,
) => Array<string> = (value: PeoplePickerValue): Array<string> => {
  return [
    ...(value[PeoplePickerKind.User] || []),
    ...(value[PeoplePickerKind.Team] || []),
  ];
};

export interface ComponentProps {
  ids: Array<string>;
  onChange: (ids: Array<string>) => void;
  disabled?: boolean | undefined;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  dataTestId?: string | undefined;
}

const RuleCriteriaOwnersValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Teams among the ids, as read, and as picked while the form is open.
  const knownTeamIds: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set(),
  );
  // The ids already looked up, teams or not.
  const lookedUpIds: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set(),
  );
  const [isLookingUp, setIsLookingUp] = useState<boolean>(() => {
    return props.ids.length > 0;
  });
  const [, setLookups] = useState<number>(0);

  const idsToLookUp: Array<string> = props.ids
    .map((id: string): string => {
      return id.toLowerCase();
    })
    .filter((id: string): boolean => {
      return !lookedUpIds.current.has(id);
    });

  useEffect(() => {
    if (idsToLookUp.length === 0) {
      setIsLookingUp(false);
      return;
    }

    let isCurrent: boolean = true;

    const lookUp: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<Team> = await ModelAPI.getList<Team>({
          modelType: Team,
          query: {
            _id: new Includes(idsToLookUp),
          },
          select: {
            _id: true,
          },
          limit: idsToLookUp.length,
          skip: 0,
          sort: {},
        });

        for (const team of result.data) {
          const id: string = team._id?.toString().toLowerCase() || "";

          if (id) {
            knownTeamIds.current.add(id);
          }
        }
      } catch {
        // Not read: each id is shown as a person, and can still be removed.
      }

      for (const id of idsToLookUp) {
        lookedUpIds.current.add(id);
      }

      if (isCurrent) {
        setIsLookingUp(false);
        setLookups((count: number): number => {
          return count + 1;
        });
      }
    };

    setIsLookingUp(true);
    void lookUp();

    return () => {
      isCurrent = false;
    };
  }, [idsToLookUp.join(",")]);

  if (isLookingUp) {
    return (
      <div
        className="flex min-h-10 items-center"
        data-testid={
          props.dataTestId ? `${props.dataTestId}-loading` : undefined
        }
      >
        <div
          className="h-8 w-32 animate-pulse rounded-full bg-gray-100"
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-10 items-center">
      <LazyPeoplePicker
        kinds={RULE_CRITERIA_OWNER_KINDS}
        value={getRuleCriteriaOwnerPickerValue({
          ids: props.ids,
          teamIds: knownTeamIds.current,
        })}
        onChange={(next: PeoplePickerValue): void => {
          for (const id of next[PeoplePickerKind.Team] || []) {
            knownTeamIds.current.add(id.toLowerCase());
            lookedUpIds.current.add(id.toLowerCase());
          }

          for (const id of next[PeoplePickerKind.User] || []) {
            lookedUpIds.current.add(id.toLowerCase());
          }

          props.onChange(getRuleCriteriaOwnerIds(next));
        }}
        addButtonText={OWNERS_PICKER_CONFIG.addButtonText}
        searchPlaceholder={OWNERS_PICKER_CONFIG.searchPlaceholder}
        emptyText={OWNERS_PICKER_CONFIG.emptyText}
        // A person who left or a team since deleted, as a rule's card says it.
        unknownName={RuleCriteriaCopy.valueNotFound}
        disabled={props.disabled}
        error={props.error}
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={props.ariaDescribedby}
        dataTestId={props.dataTestId}
      />
    </div>
  );
};

export default RuleCriteriaOwnersValue;
