import {
  composedValue,
  TemplateValue,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE MICROSOFT 365 ORGANIZATION A PROJECT IS CONNECTED TO, AS THE
 * MICROSOFT TEAMS SETTINGS NAME IT.
 *
 * Every Microsoft sign-in for a connected project goes to its organization,
 * and Microsoft stops anybody from another one on its own page, without
 * sending them back: "Selected user account does not exist in tenant
 * 'Contoso'" (AADSTS50020). So the page says which organization it is
 * before anybody signs in: by the name and domain admin consent kept
 * (MicrosoftTeamsOrganization on the server), "Contoso
 * (contoso.onmicrosoft.com)", or else by its tenant id. Every Microsoft 365
 * developer tenant is called Contoso - Microsoft's Teams store reviewers
 * each test in one - and the domain is what tells two of them apart.
 */

// An organization by its name and its domain, both as Microsoft names them.
export const TEAMS_ORGANIZATION_NAME_AND_DOMAIN: string = translationKey(
  "{{name}} ({{domain}})",
);

export interface MicrosoftTeamsOrganizationShown {
  // Its display name ("Contoso"), when admin consent kept one.
  name: string | null;
  // Its default domain ("contoso.onmicrosoft.com"), when admin consent kept one.
  domain: string | null;
  // Its tenant id: what a connection always has.
  tenantId: string | null;
}

const readText: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

/*
 * What a project's Microsoft Teams connection says of its organization:
 * miscData's name and domain, and its tenant id (workspaceProjectId, or
 * miscData's own copy of it).
 */
export const readMicrosoftTeamsOrganization: (data: {
  miscData: unknown;
  workspaceProjectId: unknown;
}) => MicrosoftTeamsOrganizationShown = (data: {
  miscData: unknown;
  workspaceProjectId: unknown;
}): MicrosoftTeamsOrganizationShown => {
  const miscData: Record<string, unknown> =
    data.miscData && typeof data.miscData === "object"
      ? (data.miscData as Record<string, unknown>)
      : {};

  return {
    name: readText(miscData["organizationName"]),
    domain: readText(miscData["organizationDomain"]),
    tenantId:
      readText(data.workspaceProjectId) || readText(miscData["tenantId"]),
  };
};

/*
 * The organization by name, for a sentence: "Contoso
 * (contoso.onmicrosoft.com)", or the one of them that is known. Null when
 * neither is: the page names it by its tenant id instead. The pair is
 * worded in the sentence's language (composedValue), its parentheses
 * included.
 */
export const getMicrosoftTeamsOrganizationName: (
  organization: MicrosoftTeamsOrganizationShown,
) => TemplateValue | null = (
  organization: MicrosoftTeamsOrganizationShown,
): TemplateValue | null => {
  const name: string | null = organization.name;
  const domain: string | null = organization.domain;

  if (name && domain) {
    return composedValue((sentence: Translator): string => {
      return sentence.translateTemplate(TEAMS_ORGANIZATION_NAME_AND_DOMAIN, {
        name: name,
        domain: domain,
      });
    });
  }

  return name || domain || null;
};
