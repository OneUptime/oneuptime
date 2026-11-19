import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";
import FetchMonitors from "../Monitor/FetchMonitors";
import FetchStatusPages from "../StatusPage/FetchStatusPages";
import { getStatusPageSuggestionsFooter } from "../StatusPage/StatusPageSuggestions";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import { getNotifySubscribersOfUpdateFormField } from "../StatusPageSubscribers/SubscriberUpdateNotificationFormField";
import {
  ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY,
  AnnouncementFormKind,
  getAnnouncementEndsAtError,
  getAnnouncementReachQuestion,
  getAnnouncementScheduleSection,
  getAnnouncementScheduleSectionSummary,
  readRecordIds,
} from "./AnnouncementForm";
import {
  AnnouncementNoMonitorsLine,
  AnnouncementNotifyBoxReason,
  AnnouncementScheduleLine,
  AnnouncementUpdateBoxReason,
} from "./AnnouncementReachLines";
import { getKeptAnnouncementReach } from "./useAnnouncementReach";

/*
 * THE ANNOUNCEMENT FORMS' FIELDS, in one place: Create Announcement and the
 * announcement's details card Edit, and an announcement template's Create
 * and Edit. Each field is written once, so the forms cannot drift apart -
 * the way "Description (Optional)" did from the server, which requires one.
 * The rules behind them are in AnnouncementForm.ts.
 *
 * Common's Tests/App/Dashboard/AnnouncementFormsStructure.test.ts pins the
 * shape of all four.
 */

export const ANNOUNCEMENT_FORM_STEPS: Array<FormStep<StatusPageAnnouncement>> =
  [
    {
      title: "Announcement",
      id: "announcement",
    },
    {
      title: "Status Pages",
      id: "status-pages",
    },
  ];

/*
 * The title's example, in an announcement and in a template: what a
 * visitor reads at the top of the notice.
 */
export const ANNOUNCEMENT_TITLE_PLACEHOLDER: string = translationKey(
  "e.g., Planned maintenance on Saturday",
);

// Built once: BasicForm folds the fields next to each other that carry one.
const advancedSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
  getAdvancedFormSection<StatusPageAnnouncement>();

/*
 * The schedule's folded section (AnnouncementForm), with its line drawn by
 * AnnouncementScheduleLine: what the server says of the status pages
 * picked, asked for as the line is drawn (#9775). Its sentences, which
 * decide that it has a line, read the answer the line was given.
 */
const getScheduleSection: (data: {
  kind: AnnouncementFormKind;
  announcementId: ObjectID | string | null;
}) => FormFieldCollapsibleSection<StatusPageAnnouncement> = (data: {
  kind: AnnouncementFormKind;
  announcementId: ObjectID | string | null;
}): FormFieldCollapsibleSection<StatusPageAnnouncement> => {
  return {
    ...getAnnouncementScheduleSection<StatusPageAnnouncement>(data.kind),
    getSummary: (values: FormValues<StatusPageAnnouncement>): Array<string> => {
      return getAnnouncementScheduleSectionSummary(
        values,
        data.kind,
        getKeptAnnouncementReach(
          getAnnouncementReachQuestion({
            values: values,
            announcementId: data.announcementId,
          }),
        ),
      );
    },
    getSummaryElement: (
      values: FormValues<StatusPageAnnouncement>,
    ): ReactElement => {
      return (
        <AnnouncementScheduleLine
          values={values}
          kind={data.kind}
          announcementId={data.announcementId}
        />
      );
    },
  };
};

/*
 * Create Announcement's fields (kind Create), or the details card Edit's
 * (kind Edit, handed the announcement it edits). They differ in what each
 * form can say about subscribers: Create asks whether they are told when it
 * starts showing (folded with the schedule); the Edit cannot change that,
 * and asks instead whether this edit is sent, right under the description
 * it is about. Both say what is true for the status pages picked: the
 * folded line, and why nobody would be told under a ticked box.
 */
