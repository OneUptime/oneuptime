import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  DetectionRulePastRetention,
  SECURITY_EVENT_RETENTION_MAX_LISTED_RULES,
  SecurityEventRetentionStatus,
  findRulesPastRetention,
  getSecurityEventRetentionInDays,
} from "../../../Types/SecurityEvent/SecurityEventRetention";
import { DetectionRuleDefinition } from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import DetectionRuleService from "../../Services/DetectionRuleService";
import OTelIngestService, {
  TelemetryRetention,
} from "../../Services/OpenTelemetryIngestService";

/*
 * How long a project keeps its security events, read for the code that
 * reads them back (Types/SecurityEvent/SecurityEventRetention): the
 * project's retention for security events, as ingest stamps an event whose
 * source has no retention of its own - its Default Retention (Days), and
 * its retention by type while that Enterprise feature is active.
 */
export default class SecurityEventRetention {
  /*
   * Read from the caches ingest reads, so a rule run every minute costs no
   * read of its own: a change shows within five minutes, as it does on what
   * ingest stamps. `isFresh` reads Postgres now, for a page.
   */
  public static async getRetentionInDays(
    projectId: ObjectID,
    options: { isFresh?: boolean } = {},
  ): Promise<number> {
    const retention: TelemetryRetention =
      await OTelIngestService.getProjectRetention(projectId, options);

    return getSecurityEventRetentionInDays({
      defaultTelemetryRetentionInDays: retention.projectRetentionInDays,
      telemetryRetentionConfig: retention.projectRetentionConfig,
    });
  }

  /*
   * What the Dashboard is told: the retention, read now, and the enabled
   * rules that read further back than it, read as the person asking - null
   * when they may not read detection rules. A rule whose YAML no longer
   * parses is one no run reads with either, and is left out.
   */
  public static async getStatus(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityEventRetentionStatus> {
    const retentionInDays: number = await this.getRetentionInDays(
      data.projectId,
      { isFresh: true },
    );

    let rules: Array<DetectionRule> | null = null;

    try {
      rules = await DetectionRuleService.findAllBy({
        query: {
          projectId: data.projectId,
          isEnabled: true,
        },
        select: {
          _id: true,
          name: true,
          sigmaRuleYaml: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        props: data.props,
      });
    } catch (error) {
      // A role that may not read detection rules is told the retention alone.
      if (!(error instanceof NotAuthorizedException)) {
        throw error;
      }

      rules = null;
    }

    if (rules === null) {
      return {
        retentionInDays,
        rulesPastRetention: null,
        hasMoreRulesPastRetention: false,
      };
    }

    const parsed: Array<{
      id: string;
      name: string;
      definition: DetectionRuleDefinition;
    }> = [];

    for (const rule of rules) {
      if (!rule._id || !rule.sigmaRuleYaml) {
        continue;
      }

      try {
        parsed.push({
          id: rule._id.toString(),
          name: rule.name || "",
          definition: SigmaRuleSetParser.parse(rule.sigmaRuleYaml),
        });
      } catch {
        continue;
      }
    }

    const pastRetention: Array<DetectionRulePastRetention> =
      findRulesPastRetention({ rules: parsed, retentionInDays });

    return {
      retentionInDays,
      rulesPastRetention: pastRetention.slice(
        0,
        SECURITY_EVENT_RETENTION_MAX_LISTED_RULES,
      ),
      hasMoreRulesPastRetention:
        pastRetention.length > SECURITY_EVENT_RETENTION_MAX_LISTED_RULES,
    };
  }
}
