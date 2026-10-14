import OpenAPIUtil from "Common/Server/Utils/OpenAPI";
import { JSONObject } from "Common/Types/JSON";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";
import fs from "fs";
import path from "path";

/*
 * The Terraform pages (docs overhaul task 30a) read against the provider
 * they document. The provider is generated: Scripts/TerraformProvider reads
 * the OpenAPI spec the API publishes (Common/Server/Utils/OpenAPI) and makes
 * a resource and a data source of each model, an attribute of each column
 * (Core/OpenAPIParser), and Go code of each (Core/ResourceGenerator and
 * friends). A monitor's monitor_steps is hand-written Go
 * (StaticFiles/monitorsteps.go), copied into the provider as it is.
 *
 * So the truth is read where the generator reads it:
 *
 *   - readProvider runs the real spec through the real parser, and asks the
 *     generator's own ResourceGenerator.getSchemaFlags which attributes a
 *     configuration may set: the resources, data sources and attributes of
 *     the provider that `npm run generate-terraform-provider` builds;
 *   - readMonitorStepsSchema reads monitorsteps.go: the nested attributes of
 *     a step, a criteria, a filter and an incident or alert template, which
 *     of them are required or sensitive, and the fixed lists of values the
 *     provider checks when it plans;
 *   - parseHcl reads the HCL of the pages, so a test can hold every block to
 *     both.
 *
 * ResourceGenerator imports Common through the "Common/*" alias, which this
 * package's TypeScript program does not resolve outside packages/App, so it
 * is loaded at run time (jest's moduleNameMapper resolves the alias) rather
 * than imported. The parser and the types import nothing of Common's.
 *
 * TerraformDocsFacts and TerraformDocsTranslations read these; importing a
 * .test.ts file would run its tests.
 */

export const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

export function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

export const MONITOR_STEPS_GO: string =
  "Scripts/TerraformProvider/StaticFiles/monitorsteps.go";
export const PROVIDER_GENERATOR: string =
  "Scripts/TerraformProvider/Core/ProviderGenerator.ts";
export const RESOURCE_GENERATOR: string =
  "Scripts/TerraformProvider/Core/ResourceGenerator.ts";
export const DATA_SOURCE_GENERATOR: string =
  "Scripts/TerraformProvider/Core/DataSourceGenerator.ts";
export const DOCUMENTATION_GENERATOR: string =
  "Scripts/TerraformProvider/Core/DocumentationGenerator.ts";
export const E2E_FIXTURES: string = "packages/E2E/Terraform/e2e-tests/tests";

// What a configuration may do with one attribute of a resource or data source.
export interface ProviderAttribute {
  name: string;
  // "string", "number", "bool", "list", "set" or "monitor_steps".
  type: string;
  required: boolean;
  // Required or optional: a configuration may write it.
  settable: boolean;
  sensitive: boolean;
  isDateTime: boolean;
  // A JSON value or a wrapped scalar (a Color, a Domain) the API wraps.
  isComplexObject: boolean;
  enumValues: Array<string>;
  // The resource or data source an ID points at, as the provider names it.
  relation: string | null;
  // Data sources: an argument a lookup can match on.
  isLookupFilter: boolean;
}

export interface ProviderType {
  // Without the provider prefix: "monitor_status".
  name: string;
  // The name before type names kept mixed-case words whole: "io_t_fleet".
  legacyName: string | null;
  canBeImported: boolean;
  attributes: Map<string, ProviderAttribute>;
}

export interface ProviderSchema {
  resources: Map<string, ProviderType>;
  dataSources: Map<string, ProviderType>;
}

interface SchemaFlags {
  required: boolean;
  optional: boolean;
  computed: boolean;
}

type SchemaFlagsFunction = (
  name: string,
  attribute: TerraformAttribute,
  resource?: TerraformResource,
) => SchemaFlags;

