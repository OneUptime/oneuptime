import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import {
  CLI_FIELDS_SUBCOMMAND,
  CLI_STATE_MACHINES,
  CliAction,
  CliOperation,
  CliStateChange,
  CliStateMachine,
} from "Common/Utils/DeveloperDocs/CliCommands";
import {
  CliResource as CommonCliResource,
  getCliResources,
} from "Common/Utils/DeveloperDocs/CliResources";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The oneuptime CLI as its sources define it (packages/CLI), for
 * Tests/CliPage.test.ts, which holds every command on the website's CLI page
 * to it. Home's tests cannot load the CLI: Commander, chalk and cli-table3 are
 * the CLI package's own dependencies, and the Home Test job installs only
 * Common and Home. So the sources are parsed with TypeScript, following each
 * chain of Commander calls the way Commander builds the program:
 *
 *   program.command("login").argument("<api-key>", "...")
 *     .option("--context-name <name>", "...", "default")
 *
 * The same reading as App's docs suites use (App/Tests/FeatureSet/Docs/
 * CliDocsSupport.ts, docs task 29), copied rather than imported: an App test
 * helper resolves typescript from App's node_modules, which that job does not
 * install. packages/CLI/Tests/HomeCliPage.test.ts runs the same page through
 * the program Commander really builds, so a reading here that drifted from
 * the program would fail there.
 *
 * A command's parent is the receiver of its .command() call: `program`, or a
 * variable that holds a command (`contextCmd`). The resources are Common's:
 * the CLI makes a command for each resource getCliResources gives, and under
 * it a subcommand for each of its operations, then `fields`, then each of
 * its actions, so they are read from there as the CLI reads them. Each
 * subcommand comes from the function that registers it (Commands/
 * ResourceCommands.ts, Commands/ActionCommands.ts), and is written
 * "<resource> <name>". An option one of them adds inside an `if` is one only
 * some resources have (`--all`, records only; `--public`, records with
 * public notes). The field flags of a create and an update are a resource's
 * own, added from its model as the command runs (Utils/FieldFlags.ts), and
 * are not read here: a page command that gave one would be refused.
 */

export const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
export const CLI_DIR: string = path.join(REPOSITORY_ROOT, "packages", "CLI");
const COMMON_MODELS_DIR: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "Models",
);

// The sources that build the program's own commands, by their paths from packages/CLI.
const CLI_PROGRAM_SOURCES: ReadonlyArray<string> = [
  "Program.ts",
  "Commands/ConfigCommands.ts",
  "Commands/UtilityCommands.ts",
  "Commands/DeployCommands.ts",
];

// The sources that build every resource's subcommands.
const CLI_RESOURCE_SOURCES: ReadonlyArray<string> = [
  "Commands/ResourceCommands.ts",
  "Commands/ActionCommands.ts",
];

// The functions that add a resource's other subcommands: fields, then the actions.
const FIELDS_REGISTER_FUNCTION: string = "registerFieldsCommand";
const ACTION_REGISTER_FUNCTIONS: ReadonlyArray<string> = [
  "registerStateChangeCommand",
  "registerAddNoteCommand",
];

// What Commander adds to every program built with .version() and help on.
export const COMMANDER_VERSION_FLAGS: string = "-V, --version";
export const COMMANDER_HELP_FLAGS: string = "-h, --help";
// The help command Commander adds to a program that has commands.
export const COMMANDER_HELP_COMMAND: string = "help";
// What the sources name a resource's command, whose name comes from its model.
export const RESOURCE: string = "<resource>";

// An option's value in its flags: "--limit <n>", "--name [value]".
const OPTION_VALUE: RegExp = /[<[][^>\]]+[>\]]/;
const FLAG_SEPARATOR: RegExp = /[,\s]+/;
// The choices createOutputOption gives: Object.values(OutputFormat).
const VALUES_OF_ENUM: RegExp = /^Object\.values\((\w+)\)$/;

export interface CliOption {
  // As written: "-o, --output <format>".
  flags: string;
  // Every name a reader may type it as: ["-o", "--output"].
  names: Array<string>;
  // It is followed by a value: "--limit <n>".
  takesValue: boolean;
  // The default a .option() call gives, as written: "10", "default".
  defaultValue: string | null;
  // Declared with .requiredOption().
  required: boolean;
  // The values Commander accepts, when it names them: -o's formats.
  choices: Array<string> | null;
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

export interface CliManifest {
  name: string;
  version: string;
  bin: Record<string, string>;
}

export interface CliResource {
  // The command: "incident-internal-note".
  name: string;
  // "database" for records, "analytics" for telemetry.
  type: string;
  // The requests it takes, in the order the CLI adds them: "list" to "count".
  operations: Array<string>;
  // What the dashboard's buttons do on it: "acknowledge", "add-note".
  actions: Array<string>;
  // The model's source file; null if none is named after its class.
  modelFile: string | null;
}

interface ChainedCall {
  method: string;
  args: ReadonlyArray<ts.Expression>;
}

export const readCliSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(CLI_DIR, relativePath), "utf8");
};

