/*
 * Deterministic name-matching between Service Catalog services and connected
 * code repositories, used to auto-suggest ServiceCodeRepository links (the
 * mapping the AI fix pipeline depends on). Pure functions — no persistence,
 * no LLM — so the ranking is cheap, explainable, and unit-testable.
 */

export interface SuggestableService {
  id: string;
  name: string;
}

export interface SuggestableRepository {
  id: string;
  // Display name in OneUptime.
  name: string;
  // Actual repository name on the git host (usually the strongest signal).
  repositoryName: string;
  organizationName: string;
}

export interface ExistingLinkPair {
  serviceId: string;
  codeRepositoryId: string;
}

export interface ServiceRepoLinkSuggestion {
  serviceId: string;
  serviceName: string;
  codeRepositoryId: string;
  codeRepositoryName: string;
  repositoryFullName: string;
  reason: string;
  // 3 = exact name match, 2 = one name contains the other, 1 = token overlap.
  score: number;
}

const MAX_SUGGESTIONS: number = 50;
const MIN_CONTAINMENT_LENGTH: number = 4;
const MIN_SHARED_TOKEN_LENGTH: number = 3;
const MIN_TOKEN_JACCARD: number = 0.5;

type NormalizeFunction = (value: string) => string;

const normalize: NormalizeFunction = (value: string): string => {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
};

type TokenizeFunction = (value: string) => Set<string>;

const tokenize: TokenizeFunction = (value: string): Set<string> => {
  const withBoundaries: string = value
    // camelCase / PascalCase boundaries become separators.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");

  const tokens: Array<string> = withBoundaries
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token: string) => {
      return token.length >= 2;
    });

  return new Set(tokens);
};

interface MatchResult {
  score: number;
  reason: string;
}

type MatchNamesFunction = (
  serviceName: string,
  repository: SuggestableRepository,
) => MatchResult | null;

const matchNames: MatchNamesFunction = (
  serviceName: string,
  repository: SuggestableRepository,
): MatchResult | null => {
  const normalizedService: string = normalize(serviceName);

  if (!normalizedService) {
    return null;
  }

  const candidateNames: Array<string> = [
    repository.repositoryName,
    repository.name,
  ].filter(Boolean);

  // Tier 1 — exact match after normalization.
  for (const candidate of candidateNames) {
    if (normalize(candidate) === normalizedService) {
      return {
        score: 3,
        reason: `Service name matches the repository name "${candidate}"`,
      };
    }
  }

  // Tier 2 — one name contains the other (both reasonably long).
  for (const candidate of candidateNames) {
    const normalizedCandidate: string = normalize(candidate);

    if (
      normalizedCandidate.length >= MIN_CONTAINMENT_LENGTH &&
      normalizedService.length >= MIN_CONTAINMENT_LENGTH
    ) {
      if (normalizedCandidate.includes(normalizedService)) {
        return {
          score: 2,
          reason: `Repository name "${candidate}" contains the service name`,
        };
      }

      if (normalizedService.includes(normalizedCandidate)) {
        return {
          score: 2,
          reason: `Service name contains the repository name "${candidate}"`,
        };
      }
    }
  }

  // Tier 3 — token overlap (checkout-service ↔ checkout, billing-api ↔ billing_api_v2).
  const serviceTokens: Set<string> = tokenize(serviceName);

  for (const candidate of candidateNames) {
    const candidateTokens: Set<string> = tokenize(candidate);

    if (serviceTokens.size === 0 || candidateTokens.size === 0) {
      continue;
    }

    const shared: Array<string> = Array.from(serviceTokens).filter(
      (token: string) => {
        return candidateTokens.has(token);
      },
    );

    const hasMeaningfulSharedToken: boolean = shared.some((token: string) => {
      return token.length >= MIN_SHARED_TOKEN_LENGTH;
    });

    const unionSize: number =
      serviceTokens.size + candidateTokens.size - shared.length;
    const jaccard: number = unionSize === 0 ? 0 : shared.length / unionSize;

    if (hasMeaningfulSharedToken && jaccard >= MIN_TOKEN_JACCARD) {
      return {
        score: 1,
        reason: `Names share: ${shared.sort().join(", ")}`,
      };
    }
  }

  return null;
};

export type ComputeLinkSuggestionsFunction = (data: {
  services: Array<SuggestableService>;
  repositories: Array<SuggestableRepository>;
  existingLinks: Array<ExistingLinkPair>;
}) => Array<ServiceRepoLinkSuggestion>;

export const computeLinkSuggestions: ComputeLinkSuggestionsFunction = (data: {
  services: Array<SuggestableService>;
  repositories: Array<SuggestableRepository>;
  existingLinks: Array<ExistingLinkPair>;
}): Array<ServiceRepoLinkSuggestion> => {
  /*
   * A service already linked anywhere is considered mapped — suggesting a
   * second repo for it is more likely noise than help. Repositories stay
   * eligible for many services (monorepos).
   */
  const linkedServiceIds: Set<string> = new Set(
    data.existingLinks.map((link: ExistingLinkPair) => {
      return link.serviceId;
    }),
  );

  const suggestions: Array<ServiceRepoLinkSuggestion> = [];

  for (const service of data.services) {
    if (linkedServiceIds.has(service.id)) {
      continue;
    }

    for (const repository of data.repositories) {
      const match: MatchResult | null = matchNames(service.name, repository);

      if (!match) {
        continue;
      }

      suggestions.push({
        serviceId: service.id,
        serviceName: service.name,
        codeRepositoryId: repository.id,
        codeRepositoryName: repository.name,
        repositoryFullName:
          repository.organizationName && repository.repositoryName
            ? `${repository.organizationName}/${repository.repositoryName}`
            : repository.repositoryName || repository.name,
        reason: match.reason,
        score: match.score,
      });
    }
  }

  suggestions.sort(
    (a: ServiceRepoLinkSuggestion, b: ServiceRepoLinkSuggestion) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.serviceName.localeCompare(b.serviceName);
    },
  );

  return suggestions.slice(0, MAX_SUGGESTIONS);
};
