import GlobalOidcProjectService from "../Services/GlobalOidcProjectService";
import GlobalOidcService from "../Services/GlobalOidcService";
import GlobalSsoProjectService from "../Services/GlobalSsoProjectService";
import GlobalSsoService from "../Services/GlobalSsoService";
import ProjectOidcService from "../Services/ProjectOidcService";
import ProjectService from "../Services/ProjectService";
import ProjectSsoService from "../Services/ProjectSsoService";
import SsoRequiredSignIn from "./SsoRequiredSignIn";
import GlobalOidc from "../../Models/DatabaseModels/GlobalOidc";
import GlobalSso from "../../Models/DatabaseModels/GlobalSso";
import ProjectOidc from "../../Models/DatabaseModels/ProjectOidc";
import ProjectSso from "../../Models/DatabaseModels/ProjectSso";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import {
  ProjectSignInMethods,
  SignInMethods,
  SsoSignInProvider,
} from "../../Types/SSO/SignInMethods";
import SsoProviderType from "../../Types/SSO/SsoProviderType";

/*
 * What the sign-in pages are told about how this server signs people in
 * (Types/SSO/SignInMethods; App/FeatureSet/Identity/API/SignInMethods.ts
 * serves it to anyone, signed in or not).
 *
 * Only what a sign-in page draws leaves here: each provider's kind, id, name
 * and description - what the instance-wide providers' own discovery routes
 * (/identity/global-sso/service-provider-login and its OIDC twin) have always
 * said to anyone - and, only while the server requires SSO, whether any
 * project has a provider of its own (never which).
 *
 * Every rule read lets its failure through: the route answers with the error,
 * and the page shows what it shows when nothing is known. The server refuses
 * what it must either way (SsoRequiredSignIn).
 */

// A provider row, as read for a sign-in page.
interface ProviderRow {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
  name?: string | undefined;
  description?: string | undefined;
}

type ToProviderFunction = (
  type: SsoProviderType,
  row: ProviderRow,
) => SsoSignInProvider | null;

const toProvider: ToProviderFunction = (
  type: SsoProviderType,
  row: ProviderRow,
): SsoSignInProvider | null => {
  const id: string = row.id?.toString() || row._id?.toString() || "";
  const name: string = (row.name || "").trim();

  if (!id || !name) {
    return null;
  }

  return {
    type: type,
    id: id,
    name: name,
    description: (row.description || "").trim(),
  };
};

type ByNameFunction = (a: SsoSignInProvider, b: SsoSignInProvider) => number;

/*
 * By name, as people scan a list - "Okta (contractors)" after "Okta" - then
 * by kind and id, so two providers of one name keep one order.
 */
const byName: ByNameFunction = (
  a: SsoSignInProvider,
  b: SsoSignInProvider,
): number => {
  return (
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
    a.type.localeCompare(b.type) ||
    a.id.localeCompare(b.id)
  );
};

const PROVIDER_SELECT: {
  _id: true;
  name: true;
  description: true;
} = {
  _id: true,
  name: true,
  description: true,
};

