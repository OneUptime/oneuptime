import useUsedBySummary, {
  UseUsedBySummaryResult,
  UsedBySummaryState,
} from "./useUsedBySummary";
import {
  STILL_IN_USE,
  STILL_IN_USE_DESCRIPTION,
  getUsedByHiddenInImpact,
  getUsedByImpactSentence,
} from "./UsedByWords";
import ObjectID from "Common/Types/ObjectID";
import {
  UsedByGroup,
  UsedByRecordKind,
  UsedByRelation,
  getUsedByGroupsInUse,
} from "Common/Types/UsedBy/UsedBy";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT DELETING OR ARCHIVING A RECORD AFFECTS (#6813), said where it is
 * done: on the Delete page and the Settings page's Archive card, and again
 * inside their confirmation - "3 status pages show this monitor." - before
 * it happens (Docs/ux/README.md#dialogs-and-confirmations: taking away
 * something others depend on says what breaks first).
 *
 * An advisory, read from the record's Used by answer: while it loads, or
 * if it fails, nothing is said, and the delete is never held back by it.
 */

// The groups the dialogs list: in use, less what the page says otherwise.
function getImpactGroups(
  state: UsedBySummaryState,
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined,
): Array<UsedByGroup> {
  if (state.status !== "loaded") {
    return [];
  }

  return getUsedByGroupsInUse(state.summary, leaveOut);
}

// Whether anything still uses the record, less what the page says otherwise.
export function hasUsedByImpact(
  state: UsedBySummaryState,
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined,
): boolean {
  return getImpactGroups(state, leaveOut).length > 0;
}

// One sentence per kind of record that still refers to it.
export const UsedByImpactSentences: FunctionComponent<{
  groups: Array<UsedByGroup>;
}> = (props: { groups: Array<UsedByGroup> }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul className="mt-1 list-disc space-y-0.5 ps-5">
      {props.groups.map((group: UsedByGroup): ReactElement => {
        const hidden: string = getUsedByHiddenInImpact(group, translator);

        return (
          <li
            key={group.relation}
            data-testid="used-by-impact-line"
            data-relation={group.relation}
          >
            {getUsedByImpactSentence(group, translator)}
            {hidden ? (
              <span className="ms-1 text-gray-500">{hidden}</span>
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
 * Inside a Delete or Archive confirmation: what still uses it, or nothing
 * at all when nothing does.
 */
export const UsedByImpactList: FunctionComponent<{
  state: UsedBySummaryState;
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined;
}> = (props: {
  state: UsedBySummaryState;
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const groups: Array<UsedByGroup> = getImpactGroups(
    props.state,
    props.leaveOut,
  );

  if (groups.length === 0) {
    return <></>;
  }

  return (
    <div
      className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"
      data-testid="used-by-impact"
    >
      <p className="font-medium">{translator.translateText(STILL_IN_USE)}</p>
      <UsedByImpactSentences groups={groups} />
    </div>
  );
};

/*
 * Above a Delete page's card: the same list, as the page's warning, only
 * while something uses the record.
 */
export const UsedByImpactNotice: FunctionComponent<{
  state: UsedBySummaryState;
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined;
}> = (props: {
  state: UsedBySummaryState;
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const groups: Array<UsedByGroup> = getImpactGroups(
    props.state,
    props.leaveOut,
  );

  if (groups.length === 0) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.WARNING}
      dataTestId="used-by-impact-notice"
      strongTitle={STILL_IN_USE}
      title={
        <div>
          <p>{translator.translateText(STILL_IN_USE_DESCRIPTION)}</p>
          <UsedByImpactSentences groups={groups} />
        </div>
      }
    />
  );
};

/*
 * The list for a confirmation that reads the answer itself, when it opens:
 * a Settings page's Archive dialog, which most visits never open.
 */
export const UsedByImpactForRecord: FunctionComponent<{
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined;
}> = (props: {
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined;
}): ReactElement => {
  const used: UseUsedBySummaryResult = useUsedBySummary({
    recordKind: props.recordKind,
    recordId: props.recordId,
  });

  return <UsedByImpactList state={used.state} leaveOut={props.leaveOut} />;
};
