import KubectlPolicy, {
  KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH,
  KUBECTL_ALLOWLIST_MAX_PATTERNS,
  KubectlAutoExecutionVerdict,
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — ONE definition of a valid cluster kubectl allowlist
 * entry, and of a broad one, shared by the matcher, the server's save
 * validation and the AI page's form (the policy header's allowlist section):
 *  1. describeAllowlistPatternProblem accepts an entry exactly when
 *     matchesAllowlist reads it: every entry it refuses is skipped by the
 *     matcher (stored ones included), and every entry it accepts matches the
 *     command it spells.
 *  2. Valid: a non-blank string of at most 500 characters, one line,
 *     balanced quotes, at most 64 words, a leading "kubectl" optional in any
 *     case; the verb (and the rollout/set/create subcommand) written out in
 *     lowercase with no `*`; a verb OneUptime AI may run; flags the policy
 *     reads. The refusal says why in words for the person typing it, never
 *     "matched against the whole command".
 *  3. Broad (isBroadAllowlistPattern): a `*` for the namespace, an object
 *     the command acts on, a selector or a --from source. Not broad: a `*`
 *     in a value — the documented `kubectl set image deployment/web * -n
 *     web` above all — and any entry the allowlist can never promote (reads,
 *     drain, taint). The entry is read with the policy's own flag parser, so
 *     every -n spelling counts and a value flag's `*` is not an object.
 *  4. Property: every command a NON-broad entry matches (and the policy
 *     lets run) acts on the same verb, namespace and objects — checked with
 *     an independent reading of kubectl's positionals over hand-picked and
 *     generated entries, with adversarial words substituted for each `*`.
 *
 * The server (KubernetesClusterService.normalizeKubectlAllowlistForWrite)
 * and the AI page (validateKubectlAllowlistText, the broad-entry
 * confirmation) call these two functions; their own tests pin that they do.
 */

function argsOf(command: string): Array<string> {
  const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);
  return tokenized.args || [];
}

function matches(command: string, entry: unknown): boolean {
  return KubectlPolicy.matchesAllowlist({
    args: argsOf(command),
    allowlistPatterns: [entry as string],
  });
}

// ---- Valid entries, each with a command it matches -----------------------------

const LONGEST_VALID_ENTRY: string = `kubectl set image deployment/web * -n web --field-manager=${"x".repeat(
  KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH -
    "kubectl set image deployment/web * -n web --field-manager=".length,
)}`;

const VALID_ENTRIES: Array<[string, string]> = [
  [
    "kubectl set image deployment/web * -n web",
    "kubectl set image deployment/web web=nginx:1.27 -n web",
  ],
  // "kubectl" is optional, in any case — in the entry exactly as in the command.
  [
    "set image deployment/web * -n web",
    "kubectl set image deployment/web web=nginx:1.27 -n web",
  ],
  [
    "Kubectl set image deployment/web * -n web",
    "kubectl set image deployment/web web=nginx:1.27 -n web",
  ],
  [
    "KUBECTL scale deployment/web --replicas=* -n web",
    "kubectl scale deployment/web --replicas=0 -n web",
  ],
  ["Kubectl scale *", "kubectl scale web"],
  [
    "  kubectl set image deployment/web * -n web  ",
    "set image deployment/web web=nginx:1.27 -n web",
  ],
  [
    "kubectl patch deployment/web -n web -p *",
    `kubectl patch deployment/web -n web -p '{"spec":{"replicas":2}}'`,
  ],
  [
    `kubectl patch deployment web -n web -p '{"spec": {"replicas": *}}'`,
    `kubectl patch deployment web -n web -p '{"spec": {"replicas": 4}}'`,
  ],
  ["kubectl delete job * -n web", "kubectl delete job migrate-42 -n web"],
  [
    "kubectl -n web delete job migrate-42",
    "kubectl -n web delete job migrate-42",
  ],
  ["kubectl delete * * -n *", "kubectl delete deployment web -n prod"],
  [
    "kubectl create job * --from=cronjob/nightly -n web",
    "kubectl create job manual-1 --from=cronjob/nightly -n web",
  ],
  [
    "kubectl rollout undo deployment/web --to-revision=* -n web",
    "kubectl rollout undo deployment/web --to-revision=3 -n web",
  ],
  // Valid although the allowlist never promotes them (reads run anyway; drain never).
  ["kubectl get pods -n web", "kubectl get pods -n web"],
  [
    "kubectl drain * --ignore-daemonsets",
    "kubectl drain node-1 --ignore-daemonsets",
  ],
  // Exactly the length limit.
  [LONGEST_VALID_ENTRY, LONGEST_VALID_ENTRY.replace(" * ", " web=nginx:2 ")],
];

