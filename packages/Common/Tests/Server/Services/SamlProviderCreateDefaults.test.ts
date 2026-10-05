import GlobalSSO from "../../../Models/DatabaseModels/GlobalSso";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import StatusPageSSO from "../../../Models/DatabaseModels/StatusPageSso";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import StatusPageSsoService from "../../../Server/Services/StatusPageSsoService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import {
  GlobalProviderTrust,
  clearGlobalSsoAuthorizationCaches,
  globalSsoProviderTrustCache,
} from "../../../Server/Utils/GlobalSsoAuthorization";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import DigestMethod from "../../../Types/SSO/DigestMethod";
import SignatureMethod from "../../../Types/SSO/SignatureMethod";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A SAML PROVIDER CREATED WITH ONLY WHAT THE IDENTITY PROVIDER GIVES IS
 * COMPLETE.
 *
 * Adding a SAML provider - for a project, a status page or the whole
 * instance - now asks for its name, sign-on URL, issuer and certificate, and
 * fills in the rest. The services are where that happens, so an API caller
 * who leaves the rest out gets the same provider the forms make:
 *
 *   - the signature method is RSA-SHA256 and the digest method SHA256;
 *   - the description is "Sign in with <name>".
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

const SIGN_ON_URL: string =
  "https://dev-123456.okta.com/app/dev-123456_oneuptime_1/exk1/sso/saml";
const ISSUER: string = "http://www.okta.com/exk1a2b3c4d5e6f7g8h9";
const CERTIFICATE: string =
  "-----BEGIN CERTIFICATE-----\nMIIDpDCCAoygAwIBAgIGAYQ\n-----END CERTIFICATE-----";

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
  values["signOnURL"] = URL.fromString(SIGN_ON_URL);
  values["issuerURL"] = ISSUER;
  values["publicCertificate"] = CERTIFICATE;

  return provider;
}

const SERVICES: Array<ServiceCase> = [
  {
    name: "ProjectSsoService (Settings > SSO)",
    service: ProjectSsoService as unknown as HookedService<BaseModel>,
    makeEssentials: (): BaseModel => {
      const provider: ProjectSSO = new ProjectSSO();
      provider.projectId = PROJECT_ID;

      return essentialsOf(provider);
    },
  },
  {
    name: "StatusPageSsoService (a status page's SSO)",
    service: StatusPageSsoService as unknown as HookedService<BaseModel>,
    makeEssentials: (): BaseModel => {
      const provider: StatusPageSSO = new StatusPageSSO();
      provider.projectId = PROJECT_ID;
      provider.statusPageId = STATUS_PAGE_ID;

      return essentialsOf(provider);
    },
  },
  {
    name: "GlobalSsoService (Admin > Global SSO)",
    service: GlobalSsoService as unknown as HookedService<BaseModel>,
    makeEssentials: (): BaseModel => {
      return essentialsOf(new GlobalSSO());
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

    expect({
      signatureMethod: created["signatureMethod"],
      digestMethod: created["digestMethod"],
      description: created["description"],
    }).toEqual({
      signatureMethod: SignatureMethod.SHA256,
      digestMethod: DigestMethod.SHA256,
      description: "Sign in with Okta",
    });

    // What the caller gave is untouched.
    expect(created["name"]).toBe("Okta");
    expect(String(created["signOnURL"])).toBe(SIGN_ON_URL);
    expect(created["issuerURL"]).toBe(ISSUER);
    expect(created["publicCertificate"]).toBe(CERTIFICATE);
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

  test("names each column it fills in as required when left out past the hook", () => {
    for (const column of ["signatureMethod", "digestMethod", "description"]) {
      const provider: BaseModel = serviceCase.makeEssentials();
      const values: ProviderValues = provider as unknown as ProviderValues;
      values["signatureMethod"] = SignatureMethod.SHA256;
      values["digestMethod"] = DigestMethod.SHA256;
      values["description"] = "Sign in with Okta";
      delete values[column];

      expect(() => {
        serviceCase.service.checkRequiredFields(provider);
      }).toThrow(`${column} is required`);
    }
  });

  test("keeps every value the caller sent", async () => {
    const provider: BaseModel = serviceCase.makeEssentials();
    const values: ProviderValues = provider as unknown as ProviderValues;
    values["signatureMethod"] = SignatureMethod.SHA512;
    values["digestMethod"] = DigestMethod.SHA384;
    values["description"] = "Staff only";

    const created: ProviderValues = await runOnBeforeCreate(
      serviceCase,
      provider,
    );

    expect({
      signatureMethod: created["signatureMethod"],
      digestMethod: created["digestMethod"],
      description: created["description"],
    }).toEqual({
      signatureMethod: SignatureMethod.SHA512,
      digestMethod: DigestMethod.SHA384,
      description: "Staff only",
    });
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

  test("never makes up what only the identity provider can give", async () => {
    for (const column of ["signOnURL", "issuerURL", "publicCertificate"]) {
      const provider: BaseModel = serviceCase.makeEssentials();
      delete (provider as unknown as ProviderValues)[column];

      const created: ProviderValues = await runOnBeforeCreate(
        serviceCase,
        provider,
      );

      expect({ column, value: created[column] }).toEqual({
        column,
        value: undefined,
      });
      expect(() => {
        serviceCase.service.checkRequiredFields(provider);
      }).toThrow(`${column} is required`);
    }
  });
});

describe("GlobalSsoService", () => {
  test("still clears the sign-in trust caches when a provider is created", async () => {
    const trust: GlobalProviderTrust = {
      isUsable: false,
      restrictToAttachedProjects: false,
    };

    globalSsoProviderTrustCache.set("sso:cached-provider", trust, 60000);
    expect(globalSsoProviderTrustCache.get("sso:cached-provider")).toEqual(
      trust,
    );

    await runOnBeforeCreate(SERVICES[2]!, SERVICES[2]!.makeEssentials());

    expect(
      globalSsoProviderTrustCache.get("sso:cached-provider"),
    ).toBeUndefined();
  });
});
