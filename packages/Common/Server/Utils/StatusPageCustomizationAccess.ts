import Domain from "../../Models/DatabaseModels/Domain";
import StatusPageDomain from "../../Models/DatabaseModels/StatusPageDomain";
import ObjectID from "../../Types/ObjectID";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import StatusPageDomainService from "../Services/StatusPageDomainService";
import { ExpressRequest } from "./Express";
import { normalizeRequestHost } from "./RequestHost";

/*
 * The custom domains found verified for their page, kept per process for
 * as long as a custom domain is kept resolved to its page
 * (StatusPageService.resolveCustomDomainOrNull, 60 s): every view of a page
 * on its own domain asks, so it was a Postgres read per view. Only a "yes"
 * is kept - by the exact host and page - so a domain verified a moment ago
 * is served its page's code at once, a Host nobody has cannot fill it, and
 * a lookup that fails is asked again (and answers no). A domain taken off
 * its page stops being served the page's code within that minute, as it
 * stops being resolved to the page.
 */
export const CUSTOMIZATION_HOST_CACHE_TTL_MS: number = 60 * 1000;

const customizationHosts: InMemoryTTLCache<boolean> =
  new InMemoryTTLCache<boolean>(10_000);

// Forgets every host kept. For tests.
export const clearStatusPageCustomizationHosts: () => void = (): void => {
  customizationHosts.clear();
};

const BUILT_IN_PRIMARY_HOSTS: Set<string> = new Set<string>([
  "localhost",
  "ingress",
]);

/**
 * Parse the HTTP Host authority without consulting Express' `req.hostname`.
 *
 * Express may derive `req.hostname` from X-Forwarded-Host when `trust proxy`
 * is enabled. That header is caller-controlled on several of the Nginx routes
 * in this repository, so it cannot decide whether tenant-controlled code is
 * returned. Nginx overwrites the actual Host header with `$host`, which makes
 * the raw Host the appropriate input to this security boundary. The rule is
 * RequestHost's, which a form's own domain reads too.
 */
export const normalizeStatusPageRequestHost: (
  rawHost: string | undefined,
) => string | null = normalizeRequestHost;

export const isPrimaryStatusPageHost: (hostname: string) => boolean = (
  hostname: string,
): boolean => {
  if (BUILT_IN_PRIMARY_HOSTS.has(hostname)) {
    return true;
  }

  const configuredHostValue: string = process.env["HOST"] || "localhost";
  const configuredHost: string | null =
    normalizeStatusPageRequestHost(configuredHostValue);

  /*
   * A malformed deployment HOST means we cannot prove that any incoming host
   * is isolated from the authenticated application. Disable customizations
   * globally until the configuration is corrected.
   */
  if (!configuredHost) {
    return true;
  }

  return hostname === configuredHost;
};

export const canServeStatusPageCustomizations: (data: {
  req: ExpressRequest;
  statusPageId: ObjectID;
}) => Promise<boolean> = async (data: {
  req: ExpressRequest;
  statusPageId: ObjectID;
}): Promise<boolean> => {
  const requestHost: string | null = normalizeStatusPageRequestHost(
    data.req.get("host"),
  );

  if (!requestHost || isPrimaryStatusPageHost(requestHost)) {
    return false;
  }

  const key: string = `${requestHost}|${data.statusPageId
    .toString()
    .toLowerCase()}`;

  if (customizationHosts.get(key)) {
    return true;
  }

  try {
    const statusPageDomain: StatusPageDomain | null =
      await StatusPageDomainService.findOneBy({
        query: {
          fullDomain: requestHost,
          statusPageId: data.statusPageId,
          isCnameVerified: true,
          domain: {
            isVerified: true,
          } as Domain,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!statusPageDomain) {
      return false;
    }

    customizationHosts.set(key, true, CUSTOMIZATION_HOST_CACHE_TTL_MS);

    return true;
  } catch {
    // A lookup failure must never fall back to serving tenant-controlled code.
    return false;
  }
};
