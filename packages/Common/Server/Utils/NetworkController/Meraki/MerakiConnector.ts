import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  MerakiRegionDefinition,
  getMerakiRegionOrDefault,
} from "../../../../Types/NetworkController/MerakiRegion";
import { NetworkControllerConfig } from "../../../../Types/NetworkController/NetworkControllerConnectionSettings";
import {
  MAX_TEST_ORGANIZATIONS,
  NetworkControllerOrganization,
  NetworkControllerTestResult,
} from "../../../../Types/NetworkController/NetworkControllerConnectionTest";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  NetworkControllerCallOptions,
  NetworkControllerConnector,
  NetworkControllerReadOptions,
  NetworkControllerReadResult,
  NetworkControllerSettings,
} from "../NetworkControllerTypes";
import MerakiApiClient, {
  MerakiList,
  buildMerakiQuery,
} from "./MerakiApiClient";
import MerakiTrafficReader, { LIST_PAGE_SIZE } from "./MerakiTrafficReader";
import { TEXT_LIMITS, cleanText } from "./MerakiUsageRecords";

/*
 * The Meraki dashboard API as a network controller connector.
 *
 * "Test" makes three read-only calls at most: the organizations the key can
 * read, and for the one picked (or the only one) its networks and its
 * appliances - so the form can say "312 networks and 287 appliances" before
 * anything is saved, and why not when it cannot.
 */

// Pages a test counts at most: past them it says "or more".
export const TEST_MAX_PAGES: number = 3;
// A test answers within this many calls whatever the organization's size.
export const TEST_MAX_REQUESTS: number = 1 + TEST_MAX_PAGES * 2 + 3;

export const REMEDIATION_KEY: string =
  "Copy the key again from the Meraki dashboard (Organization > API & Webhooks > API keys and access), and check the region is the dashboard you sign in to.";
export const REMEDIATION_API_ACCESS: string =
  "Turn on API access for the organization in the Meraki dashboard (Organization > API & Webhooks), or use the key of an administrator of this organization.";
export const REMEDIATION_UNREACHABLE: string =
  "Check that this OneUptime can reach the Meraki dashboard API over HTTPS (port 443) - a firewall or proxy may be in the way - and try again.";
export const REMEDIATION_RATE_LIMITED: string =
  "Other applications are using the organization's API budget right now. Try again in a minute.";

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

// The organizations of GET /organizations, each with whether its API is on.
export function readOrganizations(
  values: Array<unknown>,
): Array<NetworkControllerOrganization & { isApiEnabled: boolean }> {
  const organizations: Array<
    NetworkControllerOrganization & { isApiEnabled: boolean }
  > = [];
  const seen: Set<string> = new Set();

  for (const value of values) {
    const organization: JSONObject | null = asObject(value);

    if (!organization) {
      continue;
    }

    const id: string = cleanText(organization["id"], TEXT_LIMITS.networkId);

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);

    const api: JSONObject | null = asObject(organization["api"]);

    organizations.push({
      id: id,
      name: cleanText(organization["name"], TEXT_LIMITS.networkName) || id,
      isApiEnabled: api ? api["enabled"] !== false : true,
    });
  }

  return organizations;
}

function remediationFor(kind: LlmConnectionFailureKind): string {
  switch (kind) {
    case LlmConnectionFailureKind.Authentication:
      return REMEDIATION_KEY;
    case LlmConnectionFailureKind.Permission:
    case LlmConnectionFailureKind.Settings:
      return REMEDIATION_API_ACCESS;
    case LlmConnectionFailureKind.RateLimited:
      return REMEDIATION_RATE_LIMITED;
    default:
      return REMEDIATION_UNREACHABLE;
  }
}

export default class MerakiConnector implements NetworkControllerConnector {
  public provider: NetworkControllerProvider = NetworkControllerProvider.Meraki;

  public async testConnection(
    data: { apiKey: string; config: NetworkControllerConfig },
    options: NetworkControllerCallOptions,
  ): Promise<NetworkControllerTestResult> {
    const clock: () => Date =
      options.now ||
      ((): Date => {
        return new Date();
      });
    const startedAt: number = clock().getTime();
    const region: MerakiRegionDefinition = getMerakiRegionOrDefault(
      data.config.region,
    );
    const client: MerakiApiClient = new MerakiApiClient({
      apiKey: data.apiKey,
      region,
      transport: options.transport,
      now: clock,
      sleep: options.sleep,
      maxRequests: TEST_MAX_REQUESTS,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });

    const result = (
      partial: Omit<NetworkControllerTestResult, "provider" | "durationMs">,
    ): NetworkControllerTestResult => {
      return {
        provider: NetworkControllerProvider.Meraki,
        ...partial,
        durationMs: Math.max(0, clock().getTime() - startedAt),
      };
    };

    let organizations: Array<
      NetworkControllerOrganization & { isApiEnabled: boolean }
    >;

    try {
      const list: MerakiList = await client.getAll(
        "/organizations",
        "",
        "list of organizations",
        1,
      );
      organizations = readOrganizations(list.items);
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error,
        step: "list of organizations",
        providerTitle: "Meraki",
        secretValues: [data.apiKey],
      });

