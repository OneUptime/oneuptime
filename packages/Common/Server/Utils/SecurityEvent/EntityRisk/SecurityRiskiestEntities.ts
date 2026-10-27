import Project from "../../../../Models/DatabaseModels/Project";
import SecurityEntityRisk from "../../../../Models/DatabaseModels/SecurityEntityRisk";
import ProjectService from "../../../Services/ProjectService";
import SecurityEntityRiskService from "../../../Services/SecurityEntityRiskService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_OVERVIEW_RISKIEST_ENTITY_LIMIT,
  SecurityRiskiestEntities,
  SecurityRiskiestEntity,
} from "../../../../Types/SecurityCase/SecurityEntityRisk";
import { readRiskCaseThreshold } from "../../../../Utils/SecurityCase/SecurityEntityRiskScore";

/*
 * The riskiest users, hosts and addresses, for the Security Overview's
 * Riskiest Entities: the top of Entity Risk's list, read as Entity Risk
 * reads it - every entity with risk now, the highest score first - so the
 * two never disagree about who is riskiest. It replaces the Overview's old
 * ranking by how many findings named a value, which put a host one noisy
 * rule fired at above the account three different rules flagged.
 *
 * Read as the caller, as the rest of the overview is: the rows are security
 * data the Security tiers read. Sorted exactly as Entity Risk's list is, by
 * the score alone, so two entities with one score come in the order that
 * list shows them too (every read breaks ties by the row's id). The
 * project's threshold comes with them - each score's level is read against
 * it - and how many entities have risk, for the card's way on to the whole
 * list.
 */
export default class SecurityRiskiestEntitiesReader {
  /*
   * Null when the risk could not be read: the card says so, and the rest of
   * the overview is drawn as usual.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    limit?: number | undefined;
  }): Promise<SecurityRiskiestEntities | null> {
    try {
      const [rows, total, project]: [
        Array<SecurityEntityRisk>,
        PositiveNumber,
        Project | null,
      ] = await Promise.all([
        SecurityEntityRiskService.findBy({
          query: {
            projectId: data.projectId,
            // An entity whose sources all went quiet is kept for its history, not ranked.
            riskScore: QueryHelper.greaterThan(0),
          },
          select: {
            _id: true,
            entityValue: true,
            entityType: true,
            riskScore: true,
          },
          // Entity Risk's own order: its table sorts by the score alone.
          sort: {
            riskScore: SortOrder.Descending,
          },
          skip: 0,
          limit: data.limit || SECURITY_OVERVIEW_RISKIEST_ENTITY_LIMIT,
          props: data.props,
        }),
        SecurityEntityRiskService.countBy({
          query: {
            projectId: data.projectId,
            riskScore: QueryHelper.greaterThan(0),
          },
          props: data.props,
        }),
        // A setting of the project, not security data: read whatever the role.
        ProjectService.findOneById({
          id: data.projectId,
          select: {
            securityRiskCaseThreshold: true,
          },
          props: {
            isRoot: true,
          },
        }),
      ]);

      return {
        threshold: readRiskCaseThreshold(project?.securityRiskCaseThreshold),
        total: total.toNumber(),
        entities: rows.map(toRiskiestEntity),
      };
    } catch (error) {
      logger.error(
        `SecurityRiskiestEntities: could not read the riskiest entities of project ${data.projectId.toString()}:`,
      );
      logger.error(error);

      return null;
    }
  }
}

// A risk row as the overview hands it over.
export function toRiskiestEntity(
  row: SecurityEntityRisk,
): SecurityRiskiestEntity {
  const type: unknown = row.entityType;

  return {
    value: row.entityValue || "",
    type: (Object.values(SecurityEntityType) as Array<unknown>).includes(type)
      ? (type as SecurityEntityType)
      : null,
    score: Math.max(0, Math.round(Number(row.riskScore) || 0)),
  };
}
