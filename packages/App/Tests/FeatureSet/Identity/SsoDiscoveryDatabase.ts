import Domain from "Common/Models/DatabaseModels/Domain";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import DomainService from "Common/Server/Services/DomainService";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import ProjectSSOService from "Common/Server/Services/ProjectSsoService";
import ObjectID from "Common/Types/ObjectID";
import {
  PROJECT_OIDC_DOMAINS_JOIN,
  PROJECT_SSO_DOMAINS_JOIN,
  ProviderDomainsJoin,
} from "Common/Server/Utils/ProjectSsoDiscovery";

/*
 * The project domains and SSO providers "Sign in with SSO" reads, in memory:
 * DomainService.findBy and the two provider services' findBy answer the
 * queries Common/Server/Utils/ProjectSsoDiscovery makes the way Postgres would,
 * reading the SQL of their Raw conditions:
 *
 *   - a domain's name, case-insensitively (LOWER(domain) = :name), and
 *     whether it is verified;
 *   - a provider's project, whether it is on, and the domains it lists,
 *     through its join table (_id IN (SELECT ... FROM "ProjectSsoDomain"
 *     WHERE "domainId" IN (...))).
 *
 * A condition the stand-in does not know fails the read, so a query that
 * changed shape is caught rather than answered wrongly. Every read is
 * recorded, with its operators written out (comparableRead), so a test can
 * tell that two addresses cost the same work.
 */

export interface StoredDomain {
  id: string;
  projectId: string;
  domain: string;
  isVerified: boolean;
}

export interface StoredProvider {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  description: string;
  isEnabled: boolean;
  // The ids of the Domain rows it lists.
  domainIds: Array<string>;
}

export interface DiscoveryDatabase {
  domains: Array<StoredDomain>;
  saml: Array<StoredProvider>;
  oidc: Array<StoredProvider>;
}

export interface DiscoveryReads {
  domains: jest.SpyInstance;
  saml: jest.SpyInstance;
  oidc: jest.SpyInstance;
}

type FindByArgument = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort?: Record<string, unknown> | undefined;
  limit: number;
  skip: number;
  props: Record<string, unknown>;
};

const ALIAS: string = "alias";

const sameId: (a: unknown, b: unknown) => boolean = (
  a: unknown,
  b: unknown,
): boolean => {
  return String(a).toLowerCase() === String(b).toLowerCase();
};

/*
 * The part of TypeORM's FindOperator the stand-in reads. typeorm is Common's
 * dependency, not App's, so its type cannot be imported here
 * (TestImportsResolveFromApp.test.ts): the structural type says exactly as
 * much as the stand-in relies on.
 */
interface ReadFindOperator {
  type: string;
  getSql?: ((alias: string) => string) | undefined;
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

/*
 * Whether a value is a TypeORM condition (a FindOperator). Read by its shape:
 * Common and App may each load their own copy of TypeORM, so instanceof
 * would tell one copy's operators from the other's.
 */
const isFindOperator: (value: unknown) => value is ReadFindOperator = (
  value: unknown,
): value is ReadFindOperator => {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string" &&
    "objectLiteralParameters" in (value as Record<string, unknown>)
  );
};

// The SQL and the parameters of a Raw condition.
export const readRaw: (operator: unknown) => {
  sql: string;
  parameters: Record<string, unknown>;
} = (
  operator: unknown,
): { sql: string; parameters: Record<string, unknown> } => {
  if (!isFindOperator(operator) || operator.type !== "raw") {
    throw new Error(`Not a Raw condition: ${JSON.stringify(operator)}`);
  }

  const getSql: ((alias: string) => string) | undefined = operator.getSql;

  if (!getSql) {
    throw new Error("A Raw condition with no SQL.");
  }

  return {
    sql: getSql(ALIAS),
    parameters: operator.objectLiteralParameters || {},
  };
};

/*
 * A read written out with its Raw conditions as their SQL and values, their
 * parameter names (random on every call) left out, so two reads of the
 * same thing compare equal.
 */
export const comparableRead: (argument: unknown) => unknown = (
  argument: unknown,
): unknown => {
  const findBy: FindByArgument = argument as FindByArgument;
  const query: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(findBy.query || {})) {
    if (isFindOperator(value)) {
      const raw: { sql: string; parameters: Record<string, unknown> } =
        readRaw(value);

      query[key] = {
        sql: raw.sql.replace(/:(\.\.\.)?\w+/g, ":$1param"),
        values: Object.values(raw.parameters).map((parameter: unknown) => {
          return Array.isArray(parameter)
            ? parameter.map(String)
            : String(parameter);
        }),
      };
    } else {
      query[key] = value instanceof ObjectID ? value.toString() : value;
    }
  }

  return {
    query,
    select: findBy.select,
    sort: findBy.sort,
    limit: findBy.limit,
    skip: findBy.skip,
    props: findBy.props,
  };
};

const NAME_CONDITION: RegExp = /^\(LOWER\(alias\) = :(\w+)\)$/;

