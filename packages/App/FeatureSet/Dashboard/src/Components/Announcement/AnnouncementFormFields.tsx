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
import MarkdownUtil from "Common/UI/Utils/Markdown";
import { translateText } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";
import FetchMonitors from "../Monitor/FetchMonitors";
import FetchStatusPages from "../StatusPage/FetchStatusPages";
import { getStatusPageSuggestionsFooter } from "../StatusPage/StatusPageSuggestions";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import { getNotifySubscribersOfUpdateFormField } from "../StatusPageSubscribers/SubscriberUpdateNotificationFormField";
import {
  AnnouncementFormKind,
  getAnnouncementEndsAtError,
  getAnnouncementScheduleSection,
  readRecordIds,
} from "./AnnouncementForm";

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

// Built once: BasicForm folds the fields next to each other that carry one.
const advancedSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
  getAdvancedFormSection<StatusPageAnnouncement>();

const createScheduleSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
  getAnnouncementScheduleSection<StatusPageAnnouncement>(
    AnnouncementFormKind.Create,
  );

const editScheduleSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
  getAnnouncementScheduleSection<StatusPageAnnouncement>(
    AnnouncementFormKind.Edit,
  );

/*
 * Create Announcement's fields (kind Create), or the details card Edit's
 * (kind Edit). They differ in what each form can say about subscribers:
 * Create asks whether they are told when it starts showing (folded with the
 * schedule); the Edit cannot change that, and asks instead whether this
 * edit is sent, right under the description it is about.
 */
export const getAnnouncementFormFields: (
  kind: AnnouncementFormKind,
) => Array<ModelField<StatusPageAnnouncement>> = (
  kind: AnnouncementFormKind,
): Array<ModelField<StatusPageAnnouncement>> => {
  const scheduleSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
    kind === AnnouncementFormKind.Create
      ? createScheduleSection
      : editScheduleSection;

  const fields: Array<ModelField<StatusPageAnnouncement>> = [
    {
      field: {
        title: true,
      },
      title: "Title",
      stepId: "announcement",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Announcement Title",
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
      description: MarkdownUtil.getMarkdownCheatsheet(
        "Add an announcement note",
      ),
    },
  ];

  if (kind === AnnouncementFormKind.Edit) {
    fields.push(
      getNotifySubscribersOfUpdateFormField<StatusPageAnnouncement>({
        stepId: "announcement",
        description:
          "Send subscribers the edited announcement, marked as an update. Leave this unticked for small fixes such as typos.",
      }),
    );
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
      getFooterElement: getStatusPageSuggestionsFooter<StatusPageAnnouncement>(
        {
          eventType: StatusPageEventType.Announcement,
        },
      ),
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

        if (monitorIds.length === 0) {
          return (
            <p>
              {translateText(
                "No monitors selected. All subscribers will be notified.",
              )}
            </p>
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
     * it starts showing - the model's defaults).
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
      // A new announcement shows now; an edited one keeps its own start.
      getDefaultValue: (): Date => {
        return OneUptimeDate.getCurrentDate();
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
      description:
        "Subscribers of these status pages are told when the announcement starts showing.",
      fieldType: FormFieldSchemaType.Checkbox,
      collapsibleSection: scheduleSection,
      defaultValue: true,
      required: false,
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
      placeholder: "Announcement Title",
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
      description: MarkdownUtil.getMarkdownCheatsheet(
        "Add an announcement note",
      ),
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
    {
      field: {
        shouldStatusPageSubscribersBeNotified: true,
      },
      title: "Notify Status Page Subscribers",
      stepId: "status-pages",
      description:
        "Subscribers of these status pages are told when an announcement made from this template starts showing.",
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
    },
  ];
};
