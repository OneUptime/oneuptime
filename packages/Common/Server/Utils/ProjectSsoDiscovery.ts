import Domain from "../../Models/DatabaseModels/Domain";
import Project from "../../Models/DatabaseModels/Project";
import ProjectOIDC from "../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../Models/DatabaseModels/ProjectSso";
import DatabaseService from "../Services/DatabaseService";
import DomainService from "../Services/DomainService";
import ProjectOidcService from "../Services/ProjectOidcService";
import ProjectSSOService from "../Services/ProjectSsoService";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import DomainType from "../../Types/Domain";
import Email from "../../Types/Email";
import ObjectID from "../../Types/ObjectID";

/*
 * "SIGN IN WITH SSO" FINDS A PROJECT'S PROVIDERS BY THE ADDRESS'S DOMAIN
 * (#9824).
 *
 * The sign-in page and the mobile app ask GET /service-provider-login (SAML)
 * and /service-provider-login-oidc (OIDC) which providers sign an address
 * in, with nobody signed in (App/FeatureSet/Identity/API/SSO.ts and
 * OIDC.ts). They used to look up the account with the address, its
 * projects (invitations included) and those projects' providers - so
 * anyone could ask whether an address has an account, and which
 * organizations it belongs to (#9745 made the "nothing" answers alike; this
 * removes the rest).
 *
 * Now the answer depends on the address's domain alone:
 *
 *   1. The domain is what follows the address's last "@", trimmed and
 *      lower-cased. One that is no domain a project could add (an address
 *      literal, say) finds nothing.
 *   2. The project domains with exactly that name that are verified
 *      (Project Settings > Advanced > Domains, proved once with a TXT
 *      record). No parent or subdomain matches: verifying acme.com offers
 *      nothing to sales.acme.com, and the reverse.
 *   3. The providers that are on and list one of those domains, in the
 *      domain's own project (Provider.domains). The upgrade gave every
 *      provider made before domains existed the verified domains its
 *      project alone held (BackfillSsoProviderDomains1809186620000, #9918);
 *      an admin picks the rest. A provider that lists no verified domain is
 *      offered to nobody here, and the SSO settings page says so. Such a
 *      provider still signs people in from the identity provider's own
 *      dashboard, and from the project's SSO sign-in link
 *      (/accounts/sso/<project>, by the project's id, with no address
 *      asked), which its admin shares with people on other domains.
 *
 * No account, membership or invitation is read, so two addresses at one
 * domain get the same answer after the same work, whether or not either has
 * an account. The answer keeps its shape - each provider's id, name,
 * description, project and project name - so the sign-in page and the
 * mobile app read it as before.
 */

/*
 * The join tables of Provider.domains (the models' @JoinTable), read by the
 * provider lookup's subquery.
 */
export interface ProviderDomainsJoin {
  joinTableName: string;
  ownerColumnName: string;
  relationColumnName: string;
}

export const PROJECT_SSO_DOMAINS_JOIN: ProviderDomainsJoin = {
  joinTableName: "ProjectSsoDomain",
  ownerColumnName: "projectSsoId",
  relationColumnName: "domainId",
};

export const PROJECT_OIDC_DOMAINS_JOIN: ProviderDomainsJoin = {
  joinTableName: "ProjectOidcDomain",
  ownerColumnName: "projectOidcId",
  relationColumnName: "domainId",
};

// The verified domains of one project with the address's domain's name.
export interface VerifiedProjectDomains {
  projectId: ObjectID;
  domainIds: Array<ObjectID>;
}

type ProjectProvider = ProjectSSO | ProjectOIDC;

// What the answer says of each provider, as it always has.
const PROVIDER_SELECT: Select<ProjectSSO> = {
  _id: true,
  name: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  } as Select<Project>,
};

export default class ProjectSsoDiscovery {
  /*
   * The domain of an address: what follows its last "@" (a quoted local
   * part may hold one), trimmed and lower-cased. Null when that is no name
   * a project could add as a domain.
   */
  public static getEmailDomain(email: Email): string | null {
    const address: string = email.toString();
    const at: number = address.lastIndexOf("@");

    if (at < 0) {
      return null;
    }

    const domain: string = address
      .slice(at + 1)
      .trim()
      .toLowerCase();

    return DomainType.isValidDomain(domain) ? domain : null;
  }

  /*
   * The verified project domains named exactly `domain`, whatever case they
   * were saved in, grouped by project: projects in the order their domain
   * was added, so the same domain always answers in the same order.
   *
   * Postgres answers it from an index of its own, on LOWER("domain") over
   * the verified rows that are not deleted (AddDomainVerifiedNameIndex1809186720000,
   * #9988), never by reading the whole table: keep the comparison
   * (findWithSameText) and the two filters as they are, or the index stops
   * serving it. AddDomainVerifiedNameIndexPostgres asks Postgres how it runs
   * this very query.
   */
  public static async findVerifiedDomains(
    domain: string,
  ): Promise<Array<VerifiedProjectDomains>> {
    const rows: Array<Domain> = await DomainService.findBy({
      query: {
        domain: QueryHelper.findWithSameText(domain),
        isVerified: true,
      } as Query<Domain>,
      select: {
        _id: true,
        projectId: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const byProject: Map<string, VerifiedProjectDomains> = new Map();

    for (const row of rows) {
      if (!row.projectId || !row.id) {
        continue;
      }

      const key: string = row.projectId.toString().toLowerCase();
      const entry: VerifiedProjectDomains = byProject.get(key) || {
        projectId: row.projectId,
        domainIds: [],
      };

      entry.domainIds.push(row.id);
      byProject.set(key, entry);
    }

    return Array.from(byProject.values());
  }

  // The project SAML providers Sign in with SSO offers an address.
  public static async findSamlProviders(
    email: Email,
  ): Promise<Array<ProjectSSO>> {
    return await ProjectSsoDiscovery.findProviders<ProjectSSO>({
      email: email,
      service: ProjectSSOService,
      join: PROJECT_SSO_DOMAINS_JOIN,
    });
  }

  // The project OIDC providers Sign in with SSO offers an address.
  public static async findOidcProviders(
    email: Email,
  ): Promise<Array<ProjectOIDC>> {
    return await ProjectSsoDiscovery.findProviders<ProjectOIDC>({
      email: email,
      service: ProjectOidcService,
      join: PROJECT_OIDC_DOMAINS_JOIN,
    });
  }

  /*
   * The providers that are on and list one of the address's verified
   * domains, each project's read in its own project: a provider never
   * reaches a domain of another project, whatever its list holds.
   */
  private static async findProviders<TProvider extends ProjectProvider>(data: {
    email: Email;
    service: DatabaseService<TProvider>;
    join: ProviderDomainsJoin;
  }): Promise<Array<TProvider>> {
    const domain: string | null = ProjectSsoDiscovery.getEmailDomain(
      data.email,
    );

    if (!domain) {
      return [];
    }

    const providers: Array<TProvider> = [];

    for (const verified of await ProjectSsoDiscovery.findVerifiedDomains(
      domain,
    )) {
      const found: Array<TProvider> = await data.service.findBy({
        query: {
          projectId: verified.projectId,
          isEnabled: true,
          _id: QueryHelper.anyOfEntitiesInManyToMany({
            ...data.join,
            values: verified.domainIds,
          }),
        } as unknown as Query<TProvider>,
        select: PROVIDER_SELECT as unknown as Select<TProvider>,
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      providers.push(...found);
    }

    return providers;
  }
}
