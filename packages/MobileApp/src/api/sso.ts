import axios, { AxiosResponse } from "axios";
import { getServerUrl } from "../storage/serverUrl";
import type { SsoProviderKind } from "../sso/providerUrl";
import type { SsoCallbackSuccess } from "../sso/callbackUrl";

export interface SSOProvider {
  _id: string;
  name: string;
  description?: string;
  projectId: string;
  project?: {
    name: string;
  };
  /*
   * Which project-scoped router starts this login. The discovery payload does
   * not carry it - the endpoint that answered is what determines it - so it is
   * stamped on at parse time. Without it the app cannot tell a project SAML
   * provider from a project OIDC one, and would send both to /identity/sso.
   */
  kind: Extract<SsoProviderKind, "project" | "project-oidc">;
}

/*
 * OneUptime API serializes ObjectID fields as { _type: "ObjectID", value: "uuid" }.
 * This helper extracts the plain string value.
 */
function resolveId(
  field: string | { _type?: string; value?: string } | undefined,
): string {
  if (!field) {
    return "";
  }

  if (typeof field === "string") {
    return field;
  }

  if (typeof field === "object" && field.value) {
    return field.value;
  }

  return String(field);
}

interface RawSSOItem {
  _id: string | { _type?: string; value?: string };
  name?: string;
  description?: string;
  projectId?: string | { _type?: string; value?: string };
  project?: {
    _id?: string | { _type?: string; value?: string };
    name?: string;
  };
}

function parseSSOProvider(
  raw: RawSSOItem,
  kind: SSOProvider["kind"],
): SSOProvider {
  return {
    _id: resolveId(raw._id),
    name: raw.name || "",
    description: raw.description,
    projectId: resolveId(raw.projectId),
    project: raw.project?.name ? { name: raw.project.name } : undefined,
    kind,
  };
}

/**
 * Project SAML providers configured for `email`.
 */
export async function fetchSSOProviders(
  email: string,
): Promise<Array<SSOProvider>> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await axios.get(
    `${serverUrl}/identity/service-provider-login`,
    {
      params: { email },
      timeout: 15000,
    },
  );

  const items: Array<RawSSOItem> = response.data?.data || [];

  return items.map((item: RawSSOItem) => {
    return parseSSOProvider(item, "project");
  });
}

/**
 * Project OIDC providers configured for `email`.
 *
 * A separate endpoint from the SAML one, and it was never called: the app
 * offered project SAML and both global kinds, so a project whose only identity
 * provider was OIDC simply did not appear on the SSO login screen at all.
 */
export async function fetchProjectOIDCProviders(
  email: string,
): Promise<Array<SSOProvider>> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await axios.get(
    `${serverUrl}/identity/service-provider-login-oidc`,
    {
      params: { email },
      timeout: 15000,
    },
  );

  const items: Array<RawSSOItem> = response.data?.data || [];

  return items.map((item: RawSSOItem) => {
    return parseSSOProvider(item, "project-oidc");
  });
}

/**
 * A global (instance-wide) SSO or OIDC provider. Unlike project SSO providers,
 * these are not scoped to a single project; logging in grants access to every
 * project the user can reach.
 */
export interface GlobalSSOProvider {
  _id: string;
  name: string;
  description?: string;
  // Which global login flow to start: SAML ("global-sso") or OIDC ("global-oidc").
  type: Extract<SsoProviderKind, "global-sso" | "global-oidc">;
}

function parseGlobalProvider(
  raw: RawSSOItem,
  type: GlobalSSOProvider["type"],
): GlobalSSOProvider {
  return {
    _id: resolveId(raw._id),
    name: raw.name || "",
    description: raw.description,
    type,
  };
}

/*
 * The discovery endpoints return a plain array of providers. Depending on the
 * server middleware the payload may be wrapped in `{ data: [...] }`, so accept
 * either shape.
 */
