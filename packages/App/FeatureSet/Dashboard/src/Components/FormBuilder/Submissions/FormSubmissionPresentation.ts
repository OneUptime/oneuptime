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
    email: submission.submitterEmail
      ? submission.submitterEmail.toString()
      : "",
  };
};

/*
 * What a submission created: its stored target, or the record it links -
 * a maintenance event, then an alert - and an incident otherwise.
 */
export const getFormSubmissionTargetType: (
  submission: FormSubmission,
) => FormTargetType = (submission: FormSubmission): FormTargetType => {
  if (
    submission.targetType === FormTargetType.ScheduledMaintenance ||
    Boolean(submission.scheduledMaintenanceId || submission.scheduledMaintenance)
  ) {
    return FormTargetType.ScheduledMaintenance;
  }

  if (
    submission.targetType === FormTargetType.Alert ||
    Boolean(submission.alertId || submission.alert)
  ) {
    return FormTargetType.Alert;
  }

  return FormTargetType.Incident;
};

/*
 * Whether the incident a submission created is one the reader may not see,
 * for a submission read with its incident selected (as the submissions
 * table reads it): the submission still names it, but the server read it
 * back without the incident - a private one, which only its owners, Project
 * Owners and Project Admins see (#9102). Shown as a private incident, with
 * no link to a page they cannot open. A maintenance event is never private.
 */
export const isFormSubmissionIncidentHidden: (
  submission: FormSubmission,
) => boolean = (submission: FormSubmission): boolean => {
  return (
    getFormSubmissionTargetType(submission) === FormTargetType.Incident &&
    Boolean(submission.incidentId) &&
    !submission.incident
  );
};

/*
 * The same for an alert: one a privacy rule made private after a form
 * created it is read back without the alert by a reader who may not see
 * it. Shown as a private alert, with no link.
 */
export const isFormSubmissionAlertHidden: (
  submission: FormSubmission,
) => boolean = (submission: FormSubmission): boolean => {
  return (
    getFormSubmissionTargetType(submission) === FormTargetType.Alert &&
    Boolean(submission.alertId) &&
    !submission.alert
  );
};

export interface FormSubmissionCreatedLink {
  id: ObjectID;
  // "INC-42", "#7".
  reference: string;
  pageMap:
    | PageMap.INCIDENT_VIEW
    | PageMap.ALERT_VIEW
    | PageMap.SCHEDULED_MAINTENANCE_VIEW;
  // "Incident", "Alert", "Scheduled Maintenance", to put before the reference.
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
 * What the submission created, to link to: the incident, the alert or the
 * scheduled maintenance event, by its number - or null once it is deleted
 * (the link on the submission is cleared with it).
 */
export const getFormSubmissionCreatedLink: GetFormSubmissionCreatedLinkFunction =
  (submission: FormSubmission): FormSubmissionCreatedLink | null => {
    const targetType: FormTargetType = getFormSubmissionTargetType(submission);

    if (targetType === FormTargetType.ScheduledMaintenance) {
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

    if (targetType === FormTargetType.Alert) {
      const id: string | undefined =
        submission.alert?._id?.toString() || submission.alertId?.toString();

      if (!id) {
        return null;
      }

      return {
        id: new ObjectID(id),
        reference: getReference(
          submission.alert?.alertNumberWithPrefix,
          submission.alert?.alertNumber,
        ),
        pageMap: PageMap.ALERT_VIEW,
        kindTitle: FORM_TARGET_TYPE_TEXT[FormTargetType.Alert].title,
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
