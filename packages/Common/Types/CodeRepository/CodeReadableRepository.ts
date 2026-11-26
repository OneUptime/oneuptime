import { CodeHost } from "./CodeHost";
import CodeRepositoryType from "./CodeRepositoryType";

/*
 * WHETHER ONEUPTIME READS A REPOSITORY'S CODE: ONE RULE (#10921).
 *
 * Fix with AI on a trace's, a log's, a metric's or an exception's finding,
 * and on a profile's function, works only in a repository whose files
 * OneUptime reads - the ones SourceLocator keeps for a person:
 *
 *   - its owner and name on its host are known;
 *   - it is connected: through the project's GitHub App, or through its
 *     connection to its Git server, whose token was not refused;
 *   - OneUptime's server reaches that Git server (a Git server on a private
 *     network only the project's own Runner reaches is not read);
 *   - and it is on a host whose code OneUptime reads
 *     (CodeHost.canReadRepositoryCode).
 *
 * The pickers of those fixes search the person's repositories held to this
 * same rule (CodeTaskRepositoryList's codeReadableOnly), so they offer
 * exactly the repositories the fix then accepts, and Code's other lists
 * stay as they are. React-free and model-free, so the server, the browser
 * and plain unit tests read the one rule.
 */
export interface CodeReadableRepositoryFacts {
  organizationName?: string | null | undefined;
  repositoryName?: string | null | undefined;
  // What a Git repository is cloned by: how an Azure DevOps one is told apart.
  repositoryUrl?: string | { toString: () => string } | null | undefined;
  // Where it is hosted, as how it connects says it.
  provider: CodeRepositoryType | string | null | undefined;
  // Connected now: its connection's state is Connected.
  isConnected: boolean;
  // OneUptime's server reaches its Git server.
  isReachableFromServer: boolean;
}

export function isCodeReadableRepository(
  facts: CodeReadableRepositoryFacts,
): boolean {
  if (
    !facts.organizationName ||
    !facts.repositoryName ||
    !facts.isConnected ||
    !facts.isReachableFromServer
  ) {
    return false;
  }

  return CodeHost.canReadRepositoryCode({
    type: facts.provider,
    repositoryUrl: facts.repositoryUrl
      ? facts.repositoryUrl.toString()
      : undefined,
  });
}
