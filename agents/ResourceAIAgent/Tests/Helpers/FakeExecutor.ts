import PrepareGuard, {
  GuardPolicy,
  GuardResult,
} from "../../Executors/PrepareGuard";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "../../Executors/ResourceExecutor";
import SpawnSandbox from "../../Executors/SpawnSandbox";
import AiResourceType from "../../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceCommandPolicyResult,
  deniedResult,
  renderResourceDisplayCommand,
} from "../../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * Test doubles for the executor layer.
 *
 * fakePolicy: a GuardPolicy that tiers commands from a table instead of the
 * real per-tool policies (some of which are still fail-closed stubs), so
 * the paths behind a permitted command — writes, write scope, identity —
 * can be reached. It keeps the real write-scope rule.
 *
 * FakeExecutor: a ResourceExecutor whose every answer the test scripts. It
 * can run the real PrepareGuard (with a fake policy) and the real
 * SpawnSandbox (with a fake binary), so the agent's whole pipeline can be
 * exercised end to end without a Docker socket.
 */

export interface FakePolicyEntry {
  tier: ResourceCommandTier;
  // Targets a write touches; the args after the verb by default.
  targets?: Array<string> | undefined;
  requiresHuman?: boolean | undefined;
  // What the policy says the args are (to model a normalization mismatch).
  args?: Array<string> | undefined;
}

// Tiers "program arg arg" strings from the table; anything else is Denied.
export function fakePolicy(
  table: Record<string, FakePolicyEntry | ResourceCommandTier>,
): GuardPolicy & { calls: Array<Array<string>> } {
  const calls: Array<Array<string>> = [];

  return {
    calls,
    evaluateArgv: (data: {
      resourceType: AiResourceType;
      argv: Array<string>;
    }): ResourceCommandPolicyResult => {
      calls.push(data.argv.slice());
      const key: string = data.argv.join(" ");
      const raw: FakePolicyEntry | ResourceCommandTier | undefined = table[key];

      if (raw === undefined) {
        return deniedResult(data.argv, "not in the fake policy's table");
      }

      const entry: FakePolicyEntry =
        typeof raw === "string" ? { tier: raw } : raw;

      if (entry.tier === ResourceCommandTier.Denied) {
        return deniedResult(data.argv, "denied by the fake policy");
      }

      const args: Array<string> = entry.args || data.argv.slice(1);
      const result: ResourceCommandPolicyResult = {
        tier: entry.tier,
        reason: `the fake policy reads it as ${entry.tier}`,
        program: data.argv[0] || "",
        args,
        verb: data.argv[1] || "",
        displayCommand: renderResourceDisplayCommand([
          data.argv[0] || "",
          ...args,
        ]),
        targets:
          entry.tier === ResourceCommandTier.Read
            ? []
            : entry.targets || data.argv.slice(2),
      };

      if (entry.requiresHuman) {
        result.requiresHuman = true;
      }

      return result;
    },
    getWriteScopeRefusal: (data: {
      result: ResourceCommandPolicyResult;
      allowWrites: boolean;
      writeTargets: Array<string>;
      protectedTargets: Array<string>;
      resourceType: AiResourceType;
    }): string | null => {
      return ResourceCommandPolicy.getWriteScopeRefusal(data);
    },
  };
}

export interface FakeExecutorBehaviour {
  // prepare() refuses with this (after the guard, when one is set).
  refusal?: string | null | undefined;
  // Run the real PrepareGuard with this policy first.
  guardPolicy?: GuardPolicy | undefined;
  // What run() returns (after runDelayMs).
  result?: ExecResult | undefined;
  runDelayMs?: number | undefined;
  /*
   * Run the command for real through a SpawnSandbox: the program is
   * started by this name (a FakeBinary on PATH).
   */
  spawnBinary?: string | undefined;
  probe?:
    | ResourcePostureProbe
    | (() => Promise<ResourcePostureProbe>)
    | undefined;
  // Adds resolveResourceIdentifier(), answering with this.
  resolvedIdentifier?:
    | string
    | null
    | (() => Promise<string | null>)
    | undefined;
  protectedTargets?: Array<string> | undefined;
}

