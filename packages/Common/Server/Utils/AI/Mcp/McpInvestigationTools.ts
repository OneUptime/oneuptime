import Alert from "../../../../Models/DatabaseModels/Alert";
import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import Incident from "../../../../Models/DatabaseModels/Incident";
import {
  EVERY_EXTERNAL_MCP_SERVER,
  ExternalMcpServerAllowance,
  allowsAnyExternalMcpServer,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import ObjectID from "../../../../Types/ObjectID";
import AlertService from "../../../Services/AlertService";
import ExternalMcpServerService from "../../../Services/ExternalMcpServerService";
import IncidentService from "../../../Services/IncidentService";
import logger from "../../Logger";
import ToolOutputPager from "../Chat/ToolOutputPager";
import InvestigationRules from "../SRE/InvestigationRules";
import McpRunToolkit from "./McpRunToolkit";

/*
 * THE EXTERNAL MCP SERVERS AN INVESTIGATION MAY USE, as a toolkit for its
 * run: the project's servers that are on and that the investigation rules
 * matching the incident (or alert) allow - all of them with no rule, or
 * with a matching rule that names none (InvestigationRules,
 * ExternalMcpServerAllowance). Only their tools that read: an
 * investigation never changes anything (McpRunToolkit, purpose
 * "investigation").
 *
 * Enrichment only, like every other tool an investigation is handed: a
 * failure to read the rules, the subject or the servers leaves the run
 * with OneUptime's own data (null), never fails it.
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

export default class McpInvestigationTools {
  public static async forIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    aiRunId: ObjectID;
    outputPager: ToolOutputPager;
    runDeadlineAtMs?: number | undefined;
  }): Promise<McpRunToolkit | null> {
    try {
      const incident: Incident | null = await IncidentService.findOneById({
        id: data.incidentId,
        select: INCIDENT_RULE_SELECT,
        props: { isRoot: true },
      });

      if (!incident) {
        return null;
      }

      const allowance: ExternalMcpServerAllowance =
        await InvestigationRules.getIncidentMcpServerAllowance({
          projectId: data.projectId,
          incident,
        });

      return await this.buildToolkit({ ...data, allowance });
    } catch (error) {
      logger.error(
        `AI: could not offer external MCP servers for incident ${data.incidentId.toString()}; investigating it without them: ${error}`,
      );
      return null;
    }
  }

  public static async forAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    aiRunId: ObjectID;
    outputPager: ToolOutputPager;
    runDeadlineAtMs?: number | undefined;
  }): Promise<McpRunToolkit | null> {
    try {
      const alert: Alert | null = await AlertService.findOneById({
        id: data.alertId,
        select: ALERT_RULE_SELECT,
        props: { isRoot: true },
      });

      if (!alert) {
        return null;
      }

      const allowance: ExternalMcpServerAllowance =
        await InvestigationRules.getAlertMcpServerAllowance({
          projectId: data.projectId,
          alert,
        });

      return await this.buildToolkit({ ...data, allowance });
    } catch (error) {
      logger.error(
        `AI: could not offer external MCP servers for alert ${data.alertId.toString()}; investigating it without them: ${error}`,
      );
      return null;
    }
  }

  /*
   * A security case's triage (SecurityCaseTriageRunner): every server of
   * the project that is on - no investigation rule names servers for
   * security cases - and, as for every investigation, only their tools that
   * read. A threat intel or EDR server a team connected is exactly what a
   * triage should be able to ask.
   */
  public static async forSecurityCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    aiRunId: ObjectID;
    outputPager: ToolOutputPager;
    runDeadlineAtMs?: number | undefined;
  }): Promise<McpRunToolkit | null> {
    try {
      return await this.buildToolkit({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        outputPager: data.outputPager,
        runDeadlineAtMs: data.runDeadlineAtMs,
        allowance: EVERY_EXTERNAL_MCP_SERVER,
      });
    } catch (error) {
      logger.error(
        `AI: could not offer external MCP servers for security case ${data.securityCaseId.toString()}; triaging it without them: ${error}`,
      );
      return null;
    }
  }

  /*
   * A telemetry problem's investigation - the triage of slow code OneUptime
   * found (Types/AI/TelemetryAi): the servers its lane's AI rules allow for
   * it (all of them with no rule, or a matching rule that names none), and
   * only their tools that read.
   */
  public static async forTelemetryProblem(data: {
    projectId: ObjectID;
    insightId: ObjectID;
    aiRunId: ObjectID;
    outputPager: ToolOutputPager;
    runDeadlineAtMs?: number | undefined;
    allowance: ExternalMcpServerAllowance;
  }): Promise<McpRunToolkit | null> {
    try {
      return await this.buildToolkit({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        outputPager: data.outputPager,
        runDeadlineAtMs: data.runDeadlineAtMs,
        allowance: data.allowance,
      });
    } catch (error) {
      logger.error(
        `AI: could not offer external MCP servers for insight ${data.insightId.toString()}; investigating it without them: ${error}`,
      );
      return null;
    }
  }

  private static async buildToolkit(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    outputPager: ToolOutputPager;
    runDeadlineAtMs?: number | undefined;
    allowance: ExternalMcpServerAllowance;
  }): Promise<McpRunToolkit | null> {
    if (!allowsAnyExternalMcpServer(data.allowance)) {
      return null;
    }

    const servers: Array<ExternalMcpServer> =
      await ExternalMcpServerService.findServersForRun({
        projectId: data.projectId,
        allowance: data.allowance,
      });

    if (servers.length === 0) {
      return null;
    }

    return new McpRunToolkit({
      projectId: data.projectId,
      aiRunId: data.aiRunId,
      servers,
      purpose: "investigation",
      outputPager: data.outputPager,
      runDeadlineAtMs: data.runDeadlineAtMs,
    });
  }
}
