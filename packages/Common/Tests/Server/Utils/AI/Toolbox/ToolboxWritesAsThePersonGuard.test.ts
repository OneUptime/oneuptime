import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import { ObservabilityTool } from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * A CHANGE THE AI ASSISTANT MAKES IS MADE AS THE PERSON WHO ASKED FOR IT.
 *
 * Every tool in the AI toolbox that changes the project makes the write the
 * dashboard makes for the same change, with the props of the person who
 * asked (ctx.props): it is held to their permissions, their labels, owners
 * and blocks and the project's plan, and it is credited to them. A tool
 * that reads a record with the person's props and then writes it as
 * OneUptime would hold the change to their read alone.
 *
 * This guard reads the toolbox's source through the TypeScript AST:
 *
 *   A. A call that may write - a method of a service (Server/Services), of
 *      WorkspaceMemberActions, of the GitHub client or of the investigation
 *      queue, other than a read (find*, count*, get*, ...) - passes
 *      `props: ctx.props`, or is in ALLOWED with the reason OneUptime makes
 *      it itself, after the person's own checks. ALLOWED only shrinks: an
 *      entry no call matches fails.
 *   B. Those modules are called through their default export only - never
 *      through a named import, an alias or a method passed around - so the
 *      scan sees every call.
 *   C. A tool that makes such a write is a mutation tool, and every
 *      mutation tool makes one: so the tools that change the project are
 *      the ones withheld in read-only chats, run only for a signed-in
 *      person (AIToolbox.executeTool) and refused in runs that offer none
 *      (ObservabilityAssistant).
 *   D. Negative controls: the scan finds a root write after a read, a write
 *      with no props, a write in a tool not marked as one, and a call it
 *      could not see.
 */

const TOOLBOX_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../../Server/Utils/AI/Toolbox",
);

// The modules the toolbox can change something through, by import path.
const WRITER_MODULES: Array<RegExp> = [
  // OneUptime's services: every database write.
  /^(?:\.\.\/)+Services\/\w+$/,
  // The member actions every chat surface shares (Slack, Teams, the AI).
  /\/Workspace\/WorkspaceMemberActions$/,
  // GitHub, through the project's GitHub App installation.
  /\/CodeRepository\/GitHub\/GitHub$/,
  // The queue AI investigations run from.
  /\/SRE\/InvestigationQueue$/,
];

// A call that only reads, by its method's name.
const READ_METHOD: RegExp = /^(?:find|count|get|aggregate|fetch)(?:[A-Z]|$)/;
const WRITE_IN_A_READ_NAME: RegExp =
  /Or(?:Create|Update|Insert)|And(?:Update|Delete)/;

// Reads named otherwise - by receiver, as written - and what they read.
const OTHER_READS: Record<string, string> = {
  "CodeRepositoryService.resolveRepositoryForException":
    "Finds the repository an exception's code lives in; writes nothing.",
  "MetricBaselineServiceClass.computeHourOfWeek":
    "Arithmetic on a date: the hour of the week a baseline is kept for; reads and writes nothing.",
  "MetricBaselineServiceClass.sigmaForSensitivity":
    "Arithmetic: how many standard deviations a sensitivity allows; reads and writes nothing.",
};

// What every write passes: the props of the person who asked.
const PERSON_PROPS: string = "ctx.props";

interface AllowedWrite {
  file: string;
  call: string;
  reason: string;
}

const GITHUB_WRITE: string =
  "GitHub is written through the project's GitHub App installation, once the person's update of the repository was checked with their props (CodeRepositoryService.findOneUpdatableById) - never on the default or a protected branch.";

/*
 * Writes OneUptime makes itself, once the person's own checks passed, by
 * file and call, and why. The list only shrinks.
 */
const ALLOWED: Array<AllowedWrite> = [
  {
    file: "AIActionTools.ts",
    call: "RunbookRuleEngineService.startRunbookFor",
    reason:
      "The run the dashboard's Run Runbook starts, written by OneUptime as that route writes it, after the same checks with the person's props: their permission to run runbooks (assertCanExecuteRunbooks), the runbooks their grant reaches (RunbookRunAccess.assertMayStart) and their read of the linked incident.",
  },
  {
    file: "AIMetaTools.ts",
    call: "AIInvestigationQueue.enqueue",
    reason:
      "An investigation run is OneUptime's own record, queued once the person's update of the incident or alert was checked with their props (findOneUpdatableById); it posts its findings as OneUptime.",
  },
  {
    file: "CodeWriteTools.ts",
    call: "GitHubUtil.createBranch",
    reason: GITHUB_WRITE,
  },
  {
    file: "CodeWriteTools.ts",
    call: "GitHubUtil.commitFilesToBranch",
    reason: GITHUB_WRITE,
  },
  {
    file: "CodeWriteTools.ts",
    call: "GitHubUtil.createPullRequestWithToken",
    reason: GITHUB_WRITE,
  },
  {
    file: "CodeWriteTools.ts",
    call: "AIAgentTaskPullRequestService.create",
    reason:
      "OneUptime's record of the pull request it opened on GitHub (members hold no create permission on it), written once the person's update of the repository was checked with their props.",
  },
];