export const getAnnouncementFormFields: (
  kind: AnnouncementFormKind,
  options?: {
    announcementId?: ObjectID | string | null | undefined;
  },
) => Array<ModelField<StatusPageAnnouncement>> = (
  kind: AnnouncementFormKind,
  options?: {
    announcementId?: ObjectID | string | null | undefined;
  },
): Array<ModelField<StatusPageAnnouncement>> => {
  const announcementId: ObjectID | string | null =
    kind === AnnouncementFormKind.Edit ? options?.announcementId || null : null;

  const scheduleSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
    getScheduleSection({ kind: kind, announcementId: announcementId });

  const fields: Array<ModelField<StatusPageAnnouncement>> = [
    {
      field: {
        title: true,
      },
      title: "Title",
      stepId: "announcement",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      // An example, not the title again; "Title of this resource" said less.
      placeholder: ANNOUNCEMENT_TITLE_PLACEHOLDER,
      hideColumnDescription: true,
      validation: {
        minLength: 2,
      },
    },
    // Required, as the server requires it: the text people read.
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "announcement",
      fieldType: FormFieldSchemaType.Markdown,
      required: true,
      description: "Add an announcement note.",
    },
  ];

  if (kind === AnnouncementFormKind.Edit) {
    fields.push({
      ...getNotifySubscribersOfUpdateFormField<StatusPageAnnouncement>({
        stepId: "announcement",
        description:
          "Send subscribers the edited announcement, marked as an update. Leave this unticked for small fixes such as typos.",
      }),
      /*
       * Ticked, why nobody would be sent it: the announcement's own state
       * first - not shown until its start, or its own notification not gone
       * out yet (#9921) - then the pages picked, which the update goes to
       * as the announcement itself did.
       */
      getFooterElement: (
        values: FormValues<StatusPageAnnouncement>,
      ): ReactElement => {
        return (
          <AnnouncementUpdateBoxReason
            values={values}
            announcementId={announcementId}
            dataTestId="announcement-update-notify-reason"
          />
        );
      },
    });
  }

  fields.push(
    {
      field: {
        attachments: true,
      },
      title: "Attachments",
      stepId: "announcement",
      fieldType: FormFieldSchemaType.MultipleFiles,
      required: false,
      description:
        "Attach files that should be available with this announcement on the status page.",
      collapsibleSection: advancedSection,
    },
    /*
     * Under it, once monitors are picked below, the pages that show them,
     * one click to add (StatusPageSuggestions).
     */
    {
      field: {
        statusPages: true,
      },
      title: "Show announcement on these status pages",
      stepId: "status-pages",
      description: "Select status pages to show this announcement on",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: StatusPage,
        labelField: "name",
        valueField: "_id",
      },
      required: true,
      placeholder: "Select Status Pages",
      getFooterElement: getStatusPageSuggestionsFooter<StatusPageAnnouncement>({
        eventType: StatusPageEventType.Announcement,
      }),
      getSummaryElement: (
        item: FormValues<StatusPageAnnouncement>,
      ): ReactElement => {
        const statusPageIds: Array<string> = readRecordIds(item.statusPages);

        if (statusPageIds.length === 0) {
          return (
            <p>
              {translateText("No status pages selected for this announcement.")}
            </p>
          );
        }

        return (
          <div>
            <FetchStatusPages
              statusPageIds={statusPageIds.map((id: string): ObjectID => {
                return new ObjectID(id);
              })}
            />
          </div>
        );
      },
    },
    {
      field: {
        monitors: true,
      },
      title: "Monitors Affected",
      stepId: "status-pages",
      description:
        "Select monitors affected by this announcement. If none selected, all subscribers will be notified.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Monitor,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select Monitors",
      getSummaryElement: (
        item: FormValues<StatusPageAnnouncement>,
      ): ReactElement => {
        const monitorIds: Array<string> = readRecordIds(item.monitors);

        /*
         * That every subscriber is told only while the line says subscribers
         * are notified: the pages picked may tell nobody (#9775).
         */
        if (monitorIds.length === 0) {
          return (
            <AnnouncementNoMonitorsLine
              values={item}
              kind={kind}
              announcementId={announcementId}
            />
          );
        }

        return (
          <div>
            <FetchMonitors
              monitorIds={monitorIds.map((id: string): ObjectID => {
                return new ObjectID(id);
              })}
            />
          </div>
        );
      },
    },
    /*
     * Folded to one line that says what happens: it shows now and stays
     * until someone ends it (and, on Create, its subscribers are told when
     * it starts showing - the model's defaults), as far as the status pages
     * picked show announcements and send notifications (#9775).
     */
    {
      field: {
        showAnnouncementAt: true,
      },
      title: "Start Showing Announcement At",
      stepId: "status-pages",
      fieldType: FormFieldSchemaType.DateTime,
      required: true,
      placeholder: "Pick Date and Time",
      collapsibleSection: scheduleSection,
      /*
       * A new announcement shows now - from the minute the field shows, which
       * has already begun; an edited one keeps its own start.
       */
      getDefaultValue: (): Date => {
        return OneUptimeDate.getStartOfMinute(OneUptimeDate.getCurrentDate());
      },
    },
    {
      field: {
        endAnnouncementAt: true,
      },
      title: "End Showing Announcement At",
      stepId: "status-pages",
      description:
        "Leave empty to keep the announcement up until you set an end.",
      fieldType: FormFieldSchemaType.DateTime,
      required: false,
      placeholder: "Pick Date and Time",
      collapsibleSection: scheduleSection,
      customValidation: (
        values: FormValues<StatusPageAnnouncement>,
      ): string | null => {
        return getAnnouncementEndsAtError(values, kind);
      },
    },
  );

  if (kind === AnnouncementFormKind.Create) {
    fields.push({
      field: {
        shouldStatusPageSubscribersBeNotified: true,
      },
      title: "Notify Status Page Subscribers",
      stepId: "status-pages",
      // What ticking it asks for; whether that happens is the pages' to say.
      description:
        "Tell the subscribers of these status pages when the announcement starts showing.",
      fieldType: FormFieldSchemaType.Checkbox,
      collapsibleSection: scheduleSection,
      defaultValue: true,
      required: false,
      // Ticked, why nobody would be told: the pages picked say (#9775).
      getFooterElement: (
        values: FormValues<StatusPageAnnouncement>,
      ): ReactElement => {
        return (
          <AnnouncementNotifyBoxReason
            values={values}
            fieldKey={ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY}
            isTickedByDefault={true}
            dataTestId="announcement-notify-subscribers-reason"
          />
        );
      },
    });
  }

  return fields;
};

