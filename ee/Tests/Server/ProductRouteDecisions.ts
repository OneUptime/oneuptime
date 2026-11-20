/*
 * THE ENTERPRISE EDITION'S ROUTE FILES, EACH HELD TO A DECISION WHILE ITS
 * PRODUCT IS OFF.
 *
 * Common's ProductCustomRoutesGuard holds every route file of the server to
 * a decision: a route that acts on a product refuses it while the product is
 * off, or is left alone with why, and a file of no one product is decided as
 * a whole. ee/ decides its own route files here, so core names none of them:
 * core runs without ee/ (Common Test deletes it before it runs), and some of
 * ee/ is named nowhere outside it at all (WhiteLabelStaysInEnterprise).
 *
 * The guard reads this file only when ee/ is checked out, and walks
 * ee/Server then too. The Enterprise Edition Test job runs it so, beside
 * App's other guards that check ee/ (.github/workflows/test.ee.yaml).
 *
 * Register each route by its verb - router.post(...), never
 * router[method](...): the guard cannot read the verb of a computed one,
 * and refuses it in ee/ as in core (#10230).
 *
 * Plain data, with no imports: the guard loads it from Common's own test run.
 */

export interface EnterpriseProductRouteFile {
  // The products its routes act on, as ProductKey's values.
  products: ReadonlyArray<string>;
  // Path text of a route left alone, as the file writes it -> why.
  leftAlone: Record<string, string>;
}

export interface EnterpriseWholeFileDecision {
  why: string;
  // How many routes that are not a GET it registers.
  routes: number;
}

// Status Pages, as ProductKey writes it.
const STATUS_PAGES: string = "status-pages";

export const ENTERPRISE_PRODUCT_ROUTE_FILES: Record<
  string,
  EnterpriseProductRouteFile
> = {
  "ee/Server/Identity/API/StatusPageSCIM.ts": {
    products: [STATUS_PAGES],
    leftAlone: Object.fromEntries(
      [
        '"/status-page-scim/v2/:statusPageScimId/Bulk"',
        '"/status-page-scim/v2/:statusPageScimId/Users"',
        '"/status-page-scim/v2/:statusPageScimId/Users/:userId"',
      ].map((route: string): [string, string] => {
        return [
          route,
          "An identity provider keeps a published page's people in step: it stays up while Status Pages is off, and what already runs keeps running.",
        ];
      }),
    ),
  },
};

const decided: (
  why: string,
  files: Record<string, number>,
) => Array<[string, EnterpriseWholeFileDecision]> = (
  why: string,
  files: Record<string, number>,
): Array<[string, EnterpriseWholeFileDecision]> => {
  return Object.entries(files).map(
    ([file, routes]: [string, number]): [
      string,
      EnterpriseWholeFileDecision,
    ] => {
      return [file, { why, routes }];
    },
  );
};

export const ENTERPRISE_FILES_DECIDED_WHOLE: Record<
  string,
  EnterpriseWholeFileDecision
> = Object.fromEntries([
  ...decided(
    "Signing in, and keeping a session, which every product needs: what a person proves to get in is of no one product.",
    {
      "ee/Server/Identity/API/SCIMOAuthToken.ts": 1,
    },
  ),
  ...decided(
    "A custom notification channel: a master admin's setup and a person's test, of no one product - and a page's own action from the company's app, which the person paged answers, as what already runs keeps running.",
    {
      "ee/Server/CustomNotificationChannels/API/CustomChannelSendAPI.ts": 1,
    },
  ),
  ...decided(
    "The project, its people and its settings - Users, Teams and Project Settings, which are always on.",
    {
      "ee/Server/Identity/API/SCIM.ts": 9,
      "ee/Server/Identity/API/SCIMOAuthClientSecret.ts": 2,
      "ee/Server/AuditLogExport/API/AuditLogExportAPI.ts": 4,
      "ee/Server/SessionLength/API/SessionLengthAPI.ts": 1,
    },
  ),
  ...decided(
    "Billing, which the project pays for every product with, and the marketplaces that bill it.",
    {
      "ee/Server/CloudMarketplace/API/MarketplaceAPI.ts": 8,
      /*
       * #10230: what Vercel calls as a team installs OneUptime, changes or
       * uninstalls it (PUT, PATCH, DELETE), adds, changes or deletes a
       * resource - a project billed through Vercel - (POST, PATCH, DELETE)
       * or rotates its secrets (POST), and Vercel's webhook (POST), as AWS,
       * Microsoft and Google Cloud call MarketplaceAPI. What adding a
       * resource and the webhook would make in a product - a status page, a
       * monitor - is not made while that product is off (#10251:
       * VercelMarketplaceResources, VercelMarketplaceMonitors).
       */
      "ee/Server/CloudMarketplace/API/VercelMarketplaceProviderAPI.ts": 8,
    },
  ),
  ...decided(
    "The server's own setup, which a master admin changes or the server reads - switching a product on again among it.",
    {
      "ee/Server/AdminHealth/QueryConsole.ts": 1,
      "ee/Server/Backup/API/BackupAPI.ts": 7,
      "ee/Server/License/API/LicenseClientAPI.ts": 2,
      "ee/Server/LicenseServer/EnterpriseLicenseAPI.ts": 2,
      "ee/Server/LicenseServer/EnterpriseLicenseOfflineTokenAPI.ts": 1,
      "ee/Server/WhiteLabel/API/WhiteLabelAPI.ts": 1,
    },
  ),
]);

// A route file of ee/ the walk must find, so a walk of ee/Server that found nothing is never a pass.
export const ENTERPRISE_ROUTE_FILE_THE_WALK_FINDS: string =
  "ee/Server/Identity/API/SCIM.ts";
