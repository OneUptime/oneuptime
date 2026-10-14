import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";

/*
 * EVERY WAY AN EMAIL TEMPLATE'S ROWS CAN COME AND GO.
 *
 * A template shows a row when the variable it reads is there - {{#if X}},
 * {{#ifNotCond X ""}}, {{#ifCond X "true"}} - and repeats one for every
 * item of a list it loops over ({{#each X}}). Which variables and lists a
 * template reads is read from the template itself (its Handlebars syntax
 * tree, and that of each partial it renders with its own context), so a
 * row or a list added to a template tomorrow is covered without anyone
 * listing it here.
 *
 * variableSetsFor(template) gives the sets of variables that, rendered,
 * make every row appear and disappear: all of them; none; all of them
 * empty; all but one, for each variable; only one, for each; and each list
 * with no items, one and three. A variable left out is the empty string a
 * sender passes for a value it does not have (an empty list for a list):
 * {{#ifNotCond X ""}} hides a row for "", not for a variable that is not
 * there at all.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../../FeatureSet/Notification/Templates",
);

// Helpers the templates call: a path in their place is not a variable.
const HELPERS: ReadonlySet<string> = new Set<string>([
  "if",
  "unless",
  "each",
  "with",
  "lookup",
  "log",
  "ifCond",
  "ifNotCond",
  "concat",
  "brandName",
  "brandNameHtml",
  "detailCardStart",
  "detailCardDivider",
  "detailCardEnd",
]);

export interface TemplateVariables {
  // Each root variable the template reads, with a value that shows it.
  values: Map<string, unknown>;
  // Each list it loops over, with the fields one item has.
  lists: Map<string, Map<string, unknown>>;
}

export interface VariableSet {
  // What the set is, for a test's name and failure message.
  name: string;
  variables: Record<string, unknown>;
}

export interface VariableSetOptions {
  /*
   * Variables the sets never hold: ones the email gets from elsewhere, such
   * as the brand variables MailService.render puts in every email.
   */
  leaveOut?: ReadonlyArray<string> | undefined;
  /*
   * Variables every set holds, with their sample value: ones the template's
   * sender always sets.
   */
  alwaysSet?: ReadonlyArray<string> | undefined;
}

// A value that makes a variable show, from its name.
const sampleValue: (name: string) => unknown = (name: string): unknown => {
  const last: string = name.split(".").pop() || name;

  if (last.endsWith("TextColor")) {
    return "#991b1b";
  }

  if (last.endsWith("Color") || last.endsWith("Background")) {
    return "#dc2626";
  }

  if (last.endsWith("Url") || last.endsWith("URL") || last.endsWith("Link")) {
    return `https://oneuptime.example.test/${last}`;
  }

  if (last.endsWith("InPixels")) {
    return 16;
  }

  if (last.startsWith("is") || last.startsWith("has")) {
    return "true";
  }

  return `Sample ${last}`;
};

type Node = { type: string; [key: string]: unknown };

const readPartial: (name: string) => string | null = (
  name: string,
): string | null => {
  const file: string = Path.join(TEMPLATES_DIR, "Partials", `${name}.hbs`);

  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
};

/*
 * The variables and lists a template reads, with the partials it renders
 * with its own context ({{> Footer this}}) read as part of it.
 */