/*
 * AN ANNOUNCEMENT TEMPLATE: the announcement's steps, with the template's
 * own name and description in front. It has no schedule, so its one
 * notification switch is drawn open on Status Pages - folding a single
 * field behind a header would only add a click.
 */
export const ANNOUNCEMENT_TEMPLATE_FORM_STEPS: Array<
  FormStep<StatusPageAnnouncementTemplate>
> = [
  {
    title: "Template Info",
    id: "template-info",
  },
  {
    title: "Announcement",
    id: "announcement",
  },
  {
    title: "Status Pages",
    id: "status-pages",
  },
];

export const getAnnouncementTemplateFormFields: () => Array<
  ModelField<StatusPageAnnouncementTemplate>
> = (): Array<ModelField<StatusPageAnnouncementTemplate>> => {
  return [
    {
      field: {
        templateName: true,
      },
      title: "Template Name",
      stepId: "template-info",
      description: "Name of the announcement template",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Template Name",
    },
    {
      field: {
        templateDescription: true,
      },
      title: "Template Description",
      stepId: "template-info",
      description: "Description of the announcement template",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Template Description",
    },
    {
      field: {
        title: true,
      },
      title: "Title",
      stepId: "announcement",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: ANNOUNCEMENT_TITLE_PLACEHOLDER,
      hideColumnDescription: true,
    },
    // Required, as on the announcement itself: the server requires it.
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "announcement",
      fieldType: FormFieldSchemaType.Markdown,
      required: true,
      description: "Add an announcement note.",
    },
    /*
     * Optional here: an announcement made from it picks its pages then.
     * Suggested from the monitors, as on the announcement.
     */
    {
      field: {
        statusPages: true,
      },
      title: "Show announcement on these status pages",
      stepId: "status-pages",
      description: "Select status pages to show this announcement on",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: StatusPage,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select Status Pages",
      getFooterElement:
        getStatusPageSuggestionsFooter<StatusPageAnnouncementTemplate>({
          eventType: StatusPageEventType.Announcement,
        }),
    },
    {
      field: {
        monitors: true,
      },
      title: "Monitors Affected",
      stepId: "status-pages",
      description:
        "Select monitors affected by this announcement template. If none selected, all subscribers will be notified.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Monitor,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select Monitors",
    },
    /*
     * What ticking it asks for, as Create's switch says it: whether the
     * subscribers are told is the status pages' to say, which Create
     * Announcement does for an announcement made from it (#9921).
     */
    {
      field: {
        shouldStatusPageSubscribersBeNotified: true,
      },
      title: "Notify Status Page Subscribers",
      stepId: "status-pages",
      description:
        "Tell the subscribers of these status pages when an announcement made from this template starts showing.",
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
    },
  ];
};
