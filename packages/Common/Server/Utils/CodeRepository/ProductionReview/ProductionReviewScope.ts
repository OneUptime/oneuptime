import CodeAgentTelemetryScope, {
  CodeAgentScopedService,
  RepositoryServices,
  RepositoryServicesGap,
  SCOPE_CACHE_TTL_MS,
} from "../../AI/CodeFix/CodeAgentTelemetryScope";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { ChangedCode, ChangedCodeFile } from "./ProductionReviewDiff";
import { ResolvableRepository } from "../StackTraceRepoResolver";
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
 */

export interface ProductionReviewScopeResult {
  repository: ResolvableRepository | null;
  services: Array<CodeAgentScopedService>;
  gap: RepositoryServicesGap | null;
}

interface CachedScope {
  scope: ProductionReviewScopeResult;
  expiresAt: number;
}

// The most repositories whose scope is kept at once.
const MAX_CACHED_SCOPES: number = 500;

const cachedScopes: Map<string, CachedScope> = new Map<string, CachedScope>();

// Whether a repository path is the service's path or under it.
function isUnderPath(path: string, servicePath: string): boolean {
  return path === servicePath || path.startsWith(`${servicePath}/`);
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
