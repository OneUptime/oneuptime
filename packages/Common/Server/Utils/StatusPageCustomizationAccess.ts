import Domain from "../../Models/DatabaseModels/Domain";
import StatusPageDomain from "../../Models/DatabaseModels/StatusPageDomain";
import ObjectID from "../../Types/ObjectID";
import StatusPageDomainService from "../Services/StatusPageDomainService";
import { ExpressRequest } from "./Express";
import { normalizeRequestHost } from "./RequestHost";

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

    return Boolean(statusPageDomain);
  } catch {
    // A lookup failure must never fall back to serving tenant-controlled code.
    return false;
  }
};