// ---- Invalid entries: [entry, what the refusal says, a command it would match] ----

const SIXTY_FIVE_WORDS: string = `kubectl get ${Array.from(
  { length: 64 },
  (_value: unknown, index: number) => {
    return `w${index}`;
  },
).join(" ")}`;

const INVALID_ENTRIES: Array<[unknown, string, string | null]> = [
  ["", "cannot be blank", null],
  ["   ", "cannot be blank", null],
  ["\t", "cannot be blank", null],
  [42, "cannot be blank", null],
  [null, "cannot be blank", null],
  ["kubectl", "names no kubectl command", null],
  ["KUBECTL", "names no kubectl command", null],
  ["kubectl -n web", "names no kubectl command", null],
  [`kubectl patch deployment/web -p '{"spec":`, "Unbalanced quotes", null],
  ["kubectl get\npods", "single line", null],
  [SIXTY_FIVE_WORDS, "at most 64 arguments", null],
  [
    `${LONGEST_VALID_ENTRY}x`,
    `at most ${KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH} characters`,
    null,
  ],
  /*
   * A `*` where the verb goes: the old whole-command glob's hint ("start
   * with kubectl or a *"). Under the word-by-word matcher these either
   * never match or pre-approve every kind of change at once.
   */
  [
    "*kubectl set image deployment/web * -n web",
    "where the kubectl verb goes",
    "kubectl xkubectl set image deployment/web web=x -n web",
  ],
  [
    "* set image deployment/web * -n web",
    "where the kubectl verb goes",
    "kubectl delete set image deployment/web x -n web",
  ],
  [
    "* deployment/web -n web",
    "where the kubectl verb goes",
    "kubectl delete deployment/web -n web",
  ],
  ["* * -n web", "where the kubectl verb goes", "kubectl drain node-1 -n web"],
  ["*", "where the kubectl verb goes", "kubectl cordon"],
  ["kubectl *", "where the kubectl verb goes", "kubectl drain"],
  [
    "kubectl * * * -n *",
    "where the kubectl verb goes",
    "kubectl delete deployment web -n prod",
  ],
  [
    "kubectl dele* pod web -n web",
    "where the kubectl verb goes",
    "kubectl delete pod web -n web",
  ],
  [
    "kubectl set * deployment/web * -n web",
    "where the kubectl set subcommand goes",
    "kubectl set env deployment/web A=b -n web",
  ],
  [
    "kubectl rollout * deployment/web -n web",
    "where the kubectl rollout subcommand goes",
    "kubectl rollout undo deployment/web -n web",
  ],
  [
    "kubectl create * x --from=cronjob/y -n web",
    "where the kubectl create subcommand goes",
    "kubectl create job x --from=cronjob/y -n web",
  ],
  ["kubectl rollout", "names no kubectl rollout subcommand", "kubectl rollout"],
  ["kubectl set", "names no kubectl set subcommand", "kubectl set"],
  // Entries that could only ever match commands the policy denies.
  [
    "kubectl Delete pod web -n web",
    "case-sensitively",
    "kubectl Delete pod web -n web",
  ],
  [
    "kubectl rollout Restart deployment/web -n web",
    "case-sensitively",
    "kubectl rollout Restart deployment/web -n web",
  ],
  [
    "kubectl exec *",
    "not a command OneUptime AI may run",
    "kubectl exec web-1",
  ],
  [
    "kubectl frobnicate *",
    "not a command OneUptime AI may run",
    "kubectl frobnicate x",
  ],
  [
    "kubectl apply -f *",
    "not a command OneUptime AI may run",
    "kubectl apply -f x",
  ],
  [
    "kubectl kubectl get pods",
    "not a command OneUptime AI may run",
    "kubectl kubectl get pods",
  ],
  [
    "kubectl delete pod web -n web --kubeconfig=*",
    "--kubeconfig flag is not allowed",
    "kubectl delete pod web -n web --kubeconfig=/x",
  ],
  [
    "kubectl delete pod web -n web --frobnicate",
    "not a kubectl flag",
    "kubectl delete pod web -n web --frobnicate",
  ],
  [
    "kubectl delete pod web -n web -*",
    "not a kubectl flag",
    "kubectl delete pod web -n web -*",
  ],
  [
    "kubectl --force delete pod web -n web",
    "must come after the verb",
    "kubectl --force delete pod web -n web",
  ],
];