export const templateVariables: (source: string) => TemplateVariables = (
  source: string,
): TemplateVariables => {
  const found: TemplateVariables = {
    values: new Map<string, unknown>(),
    lists: new Map<string, Map<string, unknown>>(),
  };
  const partialsRead: Set<string> = new Set<string>();

  const setValue: (name: string, value: unknown) => void = (
    name: string,
    value: unknown,
  ): void => {
    if (!found.values.has(name)) {
      found.values.set(name, value);
    }
  };

  const setField: (list: string, field: string, value: unknown) => void = (
    list: string,
    field: string,
    value: unknown,
  ): void => {
    const fields: Map<string, unknown> =
      found.lists.get(list) || new Map<string, unknown>();

    if (!fields.has(field)) {
      fields.set(field, value);
    }

    found.lists.set(list, fields);
  };

  // A path read where `list` is the list being looped over, or null.
  const readPath: (path: Node, list: string | null, value?: unknown) => void = (
    path: Node,
    list: string | null,
    value?: unknown,
  ): void => {
    if (path["type"] !== "PathExpression") {
      return;
    }

    const original: string = String(path["original"]);
    const parts: Array<string> = (path["parts"] as Array<string>) || [];

    if (parts.length === 0) {
      return;
    }

    if (path["data"]) {
      // @root.x reads the root; @first, @index and the rest are the loop's.
      if (original.startsWith("@root.")) {
        setValue(parts.slice(1).join("."), value ?? sampleValue(original));
      }

      return;
    }

    const name: string = parts.join(".");

    if (list !== null && Number(path["depth"]) === 0) {
      setField(list, parts[0]!, value ?? sampleValue(parts[0]!));
      return;
    }

    setValue(name, value ?? sampleValue(name));
  };

  const visit: (node: unknown, list: string | null) => void = (
    node: unknown,
    list: string | null,
  ): void => {
    if (!node || typeof node !== "object") {
      return;
    }

    const statement: Node = node as Node;

    switch (statement["type"]) {
      case "Program":
        for (const child of statement["body"] as Array<unknown>) {
          visit(child, list);
        }
        return;
      case "MustacheStatement":
      case "SubExpression":
      case "BlockStatement": {
        const path: Node = statement["path"] as Node;
        const helper: string = String(path["original"]);
        const params: Array<Node> = (statement["params"] as Array<Node>) || [];
        const isHelperCall: boolean =
          HELPERS.has(helper) &&
          (params.length > 0 || statement["type"] !== "MustacheStatement");

        if (!isHelperCall && HELPERS.has(helper)) {
          // {{brandName}} and the like: a helper, not a variable.
        } else if (!isHelperCall) {
          readPath(path, list);
        }

        /*
         * What a branch is shown for: ifCond X "lit" shows for "lit" - the
         * first literal a template compares X with - and ifNotCond X "",
         * if X and unless X for the sample value every variable gets.
         */
        if (
          helper === "ifCond" &&
          params.length === 2 &&
          params[1]!["type"] === "StringLiteral"
        ) {
          readPath(params[0]!, list, params[1]!["value"]);
        }

        if (helper === "each" && params[0]?.["type"] === "PathExpression") {
          const listPath: Node = params[0]!;
          const listName: string = (listPath["parts"] as Array<string>).join(
            ".",
          );

          if (!found.lists.has(listName)) {
            found.lists.set(listName, new Map<string, unknown>());
          }

          visit(statement["program"], listName);
          visit(statement["inverse"], list);
          return;
        }

        for (const param of params) {
          visit(param, list);
          readPath(param, list);
        }

        const hash: Node | undefined = statement["hash"] as Node | undefined;

        for (const pair of (hash?.["pairs"] as Array<Node>) || []) {
          visit(pair["value"], list);
          readPath(pair["value"] as Node, list);
        }

        visit(statement["program"], list);
        visit(statement["inverse"], list);
        return;
      }
      case "PartialStatement": {
        const name: string = String((statement["name"] as Node)["original"]);
        const params: Array<Node> = (statement["params"] as Array<Node>) || [];
        const hash: Node | undefined = statement["hash"] as Node | undefined;

        for (const pair of (hash?.["pairs"] as Array<Node>) || []) {
          visit(pair["value"], list);
          readPath(pair["value"] as Node, list);
        }

        // A partial rendered with this context reads its variables too.
        const rendersWithThisContext: boolean =
          params.length === 1 &&
          params[0]!["type"] === "PathExpression" &&
          (params[0]!["parts"] as Array<string>).length === 0;

        if (
          rendersWithThisContext &&
          list === null &&
          !partialsRead.has(name)
        ) {
          partialsRead.add(name);
          const partial: string | null = readPartial(name);

          if (partial !== null) {
            visit(Handlebars.parse(partial), null);
          }
        }
        return;
      }
      default:
        return;
    }
  };

  visit(Handlebars.parse(source), null);

  // A list's name is not also a value.
  for (const listName of found.lists.keys()) {
    found.values.delete(listName);
  }

  return found;
};

