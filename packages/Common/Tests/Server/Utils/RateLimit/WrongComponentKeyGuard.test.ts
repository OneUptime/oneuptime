import { listProductFiles } from "../../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../../Helpers/TagStripScan";
import KubernetesAiAgent from "../../../../Models/DatabaseModels/KubernetesAiAgent";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY KEY A PROBE, A RUNNER OR AN AI AGENT PROVES WHO IT IS WITH IS
 * COUNTED WHEN IT IS WRONG.
 *
 * A probe's key, a Runner's or an AI agent's key and REGISTER_PROBE_KEY can
 * each be set by a person, so each is held to the rule every credential
 * keeps: a client may present only so many different wrong ones
 * (WrongComponentKeyLimit, on the core the cluster key's limit shares,
 * WrongKeyLimit). That holds only while every place that checks one asks the
 * limit, in the right order. So, across all product code (ee/ too, when it
 * is checked out), comments removed:
 *
 *   - each check is listed, and does what the rule needs in this order: a
 *     check of a probe's, a Runner's or an agent's key first asks whether its
 *     client is refused already, and answers a refused one with 429 before
 *     the key is looked up; then every check compares the key (or finds the
 *     component by it), asks the limit with whether the key was right,
 *     answers a refused client with 429, and only then answers the key as
 *     wrong or lets the request through;
 *   - nothing else calls the lookups a check is built on, or the limit: a
 *     new route that checks a probe's or an agent's key fails this guard
 *     until it counts too, and every code-fix route authenticates through
 *     CodeFixAgentAuth.authenticate;
 *   - only the limits' own modules build a WrongKeyLimit, each in Valkey
 *     under a prefix of its own;
 *   - the app holds no shared Runner's key, and counts none: only the
 *     Runner reads ONEUPTIME_RUNNER_KEY, its own key;
 *   - the agents whose keys are left out are listed with why: their keys are
 *     made by the server, 256 random bits nobody chooses, kept only as a
 *     hash nobody may write or read.
 *
 * The rule itself is driven in WrongComponentKeyLimit.test.ts and the suites
 * named in its header.
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

const hasEe: boolean = fs.existsSync(path.join(REPOSITORY_DIRECTORY, "ee"));

const PROBE_AUTHORIZATION: string =
  "packages/App/FeatureSet/Telemetry/Middleware/ProbeAuthorization.ts";
const PROBE_REGISTRATION: string =
  "packages/App/FeatureSet/Telemetry/API/ProbeIngest/Register.ts";
const RUNNER_AUTHORIZATION: string =
  "packages/App/FeatureSet/Runbook/Middleware/RunnerAuthorization.ts";
const AI_AGENT_API: string = "packages/Common/Server/API/AIAgentAPI.ts";
const CODE_FIX_AGENT_AUTH: string =
  "packages/Common/Server/Utils/AI/CodeFix/CodeFixAgentAuth.ts";
const WRONG_COMPONENT_KEY_LIMIT: string =
  "packages/Common/Server/Utils/RateLimit/WrongComponentKeyLimit.ts";
const WRONG_CLUSTER_KEY_LIMIT: string =
  "packages/Common/Server/Utils/RateLimit/WrongClusterKeyLimit.ts";

/*
 * Each check, and what it must do, in order: the snippets of its code
 * (comments removed, whitespace collapsed), each after the one before it.
 */
interface KeyCheck {
  file: string;
  // Where the check's code starts and ends in the file.
  from: string;
  to: string;
  // Where the key is compared: nothing answers from here until the limit is asked.
  compared: string;
  inOrder: Array<string>;
}

