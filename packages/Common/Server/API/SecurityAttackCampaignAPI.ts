import SecurityBlock from "../../Models/DatabaseModels/SecurityBlock";
import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import {
  SECURITY_BLOCK_DEFAULT_DURATION,
  SECURITY_BLOCK_EXPIRING_DURATIONS,
  SECURITY_BLOCK_REASON_MAX_LENGTH,
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockIndicatorValue,
  SecurityBlockReach,
  findCoveringSecurityBlock,
  readSecurityBlockAsn,
  readSecurityBlockIndicator,
} from "../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_ATTACK_CAMPAIGNS_MAX,
  SECURITY_ATTACK_CAMPAIGNS_MAX_DAYS,
  SecurityAttackCampaign,
  SecurityAttackCampaignBlock,
  SecurityAttackCampaignsResult,
} from "../../Types/SecurityEvent/SecurityAttackCampaign";
import {
  SECURITY_ATTACK_NETWORK_ADDRESSES_MAX,
  SECURITY_ATTACK_NETWORKS_MAX,
  SecurityAttackCampaignGrouping,
  SecurityAttackNetwork,
  SecurityAttackNetworksResult,
  groupSecurityAttackCampaignsByNetwork,
} from "../../Types/SecurityEvent/SecurityAttackNetwork";
import {
  SECURITY_CAMPAIGN_BLOCK_MAX_ADDRESSES,
  SecurityCampaignAddressesCheck,
  SecurityCampaignOfCaseAddress,
} from "../../Types/SecurityEvent/SecurityCampaignContainment";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityBlockService from "../Services/SecurityBlockService";
import SecurityEventService from "../Services/SecurityEventService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityCampaignContainment, {
  readCampaignValues,
} from "../Utils/SecurityEvent/SecurityCampaignContainment";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import TelemetryReadAccess from "../Utils/Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../Utils/Telemetry/TelemetryReadScope";
import CommonAPI from "./CommonAPI";

/*
 * THE CAMPAIGNS PAGE'S ROUTES:
 *
 *   POST /security-event/attack-campaigns  the page's read: the project's
 *        web attacks over a window, one row per address that sent them,
 *        worst first (SecurityEventService.findAttackCampaigns) - or, with
 *        groupBy "network", one row per network they came from (#10354):
 *        by ASN where the events carry one, else by /24 or /48. A reader
 *        who may read the Blocklist sees the block that holds each row.
 *   POST .../block-check, .../block  Block Addresses (#10354): what a
 *        block of each selected campaign's address would meet, then the
 *        block of every one of them in one go, as the person, through the
 *        Blocklist - leaving out, and naming, the project's own and
 *        protected addresses, those already blocked and those a signed-in
 *        user used lately;
 *   POST .../network-check, .../network-challenge  Challenge This
 *        Network (#10354): whether the person may challenge a network -
 *        refused for one holding a signed-in user's or one of the
 *        project's own addresses; a Security Admin's for one wider than
 *        the largest range, an ASN, or one OneUptime cannot check - then
 *        the challenge, 24 hours unless asked;
 *   POST .../of-case-address  the campaign of one of a case's addresses:
 *        what a case's Block the Whole Campaign offers to block.
 *
 * The read takes the right to read security events, like every other read
 * of them, and counts only the events of the sources the caller may read
 * (TelemetryReadAccess): a Security role scoped to the sources it owns, or
 * to some labels, sees the attacks on those sources alone. The window is
 * the page's: at most SECURITY_ATTACK_CAMPAIGNS_MAX_DAYS long, ending no
 * later than now; without one, the last seven days. Blocking takes the
 * right to block, and is refused while Security Events is switched off: no
 * block or challenge is placed then (#10678).
 */

export const DEFAULT_CAMPAIGN_WINDOW_IN_DAYS: number = 7;

export const SECURITY_ATTACK_CAMPAIGNS_ROUTE: string =
  "/security-event/attack-campaigns";
export const SECURITY_CAMPAIGNS_BLOCK_CHECK_ROUTE: string = `${SECURITY_ATTACK_CAMPAIGNS_ROUTE}/block-check`;
export const SECURITY_CAMPAIGNS_BLOCK_ROUTE: string = `${SECURITY_ATTACK_CAMPAIGNS_ROUTE}/block`;
export const SECURITY_CAMPAIGNS_NETWORK_CHECK_ROUTE: string = `${SECURITY_ATTACK_CAMPAIGNS_ROUTE}/network-check`;
export const SECURITY_CAMPAIGNS_NETWORK_CHALLENGE_ROUTE: string = `${SECURITY_ATTACK_CAMPAIGNS_ROUTE}/network-challenge`;
export const SECURITY_CAMPAIGNS_OF_CASE_ADDRESS_ROUTE: string = `${SECURITY_ATTACK_CAMPAIGNS_ROUTE}/of-case-address`;

