/*
 * WHAT A COMMAND THIS RUNNER RUNS FOR A PROJECT IS HANDED OF ITS
 * ENVIRONMENT.
 *
 * A Runner runs commands a project wrote - a runbook's Bash and kubectl
 * steps (RunBash, KubectlScriptExecutor), a code repository's setup, build
 * and test commands (BuildVerification) - and commands OneUptime AI composes
 * while it works in a repository (InHouseCodeAgent's run_command). In a
 * repository it also runs git, whose hooks, filters and fsmonitor a command
 * before it may have set up. Each runs with this Runner's environment,
 * because that is where an operator puts the toolchain, the registry
 * credentials and the proxy a command needs.
 *
 * What none of them is handed is the Runner's own:
 *
 *   - every ONEUPTIME_RUNNER_ setting (RUNNER_OWN_ENVIRONMENT_PREFIX): its
 *     id and its key above all. The key is the Runner - whoever holds it
 *     claims the jobs the Runner is sent, and the runbook secrets, SSH keys
 *     and kubeconfigs that come with them;
 *   - the credential the in-cluster Runner of the Kubernetes agent chart
 *     registers with, the project's telemetry ingestion key
 *     (ONEUPTIME_INGESTION_KEY), which mints that Runner's identity;
 *   - the server's own secret (ONEUPTIME_SECRET), which no Runner reads,
 *     in case a Runner was started with it - earlier releases' shared
 *     Runner was.
 *
 * Nothing a step or a build legitimately does talks to OneUptime as this
 * Runner, so taking them away costs nothing. It keeps them out of what a
 * command prints or sends by accident: an `env` dump in a build log, a test
 * that snapshots its environment, a tool that ships its environment with a
 * crash report, a command OneUptime AI composed because a file in the
 * repository asked it to.
 *
 * It is no wall against a command written to find them. A command runs as
 * the Runner's own user and reads what that user can - on Linux the
 * Runner's own process environment (/proc/<pid>/environ) among it. That is
 * why writing a command that runs on a project's Runner takes what writing a
 * runbook step that runs takes (Common/Types/CodeRepository/
 * CodeRepositoryRunnerAuthoring, Common/Types/Runbook/RunbookStepAuthoring),
 * and why what a Runner sends back is cleared of its key as well
 * (RunnerCredentialRedaction, SecretRedactor).
 */

// Every setting of the Runner's own starts with this: ONEUPTIME_RUNNER_KEY.
export const RUNNER_OWN_ENVIRONMENT_PREFIX: string = "ONEUPTIME_RUNNER_";

// The Runner's other credentials, by name.
export const RUNNER_OWN_ENVIRONMENT_NAMES: ReadonlyArray<string> = [
  "ONEUPTIME_INGESTION_KEY",
  "ONEUPTIME_SECRET",
];

/*
 * The code-fix pipeline's own git credentials: the askpass helper and the
 * token it echoes. They reach only the pipeline's own git commands, through
 * those commands' environment (GitCredentials) - never this process's - and
 * are taken out of a code-fix command's environment as well, should one
 * ever be there.
 */
export const CODE_FIX_PIPELINE_ENVIRONMENT_NAMES: ReadonlyArray<string> = [
  "GIT_ASKPASS",
  "ONEUPTIME_GIT_ACCESS_TOKEN",
];

/*
 * Whether a variable is one of the Runner's own (above). Names are compared
 * in capitals: a platform whose names ignore case (Windows) reads
 * `oneuptime_runner_key` as the key.
 */
export function isRunnerOwnEnvironmentName(name: string): boolean {
  const upper: string = name.toUpperCase();

  return (
    upper.startsWith(RUNNER_OWN_ENVIRONMENT_PREFIX) ||
    RUNNER_OWN_ENVIRONMENT_NAMES.includes(upper)
  );
}

/*
 * `base` - the Runner's own environment, unless a caller built one from it -
 * less every variable of the Runner's own. A copy: `base` is not changed.
 */
export function withoutRunnerOwnEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || isRunnerOwnEnvironmentName(name)) {
      continue;
    }

    environment[name] = value;
  }

  return environment;
}

/*
 * The environment of a command run while OneUptime AI works in a
 * repository - the repository's setup, build and test commands, and a
 * command the code agent composes: the Runner's environment less its own
 * (withoutRunnerOwnEnvironment) and the pipeline's git credentials, with
 * CI=true so that nothing waits on a prompt nobody will answer.
 */
export function getCodeFixCommandEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = withoutRunnerOwnEnvironment(base);

  for (const name of Object.keys(environment)) {
    if (CODE_FIX_PIPELINE_ENVIRONMENT_NAMES.includes(name.toUpperCase())) {
      delete environment[name];
    }
  }

  environment["CI"] = "true";

  return environment;
}