export const readCliManifest: () => CliManifest = (): CliManifest => {
  return JSON.parse(readCliSource("package.json")) as CliManifest;
};

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.join(CLI_DIR, relativePath),
    readCliSource(relativePath),
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
 * The calls chained onto an expression, outwards:
 * x.command("a").option(...).action(...) gives option, then action.
 */
function callsChainedOnto(expression: ts.Expression): Array<ChainedCall> {
  const chained: Array<ChainedCall> = [];
  let node: ts.Node = expression;

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

function optionOf(
  flags: string,
  defaultValue: string | null,
  required: boolean,
  choices: Array<string> | null,
  onlySome: boolean,
): CliOption {
  return {
    flags: flags,
    // "-o, --output <format>" is typed as -o or --output; <format> is its value.
    names: flags.split(FLAG_SEPARATOR).filter((name: string): boolean => {
      return name.startsWith("-");
    }),
    takesValue: OPTION_VALUE.test(flags),
    defaultValue: defaultValue,
    required: required,
    choices: choices,
    onlySome: onlySome,
  };
}

/*
 * The string values of an enum in Types/CLITypes.ts:
 * OutputFormat { JSON = "json", Table = "table", Wide = "wide" }.
 */
export const enumValues: (enumName: string) => Array<string> = (
  enumName: string,
): Array<string> => {
  const source: ts.SourceFile = parse("Types/CLITypes.ts");

  for (const node of everyNode(source)) {
    if (ts.isEnumDeclaration(node) && node.name.text === enumName) {
      return node.members.map((member: ts.EnumMember): string => {
        const value: string | null = literal(member.initializer);

        if (value === null) {
          throw new Error(`${enumName} has a member with no string value`);
        }

        return value;
      });
    }
  }

  throw new Error(`Types/CLITypes.ts declares no enum ${enumName}`);
};

/*
 * The Option a function of Core/OutputFormatter.ts builds, with the choices
 * it gives it.
 */
function builtOption(functionName: string): CliOption {
  const source: ts.SourceFile = parse("Core/OutputFormatter.ts");

  for (const node of everyNode(source)) {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== functionName) {
      continue;
    }

    for (const inner of everyNode(node)) {
      if (
        !ts.isNewExpression(inner) ||
        !ts.isIdentifier(inner.expression) ||
        inner.expression.text !== "Option"
      ) {
        continue;
      }

      const flags: string | null = literal(inner.arguments?.[0]);

      if (!flags) {
        throw new Error(`${functionName} builds an Option with no flags`);
      }

      const choices: ChainedCall | undefined = callsChainedOnto(inner).find(
        (call: ChainedCall): boolean => {
          return call.method === "choices";
        },
      );

      if (!choices) {
        return optionOf(flags, null, false, null, false);
      }

      /*
       * .choices(Object.values(OutputFormat)): the enum's values, in the
       * order it declares them.
       */
      const argument: string = (choices.args[0] as ts.Expression).getText();
      const enumName: string | undefined = argument.match(VALUES_OF_ENUM)?.[1];

      if (!enumName) {
        throw new Error(`The choices of ${functionName} are ${argument}`);
      }

      return optionOf(flags, null, false, enumValues(enumName), false);
    }
  }

  throw new Error(`Core/OutputFormatter.ts has no ${functionName}`);
}

/*
 * The output option every command that prints adds with
 * .addOption(createOutputOption()).
 */
export const outputOption: () => CliOption = (): CliOption => {
  return builtOption("createOutputOption");
};

// The --json option every command that prints adds with .addOption(createJsonOption()).
export const jsonOption: () => CliOption = (): CliOption => {
  return builtOption("createJsonOption");
};

/*
 * The calls a `new Option(...)` may have chained onto it, here: what each
 * adds is not one more thing Commander refuses on a page command. --all's
 * .conflicts(["limit", "skip"]) is one, but --all is only some resources'
 * (CliPage.test.ts holds the page to none of those).
 */