const KEY_CHECKS: Array<KeyCheck> = [
  {
    file: PROBE_AUTHORIZATION,
    from: "public static async isAuthorizedServiceMiddleware(",
    to: "return next(err);",
    compared: "await ProbeService.verifyProbeKey({",
    inOrder: [
      "const refusedBeforeLookup: WrongKeyRefusal | null = await WrongComponentKeyLimit.checkBeforeLookup({ req: req, kind: ComponentKeyKind.Probe, componentId: probeId.toString(), });",
      "if (refusedBeforeLookup) { return WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.Probe, refusedBeforeLookup); }",
      "const isValidProbe: boolean = await ProbeService.verifyProbeKey({ probeId: probeId, probeKey: probeKey, });",
      "await WrongComponentKeyLimit.checkComponentKey({ req: req, kind: ComponentKeyKind.Probe, componentId: probeId.toString(), presentedKey: probeKey, isKeyRight: isValidProbe,",
      "return await ProbeService.hasProbeWithId(probeId);",
      "if (refusal) { return WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.Probe, refusal); }",
      'if (!isValidProbe) { return Response.sendErrorResponse(req, res, new BadDataException("Invalid Probe ID or Probe Key")); }',
      "return next();",
    ],
  },
  {
    file: RUNNER_AUTHORIZATION,
    from: "public static async isAuthorizedAgent(",
    to: "req.runner = agent;",
    compared: "await RunnerService.findByIdAndKey({",
    inOrder: [
      "const refusedBeforeLookup: WrongKeyRefusal | null = await WrongComponentKeyLimit.checkBeforeLookup({ req: req, kind: ComponentKeyKind.Agent, componentId: agentId.toString(), });",
      "if (refusedBeforeLookup) { return WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.Agent, refusedBeforeLookup); }",
      "const agent: Runner | null = await RunnerService.findByIdAndKey({",
      "await WrongComponentKeyLimit.checkComponentKey({ req: req, kind: ComponentKeyKind.Agent, componentId: agentId.toString(), presentedKey: agentKeyRaw, isKeyRight: Boolean(agent),",
      "return await RunnerService.hasRunnerWithId(agentId);",
      "if (refusal) { return WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.Agent, refusal); }",
      'if (!agent) { return Response.sendErrorResponse(req, res, new BadDataException("Invalid agentId or agentKey")); }',
    ],
  },
  {
    file: AI_AGENT_API,
    from: "/alive`",
    to: "next(err);",
    compared:
      "await AIAgentService.findOneBy({ query: { _id: aiAgentId.toString(), key: aiAgentKey,",
    inOrder: [
      "const refusedBeforeLookup: WrongKeyRefusal | null = await WrongComponentKeyLimit.checkBeforeLookup({ req: req, kind: ComponentKeyKind.Agent, componentId: aiAgentId.toString(), });",
      "if (refusedBeforeLookup) { return WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.Agent, refusedBeforeLookup); }",
      "const aiAgent: AIAgent | null = await AIAgentService.findOneBy({ query: { _id: aiAgentId.toString(), key: aiAgentKey, },",
      "await WrongComponentKeyLimit.checkComponentKey({ req: req, kind: ComponentKeyKind.Agent, componentId: aiAgentId.toString(), presentedKey: aiAgentKey, isKeyRight: Boolean(aiAgent),",
      "return await AIAgentService.hasAIAgentWithId(aiAgentId);",
      "if (refusal) { return WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.Agent, refusal); }",
      'if (!aiAgent) { return Response.sendErrorResponse(req, res, new BadDataException("Invalid AI Agent ID or AI Agent Key")); }',
      "await AIAgentService.updateLastAlive(aiAgentId);",
    ],
  },
  {
    file: CODE_FIX_AGENT_AUTH,
    from: "public static async authenticate(",
    to: "public static async resolveAgentIdentity(",
    compared: "await CodeFixAgentAuth.checkCredential(data);",
    inOrder: [
      "const presentedAgentId: ObjectID | null = CodeFixAgentAuth.getPresentedAgentId(data);",
      "if (presentedAgentId) { const refusedBeforeLookup: WrongKeyRefusal | null = await WrongComponentKeyLimit.checkBeforeLookup({ req: req, kind: ComponentKeyKind.Agent, componentId: presentedAgentId.toString(), });",
      "if (refusedBeforeLookup) { WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.Agent, refusedBeforeLookup); return null; } }",
      "const check: CodeFixCredentialCheck = await CodeFixAgentAuth.checkCredential(data);",
      'await WrongComponentKeyLimit.checkComponentKey({ req: req, kind: ComponentKeyKind.Agent, componentId: agentId.toString(), presentedKey: data["aiAgentKey"], isKeyRight: check.isKeyRight,',
      "return await CodeFixAgentAuth.agentOrRunnerExists(agentId);",
      "if (refusal) { WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.Agent, refusal); return null; }",
      "if (!check.identity) { Response.sendErrorResponse(req, res, new BadDataException(INVALID_CODE_FIX_AGENT_MESSAGE)); return null; }",
      "return check.identity;",
    ],
  },
  {
    file: PROBE_REGISTRATION,
    from: '"/register"',
    to: "const probeName: string | undefined",
    compared:
      "SecretKeyComparison.timingSafeEqual(registerProbeKey, RegisterProbeKey.toString());",
    inOrder: [
      "const isRegisterProbeKeyRight: boolean = SecretKeyComparison.timingSafeEqual(registerProbeKey, RegisterProbeKey.toString());",
      "await WrongComponentKeyLimit.checkRegistrationKey({ req: req, kind: ComponentKeyKind.ProbeRegistration, presentedKey: registerProbeKey, isKeyRight: isRegisterProbeKeyRight, });",
      "if (refusal) { return WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.ProbeRegistration, refusal); }",
      "if (!isRegisterProbeKeyRight) { return Response.sendErrorResponse(req, res, new BadDataException(INVALID_REGISTER_PROBE_KEY_MESSAGE)); }",
    ],
  },
];

