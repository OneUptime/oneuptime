import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The oneuptime CLI's commands, read from its sources (packages/CLI) the way
 * Commander will build them, for the docs suites that hold the CLI pages to
 * the CLI: CliDocsFacts. The docs suite cannot load the CLI (its Commander,
 * chalk and cli-table3 are the CLI package's own dependencies, which App's
 * tests do not install), so it parses the sources with TypeScript and
 * follows each chain of Commander calls:
 *
 *   program.command("login").argument("<api-key>", "...")
 *     .option("--context-name <name>", "...", "default")
 *
 * A command's parent is the receiver of its .command() call: `program`, or a
 * variable that holds a command (`contextCmd`, `resourceCmd`). A resource
 * command is created with a name taken from the model (`resource.name`), so
 * it is named "<resource>", as the docs write it. Which operations a record
 * and a telemetry resource get is read from registerResourceCommands, whose
 * `resource.modelType === "..."` branches call one register function per
 * operation.
 *
 * The CLI's own suite (packages/CLI/Tests/CommandReferenceDocs) holds the
 * same pages to the program Commander really builds, Commander's built-in
 * -V/--version, -h/--help and help command included; so a reading here that
 * drifted from the program would fail there.
 *
 * Kept out of the .test.ts files: importing one runs its tests.
 */

export const CLI_DIR: string = path.resolve(__dirname, "../../../../CLI");

// The sources that build the program, by their paths from packages/CLI.
export const CLI_PROGRAM_SOURCES: ReadonlyArray<string> = [
  "Program.ts",
  "Commands/ConfigCommands.ts",
  "Commands/UtilityCommands.ts",
  "Commands/ResourceCommands.ts",
  "Commands/DeployCommands.ts",
];

// What Commander adds to every program built with .version() and help on.
export const COMMANDER_VERSION_FLAGS: string = "-V, --version";
export const COMMANDER_HELP_FLAGS: string = "-h, --help";
// The help command Commander adds to a program that has commands.
export const COMMANDER_HELP_COMMAND: string = "help";

export interface CliOption {
  flags: string;
  // The default a .option() call gives, as written: "10", "default".
  defaultValue: string | null;
  // Declared with .requiredOption().
  required: boolean;
}

export interface CliCommand {
  // The words after "oneuptime": "login", "context use", "<resource> list".
  path: string;
  // As the .command() spec and .argument() calls write them: "<name>".
  arguments: Array<string>;
  options: Array<CliOption>;
}

export interface CliProgram {
  globalOptions: Array<CliOption>;
  commands: Array<CliCommand>;
  // The operations a record ("database") and telemetry ("analytics") get.
  operationsByType: Record<string, Array<string>>;
}

interface ChainedCall {
  method: string;
  args: ReadonlyArray<ts.Expression>;
}

function parse(relativePath: string): ts.SourceFile {
  const file: string = path.join(CLI_DIR, relativePath);

  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

// A string literal's text, or null for anything else.
function literal(node: ts.Node | undefined): string | null {
  if (
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }

  return null;
}

function everyNode(root: ts.Node): Array<ts.Node> {
  const found: Array<ts.Node> = [];
  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    found.push(node);
    ts.forEachChild(node, visit);
  };

  visit(root);
  return found;
}

// A call of a method by name: x.command(...), x.option(...).
function isMethodCall(
  node: ts.Node,
  method: string,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === method
  );
}

/*
 * The calls chained onto a call, outwards:
 * x.command("a").option(...).action(...) gives option, then action.
 */
function callsChainedOnto(call: ts.CallExpression): Array<ChainedCall> {
  const chained: Array<ChainedCall> = [];
  let node: ts.Node = call;

  while (
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.expression === node &&
    ts.isCallExpression(node.parent.parent) &&
    node.parent.parent.expression === node.parent
  ) {
    chained.push({
      method: node.parent.name.text,
      args: node.parent.parent.arguments,
    });
    node = node.parent.parent;
  }

  return chained;
}

/*
 * A chain of calls from its receiver: program.name("x").option(...) gives
 * the identifier program and the calls name, then option.
 */
function chainFromReceiver(expression: ts.Expression): {
  receiver: ts.Expression;
  calls: Array<ChainedCall>;
} {
  const calls: Array<ChainedCall> = [];
  let node: ts.Expression = expression;

  while (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression)
  ) {
    calls.unshift({ method: node.expression.name.text, args: node.arguments });
    node = node.expression.expression;
  }

  return { receiver: node, calls: calls };
}