async function loadSchemaFlags(): Promise<SchemaFlagsFunction> {
  const modulePath: string = path.join(
    REPO_ROOT,
    "Scripts/TerraformProvider/Core/ResourceGenerator",
  );
  const loaded: {
    ResourceGenerator: { getSchemaFlags: SchemaFlagsFunction };
  } = (await import(modulePath)) as {
    ResourceGenerator: { getSchemaFlags: SchemaFlagsFunction };
  };

  return loaded.ResourceGenerator.getSchemaFlags;
}

function attributeOf(
  name: string,
  attribute: TerraformAttribute,
  flags: SchemaFlags,
): ProviderAttribute {
  return {
    name: name,
    type: attribute.type,
    required: flags.required,
    settable: flags.required || flags.optional,
    sensitive: Boolean(attribute.sensitive),
    isDateTime: Boolean(attribute.isDateTime),
    isComplexObject: Boolean(attribute.isComplexObject),
    enumValues: attribute.enumValues || [],
    relation: attribute.relation ? attribute.relation.name : null,
    isLookupFilter: Boolean(attribute.isLookupFilter),
  };
}

let providerSchema: Promise<ProviderSchema> | null = null;

/*
 * The provider's resources and data sources, as the generator makes them
 * from the spec this tree publishes. Building the spec loads every model:
 * about ten seconds, so it is built once for a test file.
 */
export function readProvider(): Promise<ProviderSchema> {
  if (!providerSchema) {
    providerSchema = (async (): Promise<ProviderSchema> => {
      const getSchemaFlags: SchemaFlagsFunction = await loadSchemaFlags();
      const parser: OpenAPIParser = new OpenAPIParser();

      parser.setSpec(
        OpenAPIUtil.generateOpenAPISpec() as JSONObject as unknown as OpenAPISpec,
      );

      const resources: Map<string, ProviderType> = new Map();
      const dataSources: Map<string, ProviderType> = new Map();

      for (const resource of parser.getResources()) {
        const attributes: Map<string, ProviderAttribute> = new Map();

        for (const [name, attribute] of Object.entries(resource.schema)) {
          attributes.set(
            name,
            attributeOf(
              name,
              attribute,
              getSchemaFlags(name, attribute, resource),
            ),
          );
        }

        resources.set(resource.name, {
          name: resource.name,
          legacyName: resource.legacyName || null,
          canBeImported: Boolean(resource.operations.read),
          attributes: attributes,
        });
      }

      for (const dataSource of parser.getDataSources() as Array<TerraformDataSource>) {
        const attributes: Map<string, ProviderAttribute> = new Map();

        for (const [name, attribute] of Object.entries(dataSource.schema)) {
          attributes.set(
            name,
            attributeOf(name, attribute, {
              required: false,
              optional: Boolean(attribute.optional),
              computed: Boolean(attribute.computed),
            }),
          );
        }

        dataSources.set(dataSource.name, {
          name: dataSource.name,
          legacyName: dataSource.legacyName || null,
          canBeImported: false,
          attributes: attributes,
        });
      }

      return { resources: resources, dataSources: dataSources };
    })();
  }

  return providerSchema;
}

/*
 * monitorsteps.go: the nested attributes of monitor_steps, level by level.
 */

export interface NestedAttribute {
  name: string;
  // The Go attribute kind: "String", "Bool", "Int64", "List", "Map", "ListNested".
  kind: string;
  required: boolean;
  sensitive: boolean;
}

export interface MonitorStepsSchema {
  step: Map<string, NestedAttribute>;
  criteria: Map<string, NestedAttribute>;
  filter: Map<string, NestedAttribute>;
  incident: Map<string, NestedAttribute>;
  alert: Map<string, NestedAttribute>;
  // The per-monitor-type JSON attributes of a step: [attribute, API key].
  subConfigs: Array<[string, string]>;
  // Every `var monitorStepsXValues = []string{...}` list, by its Go name.
  valueLists: Map<string, Array<string>>;
}