export const READ_REFUSED_MESSAGE: string =
  "Reading security events takes a Security role, or Project Owner or Project Admin.";
export const BLOCK_REFUSED_MESSAGE: string =
  "Blocking or challenging a campaign takes a role that can block addresses: Security Member, Security Admin, Project Admin or Project Owner.";

/*
 * A window is a span of time, not of calendar days: across a change of the
 * clocks a calendar week is an hour longer or shorter than seven days.
 */
const DAY_MS: number = 24 * 60 * 60 * 1000;

function readDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

export function readCampaignWindow(
  body: JSONObject,
  now: Date,
): { startTime: Date; endTime: Date } {
  const requestedEnd: Date | null = readDate(body["endTime"]);
  const endTime: Date =
    requestedEnd && requestedEnd.getTime() < now.getTime() ? requestedEnd : now;
  const requestedStart: Date | null = readDate(body["startTime"]);
  const earliest: Date = new Date(
    endTime.getTime() - SECURITY_ATTACK_CAMPAIGNS_MAX_DAYS * DAY_MS,
  );

  let startTime: Date =
    requestedStart ||
    new Date(endTime.getTime() - DEFAULT_CAMPAIGN_WINDOW_IN_DAYS * DAY_MS);

  if (startTime.getTime() >= endTime.getTime()) {
    throw new BadDataException("The window's start must be before its end.");
  }

  if (startTime.getTime() < earliest.getTime()) {
    startTime = earliest;
  }

  return { startTime, endTime };
}

/*
 * How long a block or a challenge from Campaigns lasts: one of the lengths
 * that end by themselves, 24 hours unless asked. A whole campaign or a
 * network is never kept until someone lifts it from here.
 */
export function readCampaignDuration(
  value: JSONValue | undefined,
): SecurityBlockDuration {
  if (value === undefined || value === null || value === "") {
    return SECURITY_BLOCK_DEFAULT_DURATION;
  }

  if (
    typeof value !== "string" ||
    !(SECURITY_BLOCK_EXPIRING_DURATIONS as ReadonlyArray<string>).includes(
      value,
    )
  ) {
    throw new BadDataException(
      "Choose how long it lasts: 1 hour, 24 hours, 7 days or 30 days.",
    );
  }

  return value as SecurityBlockDuration;
}

export function readCampaignReason(
  value: JSONValue | undefined,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  if (value.trim().length > SECURITY_BLOCK_REASON_MAX_LENGTH) {
    throw new BadDataException(
      `A reason is at most ${SECURITY_BLOCK_REASON_MAX_LENGTH} characters.`,
    );
  }

  return value.trim();
}

/*
 * The block on the Blocklist that holds a row now: of an address, the
 * address or a range around it, or its network's ASN; of a network, the
 * network itself or a range around it.
 */
export function findCampaignRowBlock(data: {
  value: string;
  asn?: string | undefined;
  blocks: ReadonlyArray<SecurityBlock>;
}): SecurityAttackCampaignBlock | null {
  const candidates: Array<SecurityBlock & { value: string }> =
    data.blocks.filter(
      (block: SecurityBlock): block is SecurityBlock & { value: string } => {
        return Boolean(block.value);
      },
    );
  const read: SecurityBlockIndicatorValue | null = readSecurityBlockIndicator(
    data.value,
  );
  const asn: string | null = readSecurityBlockAsn(data.asn || "");
  const found: (SecurityBlock & { value: string }) | null =
    (read
      ? findCoveringSecurityBlock(read, candidates, SecurityBlockReach.Edge)
      : null) ||
    (asn
      ? findCoveringSecurityBlock(
          { indicatorType: SecurityBlockIndicatorType.Asn, value: asn },
          candidates,
          SecurityBlockReach.Edge,
        )
      : null);

  if (!found) {
    return null;
  }

  return {
    value: found.value,
    action:
      found.action === SecurityBlockAction.Challenge
        ? SecurityBlockAction.Challenge
        : SecurityBlockAction.Block,
    expiresAt: found.expiresAt ? new Date(found.expiresAt).toISOString() : null,
  };
}