const findDomains: (
  database: DiscoveryDatabase,
  argument: FindByArgument,
) => Array<Domain> = (
  database: DiscoveryDatabase,
  argument: FindByArgument,
): Array<Domain> => {
  const { query } = argument;
  const known: Array<string> = ["domain", "isVerified"];

  for (const key of Object.keys(query)) {
    if (!known.includes(key)) {
      throw new Error(`The stand-in does not read Domain.${key}.`);
    }
  }

  const raw: { sql: string; parameters: Record<string, unknown> } = readRaw(
    query["domain"],
  );
  const condition: RegExpMatchArray | null = raw.sql.match(NAME_CONDITION);

  if (!condition) {
    throw new Error(`Not a name the stand-in can read: ${raw.sql}`);
  }

  const name: string = String(raw.parameters[condition[1]!]);

  return database.domains
    .filter((stored: StoredDomain): boolean => {
      return (
        stored.domain.toLowerCase() === name &&
        (query["isVerified"] === undefined ||
          stored.isVerified === query["isVerified"])
      );
    })
    .map((stored: StoredDomain): Domain => {
      const domain: Domain = new Domain(new ObjectID(stored.id));
      domain.projectId = new ObjectID(stored.projectId);
      return domain;
    });
};

const listedDomainCondition: (join: ProviderDomainsJoin) => RegExp = (
  join: ProviderDomainsJoin,
): RegExp => {
  const table: string = join.joinTableName;

  return new RegExp(
    `^\\(alias IN \\(SELECT "${table}"\\."${join.ownerColumnName}" FROM "${table}" WHERE "${table}"\\."${join.relationColumnName}" IN \\(:\\.\\.\\.(\\w+)\\)\\)\\)$`,
  );
};

const findProviders: <TProvider extends ProjectSSO | ProjectOIDC>(data: {
  stored: Array<StoredProvider>;
  join: ProviderDomainsJoin;
  make: () => TProvider;
  argument: FindByArgument;
}) => Array<TProvider> = <TProvider extends ProjectSSO | ProjectOIDC>(data: {
  stored: Array<StoredProvider>;
  join: ProviderDomainsJoin;
  make: () => TProvider;
  argument: FindByArgument;
}): Array<TProvider> => {
  const { query } = data.argument;
  const known: Array<string> = ["projectId", "isEnabled", "_id"];

  for (const key of Object.keys(query)) {
    if (!known.includes(key)) {
      throw new Error(`The stand-in does not read a provider's ${key}.`);
    }
  }

  const raw: { sql: string; parameters: Record<string, unknown> } = readRaw(
    query["_id"],
  );
  const condition: RegExpMatchArray | null = raw.sql.match(
    listedDomainCondition(data.join),
  );

  if (!condition) {
    throw new Error(`Not a domain list the stand-in can read: ${raw.sql}`);
  }

  const domainIds: Array<string> = (
    raw.parameters[condition[1]!] as Array<unknown>
  ).map((id: unknown): string => {
    return String(id).toLowerCase();
  });

  return data.stored
    .filter((stored: StoredProvider): boolean => {
      return (
        sameId(stored.projectId, query["projectId"]) &&
        stored.isEnabled === query["isEnabled"] &&
        stored.domainIds.some((id: string): boolean => {
          return domainIds.includes(id.toLowerCase());
        })
      );
    })
    .map((stored: StoredProvider): TProvider => {
      // What the route's select asks for, and nothing else.
      const provider: TProvider = data.make();
      provider._id = stored.id;
      provider.name = stored.name;
      provider.description = stored.description;
      provider.projectId = new ObjectID(stored.projectId);
      const project: Project = new Project();
      project.name = stored.projectName;
      provider.project = project;
      return provider;
    });
};

export const stubDiscoveryDatabase: (
  database: DiscoveryDatabase,
) => DiscoveryReads = (database: DiscoveryDatabase): DiscoveryReads => {
  return {
    domains: jest.spyOn(DomainService, "findBy").mockImplementation((async (
      argument: FindByArgument,
    ) => {
      return findDomains(database, argument);
    }) as never),
    saml: jest.spyOn(ProjectSSOService, "findBy").mockImplementation((async (
      argument: FindByArgument,
    ) => {
      return findProviders<ProjectSSO>({
        stored: database.saml,
        join: PROJECT_SSO_DOMAINS_JOIN,
        make: (): ProjectSSO => {
          return new ProjectSSO();
        },
        argument: argument,
      });
    }) as never),
    oidc: jest.spyOn(ProjectOidcService, "findBy").mockImplementation((async (
      argument: FindByArgument,
    ) => {
      return findProviders<ProjectOIDC>({
        stored: database.oidc,
        join: PROJECT_OIDC_DOMAINS_JOIN,
        make: (): ProjectOIDC => {
          return new ProjectOIDC();
        },
        argument: argument,
      });
    }) as never),
  };
};
