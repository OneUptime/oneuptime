import IconProp from "Common/Types/Icon/IconProp";
import UserOverrideOverlap, {
  USER_OVERRIDE_OVERLAPS_LABEL,
  UserOverrideOverlapNote,
  UserOverrideSentence,
  UserOverrideTimes,
} from "Common/Types/OnCallDutyPolicy/UserOverrideOverlap";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "OVERLAPS": AN OVERRIDE THAT OVERLAPS ANOTHER, SAVED BEFORE THE RULE.
 *
 * Two overrides of the same person in the same scope may no longer overlap
 * (issue #7630), but ones saved before the rule stay as they were saved:
 * nothing is changed or deleted for anybody. Where two overlap, only one
 * decides who is paged - the one that names who covers over a skip, then
 * the one that starts first, then the one added first, as paging and the
 * schedules decide (UserOverrideOverlap.compareUse). The lists - a policy's
 * User Overrides, the global ones, a schedule's active overrides - mark each
 * of the two "Overlaps", and say on it which one is used there and why, so
 * nobody has to work out who will be paged. Editing either one's times so
 * that they no longer overlap clears the mark.
 */

// What the mark says: what it overlaps, then which of the two is used, and why.
export const getUserOverrideOverlapsText: (data: {
  translator: Translator;
  note: UserOverrideOverlapNote<UserOverrideTimes>;
  // Who is away in both: the person the row is about.
  awayName: string;
  // Who covers in the other one; unused when the other is a skip.
  otherCoverName: string;
  // The other one's times, as the list writes times.
  from: string;
  until: string;
}) => string = (data: {
  translator: Translator;
  note: UserOverrideOverlapNote<UserOverrideTimes>;
  awayName: string;
  otherCoverName: string;
  from: string;
  until: string;
}): string => {
  // Run together as the reader's script runs sentences: no space after a "。".
  return joinSentences(
    UserOverrideOverlap.getOverlapNoteSentences({
      note: data.note,
      awayName: data.awayName,
      otherCoverName: data.otherCoverName,
      from: data.from,
      until: data.until,
    }).map((sentence: UserOverrideSentence): string => {
      return data.translator.translateTemplate(
        sentence.template,
        sentence.values,
      );
    }),
  );
};

export interface ComponentProps {
  // The whole of what it says (getUserOverrideOverlapsText).
  text: string;
}

const UserOverrideOverlapsMark: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string =
    translator.translateText(USER_OVERRIDE_OVERLAPS_LABEL) ||
    USER_OVERRIDE_OVERLAPS_LABEL;

  /*
   * Read out whole: the text starts with what the mark says ("Overlaps
   * another override for ..."), so the word is not said twice.
   */
  return (
    <Tooltip text={props.text}>
      <span
        data-testid="user-override-overlaps"
        role="img"
        tabIndex={0}
        aria-label={props.text}
        className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
      >
        <Icon icon={IconProp.Square2Stack} className="h-3 w-3" />
        {label}
      </span>
    </Tooltip>
  );
};

export default UserOverrideOverlapsMark;
