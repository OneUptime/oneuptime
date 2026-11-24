/*
 * HOW A SEARCH FINDS ONE OF A PROJECT'S CODE REPOSITORIES (#10764).
 *
 * By its name, by its "organization/name" on its host, or by its
 * description holding what was typed, case aside. Code's Repositories page
 * and its pickers send what the person types to the server, which answers
 * from every repository the reader may read - never from a first page of
 * them, so a repository past the project's 500th is found like any other.
 * The rule is React-free and shared, so the server and the pages read it
 * the same way.
 */

// The columns a search reads.
export interface SearchableCodeRepository {
  name?: string | undefined;
  organizationName?: string | undefined;
  repositoryName?: string | undefined;
  description?: string | undefined;
}

// The longest search a repository list reads.
export const MAX_CODE_REPOSITORY_SEARCH_LENGTH: number = 200;

// A search as a list reads it: trimmed, cut to its longest, "" for none.
export const readCodeRepositorySearch: (raw: unknown) => string = (
  raw: unknown,
): string => {
  if (typeof raw !== "string") {
    return "";
  }

  return raw.trim().substring(0, MAX_CODE_REPOSITORY_SEARCH_LENGTH).trim();
};

/*
 * "acme/checkout-api" - the repository on its host - or "" while either
 * half is not known.
 */
export const getCodeRepositoryFullName: (
  repository: SearchableCodeRepository,
) => string = (repository: SearchableCodeRepository): string => {
  if (!repository.organizationName || !repository.repositoryName) {
    return "";
  }

  return `${repository.organizationName}/${repository.repositoryName}`;
};

// Whether a repository's name, "organization/name" or description holds the search.
export const matchesCodeRepositorySearch: (
  repository: SearchableCodeRepository,
  search: string,
) => boolean = (
  repository: SearchableCodeRepository,
  search: string,
): boolean => {
  const needle: string = search.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  return (
    (repository.name || "").toLowerCase().includes(needle) ||
    getCodeRepositoryFullName(repository).toLowerCase().includes(needle) ||
    (repository.description || "").toLowerCase().includes(needle)
  );
};