// `"check_on": schema.StringAttribute{` - an attribute of a nested schema.
const GO_SCHEMA_ATTRIBUTE: RegExp =
  /^\s*"([a-z_]+)":\s+schema\.([A-Za-z0-9]+)Attribute\{/;
// `{"log_monitor", "logMonitor"},` - an entry of monitorStepsSubConfigs.
const GO_SUB_CONFIG: RegExp = /^\s*\{"([a-z_]+)", "([A-Za-z]+)"\},$/;
// `var monitorStepsCheckOnValues = []string{` - a list of fixed values.
const GO_VALUE_LIST_START: RegExp = /^var (monitorSteps[A-Za-z]+Values) = \[\]string\{(.*)$/;
const GO_QUOTED: RegExp = /"([^"]+)"/g;
const GO_REQUIRED_LINE: RegExp = /^\s*Required:\s+true,/;
const GO_SENSITIVE_LINE: RegExp = /^\s*Sensitive:\s+true,/;

// The text of a Go function, from its signature to its closing brace.
export function goFunction(source: string, signature: string): string {
  const start: number = source.indexOf(signature);

  if (start === -1) {
    throw new Error(`monitorsteps.go has no ${signature}`);
  }

  const end: number = source.indexOf("\n}\n", start);

  return source.slice(start, end);
}

// The attributes a nested schema function declares, with their flags.
function nestedAttributes(body: string): Map<string, NestedAttribute> {
  const attributes: Map<string, NestedAttribute> = new Map();
  let current: NestedAttribute | null = null;
  let depth: number = 0;

  for (const line of body.split("\n")) {
    const match: RegExpMatchArray | null = line.match(GO_SCHEMA_ATTRIBUTE);

    if (match && depth === 0) {
      current = {
        name: match[1] as string,
        kind: match[2] as string,
        required: false,
        sensitive: false,
      };
      attributes.set(current.name, current);
      depth = 1;
      continue;
    }

    if (current && depth > 0) {
      // Only the attribute's own fields count, not a nested object's.
      if (depth === 1 && GO_REQUIRED_LINE.test(line)) {
        current.required = true;
      }

      if (depth === 1 && GO_SENSITIVE_LINE.test(line)) {
        current.sensitive = true;
      }

      depth += line.split("{").length - line.split("}").length;

      if (depth <= 0) {
        current = null;
        depth = 0;
      }
    }
  }

  return attributes;
}

let monitorStepsSchema: MonitorStepsSchema | null = null;

