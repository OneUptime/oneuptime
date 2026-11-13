import { exec } from "child_process";
import { promisify } from "util";

/*
 * How the generators run Go: with a soft memory limit.
 *
 * The provider's internal/provider is one Go package, some 985 files and
 * 60 MB of Go, and compiling it takes more memory than anything else CI
 * does. Go's default garbage collection lets the heap grow to twice what is
 * live, and the compiler peaked at about 15 GB, for `go build` and for the
 * test binary `go test` builds alike, while the Node.js process that runs
 * the generator held another 1.5 GB. That is more than the 16 GB of a
 * GitHub-hosted runner: a generation got through only while swap took the
 * rest, and when it did not the runner stopped answering and GitHub marked
 * the job lost (#7559).
 *
 * GOMEMLIMIT is that limit: as Go's memory nears it, Go collects garbage
 * more often instead of letting the heap double. 10 GiB is about what the
 * compiler holds live at its peak, so it peaks at about 11 GB instead of 15,
 * for 5-45 s more per compile, spent collecting garbage. A lower limit buys
 * nothing, because what is live cannot be collected: at 8 or 6 GiB the
 * compiler peaked just as high, and took 45-70% longer. The limit
 * changes how Go manages its memory, not what it builds: the provider is
 * byte for byte the same.
 *
 * A caller's own GOMEMLIMIT wins ("off" turns the limit off). The workflows
 * that compile the provider set this value for their own Go steps, and
 * publish-terraform-provider.sh for the Go it runs:
 * Tests/Ops/TerraformProviderGoMemoryLimit.test.js holds them to it.
 */
export const GO_MEMORY_LIMIT: string = "10GiB";

const execAsync: (
  command: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

// `environment` with Go's memory limit, unless it sets one of its own.
export function goEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    GOMEMLIMIT: environment["GOMEMLIMIT"] || GO_MEMORY_LIMIT,
  };
}

/*
 * Runs a Go command - a shell line, such as `go build -o <file>` - in `cwd`,
 * with this process's environment and Go's memory limit. A command that
 * fails rejects with the error `exec` gives, its stdout and stderr on it.
 */
export async function runGoCommand(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return await execAsync(command, { cwd, env: goEnvironment(process.env) });
}
