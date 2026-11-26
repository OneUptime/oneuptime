import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import logger from "../../Logger";
import MicrosoftTeamsHosts from "./MicrosoftTeamsHosts";

/*
 * WHICH MICROSOFT 365 ORGANIZATION A PROJECT IS CONNECTED TO, BY NAME.
 *
 * A project is connected to one Microsoft 365 organization - the tenant
 * admin consent bound to it (WorkspaceProjectAuthToken.workspaceProjectId) -
 * and every Microsoft sign-in for the project goes to that organization
 * (MicrosoftTeamsSignInAuthority). Microsoft stops anybody who is not in it
 * on its own page - "Selected user account does not exist in tenant
 * 'Contoso' and cannot access the application ... in that tenant"
 * (AADSTS50020) - and never sends them back, so OneUptime cannot explain it
 * afterwards. The settings page has to say which organization it is
 * before anybody signs in.
 *
 * A tenant id says little to a person, and an organization's display name
 * is not enough either: every Microsoft 365 developer tenant is called
 * "Contoso". Microsoft's Teams store reviewers each test in one of their
 * own, and the reviewer who found the test project connected to another
 * reviewer's "Contoso" could not tell (ticket 5877223, November 2026). The
 * organization's domain (m365x12345678.onmicrosoft.com) tells them apart,
 * so both are kept.
 *
 * Read once, when admin consent is granted, with the delegated token of the
 * admin who signed in to prove the tenant (User.Read is enough for GET
 * /organization). OneUptime's app token has no permission that reads it.
 * It is best effort: an organization that cannot be read is still
 * connected, and the page names it by its tenant id.
 */

/*
 * What OneUptime keeps of an organization: its display name ("Contoso")
 * and its default domain ("contoso.onmicrosoft.com"). Either may be
 * missing, never both.
 */
export interface MicrosoftTeamsOrganizationName {
  name?: string | undefined;
  domain?: string | undefined;
}

// The longest name or domain kept: Entra caps a display name at 256.
const MAX_LENGTH: number = 256;

/*
 * A domain name as Entra lists a verified one: labels of letters, digits
 * and hyphens, at least two of them. The dot between two labels is not in
 * a label's class, so the pattern is linear.
 */
const DOMAIN_PATTERN: RegExp = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/*
 * Control characters, which have no place in a name drawn on a page.
 * no-control-regex is disabled on purpose: matching them is what it is for.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS: RegExp = /[\u0000-\u001f\u007f-\u009f]/g;

export default class MicrosoftTeamsOrganization {
  // GET /organization, for what OneUptime keeps of it.
  public static getOrganizationUrl(): string {
    return MicrosoftTeamsHosts.getGraphUrl(
      "/organization?$select=id,displayName,verifiedDomains",
    );
  }

  /*
   * The name and domain of `tenantId`'s organization in an answer to GET
   * /organization, or null when it names neither. Graph answers with the
   * organization of the tenant the token was issued in; one that names
   * another tenant is not taken.
   */
  public static readOrganization(data: {
    answer: unknown;
    tenantId: string;
  }): MicrosoftTeamsOrganizationName | null {
    const value: unknown = (data.answer as JSONObject | null | undefined)?.[
      "value"
    ];

    if (!Array.isArray(value)) {
      return null;
    }

    const tenantId: string = data.tenantId.trim().toLowerCase();

    const organization: JSONObject | undefined = (value as Array<unknown>).find(
      (entry: unknown): boolean => {
        const id: unknown = (entry as JSONObject | null | undefined)?.["id"];

        return typeof id === "string" && id.trim().toLowerCase() === tenantId;
      },
    ) as JSONObject | undefined;

    if (!organization) {
      return null;
    }

    const name: string | undefined = MicrosoftTeamsOrganization.readName(
      organization["displayName"],
    );
    const domain: string | undefined = MicrosoftTeamsOrganization.readDomain(
      organization["verifiedDomains"],
    );

    if (!name && !domain) {
      return null;
    }

    return {
      ...(name ? { name } : {}),
      ...(domain ? { domain } : {}),
    };
  }

  /*
   * The organization `accessToken` was issued in, by name and domain; null
   * when Graph does not say. Never throws: the connection does not depend
   * on it.
   */
  public static async read(data: {
    accessToken: string;
    tenantId: string;
  }): Promise<MicrosoftTeamsOrganizationName | null> {
    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>({
          url: URL.fromString(MicrosoftTeamsOrganization.getOrganizationUrl()),
          headers: {
            Authorization: `Bearer ${data.accessToken}`,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.debug(
          `Microsoft Graph answered the organization read for tenant ${data.tenantId} with HTTP ${response.statusCode}: the connection names the organization by its tenant id.`,
        );
        return null;
      }

      return MicrosoftTeamsOrganization.readOrganization({
        answer: response.data,
        tenantId: data.tenantId,
      });
    } catch (error) {
      logger.debug(
        `The organization of tenant ${data.tenantId} could not be read: the connection names it by its tenant id.`,
      );
      logger.debug(error);
      return null;
    }
  }

  // An organization's display name, as it may be drawn on a page.
  private static readName(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const name: string = value.replace(CONTROL_CHARACTERS, " ").trim();

    if (!name) {
      return undefined;
    }

    return name.length > MAX_LENGTH ? name.substring(0, MAX_LENGTH) : name;
  }

  /*
   * The organization's default domain, else its initial one (the
   * onmicrosoft.com domain every tenant has), else its first: in lower
   * case, and only when it is a domain name.
   */
  private static readDomain(value: unknown): string | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const domains: Array<{
      name: string;
      isDefault: boolean;
      isInitial: boolean;
    }> = (value as Array<unknown>)
      .map((entry: unknown) => {
        const domain: JSONObject = (entry || {}) as JSONObject;
        const name: string =
          typeof domain["name"] === "string"
            ? domain["name"].trim().toLowerCase()
            : "";

        return {
          name: name,
          isDefault: domain["isDefault"] === true,
          isInitial: domain["isInitial"] === true,
        };
      })
      .filter((domain: { name: string }): boolean => {
        return (
          domain.name.length > 0 &&
          domain.name.length <= MAX_LENGTH &&
          DOMAIN_PATTERN.test(domain.name)
        );
      });

    const chosen:
      | { name: string; isDefault: boolean; isInitial: boolean }
      | undefined =
      domains.find((domain: { isDefault: boolean }): boolean => {
        return domain.isDefault;
      }) ||
      domains.find((domain: { isInitial: boolean }): boolean => {
        return domain.isInitial;
      }) ||
      domains[0];

    return chosen?.name;
  }
}
