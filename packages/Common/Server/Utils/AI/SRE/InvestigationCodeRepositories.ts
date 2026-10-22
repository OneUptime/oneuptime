import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import {
  CodeRepositoryAllowance,
  NO_CODE_REPOSITORY,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../../Types/ObjectID";
import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import logger from "../../Logger";
import InvestigationRules from "./InvestigationRules";

/*
 * THE CODE REPOSITORIES AN INVESTIGATION MAY READ, for its run: the ones
 * the investigation rules matching the incident (or alert) name - every
 * connected repository with no rule, or with a matching rule that names
 * none (InvestigationRules, CodeRepositoryAllowance). The run's code tools
 * read only those (ToolContext.codeRepositoryAllowance).
 *
 * An investigation reads code through the repository's GitHub App, from
 * OneUptime itself: it clones nothing and runs nothing, so no Runner is
 * involved, and none is picked for it.
 *
 * Fails closed: a subject or rules that cannot be read leave the run
 * reading no repository - a rule might have kept one out - while every
 * other tool still works.
 */

// What an investigation rule matches an incident on (as the gate reads it).
const INCIDENT_RULE_SELECT: {
  title: true;
  description: true;
  incidentSeverityId: true;
  labels: { _id: true };
  monitors: { _id: true };
} = {
  title: true,
  description: true,
  incidentSeverityId: true,
  labels: { _id: true },
  monitors: { _id: true },
};

// What an investigation rule matches an alert on (as the gate reads it).
const ALERT_RULE_SELECT: {
  title: true;
  description: true;
  alertSeverityId: true;
  labels: { _id: true };
  monitorId: true;
} = {
  title: true,
  description: true,
  alertSeverityId: true,
  labels: { _id: true },
  monitorId: true,
};

export default class InvestigationCodeRepositories {
  public static async forIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<CodeRepositoryAllowance> {
    try {
      const incident: Incident | null = await IncidentService.findOneById({
        id: data.incidentId,
        select: INCIDENT_RULE_SELECT,
        props: { isRoot: true },
      });

      if (!incident) {
        return NO_CODE_REPOSITORY;
      }

      return await InvestigationRules.getIncidentCodeRepositoryAllowance({
        projectId: data.projectId,
        incident,
      });
    } catch (error) {
      logger.error(
        `AI: could not read which code repositories incident ${data.incidentId.toString()} may use; investigating it without code: ${error}`,
      );
      return NO_CODE_REPOSITORY;
    }
  }

  public static async forAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<CodeRepositoryAllowance> {
    try {
      const alert: Alert | null = await AlertService.findOneById({
        id: data.alertId,
        select: ALERT_RULE_SELECT,
        props: { isRoot: true },
      });

      if (!alert) {
        return NO_CODE_REPOSITORY;
      }

      return await InvestigationRules.getAlertCodeRepositoryAllowance({
        projectId: data.projectId,
        alert,
      });
    } catch (error) {
      logger.error(
        `AI: could not read which code repositories alert ${data.alertId.toString()} may use; investigating it without code: ${error}`,
      );
      return NO_CODE_REPOSITORY;
    }
  }
}