/*
 * The flags of the output option every command that prints records adds
 * with .addOption(createOutputOption()): the first argument of the Option
 * that createOutputOption builds in Core/OutputFormatter.ts.
 */
export function outputOptionFlags(): string {
  const source: ts.SourceFile = parse("Core/OutputFormatter.ts");

  for (const node of everyNode(source)) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "createOutputOption"
    ) {
      for (const inner of everyNode(node)) {
        if (
          ts.isNewExpression(inner) &&
          ts.isIdentifier(inner.expression) &&
          inner.expression.text === "Option"
        ) {
          const flags: string | null = literal(inner.arguments?.[0]);

          if (flags) {
            return flags;
          }
        }
      }
    }
  }

  throw new Error("createOutputOption builds no Option with literal flags");
}

// The options a chain of calls declares.
function optionsOf(calls: Array<ChainedCall>): Array<CliOption> {
  const options: Array<CliOption> = [];

  for (const call of calls) {
    if (call.method === "option" || call.method === "requiredOption") {
      const flags: string | null = literal(call.args[0]);

      if (!flags) {
        throw new Error(`An .${call.method}() has no literal flags`);
      }

      options.push({
        flags: flags,
        defaultValue: literal(call.args[2]),
        required: call.method === "requiredOption",
      });
    }

    if (call.method === "addOption") {
      const added: ts.Expression | undefined = call.args[0];

      if (
        !added ||
        !ts.isCallExpression(added) ||
        !ts.isIdentifier(added.expression) ||
        added.expression.text !== "createOutputOption"
      ) {
        throw new Error(
          "An .addOption() adds something else than the output option",
        );
      }

      options.push({
        flags: outputOptionFlags(),
        defaultValue: null,
        required: false,
      });
    }
  }

  return options;
}

/*
 * What a variable that holds a command stands for, by its declaration:
 * const contextCmd: Command = program.command("context")... is "context";
 * const resourceCmd: Command = program.command(resource.name)... is
 * "<resource>". Null for `program` and anything that is not a command.
 */
function commandVariables(
  sources: Array<ts.SourceFile>,
): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const source of sources) {
    for (const node of everyNode(source)) {
      if (
        !ts.isVariableDeclaration(node) ||
        !ts.isIdentifier(node.name) ||
        !node.initializer
      ) {
        continue;
      }

      const chain: { receiver: ts.Expression; calls: Array<ChainedCall> } =
        chainFromReceiver(node.initializer);
      const command: ChainedCall | undefined = chain.calls.find(
        (call: ChainedCall): boolean => {
          return call.method === "command";
        },
      );

      if (command) {
        variables[node.name.text] =
          literal(command.args[0])?.split(" ")[0] || "<resource>";
      }
    }
  }

  return variables;
}

// The subcommand a register function adds: registerListCommand adds "list".
function subcommandOf(source: ts.SourceFile, functionName: string): string {
  for (const node of everyNode(source)) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      for (const inner of everyNode(node)) {
        if (isMethodCall(inner, "command")) {
          const spec: string | null = literal(inner.arguments[0]);

          if (spec) {
            return spec.split(" ")[0] as string;
          }
        }
      }
    }
  }

  throw new Error(`${functionName} adds no command`);
}

/*
 * The operations registerResourceCommands gives each type of resource:
 * the register functions each `resource.modelType === "<type>"` branch calls.
 */
function operationsByType(
  source: ts.SourceFile,
): Record<string, Array<string>> {
  const byType: Record<string, Array<string>> = {};

  for (const node of everyNode(source)) {
    if (
      !ts.isFunctionDeclaration(node) ||
      node.name?.text !== "registerResourceCommands"
    ) {
      continue;
    }

    for (const inner of everyNode(node)) {
      if (
        !ts.isIfStatement(inner) ||
        !ts.isBinaryExpression(inner.expression) ||
        inner.expression.operatorToken.kind !==
          ts.SyntaxKind.EqualsEqualsEqualsToken ||
        inner.expression.left.getText() !== "resource.modelType"
      ) {
        continue;
      }

      const type: string | null = literal(inner.expression.right);

      if (!type) {
        throw new Error("A resource type branch compares with no literal");
      }

      byType[type] = everyNode(inner.thenStatement)
        .filter((call: ts.Node): call is ts.CallExpression => {
          return (
            ts.isCallExpression(call) &&
            ts.isIdentifier(call.expression) &&
            call.expression.text.startsWith("register")
          );
        })
        .map((call: ts.CallExpression): string => {
          return subcommandOf(source, (call.expression as ts.Identifier).text);
        });
    }
  }

  return byType;
}