function extractItems(data: unknown): Array<RawSSOItem> {
  if (Array.isArray(data)) {
    return data as Array<RawSSOItem>;
  }

  const wrapped: { data?: unknown } = (data as { data?: unknown }) || {};
  if (Array.isArray(wrapped.data)) {
    return wrapped.data as Array<RawSSOItem>;
  }

  return [];
}

/**
 * Fetch global SSO (SAML) providers from the instance-wide discovery endpoint.
 */
export async function fetchGlobalSSOProviders(): Promise<
  Array<GlobalSSOProvider>
> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await axios.get(
    `${serverUrl}/identity/global-sso/service-provider-login`,
    {
      timeout: 15000,
    },
  );

  const items: Array<RawSSOItem> = extractItems(response.data);

  return items.map((item: RawSSOItem) => {
    return parseGlobalProvider(item, "global-sso");
  });
}

/**
 * Fetch global OIDC providers from the instance-wide discovery endpoint.
 */
export async function fetchGlobalOIDCProviders(): Promise<
  Array<GlobalSSOProvider>
> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await axios.get(
    `${serverUrl}/identity/global-oidc/service-provider-login`,
    {
      timeout: 15000,
    },
  );

  const items: Array<RawSSOItem> = extractItems(response.data);

  return items.map((item: RawSSOItem) => {
    return parseGlobalProvider(item, "global-oidc");
  });
}

/**
 * Result of a discovery call that is allowed to fail.
 *
 * Global SSO discovery runs unprompted on app start, so a failure must not
 * block the screen - but it must also not be silently flattened to "no
 * providers". Those two states need different words in front of the user: one
 * says "your instance has no SSO", the other says "we could not reach your
 * server", and only the second is worth retrying.
 */
export interface SsoDiscoveryResult<T> {
  providers: Array<T>;
  failed: boolean;
}

/*
 * Decides whether a thrown request was a genuine failure to reach the server,
 * or the server answering perfectly well that there is nothing to offer.
 *
 * This distinction is not cosmetic. App/FeatureSet/Identity/API/SSO.ts on a
 * server older than #9745 answers the ordinary "this email has no project
 * SSO" case with HTTP 400 ("No SSO config found for this user") - for an
 * unknown user, a user with no id, and a user who belongs to no project
 * alike. (A newer server answers every such case with an empty list, so the
 * answer says nothing about whether the address has an account.) axios
 * rejects on 4xx, so treating every rejection as a failure tells the user
 * their network is broken when in fact the server replied correctly and
 * immediately.
 *
 * So: any response at all below 500 means the server was reached and had its
 * say. Only a transport error (no response) or a 5xx is an outage.
 */
function isServerUnreachable(error: unknown): boolean {
  const response: { status?: number } | undefined = (
    error as { response?: { status?: number } } | undefined
  )?.response;

  if (!response || typeof response.status !== "number") {
    // No response at all: DNS failure, timeout, refused connection, offline.
    return true;
  }

  return response.status >= 500;
}

async function settle<T>(
  load: () => Promise<Array<T>>,
): Promise<SsoDiscoveryResult<T>> {
  try {
    return { providers: await load(), failed: false };
  } catch (error) {
    return { providers: [], failed: isServerUnreachable(error) };
  }
}

/**
 * Discovers every instance-wide provider, SAML and OIDC together.
 *
 * `failed` is true only when BOTH endpoints failed. One endpoint being down
 * while the other answers is still a usable login screen, so it is not
 * reported to the user as an outage.
 */
export async function fetchAllGlobalProviders(): Promise<
  SsoDiscoveryResult<GlobalSSOProvider>
> {
  const [saml, oidc]: [
    SsoDiscoveryResult<GlobalSSOProvider>,
    SsoDiscoveryResult<GlobalSSOProvider>,
  ] = await Promise.all([
    settle(fetchGlobalSSOProviders),
    settle(fetchGlobalOIDCProviders),
  ]);

  return {
    providers: [...saml.providers, ...oidc.providers],
    failed: saml.failed && oidc.failed,
  };
}