/*
 * The lookups the checks are built on, and the only files that may call
 * them: anything else that checks a component's key has to count too.
 */
const LOOKUP_CALLERS: Array<{ call: RegExp; callers: Array<string> }> = [
  {
    call: /\bProbeService\.verifyProbeKey\(/,
    callers: [PROBE_AUTHORIZATION],
  },
  {
    call: /\bRunnerService\.findByIdAndKey\(/,
    callers: [RUNNER_AUTHORIZATION],
  },
  {
    call: /\bCodeFixAgentAuth\.(?:checkCredential|resolveAgentIdentity)\(/,
    callers: [CODE_FIX_AGENT_AUTH],
  },
  {
    call: /\bWrongComponentKeyLimit\.checkComponentKey\(/,
    callers: [
      AI_AGENT_API,
      PROBE_AUTHORIZATION,
      RUNNER_AUTHORIZATION,
      CODE_FIX_AGENT_AUTH,
    ],
  },
  {
    call: /\bWrongComponentKeyLimit\.checkRegistrationKey\(/,
    callers: [PROBE_REGISTRATION],
  },
  {
    call: /\bWrongComponentKeyLimit\.checkBeforeLookup\(/,
    callers: [
      AI_AGENT_API,
      PROBE_AUTHORIZATION,
      RUNNER_AUTHORIZATION,
      CODE_FIX_AGENT_AUTH,
    ],
  },
];

/*
 * The checks that look a key up in the database - a probe's, a Runner's or
 * an AI agent's - and so ask, before the lookup, whether the client is
 * refused already. A registration key is compared with a value the app
 * holds, and reads nothing.
 */
const LOOKS_UP_THE_KEY: Array<string> = [
  PROBE_AUTHORIZATION,
  RUNNER_AUTHORIZATION,
  AI_AGENT_API,
  CODE_FIX_AGENT_AUTH,
];

// Every code-fix route, by file: each authenticates through authenticate.
const CODE_FIX_ROUTE_FILES: Record<string, number> = {
  "packages/Common/Server/API/AIAgentTaskAPI.ts": 3,
  "packages/Common/Server/API/AIAgentDataAPI.ts": 6,
  "packages/Common/Server/API/AIAgentTaskLogAPI.ts": 1,
  "packages/Common/Server/API/AIAgentGitHubAPI.ts": 1,
  // A request from Code: the words, the context and the branch it works on.
  "packages/Common/Server/API/AIAgentCodeTaskAPI.ts": 1,
  // Production telemetry for a run: the tools it is offered, and one call.
  "packages/Common/Server/API/AIAgentTelemetryAPI.ts": 2,
};

// What answers a request: between a key's lookup and the limit, nothing may.
const ANSWERS: RegExp = /\bnext\(|Response\.send|answerRefusal\(/;

/*
 * Every product file that reads a component's key from a request: one of
 * the checks above, or listed here with why its key is not counted.
 */
const KEY_READ: RegExp =
  /\b(?:body|data)\[\s*"(?:agentKey|probeKey|aiAgentKey|registerProbeKey|previousRunnerKey|previousAgentKey)"\s*\]/;

const READS_A_KEY_WITHOUT_COUNTING: Record<string, string> = {
  "packages/App/FeatureSet/Runbook/API/RunnerIngress.ts":
    "previousRunnerKey: a key the server made for the Kubernetes agent's Runner, read once the project's telemetry ingestion key is right, to let a live Runner rotate its own key",
  "packages/App/FeatureSet/Runbook/API/KubernetesAiAgentIngress.ts":
    "previousAgentKey: a key the server made, read once the project's telemetry ingestion key is right, to let a live agent rotate its own key",
  "packages/App/FeatureSet/Runbook/API/ResourceAiAgentIngress.ts":
    "previousAgentKey: a key the server made, read once the project's telemetry ingestion key is right, to let a live agent rotate its own key",
};

/*
 * The agents whose keys are left out of the count, with why: a key the
 * server makes, 256 random bits nobody chooses, kept only as a hash that no
 * role may write or read - nobody can try one key after another and ever
 * find one.
 */
const SERVER_MADE_KEY_CHECKS: Record<
  string,
  { model: { new (): KubernetesAiAgent | ResourceAiAgent }; service: string }
> = {
  "packages/App/FeatureSet/Runbook/Middleware/KubernetesAiAgentAuthorization.ts":
    {
      model: KubernetesAiAgent,
      service: "packages/Common/Server/Services/KubernetesAiAgentService.ts",
    },
  "packages/App/FeatureSet/Runbook/Middleware/ResourceAiAgentAuthorization.ts":
    {
      model: ResourceAiAgent,
      service: "packages/Common/Server/Services/ResourceAiAgentService.ts",
    },
};

// The code of a file, its comments removed by TypeScript's own printer.
function codeOf(relativePath: string): string {
  const source: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, relativePath),
    "utf8",
  );

  return ts
    .createPrinter({ removeComments: true })
    .printFile(
      ts.createSourceFile(
        path.basename(relativePath),
        source,
        ts.ScriptTarget.Latest,
        true,
        relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    );
}

// The code with every run of whitespace one space.
function collapsed(code: string): string {
  return code.split(/\s+/).join(" ");
}

let productCodeFiles: Array<string> | null = null;

function productFiles(): Array<string> {
  if (!productCodeFiles) {
    productCodeFiles = listProductFiles(REPOSITORY_DIRECTORY, [
      "packages",
      "ee",
    ]).filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    });
  }

  return productCodeFiles;
}

function productFilesWhoseCodeMatches(pattern: RegExp): Array<string> {
  return productFiles()
    .filter((relativePath: string): boolean => {
      return pattern.test(
        fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
      );
    })
    .filter((relativePath: string): boolean => {
      return pattern.test(codeOf(relativePath));
    })
    .sort();
}

// The part of a file's collapsed code a check lives in.
function segmentOf(check: KeyCheck): string {
  const code: string = collapsed(codeOf(check.file));
  const start: number = code.indexOf(check.from);

  if (start < 0) {
    return "";
  }

  const end: number = code.indexOf(check.to, start + check.from.length);

  return code.slice(start, end < 0 ? undefined : end + check.to.length);
}

describe("every check of a component's key asks the limit, in the order the rule needs", () => {
  test.each(
    KEY_CHECKS.map((check: KeyCheck) => {
      return [check.file, check];
    }),
  )("%s", (_file: unknown, check: unknown) => {
    const keyCheck: KeyCheck = check as KeyCheck;
    const segment: string = segmentOf(keyCheck);

    expect(segment.length).toBeGreaterThan(0);

    let position: number = 0;

    for (const snippet of keyCheck.inOrder) {
      const found: number = segment.indexOf(snippet, position);

      expect({ file: keyCheck.file, snippet, found: found >= 0 }).toEqual({
        file: keyCheck.file,
        snippet,
        found: true,
      });

      position = found + snippet.length;
    }
  });

  test("each asks the limit once, and nothing answers the request between the lookup and the question", () => {
    for (const check of KEY_CHECKS) {
      const segment: string = segmentOf(check);
      const asks: number =
        segment.split("WrongComponentKeyLimit.checkComponentKey(").length +
        segment.split("WrongComponentKeyLimit.checkRegistrationKey(").length -
        2;

      expect({ file: check.file, asks }).toEqual({
        file: check.file,
        asks: 1,
      });

      const lookup: number = segment.indexOf(check.compared);

      expect({ file: check.file, compared: lookup >= 0 }).toEqual({
        file: check.file,
        compared: true,
      });

      const asked: number = Math.max(
        segment.indexOf("WrongComponentKeyLimit.checkComponentKey("),
        segment.indexOf("WrongComponentKeyLimit.checkRegistrationKey("),
      );

      expect({
        file: check.file,
        answersBetween: ANSWERS.test(segment.slice(lookup, asked)),
      }).toEqual({ file: check.file, answersBetween: false });
    }
  });
});

describe("a client over the limit is refused before its key is looked up", () => {
  test("each check that looks a key up asks once whether its client is refused, before the lookup, and answers a refused client there", () => {
    for (const check of KEY_CHECKS) {
      const segment: string = segmentOf(check);
      const asksBefore: number =
        segment.split("WrongComponentKeyLimit.checkBeforeLookup(").length - 1;

      expect({ file: check.file, asksBefore }).toEqual({
        file: check.file,
        asksBefore: LOOKS_UP_THE_KEY.includes(check.file) ? 1 : 0,
      });

      if (!LOOKS_UP_THE_KEY.includes(check.file)) {
        continue;
      }

      const asked: number = segment.indexOf(
        "WrongComponentKeyLimit.checkBeforeLookup(",
      );
      const lookup: number = segment.indexOf(check.compared);

      expect({
        file: check.file,
        askedBeforeTheLookup: asked < lookup,
      }).toEqual({
        file: check.file,
        askedBeforeTheLookup: true,
      });

      // Between the question and the lookup, only the refusal answers.
      const between: string = segment.slice(asked, lookup);

      expect({
        file: check.file,
        answersOnlyARefusal:
          between.includes(
            "WrongComponentKeyLimit.answerRefusal(req, res, ComponentKeyKind.",
          ) &&
          !between.includes("next(") &&
          !between.includes("Response.send"),
      }).toEqual({ file: check.file, answersOnlyARefusal: true });
    }
  });

  test("the question adds nothing to the count: it asks the limit with no wrong key", () => {
    const limit: string = collapsed(codeOf(WRONG_COMPONENT_KEY_LIMIT));
    const start: number = limit.indexOf(
      "public static async checkBeforeLookup(",
    );
    const end: number = limit.indexOf("public static async", start + 1);
    const body: string = limit.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain(
      "return await KINDS[data.kind].limit.check({ req: data.req, wrongKey: null, subject: subject, });",
    );
    expect(body).not.toContain("digestOf(");
    expect(body).not.toContain("componentExists");
  });
});

describe("nothing else checks a component's key, or asks the limit", () => {
  test.each(
    LOOKUP_CALLERS.map((entry: { call: RegExp; callers: Array<string> }) => {
      return [entry.call.source, entry];
    }),
  )("%s", (_source: unknown, entry: unknown) => {
    const lookup: { call: RegExp; callers: Array<string> } = entry as {
      call: RegExp;
      callers: Array<string>;
    };

    expect(productFilesWhoseCodeMatches(lookup.call)).toEqual(
      [...lookup.callers].sort(),
    );
  });

  test("every code-fix route authenticates through CodeFixAgentAuth.authenticate, and no route reads the pair itself", () => {
    const routes: Record<string, number> = {};

    for (const relativePath of productFilesWhoseCodeMatches(
      /\bCodeFixAgentAuth\.authenticate\(/,
    )) {
      routes[relativePath] =
        codeOf(relativePath).split("CodeFixAgentAuth.authenticate(req, res)")
          .length - 1;
    }

    expect(routes).toEqual(CODE_FIX_ROUTE_FILES);
  });

  test("only the limits' own modules build a WrongKeyLimit, each under a prefix of its own", () => {
    expect(productFilesWhoseCodeMatches(/\bnew WrongKeyLimit\(/)).toEqual(
      [WRONG_CLUSTER_KEY_LIMIT, WRONG_COMPONENT_KEY_LIMIT].sort(),
    );

    const prefixes: Array<string> = [];
    const KEY_PREFIX: RegExp = /keyPrefix: "([^"\n]{1,80})"/g;

    for (const relativePath of [
      WRONG_CLUSTER_KEY_LIMIT,
      WRONG_COMPONENT_KEY_LIMIT,
    ]) {
      for (const match of codeOf(relativePath).matchAll(KEY_PREFIX)) {
        prefixes.push(match[1]!);
      }
    }

    expect(prefixes.sort()).toEqual(
      [
        "agent-key:wrong-keys:",
        "cluster-key:wrong-keys:",
        "probe-key:wrong-keys:",
        "probe-registration-key:wrong-keys:",
      ].sort(),
    );
  });

  test("the app holds no shared Runner's key, and counts none: only the Runner reads ONEUPTIME_RUNNER_KEY", () => {
    // The key EnvironmentConfig held, its kind of wrong key, and its refusal: gone.
    expect(
      productFilesWhoseCodeMatches(
        /\b(?:SharedRunnerKey|IsSharedRunnerKeyShipped|WRONG_SHARED_RUNNER_KEYS_MESSAGE)\b|\bComponentKeyKind\.SharedRunner\b/,
      ),
    ).toEqual([]);
    expect(
      productFilesWhoseCodeMatches(
        /process\.env(?:\[\s*["'`]ONEUPTIME_RUNNER_KEY["'`]\s*\]|\.ONEUPTIME_RUNNER_KEY\b)/,
      ).filter((relativePath: string): boolean => {
        return !relativePath.startsWith("packages/Runner/");
      }),
    ).toEqual([]);
  });
});

describe("the agents whose keys are left out of the count", () => {
  test.each(
    Object.keys(SERVER_MADE_KEY_CHECKS).map((file: string) => {
      return [file];
    }),
  )(
    "%s checks a key the server made, kept as a hash nobody may write or read",
    (file: string) => {
      if (!hasEe && file.startsWith("ee/")) {
        return;
      }

      const entry: {
        model: { new (): KubernetesAiAgent | ResourceAiAgent };
        service: string;
      } = SERVER_MADE_KEY_CHECKS[file]!;

      // The model's key hash: no role may create, read or update it.
      const access: ColumnAccessControl | null =
        new entry.model().getColumnAccessControlFor("keyHash");

      expect(access).not.toBeNull();
      expect({
        create: access!.create,
        read: access!.read,
        update: access!.update,
      }).toEqual({ create: [], read: [], update: [] });

      // The service makes each key from 32 random bytes, and compares hashes.
      const service: string = collapsed(codeOf(entry.service));

      expect(service).toContain(
        'return crypto.randomBytes(AGENT_KEY_BYTES).toString("hex");',
      );
      expect(service).toContain("Service.doesKeyMatchHash(");

      // The check asks the service, and never a lookup by key.
      const check: string = codeOf(file);

      expect(check).toContain(".authenticate({");
      expect(check).not.toMatch(/\bkey:\s/);
    },
  );

  test("every file that reads a component's key from a request counts it, or is listed with why it does not", () => {
    const counted: Array<string> = KEY_CHECKS.map((check: KeyCheck): string => {
      return check.file;
    });

    const unsorted: Array<string> = productFilesWhoseCodeMatches(
      KEY_READ,
    ).filter((relativePath: string): boolean => {
      return (
        !counted.includes(relativePath) &&
        SERVER_MADE_KEY_CHECKS[relativePath] === undefined &&
        READS_A_KEY_WITHOUT_COUNTING[relativePath] === undefined
      );
    });

    expect(unsorted).toEqual([]);
  });

  test("every listed file still reads such a key, so the list cannot rot", () => {
    const readers: Array<string> = productFilesWhoseCodeMatches(KEY_READ);

    for (const relativePath of [
      ...Object.keys(READS_A_KEY_WITHOUT_COUNTING),
      ...Object.keys(SERVER_MADE_KEY_CHECKS),
    ]) {
      if (!hasEe && relativePath.startsWith("ee/")) {
        continue;
      }

      expect([relativePath, readers.includes(relativePath)]).toEqual([
        relativePath,
        true,
      ]);
    }
  });
});
