/*
 * A PROJECT'S SSO SIGN-IN LINK, PASTED INTO THE APP (#9989).
 *
 * "Sign in with SSO" finds a project's providers by the typed address's
 * verified domain alone, so it finds nothing for someone whose address is
 * on another domain - a contractor at gmail.com in Acme's project - or in a
 * project that has not verified its domain. On the web, the project's admin
 * shares the project's SSO sign-in link instead (#9918, Dashboard: Settings
 * > SSO > SSO Sign-in Link): https://<server>/accounts/sso/<project id>,
 * which lists the project's providers by the project's id alone and asks
 * for no address. Pasted on the app's SSO screen, it does the same here.
 *
 * Parsed by hand, as ./callbackUrl parses the deep link: React Native's
 * cut-down URL is not the one Jest runs.
 */

export type ProjectSsoSignInLink =
  | { status: "link"; projectId: string }
  // Not a link to a project's SSO sign-in page at all.
  | { status: "not-a-link" }
  // A link to the page that names no project id.
  | { status: "no-project" }
  // A project's link on another server than the one the app signs in to.
  | { status: "other-server"; serverOrigin: string };

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// scheme, host[:port], path - the query and the fragment are dropped.
const ADDRESS_PATTERN: RegExp =
  /^(https?):\/\/([^/?#\s@]+)(\/[^?#\s]*)?(?:[?#]\S*)?$/i;

const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443" };

interface Address {
  origin: string;
  path: string;
}

function parseAddress(value: string): Address | null {
  const match: RegExpMatchArray | null = value.match(ADDRESS_PATTERN);

  if (!match) {
    return null;
  }

  const scheme: string = match[1]!.toLowerCase();
  let host: string = match[2]!.toLowerCase();

  // https://host:443 is https://host.
  if (host.endsWith(`:${DEFAULT_PORTS[scheme]}`)) {
    host = host.slice(0, host.lastIndexOf(":"));
  }

  return {
    origin: `${scheme}://${host}`,
    path: (match[3] || "").replace(/\/+$/, ""),
  };
}

const PAGE_PATH: string = "/accounts/sso";

/**
 * What a pasted link is: a project's SSO sign-in link on the server the app
 * signs in to (`serverUrl`), and which project - or why not.
 */
export function parseProjectSsoSignInLink(
  pasted: string,
  serverUrl: string,
): ProjectSsoSignInLink {
  const link: Address | null = parseAddress(pasted.trim());
  const server: Address | null = parseAddress(serverUrl.trim());

  if (!link || !server) {
    return { status: "not-a-link" };
  }

  const pagePath: string = `${server.path}${PAGE_PATH}`;
  const onThisServer: boolean = link.origin === server.origin;

  // The page itself, on this server or another: a link with no project in it.
  if (link.path === pagePath || link.path === PAGE_PATH) {
    return onThisServer
      ? { status: "no-project" }
      : { status: "other-server", serverOrigin: link.origin };
  }

  const isProjectPage: (prefix: string) => boolean = (
    prefix: string,
  ): boolean => {
    return (
      link.path.startsWith(`${prefix}/`) &&
      !link.path.slice(prefix.length + 1).includes("/")
    );
  };

  if (!isProjectPage(pagePath) && !isProjectPage(PAGE_PATH)) {
    return { status: "not-a-link" };
  }

  if (!onThisServer) {
    return { status: "other-server", serverOrigin: link.origin };
  }

  let projectId: string;

  try {
    projectId = decodeURIComponent(
      link.path.slice(link.path.lastIndexOf("/") + 1),
    );
  } catch {
    return { status: "no-project" };
  }

  if (!UUID_PATTERN.test(projectId)) {
    return { status: "no-project" };
  }

  return { status: "link", projectId: projectId.toLowerCase() };
}
