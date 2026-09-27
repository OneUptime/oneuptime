import {
  fetchIncidentCustomFieldDefinitions,
  IncidentCustomFieldDefinition,
} from "./IncidentCustomFieldDefinitions";
import { fetchSubscriberAudience } from "./useSubscriberAudience";
import Incident from "Common/Models/DatabaseModels/Incident";
import Label from "Common/Models/DatabaseModels/Label";
import ObjectID from "Common/Types/ObjectID";
import {
  IncidentSubscriberAudienceResult,
  IncidentSubscriberAudienceStatusPage,
} from "Common/Types/StatusPage/IncidentSubscriberAudience";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  buildIncidentNoteTemplateVariables,
  NoteTemplateVariables,
} from "Common/Utils/Incident/IncidentNoteTemplateVariables";

/*
 * The values for an incident note template's {{placeholders}}, read when a
 * template is picked in the incident's notes so they are the incident's
 * values at that moment (see Common/Utils/Incident/IncidentNoteTemplateVariables
 * for the placeholders and how each value is written).
 *
 * Each part is read on its own and may fail on its own: custom fields need a
 * billing plan and a permission, and the status pages a permission of their
 * own. Whatever could not be read leaves its placeholders as written, for the
 * author to fill in, rather than blank.
 */

export const INCIDENT_NOTE_TEMPLATE_INCIDENT_SELECT: {
  title: true;
  incidentNumber: true;
  incidentNumberWithPrefix: true;
  declaredAt: true;
  customFields: true;
  incidentSeverity: { name: true };
  currentIncidentState: { name: true };
  labels: { name: true };
} = {
  title: true,
  incidentNumber: true,
  incidentNumberWithPrefix: true,
  declaredAt: true,
  customFields: true,
  incidentSeverity: { name: true },
  currentIncidentState: { name: true },
  labels: { name: true },
};

export const fetchIncidentNoteTemplateVariables: (
  incidentId: ObjectID,
) => Promise<NoteTemplateVariables> = async (
  incidentId: ObjectID,
): Promise<NoteTemplateVariables> => {
  const [incidentResult, definitionsResult, audienceResult]: [
    PromiseSettledResult<Incident | null>,
    PromiseSettledResult<Array<IncidentCustomFieldDefinition>>,
    PromiseSettledResult<IncidentSubscriberAudienceResult>,
  ] = await Promise.allSettled([
    ModelAPI.getItem<Incident>({
      modelType: Incident,
      id: incidentId,
      select: INCIDENT_NOTE_TEMPLATE_INCIDENT_SELECT,
    }),
    fetchIncidentCustomFieldDefinitions(),
    fetchSubscriberAudience({ incidentId: incidentId.toString() }),
  ]);

  // Without the incident there is nothing to fill in.
  if (incidentResult.status !== "fulfilled" || !incidentResult.value) {
    return {};
  }

  const incident: Incident = incidentResult.value;

  return buildIncidentNoteTemplateVariables({
    title: incident.title,
    incidentNumber: incident.incidentNumber,
    incidentNumberWithPrefix: incident.incidentNumberWithPrefix,
    severityName: incident.incidentSeverity?.name,
    stateName: incident.currentIncidentState?.name,
    declaredAt: incident.declaredAt,
    labelNames: (incident.labels || []).map((label: Label): string => {
      return label.name || "";
    }),
    /*
     * The status pages the incident shows on and notifies, the same answer
     * the "Will notify" summary shows: its monitors' pages, narrowed to its
     * scope. Only pages the author can see are named.
     */
    affectedStatusPageNames:
      audienceResult.status === "fulfilled"
        ? audienceResult.value.statusPages.map(
            (page: IncidentSubscriberAudienceStatusPage): string => {
              return page.name;
            },
          )
        : undefined,
    customFields: incident.customFields,
    customFieldDefinitions:
      definitionsResult.status === "fulfilled"
        ? definitionsResult.value
        : undefined,
  });
};