// The program's options: the chain of calls on `program` in Program.ts.
function globalOptionsOf(source: ts.SourceFile): Array<CliOption> {
  for (const node of everyNode(source)) {
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression)
    ) {
      const chain: { receiver: ts.Expression; calls: Array<ChainedCall> } =
        chainFromReceiver(node.expression);

      if (
        ts.isIdentifier(chain.receiver) &&
        chain.receiver.text === "program" &&
        chain.calls.some((call: ChainedCall): boolean => {
          return call.method === "option" || call.method === "addOption";
        })
      ) {
        const options: Array<CliOption> = optionsOf(chain.calls);

        if (
          chain.calls.some((call: ChainedCall): boolean => {
            return call.method === "version" && call.args.length === 1;
          })
        ) {
          options.unshift({
            flags: COMMANDER_VERSION_FLAGS,
            defaultValue: null,
            required: false,
          });
        }

        options.push({
          flags: COMMANDER_HELP_FLAGS,
          defaultValue: null,
          required: false,
        });

        return options;
      }
    }
  }

  throw new Error("Program.ts declares no options on program");
}

/*
 * Every command the CLI's sources build, by the words a reader types after
 * "oneuptime", with its arguments and options. A command that only groups
 * others ("context", "<resource>") is not one of them: its subcommands are.
 */
export function readCliProgram(): CliProgram {
  const sources: Array<ts.SourceFile> = CLI_PROGRAM_SOURCES.map(parse);
  const variables: Record<string, string> = commandVariables(sources);
  const commands: Array<CliCommand> = [];
  const commandCalls: Array<ts.CallExpression> = sources.flatMap(
    (source: ts.SourceFile): Array<ts.CallExpression> => {
      return everyNode(source).filter(
        (node: ts.Node): node is ts.CallExpression => {
          return isMethodCall(node, "command");
        },
      );
    },
  );
  const receiverOf: (call: ts.CallExpression) => ts.Identifier = (
    call: ts.CallExpression,
  ): ts.Identifier => {
    const receiver: ts.Expression = (
      call.expression as ts.PropertyAccessExpression
    ).expression;

    if (!ts.isIdentifier(receiver)) {
      throw new Error(`A .command() is called on ${receiver.getText()}`);
    }

    return receiver;
  };
  // The commands that hold others: those a .command() is called on.
  const groups: Set<string> = new Set(
    commandCalls
      .map((call: ts.CallExpression): string | undefined => {
        return variables[receiverOf(call).text];
      })
      .filter((group: string | undefined): group is string => {
        return group !== undefined;
      }),
  );

  for (const node of commandCalls) {
    const receiver: ts.Identifier = receiverOf(node);
    const parent: string | undefined =
      receiver.text === "program" ? "" : variables[receiver.text];

    if (parent === undefined) {
      throw new Error(`${receiver.text} holds no known command`);
    }

    const spec: string = literal(node.arguments[0]) || "<resource>";
    const [name, ...specArguments] = spec.split(" ") as [
      string,
      ...Array<string>,
    ];

    if (parent === "" && groups.has(name)) {
      continue;
    }

    const chained: Array<ChainedCall> = callsChainedOnto(node);

    commands.push({
      path: parent ? `${parent} ${name}` : name,
      arguments: [
        ...specArguments,
        ...chained
          .filter((call: ChainedCall): boolean => {
            return call.method === "argument";
          })
          .map((call: ChainedCall): string => {
            return literal(call.args[0]) as string;
          }),
      ],
      options: optionsOf(chained),
    });
  }

  commands.push({
    path: COMMANDER_HELP_COMMAND,
    arguments: ["[command]"],
    options: [],
  });

  return {
    globalOptions: globalOptionsOf(sources[0] as ts.SourceFile),
    commands: commands,
    operationsByType: operationsByType(sources[3] as ts.SourceFile),
  };
}
