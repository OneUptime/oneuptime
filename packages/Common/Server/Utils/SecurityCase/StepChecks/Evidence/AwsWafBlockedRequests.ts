import SecurityBlockService from "../../../../Services/SecurityBlockService";
import AwsWafBlockDestination, {
  AwsWafBlockDestinationSource,
} from "../../../SecurityBlocklist/AwsWafBlockDestination";
import SecurityBlockDestination from "../../../SecurityBlocklist/SecurityBlockDestination";
import logger from "../../../Logger";
import { AddressBlockEvidence, AddressBlockSource } from "./AddressBlocks";
import {
  AwsWafArn,
  AwsWafScope,
} from "../../../../../Types/CloudConnection/AwsWafBlocklist";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  ResponseLinkKind,
  ResponseProviderLink,
} from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  CHECK_BLOCK_AWS_WAF_SAMPLED,
  CHECK_CHALLENGE_AWS_WAF_SAMPLED,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";

/*
 * AWS WAF'S OWN WORD THAT A BLOCK HOLDS (#10344): for an address the
 * blocklist blocks, the requests from it that a web ACL's rule of the
 * blocklist turned away, from those AWS WAF sampled in the last three
 * hours (it keeps no more) - "AWS WAF blocked requests from 35.205.11.131
 * at prod-alb (sampled)." Stronger than the block's being read back in the
 * IP set: the web ACL acted on it.
 *
 * Only an address the blocklist holds is looked for - nothing else is in
 * OneUptime's sets - and only in a web ACL whose last check found its rule
 * blocking them. A sample is a sample: none found says nothing, so this
 * source never says a block is missing, and a web ACL AWS WAF would not
 * answer for is left out, saying so in the logs - the blocklist's own
 * enforcement rows still speak for it.
 */

// How far back AWS WAF keeps the requests it samples.
export const AWS_WAF_SAMPLE_WINDOW_IN_MS: number = 3 * 60 * 60 * 1000;

const PROVIDER: string = "AWS WAF";

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

// Where a web ACL's sampled requests are shown in the AWS console.
export function getAwsWafConsoleUrl(webAcl: AwsWafArn): string {
  const region: string =
    webAcl.scope === AwsWafScope.CloudFront ? "global" : webAcl.region;

  return `https://console.aws.amazon.com/wafv2/homev2/web-acl/${encodeURIComponent(webAcl.name)}/${encodeURIComponent(webAcl.id)}/overview?region=${encodeURIComponent(region)}`;
}

export interface AwsWafBlockedRequestsDependencies {
  // Whether the blocklist holds the address now.
  isBlocked: (data: {
    projectId: ObjectID;
    value: SecurityBlockValue;
    now: Date;
  }) => Promise<boolean>;
  // The project's web ACLs that enforce the blocklist.
  findDestinations: (
    projectId: ObjectID,
  ) => Promise<Array<SecurityBlockDestination>>;
}

export const AWS_WAF_BLOCKED_REQUESTS_DEPENDENCIES: AwsWafBlockedRequestsDependencies =
  {
    isBlocked: async (data: {
      projectId: ObjectID;
      value: SecurityBlockValue;
      now: Date;
    }): Promise<boolean> => {
      return Boolean(
        await SecurityBlockService.findCoveringBlock({
          projectId: data.projectId,
          value: data.value,
          now: data.now,
        }),
      );
    },
    findDestinations: async (
      projectId: ObjectID,
    ): Promise<Array<SecurityBlockDestination>> => {
      return await new AwsWafBlockDestinationSource().findForProject(projectId);
    },
  };

export function createAwsWafBlockedRequests(
  dependencies: AwsWafBlockedRequestsDependencies = AWS_WAF_BLOCKED_REQUESTS_DEPENDENCIES,
): AddressBlockSource {
  return {
    name: "AWS WAF sampled requests",
    readBlocks: async (data: {
      projectId: ObjectID;
      address: string;
      now: Date;
    }): Promise<Array<AddressBlockEvidence>> => {
      const value: SecurityBlockValue | null = readSecurityBlockValue(
        data.address,
      );

      if (!value) {
        return [];
      }

      let destinations: Array<SecurityBlockDestination>;

      try {
        if (
          !(await dependencies.isBlocked({
            projectId: data.projectId,
            value,
            now: data.now,
          }))
        ) {
          return [];
        }

        destinations = await dependencies.findDestinations(data.projectId);
      } catch (error) {
        logger.warn(
          `AwsWafBlockedRequests: could not read the web ACLs of project ${data.projectId.toString()}. ${errorText(error)}`,
        );
        return [];
      }

      const evidence: Array<AddressBlockEvidence> = [];

      for (const destination of destinations) {
        if (
          !(destination instanceof AwsWafBlockDestination) ||
          !destination.isEnforcing()
        ) {
          continue;
        }

        let latest: Partial<Record<SecurityBlockAction, Date>>;

        try {
          latest = await destination.readSampledBlocks({
            address: value.value,
            from: new Date(data.now.getTime() - AWS_WAF_SAMPLE_WINDOW_IN_MS),
            to: data.now,
          });
        } catch (error) {
          logger.warn(
            `AwsWafBlockedRequests: could not read the requests ${destination.name} sampled. ${errorText(error)}`,
          );
          continue;
        }

        const link: ResponseProviderLink = {
          kind: ResponseLinkKind.OpenProvider,
          provider: PROVIDER,
          url: getAwsWafConsoleUrl(destination.webAcl),
        };

        for (const action of [
          SecurityBlockAction.Block,
          SecurityBlockAction.Challenge,
        ]) {
          const at: Date | undefined = latest[action];

          if (!at) {
            continue;
          }

          evidence.push({
            destination: destination.name,
            appliedAt: at,
            sentence: {
              template:
                action === SecurityBlockAction.Challenge
                  ? CHECK_CHALLENGE_AWS_WAF_SAMPLED
                  : CHECK_BLOCK_AWS_WAF_SAMPLED,
              values: {
                address: value.value,
                webAcl: destination.webAcl.name,
              },
            },
            link,
          });
        }
      }

      return evidence;
    },
  };
}

const AwsWafBlockedRequests: AddressBlockSource = createAwsWafBlockedRequests();

export default AwsWafBlockedRequests;
