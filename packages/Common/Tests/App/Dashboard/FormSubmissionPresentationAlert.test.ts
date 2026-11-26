import { describe, expect, test } from "@jest/globals";
import Alert from "../../../Models/DatabaseModels/Alert";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import FormTargetType from "../../../Types/Form/FormTargetType";
import {
  FormSubmissionCreatedLink,
  getFormSubmissionCreatedLink,
  getFormSubmissionTargetType,
  isFormSubmissionAlertHidden,
  isFormSubmissionIncidentHidden,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Submissions/FormSubmissionPresentation";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";

/*
 * A submission's Created column, for an alert form's submissions (#10760):
 * the alert it created, linked to the alert's page by its number; one the
 * reader may not see - a private alert the read left out - shown as hidden
 * rather than as deleted; one deleted since, with nothing to link.
 */

const ALERT_ID: string = "a0000000-0000-4000-8000-000000000001";
const INCIDENT_ID: string = "a0000000-0000-4000-8000-000000000002";
const EVENT_ID: string = "a0000000-0000-4000-8000-000000000003";

function submission(data: Partial<FormSubmission>): FormSubmission {
  return Object.assign(new FormSubmission(), data);
}

function alert(data: Partial<Alert> = {}): Alert {
  return Object.assign(new Alert(), { _id: ALERT_ID, ...data });
}

describe("getFormSubmissionTargetType", () => {
  test("an alert form's submission is an alert's, by its target or by what it links", () => {
    expect(
      getFormSubmissionTargetType(
        submission({ targetType: FormTargetType.Alert }),
      ),
    ).toBe(FormTargetType.Alert);
    expect(
      getFormSubmissionTargetType(submission({ alertId: ALERT_ID as never })),
    ).toBe(FormTargetType.Alert);
    expect(getFormSubmissionTargetType(submission({ alert: alert() }))).toBe(
      FormTargetType.Alert,
    );
  });

  test("the other targets stay theirs", () => {
    expect(
      getFormSubmissionTargetType(
        submission({ targetType: FormTargetType.Incident }),
      ),
    ).toBe(FormTargetType.Incident);
    expect(
      getFormSubmissionTargetType(
        submission({ scheduledMaintenanceId: EVENT_ID as never }),
      ),
    ).toBe(FormTargetType.ScheduledMaintenance);
    // A submission read without its target is an incident's, as before.
    expect(getFormSubmissionTargetType(submission({}))).toBe(
      FormTargetType.Incident,
    );
  });
});

describe("isFormSubmissionAlertHidden", () => {
  test("an alert the read left out - a private one the reader may not see - is hidden", () => {
    expect(
      isFormSubmissionAlertHidden(
        submission({
          targetType: FormTargetType.Alert,
          alertId: ALERT_ID as never,
        }),
      ),
    ).toBe(true);
  });

  test("an alert the reader may see is not, nor one deleted since, nor another target's record", () => {
    expect(
      isFormSubmissionAlertHidden(
        submission({
          targetType: FormTargetType.Alert,
          alertId: ALERT_ID as never,
          alert: alert(),
        }),
      ),
    ).toBe(false);
    // Deleted since: the key set its id to null.
    expect(
      isFormSubmissionAlertHidden(
        submission({ targetType: FormTargetType.Alert }),
      ),
    ).toBe(false);
    expect(
      isFormSubmissionAlertHidden(
        submission({
          targetType: FormTargetType.Incident,
          incidentId: INCIDENT_ID as never,
        }),
      ),
    ).toBe(false);
  });

  test("an alert's submission is never taken for a hidden incident", () => {
    expect(
      isFormSubmissionIncidentHidden(
        submission({
          targetType: FormTargetType.Alert,
          alertId: ALERT_ID as never,
        }),
      ),
    ).toBe(false);
  });
});

describe("getFormSubmissionCreatedLink", () => {
  test("links the alert's page by its number with prefix", () => {
    const link: FormSubmissionCreatedLink | null = getFormSubmissionCreatedLink(
      submission({
        targetType: FormTargetType.Alert,
        alertId: ALERT_ID as never,
        alert: alert({ alertNumber: 7, alertNumberWithPrefix: "ALT-7" }),
      }),
    );

    expect(link?.id.toString()).toBe(ALERT_ID);
    expect(link?.reference).toBe("ALT-7");
    expect(link?.pageMap).toBe(PageMap.ALERT_VIEW);
    expect(link?.kindTitle).toBe("Alert");
  });

  test("by #N when the project has no prefix, and by its id alone when the alert was not read", () => {
    expect(
      getFormSubmissionCreatedLink(
        submission({
          targetType: FormTargetType.Alert,
          alert: alert({ alertNumber: 12 }),
        }),
      )?.reference,
    ).toBe("#12");

    const unread: FormSubmissionCreatedLink | null =
      getFormSubmissionCreatedLink(
        submission({
          targetType: FormTargetType.Alert,
          alertId: ALERT_ID as never,
        }),
      );

    expect(unread?.id.toString()).toBe(ALERT_ID);
    expect(unread?.reference).toBe("");
  });

  test("nothing to link once the alert was deleted", () => {
    expect(
      getFormSubmissionCreatedLink(
        submission({ targetType: FormTargetType.Alert }),
      ),
    ).toBeNull();
  });

  test("an incident's and an event's submissions still link their own pages", () => {
    expect(
      getFormSubmissionCreatedLink(
        submission({
          targetType: FormTargetType.Incident,
          incident: Object.assign(new Incident(), {
            _id: INCIDENT_ID,
            incidentNumberWithPrefix: "INC-3",
          }),
        }),
      )?.pageMap,
    ).toBe(PageMap.INCIDENT_VIEW);
    expect(
      getFormSubmissionCreatedLink(
        submission({
          targetType: FormTargetType.ScheduledMaintenance,
          scheduledMaintenance: Object.assign(new ScheduledMaintenance(), {
            _id: EVENT_ID,
          }),
        }),
      )?.pageMap,
    ).toBe(PageMap.SCHEDULED_MAINTENANCE_VIEW);
  });
});
