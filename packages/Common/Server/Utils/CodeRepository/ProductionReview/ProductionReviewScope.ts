import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import RumApplicationService from "../../../Services/RumApplicationService";
import CodeAgentTelemetryScope, {
  CodeAgentScopedService,
  MAX_SCOPED_SERVICE_NAME_LENGTH,
  RepositoryServices,
  RepositoryServicesGap,
  SCOPE_CACHE_TTL_MS,
} from "../../AI/CodeFix/CodeAgentTelemetryScope";
import { untrustedLine } from "../../AI/SRE/UntrustedText";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  ChangedCode,
  ChangedCodeFile,
  getFileExtension,
} from "./ProductionReviewDiff";
import {
  createRepositoryResolver,
  RepoResolution,
  RepositoryResolver,
  ResolvableRepository,
} from "../StackTraceRepoResolver";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT OF PRODUCTION A PULL REQUEST'S REVIEW MAY READ.
 *
 * The same rule the code agent's production telemetry follows
 * (CodeAgentTelemetryScope): the review's project, and the services its
 * repository serves - those the repository resolver maps to it from their
 * own facts, never a company AI tool's private chats. Nothing else is read,
 * whoever wrote the pull request and whatever it changes.
 *
 * Among them, the services a change TOUCHES: in a monorepo each service's
 * code lives under a path of its own (found from where its stack traces
 * run), and a change under that path is that service's; a change nowhere
 * under a known path belongs to the services whose path is not known. The
 * findings add the services they are found in (ProductionReviewFindings).
 *
 * And the RUM applications the repository is the front end of (#11395),
 * whose session replays hold what a web or mobile app's code sends: a
 * browser log's attributes, a browser span's, a session's user. A RUM
 * application is the repository's when its App Identifier - the
 * service.name its browser or mobile SDK sends - names a service the
 * repository serves (the service its builds' source maps are uploaded
 * under), or names the repository itself, as a fix of the application's
 * leaks finds its repository (#10933); or when the repository is the
 * project's only one. A changed file is the application's front end
 * unless OneUptime knows it is not: it is outside the application's
 * folder, when that folder is known, or written in a language no browser
 * and no mobile app runs (Go, Python, Ruby). What cannot be placed is
 * never guessed away: a file is a back end's only when it surely is.
 */

export interface ProductionReviewScopeResult {
  repository: ResolvableRepository | null;
  services: Array<CodeAgentScopedService>;
  gap: RepositoryServicesGap | null;
}

// A RUM application whose front end the repository is (#11395).
export interface ProductionReviewRumApplication {
  // The application's id, lower case.
  id: string;
  // Its name as the review shows it: one line, redacted, held to a length.
  name: string;
  /*
   * Where its code is in the repository, when the scope knows it: the
   * folder of the service its builds' source maps are uploaded under,
   * found from where that service's stack traces run - null otherwise.
   */
  pathInRepository: string | null;
}

// The most RUM applications of a project read for a repository.
export const MAX_SCOPE_RUM_APPLICATIONS: number = 200;

/*
 * The languages no browser and no mobile app runs, by their files'
 * extensions: a file in one is a server's, whichever folder it is in.
 * JavaScript and TypeScript, and every language a mobile app is written
 * in (Swift, Kotlin, Java, Objective-C, Dart, C#), may be either.
 */
export const SERVER_ONLY_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  "py",
  "rb",
  "php",
  "go",
  "ex",
  "exs",
  "erl",
  "hrl",
  "pl",
  "pm",
  "jl",
  "hs",
  "clj",
  "groovy",
]);

interface CachedScope {
  scope: ProductionReviewScopeResult;
  expiresAt: number;
}

interface CachedRumApplications {
  applications: Array<ProductionReviewRumApplication>;
  expiresAt: number;
}

// The most repositories whose scope is kept at once.
const MAX_CACHED_SCOPES: number = 500;

const cachedScopes: Map<string, CachedScope> = new Map<string, CachedScope>();

const cachedRumApplications: Map<string, CachedRumApplications> = new Map<
  string,
  CachedRumApplications
>();