/**
 * Discovers the project SSO providers configured for `email`.
 *
 * Unlike the global endpoints this one is email-scoped, so an empty result is
 * a real answer ("no project on this instance federates that address") rather
 * than a missing feature.
 */
export async function fetchProjectProvidersForEmail(
  email: string,
): Promise<SsoDiscoveryResult<SSOProvider>> {
  const [saml, oidc]: [
    SsoDiscoveryResult<SSOProvider>,
    SsoDiscoveryResult<SSOProvider>,
  ] = await Promise.all([
    settle(() => {
      return fetchSSOProviders(email);
    }),
    settle(() => {
      return fetchProjectOIDCProviders(email);
    }),
  ]);

  return {
    providers: [...saml.providers, ...oidc.providers],
    /*
     * Only an outage on BOTH endpoints is an outage worth telling the user
     * about. One of the two being down still leaves a login screen that works.
     */
    failed: saml.failed && oidc.failed,
  };
}

export async function fetchSSOProvidersForProject(
  projectId: string,
): Promise<Array<SSOProvider>> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await axios.post(
    `${serverUrl}/api/project-sso/${projectId}/sso-list`,
    {},
    {
      timeout: 15000,
    },
  );

  const items: Array<RawSSOItem> = response.data?.data || [];

  return items.map((item: RawSSOItem) => {
    const parsed: SSOProvider = parseSSOProvider(item, "project");
    // For project-specific endpoint, use the passed-in projectId
    parsed.projectId = projectId;
    return parsed;
  });
}

/*
 * ---------------------------------------------------------------------------
 * The hand-off that ends an SSO sign-in (#9989, ../sso/handOff).
 * ---------------------------------------------------------------------------
 */

// The answer of GET /identity/sign-in-methods that says the server hands back codes.
const HAND_OFF_SUPPORTED_FIELD: string = "isMobileSsoHandOffSupported";

/**
 * Whether `serverUrl` hands an SSO sign-in the app starts back as a one-time
 * code (#9989), never as tokens on the deep link.
 *
 * Read when a sign-in starts, so the app knows what it may take back. Only a
 * server that answered and did not say so - a server from before #9989, or
 * one so old it has no such route (404) - is told apart: a link carrying
 * tokens may then end the sign-in, as it always did. Anything else, a
 * failure to reach the server included, is answered as a server that hands
 * back codes: a link carrying tokens is then refused, never taken on a
 * guess.
 */
export async function fetchServerHandsBackSsoCodes(
  serverUrl: string,
): Promise<boolean> {
  try {
    const response: AxiosResponse = await axios.get(
      `${serverUrl}/identity/sign-in-methods`,
      { timeout: 15000 },
    );
    const answer: unknown = response.data;

    return Boolean(
      answer &&
        typeof answer === "object" &&
        (answer as Record<string, unknown>)[HAND_OFF_SUPPORTED_FIELD] === true,
    );
  } catch (error) {
    const status: number | undefined = (
      error as { response?: { status?: number } } | undefined
    )?.response?.status;

    return status !== 404;
  }
}

/**
 * Redeems the one-time code an SSO sign-in handed back, with the verifier
 * and the state the app started it with (POST /identity/mobile-sso-exchange):
 * the sign-in the code stands for, as a deep link from before #9989 carried
 * it. Throws for an answer that is not one.
 */
