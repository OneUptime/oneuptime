import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityEntity,
  readSecurityEntities,
} from "../../../../Types/SecurityCase/SecurityEntity";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import { securityValue } from "./SecurityCaseAIContextBuilder";

/*
 * THE SECURITY CASE BEHIND AN INCIDENT, for the incident's investigation.
 *
 * A security case can declare an incident (Declare Incident on the case, or
 * a playbook's Declare Incident step): the attack becomes an outage the
 * on-call team works. Without this the incident's investigation read the
 * incident's telemetry and never learned that a security case - a brute
 * force, a compromised host - is why it exists. Now its starting context
 * names the case: what was detected, about whom, its priority, and
 * OneUptime AI's triage of it, with the ID the security tools take.
 *
 * The case's title and entities were written outside the project (a rule,
 * a connected product, the attacker), so they go in as quoted values
 * (securityValue), as the triage's own context puts them in.
 */

export const MAX_INCIDENT_SECURITY_CASES: number = 3;

const VALUE_LENGTH: number = 300;

export default class SecurityCaseIncidentContext {
  public static async read(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<Array<SecurityCase>> {
    return await SecurityCaseService.findBy({
      query: {
        projectId: data.projectId,
        incidentId: data.incidentId,
      },
      select: {
        _id: true,
        caseNumberWithPrefix: true,
        title: true,
        securityCaseStatus: { name: true },
        securityCasePriority: { name: true },
        entities: true,
        detectionCount: true,
        aiVerdict: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: MAX_INCIDENT_SECURITY_CASES,
      skip: 0,
      props: { isRoot: true },
    });
  }

  // The section, or "" when no case declared the incident.
  public static buildContextSection(cases: Array<SecurityCase>): string {
    if (cases.length === 0) {
      return "";
    }

    const lines: Array<string> = [
      "",
      "## The security case behind this incident",
      "A security case declared this incident: the incident may be the impact of an attack. Read each case and its detections with query_security_cases (securityCaseId), and the events behind it with search_security_events.",
    ];

    for (const securityCase of cases) {
      const entities: string = readSecurityEntities(securityCase.entities)
        .slice(0, 10)
        .map((entity: SecurityEntity): string => {
          return `${entity.type} ${securityValue(entity.value, { maxLength: VALUE_LENGTH })}`;
        })
        .join(", ");

      lines.push(
        `- ${securityCase.caseNumberWithPrefix || "Security case"} (securityCaseId "${securityCase.id?.toString() || ""}") ${securityValue(
          securityCase.title,
          { maxLength: VALUE_LENGTH },
        )} - status ${
          securityCase.securityCaseStatus?.name
            ? securityValue(securityCase.securityCaseStatus.name, {
                maxLength: VALUE_LENGTH,
              })
            : "unknown"
        }, priority ${
          securityCase.securityCasePriority?.name
            ? securityValue(securityCase.securityCasePriority.name, {
                maxLength: VALUE_LENGTH,
              })
            : "unknown"
        }, ${securityCase.detectionCount || 0} detection(s)${
          entities ? `, about ${entities}` : ""
        }${
          securityCase.aiVerdict
            ? `. OneUptime AI's triage read it as: ${securityCase.aiVerdict}`
            : ""
        }.`,
      );
    }

    return `${lines.join("\n")}\n`;
  }

  public static async buildContextSectionFor(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<string> {
    return this.buildContextSection(await this.read(data));
  }
}