const KNOWN_NEW_OPTION_CALLS: ReadonlyArray<string> = ["conflicts"];

/*
 * The option an .addOption() adds: the output option, the --json option, or
 * a `new Option("--all", ...)` with calls chained onto it.
 */
function addedOption(
  added: ts.Expression | undefined,
  onlySome: boolean,
): CliOption {
  if (
    added &&
    ts.isCallExpression(added) &&
    ts.isIdentifier(added.expression)
  ) {
    if (added.expression.text === "createOutputOption") {
      return { ...outputOption(), onlySome: onlySome };
    }

    if (added.expression.text === "createJsonOption") {
      return { ...jsonOption(), onlySome: onlySome };
    }
  }

  if (added) {
    const { receiver, calls } = chainFromReceiver(added);
    const flags: string | null =
      ts.isNewExpression(receiver) &&
      ts.isIdentifier(receiver.expression) &&
      receiver.expression.text === "Option"
        ? literal(receiver.arguments?.[0])
        : null;
    const unknownCall: ChainedCall | undefined = calls.find(
      (call: ChainedCall): boolean => {
        return !KNOWN_NEW_OPTION_CALLS.includes(call.method);
      },
    );

    if (flags && !unknownCall) {
      return optionOf(flags, null, false, null, onlySome);
    }
  }

  throw new Error(
    `An .addOption() adds what this reading does not know: ${added?.getText()}`,
  );
}

// The option one .option(), .requiredOption() or .addOption() call declares.
function optionOfCall(call: ChainedCall, onlySome: boolean): CliOption | null {
  if (call.method === "option" || call.method === "requiredOption") {
    const flags: string | null = literal(call.args[0]);

    if (!flags) {
      throw new Error(`An .${call.method}() has no literal flags`);
    }

    return optionOf(
      flags,
      literal(call.args[2]),
      call.method === "requiredOption",
      null,
      onlySome,
    );
  }

  if (call.method === "addOption") {
    return addedOption(call.args[0], onlySome);
  }

  return null;
}

// The options a chain of calls declares.
function optionsOf(calls: Array<ChainedCall>): Array<CliOption> {
  return calls
    .map((call: ChainedCall): CliOption | null => {
      return optionOfCall(call, false);
    })
    .filter((option: CliOption | null): option is CliOption => {
      return option !== null;
    });
}

/*
 * What a variable that holds a command stands for, by its declaration:
 * const contextCmd: Command = program.command("context")... is "context".
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

      const command: ChainedCall | undefined = chainFromReceiver(
        node.initializer,
      ).calls.find((call: ChainedCall): boolean => {
        return call.method === "command";
      });
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
      !ts.isExpressionStatement(node) ||
      !ts.isCallExpression(node.expression)
    ) {
      continue;
    }

    const chain: { receiver: ts.Expression; calls: Array<ChainedCall> } =
      chainFromReceiver(node.expression);

    if (
      !ts.isIdentifier(chain.receiver) ||
      chain.receiver.text !== "program" ||
      !chain.calls.some((call: ChainedCall): boolean => {
        return call.method === "option" || call.method === "addOption";
      })
    ) {
      continue;
    }

    const options: Array<CliOption> = optionsOf(chain.calls);

    if (
      chain.calls.some((call: ChainedCall): boolean => {
        return call.method === "version" && call.args.length === 1;
      })
    ) {
      options.unshift(
        optionOf(COMMANDER_VERSION_FLAGS, null, false, null, false),
      );
    }

    options.push(optionOf(COMMANDER_HELP_FLAGS, null, false, null, false));

    return options;
  }

  throw new Error("Program.ts declares no options on program");
}

/*
 * The program's own commands - login, the context commands, deploy and the
 * rest - by the words a reader types after "oneuptime". A command that only
 * groups others ("context") is not one of them: its subcommands are.
 */
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
      const action: string | undefined = (
        CliAction as unknown as Record<string, string>
      )[value.slice("CliAction.".length)];

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
      return optionOfCall(
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
        path: `${RESOURCE} ${name}`,
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
function operationRegisterFunctions(
  source: ts.SourceFile,
): Record<string, string> {
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
      const operation: string | undefined = (
        CliOperation as unknown as Record<string, string>
      )[key.slice("CliOperation.".length)];

      if (!key.startsWith("CliOperation.") || !operation) {
        throw new Error(`OPERATION_COMMANDS is keyed by ${key}`);
      }

      functions[operation] = property.initializer.text;
    }
  }

  return functions;
}