export async function exchangeSsoCode(data: {
  serverUrl: string;
  code: string;
  codeVerifier: string;
  state: string;
}): Promise<SsoCallbackSuccess> {
  const response: AxiosResponse = await axios.post(
    `${data.serverUrl}/identity/mobile-sso-exchange`,
    { code: data.code, codeVerifier: data.codeVerifier, state: data.state },
    {
      timeout: 30000,
      headers: { "Content-Type": "application/json" },
    },
  );
  const body: Record<string, unknown> =
    response.data && typeof response.data === "object"
      ? (response.data as Record<string, unknown>)
      : {};

  const text: (key: string) => string | null = (key: string): string | null => {
    const value: unknown = body[key];

    return typeof value === "string" && value ? value : null;
  };

  const accessToken: string | null = text("accessToken");
  const refreshToken: string | null = text("refreshToken");
  const refreshTokenExpiresAt: string | null = text("refreshTokenExpiresAt");
  const userId: string | null = text("userId");

  if (
    !accessToken ||
    !refreshToken ||
    !refreshTokenExpiresAt ||
    !Number.isFinite(Date.parse(refreshTokenExpiresAt)) ||
    !userId
  ) {
    throw new Error(
      "The server did not complete single sign-on. Please try again.",
    );
  }

  const ssoToken: string | null = text("ssoToken");
  const projectId: string | null = text("projectId");

  return {
    status: "success",
    tokens: { accessToken, refreshToken, refreshTokenExpiresAt },
    user: {
      userId,
      email: text("email") || "",
      name: text("name") || "",
      isMasterAdmin: body["isMasterAdmin"] === true,
    },
    globalSsoToken: text("globalSsoToken"),
    projectSsoToken: ssoToken && projectId ? { projectId, ssoToken } : null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * A project's SSO sign-in link (#9989, ../sso/projectLink).
 * ---------------------------------------------------------------------------
 */

// A provider a project's SSO sign-in link offers: its own, or the server's.
export interface LinkedSsoProvider {
  id: string;
  name: string;
  // Empty when the provider has none, or only "Sign in with <name>".
  description: string;
  kind: SsoProviderKind;
}

// The server's provider types (Common/Types/SSO/SsoProviderType), as kinds.
const KIND_OF_PROVIDER_TYPE: Record<string, SsoProviderKind> = {
  ProjectSSO: "project",
  ProjectOIDC: "project-oidc",
  GlobalSSO: "global-sso",
  GlobalOIDC: "global-oidc",
};

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// No more than a sign-in page draws from an answer (SignInMethodsUtil).
const MAX_PROVIDER_TEXT_LENGTH: number = 500;

function providerText(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_PROVIDER_TEXT_LENGTH)
    : "";
}

/**
 * The providers that sign people in to one project
 * (GET /identity/project-sign-in-methods/<project id>) - the ones the page a
 * project's SSO sign-in link opens on the web lists. Asked by the project's
 * id alone: no address is sent.
 *
 * Each with a real id, a kind the app starts and a name; anything else in
 * the answer is left out, never drawn as a button that cannot work. An
 * answer the server gave that lists nothing - no such project, or none of
 * its providers turned on - is an empty list, not a failure.
 */
export async function fetchProjectSignInProviders(
  projectId: string,
): Promise<SsoDiscoveryResult<LinkedSsoProvider>> {
  return settle(async (): Promise<Array<LinkedSsoProvider>> => {
    const serverUrl: string = await getServerUrl();
    const response: AxiosResponse = await axios.get(
      `${serverUrl.replace(/\/+$/, "")}/identity/project-sign-in-methods/${encodeURIComponent(projectId)}`,
      { timeout: 15000 },
    );
    const rows: unknown = (
      response.data as { ssoProviders?: unknown } | null | undefined
    )?.ssoProviders;
    const providers: Array<LinkedSsoProvider> = [];
    const seen: Set<string> = new Set<string>();

    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row !== "object") {
        continue;
      }

      const item: Record<string, unknown> = row as Record<string, unknown>;
      const kind: SsoProviderKind | undefined =
        typeof item["type"] === "string"
          ? KIND_OF_PROVIDER_TYPE[item["type"]]
          : undefined;
      const id: string = providerText(item["id"]);
      const name: string = providerText(item["name"]);
      const description: string = providerText(item["description"]);

      if (!kind || !UUID_PATTERN.test(id) || !name) {
        continue;
      }

      const key: string = `${kind}:${id.toLowerCase()}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      providers.push({
        id,
        name,
        description: description === `Sign in with ${name}` ? "" : description,
        kind,
      });
    }

    return providers;
  });
}