// ---- Broad and not broad ----------------------------------------------------------

const BROAD_ENTRIES: Array<string> = [
  // A wildcard object: a kind, a name, a TYPE/NAME, part of a name.
  "kubectl delete * * -n *",
  "kubectl delete deployment * -n web",
  "kubectl delete deployment/* -n web",
  "kubectl delete */web -n web",
  "kubectl delete deployment web* -n web",
  "kubectl patch deployment * -n web -p *",
  "kubectl patch * web -n web -p *",
  "kubectl scale deployment/* --replicas=* -n web",
  "kubectl rollout restart deployment/* -n web",
  "kubectl rollout undo deployment * -n web",
  "kubectl set image * * -n web",
  "kubectl set image deployment/* *=* -n web",
  "kubectl set resources deployment/* --limits=cpu=1 -n web",
  "kubectl set selector svc/* app=web -n web",
  "kubectl expose deployment * --port=80 -n web",
  "kubectl autoscale deployment * --min=2 --max=5 -n web",
  "kubectl cordon * *",
  // A wildcard ahead of the update is another object kubectl updates too.
  "kubectl set image deployment/web * * -n web",
  "kubectl label pod * a=b -n web",
  "kubectl label pod web * a=b -n web",
  "kubectl label pod web-1 * * -n web",
  "kubectl annotate deployment * example.com/a=b -n web",
  // set env with its update in a flag: a trailing wildcard is another object.
  "kubectl set env deployment/web * --from=configmap/app -n web",
  "kubectl set env deployment/web -e A=* * -n web",
  // A wildcard namespace, in every spelling -n has.
  "kubectl delete deployment web -n *",
  "kubectl delete deployment web -n=*",
  "kubectl delete deployment web --namespace=*",
  "kubectl delete deployment web --namespace *",
  "kubectl delete deployment web --namespace=web-*",
  "kubectl -n * delete deployment web",
  "kubectl patch deployment web -n * -p *",
  "kubectl set image deployment/web * -n *",
  "kubectl create job x --from=cronjob/nightly -n *",
  // Found by the flag parser inside a short-flag cluster.
  "kubectl delete pod web -An *",
  // A wildcard selector, --all value or --from source.
  "kubectl delete pods -l * -n web",
  "kubectl delete pods -l=* -n web",
  "kubectl delete pods --selector=app=* -n web",
  "kubectl delete pods --field-selector=* -n web",
  "kubectl rollout restart deployment --all=* -n web",
  "kubectl create job x --from=cronjob/* -n web",
  "kubectl create job x --from=* -n web",
  "kubectl set env deployment/web --from=configmap/* -n web",
];