export function readMonitorStepsSchema(): MonitorStepsSchema {
  if (monitorStepsSchema) {
    return monitorStepsSchema;
  }

  const source: string = readRepoFile(MONITOR_STEPS_GO);
  const subConfigs: Array<[string, string]> = [];
  const valueLists: Map<string, Array<string>> = new Map();

  const subConfigBody: string = goFunction(
    source,
    "var monitorStepsSubConfigs = []monitorStepsSubConfig{",
  );

  for (const line of subConfigBody.split("\n")) {
    const match: RegExpMatchArray | null = line.match(GO_SUB_CONFIG);

    if (match) {
      subConfigs.push([match[1] as string, match[2] as string]);
    }
  }

  const lines: Array<string> = source.split("\n");

  lines.forEach((line: string, index: number): void => {
    const start: RegExpMatchArray | null = line.match(GO_VALUE_LIST_START);

    if (!start) {
      return;
    }

    let text: string = start[2] as string;
    let next: number = index + 1;

    while (!text.includes("}") && next < lines.length) {
      text += `\n${lines[next] as string}`;
      next++;
    }

    valueLists.set(
      start[1] as string,
      Array.from(text.matchAll(GO_QUOTED)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );
  });

  const step: Map<string, NestedAttribute> = nestedAttributes(
    goFunction(source, "func monitorStepsStepSchema()"),
  );

  // The step's JSON attributes are added in a loop, one per sub-config.
  for (const [name] of subConfigs) {
    step.set(name, {
      name: name,
      kind: "String",
      required: false,
      sensitive: false,
    });
  }

  monitorStepsSchema = {
    step: step,
    criteria: nestedAttributes(
      goFunction(source, "func monitorStepsCriteriaSchema()"),
    ),
    filter: nestedAttributes(
      goFunction(source, "func monitorStepsFilterSchema()"),
    ),
    incident: nestedAttributes(
      goFunction(source, "func monitorStepsIncidentSchema()"),
    ),
    alert: nestedAttributes(
      goFunction(source, "func monitorStepsAlertSchema()"),
    ),
    subConfigs: subConfigs,
    valueLists: valueLists,
  };

  return monitorStepsSchema;
}

// A list of fixed values monitorsteps.go checks, by its Go name.
export function monitorStepsValues(listName: string): Array<string> {
  const values: Array<string> | undefined =
    readMonitorStepsSchema().valueLists.get(listName);

  if (!values || values.length === 0) {
    throw new Error(`monitorsteps.go has no list ${listName}`);
  }

  return values;
}

/*
 * HCL, as much of it as the pages write: blocks with labels, attributes,
 * strings and templates ("${each.key}"), heredocs, numbers, true and false,
 * null, tuples, objects, function calls and references
 * (data.oneuptime_label.critical.id). No operators, conditionals or for
 * expressions: a page that writes one fails to parse here, and this reader
 * grows with it.
 */

export type HclValue =
  | { kind: "string"; value: string; line: number }
  | { kind: "template"; value: string; line: number }
  | { kind: "number"; value: number; line: number }
  | { kind: "bool"; value: boolean; line: number }
  | { kind: "null"; line: number }
  | { kind: "tuple"; items: Array<HclValue>; line: number }
  | { kind: "object"; attributes: Array<HclAttribute>; line: number }
  | { kind: "call"; name: string; args: Array<HclValue>; line: number }
  | { kind: "reference"; path: string; line: number };

export interface HclAttribute {
  name: string;
  value: HclValue;
  line: number;
}

export interface HclBlock {
  type: string;
  labels: Array<string>;
  body: HclBody;
  line: number;
}

export interface HclBody {
  attributes: Array<HclAttribute>;
  blocks: Array<HclBlock>;
}

interface HclToken {
  type: "ident" | "string" | "template" | "number" | "punct" | "newline" | "eof";
  value: string;
  line: number;
}

const IDENTIFIER_START: RegExp = /[A-Za-z_]/;
const IDENTIFIER_PART: RegExp = /[A-Za-z0-9_-]/;
const DIGIT: RegExp = /[0-9]/;
const NUMBER_PART: RegExp = /[0-9.]/;
const PUNCTUATION: string = "{}[]()=,.:";
const HEREDOC_OPENING: RegExp = /^<<(-?)([A-Za-z_][A-Za-z0-9_]*)$/;

// The index just past a "${...}" or "%{...}" whose "{" is at `start`.
function skipInterpolation(text: string, start: number): number {
  let depth: number = 1;
  let index: number = start + 1;

  while (index < text.length) {
    const character: string = text[index] as string;

    if (character === '"') {
      index = skipString(text, index).end;
      continue;
    }

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return index + 1;
      }
    }

    index++;
  }

  throw new Error("An interpolation is never closed.");
}

// A quoted string that opens at `start`: its text, and the index past it.
function skipString(
  text: string,
  start: number,
): { value: string; end: number; isTemplate: boolean } {
  let value: string = "";
  let index: number = start + 1;
  let isTemplate: boolean = false;

  while (index < text.length) {
    const character: string = text[index] as string;

    if (character === "\\") {
      const escaped: string = text[index + 1] as string;
      value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
      index += 2;
      continue;
    }

    if (
      (character === "$" || character === "%") &&
      text[index + 1] === "{"
    ) {
      const end: number = skipInterpolation(text, index + 1);
      value += text.slice(index, end);
      index = end;
      isTemplate = true;
      continue;
    }

    if (character === '"') {
      return { value: value, end: index + 1, isTemplate: isTemplate };
    }

    if (character === "\n") {
      throw new Error("A string runs past the end of its line.");
    }

    value += character;
    index++;
  }

  throw new Error("A string is never closed.");
}