// Every subcommand of a resource, "<resource> list" to "<resource> add-note".
function resourceCommands(): Array<CliCommand> {
  const sources: Array<ts.SourceFile> = CLI_RESOURCE_SOURCES.map(parse);
  const operations: Record<string, string> = operationRegisterFunctions(
    sources[0] as ts.SourceFile,
  );

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
export const readCliProgram: () => CliProgram = (): CliProgram => {
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
};

/*
 * That the CLI makes its resource commands from Common's getCliResources,
 * as readCliResources reads them: discoverResources, in
 * Commands/ResourceCommands.ts, calls it.
 */
function assertResourcesAreCommons(): void {
  const discover: ts.FunctionDeclaration = functionNamed(
    [parse("Commands/ResourceCommands.ts")],
    "discoverResources",
  );
  const callsGetCliResources: boolean = everyNode(discover).some(
    (node: ts.Node): boolean => {
      return (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "getCliResources"
      );
    },
  );

  if (!callsGetCliResources) {
    throw new Error(
      "discoverResources no longer takes the resources from getCliResources",
    );
  }
}

/*
 * The source of each model under a folder of Common/Models, by its class's
 * name: Incident is Incident.ts. A few files spell an abbreviation another
 * way than their class (ProjectSso.ts holds ProjectSSO), so the name is
 * matched without case.
 */
function modelFilesOf(
  folder: string,
  modelTypes: ReadonlyArray<new () => { tableName?: string | null }>,
): Map<string, string> {
  const directory: string = path.join(COMMON_MODELS_DIR, folder);
  const filesByName: Map<string, string> = new Map(
    fs.readdirSync(directory).map((file: string): [string, string] => {
      return [file.toLowerCase(), path.join(directory, file)];
    }),
  );
  const byTable: Map<string, string> = new Map();

  for (const modelType of modelTypes) {
    const file: string | undefined = filesByName.get(
      `${modelType.name}.ts`.toLowerCase(),
    );
    const tableName: string | null | undefined = new modelType().tableName;

    if (file && tableName) {
      byTable.set(tableName, file);
    }
  }

  return byTable;
}

/*
 * Every resource the CLI makes a command for, as it finds them: Common's
 * getCliResources, the records (database models) and the telemetry
 * (analytics models) of the API, each with its operations and actions.
 */
export const readCliResources: () => Array<CliResource> =
  (): Array<CliResource> => {
    assertResourcesAreCommons();

    const modelFiles: Record<string, Map<string, string>> = {
      database: modelFilesOf("DatabaseModels", DatabaseModels),
      analytics: modelFilesOf("AnalyticsModels", AnalyticsModels),
    };

    return getCliResources().map((resource: CommonCliResource): CliResource => {
      return {
        name: resource.name,
        type: resource.modelType,
        operations: [...resource.operations],
        actions: [...resource.actions],
        modelFile:
          modelFiles[resource.modelType]?.get(resource.tableName) || null,
      };
    });
  };

/*
 * A resource's subcommands, in the order the CLI adds them: its operations,
 * `fields`, then its actions.
 */
export const resourceSubcommands: (resource: CliResource) => Array<string> = (
  resource: CliResource,
): Array<string> => {
  return [...resource.operations, CLI_FIELDS_SUBCOMMAND, ...resource.actions];
};

export interface CliOptionGiven {
  // As typed: "-o", "--query".
  name: string;
  option: CliOption;
  // The word after it, for an option that takes a value.
  value: string | null;
  // One of the program's own options, not the command's.
  isGlobal: boolean;
}

export interface CliInvocation {
  command: CliCommand;
  // The resource a "<resource> <subcommand>" command names.
  resource: CliResource | null;
  // The words after the command's path that are not options.
  arguments: Array<string>;
  options: Array<CliOptionGiven>;
}

/*
 * What Commander makes of the words after "oneuptime", read from the
 * sources: which command they run, its arguments, and each option with its
 * value. Throws, naming the words, for anything Commander would refuse - an
 * unknown command, subcommand or option, an option of another command, a
 * missing or extra argument, a missing value or required option, a value
 * outside an option's choices. The CLI parses without positional options, so
 * an option may stand before or after the command, as Commander reads it.
 */
export const readInvocation: (
  words: ReadonlyArray<string>,
  program: CliProgram,
  resources: ReadonlyArray<CliResource>,
) => CliInvocation = (
  words: ReadonlyArray<string>,
  program: CliProgram,
  resources: ReadonlyArray<CliResource>,
): CliInvocation => {
  const typed: string = words.join(" ");
  const everyOption: Array<CliOption> = [
    ...program.globalOptions,
    ...program.commands.flatMap((command: CliCommand): Array<CliOption> => {
      return command.options;
    }),
  ];
  const optionNamed: (name: string) => CliOption | undefined = (
    name: string,
  ): CliOption | undefined => {
    return everyOption.find((option: CliOption): boolean => {
      return option.names.includes(name);
    });
  };
  const positionals: Array<string> = [];
  const given: Array<{ name: string; value: string | null }> = [];

  for (let index: number = 0; index < words.length; index += 1) {
    const word: string = words[index] as string;

    if (!word.startsWith("-") || word === "-") {
      positionals.push(word);
      continue;
    }

    const option: CliOption | undefined = optionNamed(word);

    if (!option) {
      throw new Error(`Unknown option ${word} in: oneuptime ${typed}`);
    }

    if (!option.takesValue) {
      given.push({ name: word, value: null });
      continue;
    }

    const value: string | undefined = words[index + 1];

    if (value === undefined) {
      throw new Error(`${word} has no value in: oneuptime ${typed}`);
    }

    given.push({ name: word, value: value });
    index += 1;
  }

  const [first, second] = positionals;
  const resource: CliResource | null =
    resources.find((candidate: CliResource): boolean => {
      return candidate.name === first;
    }) || null;
  let commandPath: string;
  let pathLength: number;

  if (resource) {
    if (!second || !resourceSubcommands(resource).includes(second)) {
      throw new Error(
        `${resource.name} (${resource.type}) has no subcommand ${second} in: oneuptime ${typed}`,
      );
    }

    commandPath = `${RESOURCE} ${second}`;
    pathLength = 2;
  } else if (
    first &&
    second &&
    program.commands.some((command: CliCommand): boolean => {
      return command.path === `${first} ${second}`;
    })
  ) {
    commandPath = `${first} ${second}`;
    pathLength = 2;
  } else {
    commandPath = first || "";
    pathLength = 1;
  }

  const command: CliCommand | undefined = program.commands.find(
    (candidate: CliCommand): boolean => {
      return candidate.path === commandPath;
    },
  );

  if (!command) {
    throw new Error(`No command ${commandPath} in: oneuptime ${typed}`);
  }

  const args: Array<string> = positionals.slice(pathLength);
  const required: number = command.arguments.filter(
    (argument: string): boolean => {
      return argument.startsWith("<");
    },
  ).length;

  if (args.length < required || args.length > command.arguments.length) {
    throw new Error(
      `${commandPath} takes ${command.arguments.join(" ")}, not ${args.length} arguments, in: oneuptime ${typed}`,
    );
  }

  const options: Array<CliOptionGiven> = given.map(
    (entry: { name: string; value: string | null }): CliOptionGiven => {
      const own: CliOption | undefined = command.options.find(
        (option: CliOption): boolean => {
          return option.names.includes(entry.name);
        },
      );
      const global: CliOption | undefined = program.globalOptions.find(
        (option: CliOption): boolean => {
          return option.names.includes(entry.name);
        },
      );
      const option: CliOption | undefined = own || global;

      if (!option) {
        throw new Error(
          `${commandPath} has no option ${entry.name} in: oneuptime ${typed}`,
        );
      }

      if (
        option.choices &&
        entry.value !== null &&
        !option.choices.includes(entry.value)
      ) {
        throw new Error(
          `${entry.name} takes ${option.choices.join(", ")}, not ${entry.value}, in: oneuptime ${typed}`,
        );
      }

      return {
        name: entry.name,
        option: option,
        value: entry.value,
        isGlobal: !own,
      };
    },
  );

  for (const option of command.options) {
    if (
      option.required &&
      !options.some((entry: CliOptionGiven): boolean => {
        return entry.option === option;
      })
    ) {
      throw new Error(
        `${commandPath} needs ${option.flags} in: oneuptime ${typed}`,
      );
    }
  }

  return {
    command: command,
    resource: resource,
    arguments: args,
    options: options,
  };
};

// The value given for an option, by any of its names; null when not given.
export const optionValue: (
  invocation: CliInvocation,
  longName: string,
) => string | null = (
  invocation: CliInvocation,
  longName: string,
): string | null => {
  const entry: CliOptionGiven | undefined = invocation.options.find(
    (candidate: CliOptionGiven): boolean => {
      return candidate.option.names.includes(longName);
    },
  );

  return entry ? entry.value : null;
};