      return result({
        status: "fail",
        message:
          failure.kind === LlmConnectionFailureKind.Authentication
            ? `The Meraki dashboard (${region.dashboardHost}) did not accept this API key.`
            : failure.message,
        remediation: remediationFor(failure.kind),
        failureKind: failure.kind,
        organizations: [],
      });
    }

    const listed: Array<NetworkControllerOrganization> = organizations
      .slice(0, MAX_TEST_ORGANIZATIONS)
      .map(
        (
          organization: NetworkControllerOrganization & {
            isApiEnabled: boolean;
          },
        ): NetworkControllerOrganization => {
          return { id: organization.id, name: organization.name };
        },
      );

    if (organizations.length === 0) {
      return result({
        status: "fail",
        message: "This API key can read no Meraki organization.",
        remediation:
          "A key reads the organizations of the administrator who made it: use the key of an administrator of the organization you want to read.",
        failureKind: LlmConnectionFailureKind.Permission,
        organizations: [],
      });
    }

    const picked:
      | (NetworkControllerOrganization & { isApiEnabled: boolean })
      | undefined = data.config.organizationId
      ? organizations.find(
          (
            organization: NetworkControllerOrganization & {
              isApiEnabled: boolean;
            },
          ): boolean => {
            return organization.id === data.config.organizationId;
          },
        )
      : organizations.length === 1
        ? organizations[0]
        : undefined;

    if (data.config.organizationId && !picked) {
      return result({
        status: "fail",
        message: `This API key cannot read the organization ${data.config.organizationId}.`,
        remediation: REMEDIATION_API_ACCESS,
        failureKind: LlmConnectionFailureKind.Permission,
        organizations: listed,
      });
    }

    if (!picked) {
      return result({
        status: "pass",
        message: `The key reads ${organizations.length} organizations. Pick the one to read.`,
        organizations: listed,
      });
    }

    if (!picked.isApiEnabled) {
      return result({
        status: "fail",
        message: `API access is turned off for ${picked.name}.`,
        remediation: REMEDIATION_API_ACCESS,
        failureKind: LlmConnectionFailureKind.Permission,
        organizations: listed,
        organizationId: picked.id,
      });
    }

    const orgPath: string = `/organizations/${encodeURIComponent(picked.id)}`;

    try {
      const networks: MerakiList = await client.getAll(
        `${orgPath}/networks`,
        buildMerakiQuery([["perPage", LIST_PAGE_SIZE]]),
        "list of networks",
        TEST_MAX_PAGES,
      );
      const appliances: MerakiList = await client.getAll(
        `${orgPath}/devices`,
        buildMerakiQuery([
          ["perPage", LIST_PAGE_SIZE],
          ["productTypes[]", "appliance"],
        ]),
        "list of appliances",
        TEST_MAX_PAGES,
      );

      const networkCount: number = networks.items.length;
      const applianceCount: number = appliances.items.length;
      const more: string =
        networks.isTruncated || appliances.isTruncated ? " or more" : "";

      if (networkCount === 0) {
        return result({
          status: "warn",
          message: `${picked.name} has no networks yet: there is no traffic to read.`,
          organizations: listed,
          organizationId: picked.id,
          networkCount: 0,
          applianceCount: applianceCount,
        });
      }

      if (applianceCount === 0) {
        return result({
          status: "warn",
          message: `Reads ${networkCount}${more} networks in ${picked.name}. It has no MX or Z appliance, so there is no uplink usage: only applications and clients are shown.`,
          organizations: listed,
          organizationId: picked.id,
          networkCount: networkCount,
          applianceCount: 0,
        });
      }

      return result({
        status: "pass",
        message: `Reads ${networkCount}${more} networks and ${applianceCount}${more} appliances in ${picked.name}.`,
        organizations: listed,
        organizationId: picked.id,
        networkCount: networkCount,
        applianceCount: applianceCount,
      });
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error,
        step: "organization",
        providerTitle: "Meraki",
        secretValues: [data.apiKey],
      });

      return result({
        status: "fail",
        message: failure.message,
        remediation: remediationFor(failure.kind),
        failureKind: failure.kind,
        organizations: listed,
        organizationId: picked.id,
      });
    }
  }

  public async read(
    settings: NetworkControllerSettings,
    options: NetworkControllerReadOptions,
  ): Promise<NetworkControllerReadResult> {
    return await MerakiTrafficReader.read(settings, options);
  }
}
