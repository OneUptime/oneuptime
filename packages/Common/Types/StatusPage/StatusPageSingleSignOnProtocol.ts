import Dictionary from "../Dictionary";

/*
 * The protocols a status page's single sign-on providers speak, as the
 * dashboard's one Single Sign-On page names its tabs in the address
 * (`…/status-pages/:id/sso?protocol=oidc`).
 *
 * They were two menu entries until #9130, "SSO" and "OIDC", side by side
 * with the same lock icon: one kind of record (a sign-on provider) on two
 * pages, under one name ("SSO") that is also what OIDC is. The SAML page
 * kept its address and is the first tab; the OIDC page's address is still
 * in bookmarks and wikis, so the dashboard forwards it to its tab
 * (MOVED_SINGLE_SIGN_ON_PATHS).
 *
 * React-free and database-free, so the dashboard and a test can both read
 * it.
 */
enum StatusPageSingleSignOnProtocol {
  SAML = "saml",
  OIDC = "oidc",
}

// In tab order. The first is the tab a bare address opens.
export const STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOLS: ReadonlyArray<StatusPageSingleSignOnProtocol> =
  [StatusPageSingleSignOnProtocol.SAML, StatusPageSingleSignOnProtocol.OIDC];

export const DEFAULT_STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL: StatusPageSingleSignOnProtocol =
  StatusPageSingleSignOnProtocol.SAML;

// The query parameter that names the open tab.
export const STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL_QUERY_PARAM: string =
  "protocol";

/*
 * Where each protocol's page used to be, under a status page's own address,
 * and the tab it is now. SAML's page ("sso") is the Single Sign-On page
 * itself, so only OIDC's moved.
 */
export const MOVED_SINGLE_SIGN_ON_PATHS: Readonly<
  Record<string, StatusPageSingleSignOnProtocol>
> = {
  oidc: StatusPageSingleSignOnProtocol.OIDC,
};

// The protocol a value names, or null when it names none.
export const readStatusPageSingleSignOnProtocol: (
  value: string | null | undefined,
) => StatusPageSingleSignOnProtocol | null = (
  value: string | null | undefined,
): StatusPageSingleSignOnProtocol | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();

  for (const protocol of STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOLS) {
    if (protocol === normalized) {
      return protocol;
    }
  }

  return null;
};

/*
 * The query that opens the Single Sign-On page on a protocol's tab:
 * { protocol: "oidc" }, and nothing for the first tab, whose address is
 * the bare one - the address the page itself shows once that tab is open.
 */
export const getStatusPageSingleSignOnProtocolQuery: (
  protocol: StatusPageSingleSignOnProtocol,
) => Dictionary<string> = (
  protocol: StatusPageSingleSignOnProtocol,
): Dictionary<string> => {
  if (protocol === DEFAULT_STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL) {
    return {};
  }

  return { [STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL_QUERY_PARAM]: protocol };
};

export default StatusPageSingleSignOnProtocol;
