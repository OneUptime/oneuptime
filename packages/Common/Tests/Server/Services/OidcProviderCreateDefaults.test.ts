import GlobalOIDC from "../../../Models/DatabaseModels/GlobalOidc";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import StatusPageOIDC from "../../../Models/DatabaseModels/StatusPageOidc";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import StatusPageOidcService from "../../../Server/Services/StatusPageOidcService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import {
  GlobalProviderTrust,
  clearGlobalSsoAuthorizationCaches,
  globalSsoProviderTrustCache,
} from "../../../Server/Utils/GlobalSsoAuthorization";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

/*
 * AN OIDC PROVIDER CREATED WITH ONLY WHAT THE IDENTITY PROVIDER GIVES IS
 * COMPLETE.
 *
 * Adding an OpenID Connect provider - for a project, a status page or the
 * whole instance - now asks for its name, issuer, client ID and secret, and
 * fills in the rest. The services are where that happens, so an API caller
 * who leaves the rest out gets the same provider the forms make:
 *
 *   - the discovery URL is worked out from the issuer
 *     (issuer + /.well-known/openid-configuration);
 *   - the scopes are "openid email profile", the claim names "email" and
 *     "name";
 *   - the description is "Sign in with <name>";
 *   - a discovery URL given as the issuer is split into the two.
 *
 * The columns stay required, so the API and Terraform keep their contract:
 * the hook fills them in before the required-field check runs, and a
 * provider created past the hook (ignoreHooks) still has to bring them.
 * Nothing here touches a database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);

interface HookedService<TModel extends BaseModel> {
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<OnCreate<TModel>>;
  checkRequiredFields: (data: TModel) => TModel;
}

interface ServiceCase {
  name: string;
  service: HookedService<BaseModel>;
  // A provider with only what the identity provider gives, and its owner.
  makeEssentials: () => BaseModel;
}

type ProviderValues = Record<string, unknown>;

function essentialsOf(provider: BaseModel): BaseModel {
  const values: ProviderValues = provider as unknown as ProviderValues;
  values["name"] = "Okta";
  values["issuerURL"] = "https://dev-123456.okta.com/oauth2/default";
  values["clientId"] = "0oa1b2c3d4e5f6g7h8i9";
  values["clientSecret"] = "a-client-secret";

  return provider;
}

const SERVICES: Array<ServiceCase> = [
  {
    name: "ProjectOidcService (Settings > OIDC)",
    service: ProjectOidcService as unknown as HookedService<BaseModel>,
    makeEssentials: (): BaseModel => {
      const provider: ProjectOIDC = new ProjectOIDC();
      provider.projectId = PROJECT_ID;

      return essentialsOf(provider);
    },
  },
  {
    name: "StatusPageOidcService (a status page's OIDC)",
    service: StatusPageOidcService as unknown as HookedService<BaseModel>,
    makeEssentials: (): BaseModel => {
      const provider: StatusPageOIDC = new StatusPageOIDC();
      provider.projectId = PROJECT_ID;
      provider.statusPageId = STATUS_PAGE_ID;

      return essentialsOf(provider);
    },
  },
  {
    name: "GlobalOidcService (Admin > Global OIDC)",
    service: GlobalOidcService as unknown as HookedService<BaseModel>,
    makeEssentials: (): BaseModel => {
      return essentialsOf(new GlobalOIDC());
    },
  },
];

async function runOnBeforeCreate(
  serviceCase: ServiceCase,
  provider: BaseModel,
): Promise<ProviderValues> {
  const result: OnCreate<BaseModel> = await serviceCase.service.onBeforeCreate({
    data: provider,
    props: { isRoot: true },
  });

  return result.createBy.data as unknown as ProviderValues;
}

afterEach(() => {
  clearGlobalSsoAuthorizationCaches();
});

describe.each(SERVICES)("$name", (serviceCase: ServiceCase) => {
  test("fills in what the identity provider does not give", async () => {
    const created: ProviderValues = await runOnBeforeCreate(
      serviceCase,
      serviceCase.makeEssentials(),
    );

    expect(created["discoveryURL"]).toBeInstanceOf(URL);
    expect(String(created["discoveryURL"])).toBe(
      "https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration",
    );
    expect(created["scopes"]).toBe("openid email profile");
    expect(created["emailClaimName"]).toBe("email");
    expect(created["nameClaimName"]).toBe("name");
    expect(created["description"]).toBe("Sign in with Okta");

    // What the caller gave is untouched.
    expect(created["name"]).toBe("Okta");
    expect(created["issuerURL"]).toBe(
      "https://dev-123456.okta.com/oauth2/default",
    );
    expect(created["clientId"]).toBe("0oa1b2c3d4e5f6g7h8i9");
    expect(created["clientSecret"]).toBe("a-client-secret");
  });

  test("before the required-field check, which then passes", async () => {
    const provider: BaseModel = serviceCase.makeEssentials();

    // Left out, the columns are still required...
    expect(() => {
      serviceCase.service.checkRequiredFields(serviceCase.makeEssentials());
    }).toThrow(/is required/);

    // ...and the hook fills every one of them in.
    await runOnBeforeCreate(serviceCase, provider);

    expect(() => {
      serviceCase.service.checkRequiredFields(provider);
    }).not.toThrow();
  });

  test("keeps every value the caller sent", async () => {
    const provider: BaseModel = serviceCase.makeEssentials();
    const values: ProviderValues = provider as unknown as ProviderValues;
    values["description"] = "Staff only";
    values["discoveryURL"] = URL.fromString(
      "https://sso.example.com/metadata/openid-configuration",
    );
    values["scopes"] = "openid email";
    values["emailClaimName"] = "upn";
    values["nameClaimName"] = "preferred_username";

    const created: ProviderValues = await runOnBeforeCreate(
      serviceCase,
      provider,
    );

    expect({
      description: created["description"],
      discoveryURL: String(created["discoveryURL"]),
      scopes: created["scopes"],
      emailClaimName: created["emailClaimName"],
      nameClaimName: created["nameClaimName"],
    }).toEqual({
      description: "Staff only",
      discoveryURL: "https://sso.example.com/metadata/openid-configuration",
      scopes: "openid email",
      emailClaimName: "upn",
      nameClaimName: "preferred_username",
    });
  });

  test("splits a discovery URL given as the issuer", async () => {
    const provider: BaseModel = serviceCase.makeEssentials();
    (provider as unknown as ProviderValues)["issuerURL"] =
      "https://accounts.google.com/.well-known/openid-configuration";

    const created: ProviderValues = await runOnBeforeCreate(
      serviceCase,
      provider,
    );

    expect(created["issuerURL"]).toBe("https://accounts.google.com");
    expect(String(created["discoveryURL"])).toBe(
      "https://accounts.google.com/.well-known/openid-configuration",
    );
  });

  test("without a usable issuer, leaves the discovery URL for the required-field check to name", async () => {
    const provider: BaseModel = serviceCase.makeEssentials();
    (provider as unknown as ProviderValues)["issuerURL"] = "not a url";

    await runOnBeforeCreate(serviceCase, provider);

    expect(() => {
      serviceCase.service.checkRequiredFields(provider);
    }).toThrow("discoveryURL is required");
  });

  test("without a name, leaves the description missing: the name is what is asked for", async () => {
    const provider: BaseModel = serviceCase.makeEssentials();
    delete (provider as unknown as ProviderValues)["name"];

    const created: ProviderValues = await runOnBeforeCreate(
      serviceCase,
      provider,
    );

    expect(created["description"]).toBeUndefined();
    expect(() => {
      serviceCase.service.checkRequiredFields(provider);
    }).toThrow(/is required/);
  });
});

describe("GlobalOidcService", () => {
  test("still clears the sign-in trust caches when a provider is created", async () => {
    const trust: GlobalProviderTrust = {
      isUsable: false,
      restrictToAttachedProjects: false,
      signInsEndedAtMs: null,
    };

    globalSsoProviderTrustCache.set("oidc:cached-provider", trust, 60000);
    expect(globalSsoProviderTrustCache.get("oidc:cached-provider")).toEqual(
      trust,
    );

    await runOnBeforeCreate(SERVICES[2]!, SERVICES[2]!.makeEssentials());

    expect(
      globalSsoProviderTrustCache.get("oidc:cached-provider"),
    ).toBeUndefined();
  });
});
