import {
  GROUPING_RULE_COPY,
  GroupingRuleTranslateFunction,
  LegacyDefaultAssignee,
  LegacyDefaultAssigneeAction,
  LegacyDefaultAssigneeChange,
} from "../../Utils/GroupingRule/GroupingRuleSetup";
import useGroupingRuleTranslate from "./GroupingRuleTranslate";
import { PeopleChip } from "Common/UI/Components/PeoplePicker/PeopleList";
import {
  PeoplePickerKind,
  PeoplePickerOption,
  PeoplePickerValue,
  getPeoplePickerOptionKey,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import usePeopleOptions, {
  PeopleOptionsLookup,
} from "Common/UI/Components/PeoplePicker/usePeopleOptions";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  assignee: LegacyDefaultAssignee;
  onChange: (change: LegacyDefaultAssigneeChange) => void;
  disabled?: boolean | undefined;
}

const KINDS: Array<PeoplePickerKind> = [
  PeoplePickerKind.User,
  PeoplePickerKind.Team,
];

interface AssigneePick {
  kind: PeoplePickerKind;
  id: string;
}

/*
 * The line under a grouping rule's Episode Owners when the rule still has a
 * default assignee from the old form (see EPISODE_OWNERS_FIELD_KEY in
 * GroupingRuleSetup): who it names, that nothing shows it, and the two ways
 * to settle it - make them owners, or let it go. Either one clears the old
 * pair when the rule is saved, so the line is there only until somebody
 * decides; nothing changes before Save Changes.
 *
 * Someone who has left the project, or a team since deleted, is still named
 * (as unknown) but cannot become an owner: Add as owners adds the picks the
 * project still has, and is not offered when it has none of them. When the
 * names cannot be looked up at all, the line says so and Add as owners adds
 * both: the rule is checked when it is saved (GroupingRuleEpisodeOwners).
 */
const LegacyDefaultAssigneeNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translate: GroupingRuleTranslateFunction = useGroupingRuleTranslate();
  const titleId: string = `legacy-default-assignee-${useId()}`;
  const descriptionId: string = `${titleId}-description`;

  const picks: Array<AssigneePick> = [];

  if (props.assignee.userId) {
    picks.push({ kind: PeoplePickerKind.User, id: props.assignee.userId });
  }

  if (props.assignee.teamId) {
    picks.push({ kind: PeoplePickerKind.Team, id: props.assignee.teamId });
  }

  const value: PeoplePickerValue = {};

  for (const pick of picks) {
    value[pick.kind] = [pick.id];
  }

  const lookup: PeopleOptionsLookup = usePeopleOptions({
    kinds: KINDS,
    value: value,
  });

  /*
   * The lookup failed: the names are not known, and neither is who is still
   * in the project.
   */
  const lookupFailed: boolean = Boolean(lookup.error);

  /*
   * What Add as owners adds: a pick found in the project - or, when nothing
   * could be looked up, every pick, which the save then checks.
   */
  const idToAdd: (kind: PeoplePickerKind) => string | null = (
    kind: PeoplePickerKind,
  ): string | null => {
    const pick: AssigneePick | undefined = picks.find(
      (candidate: AssigneePick): boolean => {
        return candidate.kind === kind;
      },
    );

    if (!pick) {
      return null;
    }

    if (lookupFailed) {
      return pick.id;
    }

    const option: PeoplePickerOption | undefined = lookup.getOption(
      pick.kind,
      pick.id,
    );

    return option && !option.isUnknown ? pick.id : null;
  };

  const isLookingUp: boolean =
    !lookupFailed &&
    picks.some((pick: AssigneePick): boolean => {
      return lookup.getOption(pick.kind, pick.id) === undefined;
    });

  const userId: string | null = idToAdd(PeoplePickerKind.User);
  const teamId: string | null = idToAdd(PeoplePickerKind.Team);
  const canAddAsOwners: boolean = isLookingUp || Boolean(userId || teamId);

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-testid="legacy-default-assignee"
      className="rounded-md border border-gray-200 bg-gray-50 p-3"
    >
      <p id={titleId} className="text-sm font-medium text-gray-900">
        {translate(GROUPING_RULE_COPY.legacyAssigneeTitle)}
      </p>
      {lookupFailed ? (
        <p
          role="alert"
          className="mt-2 text-sm text-red-600"
          data-testid="legacy-default-assignee-lookup-failed"
        >
          {translate(GROUPING_RULE_COPY.legacyAssigneeLookupFailed)}
        </p>
      ) : (
        <div
          className="mt-2 flex flex-wrap items-center gap-1.5"
          data-testid="legacy-default-assignee-people"
        >
          {picks.map((pick: AssigneePick): ReactElement => {
            return (
              <PeopleChip
                key={getPeoplePickerOptionKey(pick.kind, pick.id)}
                kind={pick.kind}
                id={pick.id}
                option={lookup.getOption(pick.kind, pick.id)}
              />
            );
          })}
        </div>
      )}
      <p id={descriptionId} className="mt-2 text-sm text-gray-600">
        {translate(GROUPING_RULE_COPY.legacyAssigneeDescription)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canAddAsOwners ? (
          <button
            type="button"
            data-testid="legacy-default-assignee-add-as-owners"
            disabled={Boolean(props.disabled) || isLookingUp}
            onClick={(): void => {
              props.onChange({
                action: LegacyDefaultAssigneeAction.AddAsOwners,
                userId: userId,
                teamId: teamId,
              });
            }}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {translate(GROUPING_RULE_COPY.legacyAssigneeAddAsOwners)}
          </button>
        ) : (
          <></>
        )}
        <button
          type="button"
          data-testid="legacy-default-assignee-remove"
          disabled={props.disabled}
          onClick={(): void => {
            props.onChange({ action: LegacyDefaultAssigneeAction.Remove });
          }}
          className="rounded-md px-2.5 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {translate(GROUPING_RULE_COPY.legacyAssigneeRemove)}
        </button>
      </div>
    </div>
  );
};

export default LegacyDefaultAssigneeNote;