const NOT_BROAD_ENTRIES: Array<string> = [
  // The documented example: the last word is the image update, or nothing runs.
  "kubectl set image deployment/web * -n web",
  "set image deployment/web * -n web",
  "Kubectl set image deployment/web * -n web",
  "kubectl set image deployment/web web=* -n web",
  "kubectl set image deployment/web *=nginx:* -n web",
  "kubectl set image deployment/web -n web *",
  "kubectl --namespace=web set image deployment/web *",
  "kubectl set image deployment/web web=nginx:1.27 * -n web",
  "kubectl set env deployment/web * -n web",
  "kubectl set env deployment/web A=* -n web",
  "kubectl set resources deployment/web --limits=* -n web",
  "kubectl set resources deployment/web -c * --limits=cpu=1 -n web",
  "kubectl set selector svc/web * -n web",
  // A value: a patch body, a type, a replica count, a revision, a grace period.
  "kubectl patch deployment web -n web -p *",
  "kubectl patch deployment web -n web --type=* -p *",
  "kubectl patch deployment/web -n web --patch=*",
  "kubectl scale deployment/web --replicas=* -n web",
  "kubectl scale --replicas * deployment/web -n web",
  "kubectl rollout undo deployment/web --to-revision=* -n web",
  "kubectl delete job migrate-42 -n web --grace-period=*",
  "kubectl expose deployment web --port=* -n web",
  "kubectl autoscale deployment web --min=* --max=* -n web",
  // A label or annotation update.
  "kubectl label pod web-1 * -n web",
  "kubectl label pod web-1 a=b * -n web",
  "kubectl label pod web-1 app=* -n web",
  "kubectl annotate deployment web example.com/note=* -n web",
  "kubectl annotate deployment web * --overwrite -n web",
  // The NEW Job's (or ConfigMap's) name, not an existing object.
  "kubectl create job * --from=cronjob/nightly -n web",
  "kubectl create configmap * --from-literal=a=* -n web",
  // No wildcard at all.
  "kubectl delete pod web -n web",
  "kubectl rollout restart deployment/web -n web",
  // Entries the allowlist never promotes pre-approve nothing.
  "kubectl get *",
  "kubectl get * * -n *",
  "kubectl describe * * -n *",
  "kubectl logs * -n *",
  "kubectl rollout status deployment/* -n *",
  "kubectl auth can-i * *",
  "kubectl drain *",
  "kubectl drain * --ignore-daemonsets",
  "kubectl taint nodes * *",
  // Invalid entries are refused before anyone is asked to confirm them.
  "*",
  "kubectl *",
  "* * -n *",
  "kubectl * * * * -n *",
  "kubectl",
  "",
];

// ---- An independent reading of what a command acts on -------------------------

/*
 * The flags the entries in this file use that take a value in the next
 * word when written without "=".
 */
const ORACLE_VALUE_FLAGS: Set<string> = new Set<string>([
  "-n",
  "--namespace",
  "-p",
  "--patch",
  "-c",
  "--containers",
  "-l",
  "--selector",
  "--field-selector",
  "-e",
  "--env",
  "--replicas",
  "--type",
  "--from",
  "--to-revision",
  "--grace-period",
  "--timeout",
  "--limits",
  "--port",
  "--min",
  "--max",
  "--from-literal",
]);

// kubectl's GetResourcesAndPairs: is this word an update (KEY=VALUE, KEY-)?
function isKubectlPairWord(word: string): boolean {
  return (
    (word.includes("=") && !word.startsWith("=")) ||
    (word.endsWith("-") && word !== "-")
  );
}

/*
 * What a command changes, read the way kubectl reads its positionals —
 * independently of the policy: verb, namespace, the objects it acts on and
 * anything that selects more. Null when kubectl would refuse the command
 * without changing anything (an update verb with no update, or an object
 * after an update).
 */
