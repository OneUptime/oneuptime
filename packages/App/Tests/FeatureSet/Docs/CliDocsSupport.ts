import {
  CLI_FIELDS_SUBCOMMAND,
  CLI_STATE_MACHINES,
  CliAction,
  CliOperation,
  CliStateChange,
  CliStateMachine,
} from "Common/Utils/DeveloperDocs/CliCommands";
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
 * variable that holds a command (`contextCmd`).
 *
 * A resource's subcommands are made by a register function each
 * (Commands/ResourceCommands.ts, Commands/ActionCommands.ts): the
 * operations by the one OPERATION_COMMANDS names for them, `fields` by
 * registerFieldsCommand, and the actions - what the dashboard's buttons do
 * - by registerStateChangeCommand and registerAddNoteCommand. Their names
 * are Common's (CliOperation, CLI_FIELDS_SUBCOMMAND, CliAction), which this
 * reads from there, and each is written "<resource> <name>", as the docs
 * write them. An option one of them adds inside an `if` is one only some
 * resources have (`--all`, records only; `--public`, records with public
 * notes). The field flags of a create and an update are a resource's own,
 * read from its model as the command runs (Utils/FieldFlags.ts): the docs
 * write them as `--<field> <value>`.
 *
 * The CLI's own suite (packages/CLI/Tests/CommandReferenceDocs) holds the
 * same pages to the program Commander really builds, Commander's built-in
 * -V/--version, -h/--help and help command included; so a reading here that
 * drifted from the program would fail there.
 *
 * Kept out of the .test.ts files: importing one runs its tests.
 */

export const CLI_DIR: string = path.resolve(__dirname, "../../../../CLI");

// The sources that build the program's own commands, by their paths from packages/CLI.
export const CLI_PROGRAM_SOURCES: ReadonlyArray<string> = [
  "Program.ts",
  "Commands/ConfigCommands.ts",
  "Commands/UtilityCommands.ts",
  "Commands/DeployCommands.ts",
];

// The sources that build every resource's subcommands.
export const CLI_RESOURCE_SOURCES: ReadonlyArray<string> = [
  "Commands/ResourceCommands.ts",
  "Commands/ActionCommands.ts",
];

// What Commander adds to every program built with .version() and help on.
export const COMMANDER_VERSION_FLAGS: string = "-V, --version";
export const COMMANDER_HELP_FLAGS: string = "-h, --help";
// The help command Commander adds to a program that has commands.
export const COMMANDER_HELP_COMMAND: string = "help";

// How the docs write a resource's command.
export const RESOURCE_COMMAND: string = "<resource>";