// Whether a repository path is the service's path or under it.
function isUnderPath(path: string, servicePath: string): boolean {
  return path === servicePath || path.startsWith(`${servicePath}/`);
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

// A RUM application as the repository is looked for by it: its row's facts.
export interface RumApplicationFacts {
  id: string;
  name: string;
  appIdentifier: string;
}

/*
 * The RUM applications, of those given, whose front end the repository
 * is (see the module comment): by a service the repository serves that
 * the App Identifier names - its folder then the application's - else by
 * the resolver, asked the App Identifier as a service's name (an exact
 * match of the repository's name, or the project's only repository). The
 * resolver is asked no stack trace, so it reads no repository's tree.
 */
export async function findRumApplicationsOfRepository(data: {
  codeRepositoryId: string;
  repositories: Array<ResolvableRepository>;
  applications: Array<RumApplicationFacts>;
  services: Array<CodeAgentScopedService>;
}): Promise<Array<ProductionReviewRumApplication>> {
  const repositoryId: string = normalizeId(data.codeRepositoryId);
  const resolver: RepositoryResolver = createRepositoryResolver({
    repositories: data.repositories,
    // Asked only names: no tree is read.
    getTreePaths: async (): Promise<Array<string>> => {
      return [];
    },
  });
  const found: Array<ProductionReviewRumApplication> = [];
  const seen: Set<string> = new Set<string>();

  for (const application of data.applications) {
    const id: string = normalizeId(application.id);
    const codeName: string = (application.appIdentifier || "").trim();

    if (!id || seen.has(id)) {
      continue;
    }

    const name: string = untrustedLine(
      application.name || codeName || "Unnamed application",
      MAX_SCOPED_SERVICE_NAME_LENGTH,
    );
    const service: CodeAgentScopedService | undefined = codeName
      ? data.services.find((each: CodeAgentScopedService): boolean => {
          return each.name.trim().toLowerCase() === codeName.toLowerCase();
        })
      : undefined;

    if (service) {
      seen.add(id);
      found.push({ id, name, pathInRepository: service.pathInRepository });
      continue;
    }

    const resolution: RepoResolution | null = await resolver.resolve({
      stackTrace: null,
      serviceName: codeName || application.name || null,
    });

    if (
      resolution &&
      normalizeId(resolution.codeRepositoryId) === repositoryId
    ) {
      seen.add(id);
      found.push({ id, name, pathInRepository: null });
    }
  }

  return found;
}

export default class ProductionReviewScope {
  /*
   * The services the repository serves, worked out once every
   * SCOPE_CACHE_TTL_MS: working it out reads the repository's tree and the
   * project's recent exception groups, and every push to every pull
   * request of a busy repository asks.
   */
  @CaptureSpan()
  public static async get(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
  }): Promise<ProductionReviewScopeResult> {
    const key: string = `${data.projectId.toString()}:${data.codeRepositoryId
      .toString()
      .toLowerCase()}`;
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const cached: CachedScope | undefined = cachedScopes.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.scope;
    }

    const found: RepositoryServices =
      await CodeAgentTelemetryScope.findRepositoryServices({
        projectId: data.projectId,
        codeRepositoryId: data.codeRepositoryId,
      });

    const scope: ProductionReviewScopeResult = {
      repository: found.repository,
      services: found.services,
      gap: found.gap,
    };

    for (const [cachedKey, entry] of cachedScopes) {
      if (entry.expiresAt <= now || cachedScopes.size >= MAX_CACHED_SCOPES) {
        cachedScopes.delete(cachedKey);
      }
    }

    cachedScopes.set(key, { scope, expiresAt: now + SCOPE_CACHE_TTL_MS });

    return scope;
  }

  // Forgets every repository's scope (tests).
  public static clearCache(): void {
    cachedScopes.clear();
    cachedRumApplications.clear();
  }

  /*
   * The RUM applications the repository is the front end of (#11395), of
   * the services it serves (`services`, its scope's): worked out once
   * every SCOPE_CACHE_TTL_MS, and asked only when a review has a point a
   * web or mobile app's code could have written. Never fails: none when
   * they cannot be read, tried again on the next review.
   */
  @CaptureSpan()
  public static async getRumApplications(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
    services: Array<CodeAgentScopedService>;
  }): Promise<Array<ProductionReviewRumApplication>> {
    const key: string = `${data.projectId.toString()}:${data.codeRepositoryId
      .toString()
      .toLowerCase()}`;
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const cached: CachedRumApplications | undefined =
      cachedRumApplications.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.applications;
    }

    let applications: Array<ProductionReviewRumApplication> = [];

    try {
      const rows: Array<RumApplication> = await RumApplicationService.findBy({
        query: { projectId: data.projectId },
        select: { _id: true, name: true, appIdentifier: true },
        sort: { name: SortOrder.Ascending },
        skip: 0,
        limit: MAX_SCOPE_RUM_APPLICATIONS,
        props: { isRoot: true },
      });

      if (rows.length > 0) {
        applications = await findRumApplicationsOfRepository({
          codeRepositoryId: data.codeRepositoryId.toString(),
          repositories: await CodeRepositoryService.getResolvableRepositories(
            data.projectId,
          ),
          applications: rows
            .filter((row: RumApplication): boolean => {
              return Boolean(row.id);
            })
            .map((row: RumApplication): RumApplicationFacts => {
              return {
                id: row.id!.toString(),
                name: row.name || "",
                appIdentifier: row.appIdentifier || "",
              };
            }),
          services: data.services,
        });
      }
    } catch (error) {
      logger.debug(
        `Production review: the RUM applications repository ${data.codeRepositoryId.toString()} is the front end of could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );

      return [];
    }

    for (const [cachedKey, entry] of cachedRumApplications) {
      if (
        entry.expiresAt <= now ||
        cachedRumApplications.size >= MAX_CACHED_SCOPES
      ) {
        cachedRumApplications.delete(cachedKey);
      }
    }

    cachedRumApplications.set(key, {
      applications,
      expiresAt: now + SCOPE_CACHE_TTL_MS,
    });

    return applications;
  }

  // Whether a browser or a mobile app may run a file: not one of a server's language alone (#11395).
  public static mayBeFrontEnd(path: string): boolean {
    return !SERVER_ONLY_EXTENSIONS.has(getFileExtension(path));
  }

  /*
   * The RUM applications a changed file may be the front end of, of the
   * repository's (#11395): none for a file in a language no browser and
   * no mobile app runs; else those whose folder holds it (the deepest),
   * or - under no known folder - each one whose folder is not known, as a
   * change under no known path is each such service's. A file OneUptime
   * cannot place is never taken for a back end's.
   */
  public static getFrontEndApplications(data: {
    path: string;
    applications: Array<ProductionReviewRumApplication>;
  }): Array<ProductionReviewRumApplication> {
    if (!ProductionReviewScope.mayBeFrontEnd(data.path)) {
      return [];
    }

    let deepest: number = -1;
    let owners: Array<ProductionReviewRumApplication> = [];

    for (const application of data.applications) {
      const folder: string = application.pathInRepository || "";

      if (!folder || !isUnderPath(data.path, folder)) {
        continue;
      }

      const depth: number = folder.split("/").length;

      if (depth > deepest) {
        deepest = depth;
        owners = [application];
      } else if (depth === deepest) {
        owners.push(application);
      }
    }

    return owners.length > 0
      ? owners
      : data.applications.filter(
          (application: ProductionReviewRumApplication): boolean => {
            return !application.pathInRepository;
          },
        );
  }

  /*
   * The services the changed files are under: for each file, the services
   * whose path holds it (the deepest), or - under no known path - every
   * service whose path is not known. Most-touched first.
   */
  public static getTouchedServices(data: {
    services: Array<CodeAgentScopedService>;
    changed: ChangedCode;
  }): Array<CodeAgentScopedService> {
    const counts: Map<string, number> = new Map<string, number>();

    const pathed: Array<CodeAgentScopedService> = data.services.filter(
      (service: CodeAgentScopedService): boolean => {
        return Boolean(service.pathInRepository);
      },
    );
    const unpathed: Array<CodeAgentScopedService> = data.services.filter(
      (service: CodeAgentScopedService): boolean => {
        return !service.pathInRepository;
      },
    );

    for (const file of data.changed.files) {
      const owners: Array<CodeAgentScopedService> =
        ProductionReviewScope.getOwners(file, pathed);

      for (const service of owners.length > 0 ? owners : unpathed) {
        counts.set(service.id, (counts.get(service.id) || 0) + 1);
      }
    }

    return data.services
      .filter((service: CodeAgentScopedService): boolean => {
        return counts.has(service.id);
      })
      .sort((a: CodeAgentScopedService, b: CodeAgentScopedService): number => {
        return (counts.get(b.id) || 0) - (counts.get(a.id) || 0);
      });
  }

  // The services whose path holds the file: the deepest path wins.
  private static getOwners(
    file: ChangedCodeFile,
    pathed: Array<CodeAgentScopedService>,
  ): Array<CodeAgentScopedService> {
    let deepest: number = -1;
    let owners: Array<CodeAgentScopedService> = [];

    for (const service of pathed) {
      const servicePath: string = service.pathInRepository || "";

      const holds: boolean =
        isUnderPath(file.path, servicePath) ||
        (Boolean(file.previousPath) &&
          isUnderPath(file.previousPath || "", servicePath));

      if (!holds) {
        continue;
      }

      const depth: number = servicePath.split("/").length;

      if (depth > deepest) {
        deepest = depth;
        owners = [service];
      } else if (depth === deepest) {
        owners.push(service);
      }
    }

    return owners;
  }
}