export default class SsoSignInMethods {
  /*
   * How this server signs people in: whether it requires SSO, its
   * instance-wide providers that are on, and - while it requires SSO -
   * whether a project has a provider of its own to find by email.
   */
  public static async getSignInMethods(): Promise<SignInMethods> {
    const isSsoRequired: boolean = await SsoRequiredSignIn.isSsoRequired();

    const [samlProviders, oidcProviders] = await Promise.all([
      GlobalSsoService.findBy({
        query: { isEnabled: true },
        select: PROVIDER_SELECT,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
      GlobalOidcService.findBy({
        query: { isEnabled: true },
        select: PROVIDER_SELECT,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    const ssoProviders: Array<SsoSignInProvider> = [
      ...samlProviders.map((row: GlobalSso): SsoSignInProvider | null => {
        return toProvider(SsoProviderType.GlobalSSO, row);
      }),
      ...oidcProviders.map((row: GlobalOidc): SsoSignInProvider | null => {
        return toProvider(SsoProviderType.GlobalOIDC, row);
      }),
    ]
      .filter((provider: SsoSignInProvider | null): boolean => {
        return provider !== null;
      })
      .map((provider: SsoSignInProvider | null): SsoSignInProvider => {
        return provider as SsoSignInProvider;
      })
      .sort(byName);

    return {
      isSsoRequired: isSsoRequired,
      ssoProviders: ssoProviders,
      hasProjectSsoProviders: isSsoRequired
        ? await SsoSignInMethods.hasProjectSsoProviders()
        : false,
    };
  }

  /*
   * Whether any project has a SAML or OpenID Connect provider of its own
   * that is on: one row is enough, and none is counted.
   */
  public static async hasProjectSsoProviders(): Promise<boolean> {
    const [samlProvider, oidcProvider] = await Promise.all([
      ProjectSsoService.findOneBy({
        query: { isEnabled: true },
        select: { _id: true },
        props: { isRoot: true },
      }),
      ProjectOidcService.findOneBy({
        query: { isEnabled: true },
        select: { _id: true },
        props: { isRoot: true },
      }),
    ]);

    return Boolean(samlProvider) || Boolean(oidcProvider);
  }

  /*
   * The providers that sign people in to this project, for the page a
   * project that requires SSO sends people to: its own that are on, and the
   * instance-wide ones that are on and reach it - every project, unless the
   * provider is restricted to its attached projects, when only those it
   * governs (the same reading the projects' rule makes,
   * UserMiddleware.isGlobalSsoTokenAuthorizedForProject). When the project
   * requires one provider, only that one: any other would sign people in and
   * still be refused.
   *
   * Throws when the project does not exist, and when a rule or a provider's
   * reach cannot be read.
   */
  public static async getProjectSignInMethods(
    projectId: ObjectID,
  ): Promise<ProjectSignInMethods> {
    const requiredProviderId: ObjectID | null =
      await ProjectService.getRequireSsoWithSsoProviderId(projectId);

    const [projectSaml, projectOidc, globalSaml, globalOidc] =
      await Promise.all([
        ProjectSsoService.findBy({
          query: { projectId: projectId, isEnabled: true },
          select: PROVIDER_SELECT,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
        ProjectOidcService.findBy({
          query: { projectId: projectId, isEnabled: true },
          select: PROVIDER_SELECT,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
        GlobalSsoService.findBy({
          query: { isEnabled: true },
          select: { ...PROVIDER_SELECT, restrictToAttachedProjects: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
        GlobalOidcService.findBy({
          query: { isEnabled: true },
          select: { ...PROVIDER_SELECT, restrictToAttachedProjects: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

    const reachingSaml: Array<GlobalSso> = [];

    for (const provider of globalSaml) {
      if (
        !provider.restrictToAttachedProjects ||
        (await GlobalSsoProjectService.doesProviderGovernProject({
          globalSsoId: provider.id!,
          projectId: projectId,
        }))
      ) {
        reachingSaml.push(provider);
      }
    }

    const reachingOidc: Array<GlobalOidc> = [];

    for (const provider of globalOidc) {
      if (
        !provider.restrictToAttachedProjects ||
        (await GlobalOidcProjectService.doesProviderGovernProject({
          globalOidcId: provider.id!,
          projectId: projectId,
        }))
      ) {
        reachingOidc.push(provider);
      }
    }

    const ownProviders: Array<SsoSignInProvider | null> = [
      ...projectSaml.map((row: ProjectSso): SsoSignInProvider | null => {
        return toProvider(SsoProviderType.ProjectSSO, row);
      }),
      ...projectOidc.map((row: ProjectOidc): SsoSignInProvider | null => {
        return toProvider(SsoProviderType.ProjectOIDC, row);
      }),
    ];

    const instanceProviders: Array<SsoSignInProvider | null> = [
      ...reachingSaml.map((row: GlobalSso): SsoSignInProvider | null => {
        return toProvider(SsoProviderType.GlobalSSO, row);
      }),
      ...reachingOidc.map((row: GlobalOidc): SsoSignInProvider | null => {
        return toProvider(SsoProviderType.GlobalOIDC, row);
      }),
    ];

    const keep: (
      providers: Array<SsoSignInProvider | null>,
    ) => Array<SsoSignInProvider> = (
      providers: Array<SsoSignInProvider | null>,
    ): Array<SsoSignInProvider> => {
      return providers
        .filter((provider: SsoSignInProvider | null): boolean => {
          return (
            provider !== null &&
            (!requiredProviderId ||
              provider.id.toLowerCase() ===
                requiredProviderId.toString().toLowerCase())
          );
        })
        .map((provider: SsoSignInProvider | null): SsoSignInProvider => {
          return provider as SsoSignInProvider;
        })
        .sort(byName);
    };

    // The project's own first: they are what its admins set up for it.
    return {
      ssoProviders: [...keep(ownProviders), ...keep(instanceProviders)],
    };
  }
}
