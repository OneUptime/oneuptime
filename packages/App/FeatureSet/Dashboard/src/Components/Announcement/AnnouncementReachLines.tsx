import ObjectID from "Common/Types/ObjectID";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import { ScopeNotice } from "../Incident/IncidentStatusPageScopeNotices";
import {
  AnnouncementFormKind,
  getAnnouncementNoMonitorsSummary,
  getAnnouncementNotifyBoxReason,
  getAnnouncementReachQuestion,
  getAnnouncementScheduleSectionSummary,
  getAnnouncementUpdateBoxReason,
} from "./AnnouncementForm";
import useAnnouncementReach, {
  AnnouncementReachState,
} from "./useAnnouncementReach";

/*
 * What the announcement forms say of the status pages picked on them, once
 * the server has said what is true for those pages (#9775,
 * useAnnouncementReach): the folded Schedule & Notifications line (Schedule
 * on the Edit), and why nobody would be told under a ticked notify box -
 * on the Edit's update box, the announcement's own state first (#9921).
 * The words are AnnouncementForm's; each place asks for itself, and one
 * answer serves them all.
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

/*
 * Under the Edit's "Notify subscribers about this update", while it is
 * ticked: why the update would not be sent - the announcement's own state
 * first (not shown until its start, or its own notification not gone out
 * yet, #9921), then the status pages picked - in the same amber note.
 * Nothing while it would be sent, or while the box is unticked.
 */
export const AnnouncementUpdateBoxReason: FunctionComponent<{
  values: unknown;
  announcementId: ObjectID | string | null | undefined;
  dataTestId: string;
}> = (props: {
  values: unknown;
  announcementId: ObjectID | string | null | undefined;
  dataTestId: string;
}): ReactElement => {
  const { translateString } = useTranslateValue();

  const { reach }: AnnouncementReachState = useAnnouncementReach(
    getAnnouncementReachQuestion({
      values: props.values,
      announcementId: props.announcementId,
    }),
  );

  const reason: string | null = getAnnouncementUpdateBoxReason({
    values: props.values,
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

/*
 * Monitors Affected on the review step, with no monitor picked: that every
 * subscriber is told only while the Schedule & Notifications line says
 * subscribers are notified (getAnnouncementNoMonitorsSummary).
 */
export const AnnouncementNoMonitorsLine: FunctionComponent<{
  values: unknown;
  kind: AnnouncementFormKind;
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

  const sentence: string = getAnnouncementNoMonitorsSummary(
    props.values,
    props.kind,
    reach,
  );

  return (
    <p data-testid="announcement-no-monitors-line">
      {translateString(sentence) ?? sentence}
    </p>
  );
};
