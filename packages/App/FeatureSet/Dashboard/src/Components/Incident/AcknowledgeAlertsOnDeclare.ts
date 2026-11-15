import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import { translationKey } from "Common/Types/Translator";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

/*
 * The "acknowledge the alerts" box on the create-incident page, when an
 * incident is declared from alerts. Declaring links the alerts but does not
 * acknowledge them, and only acknowledging an alert stops its own on-call
 * escalation, so the page offers to do both at once.
 *
 * This file holds who may tick the box; what the box and its notes say, in
 * the reader's language, is AcknowledgeAlertsOnDeclareWords (#7513), which
 * the create page reads through here too.
 */

export * from "./AcknowledgeAlertsOnDeclareWords";

const ACKNOWLEDGE_GATE_OPTIONS: PermissionGateOptions = {
  verb: "acknowledge",
  singularName: "alert",
  /*
   * The reason's first sentence, whole: built from the verb-and-name
   * template, it left "acknowledge" in English, a verb no locale words on
   * its own.
   */
  sentence: translationKey(
    "You do not have permission to acknowledge this alert.",
  ),
};

/*
 * Acknowledging an alert from its own page is one write as the person: a
 * new state timeline row. The alert then takes the new state from OneUptime
 * itself, so it takes no permission to edit the alert. Acknowledging the
 * alerts as the incident is declared takes the same, and the server checks
 * the same for each alert it acknowledges (AlertStateChangeAuthorization) -
 * so the box asks for the timeline's create permission and nothing else.
 * The reason reads "You do not have permission to acknowledge this
 * alert..." rather than naming the timeline model, in the reader's language
 * (PermissionGate translates it).
 */
export const getAcknowledgeAlertsGate: () => PermissionGateResult =
  (): PermissionGateResult => {
    return PermissionGate.check(
      new AlertStateTimeline(),
      ModelAction.Create,
      ACKNOWLEDGE_GATE_OPTIONS,
    );
  };
