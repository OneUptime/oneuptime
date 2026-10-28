import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
  DetectionRetrohuntResult,
  detectionRetrohuntResultToJSON,
} from "../../Types/SecurityEvent/DetectionRetrohunt";
import UserMiddleware from "../Middleware/UserAuthorization";
import DetectionRuleService, {
  Service as DetectionRuleServiceType,
} from "../Services/DetectionRuleService";
import DetectionRuleDraft, {
  DetectionRuleDraftResult,
} from "../Utils/AI/Security/DetectionRuleDraft";
import DetectionRuleRetrohunt, {
  DetectionRetrohuntRule,
} from "../Utils/SecurityEvent/DetectionRuleRetrohunt";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import TelemetryReadAccess from "../Utils/Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../Utils/Telemetry/TelemetryReadScope";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * A number the form sent: a number, or text one reads as; undefined for
 * nothing (the rule's own value, or the default), and a 400 for anything
 * else, rather than a guess.
 */
function readOptionalNumber(
  body: JSONObject,
  key: string,
  label: string,
): number | undefined {
  const value: JSONValue | undefined = body[key];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(number)) {
    throw new BadDataException(`${label} must be a number.`);
  }

  return number;
}

// A text field the form sent, or undefined when it sent none.
function readOptionalText(body: JSONObject, key: string): string | undefined {
  const value: JSONValue | undefined = body[key];

  if (value === undefined) {
    return undefined;
  }

  return typeof value === "string" ? value : "";
}

/*
 * Detection rules: their CRUD, and
 *
 *   POST /detection-rule/draft-with-ai   OneUptime AI writes a rule's Sigma
 *                                        YAML from a description
 *   POST /detection-rule/retrohunt       the rule run over past events: what
 *                                        it would have found
 *
 * The draft is for the Detection Rules form, which fills its YAML with it
 * for the person to read and save; nothing is saved here. Asking takes the
 * permission to create detection rules - the form is the create form - and
 * AI on for the project (DetectionRuleDraft).
 *
 * A retrohunt reads past security events and answers with what is in them,
 * so it takes a role that reads security events and detection rules, and
 * reads only the sources the caller may read. It is asked about a saved
 * rule (detectionRuleId: its exceptions apply), about the rule as the form
 * holds it (sigmaRuleYaml and how it counts, with or without the id of the
 * rule being edited), or both; nothing is opened, sent or written.
 */
export default class DetectionRuleAPI extends BaseAPI<
  DetectionRule,
  DetectionRuleServiceType
> {
  public constructor() {
    super(DetectionRule, DetectionRuleService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/draft-with-ai`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertCanCreateTable({
            modelType: DetectionRule,
            props,
            errorMessage:
              "Drafting a detection rule takes a role that can create detection rules.",
          });

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          const description: string =
            typeof body["description"] === "string"
              ? (body["description"] as string)
              : "";

          const draft: DetectionRuleDraftResult =
            await DetectionRuleDraft.draft({
              projectId,
              userId: props.userId,
              description,
            });

          return Response.sendJsonObjectResponse(req, res, {
            sigmaRuleYaml: draft.sigmaRuleYaml,
            title: draft.title,
            isCorrelation: draft.isCorrelation,
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/retrohunt`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertCanReadTable({
            modelType: DetectionRule,
            props,
            errorMessage:
              "Running a rule on past events takes a role that can read detection rules.",
          });

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: new SecurityEvent().getReadPermissions(),
            errorMessage:
              "Running a rule on past events takes a role that can read security events.",
          });

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          const rule: DetectionRetrohuntRule = await this.readRetrohuntRule({
            body,
            projectId,
            props,
          });

          const periodInHours: number =
            readOptionalNumber(body, "periodInHours", "The period") ??
            DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS;

          // Only the sources the caller may read, as every read of the events themselves.
          const serviceFilter: TelemetryServiceFilter =
            await TelemetryReadAccess.getServiceFilter({
              modelType: SecurityEvent,
              props,
            });

          const result: DetectionRetrohuntResult =
            await DetectionRuleRetrohunt.run({
              projectId,
              rule,
              periodInHours,
              serviceFilter,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            detectionRetrohuntResultToJSON(result),
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  /*
   * The rule a retrohunt runs: the saved rule the body names, read as the
   * caller (a rule they may not read is one that does not exist), with the
   * form's values over it - its YAML and how it counts, as they stand in the
   * form - or the form's values alone, for a rule not saved yet.
   */
  private async readRetrohuntRule(data: {
    body: JSONObject;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DetectionRetrohuntRule> {
    const { body } = data;
    const ruleIdText: JSONValue | undefined = body["detectionRuleId"];

    let saved: DetectionRule | null = null;

    if (typeof ruleIdText === "string" && ruleIdText.trim()) {
      saved = await DetectionRuleService.findOneBy({
        query: {
          _id: new ObjectID(ruleIdText.trim()),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          sigmaRuleYaml: true,
          groupByField: true,
          distinctCountField: true,
          matchCountThreshold: true,
          evaluationIntervalInMinutes: true,
        },
        props: data.props,
      });

      if (!saved || !saved.id) {
        throw new BadDataException(
          "This detection rule was not found. It may have been deleted.",
        );
      }

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: saved.projectId,
        projectId: data.projectId,
      });
    }

    const sigmaRuleYaml: string | undefined = readOptionalText(
      body,
      "sigmaRuleYaml",
    );
    const groupByField: string | undefined = readOptionalText(
      body,
      "groupByField",
    );
    const distinctCountField: string | undefined = readOptionalText(
      body,
      "distinctCountField",
    );
    const matchCountThreshold: number | undefined = readOptionalNumber(
      body,
      "matchCountThreshold",
      "Match count threshold",
    );
    const evaluationIntervalInMinutes: number | undefined = readOptionalNumber(
      body,
      "evaluationIntervalInMinutes",
      "Evaluation interval",
    );

    return {
      id: saved?.id || undefined,
      sigmaRuleYaml:
        sigmaRuleYaml && sigmaRuleYaml.trim()
          ? sigmaRuleYaml
          : saved?.sigmaRuleYaml || "",
      groupByField:
        groupByField !== undefined
          ? groupByField
          : saved?.groupByField || undefined,
      distinctCountField:
        distinctCountField !== undefined
          ? distinctCountField
          : saved?.distinctCountField || undefined,
      matchCountThreshold:
        matchCountThreshold ?? saved?.matchCountThreshold ?? undefined,
      evaluationIntervalInMinutes:
        evaluationIntervalInMinutes ??
        saved?.evaluationIntervalInMinutes ??
        undefined,
    };
  }
}