interface WriteCall {
  file: string;
  line: number;
  // As written: "IncidentService.updateOneById".
  call: string;
  passesPersonProps: boolean;
  // The top-level declaration the call is made in.
  declaredIn: string | undefined;
}

interface ToolDeclaration {
  file: string;
  variable: string;
  name: string | undefined;
  isMutation: boolean;
}

interface FileScan {
  file: string;
  writes: Array<WriteCall>;
  tools: Array<ToolDeclaration>;
  // The top-level names each top-level declaration refers to.
  references: Map<string, Set<string>>;
  // Rule B: calls the scan cannot see.
  unseenCalls: Array<string>;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function isInsideImport(node: ts.Node): boolean {
  for (
    let ancestor: ts.Node | undefined = node.parent;
    ancestor;
    ancestor = ancestor.parent
  ) {
    if (ts.isImportDeclaration(ancestor)) {
      return true;
    }
  }

  return false;
}

// The name of the top-level declaration a node sits in.
function declaredIn(node: ts.Node): string | undefined {
  let current: ts.Node = node;

  while (current.parent && !ts.isSourceFile(current.parent)) {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isVariableDeclarationList(current.parent) &&
      ts.isVariableStatement(current.parent.parent) &&
      ts.isSourceFile(current.parent.parent.parent) &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }

    current = current.parent;
  }

  if (
    (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) &&
    current.name
  ) {
    return current.name.text;
  }

  return undefined;
}

// The OTHER_READS entries a scan met.
const OTHER_READS_MET: Set<string> = new Set<string>();

function isReadMethod(receiver: string, method: string): boolean {
  const call: string = `${receiver}.${method}`;

  if (OTHER_READS[call]) {
    OTHER_READS_MET.add(call);
    return true;
  }

  return READ_METHOD.test(method) && !WRITE_IN_A_READ_NAME.test(method);
}

function passesPersonProps(call: ts.CallExpression): boolean {
  const options: ts.Expression | undefined = call.arguments[0];

  if (!options || !ts.isObjectLiteralExpression(options)) {
    return false;
  }

  return options.properties.some((property: ts.ObjectLiteralElement) => {
    return (
      ts.isPropertyAssignment(property) &&
      property.name.getText() === "props" &&
      property.initializer.getText() === PERSON_PROPS
    );
  });
}

function toolOf(
  file: string,
  declaration: ts.VariableDeclaration,
): ToolDeclaration | null {
  if (
    !ts.isIdentifier(declaration.name) ||
    declaration.type?.getText() !== "ObservabilityTool" ||
    !declaration.initializer ||
    !ts.isObjectLiteralExpression(declaration.initializer)
  ) {
    return null;
  }

  let name: string | undefined = undefined;
  let isMutation: boolean = false;

  for (const property of declaration.initializer.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    if (
      property.name.getText() === "name" &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      name = property.initializer.text;
    }

    if (property.name.getText() === "isMutation") {
      isMutation = property.initializer.kind === ts.SyntaxKind.TrueKeyword;
    }
  }

  return {
    file: file,
    variable: declaration.name.text,
    name: name,
    isMutation: isMutation,
  };
}

