import Incident from "../../../Models/DatabaseModels/Incident";
import { INCIDENT_DECLARED_BY_HAND_KEY } from "../../../Types/Incident/IncidentDeclaredByHandStart";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentDeclaredByHandStartReader from "../Incident/IncidentDeclaredByHandStartReader";
import logger from "../Logger";

/*
 * "START INCIDENTS DECLARED BY HAND ACKNOWLEDGED" ON THE CHATS' DECLARE
 * INCIDENT FORMS (#11137, Common/Types/Incident/IncidentDeclaredByHandStart).
 *
 * Slack's New Incident form and Microsoft Teams' Create New Incident card
 * are declare forms, as Declare Incident in the dashboard is: whoever fills
 * one in is declaring the incident by hand. So both send
 * miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY] with the create, and
 * IncidentService starts the incident as the project says - acknowledged,
 * with the switch on, when the form picked no on-call policy. Neither form
 * asks for a state, so nothing else names one.
 *
 * What the person reads, while the switch is on:
 *
 *   - under the on-call policies, before they submit: leaving them empty
 *     starts the incident acknowledged, so no one is paged;
 *   - in the confirmation, after: it was acknowledged as it was declared,
 *     so no one was paged - said only of an incident that did start
 *     acknowledged, read from the incident as created.
 *
 * Mattermost has no Declare Incident form, so it has nothing to send. The
 * words are in English, as every other chat answer is
 * (WorkspaceActionAnswers, WorkspaceIncidentSubscriberNotification).
 */

export const WORKSPACE_DECLARED_BY_HAND_TEXT: {
  onCallPoliciesHint: string;
  startedAcknowledged: string;
} = {
  onCallPoliciesHint:
    "Leave empty and the incident starts acknowledged, so no one is paged.",
  startedAcknowledged: "Acknowledged as it was declared, so no one was paged.",
};

export default class WorkspaceIncidentDeclaredByHand {
  /*
   * The misc data a chat's declare form creates its incident with: what it
   * sends already (an alert to link, say), saying that it is declared by
   * hand.
   */
  public static withDeclaredByHand(
    miscDataProps?: JSONObject | undefined,
  ): JSONObject {
    return {
      ...(miscDataProps || {}),
      [INCIDENT_DECLARED_BY_HAND_KEY]: true,
    };
  }

  /*
   * Whether the project starts incidents declared by hand acknowledged, read
   * once per form, as OneUptime. Off when it cannot be read: the form then
   * says nothing about it, and opening it never fails over it.
   */
  public static async readIsOn(projectId: ObjectID): Promise<boolean> {
    return await IncidentDeclaredByHandStartReader.isOn(projectId);
  }

  // The hint under the on-call policies: only while the switch is on.
  public static getOnCallPoliciesHint(isSwitchOn: boolean): string | undefined {
    return isSwitchOn
      ? WORKSPACE_DECLARED_BY_HAND_TEXT.onCallPoliciesHint
      : undefined;
  }

  /*
   * The confirmation's line about where the incident started, from the
   * incident as created: said only when it started acknowledged, which a
   * chat's form - it picks no state - leaves to the switch alone. Null
   * otherwise, and when its state cannot be read: the confirmation never
   * guesses, and never fails over it.
   */
  public static async getConfirmationLine(data: {
    projectId: ObjectID;
    created: Incident;
  }): Promise<MarkdownText | null> {
    const incidentStateId: ObjectID | undefined =
      data.created.currentIncidentStateId;

    if (!incidentStateId || !incidentStateId.toString()) {
      return null;
    }

    try {
      const isAcknowledged: boolean =
        await IncidentStateService.isAcknowledgedIncidentState({
          projectId: data.projectId,
          incidentStateId: incidentStateId,
        });

      return isAcknowledged
        ? mdText`${WORKSPACE_DECLARED_BY_HAND_TEXT.startedAcknowledged}`
        : null;
    } catch (err) {
      logger.debug(
        "Could not read whether an incident declared from a chat started acknowledged",
      );
      logger.debug(err);
      return null;
    }
  }
}
