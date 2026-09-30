import { IDENTITY_PREFIXES, identityRouteUrl, stackUrl } from "./SsoRoutes";
import { APIRequestContext, APIResponse, expect } from "@playwright/test";
import Faker from "Common/Utils/Faker";
import zlib from "zlib";

/*
 * Single sign-on configured and used end to end, over the API alone: a
 * project owner sets up a SAML provider, the sign-in listings offer it, its
 * start route sends the browser to the identity provider, and "Require SSO
 * for login" is enforced.
 *
 * Single sign-on is core, so all of that must hold on every self-hosted
 * stack: the Community Edition, and the Enterprise Edition whatever its
 * licence says. The steps are shared here so the Community run
 * (Tests/App/SingleSignOn.spec.ts) and the lapsed Enterprise run
 * (Enterprise/Lapsed/SsoUnaffectedByLapse.spec.ts) assert exactly the same
 * thing. Not on OneUptime Cloud (billing on), where SSO configuration is sold
 * on the Scale plan (@TableBillingAccessControl on ProjectSso and on
 * Project.requireSsoForLogin) and a new project is below it: callers skip
 * when billing is on.
 *
 * What only a booted stack proves: the jest suites cover each piece - the
 * permission pipeline (packages/Common/Tests/Server/Enterprise/
 * SsoInCommunityEdition.test.ts), the routes, the enforcement middleware -
 * with the database or the licence mocked. Only here do they meet: a row
 * written through the real CRUD API is what the real sign-in routes read,
 * through nginx, in a published image.
 *
 * Every request goes through one APIRequestContext, whose cookie jar holds
 * the session of an owner the caller signed up (Tests/Helpers/ApiSignup.ts).
 * Each helper returns the raw answer or asserts it, never both, and every
 * failure message names `where` - the stack the caller runs against -
 * because the same assertion failing on the Community stack and on the
 * lapsed Enterprise stack are different bugs.
 */

// Common/Models/DatabaseModels/ProjectSso.ts (@CrudApiEndpoint "/project-sso").
export const PROJECT_SSO_API_PATH: string = "/api/project-sso";

export const PROJECT_API_PATH: string = "/api/project";

/*
 * What UserAuthorization answers, with a 406, for a project that requires
 * SSO when the session carries no SSO token for it - copied from
 * Common/Types/Exception/SsoAuthorizationException.ts rather than imported,
 * like every other server string this package pins. The Dashboard turns the
 * 406 into its "sign in with SSO" page.
 */
export const SSO_AUTHORIZATION_REQUIRED_MESSAGE: string =
  "SSO Authorization Required";

/*
 * The identity provider the test provider points at. Nothing is ever sent
 * there: the start route only REDIRECTS to it, and every request here stops
 * at the redirect.
 */
export const E2E_IDP_SIGN_ON_URL: string = "https://idp.example.com/e2e/saml";

const E2E_IDP_ISSUER: string = "https://idp.example.com/e2e/issuer";

/*
 * Required by the model, but only read to verify a signed SAML response,
 * which no test here posts.
 */
const E2E_IDP_CERTIFICATE: string =
  "e2e placeholder certificate: no SAML response is ever verified against it";

export interface ApiOutcome {
  status: number;
  // The raw body, so a caller can assert which answer it is.
  body: string;
}

type ReadIdFunction = (value: unknown) => string;

// Ids come back as a bare string or as { _type: "ObjectID", value }.
const readId: ReadIdFunction = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    return String((value as Record<string, unknown>)["value"] || "");
  }

  return "";
};

type ReadJsonFunction = (body: string) => Record<string, unknown>;