function scanSource(file: string, sourceText: string): FileScan {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const writers: Set<string> = new Set<string>();
  const namedFromWriters: Set<string> = new Set<string>();
  const unseenCalls: Array<string> = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const specifier: string = statement.moduleSpecifier.text;

    if (
      !WRITER_MODULES.some((pattern: RegExp): boolean => {
        return pattern.test(specifier);
      })
    ) {
      continue;
    }

    const clause: ts.ImportClause | undefined = statement.importClause;

    if (clause?.name) {
      writers.add(clause.name.text);
    }

    if (clause?.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        unseenCalls.push(
          `${file}:${lineOf(sourceFile, statement)}: imports ${specifier} as a namespace - import its default export`,
        );
      } else {
        for (const element of clause.namedBindings.elements) {
          namedFromWriters.add(element.name.text);
        }
      }
    }
  }

  // The top-level declarations, and the top-level names each refers to.
  const topLevel: Map<string, ts.Node> = new Map<string, ts.Node>();
  const tools: Array<ToolDeclaration> = [];

  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      topLevel.set(statement.name.text, statement);
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          topLevel.set(declaration.name.text, declaration);
        }

        const tool: ToolDeclaration | null = toolOf(file, declaration);

        if (tool) {
          tools.push(tool);
        }
      }
    }
  }

  const references: Map<string, Set<string>> = new Map<string, Set<string>>();

  for (const [name, node] of topLevel) {
    const referred: Set<string> = new Set<string>();

    const collect: (child: ts.Node) => void = (child: ts.Node): void => {
      if (ts.isIdentifier(child) && topLevel.has(child.text)) {
        referred.add(child.text);
      }

      ts.forEachChild(child, collect);
    };

    ts.forEachChild(node, collect);
    references.set(name, referred);
  }

  const writes: Array<WriteCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isInsideImport(node)) {
      const parent: ts.Node = node.parent;
      const isReceiver: boolean =
        ts.isPropertyAccessExpression(parent) && parent.expression === node;
      const isCalledMethod: boolean =
        isReceiver &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent;

      if (writers.has(node.text)) {
        if (isCalledMethod) {
          const method: string = (parent as ts.PropertyAccessExpression).name
            .text;

          if (!isReadMethod(node.text, method)) {
            writes.push({
              file: file,
              line: lineOf(sourceFile, node),
              call: `${node.text}.${method}`,
              passesPersonProps: passesPersonProps(
                parent.parent as ts.CallExpression,
              ),
              declaredIn: declaredIn(node),
            });
          }
        } else {
          unseenCalls.push(
            `${file}:${lineOf(sourceFile, node)}: uses ${parent.getText()} other than to call one of ${node.text}'s methods - call it there`,
          );
        }
      }

      if (namedFromWriters.has(node.text)) {
        // A static read on a named class is a read; anything else is unseen.
        const isCalled: boolean =
          (ts.isCallExpression(parent) && parent.expression === node) ||
          (ts.isNewExpression(parent) && parent.expression === node) ||
          (isCalledMethod &&
            !isReadMethod(
              node.text,
              (parent as ts.PropertyAccessExpression).name.text,
            ));

        if (isCalled) {
          unseenCalls.push(
            `${file}:${lineOf(sourceFile, node)}: calls ${node.text}, imported by name from a module the toolbox writes through - call its default export`,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    file: file,
    writes: writes,
    tools: tools,
    references: references,
    unseenCalls: unseenCalls,
  };
}

// The tools of a file whose code reaches a top-level declaration.
function toolsReaching(scan: FileScan, name: string): Array<ToolDeclaration> {
  return scan.tools.filter((tool: ToolDeclaration): boolean => {
    const seen: Set<string> = new Set<string>([tool.variable]);
    const queue: Array<string> = [tool.variable];

    while (queue.length > 0) {
      const current: string = queue.shift()!;

      if (current === name) {
        return true;
      }

      for (const referred of scan.references.get(current) || []) {
        if (!seen.has(referred)) {
          seen.add(referred);
          queue.push(referred);
        }
      }
    }

    return false;
  });
}

interface GuardResult {
  // Rule A: writes made with other props than the person's.
  notAsThePerson: Array<string>;
  // Rule C: writes in code that is not a mutation tool's.
  notAMutationTool: Array<string>;
  // Rule B.
  unseenCalls: Array<string>;
  // The names of the tools that write.
  writingTools: Array<string>;
  // ALLOWED entries no write matched.
  staleAllowed: Array<string>;
}

function check(
  scans: Array<FileScan>,
  allowed: Array<AllowedWrite>,
): GuardResult {
  const used: Set<AllowedWrite> = new Set<AllowedWrite>();
  const writingTools: Set<string> = new Set<string>();
  const result: GuardResult = {
    notAsThePerson: [],
    notAMutationTool: [],
    unseenCalls: [],
    writingTools: [],
    staleAllowed: [],
  };

  for (const scan of scans) {
    result.unseenCalls.push(...scan.unseenCalls);

    for (const write of scan.writes) {
      const where: string = `${write.file}:${write.line}: ${write.call}`;
      const allowance: AllowedWrite | undefined = allowed.find(
        (entry: AllowedWrite): boolean => {
          return entry.file === write.file && entry.call === write.call;
        },
      );

      if (allowance) {
        used.add(allowance);
      } else if (!write.passesPersonProps) {
        result.notAsThePerson.push(
          `${where} - pass props: ${PERSON_PROPS}, the person's own props, so the dashboard's checks hold the change`,
        );
      }

      const tools: Array<ToolDeclaration> = write.declaredIn
        ? toolsReaching(scan, write.declaredIn)
        : [];

      if (tools.length === 0) {
        result.notAMutationTool.push(
          `${where} - made by no tool of ${write.file}; make the write in a tool marked isMutation: true`,
        );
      }

      for (const tool of tools) {
        if (!tool.isMutation) {
          result.notAMutationTool.push(
            `${where} - ${tool.name || tool.variable} changes the project, so it must be marked isMutation: true`,
          );
        }

        writingTools.add(tool.name || tool.variable);
      }
    }
  }

  result.writingTools = [...writingTools].sort();
  result.staleAllowed = allowed
    .filter((entry: AllowedWrite): boolean => {
      return !used.has(entry);
    })
    .map((entry: AllowedWrite): string => {
      return `${entry.file}: ${entry.call} - no longer made there; remove it from ALLOWED`;
    });

  return result;
}

function scanToolbox(): Array<FileScan> {
  return fs
    .readdirSync(TOOLBOX_DIRECTORY)
    .filter((name: string): boolean => {
      return name.endsWith(".ts") && !name.endsWith(".d.ts");
    })
    .sort()
    .map((name: string): FileScan => {
      return scanSource(
        name,
        fs.readFileSync(path.join(TOOLBOX_DIRECTORY, name), "utf8"),
      );
    });
}

describe("a change the AI assistant makes is made as the person who asked for it", () => {
  const scans: Array<FileScan> = scanToolbox();
  const result: GuardResult = check(scans, ALLOWED);

  test("the scan reads the toolbox and finds its writes", () => {
    expect(
      scans.map((scan: FileScan): string => {
        return scan.file;
      }),
    ).toEqual(
      expect.arrayContaining([
        "IncidentWriteTools.ts",
        "AlertWriteTools.ts",
        "AIActionTools.ts",
        "NoteWriteTools.ts",
        "AIMetaTools.ts",
        "CodeWriteTools.ts",
      ]),
    );

    const calls: Array<string> = scans.flatMap(
      (scan: FileScan): Array<string> => {
        return scan.writes.map((write: WriteCall): string => {
          return `${write.file}: ${write.call}`;
        });
      },
    );

    expect(calls).toEqual(
      expect.arrayContaining([
        "IncidentWriteTools.ts: WorkspaceMemberActions.acknowledge",
        "IncidentWriteTools.ts: WorkspaceMemberActions.resolve",
        "AlertWriteTools.ts: WorkspaceMemberActions.acknowledge",
        "AlertWriteTools.ts: WorkspaceMemberActions.resolve",
        "AIActionTools.ts: WorkspaceMemberActions.executeOnCallPolicy",
        "AIActionTools.ts: IncidentService.updateOneById",
        "IncidentWriteTools.ts: IncidentService.create",
      ]),
    );
  });

  test("A: every write passes the props of the person who asked", () => {
    expect(result.notAsThePerson).toEqual([]);
  });

  test("A: every allowed write is still made (the list only shrinks)", () => {
    expect(result.staleAllowed).toEqual([]);
  });

  test("A: every read named otherwise is still made (the list only shrinks)", () => {
    expect(
      Object.keys(OTHER_READS).filter((call: string): boolean => {
        return !OTHER_READS_MET.has(call);
      }),
    ).toEqual([]);
  });

  test("A: every allowed write says why OneUptime makes it", () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  test("B: every call to a module the toolbox writes through is seen", () => {
    expect(result.unseenCalls).toEqual([]);
  });

  test("C: every write is made by a tool marked as one that changes the project", () => {
    expect(result.notAMutationTool).toEqual([]);
  });

  test("C: the tools that write are exactly the toolbox's mutation tools", () => {
    const mutationTools: Array<string> = AIToolbox.getTools()
      .filter((tool: ObservabilityTool): boolean => {
        return Boolean(tool.isMutation);
      })
      .map((tool: ObservabilityTool): string => {
        return tool.name;
      })
      .sort();

    expect(mutationTools.length).toBeGreaterThan(0);
    expect(result.writingTools).toEqual(mutationTools);
  });
});

describe("the scan's negative controls", () => {
  const SERVICE_IMPORT: string =
    'import IncidentService from "../../../Services/IncidentService";\n';
  const MEMBER_ACTIONS_IMPORT: string =
    'import WorkspaceMemberActions, { WorkspaceEventType } from "../../Workspace/WorkspaceMemberActions";\n';

  function checkSnippet(source: string): GuardResult {
    return check([scanSource("Snippet.ts", source)], []);
  }

  test("D: finds a write made as OneUptime after a read made as the person", () => {
    const result: GuardResult = checkSnippet(
      SERVICE_IMPORT +
        `export const ChangeTool: ObservabilityTool = {
  name: "change_incident",
  isMutation: true,
  execute: async (args: JSONObject, ctx: ToolContext) => {
    const incident = await IncidentService.findOneById({ id: args.id, select: { _id: true }, props: ctx.props });
    await IncidentService.updateOneById({ id: incident.id, data: { title: "x" }, props: { isRoot: true } });
  },
};
`,
    );

    expect(result.notAsThePerson).toHaveLength(1);
    expect(result.notAsThePerson[0]).toContain(
      "Snippet.ts:7: IncidentService.updateOneById",
    );
    expect(result.notAMutationTool).toEqual([]);
  });

  test("D: finds a write that passes no props", () => {
    const result: GuardResult = checkSnippet(
      MEMBER_ACTIONS_IMPORT +
        `export const AckTool: ObservabilityTool = {
  name: "ack",
  isMutation: true,
  execute: async (args: JSONObject, ctx: ToolContext) => {
    await WorkspaceMemberActions.acknowledge({ event: { type: WorkspaceEventType.Incident, id: args.id } });
  },
};
`,
    );

    expect(result.notAsThePerson).toHaveLength(1);
    expect(result.notAsThePerson[0]).toContain(
      "WorkspaceMemberActions.acknowledge",
    );
  });

  test("D: finds a write, made through a helper, in a tool not marked as one that changes the project", () => {
    const result: GuardResult = checkSnippet(
      MEMBER_ACTIONS_IMPORT +
        `async function acknowledgeFor(args: JSONObject, ctx: ToolContext): Promise<void> {
  await WorkspaceMemberActions.acknowledge({ event: { type: WorkspaceEventType.Incident, id: args.id }, props: ctx.props });
}

export const LookTool: ObservabilityTool = {
  name: "look",
  isMutation: false,
  execute: async (args: JSONObject, ctx: ToolContext) => {
    await acknowledgeFor(args, ctx);
  },
};
`,
    );

    expect(result.notAsThePerson).toEqual([]);
    expect(result.notAMutationTool).toEqual([
      "Snippet.ts:3: WorkspaceMemberActions.acknowledge - look changes the project, so it must be marked isMutation: true",
    ]);
    expect(result.writingTools).toEqual(["look"]);
  });

  test("D: finds calls it could not see - an alias, a method passed on, a named import called", () => {
    const result: GuardResult = checkSnippet(
      'import IncidentService, { Service as IncidentServiceClass } from "../../../Services/IncidentService";\n' +
        `const service = IncidentService;
const update = IncidentService.updateOneById;
export const SneakyTool: ObservabilityTool = {
  name: "sneaky",
  isMutation: true,
  execute: async () => {
    await new IncidentServiceClass().updateOneById({});
  },
};
`,
    );

    expect(result.unseenCalls).toHaveLength(3);
    expect(result.unseenCalls[0]).toContain("Snippet.ts:2: uses");
    expect(result.unseenCalls[1]).toContain(
      "Snippet.ts:3: uses IncidentService.updateOneById",
    );
    expect(result.unseenCalls[2]).toContain(
      "Snippet.ts:8: calls IncidentServiceClass",
    );
  });

  test("D: lets a read, and a write as the person in a mutation tool, through", () => {
    const result: GuardResult = checkSnippet(
      SERVICE_IMPORT +
        MEMBER_ACTIONS_IMPORT +
        `export const ResolveTool: ObservabilityTool = {
  name: "resolve_incident",
  isMutation: true,
  execute: async (args: JSONObject, ctx: ToolContext) => {
    await IncidentService.findOneById({ id: args.id, select: { _id: true }, props: ctx.props });
    await WorkspaceMemberActions.resolve({ event: { type: WorkspaceEventType.Incident, id: args.id }, props: ctx.props });
  },
};
`,
    );

    expect(result.notAsThePerson).toEqual([]);
    expect(result.notAMutationTool).toEqual([]);
    expect(result.unseenCalls).toEqual([]);
    expect(result.writingTools).toEqual(["resolve_incident"]);
  });
});
