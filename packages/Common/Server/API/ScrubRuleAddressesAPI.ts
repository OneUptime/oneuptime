import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import LogScrubRule from "../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  isScrubRuleAddressSignal,
  SCRUB_RULE_HASH_INSTEAD_API_PATH,
  SCRUB_RULES_HIDING_ADDRESSES_API_PATH,
  ScrubRuleAddressSignal,
  ScrubRuleHashInsteadRequest,
  ScrubRuleHidingAddresses,
  ScrubRulesHidingAddressesAnswer,
} from "../../Types/Telemetry/ScrubRuleAddresses";
import {
  findScrubRulesHidingAddressesFor,
  switchScrubRuleToHash,
} from "../Utils/SecurityEvent/ScrubRuleHashInstead";

const router: ExpressRouter = Express.getRouter();

/*
 * THE SCRUB RULES THAT HIDE ADDRESSES FROM SECURITY EVENTS, AND HASH
 * INSTEAD (#10396).
 *
 * The scrub rule lists, an issue's findings and Security Events' setup say
 * which IP Address rules keep Security Events from naming an attacker's
 * address, for whoever may read scrub rules; Hash Instead switches one to
 * Hash, for whoever may edit scrub rules of its kind - the change is made
 * with their own props, so the scrub rule's permissions decide.
 */

// Who may read either kind of scrub rule: what the list is asked by.
export const SCRUB_RULES_HIDING_ADDRESSES_PERMISSIONS: Array<Permission> =
  Array.from(
    new Set<Permission>([
      ...new LogScrubRule().readRecordPermissions,
      ...new TraceScrubRule().readRecordPermissions,
    ]),
  );

// Who may edit each kind: Hash Instead is an edit of the rule.
export const SCRUB_RULE_EDIT_PERMISSIONS: Readonly<
  Record<ScrubRuleAddressSignal, Array<Permission>>
> = {
  log: new LogScrubRule().updateRecordPermissions,
  trace: new TraceScrubRule().updateRecordPermissions,
};

const EDIT_REFUSALS: Readonly<Record<ScrubRuleAddressSignal, string>> = {
  log: "You do not have permission to edit log scrub rules, so this rule cannot be switched to Hash. Ask a Project Owner or Project Admin, or for Edit Project Log Scrub Rule.",
  trace:
    "You do not have permission to edit trace scrub rules, so this rule cannot be switched to Hash. Ask a Project Owner or Project Admin, or for Edit Project Trace Scrub Rule.",
};

// Hash Instead's request, held to a kind and a rule's id.
export function readScrubRuleHashInsteadRequest(
  body: unknown,
): ScrubRuleHashInsteadRequest {
  const json: JSONObject = (
    body && typeof body === "object" && !Array.isArray(body) ? body : {}
  ) as JSONObject;

  if (!isScrubRuleAddressSignal(json["signal"])) {
    throw new BadDataException(
      'Say which scrub rule this is: signal "log" or "trace".',
    );
  }

  const ruleId: string =
    typeof json["ruleId"] === "string" ? json["ruleId"].trim() : "";

  if (!ObjectID.isValidUUID(ruleId)) {
    throw new BadDataException("Say which scrub rule to switch to Hash.");
  }

  return { signal: json["signal"], ruleId };
}

router.post(
  SCRUB_RULES_HIDING_ADDRESSES_API_PATH,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: SCRUB_RULES_HIDING_ADDRESSES_PERMISSIONS,
        errorMessage:
          "You do not have permission to read scrub rules, so OneUptime does not say which of them hide addresses from Security Events.",
      });

      const answer: ScrubRulesHidingAddressesAnswer =
        await findScrubRulesHidingAddressesFor({ projectId, props });

      Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  SCRUB_RULE_HASH_INSTEAD_API_PATH,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      const request: ScrubRuleHashInsteadRequest =
        readScrubRuleHashInsteadRequest(req.body);

      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: SCRUB_RULE_EDIT_PERMISSIONS[request.signal],
        errorMessage: EDIT_REFUSALS[request.signal],
      });

      const rule: ScrubRuleHidingAddresses = await switchScrubRuleToHash({
        projectId,
        signal: request.signal,
        ruleId: new ObjectID(request.ruleId),
        props,
      });

      Response.sendJsonObjectResponse(req, res, rule as unknown as JSONObject);
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