export const DEFAULT_FAKE_PROBE: ResourcePostureProbe = {
  toolVersion: "29.4.3",
  reachable: true,
  reachError: null,
  details: { engine: "docker" },
  protectedTargets: ["oneuptime-docker-ai-agent"],
};

export default class FakeExecutor implements ResourceExecutor {
  public readonly prepared: Array<ResourceCommandRequest> = [];
  public readonly ran: Array<ResourceCommandRequest> = [];
  public probes: number = 0;
  public sweeps: number = 0;
  public removals: number = 0;
  public resolveResourceIdentifier?: () => Promise<string | null>;
  public readonly sandbox: SpawnSandbox;

  public constructor(
    public readonly options: ExecutorOptions,
    public behaviour: FakeExecutorBehaviour = {},
  ) {
    this.sandbox = new SpawnSandbox({
      tmpDir: options.tmpDir,
      logger: options.logger,
      spawnImpl: options.spawnImpl,
    });

    if (behaviour.resolvedIdentifier !== undefined) {
      const answer: string | null | (() => Promise<string | null>) =
        behaviour.resolvedIdentifier;

      this.resolveResourceIdentifier = (): Promise<string | null> => {
        return typeof answer === "function"
          ? answer()
          : Promise.resolve(answer);
      };
    }
  }

  public prepare(request: ResourceCommandRequest): PrepareResult {
    this.prepared.push(request);

    let guarded: GuardResult | null = null;

    if (this.behaviour.guardPolicy) {
      guarded = PrepareGuard.check({
        config: this.options.config,
        request,
        protectedTargets: this.behaviour.protectedTargets,
        policy: this.behaviour.guardPolicy,
      });

      if (guarded.refusal !== null) {
        return { refusal: guarded.refusal };
      }
    }

    if (this.behaviour.refusal) {
      return { refusal: this.behaviour.refusal };
    }

    const displayCommand: string =
      guarded && guarded.refusal === null
        ? guarded.displayCommand
        : String(request.payload["displayCommand"] || "");
    const tier: ResourceCommandTier =
      guarded && guarded.refusal === null
        ? guarded.tier
        : ResourceCommandTier.Read;

    return {
      refusal: null,
      displayCommand,
      tier,
      run: (): Promise<ExecResult> => {
        return this.run(request, guarded);
      },
    };
  }

  public probePosture(): Promise<ResourcePostureProbe> {
    this.probes++;
    const probe:
      | ResourcePostureProbe
      | (() => Promise<ResourcePostureProbe>)
      | undefined = this.behaviour.probe;

    if (typeof probe === "function") {
      return probe();
    }

    return Promise.resolve(probe || DEFAULT_FAKE_PROBE);
  }

  public sweepOrphanedJobDirs(): Promise<void> {
    this.sweeps++;
    this.sandbox.sweepOrphanedJobDirs();
    return Promise.resolve();
  }

  public removeAllJobDirs(): Promise<void> {
    this.removals++;
    this.sandbox.removeAllJobDirs();
    return Promise.resolve();
  }

  private async run(
    request: ResourceCommandRequest,
    guarded: GuardResult | null,
  ): Promise<ExecResult> {
    this.ran.push(request);

    if (this.behaviour.spawnBinary && guarded && guarded.refusal === null) {
      const binary: string = this.behaviour.spawnBinary;

      return this.sandbox.run({
        binary,
        args: guarded.args,
        resourceType: guarded.resourceType,
        program: guarded.program,
        timeoutInMs: guarded.timeoutInMs,
        buildEnv: (): Record<string, string> => {
          return { PATH: this.options.env["PATH"] || "" };
        },
      });
    }

    if (this.behaviour.runDelayMs) {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, this.behaviour.runDelayMs);
      });
    }

    return (
      this.behaviour.result || {
        success: true,
        output: "[stdout]\nok\n",
        exitCode: 0,
      }
    );
  }
}