// `name` ("report.rows") set to `value` in `target`, making the objects on the way.
const assign: (
  target: Record<string, unknown>,
  name: string,
  value: unknown,
) => void = (
  target: Record<string, unknown>,
  name: string,
  value: unknown,
): void => {
  const parts: Array<string> = name.split(".");
  let at: Record<string, unknown> = target;

  for (const part of parts.slice(0, -1)) {
    if (!at[part] || typeof at[part] !== "object") {
      at[part] = {};
    }

    at = at[part] as Record<string, unknown>;
  }

  at[parts[parts.length - 1]!] = value;
};

const listItems: (
  fields: Map<string, unknown>,
  count: number,
) => Array<Record<string, unknown>> = (
  fields: Map<string, unknown>,
  count: number,
): Array<Record<string, unknown>> => {
  const items: Array<Record<string, unknown>> = [];

  for (let index: number = 0; index < count; index++) {
    const item: Record<string, unknown> = {};

    for (const [field, value] of fields) {
      item[field] =
        typeof value === "string" && value.startsWith("Sample ")
          ? `${value} ${index + 1}`
          : value;
    }

    items.push(item);
  }

  return items;
};

/*
 * The variables a template is rendered with to make every row it has
 * appear and disappear.
 */
export const variableSetsFor: (
  source: string,
  options?: VariableSetOptions,
) => Array<VariableSet> = (
  source: string,
  options: VariableSetOptions = {},
): Array<VariableSet> => {
  const found: TemplateVariables = templateVariables(source);
  const leaveOut: ReadonlyArray<string> = options.leaveOut || [];
  const alwaysSet: ReadonlyArray<string> = options.alwaysSet || [];

  for (const name of leaveOut) {
    found.values.delete(name);
    found.lists.delete(name);
  }

  const build: (
    keep: (name: string) => boolean,
    listSizes: (list: string) => number,
  ) => Record<string, unknown> = (
    keep: (name: string) => boolean,
    listSizes: (list: string) => number,
  ): Record<string, unknown> => {
    const variables: Record<string, unknown> = {};

    for (const [name, value] of found.values) {
      assign(
        variables,
        name,
        keep(name) || alwaysSet.includes(name) ? value : "",
      );
    }

    for (const [list, fields] of found.lists) {
      assign(
        variables,
        list,
        listItems(fields, keep(list) ? listSizes(list) : 0),
      );
    }

    return variables;
  };

  const everything: () => boolean = (): boolean => {
    return true;
  };
  const threeItems: () => number = (): number => {
    return 3;
  };

  const nothing: () => boolean = (): boolean => {
    return false;
  };

  const noVariables: Record<string, unknown> = {};

  for (const name of alwaysSet) {
    if (found.values.has(name)) {
      assign(noVariables, name, found.values.get(name));
    }
  }

  const sets: Array<VariableSet> = [
    { name: "every variable", variables: build(everything, threeItems) },
    { name: "no variables", variables: noVariables },
    { name: "every variable empty", variables: build(nothing, threeItems) },
  ];

  for (const name of [...found.values.keys(), ...found.lists.keys()]) {
    if (alwaysSet.includes(name)) {
      continue;
    }

    sets.push({
      name: `every variable but ${name}`,
      variables: build((other: string): boolean => {
        return other !== name;
      }, threeItems),
    });
    sets.push({
      name: `only ${name}`,
      variables: build((other: string): boolean => {
        return other === name;
      }, threeItems),
    });
  }

  for (const list of found.lists.keys()) {
    for (const size of [0, 1]) {
      sets.push({
        name: `every variable, ${size} item(s) in ${list}`,
        variables: build(everything, (other: string): number => {
          return other === list ? size : 3;
        }),
      });
    }
  }

  return sets;
};
