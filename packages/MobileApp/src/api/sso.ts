import axios, { AxiosResponse } from "axios";
import { getServerUrl } from "../storage/serverUrl";
import type { SsoProviderKind } from "../sso/providerUrl";

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
 * This distinction is not cosmetic. App/FeatureSet/Identity/API/SSO.ts answers
 * the ordinary "this email has no project SSO" case with HTTP 400
 * ("No SSO config found for this user") - for an unknown user, a user with no
 * id, and a user who belongs to no project alike. axios rejects on 4xx, so
 * treating every rejection as a failure tells the user their network is broken
 * when in fact the server replied correctly and immediately.
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