function tokenize(text: string): Array<HclToken> {
  const tokens: Array<HclToken> = [];
  let index: number = 0;
  let line: number = 1;

  const push: (type: HclToken["type"], value: string) => void = (
    type: HclToken["type"],
    value: string,
  ): void => {
    tokens.push({ type: type, value: value, line: line });
  };

  while (index < text.length) {
    const character: string = text[index] as string;

    if (character === "\n") {
      if (tokens[tokens.length - 1]?.type !== "newline") {
        push("newline", "\n");
      }

      line++;
      index++;
      continue;
    }

    if (character === " " || character === "\t" || character === "\r") {
      index++;
      continue;
    }

    if (character === "#" || (character === "/" && text[index + 1] === "/")) {
      while (index < text.length && text[index] !== "\n") {
        index++;
      }

      continue;
    }

    if (character === "/" && text[index + 1] === "*") {
      const end: number = text.indexOf("*/", index + 2);

      if (end === -1) {
        throw new Error(`Line ${line}: a comment is never closed.`);
      }

      line += text.slice(index, end).split("\n").length - 1;
      index = end + 2;
      continue;
    }

    if (character === "<" && text[index + 1] === "<") {
      const lineEnd: number = text.indexOf("\n", index);
      const opening: RegExpMatchArray | null = text
        .slice(index, lineEnd)
        .trim()
        .match(HEREDOC_OPENING);

      if (!opening) {
        throw new Error(`Line ${line}: "<<" opens no heredoc.`);
      }

      const marker: string = opening[2] as string;
      const bodyLines: Array<string> = [];
      let cursor: number = lineEnd + 1;
      const startLine: number = line;

      for (;;) {
        const next: number = text.indexOf("\n", cursor);
        const current: string = text.slice(
          cursor,
          next === -1 ? text.length : next,
        );

        line++;

        if (current.trim() === marker) {
          cursor = next === -1 ? text.length : next;
          break;
        }

        if (next === -1) {
          throw new Error(`Line ${startLine}: the heredoc ${marker} is never closed.`);
        }

        bodyLines.push(current);
        cursor = next + 1;
      }

      const indent: number =
        opening[1] === "-"
          ? Math.min(
              ...bodyLines
                .filter((bodyLine: string): boolean => {
                  return bodyLine.trim().length > 0;
                })
                .map((bodyLine: string): number => {
                  return bodyLine.length - bodyLine.trimStart().length;
                }),
            )
          : 0;

      tokens.push({
        type: "string",
        value: bodyLines
          .map((bodyLine: string): string => {
            return bodyLine.slice(indent);
          })
          .join("\n"),
        line: startLine,
      });
      index = cursor;
      continue;
    }

    if (character === '"') {
      const read: { value: string; end: number; isTemplate: boolean } =
        skipString(text, index);
      push(read.isTemplate ? "template" : "string", read.value);
      index = read.end;
      continue;
    }

    if (DIGIT.test(character)) {
      let end: number = index;

      while (end < text.length && NUMBER_PART.test(text[end] as string)) {
        end++;
      }

      push("number", text.slice(index, end));
      index = end;
      continue;
    }

    if (IDENTIFIER_START.test(character)) {
      let end: number = index;

      while (end < text.length && IDENTIFIER_PART.test(text[end] as string)) {
        end++;
      }

      push("ident", text.slice(index, end));
      index = end;
      continue;
    }

    if (PUNCTUATION.includes(character)) {
      push("punct", character);
      index++;
      continue;
    }

    throw new Error(`Line ${line}: HCL this reader does not know: "${character}".`);
  }

  push("eof", "");

  return tokens;
}

class HclParser {
  private position: number = 0;

  public constructor(private readonly tokens: Array<HclToken>) {}

  private peek(): HclToken {
    return this.tokens[this.position] as HclToken;
  }

  private next(): HclToken {
    const token: HclToken = this.peek();
    this.position++;
    return token;
  }

  private isPunct(value: string): boolean {
    const token: HclToken = this.peek();
    return token.type === "punct" && token.value === value;
  }