export default class SecurityAttackCampaignAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      SECURITY_ATTACK_CAMPAIGNS_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const { props, projectId } = await this.readReader(req);
          const body: JSONObject = readBody(req);
          const range: { startTime: Date; endTime: Date } = readCampaignWindow(
            body,
            OneUptimeDate.getCurrentDate(),
          );
          const isByNetwork: boolean =
            body["groupBy"] === SecurityAttackCampaignGrouping.Network;

          const campaigns: Array<SecurityAttackCampaign> =
            await SecurityEventService.findAttackCampaigns({
              projectId,
              startTime: range.startTime,
              endTime: range.endTime,
              limit: isByNetwork
                ? SECURITY_ATTACK_NETWORK_ADDRESSES_MAX
                : SECURITY_ATTACK_CAMPAIGNS_MAX,
              maxLimit: isByNetwork
                ? SECURITY_ATTACK_NETWORK_ADDRESSES_MAX
                : undefined,
              serviceFilter: await TelemetryReadAccess.getServiceFilter({
                modelType: SecurityEvent,
                props,
              }),
            });
          const blocks: Array<SecurityBlock> = await this.readBlocks({
            props,
            projectId,
          });

          if (isByNetwork) {
            const grouped: Array<SecurityAttackNetwork> =
              groupSecurityAttackCampaignsByNetwork(
                campaigns.slice(0, SECURITY_ATTACK_NETWORK_ADDRESSES_MAX),
              );
            const result: SecurityAttackNetworksResult = {
              networks: grouped
                .slice(0, SECURITY_ATTACK_NETWORKS_MAX)
                .map(
                  (network: SecurityAttackNetwork): SecurityAttackNetwork => {
                    const block: SecurityAttackCampaignBlock | null =
                      network.network
                        ? findCampaignRowBlock({
                            value: network.network,
                            blocks,
                          })
                        : null;

                    return block ? { ...network, block } : network;
                  },
                ),
              startTime: range.startTime.toISOString(),
              endTime: range.endTime.toISOString(),
              isTruncated:
                campaigns.length > SECURITY_ATTACK_NETWORK_ADDRESSES_MAX ||
                grouped.length > SECURITY_ATTACK_NETWORKS_MAX,
            };

            return Response.sendJsonObjectResponse(
              req,
              res,
              result as unknown as JSONObject,
            );
          }

          const result: SecurityAttackCampaignsResult = {
            campaigns: campaigns
              .slice(0, SECURITY_ATTACK_CAMPAIGNS_MAX)
              .map(
                (campaign: SecurityAttackCampaign): SecurityAttackCampaign => {
                  const block: SecurityAttackCampaignBlock | null =
                    campaign.sourceIp
                      ? findCampaignRowBlock({
                          value: campaign.sourceIp,
                          asn: campaign.asn,
                          blocks,
                        })
                      : null;

                  return block ? { ...campaign, block } : campaign;
                },
              ),
            startTime: range.startTime.toISOString(),
            endTime: range.endTime.toISOString(),
            isTruncated: campaigns.length > SECURITY_ATTACK_CAMPAIGNS_MAX,
          };

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    router.post(
      SECURITY_CAMPAIGNS_BLOCK_CHECK_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const { props, projectId } = await this.readBlocker(req);
          const values: Array<string> = this.readValues(readBody(req));

          const check: SecurityCampaignAddressesCheck =
            await SecurityCampaignContainment.checkAddresses({
              projectId,
              values,
              props,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            SecurityCampaignContainment.writeAddressesCheck(check),
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    router.post(
      SECURITY_CAMPAIGNS_BLOCK_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const { props, projectId } = await this.readBlocker(req);
          const body: JSONObject = readBody(req);
          const values: Array<string> = this.readValues(body);
          const action: SecurityBlockAction =
            body["action"] === SecurityBlockAction.Challenge
              ? SecurityBlockAction.Challenge
              : SecurityBlockAction.Block;

          const outcome: SecurityCampaignAddressesCheck =
            await SecurityCampaignContainment.blockAddresses({
              projectId,
              values,
              action,
              duration: readCampaignDuration(body["duration"]),
              reason: readCampaignReason(body["reason"]),
              props,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            SecurityCampaignContainment.writeAddressesCheck(outcome),
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    router.post(
      SECURITY_CAMPAIGNS_NETWORK_CHECK_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const { props, projectId } = await this.readBlocker(req);
          const body: JSONObject = readBody(req);
          const range: { startTime: Date; endTime: Date } = readCampaignWindow(
            body,
            OneUptimeDate.getCurrentDate(),
          );

          return Response.sendJsonObjectResponse(
            req,
            res,
            SecurityCampaignContainment.writeNetworkCheck(
              await SecurityCampaignContainment.checkNetwork({
                projectId,
                value: this.readNetwork(body),
                props,
                startTime: range.startTime,
                endTime: range.endTime,
                serviceFilter: await this.readServiceFilter(props),
              }),
            ),
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    router.post(
      SECURITY_CAMPAIGNS_NETWORK_CHALLENGE_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const { props, projectId } = await this.readBlocker(req);
          const body: JSONObject = readBody(req);
          const range: { startTime: Date; endTime: Date } = readCampaignWindow(
            body,
            OneUptimeDate.getCurrentDate(),
          );

          const challenged: Awaited<
            ReturnType<(typeof SecurityCampaignContainment)["challengeNetwork"]>
          > = await SecurityCampaignContainment.challengeNetwork({
            projectId,
            request: {
              value: this.readNetwork(body),
              duration: readCampaignDuration(body["duration"]),
              reason: readCampaignReason(body["reason"]),
              acknowledgesUnchecked: body["acknowledgesUnchecked"] === true,
            },
            props,
            startTime: range.startTime,
            endTime: range.endTime,
            serviceFilter: await this.readServiceFilter(props),
          });

          return Response.sendJsonObjectResponse(req, res, {
            value: challenged.block.value || challenged.check.value,
            blockId: challenged.block.id?.toString() || "",
            expiresAt: challenged.block.expiresAt
              ? new Date(challenged.block.expiresAt).toISOString()
              : null,
            holders: challenged.check.holders,
          });
        } catch (error) {
          return next(error);
        }
      },
    );

    router.post(
      SECURITY_CAMPAIGNS_OF_CASE_ADDRESS_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const { props, projectId } = await this.readBlocker(req);
          const body: JSONObject = readBody(req);
          const caseId: string =
            typeof body["securityCaseId"] === "string"
              ? body["securityCaseId"].trim()
              : "";

          if (!caseId || !ObjectID.isValidUUID(caseId)) {
            throw new BadDataException(
              "Name the case to read the campaign of.",
            );
          }

          const campaign: SecurityCampaignOfCaseAddress =
            await SecurityCampaignContainment.findCampaignOfCaseAddress({
              projectId,
              securityCaseId: new ObjectID(caseId),
              address:
                typeof body["address"] === "string"
                  ? body["address"].slice(0, 100)
                  : "",
              props,
              serviceFilter: await this.readServiceFilter(props),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            campaign as unknown as JSONObject,
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    return router;
  }

  // A reader of security events, held to the project.
  private async readReader(req: ExpressRequest): Promise<{
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectMember(props);

    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new SecurityEvent().getReadPermissions(),
      errorMessage: READ_REFUSED_MESSAGE,
    });

    return { props, projectId };
  }

  // A reader of security events who may block: what Campaigns' actions take.
  private async readBlocker(req: ExpressRequest): Promise<{
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }> {
    const read: {
      props: DatabaseCommonInteractionProps;
      projectId: ObjectID;
    } = await this.readReader(req);

    CommonAPI.assertCanCreateTable({
      modelType: SecurityBlock,
      props: read.props,
      errorMessage: BLOCK_REFUSED_MESSAGE,
    });

    return read;
  }

  private async readServiceFilter(
    props: DatabaseCommonInteractionProps,
  ): Promise<TelemetryServiceFilter> {
    return await TelemetryReadAccess.getServiceFilter({
      modelType: SecurityEvent,
      props,
    });
  }

  // The active blocks a reader of the Blocklist sees beside the rows; none for anyone else.
  private async readBlocks(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<Array<SecurityBlock>> {
    try {
      CommonAPI.assertCanReadTable({
        modelType: SecurityBlock,
        props: data.props,
        errorMessage: READ_REFUSED_MESSAGE,
      });
    } catch {
      return [];
    }

    return await SecurityBlockService.findActiveBlocks({
      projectId: data.projectId,
    });
  }

  private readValues(body: JSONObject): Array<string> {
    const values: Array<string> = readCampaignValues(
      body["values"],
      SECURITY_CAMPAIGN_BLOCK_MAX_ADDRESSES,
    );

    if (values.length === 0) {
      throw new BadDataException("Choose the addresses to block.");
    }

    return values;
  }

  private readNetwork(body: JSONObject): string {
    const value: string =
      typeof body["value"] === "string" ? body["value"].trim() : "";

    if (!value || value.length > 100) {
      throw new BadDataException(
        "Name the network to challenge: a range, such as 203.0.113.0/24, or an ASN, such as AS64500.",
      );
    }

    return value;
  }
}