export interface CliOption {
  flags: string;
  // The default a .option() call gives, as written: "10", "default".
  defaultValue: string | null;
  // Declared with .requiredOption().
  required: boolean;
  // Added inside an `if`: only some resources' commands have it.
  onlySome: boolean;
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

// The flags of the Option a function of Core/OutputFormatter.ts builds.
function builtOptionFlags(functionName: string): string {
  const source: ts.SourceFile = parse("Core/OutputFormatter.ts");

  for (const node of everyNode(source)) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
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

  throw new Error(`${functionName} builds no Option with literal flags`);
}

/*
 * The flags of the output option every command adds with
 * .addOption(createOutputOption()).
 */
export function outputOptionFlags(): string {
  return builtOptionFlags("createOutputOption");
}

// The flags of the --json option every command adds with .addOption(createJsonOption()).
export function jsonOptionFlags(): string {
  return builtOptionFlags("createJsonOption");
}

// The options every command takes, documented once, with the global ones.
export function everyCommandsOptionFlags(): Array<string> {
  return [outputOptionFlags(), jsonOptionFlags()];
}

/*
 * The flags an .addOption() adds: the output option, the --json option, or
 * a `new Option("--all", ...)` with calls chained onto it.
 */
function addedOptionFlags(added: ts.Expression | undefined): string {
  if (
    added &&
    ts.isCallExpression(added) &&
    ts.isIdentifier(added.expression)
  ) {
    if (added.expression.text === "createOutputOption") {
      return outputOptionFlags();
    }

    if (added.expression.text === "createJsonOption") {
      return jsonOptionFlags();
    }
  }

  if (added) {
    const { receiver } = chainFromReceiver(added);

    if (
      ts.isNewExpression(receiver) &&
      ts.isIdentifier(receiver.expression) &&
      receiver.expression.text === "Option"
    ) {
      const flags: string | null = literal(receiver.arguments?.[0]);

      if (flags) {
        return flags;
      }
    }
  }

  throw new Error(
    `An .addOption() adds what this reading does not know: ${added?.getText()}`,
  );
}

// The option one .option(), .requiredOption() or .addOption() call declares.
function optionOf(call: ChainedCall, onlySome: boolean): CliOption | null {
  if (call.method === "option" || call.method === "requiredOption") {
    const flags: string | null = literal(call.args[0]);

    if (!flags) {
      throw new Error(`An .${call.method}() has no literal flags`);
    }

    return {
      flags: flags,
      defaultValue: literal(call.args[2]),
      required: call.method === "requiredOption",
      onlySome,
    };
  }

  if (call.method === "addOption") {
    return {
      flags: addedOptionFlags(call.args[0]),
      defaultValue: null,
      required: false,
      onlySome,
    };
  }

  return null;
}

// The options a chain of calls declares.
function optionsOf(calls: Array<ChainedCall>): Array<CliOption> {
  return calls
    .map((call: ChainedCall): CliOption | null => {
      return optionOf(call, false);
    })
    .filter((option: CliOption | null): option is CliOption => {
      return option !== null;
    });
}

/*
 * What a variable that holds a command stands for, by its declaration:
 * const contextCmd: Command = program.command("context")... is "context".
 * Null for `program` and anything that is not a command.
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
      const name: string | null = command ? literal(command.args[0]) : null;

      if (name) {
        variables[node.name.text] = name.split(" ")[0] as string;
      }
    }
  }

  return variables;
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
            onlySome: false,
          });
        }

        options.push({
          flags: COMMANDER_HELP_FLAGS,
          defaultValue: null,
          required: false,
          onlySome: false,
        });

        return options;
      }
    }
  }

  throw new Error("Program.ts declares no options on program");
}

// The program's own commands: login, the context commands, deploy and the rest.
function programCommands(sources: Array<ts.SourceFile>): Array<CliCommand> {
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

    const spec: string | null = literal(node.arguments[0]);

    if (!spec) {
      throw new Error(`A .command() of ${receiver.text} has no literal name`);
    }

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

  return commands;
}

function functionNamed(
  sources: Array<ts.SourceFile>,
  name: string,
): ts.FunctionDeclaration {
  for (const source of sources) {
    for (const node of everyNode(source)) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
        return node;
      }
    }
  }

  throw new Error(`The CLI's sources have no function ${name}`);
}

// Whether a node sits inside an `if` of the function it is in.
function isInsideIf(node: ts.Node, within: ts.Node): boolean {
  for (let at: ts.Node = node.parent; at && at !== within; at = at.parent) {
    if (ts.isIfStatement(at)) {
      return true;
    }
  }

  return false;
}

/*
 * The names a .command() spec of a register function gives, with its
 * arguments: "get <id>" is get; `${CliAction.AddNote} <id>` is add-note;
 * `${change.action} <id>` is each state change's action;
 * CLI_FIELDS_SUBCOMMAND is fields.
 */
function subcommandSpecs(spec: ts.Expression): Array<Array<string>> {
  const text: string | null = literal(spec);

  if (text) {
    return [text.split(" ")];
  }

  if (ts.isIdentifier(spec) && spec.text === "CLI_FIELDS_SUBCOMMAND") {
    return [[CLI_FIELDS_SUBCOMMAND]];
  }

  if (ts.isTemplateExpression(spec) && spec.templateSpans.length === 1) {
    const span: ts.TemplateSpan = spec.templateSpans[0] as ts.TemplateSpan;
    const rest: Array<string> = span.literal.text.trim().split(" ");
    const value: string = span.expression.getText();

    if (value.startsWith("CliAction.")) {
      const member: string = value.slice("CliAction.".length);
      const action: string | undefined = (
        CliAction as unknown as Record<string, string>
      )[member];

      if (action) {
        return [[action, ...rest]];
      }
    }

    if (value === "change.action") {
      const actions: Array<string> = [];

      for (const machine of CLI_STATE_MACHINES as ReadonlyArray<CliStateMachine>) {
        for (const change of machine.changes as ReadonlyArray<CliStateChange>) {
          if (!actions.includes(change.action)) {
            actions.push(change.action);
          }
        }
      }

      return actions.map((action: string): Array<string> => {
        return [action, ...rest];
      });
    }
  }

  throw new Error(`A resource subcommand is named by ${spec.getText()}`);
}

/*
 * The subcommands one register function adds to a resource's command, each
 * with the options the function declares, in the order it declares them.
 */
function subcommandsOf(fn: ts.FunctionDeclaration): Array<CliCommand> {
  const nodes: Array<ts.Node> = everyNode(fn);
  const commandCall: ts.CallExpression | undefined = nodes.find(
    (node: ts.Node): node is ts.CallExpression => {
      return isMethodCall(node, "command");
    },
  );

  if (!commandCall || !commandCall.arguments[0]) {
    throw new Error(`${fn.name?.text} adds no command`);
  }

  const options: Array<CliOption> = nodes
    .filter((node: ts.Node): node is ts.CallExpression => {
      return (
        isMethodCall(node, "option") ||
        isMethodCall(node, "requiredOption") ||
        isMethodCall(node, "addOption")
      );
    })
    .sort((a: ts.CallExpression, b: ts.CallExpression): number => {
      return (
        (a.expression as ts.PropertyAccessExpression).name.getStart() -
        (b.expression as ts.PropertyAccessExpression).name.getStart()
      );
    })
    .map((call: ts.CallExpression): CliOption => {
      return optionOf(
        {
          method: (call.expression as ts.PropertyAccessExpression).name.text,
          args: call.arguments,
        },
        isInsideIf(call, fn),
      ) as CliOption;
    });

  return subcommandSpecs(commandCall.arguments[0]).map(
    (words: Array<string>): CliCommand => {
      const [name, ...specArguments] = words as [string, ...Array<string>];

      return {
        path: `${RESOURCE_COMMAND} ${name}`,
        arguments: specArguments,
        options: options.map((option: CliOption): CliOption => {
          return { ...option };
        }),
      };
    },
  );
}

/*
 * The register function of each operation: OPERATION_COMMANDS, the map
 * ResourceCommands.ts adds a resource's operations from.
 */
export function operationRegisterFunctions(): Record<string, string> {
  const source: ts.SourceFile = parse("Commands/ResourceCommands.ts");
  const functions: Record<string, string> = {};

  for (const node of everyNode(source)) {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== "OPERATION_COMMANDS" ||
      !node.initializer ||
      !ts.isObjectLiteralExpression(node.initializer)
    ) {
      continue;
    }

    for (const property of node.initializer.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !ts.isComputedPropertyName(property.name) ||
        !ts.isIdentifier(property.initializer)
      ) {
        throw new Error(
          "OPERATION_COMMANDS holds an entry this reading does not know",
        );
      }

      const key: string = property.name.expression.getText();
      const member: string = key.slice("CliOperation.".length);
      const operation: string | undefined = (
        CliOperation as unknown as Record<string, string>
      )[member];

      if (!key.startsWith("CliOperation.") || !operation) {
        throw new Error(`OPERATION_COMMANDS is keyed by ${key}`);
      }

      functions[operation] = property.initializer.text;
    }
  }

  return functions;
}