  private expectPunct(value: string): void {
    const token: HclToken = this.next();

    if (token.type !== "punct" || token.value !== value) {
      throw new Error(
        `Line ${token.line}: expected "${value}", found "${token.value}".`,
      );
    }
  }

  private skipNewlines(): void {
    while (this.peek().type === "newline") {
      this.position++;
    }
  }

  public parseBody(closing: string | null): HclBody {
    const body: HclBody = { attributes: [], blocks: [] };

    for (;;) {
      this.skipNewlines();
      const token: HclToken = this.peek();

      if (closing === null && token.type === "eof") {
        return body;
      }

      if (closing !== null && this.isPunct(closing)) {
        return body;
      }

      if (token.type !== "ident") {
        throw new Error(
          `Line ${token.line}: expected an attribute or a block, found "${token.value}".`,
        );
      }

      this.next();

      if (this.isPunct("=")) {
        this.next();
        const value: HclValue = this.parseExpression();
        const end: HclToken = this.peek();

        if (
          end.type !== "newline" &&
          end.type !== "eof" &&
          !(closing !== null && this.isPunct(closing))
        ) {
          throw new Error(
            `Line ${end.line}: "${token.value}" goes on after its value ("${end.value}").`,
          );
        }

        body.attributes.push({
          name: token.value,
          value: value,
          line: token.line,
        });
        continue;
      }

      const labels: Array<string> = [];

      while (this.peek().type === "string" || this.peek().type === "ident") {
        labels.push(this.next().value);
      }

      this.expectPunct("{");
      const inner: HclBody = this.parseBody("}");
      this.expectPunct("}");
      body.blocks.push({
        type: token.value,
        labels: labels,
        body: inner,
        line: token.line,
      });
    }
  }

  private parseExpression(): HclValue {
    const token: HclToken = this.next();

    switch (token.type) {
      case "string":
        return { kind: "string", value: token.value, line: token.line };
      case "template":
        return { kind: "template", value: token.value, line: token.line };
      case "number":
        return { kind: "number", value: Number(token.value), line: token.line };
      case "ident":
        return this.parseIdentifier(token);
      case "punct":
        if (token.value === "[") {
          return this.parseTuple(token.line);
        }

        if (token.value === "{") {
          return this.parseObject(token.line);
        }

        if (token.value === "(") {
          this.skipNewlines();
          const inner: HclValue = this.parseExpression();
          this.skipNewlines();
          this.expectPunct(")");
          return inner;
        }

        break;
      default:
        break;
    }

    throw new Error(`Line ${token.line}: a value cannot start with "${token.value}".`);
  }

  private parseIdentifier(token: HclToken): HclValue {
    if (token.value === "true" || token.value === "false") {
      return { kind: "bool", value: token.value === "true", line: token.line };
    }

    if (token.value === "null") {
      return { kind: "null", line: token.line };
    }

    if (this.isPunct("(")) {
      this.next();
      const args: Array<HclValue> = [];

      for (;;) {
        this.skipNewlines();

        if (this.isPunct(")")) {
          this.next();
          break;
        }

        args.push(this.parseExpression());
        this.skipNewlines();

        if (this.isPunct(",")) {
          this.next();
        }
      }

      return { kind: "call", name: token.value, args: args, line: token.line };
    }

    let reference: string = token.value;

    for (;;) {
      if (this.isPunct(".")) {
        this.next();
        const part: HclToken = this.next();

        if (part.type !== "ident" && part.type !== "number") {
          throw new Error(`Line ${part.line}: "${reference}." names nothing.`);
        }

        reference += `.${part.value}`;
        continue;
      }

      if (this.isPunct("[")) {
        this.next();
        const index: HclToken = this.next();
        this.expectPunct("]");
        reference += `[${index.value}]`;
        continue;
      }

      return { kind: "reference", path: reference, line: token.line };
    }
  }

  private parseTuple(line: number): HclValue {
    const items: Array<HclValue> = [];

    for (;;) {
      this.skipNewlines();

      if (this.isPunct("]")) {
        this.next();
        return { kind: "tuple", items: items, line: line };
      }

      items.push(this.parseExpression());
      this.skipNewlines();

      if (this.isPunct(",")) {
        this.next();
      } else if (!this.isPunct("]")) {
        const token: HclToken = this.peek();
        throw new Error(
          `Line ${token.line}: the items of a list need a comma between them.`,
        );
      }
    }
  }