function whatItChanges(args: Array<string>): string | null {
  const positionals: Array<string> = [];
  const flags: Map<string, string> = new Map<string, string>();

  for (let i: number = 0; i < args.length; i++) {
    const word: string = args[i]!;

    if (!word.startsWith("-") || word === "-") {
      positionals.push(word);
      continue;
    }

    const eq: number = word.indexOf("=");

    if (eq >= 0) {
      flags.set(word.slice(0, eq), word.slice(eq + 1));
    } else if (
      word.startsWith("-n") &&
      word.length > 2 &&
      !word.startsWith("--")
    ) {
      flags.set("-n", word.slice(2));
    } else if (ORACLE_VALUE_FLAGS.has(word)) {
      flags.set(word, args[i + 1] ?? "");
      i++;
    } else {
      flags.set(word, "");
    }
  }

  const verb: string = positionals[0] || "";
  const hasSubcommand: boolean = ["rollout", "set", "create"].includes(verb);
  const subcommand: string = hasSubcommand ? positionals[1] || "" : "";
  let operands: Array<string> = positionals.slice(hasSubcommand ? 2 : 1);
  const namespace: string =
    flags.get("-n") ?? flags.get("--namespace") ?? "(context)";
  const selecting: string = [
    flags.get("-l") ?? flags.get("--selector") ?? "",
    flags.get("--field-selector") ?? "",
    flags.has("--all") ? "all" : "",
    flags.get("--from") ?? "",
  ].join("|");

  if (verb === "create") {
    // A new object: its name is not something that already exists.
    return `create ${subcommand}|${namespace}|${selecting}`;
  }

  if (verb === "set" && subcommand === "selector") {
    operands = operands.slice(0, -1);
  }

  const updatesFromFlags: boolean =
    flags.has("-e") || flags.has("--env") || flags.has("--from");
  const pairVerb: boolean =
    verb === "label" ||
    verb === "annotate" ||
    (verb === "set" && (subcommand === "image" || subcommand === "env"));

  if (pairVerb) {
    const resources: Array<string> = [];
    let pairs: number = 0;

    for (const word of operands) {
      if (isKubectlPairWord(word)) {
        pairs++;
      } else if (pairs > 0) {
        return null; // "all resources must be specified before ... changes"
      } else {
        resources.push(word);
      }
    }

    if (pairs === 0 && !(subcommand === "env" && updatesFromFlags)) {
      return null; // "at least one ... update is required"
    }

    operands = resources;
  }

  /*
   * "KIND NAME NAME" and "KIND/NAME KIND/NAME" name the same objects; the
   * node verbs name nodes.
   */
  const objects: Array<string> =
    verb === "cordon" || verb === "uncordon"
      ? [...operands]
      : operands.length > 0 && !operands[0]!.includes("/")
        ? operands.slice(1).map((name: string) => {
            return `${operands[0]}/${name}`;
          })
        : [...operands];

  return `${verb} ${subcommand}|${namespace}|${selecting}|${objects
    .sort()
    .join(",")}`;
}

// Words an attacker (or a confused model) could put where an entry has `*`.
const SUBSTITUTES: Array<string> = [
  "web",
  "api",
  "deployment/api",
  "pod/api",
  "statefulset/db",
  "a=b",
  "web=evil:1",
  "x-",
  "{}",
  "3",
  "0",
  "prod",
  "kube-system",
  "cronjob/other",
  "cj/backup",
  "configmap/other",
];

/*
 * Verbs the allowlist never promotes, known here independently of the
 * policy: reads run anyway, and a drain or taint always needs a human.
 */
const NEVER_PROMOTED_VERBS: Array<string> = [
  "get",
  "describe",
  "logs",
  "top",
  "events",
  "explain",
  "api-resources",
  "api-versions",
  "version",
  "cluster-info",
  "auth",
  "drain",
  "taint",
];

function isNeverPromoted(entry: string): boolean {
  const words: Array<string> = argsOf(entry).filter((word: string) => {
    return !word.startsWith("-");
  });
  return (
    NEVER_PROMOTED_VERBS.includes(words[0] || "") ||
    (words[0] === "rollout" &&
      (words[1] === "status" || words[1] === "history"))
  );
}