// The functions that add a resource's other subcommands: fields, then the actions.
export const FIELDS_REGISTER_FUNCTION: string = "registerFieldsCommand";
export const ACTION_REGISTER_FUNCTIONS: ReadonlyArray<string> = [
  "registerStateChangeCommand",
  "registerAddNoteCommand",
];

// Every subcommand of a resource, "<resource> list" to "<resource> add-note".
function resourceCommands(): Array<CliCommand> {
  const sources: Array<ts.SourceFile> = CLI_RESOURCE_SOURCES.map(parse);
  const operations: Record<string, string> = operationRegisterFunctions();

  return [
    ...Object.values(operations),
    FIELDS_REGISTER_FUNCTION,
    ...ACTION_REGISTER_FUNCTIONS,
  ].flatMap((name: string): Array<CliCommand> => {
    return subcommandsOf(functionNamed(sources, name));
  });
}

/*
 * Every command the CLI's sources build, by the words a reader types after
 * "oneuptime", with its arguments and options. A command that only groups
 * others ("context", "<resource>") is not one of them: its subcommands are.
 */
export function readCliProgram(): CliProgram {
  const sources: Array<ts.SourceFile> = CLI_PROGRAM_SOURCES.map(parse);

  return {
    globalOptions: globalOptionsOf(sources[0] as ts.SourceFile),
    commands: [
      ...programCommands(sources),
      ...resourceCommands(),
      {
        path: COMMANDER_HELP_COMMAND,
        arguments: ["[command]"],
        options: [],
      },
    ],
  };
}
