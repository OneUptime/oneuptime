import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";

/*
 * THE ROUTES OF AN API RESOURCE THAT WAS RETIRED.
 *
 * A resource that is gone used to answer every call with the generic "not
 * found" an unknown route gets, which tells an API, Terraform or MCP client
 * written against it nothing about what replaced it. Its routes answer 410
 * Gone instead - every method, the resource and everything under it - with
 * one sentence that names the resource to use now, so the first call such a
 * client makes after an upgrade says what to change.
 */
export interface RetiredApiResource {
  // The route the resource was served at, as its model's CrudApiEndpoint said ("/ai-investigation-rule").
  path: string;
  // What replaced it, and how to move: the whole answer a client reads.
  message: string;
}

// 410 Gone: the resource was here, and is not coming back.
export const RETIRED_API_STATUS_CODE: number = 410;

/*
 * Investigation rules (/ai-investigation-rule) became AI rules: one rule
 * says which incidents (or alerts) OneUptime AI investigates and whether it
 * fixes them, in the table the auto remediation rules had
 * (MergeInvestigationRulesIntoAiRules moved every investigation rule in).
 */
export const RETIRED_AI_INVESTIGATION_RULE_API: RetiredApiResource = {
  path: "/ai-investigation-rule",
  message:
    "Investigation rules are AI rules now, and the investigation rules this project had were moved into them. Use the AI Rule resource instead: /api/auto-remediation-rule (Terraform: oneuptime_ai_rule). A rule that only investigates, as an investigation rule did, has investigates set to true and fixes set to false. See /docs/installation/upgrading.",
};

export const RETIRED_API_RESOURCES: ReadonlyArray<RetiredApiResource> = [
  RETIRED_AI_INVESTIGATION_RULE_API,
];

export default class RetiredApiRoute {
  // The router that answers every call to the retired resources.
  public static getRouter(
    resources: ReadonlyArray<RetiredApiResource> = RETIRED_API_RESOURCES,
  ): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    for (const resource of resources) {
      const answer: (req: ExpressRequest, res: ExpressResponse) => void = (
        _req: ExpressRequest,
        res: ExpressResponse,
      ): void => {
        res.status(RETIRED_API_STATUS_CODE).send({
          message: resource.message,
        });
      };

      router.all(resource.path, answer);
      router.all(`${resource.path}/*`, answer);
    }

    return router;
  }
}