// Deterministic PRNG (mulberry32), so a failure reproduces.
function seededRandom(seed: number): () => number {
  let state: number = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t: number = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * The commands an entry matches when each word with a `*` gets one of
 * SUBSTITUTES for its wildcards: every combination for up to two such
 * words, a seeded sample beyond that.
 */
function substitutedCommands(entry: string): Array<Array<string>> {
  const words: Array<string> = argsOf(entry);
  const wildcardAt: Array<number> = [];

  words.forEach((word: string, index: number) => {
    if (word.includes("*")) {
      wildcardAt.push(index);
    }
  });

  const fill: (choices: Array<string>) => Array<string> = (
    choices: Array<string>,
  ): Array<string> => {
    return words.map((word: string, index: number) => {
      const slot: number = wildcardAt.indexOf(index);
      return slot < 0 ? word : word.split("*").join(choices[slot]!);
    });
  };

  if (wildcardAt.length === 0) {
    return [words];
  }

  const commands: Array<Array<string>> = [];

  if (wildcardAt.length <= 2) {
    const combos: Array<Array<string>> = wildcardAt.reduce(
      (acc: Array<Array<string>>) => {
        return acc.flatMap((prefix: Array<string>) => {
          return SUBSTITUTES.map((word: string) => {
            return [...prefix, word];
          });
        });
      },
      [[]] as Array<Array<string>>,
    );
    for (const combo of combos) {
      commands.push(fill(combo));
    }
    return commands;
  }

  const random: () => number = seededRandom(wildcardAt.length * 7919);
  for (let sample: number = 0; sample < 300; sample++) {
    commands.push(
      fill(
        wildcardAt.map(() => {
          return SUBSTITUTES[Math.floor(random() * SUBSTITUTES.length)]!;
        }),
      ),
    );
  }
  return commands;
}

/*
 * Every distinct change the commands an entry matches make, over the
 * substitutions — counting only commands the policy lets run.
 */
function changesReached(entry: string): Set<string> {
  const reached: Set<string> = new Set<string>();

  for (const args of substitutedCommands(entry)) {
    // Sanity: the entry does match what was substituted into it.
    expect({
      entry,
      args,
      matched: KubectlPolicy.matchesAllowlist({
        args,
        allowlistPatterns: [entry],
      }),
    }).toEqual({ entry, args, matched: true });

    const result: KubectlPolicyResult = KubectlPolicy.evaluateArgs(args);

    if (result.tier === KubectlCommandTier.Denied) {
      continue;
    }

    const change: string | null = whatItChanges(args);

    if (change !== null) {
      reached.add(change);
    }
  }

  return reached;
}

// ---- Generated entries --------------------------------------------------------------

/*
 * Entry shapes for the generator. Upper-case placeholders are filled with a
 * literal or, sometimes, a wildcard form.
 */
const GENERATED_SHAPES: Array<Array<string>> = [
  ["delete", "KIND", "NAME"],
  ["delete", "OBJECT"],
  ["delete", "KIND", "NAME", "--grace-period=COUNT"],
  ["rollout", "restart", "OBJECT"],
  ["rollout", "undo", "KIND", "NAME", "--to-revision=COUNT"],
  ["scale", "OBJECT", "--replicas=COUNT"],
  ["scale", "--replicas", "COUNT", "OBJECT"],
  ["patch", "KIND", "NAME", "-p", "BODY"],
  ["patch", "OBJECT", "--type=json", "-p", "BODY"],
  ["label", "KIND", "NAME", "PAIR"],
  ["annotate", "OBJECT", "PAIR", "--overwrite"],
  ["set", "image", "OBJECT", "PAIR"],
  ["set", "env", "OBJECT", "PAIR"],
  ["set", "env", "OBJECT", "--from=SOURCE"],
  ["set", "resources", "OBJECT", "--limits=LIMIT"],
  ["create", "job", "NAME", "--from=SOURCE"],
  ["expose", "KIND", "NAME", "--port=COUNT"],
];

const LITERALS: Record<string, string> = {
  KIND: "deployment",
  NAME: "web",
  OBJECT: "deployment/web",
  COUNT: "2",
  BODY: '{"spec":{"replicas":2}}',
  PAIR: "web=nginx:1",
  SOURCE: "cronjob/nightly",
  LIMIT: "cpu=1",
  NS: "web",
};

const WILDCARDS: Record<string, Array<string>> = {
  KIND: ["*", "deploy*"],
  NAME: ["*", "web*"],
  OBJECT: ["*", "deployment/*", "*/web"],
  COUNT: ["*"],
  BODY: ["*"],
  PAIR: ["*", "web=*", "*=*"],
  SOURCE: ["*", "cronjob/*"],
  LIMIT: ["*", "cpu=*"],
  NS: ["*", "web-*"],
};

// The namespace flag forms kubectl accepts (and where a global flag may go).
const NAMESPACE_FORMS: Array<Array<string>> = [
  [],
  ["-n", "NS"],
  ["--namespace=NS"],
  ["-n=NS"],
  ["--namespace", "NS"],
];

function fillPlaceholder(word: string, random: () => number): string {
  const eq: number = word.indexOf("=");
  const placeholder: string = eq >= 0 ? word.slice(eq + 1) : word;

  if (!Object.prototype.hasOwnProperty.call(LITERALS, placeholder)) {
    return word;
  }

  const prefix: string = eq >= 0 ? word.slice(0, eq + 1) : "";
  const choices: Array<string> = WILDCARDS[placeholder]!;
  const value: string =
    random() < 0.3
      ? choices[Math.floor(random() * choices.length)]!
      : LITERALS[placeholder]!;
  return `${prefix}${value}`;
}

function generateEntries(count: number, seed: number): Array<string> {
  const random: () => number = seededRandom(seed);
  const entries: Array<string> = [];

  for (let n: number = 0; n < count; n++) {
    const shape: Array<string> =
      GENERATED_SHAPES[Math.floor(random() * GENERATED_SHAPES.length)]!;
    const words: Array<string> = shape.map((word: string) => {
      return fillPlaceholder(word, random);
    });

    // Sometimes an extra wildcard word among the operands.
    if (random() < 0.25) {
      const start: number = ["rollout", "set", "create"].includes(words[0]!)
        ? 2
        : 1;
      const at: number =
        start + Math.floor(random() * (words.length - start + 1));
      words.splice(at, 0, "*");
    }

    const namespaceForm: Array<string> = NAMESPACE_FORMS[
      Math.floor(random() * NAMESPACE_FORMS.length)
    ]!.map((word: string) => {
      return word.includes("NS")
        ? word.replace("NS", fillPlaceholder("NS", random))
        : word;
    });

    const beforeVerb: boolean = namespaceForm.length > 0 && random() < 0.2;
    const all: Array<string> = beforeVerb
      ? [...namespaceForm, ...words]
      : [...words, ...namespaceForm];

    entries.push(KubectlPolicy.renderDisplayCommand(all));
  }

  return entries;
}

const GENERATED_ENTRIES: Array<string> = generateEntries(400, 3953);

describe("KubectlPolicy allowlist entries: one definition of valid and broad", () => {
  it("exports the bounds the server and the AI page hold entries to", () => {
    expect(KUBECTL_ALLOWLIST_MAX_PATTERNS).toBe(100);
    expect(KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH).toBe(500);
    expect(LONGEST_VALID_ENTRY.length).toBe(
      KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH,
    );
  });

  describe("valid entries are accepted and read by the matcher", () => {
    it.each(VALID_ENTRIES)(
      "accepts %p and matches %p with it",
      (entry: string, command: string) => {
        expect(KubectlPolicy.describeAllowlistPatternProblem(entry)).toBeNull();
        expect(matches(command, entry)).toBe(true);
      },
    );
  });

  describe("invalid entries are refused, say why, and are skipped by the matcher", () => {
    it.each(INVALID_ENTRIES)(
      "refuses %p (%s)",
      (entry: unknown, says: string, wouldMatch: string | null) => {
        const problem: string | null =
          KubectlPolicy.describeAllowlistPatternProblem(entry);
        expect(problem).not.toBeNull();
        expect(problem).toContain(says);
        // The old whole-command wording must not come back.
        expect(problem).not.toContain("whole command");
        expect(KubectlPolicy.isBroadAllowlistPattern(entry)).toBe(false);

        if (wouldMatch !== null) {
          // The same words, word for word — skipped because the entry is invalid.
          expect(argsOf(wouldMatch).length).toBe(
            argsOf(entry as string).length,
          );
          expect(matches(wouldMatch, entry)).toBe(false);
          // Nothing it would have matched gets promoted through it.
          const verdict: KubectlAutoExecutionVerdict =
            KubectlPolicy.evaluateForAutoExecution({
              command: wouldMatch,
              allowlistPatterns: [entry as string],
            });
          expect(verdict.reason).not.toContain(
            "Matched the cluster's kubectl allowlist",
          );
        }
      },
    );

    it("quotes the entry as typed (trimmed) so the person can find it", () => {
      expect(
        KubectlPolicy.describeAllowlistPatternProblem("  * set image x  "),
      ).toContain('"* set image x"');
    });
  });

  describe("parity: an entry is valid exactly when the matcher reads it", () => {
    const tokenizable: Array<string> = [
      ...VALID_ENTRIES.map(([entry]: [string, string]) => {
        return entry;
      }),
      ...INVALID_ENTRIES.map(([entry]: [unknown, string, string | null]) => {
        return entry;
      }).filter((entry: unknown): entry is string => {
        return (
          typeof entry === "string" &&
          KubectlPolicy.tokenize(entry).args !== undefined &&
          entry.length <= KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH
        );
      }),
      ...BROAD_ENTRIES,
      ...NOT_BROAD_ENTRIES.filter((entry: string) => {
        return KubectlPolicy.tokenize(entry).args !== undefined;
      }),
      ...GENERATED_ENTRIES,
    ];

    it.each(tokenizable)(
      "%p matches the command it spells if and only if it is valid",
      (entry: string) => {
        // The command the entry spells, each `*` read as the word "x".
        const spelled: Array<string> = argsOf(entry).map((word: string) => {
          return word.split("*").join("x");
        });
        const valid: boolean =
          KubectlPolicy.describeAllowlistPatternProblem(entry) === null;
        expect(
          KubectlPolicy.matchesAllowlist({
            args: spelled,
            allowlistPatterns: [entry],
          }),
        ).toBe(valid);
      },
    );
  });

  describe("broad entries", () => {
    it.each(BROAD_ENTRIES)("calls %p broad", (entry: string) => {
      expect(KubectlPolicy.describeAllowlistPatternProblem(entry)).toBeNull();
      expect(KubectlPolicy.isBroadAllowlistPattern(entry)).toBe(true);
    });

    it.each(NOT_BROAD_ENTRIES)("does not call %p broad", (entry: string) => {
      expect(KubectlPolicy.isBroadAllowlistPattern(entry)).toBe(false);
    });

    it("drops a leading kubectl once, like the matcher: a doubled one is not a verb", () => {
      expect(
        KubectlPolicy.describeAllowlistPatternProblem(
          "kubectl kubectl delete * -n web",
        ),
      ).toContain("not a command OneUptime AI may run");
      expect(
        KubectlPolicy.isBroadAllowlistPattern(
          "kubectl kubectl delete * -n web",
        ),
      ).toBe(false);
      expect(
        KubectlPolicy.isBroadAllowlistPattern(
          "kubectl delete deployment * -n web",
        ),
      ).toBe(true);
      expect(
        KubectlPolicy.isBroadAllowlistPattern("delete deployment * -n web"),
      ).toBe(true);
    });

    it.each(
      BROAD_ENTRIES.filter((entry: string) => {
        // Entries whose extra reach needs words no substitute has (--all=, -A).
        return !entry.includes("--all=") && !entry.includes("-An");
      }),
    )(
      "%p really reaches more than one change (it is not a false alarm)",
      (entry: string) => {
        expect(changesReached(entry).size).toBeGreaterThan(1);
      },
    );
  });

  describe("property: a non-broad entry only ever reaches one change", () => {
    const validNotBroad: Array<string> = NOT_BROAD_ENTRIES.filter(
      (entry: string) => {
        return KubectlPolicy.describeAllowlistPatternProblem(entry) === null;
      },
    );

    it.each(
      validNotBroad.filter((entry: string) => {
        return !isNeverPromoted(entry);
      }),
    )("%p", (entry: string) => {
      const reached: Array<string> = [...changesReached(entry)];
      // Shows every change reached when there is more than one.
      expect(reached.length <= 1 ? [] : reached).toEqual([]);
    });

    it.each(validNotBroad.filter(isNeverPromoted))(
      "%p promotes nothing, however its wildcards are filled",
      (entry: string) => {
        for (const args of substitutedCommands(entry)) {
          const verdict: KubectlAutoExecutionVerdict =
            KubectlPolicy.evaluateForAutoExecution({
              command: KubectlPolicy.renderDisplayCommand(args),
              allowlistPatterns: [entry],
            });
          expect({ args, reason: verdict.reason }).not.toEqual({
            args,
            reason: "Matched the cluster's kubectl allowlist.",
          });
        }
      },
    );

    it("holds for generated entries, which cover both answers", () => {
      let broad: number = 0;
      let checked: number = 0;

      for (const entry of GENERATED_ENTRIES) {
        expect({
          entry,
          problem: KubectlPolicy.describeAllowlistPatternProblem(entry),
        }).toEqual({ entry, problem: null });

        if (KubectlPolicy.isBroadAllowlistPattern(entry)) {
          broad++;
          continue;
        }

        const reached: Array<string> = [...changesReached(entry)];
        expect({ entry, reached: reached.length <= 1 ? [] : reached }).toEqual({
          entry,
          reached: [],
        });
        checked++;
      }

      // The generator is not vacuous: plenty of each.
      expect(broad).toBeGreaterThan(80);
      expect(checked).toBeGreaterThan(80);
    });
  });
});