// The body as a JSON object; {} for anything else.
const readJson: ReadJsonFunction = (body: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(body);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

type ReadCreatedIdFunction = (body: string) => string;

// The id a CRUD create answered with (bare, or wrapped in `data`).
const readCreatedId: ReadCreatedIdFunction = (body: string): string => {
  const parsed: Record<string, unknown> = readJson(body);
  const data: Record<string, unknown> =
    (parsed["data"] as Record<string, unknown>) || parsed;

  return readId(data["_id"]);
};

type ReadListedIdsFunction = (body: string) => Array<string>;

// The ids in an entity array answer ({ data: [...] }).
const readListedIds: ReadListedIdsFunction = (body: string): Array<string> => {
  const data: unknown = readJson(body)["data"];

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((item: unknown): string => {
    return readId((item as Record<string, unknown>)["_id"]);
  });
};

type ToOutcomeFunction = (response: APIResponse) => Promise<ApiOutcome>;

const toOutcome: ToOutcomeFunction = async (
  response: APIResponse,
): Promise<ApiOutcome> => {
  return { status: response.status(), body: await response.text() };
};

type DescribeOutcomeFunction = (data: {
  request: string;
  outcome: ApiOutcome;
}) => string;

const describeOutcome: DescribeOutcomeFunction = (data: {
  request: string;
  outcome: ApiOutcome;
}): string => {
  return `HTTP ${data.outcome.status} from ${data.request}: ${data.outcome.body.slice(
    0,
    300,
  )}`;
};

type ProjectHeadersFunction = (projectId: string) => Record<string, string>;

// The tenant headers the Dashboard sends with every project-scoped request.
const projectHeaders: ProjectHeadersFunction = (
  projectId: string,
): Record<string, string> => {
  return {
    "content-type": "application/json",
    tenantid: projectId,
    projectid: projectId,
  };
};

type ProjectSsoCreateBodyFunction = (data: {
  projectId: string;
  name: string;
  isEnabled: boolean;
}) => { data: Record<string, unknown> };

/*
 * The body of a project SAML provider create, as the Dashboard's form sends
 * it: every column ProjectSso requires, and signOnURL - a URL column - as the
 * serialized envelope (JSONFunctions.serialize) the API turns back into a URL.
 * The signature and digest methods are the form's defaults
 * (Common/Types/SSO/SignatureMethod.ts and DigestMethod.ts).
 */
export const projectSsoCreateBody: ProjectSsoCreateBodyFunction = (data: {
  projectId: string;
  name: string;
  isEnabled: boolean;
}): { data: Record<string, unknown> } => {
  return {
    data: {
      name: data.name,
      description: "Created by the e2e suite.",
      projectId: data.projectId,
      signOnURL: { _type: "URL", value: E2E_IDP_SIGN_ON_URL },
      issuerURL: E2E_IDP_ISSUER,
      publicCertificate: E2E_IDP_CERTIFICATE,
      signatureMethod: "RSA-SHA256",
      digestMethod: "SHA256",
      isEnabled: data.isEnabled,
    },
  };
};

type CreateProjectSsoFunction = (data: {
  request: APIRequestContext;
  projectId: string;
  name: string;
  isEnabled: boolean;
}) => Promise<ApiOutcome & { id: string }>;

// Creates a project SAML provider as the signed-in owner, RAW answer.
export const createProjectSso: CreateProjectSsoFunction = async (data: {
  request: APIRequestContext;
  projectId: string;
  name: string;
  isEnabled: boolean;
}): Promise<ApiOutcome & { id: string }> => {
  const outcome: ApiOutcome = await toOutcome(
    await data.request.post(stackUrl(PROJECT_SSO_API_PATH), {
      headers: projectHeaders(data.projectId),
      data: projectSsoCreateBody({
        projectId: data.projectId,
        name: data.name,
        isEnabled: data.isEnabled,
      }),
    }),
  );

  return { ...outcome, id: readCreatedId(outcome.body) };
};

type SetProjectRequireSsoFunction = (data: {
  request: APIRequestContext;
  projectId: string;
  requireSsoForLogin: boolean;
}) => Promise<ApiOutcome>;

// "Force SSO for Login" on Settings > SSO: one column of the project, RAW answer.
export const setProjectRequireSsoForLogin: SetProjectRequireSsoFunction =
  async (data: {
    request: APIRequestContext;
    projectId: string;
    requireSsoForLogin: boolean;
  }): Promise<ApiOutcome> => {
    return toOutcome(
      await data.request.put(
        stackUrl(`${PROJECT_API_PATH}/${data.projectId}`),
        {
          headers: projectHeaders(data.projectId),
          data: { data: { requireSsoForLogin: data.requireSsoForLogin } },
        },
      ),
    );
  };

type ReadProjectFunction = (data: {
  request: APIRequestContext;
  projectId: string;
}) => Promise<ApiOutcome>;

// Reads the project as the signed-in user, RAW answer.
export const readProject: ReadProjectFunction = async (data: {
  request: APIRequestContext;
  projectId: string;
}): Promise<ApiOutcome> => {
  return toOutcome(
    await data.request.post(
      stackUrl(`${PROJECT_API_PATH}/${data.projectId}/get-item`),
      {
        headers: projectHeaders(data.projectId),
        data: { select: { name: true } },
      },
    ),
  );
};

type ExpectSamlProviderAcceptedFunction = (data: {
  request: APIRequestContext;
  projectId: string;
  where: string;
}) => Promise<string>;

/*
 * A project owner can configure a SAML provider: the create answers 200 with
 * the new row's id, which this returns. The provider is ENABLED, because the
 * steps after this one need the sign-in routes to offer and start it; it is
 * harmless to the owner, whose password sign-in only changes if "Require SSO
 * for login" is switched on (expectRequireSsoForLoginEnforced does that on a
 * project of its own).
 */
export const expectSamlProviderAccepted: ExpectSamlProviderAcceptedFunction =
  async (data: {
    request: APIRequestContext;
    projectId: string;
    where: string;
  }): Promise<string> => {
    const result: ApiOutcome & { id: string } = await createProjectSso({
      request: data.request,
      projectId: data.projectId,
      name: `E2E SAML ${Faker.generateName().toString()}`,
      isEnabled: true,
    });

    const found: string = describeOutcome({
      request: `POST ${stackUrl(PROJECT_SSO_API_PATH)}`,
      outcome: result,
    });

    /*
     * A 402 would mean the write was refused as enterprise configuration -
     * with the Community Edition's message on a Community stack, with the
     * licence message on a lapsed Enterprise one. ProjectSso carries no
     * @TableEditionAccessControl, so neither may come back.
     */
    expect(
      result.status,
      `Configuring single sign-on was refused as enterprise configuration ${data.where}. ` +
        `SSO is core and needs neither the Enterprise Edition nor a licence. ${found}`,
    ).not.toBe(402);

    expect(
      result.status,
      `Configuring single sign-on must be accepted ${data.where}. ${found}`,
    ).toBe(200);

    expect(
      result.id,
      `The SSO configuration create must answer with the new row's id. ${found}`,
    ).not.toBe("");

    return result.id;
  };

type ExpectSamlProviderOfferedFunction = (data: {
  request: APIRequestContext;
  projectId: string;
  projectSsoId: string;
  ownerEmail: string;
  where: string;
}) => Promise<void>;

/*
 * Both lists a sign-in page reads name the new provider, unmasked:
 *
 *   - POST /api/project-sso/<projectId>/sso-list, the Dashboard's "sign in
 *     to this project with SSO" page (Common/Server/API/ProjectSSO.ts). It is
 *     unauthenticated and lists the project's ENABLED providers;
 *   - GET /identity/service-provider-login?email=..., the Accounts sign-in
 *     page's discovery by email (FeatureSet/Identity/API/SSO.ts), which lists
 *     the enabled providers of every project the address belongs to.
 *
 * Either one coming back empty would leave a working provider that no page
 * offers.
 */
export const expectSamlProviderOffered: ExpectSamlProviderOfferedFunction =
  async (data: {
    request: APIRequestContext;
    projectId: string;
    projectSsoId: string;
    ownerEmail: string;
    where: string;
  }): Promise<void> => {
    const listUrl: string = stackUrl(
      `${PROJECT_SSO_API_PATH}/${data.projectId}/sso-list`,
    );
    const listed: ApiOutcome = await toOutcome(
      await data.request.post(listUrl, {
        headers: { "content-type": "application/json" },
        data: {},
      }),
    );
    const listedFound: string = describeOutcome({
      request: `POST ${listUrl}`,
      outcome: listed,
    });

    expect(listed.status, listedFound).toBe(200);

    expect(
      readListedIds(listed.body),
      `The project's SSO list must offer its enabled provider ${data.where}. ${listedFound}`,
    ).toContain(data.projectSsoId);

    const discoveryUrl: string = identityRouteUrl({
      prefix: "/identity",
      path: "/service-provider-login",
    });
    const discovered: ApiOutcome = await toOutcome(
      await data.request.get(discoveryUrl, {
        params: { email: data.ownerEmail },
        maxRedirects: 0,
      }),
    );
    const discoveredFound: string = describeOutcome({
      request: `GET ${discoveryUrl}?email=${data.ownerEmail}`,
      outcome: discovered,
    });

    expect(discovered.status, discoveredFound).toBe(200);

    expect(
      readListedIds(discovered.body),
      `SSO discovery by email must offer the provider of the owner's project ${data.where}. ` +
        `${discoveredFound}`,
    ).toContain(data.projectSsoId);
  };

type ExpectSamlStartRedirectsFunction = (data: {
  request: APIRequestContext;
  projectId: string;
  projectSsoId: string;
  where: string;
}) => Promise<void>;

/*
 * "Sign in with SSO" works: GET /identity/sso/<projectId>/<providerId>, on
 * both identity prefixes, redirects to the provider's sign-on URL with a
 * SAML AuthnRequest (FeatureSet/Identity/API/SSO.ts and
 * Utils/SSO.ts#createSAMLRequestUrl). The request is decoded and read back,
 * because it carries the two addresses a customer copies into their
 * identity provider from Settings > SSO, and they must never change: the
 * ACS URL /identity/idp-login/<projectId>/<providerId> and the Entity ID
 * <host>/<projectId>/<providerId>.
 */
export const expectSamlStartRedirectsToProvider: ExpectSamlStartRedirectsFunction =
  async (data: {
    request: APIRequestContext;
    projectId: string;
    projectSsoId: string;
    where: string;
  }): Promise<void> => {
    for (const prefix of IDENTITY_PREFIXES) {
      const url: string = identityRouteUrl({
        prefix,
        path: `/sso/${data.projectId}/${data.projectSsoId}`,
      });

      // Stop at the redirect: the identity provider is not a real host.
      const response: APIResponse = await data.request.get(url, {
        maxRedirects: 0,
      });
      const location: string = response.headers()["location"] || "";
      const found: string = `HTTP ${response.status()} from GET ${url}, Location "${location}": ${(
        await response.text()
      ).slice(0, 300)}`;

      expect(
        response.status(),
        `The SAML sign-in start must redirect to the identity provider ${data.where}. ${found}`,
      ).toBe(302);

      expect(
        location.startsWith(`${E2E_IDP_SIGN_ON_URL}?`),
        `The redirect must go to the provider's sign-on URL (${E2E_IDP_SIGN_ON_URL}). ${found}`,
      ).toBe(true);

      const samlRequest: string =
        new URL(location).searchParams.get("SAMLRequest") || "";

      expect(
        samlRequest,
        `The redirect must carry a SAMLRequest. ${found}`,
      ).not.toBe("");

      // HTTP-Redirect binding: raw DEFLATE, then base64.
      const authnRequest: string = zlib
        .inflateRawSync(Buffer.from(samlRequest, "base64"))
        .toString("utf8");

      expect(
        authnRequest,
        `The SAMLRequest must be an AuthnRequest. Found: ${authnRequest.slice(0, 500)}`,
      ).toContain("<samlp:AuthnRequest");

      expect(
        authnRequest,
        `The AuthnRequest must name this provider's ACS URL, ` +
          `/identity/idp-login/<projectId>/<providerId>. Found: ${authnRequest.slice(0, 500)}`,
      ).toContain(
        `/identity/idp-login/${data.projectId}/${data.projectSsoId}"`,
      );

      expect(
        authnRequest,
        `The AuthnRequest must name this provider's Entity ID, ` +
          `<host>/<projectId>/<providerId>. Found: ${authnRequest.slice(0, 500)}`,
      ).toContain(`/${data.projectId}/${data.projectSsoId}</Issuer>`);
    }
  };

type ExpectRequireSsoEnforcedFunction = (data: {
  request: APIRequestContext;
  // A project of its own: switching the requirement on locks the owner out of it.
  ssoProjectId: string;
  // A project that does not require SSO, as the control.
  openProjectId: string;
  where: string;
}) => Promise<void>;

/*
 * "Require SSO for login" can be switched on, and is then ENFORCED.
 *
 * The owner is signed in with a password, so once their project requires SSO
 * UserAuthorization refuses their session for that project with a 406 and
 * SSO_AUTHORIZATION_REQUIRED_MESSAGE (Common/Server/Middleware/
 * UserAuthorization.ts) - the answer the Dashboard turns into its SSO sign-in
 * page. The same session still reads a project that does not require SSO,
 * so the 406 is the requirement and not a broken session.
 *
 * A 402 on the switch, or the project still readable after it, would mean
 * the requirement depends on the edition or the licence - which it never
 * does.
 *
 * The project is given up afterwards: its only member can no longer use it
 * without SSO, and the stack is thrown away with the job.
 */
export const expectRequireSsoForLoginEnforced: ExpectRequireSsoEnforcedFunction =
  async (data: {
    request: APIRequestContext;
    ssoProjectId: string;
    openProjectId: string;
    where: string;
  }): Promise<void> => {
    const switchedOn: ApiOutcome = await setProjectRequireSsoForLogin({
      request: data.request,
      projectId: data.ssoProjectId,
      requireSsoForLogin: true,
    });
    const switchedOnFound: string = describeOutcome({
      request: `PUT ${stackUrl(`${PROJECT_API_PATH}/${data.ssoProjectId}`)}`,
      outcome: switchedOn,
    });

    expect(
      switchedOn.status,
      `"Require SSO for login" could not be switched on ${data.where}: a 402 here ` +
        `means the requirement was treated as a licensed feature. ${switchedOnFound}`,
    ).not.toBe(402);

    expect(
      switchedOn.status,
      `Switching "Require SSO for login" on must be accepted ${data.where}. ${switchedOnFound}`,
    ).toBe(200);

    const refused: ApiOutcome = await readProject({
      request: data.request,
      projectId: data.ssoProjectId,
    });
    const refusedFound: string = describeOutcome({
      request: `POST ${stackUrl(`${PROJECT_API_PATH}/${data.ssoProjectId}/get-item`)}`,
      outcome: refused,
    });

    expect(
      refused.status,
      `A password session must be refused a project that requires SSO ${data.where}: ` +
        `the requirement is saved but not enforced. ${refusedFound}`,
    ).toBe(406);

    expect(
      readJson(refused.body),
      `The refusal must be UserAuthorization's SSO requirement. ${refusedFound}`,
    ).toEqual({ message: SSO_AUTHORIZATION_REQUIRED_MESSAGE });

    const control: ApiOutcome = await readProject({
      request: data.request,
      projectId: data.openProjectId,
    });

    expect(
      control.status,
      `The same session must still read a project that does not require SSO. ${describeOutcome(
        {
          request: `POST ${stackUrl(`${PROJECT_API_PATH}/${data.openProjectId}/get-item`)}`,
          outcome: control,
        },
      )}`,
    ).toBe(200);
  };
