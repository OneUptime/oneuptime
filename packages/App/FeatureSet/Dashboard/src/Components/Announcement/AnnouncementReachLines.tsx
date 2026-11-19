import ObjectID from "Common/Types/ObjectID";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import { ScopeNotice } from "../Incident/IncidentStatusPageScopeNotices";
import {
  AnnouncementFormKind,
  getAnnouncementNotifyBoxReason,
  getAnnouncementReachQuestion,
  getAnnouncementScheduleSectionSummary,
} from "./AnnouncementForm";
import useAnnouncementReach, {
  AnnouncementReachState,
} from "./useAnnouncementReach";

/*
 * What the announcement forms say of the status pages picked on them, once
 * the server has said what is true for those pages (#9775,
 * useAnnouncementReach): the folded Schedule & Notifications line (Schedule
 * on the Edit), and why nobody would be told under a ticked notify box. The
 * words are AnnouncementForm's; each place asks for itself, and one answer
 * serves them all.
 */

/*
 * The folded section's line, on the form and on the review step
 * (FormFieldCollapsibleSection.getSummaryElement): the sentences of
 * getAnnouncementScheduleSectionSummary for the pages picked, each looked
 * up on its own, as the section draws its sentences.
 */
export const AnnouncementScheduleLine: FunctionComponent<{
  values: unknown;
  kind: AnnouncementFormKind;
  // The announcement an Edit edits: asked about as it will be saved.
  announcementId?: ObjectID | string | null | undefined;
}> = (props: {
  values: unknown;
  kind: AnnouncementFormKind;
  announcementId?: ObjectID | string | null | undefined;
}): ReactElement => {
  const { translateString } = useTranslateValue();

  const { reach }: AnnouncementReachState = useAnnouncementReach(
    getAnnouncementReachQuestion({
      values: props.values,
      announcementId: props.announcementId,
    }),
  );

  const sentences: Array<string> = getAnnouncementScheduleSectionSummary(
    props.values,
    props.kind,
    reach,
  );

  // Each sentence on its own: a locale translates sentences, not a paragraph.
  return (
    <span data-testid="announcement-schedule-line">
      {sentences
        .map((sentence: string): string => {
          return translateString(sentence) ?? sentence;
        })
        .join(" ")}
    </span>
  );
};

/*
 * Under a notify box, while it is ticked and the server has said nobody
 * would be told: why, in the amber note the form's other warnings under a
 * field use. Nothing otherwise - the box's own description says what
 * ticking it does.
 */
export const AnnouncementNotifyBoxReason: FunctionComponent<{
  values: unknown;
  // The box's value in the form: its column, or the Edit's misc key.
  fieldKey: string;
  isTickedByDefault: boolean;
  announcementId?: ObjectID | string | null | undefined;
  dataTestId: string;
}> = (props: {
  values: unknown;
  fieldKey: string;
  isTickedByDefault: boolean;
  announcementId?: ObjectID | string | null | undefined;
  dataTestId: string;
}): ReactElement => {
  const { translateString } = useTranslateValue();

  const { reach }: AnnouncementReachState = useAnnouncementReach(
    getAnnouncementReachQuestion({
      values: props.values,
      announcementId: props.announcementId,
    }),
  );

  const reason: string | null = getAnnouncementNotifyBoxReason({
    values: props.values,
    fieldKey: props.fieldKey,
    isTickedByDefault: props.isTickedByDefault,
    reach: reach,
  });

  if (!reason) {
    return <></>;
  }

  return (
    <ScopeNotice
      text={translateString(reason) || reason}
      dataTestId={props.dataTestId}
    />
  );
};
