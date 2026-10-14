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
 * variable that holds a command (`contextCmd`, `resourceCmd`). A resource's
 * command is named from its model at run time (`resource.name`), so it is
 * read as "<resource>", and the resources are read from the models the way
 * the CLI discovers them: the models it makes a command for.
 */

export const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
export const CLI_DIR: string = path.join(REPOSITORY_ROOT, "packages", "CLI");
const COMMON_MODELS_DIR: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "Models",
);

// The sources that build the program, by their paths from packages/CLI.
const CLI_PROGRAM_SOURCES: ReadonlyArray<string> = [
  "Program.ts",
  "Commands/ConfigCommands.ts",
  "Commands/UtilityCommands.ts",
  "Commands/ResourceCommands.ts",
];

// What Commander adds to every program built with .version() and help on.
export const COMMANDER_VERSION_FLAGS: string = "-V, --version";
export const COMMANDER_HELP_FLAGS: string = "-h, --help";
// The help command Commander adds to a program that has commands.
export const COMMANDER_HELP_COMMAND: string = "help";
// What the sources name a resource's command, whose name comes from its model.
export const RESOURCE: string = "<resource>";

const SINGULAR_NAME: RegExp = /singularName: "([^"]+)"/;
// toKebabCase's two steps, as ResourceCommands.ts writes them.
const LOWER_THEN_UPPER: RegExp = /([a-z])([A-Z])/g;
const SPACES_AND_UNDERSCORES: RegExp = /[\s_]+/g;
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
  // The model's source file.
  modelFile: string;
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
 * The output option every command that prints records adds with
 * .addOption(createOutputOption()): the Option createOutputOption builds in
 * Core/OutputFormatter.ts, with the choices it gives it.
 */
export const outputOption: () => CliOption = (): CliOption => {
  const source: ts.SourceFile = parse("Core/OutputFormatter.ts");

  for (const node of everyNode(source)) {
    if (
      !ts.isFunctionDeclaration(node) ||
      node.name?.text !== "createOutputOption"
    ) {
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
        throw new Error("createOutputOption builds an Option with no flags");
      }

      const choices: ChainedCall | undefined = callsChainedOnto(inner).find(
        (call: ChainedCall): boolean => {
          return call.method === "choices";
        },
      );

      if (!choices) {
        return optionOf(flags, null, false, null);
      }

      /*
       * .choices(Object.values(OutputFormat)): the enum's values, in the
       * order it declares them.
       */
      const argument: string = (choices.args[0] as ts.Expression).getText();
      const enumName: string | undefined = argument.match(VALUES_OF_ENUM)?.[1];

      if (!enumName) {
        throw new Error(`The output option's choices are ${argument}`);
      }

      return optionOf(flags, null, false, enumValues(enumName));
    }
  }

  throw new Error("Core/OutputFormatter.ts builds no output option");
};

// The options a chain of calls declares.
function optionsOf(calls: Array<ChainedCall>): Array<CliOption> {
  const options: Array<CliOption> = [];

  for (const call of calls) {
    if (call.method === "option" || call.method === "requiredOption") {
      const flags: string | null = literal(call.args[0]);

      if (!flags) {
        throw new Error(`An .${call.method}() has no literal flags`);
      }

      options.push(
        optionOf(
          flags,
          literal(call.args[2]),
          call.method === "requiredOption",
          null,
        ),
      );
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

      options.push(outputOption());
    }
  }

  return options;
}

/*
 * What a variable that holds a command stands for, by its declaration:
 * const contextCmd: Command = program.command("context")... is "context";
 * const resourceCmd: Command = program.command(resource.name)... is
 * "<resource>".
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

      if (command) {
        variables[node.name.text] =
          literal(command.args[0])?.split(" ")[0] || RESOURCE;
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
 * The operations registerResourceCommands gives each type of resource: the
 * register functions each `resource.modelType === "<type>"` branch calls.
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
      options.unshift(optionOf(COMMANDER_VERSION_FLAGS, null, false, null));
    }

    options.push(optionOf(COMMANDER_HELP_FLAGS, null, false, null));

    return options;
  }

  throw new Error("Program.ts declares no options on program");
}

/*
 * Every command the CLI's sources build, by the words a reader types after
 * "oneuptime", with its arguments and options. A command that only groups
 * others ("context", "<resource>") is not one of them: its subcommands are.
 */
export const readCliProgram: () => CliProgram = (): CliProgram => {
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

    const spec: string = literal(node.arguments[0]) || RESOURCE;
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
};

// A model's name as a command, as the CLI's toKebabCase writes it.
export const asCommandName: (singularName: string) => string = (
  singularName: string,
): string => {
  return singularName
    .replace(LOWER_THEN_UPPER, "$1-$2")
    .replace(SPACES_AND_UNDERSCORES, "-")
    .toLowerCase();
};

/*
 * The models under a folder of Common/Models whose source carries both
 * markers: that the API opens the model to tools (what the CLI checks as
 * model.enableMCP), and that it has an API path (model.crudApiPath).
 */
function resourcesMarked(
  folder: string,
  type: string,
  markers: ReadonlyArray<string>,
): Array<CliResource> {
  const directory: string = path.join(COMMON_MODELS_DIR, folder);

  return fs
    .readdirSync(directory)
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    })
    .map((file: string): string => {
      return path.join(directory, file);
    })
    .filter((file: string): boolean => {
      const source: string = fs.readFileSync(file, "utf8");

      return markers.every((marker: string): boolean => {
        return source.includes(marker);
      });
    })
    .map((file: string): CliResource => {
      const singularName: string | undefined = fs
        .readFileSync(file, "utf8")
        .match(SINGULAR_NAME)?.[1];

      if (!singularName) {
        throw new Error(`${file} has no singular name`);
      }

      return { name: asCommandName(singularName), type: type, modelFile: file };
    });
}

/*
 * Every resource the CLI makes a command for: the records (database models)
 * and the telemetry (analytics models) the API opens to tools.
 */
export const readCliResources: () => Array<CliResource> =
  (): Array<CliResource> => {
    return [
      ...resourcesMarked("DatabaseModels", "database", [
        "@EnableMCP()",
        "@CrudApiEndpoint(",
      ]),
      ...resourcesMarked("AnalyticsModels", "analytics", [
        "enableMCP: true",
        "crudApiPath:",
      ]),
    ];
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
  // The resource a "<resource> <operation>" command names.
  resource: CliResource | null;
  // The words after the command's path that are not options.
  arguments: Array<string>;
  options: Array<CliOptionGiven>;
}

/*
 * What Commander makes of the words after "oneuptime", read from the
 * sources: which command they run, its arguments, and each option with its
 * value. Throws, naming the words, for anything Commander would refuse - an
 * unknown command, operation or option, an option of another command, a
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
    if (
      !second ||
      !(program.operationsByType[resource.type] || []).includes(second)
    ) {
      throw new Error(
        `${resource.name} (${resource.type}) has no operation ${second} in: oneuptime ${typed}`,
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
