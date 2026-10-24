import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import {
  AiContextActivity,
  AiContextRule,
  composeAiContext,
  readAiContext,
} from "../../../../Types/AI/AiContext";
import ObjectID from "../../../../Types/ObjectID";
import PromptText from "../../../../Utils/AI/PromptText";
import AlertService from "../../../Services/AlertService";
import AutoRemediationRuleService from "../../../Services/AutoRemediationRuleService";
import IncidentService from "../../../Services/IncidentService";
import ProjectService from "../../../Services/ProjectService";
import logger from "../../Logger";
import InvestigationRules from "../SRE/InvestigationRules";

/*
 * WHAT A RUN READS OF ITS PROJECT'S AI CONTEXT (Types/AI/AiContext): the
 * project's own, and the AI rules' that started the run.
 *
 *   - Every run reads its project's - the project the run belongs to, read
 *     by that project's id and nothing else, so one project's notes never
 *     reach another's prompts.
 *   - An investigation adds the AI context of the rules that investigate
 *     its incident (or alert) and match it (forIncident, forAlert), and a
 *     fix adds its own rule's (forRule).
 *
 * Notes only add to what a run knows. So every read here fails OPEN: a
 * project or rules that cannot be read leave the run with what could be
 * read - and with nothing, the run is exactly the run it was before AI
 * contexts existed.
 *
 * What the model is given is what the run records: embedded data (an image
 * pasted as base64) is left out of the text before it is composed
 * (PromptText), as it is from every other text a model reads.
 */

// What a rule matches an incident on (as the investigation's gate reads it).
const INCIDENT_RULE_SELECT: {
  _id: true;
  title: true;
  description: true;
  incidentSeverityId: true;
  labels: { _id: true };
  monitors: { _id: true };
} = {
  _id: true,
  title: true,
  description: true,
  incidentSeverityId: true,
  labels: { _id: true },
  monitors: { _id: true },
};

// What a rule matches an alert on (as the investigation's gate reads it).
const ALERT_RULE_SELECT: {
  _id: true;
  title: true;
  description: true;
  alertSeverityId: true;
  monitorId: true;
  labels: { _id: true };
} = {
  _id: true,
  title: true,
  description: true,
  alertSeverityId: true,
  monitorId: true,
  labels: { _id: true },
};

export default class AiContextReader {
  /*
   * The project's own AI context, as text a run can read, or "" when it has
   * none - or cannot be read.
   */
  public static async readProjectContext(projectId: ObjectID): Promise<string> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: { aiContext: true },
        props: { isRoot: true },
      });

      return readAiContext(project?.aiContext);
    } catch (error) {
      logger.error(
        `AI: could not read the AI context of project ${projectId.toString()}; running without it: ${error}`,
      );
      return "";
    }
  }

  /*
   * What a run reads: the project's AI context, then the given rules'
   * (composeAiContext), or null when there is nothing to read.
   */
  public static async read(data: {
    projectId: ObjectID;
    rules?: Array<AiContextRule> | undefined;
  }): Promise<AiContextActivity | null> {
    const projectContext: string = await this.readProjectContext(
      data.projectId,
    );

    return composeAiContext({
      projectContext: PromptText.omitEmbeddedData(projectContext).text,
      rules: (data.rules || []).map((rule: AiContextRule): AiContextRule => {
        return {
          ...rule,
          aiContext: PromptText.omitEmbeddedData(readAiContext(rule.aiContext))
            .text,
        };
      }),
    });
  }

  /*
   * The AI rules that investigate this incident and match it, with their AI
   * context: what an investigation of it - or a question about one - reads
   * after the project's.
   */
  public static async forIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<Array<AiContextRule>> {
    try {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: { _id: data.incidentId.toString(), projectId: data.projectId },
        select: INCIDENT_RULE_SELECT,
        props: { isRoot: true },
      });

      if (!incident) {
        return [];
      }

      return await InvestigationRules.getIncidentAiContextRules({
        projectId: data.projectId,
        incident,
      });
    } catch (error) {
      logger.error(
        `AI: could not read which AI rules' AI context incident ${data.incidentId.toString()} matches; using the project's AI context alone: ${error}`,
      );
      return [];
    }
  }

  // The same, for an alert.
  public static async forAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<Array<AiContextRule>> {
    try {
      const alert: Alert | null = await AlertService.findOneBy({
        query: { _id: data.alertId.toString(), projectId: data.projectId },
        select: ALERT_RULE_SELECT,
        props: { isRoot: true },
      });

      if (!alert) {
        return [];
      }

      return await InvestigationRules.getAlertAiContextRules({
        projectId: data.projectId,
        alert,
      });
    } catch (error) {
      logger.error(
        `AI: could not read which AI rules' AI context alert ${data.alertId.toString()} matches; using the project's AI context alone: ${error}`,
      );
      return [];
    }
  }

  /*
   * The AI context of the rule a fix works for: the rule that matched and
   * started it. None for a fix no rule started - a cluster's or host's own
   * round, or the project's own pick with no rule set up.
   */
  public static async forRule(data: {
    projectId: ObjectID;
    autoRemediationRuleId?: ObjectID | null | undefined;
  }): Promise<Array<AiContextRule>> {
    if (!data.autoRemediationRuleId) {
      return [];
    }

    try {
      const rule: AutoRemediationRule | null =
        await AutoRemediationRuleService.findOneBy({
          query: {
            _id: data.autoRemediationRuleId.toString(),
            projectId: data.projectId,
          },
          select: { _id: true, name: true, aiContext: true },
          props: { isRoot: true },
        });

      if (!rule || !readAiContext(rule.aiContext)) {
        return [];
      }

      return [
        {
          id: data.autoRemediationRuleId.toString(),
          name: rule.name || "",
          aiContext: rule.aiContext,
        },
      ];
    } catch (error) {
      logger.error(
        `AI: could not read the AI context of AI rule ${data.autoRemediationRuleId.toString()}; fixing with the project's AI context alone: ${error}`,
      );
      return [];
    }
  }
}