  private parseObject(line: number): HclValue {
    const attributes: Array<HclAttribute> = [];

    for (;;) {
      this.skipNewlines();

      if (this.isPunct("}")) {
        this.next();
        return { kind: "object", attributes: attributes, line: line };
      }

      const key: HclToken = this.next();

      if (key.type !== "ident" && key.type !== "string") {
        throw new Error(`Line ${key.line}: an object key cannot be "${key.value}".`);
      }

      if (this.isPunct("=") || this.isPunct(":")) {
        this.next();
      } else {
        throw new Error(`Line ${key.line}: "${key.value}" has no "=".`);
      }

      attributes.push({
        name: key.value,
        value: this.parseExpression(),
        line: key.line,
      });

      if (this.isPunct(",")) {
        this.next();
      } else if (this.peek().type !== "newline" && !this.isPunct("}")) {
        const token: HclToken = this.peek();
        throw new Error(
          `Line ${token.line}: the attributes of an object need a comma or a new line between them.`,
        );
      }
    }
  }
}

// A page's HCL: its blocks and its attributes (a fragment has only attributes).
export function parseHcl(text: string): HclBody {
  return new HclParser(tokenize(text)).parseBody(null);
}

// An attribute of an object or a body, by name.
export function attributeNamed(
  attributes: Array<HclAttribute>,
  name: string,
): HclAttribute | undefined {
  return attributes.find((attribute: HclAttribute): boolean => {
    return attribute.name === name;
  });
}

// Every reference anywhere in a value: "oneuptime_label.critical.id", "var.x".
export function referencesIn(value: HclValue): Array<string> {
  switch (value.kind) {
    case "reference":
      return [value.path];
    case "tuple":
      return value.items.flatMap(referencesIn);
    case "object":
      return value.attributes.flatMap((attribute: HclAttribute) => {
        return referencesIn(attribute.value);
      });
    case "call":
      return value.args.flatMap(referencesIn);
    case "template":
      return templateReferences(value.value);
    default:
      return [];
  }
}

// `${each.key}` and `${var.x}` in a template, as references.
const TEMPLATE_REFERENCE: RegExp = /\$\{\s*([A-Za-z_][A-Za-z0-9_.[\]-]*)\s*\}/g;

function templateReferences(template: string): Array<string> {
  return Array.from(template.matchAll(TEMPLATE_REFERENCE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// Every reference in a body: its attributes' and its blocks'.
export function referencesInBody(body: HclBody): Array<string> {
  return [
    ...body.attributes.flatMap((attribute: HclAttribute) => {
      return referencesIn(attribute.value);
    }),
    ...body.blocks.flatMap((block: HclBlock) => {
      return referencesInBody(block.body);
    }),
  ];
}

// The fenced code blocks of a page in one language, with their info strings.
export interface CodeBlock {
  lang: string;
  info: string;
  code: string;
  // The line of the opening fence, from 1.
  line: number;
}

const FENCE_OPENING: RegExp = /^```(\S*)(.*)$/;

export function codeBlocks(markdown: string): Array<CodeBlock> {
  const lines: Array<string> = markdown.split("\n");
  const blocks: Array<CodeBlock> = [];
  let index: number = 0;

  while (index < lines.length) {
    const opening: RegExpMatchArray | null = (lines[index] as string).match(
      FENCE_OPENING,
    );

    if (!opening || !opening[1]) {
      index++;
      continue;
    }

    let end: number = index + 1;

    while (end < lines.length && (lines[end] as string).trim() !== "```") {
      end++;
    }

    blocks.push({
      lang: opening[1] as string,
      info: (opening[2] as string).trim(),
      code: lines.slice(index + 1, end).join("\n"),
      line: index + 1,
    });
    index = end + 1;
  }

  return blocks;
}
