import Incident from "Common/Models/DatabaseModels/Incident";
import OneUptimeDate from "Common/Types/Date";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import MarkdownUtil from "Common/UI/Utils/Markdown";

/*
 * The incident postmortem's form: what the postmortem says, then whether it
 * goes on the status page. The card's Edit Postmortem Note and the editor a
 * template or an AI draft opens in are this one form.
 */
export const INCIDENT_POSTMORTEM_FORM_STEPS: Array<FormStep<Incident>> = [
  { title: "Postmortem", id: "postmortem" },
  { title: "Status Page", id: "status-page" },
];

/*
 * While publishing is on, the form keeps here the Published At the
 * postmortem had before it was switched on, so switching it off again puts
 * that back. Not a column: ModelForm sends only the form's own fields.
 */
export const POSTED_AT_BEFORE_PUBLISHING_KEY: string =
  "postmortemPostedAtBeforePublishing";

/*
 * The form's values once Publish on Status Page is switched on or off.
 *
 * On: Published At is what the status page shows next to the postmortem,
 * and it is also when the postmortem counts as published for the "time to
 * postmortem" metric and measurements. So it starts at now, unless the
 * postmortem has one already (it was published before), which it keeps.
 *
 * Off: Published At is not asked for, and goes back to what it was before
 * publishing was switched on in this form, so trying the switch and
 * changing one's mind saves no publishing time. A postmortem that was
 * published before keeps its time, as the form never changed it.
 */
export function getPostmortemValuesWhenPublishingChanges(
  values: FormValues<Incident>,
  isPublishing: boolean,
  now: Date,
): FormValues<Incident> {
  const current: Record<string, unknown> = {
    ...(values as Record<string, unknown>),
  };

  if (isPublishing) {
    if (
      !Object.prototype.hasOwnProperty.call(
        current,
        POSTED_AT_BEFORE_PUBLISHING_KEY,
      )
    ) {
      current[POSTED_AT_BEFORE_PUBLISHING_KEY] =
        current["postmortemPostedAt"] ?? null;
    }

    if (!current["postmortemPostedAt"]) {
      current["postmortemPostedAt"] = now;
    }

    return current as FormValues<Incident>;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      current,
      POSTED_AT_BEFORE_PUBLISHING_KEY,
    )
  ) {
    current["postmortemPostedAt"] = current[POSTED_AT_BEFORE_PUBLISHING_KEY];
    delete current[POSTED_AT_BEFORE_PUBLISHING_KEY];
  }

  return current as FormValues<Incident>;
}

type IsPublishingFunction = (values: FormValues<Incident>) => boolean;

const isPublishing: IsPublishingFunction = (
  values: FormValues<Incident>,
): boolean => {
  return Boolean(values && values.showPostmortemOnStatusPage);
};

/*
 * Publish on Status Page comes first on its step, and what only matters
 * while it is on - Notify Subscribers, then Published At - is asked only
 * then. Published At used to come first and be asked whether or not the
 * postmortem was published.
 */
export const INCIDENT_POSTMORTEM_FORM_FIELDS: Fields<Incident> = [
  {
    field: {
      postmortemNote: true,
    },
    title: "Postmortem Note",
    stepId: "postmortem",
    fieldType: FormFieldSchemaType.Markdown,
    required: false,
    placeholder: "Postmortem Note",
    description: MarkdownUtil.getMarkdownCheatsheet(
      "Capture what happened, impact, resolution, and follow-up actions.",
    ),
  },
  {
    field: {
      postmortemAttachments: true,
    },
    title: "Postmortem Attachments",
    stepId: "postmortem",
    fieldType: FormFieldSchemaType.MultipleFiles,
    required: false,
    description:
      "Upload supporting evidence (images, reports, timelines) that can be shared once the postmortem is public.",
  },
  {
    field: {
      showPostmortemOnStatusPage: true,
    },
    title: "Publish on Status Page",
    stepId: "status-page",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    description:
      "Enable to display the postmortem note and attachments as the closing update for this incident on your status page.",
    defaultValue: false,
    onChange: (
      value: boolean,
      currentValues: FormValues<Incident>,
      setNewFormValues: (values: FormValues<Incident>) => void,
    ) => {
      setNewFormValues(
        getPostmortemValuesWhenPublishingChanges(
          currentValues,
          Boolean(value),
          OneUptimeDate.getCurrentDate(),
        ),
      );
    },
  },
  {
    field: {
      notifySubscribersOnPostmortemPublished: true,
    },
    title: "Notify Subscribers",
    stepId: "status-page",
    fieldType: FormFieldSchemaType.Checkbox,
    required: false,
    description: "Notify subscribers when this postmortem is published.",
    defaultValue: true,
    showIf: isPublishing,
  },
  {
    field: {
      postmortemPostedAt: true,
    },
    title: "Postmortem Published At",
    stepId: "status-page",
    fieldType: FormFieldSchemaType.DateTime,
    required: false,
    description:
      "The time your status page shows for the postmortem. Turning on publishing sets it to now; change it to show another time.",
    placeholder: "Select date and time",
    showIf: isPublishing,
  },
];
