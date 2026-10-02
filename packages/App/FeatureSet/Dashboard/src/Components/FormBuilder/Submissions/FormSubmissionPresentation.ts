import PageMap from "../../../Utils/PageMap";
import FormSubmission from "Common/Models/DatabaseModels/FormSubmission";
import FormTargetType, {
  FORM_TARGET_TYPE_TEXT,
} from "Common/Types/Form/FormTargetType";
import ObjectID from "Common/Types/ObjectID";

/*
 * How a submission is shown in the submissions tables: who sent it, and a
 * link to what it created. Pure, so the rules are tested without a table.
 */

export type GetFormSubmissionSubmitterFunction = (
  submission: FormSubmission,
) => { name: string; email: string };

// The name and email the submitter gave; empty strings for none.
export const getFormSubmissionSubmitter: GetFormSubmissionSubmitterFunction = (
  submission: FormSubmission,
): { name: string; email: string } => {
  return {
    name: (submission.submitterName || "").trim(),
    email: submission.submitterEmail ? submission.submitterEmail.toString() : "",
  };
};

export interface FormSubmissionCreatedLink {
  id: ObjectID;
  // "INC-42", "#7".
  reference: string;
  pageMap: PageMap.INCIDENT_VIEW | PageMap.SCHEDULED_MAINTENANCE_VIEW;
  // "Incident", "Scheduled Maintenance", to put before the reference.
  kindTitle: string;
}

type ReferenceFunction = (
  withPrefix: string | undefined,
  number: number | undefined,
) => string;

const getReference: ReferenceFunction = (
  withPrefix: string | undefined,
  number: number | undefined,
): string => {
  if (withPrefix) {
    return withPrefix;
  }

  return typeof number === "number" ? `#${number}` : "";
};

export type GetFormSubmissionCreatedLinkFunction = (
  submission: FormSubmission,
) => FormSubmissionCreatedLink | null;

/**
 * What the submission created, to link to: the incident or the scheduled
 * maintenance event, by its number - or null once it is deleted (the link
 * on the submission is cleared with it).
 */
export const getFormSubmissionCreatedLink: GetFormSubmissionCreatedLinkFunction =
  (submission: FormSubmission): FormSubmissionCreatedLink | null => {
    const isMaintenance: boolean =
      submission.targetType === FormTargetType.ScheduledMaintenance ||
      Boolean(submission.scheduledMaintenanceId || submission.scheduledMaintenance);

    if (isMaintenance) {
      const id: string | undefined =
        submission.scheduledMaintenance?._id?.toString() ||
        submission.scheduledMaintenanceId?.toString();

      if (!id) {
        return null;
      }

      return {
        id: new ObjectID(id),
        reference: getReference(
          submission.scheduledMaintenance?.scheduledMaintenanceNumberWithPrefix,
          submission.scheduledMaintenance?.scheduledMaintenanceNumber,
        ),
        pageMap: PageMap.SCHEDULED_MAINTENANCE_VIEW,
        kindTitle:
          FORM_TARGET_TYPE_TEXT[FormTargetType.ScheduledMaintenance].title,
      };
    }

    const id: string | undefined =
      submission.incident?._id?.toString() || submission.incidentId?.toString();

    if (!id) {
      return null;
    }

    return {
      id: new ObjectID(id),
      reference: getReference(
        submission.incident?.incidentNumberWithPrefix,
        submission.incident?.incidentNumber,
      ),
      pageMap: PageMap.INCIDENT_VIEW,
      kindTitle: FORM_TARGET_TYPE_TEXT[FormTargetType.Incident].title,
    };
  };
