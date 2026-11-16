import UsedByApi from "./UsedByApi";
import useUsedBySummary, {
  UseUsedBySummaryResult,
  UsedBySummaryState,
} from "./useUsedBySummary";
import {
  CHECKING_WHAT_USES_IT,
  CHECKING_WHAT_USES_THEM,
  STILL_IN_USE,
  STILL_IN_USE_DESCRIPTION,
  getUsedByBulkImpactSentence,
  getUsedByHiddenInImpact,
  getUsedByImpactSentence,
  getUsedByPartsLine,
} from "./UsedByWords";
import ObjectID from "Common/Types/ObjectID";
import {
  UsedByBulkSummary,
  UsedByCounts,
  UsedByRecordKind,
  UsedByRelation,
  getUsedByGroupsInUse,
} from "Common/Types/UsedBy/UsedBy";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { BulkActionConfirmControls } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT DELETING OR ARCHIVING A RECORD AFFECTS (#6813), said where it is
 * done: on the Delete page and the Settings page's Archive card, and again
 * inside their confirmation - "3 status pages show this monitor." - before
 * it happens (Docs/ux/README.md#dialogs-and-confirmations: taking away
 * something others depend on says what breaks first). A list's row Delete
 * and Archive say it too, and its bulk Delete and Archive say it for the
 * whole selection, counted once for all of it (#7435): "12 status pages
 * show the selected monitors."
 *
 * An advisory, read from the record's Used by answer: if it fails, nothing
 * is said, and the delete is never held back by it. A family's line (the
 * rules that name a monitor) says its kinds under its sentence.
 */

// The groups the dialogs list: in use, less what the page says otherwise.
function getImpactGroups(
  state: UsedBySummaryState,
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined,
): Array<UsedByCounts> {
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

/*
 * One sentence per kind of record that still refers to it - or, for a
 * list's selection (`isSelection`), to any of the selected records - with
 * a family's kinds in a quiet line under its sentence.
 */
export const UsedByImpactSentences: FunctionComponent<{
  groups: Array<UsedByCounts>;
  isSelection?: boolean | undefined;
}> = (props: {
  groups: Array<UsedByCounts>;
  isSelection?: boolean | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul className="mt-1 list-disc space-y-0.5 ps-5">
      {props.groups.map((group: UsedByCounts): ReactElement => {
        const hidden: string = getUsedByHiddenInImpact(group, translator);
        const parts: string = getUsedByPartsLine(group, translator);

        return (
          <li
            key={group.relation}
            data-testid="used-by-impact-line"
            data-relation={group.relation}
          >
            {props.isSelection
              ? getUsedByBulkImpactSentence(group, translator)
              : getUsedByImpactSentence(group, translator)}
            {hidden ? (
              <span className="ms-1 text-gray-500">{hidden}</span>
            ) : (
              <></>
            )}
            {parts ? (
              <p
                className="text-xs text-gray-600"
                data-testid="used-by-impact-parts"
              >
                {parts}
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

// The box a confirmation draws the sentences in, under "Still in use".
const UsedByImpactBox: FunctionComponent<{
  groups: Array<UsedByCounts>;
  isSelection?: boolean | undefined;
  dataTestId: string;
}> = (props: {
  groups: Array<UsedByCounts>;
  isSelection?: boolean | undefined;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"
      data-testid={props.dataTestId}
    >
      <p className="font-medium">{translator.translateText(STILL_IN_USE)}</p>
      <UsedByImpactSentences
        groups={props.groups}
        isSelection={props.isSelection}
      />
    </div>
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
  const groups: Array<UsedByCounts> = getImpactGroups(
    props.state,
    props.leaveOut,
  );

  if (groups.length === 0) {
    return <></>;
  }

  return <UsedByImpactBox groups={groups} dataTestId="used-by-impact" />;
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
  const groups: Array<UsedByCounts> = getImpactGroups(
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
 * a Settings page's Archive dialog, which most visits never open, or a
 * list's row Archive. `showChecking` says it is reading meanwhile.
 */
export const UsedByImpactForRecord: FunctionComponent<{
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined;
  showChecking?: boolean | undefined;
}> = (props: {
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  leaveOut?: ReadonlyArray<UsedByRelation> | undefined;
  showChecking?: boolean | undefined;
}): ReactElement => {
  const used: UseUsedBySummaryResult = useUsedBySummary({
    recordKind: props.recordKind,
    recordId: props.recordId,
  });

  if (props.showChecking && used.state.status === "loading") {
    return (
      <InlineLoadingLine
        text={CHECKING_WHAT_USES_IT}
        dataTestId="used-by-checking"
      />
    );
  }

  return <UsedByImpactList state={used.state} leaveOut={props.leaveOut} />;
};

type BulkState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; summary: UsedByBulkSummary };

/*
 * Inside a list's bulk Delete or Archive confirmation: what still uses any
 * of the selected records, read once for the whole selection when the
 * dialog opens (UsedByApi.getSummaries, counts only). The dialog's action
 * waits for the answer, so it is read before anything happens; a read that
 * fails says nothing and lets it go.
 */
export const UsedByBulkImpact: FunctionComponent<{
  recordKind: UsedByRecordKind;
  recordIds: Array<ObjectID>;
  controls?: BulkActionConfirmControls | undefined;
}> = (props: {
  recordKind: UsedByRecordKind;
  recordIds: Array<ObjectID>;
  controls?: BulkActionConfirmControls | undefined;
}): ReactElement => {
  const [state, setState] = useState<BulkState>({ status: "loading" });

  useEffect(() => {
    let cancelled: boolean = false;

    if (props.recordIds.length === 0) {
      setState({ status: "failed" });
      return;
    }

    props.controls?.setIsSubmitHeld(true);

    UsedByApi.getSummaries({
      recordKind: props.recordKind,
      recordIds: props.recordIds,
    })
      .then((summary: UsedByBulkSummary) => {
        if (!cancelled) {
          setState({ status: "loaded", summary: summary });
          props.controls?.setIsSubmitHeld(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "failed" });
          props.controls?.setIsSubmitHeld(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <InlineLoadingLine
        text={CHECKING_WHAT_USES_THEM}
        dataTestId="used-by-bulk-checking"
      />
    );
  }

  if (state.status === "failed") {
    return <></>;
  }

  const groups: Array<UsedByCounts> = getUsedByGroupsInUse(state.summary);

  if (groups.length === 0) {
    return <></>;
  }

  return (
    <UsedByImpactBox
      groups={groups}
      isSelection={true}
      dataTestId="used-by-bulk-impact"
    />
  );
};
