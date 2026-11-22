import {
  PUBLIC_STORE_CHECK_IDS,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataLeakKind,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import {
  DeclaredCodeKind,
  isDeclaredCodePath,
} from "../../../../../Utils/AiRemediation/DeclaredCodeChange";
import { SensitiveDataCandidate } from "./SensitiveDataCandidate";
import {
  extensionOf,
  fileNameOfPath,
  indentOf,
  isMarkedNotSensitive,
  PatchLine,
  PatchLineKind,
  readNewLines,
} from "./SensitiveDataPatch";

/*
 * INFRASTRUCTURE CODE THAT LEAVES A STORE OPEN (#10376).
 *
 * Every check of Data Security's catalog that a file can show has a rule
 * here: a bucket or a database made public, its encryption, backups or
 * access logging turned off, a firewall opened to every address on a
 * database's port, a snapshot shared. Each rule reads one setting of a
 * line the pull request adds - in Terraform and OpenTofu, CloudFormation
 * (and SAM), Bicep and ARM, Kubernetes manifests, Pulumi and the AWS CDK -
 * by its key, whatever case the language writes it in:
 * `publicly_accessible`, `PubliclyAccessible` and `publiclyAccessible` are
 * one key.
 *
 * A setting is read with what it sits in, as far as its hunk shows it: the
 * resource ("aws_s3_bucket.assets"), the block (`versioning`, `ingress`),
 * and the settings beside it - so a security group opened to 0.0.0.0/0 on
 * port 443 is a web server's, and is left alone, while one on 5432 is a
 * database's.
 *
 * Each candidate keeps the names its resource is known by in the diff (a
 * bucket's name, an identifier), so the project's store it is can be
 * found: a store marked Public By Design makes no point for being public,
 * and a store's own sensitivity says how bad the point is
 * (ProductionReviewSensitiveData). Read in tests and fixtures too: a
 * module's test that opens a bucket to the world still ships the module.
 *
 * Pure: no IO, and every line read character by character.
 */

export enum InfrastructureCodeKind {
  Terraform = "Terraform",
  CloudFormation = "CloudFormation",
  Bicep = "Bicep",
  Arm = "Arm",
  Kubernetes = "Kubernetes",
  Pulumi = "Pulumi",
  Cdk = "Cdk",
}

// What each kind of infrastructure code is called in a sentence: "in Terraform".
export const INFRASTRUCTURE_CODE_NAMES: Readonly<
  Record<InfrastructureCodeKind, string>
> = {
  [InfrastructureCodeKind.Terraform]: "Terraform",
  [InfrastructureCodeKind.CloudFormation]: "CloudFormation",
  [InfrastructureCodeKind.Bicep]: "Bicep",
  [InfrastructureCodeKind.Arm]: "an ARM template",
  [InfrastructureCodeKind.Kubernetes]: "Kubernetes",
  [InfrastructureCodeKind.Pulumi]: "Pulumi",
  [InfrastructureCodeKind.Cdk]: "the AWS CDK",
};

const YAML_EXTENSIONS: ReadonlySet<string> = new Set<string>(["yaml", "yml"]);

const PROGRAM_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  "ts",
  "tsx",
  "js",
  "mjs",
  "cjs",
  "py",
  "go",
  "cs",
  "java",
]);

// Whether any line the hunks show holds one of `texts`, in lower case.
function mentions(
  lines: Array<PatchLine>,
  texts: ReadonlyArray<string>,
): boolean {
  return lines.some((line: PatchLine): boolean => {
    const lower: string = line.text.toLowerCase();

    return texts.some((text: string): boolean => {
      return lower.includes(text);
    });
  });
}

/*
 * What kind of infrastructure code a file is, from its path and what its
 * hunks show - or null for a file that is none.
 */
export function getInfrastructureKind(
  path: string,
  lines: Array<PatchLine>,
): InfrastructureCodeKind | null {
  const extension: string = extensionOf(path);
  const name: string = fileNameOfPath(path);

  if (isDeclaredCodePath(path, DeclaredCodeKind.Terraform)) {
    return InfrastructureCodeKind.Terraform;
  }

  if (isDeclaredCodePath(path, DeclaredCodeKind.Bicep)) {
    return InfrastructureCodeKind.Bicep;
  }

  if (YAML_EXTENSIONS.has(extension) && name.startsWith("pulumi.")) {
    return InfrastructureCodeKind.Pulumi;
  }

  if (
    YAML_EXTENSIONS.has(extension) ||
    extension === "json" ||
    extension === "template"
  ) {
    if (mentions(lines, ["awstemplateformatversion", "aws::"])) {
      return InfrastructureCodeKind.CloudFormation;
    }

    if (
      extension === "json" &&
      mentions(lines, ["deploymenttemplate.json", '"microsoft.'])
    ) {
      return InfrastructureCodeKind.Arm;
    }

    if (
      YAML_EXTENSIONS.has(extension) &&
      mentions(lines, ["apiversion:"]) &&
      mentions(lines, ["kind:"])
    ) {
      return InfrastructureCodeKind.Kubernetes;
    }

    return null;
  }

  if (PROGRAM_EXTENSIONS.has(extension)) {
    if (mentions(lines, ["@pulumi/", "import pulumi", "github.com/pulumi/"])) {
      return InfrastructureCodeKind.Pulumi;
    }

    if (
      mentions(lines, [
        "aws-cdk-lib",
        "@aws-cdk/",
        "aws_cdk",
        "software.amazon.awscdk",
      ])
    ) {
      return InfrastructureCodeKind.Cdk;
    }
  }

  return null;
}

// One setting a line writes: its key, and its value as written.
export interface InfrastructureSetting {
  key: string;
  // The key in lower case, without "_", "-", quotes or a "$": one per language.
  normalizedKey: string;
  // The value as the line writes it, and where it starts on the line.
  rawValue: string;
  valueStart: number;
  // The value in lower case, without quotes, a trailing comma or a comment.
  value: string;
}

export function normalizeKey(key: string): string {
  let normalized: string = "";

  for (const character of key.toLowerCase()) {
    if (
      character !== "_" &&
      character !== "-" &&
      character !== '"' &&
      character !== "'" &&
      character !== "$" &&
      character !== " "
    ) {
      normalized += character;
    }
  }

  return normalized;
}

// A raw value without what follows it on the line: a comma, a comment.
export function trimRawValue(rawValue: string): string {
  let raw: string = rawValue.trim();

  for (const comment of [" #", " //"]) {
    const at: number = raw.indexOf(comment);

    if (at >= 0) {
      raw = raw.slice(0, at).trim();
    }
  }

  while (raw.endsWith(",") || raw.endsWith(";")) {
    raw = raw.slice(0, -1).trim();
  }

  return raw;
}

// A value without its quotes, comma or comment, in lower case.
export function normalizeValue(raw: string): string {
  let value: string = trimRawValue(raw);

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith("`") && value.endsWith("`")))
  ) {
    value = value.slice(1, -1);
  }

  return value.trim().toLowerCase();
}

// A key's name at `from`, bare or quoted, and where it ends.
function readKey(
  text: string,
  from: number,
): { key: string; end: number } | null {
  const quote: string = text.charAt(from);

  if (quote === '"' || quote === "'") {
    const close: number = text.indexOf(quote, from + 1);

    if (close < 0 || close - from > 120) {
      return null;
    }

    return { key: text.slice(from + 1, close), end: close + 1 };
  }

  let index: number = from;

  while (index < text.length && index - from <= 120) {
    const code: number = text.charCodeAt(index);
    // A Kubernetes annotation's key holds "/": service.beta.kubernetes.io/...
    const isKeyCharacter: boolean =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x5f ||
      code === 0x2d ||
      code === 0x2e ||
      code === 0x24 ||
      code === 0x2f;

    if (!isKeyCharacter) {
      break;
    }

    index++;
  }

  return index > from ? { key: text.slice(from, index), end: index } : null;
}

function skipBlanks(text: string, from: number): number {
  let index: number = from;

  while (
    index < text.length &&
    (text.charAt(index) === " " || text.charAt(index) === "\t")
  ) {
    index++;
  }

  return index;
}

/*
 * The setting a line writes - `key = value`, `key: value`, `"key": value`,
 * `key=value,`, `- key: value` - or null for a line that writes none.
 */
export function readSetting(text: string): InfrastructureSetting | null {
  const indent: number = indentOf(text);
  const isListItem: boolean =
    text.charAt(indent) === "-" && text.charAt(indent + 1) === " ";
  const read: { key: string; end: number } | null = readKey(
    text,
    isListItem ? skipBlanks(text, indent + 1) : indent,
  );

  if (!read) {
    return null;
  }

  const at: number = skipBlanks(text, read.end);
  const separator: string = text.charAt(at);
  const following: string = text.charAt(at + 1);

  if (separator !== "=" && separator !== ":") {
    return null;
  }

  // "==" is a comparison, "=>" an arrow, "::" a path: no setting.
  if (
    (separator === "=" && (following === "=" || following === ">")) ||
    (separator === ":" && following === ":")
  ) {
    return null;
  }

  const valueStart: number = skipBlanks(text, at + 1);
  const rawValue: string = text.slice(valueStart);

  return {
    key: read.key,
    normalizedKey: normalizeKey(read.key),
    rawValue,
    valueStart,
    value: normalizeValue(rawValue),
  };
}

// What a line sits in, as far as its hunk shows it.
export interface SettingContext {
  // The blocks around it, nearest last, each as normalizeKey reads its name.
  blocks: Array<string>;
  // Its resource's type and name, when its hunk shows them.
  resourceType: string;
  resourceLabel: string;
  // The settings beside it: in the same block of the same hunk.
  siblings: Array<InfrastructureSetting>;
  // Every setting its hunk shows.
  hunkSettings: Array<InfrastructureSetting>;
}

interface LineContext {
  blocks: Array<string>;
  blockKey: string;
  resourceType: string;
  resourceLabel: string;
}

interface OpenBlock {
  name: string;
  resource: { type: string; label: string } | null;
}

// A block's opening line's name - what is before its "{" - as a key.
function blockNameOf(header: string): string {
  let name: string = header.trim();

  while (name.endsWith("=") || name.endsWith(":")) {
    name = name.slice(0, -1).trim();
  }

  return normalizeKey(name).slice(0, 200);
}

function readQuoted(
  text: string,
  quote: string,
  count: number,
): Array<string> {
  const found: Array<string> = [];
  let from: number = 0;

  while (found.length < count) {
    const open: number = text.indexOf(quote, from);
    const close: number = open < 0 ? -1 : text.indexOf(quote, open + 1);

    if (close < 0) {
      break;
    }

    found.push(text.slice(open + 1, close));
    from = close + 1;
  }

  return found;
}

/*
 * The resource a block opens, from its header: Terraform's `resource
 * "aws_s3_bucket" "assets" {`, Bicep's `resource store
 * 'Microsoft.Storage/storageAccounts@2023-01-01' = {`, a program's `new
 * aws.s3.Bucket("assets", {`.
 */
export function readResourceHeader(
  header: string,
): { type: string; label: string } | null {
  const trimmed: string = header.trim();

  if (trimmed.startsWith("resource ") || trimmed.startsWith("data ")) {
    const doubleQuoted: Array<string> = readQuoted(trimmed, '"', 2);

    if (doubleQuoted.length === 2) {
      return { type: doubleQuoted[0]!, label: doubleQuoted[1]! };
    }

    const singleQuoted: Array<string> = readQuoted(trimmed, "'", 1);

    if (singleQuoted.length === 1) {
      const words: Array<string> = trimmed
        .slice(0, trimmed.indexOf("'"))
        .trim()
        .split(" ");

      return {
        type: singleQuoted[0]!.split("@")[0] || "",
        label: words[words.length - 1] || "",
      };
    }

    return null;
  }

  const newAt: number = trimmed.indexOf("new ");

  if (newAt < 0) {
    return null;
  }

  const rest: string = trimmed.slice(newAt + 4);
  const paren: number = rest.indexOf("(");

  if (paren <= 0) {
    return null;
  }

  const args: string = rest.slice(paren);
  const label: string =
    readQuoted(args, '"', 1)[0] || readQuoted(args, "'", 1)[0] || "";

  return { type: rest.slice(0, paren).trim(), label };
}

/*
 * The "{" and "}" of a line, outside its strings and comments: how many
 * it starts with ("}", "},", "})"), and how many it opens and closes after.
 */
function readBraces(text: string): {
  leadingCloses: number;
  opens: number;
  closes: number;
} {
  let leadingCloses: number = 0;
  let opens: number = 0;
  let closes: number = 0;
  let quote: string = "";
  let isLeading: boolean = true;

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);

    if (quote) {
      if (character === "\\") {
        index++;
      } else if (character === quote) {
        quote = "";
      }

      continue;
    }

    if (character === " " || character === "\t") {
      continue;
    }

    if (character === "}" && isLeading) {
      leadingCloses++;
      continue;
    }

    if (character !== "," && character !== ")" && character !== "]") {
      isLeading = false;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (
      character === "#" ||
      (character === "/" && text.charAt(index + 1) === "/")
    ) {
      break;
    } else if (character === "{") {
      opens++;
    } else if (character === "}") {
      closes++;
    }
  }

  return { leadingCloses, opens, closes };
}

/*
 * What each line sits in, for a language of braces (Terraform, Bicep,
 * JSON, a program): the blocks open around it and its resource, read hunk
 * by hunk - a hunk starts inside whatever the file has there, and what it
 * does not show is not known.
 */
function readBraceContexts(lines: Array<PatchLine>): Array<LineContext> {
  const contexts: Array<LineContext> = [];
  let stack: Array<OpenBlock> = [];
  let hunk: number = -1;

  for (const line of lines) {
    if (line.hunk !== hunk) {
      hunk = line.hunk;
      stack = [];
    }

    const braces: { leadingCloses: number; opens: number; closes: number } =
      readBraces(line.text);

    for (let close: number = 0; close < braces.leadingCloses; close++) {
      stack.pop();
    }

    let resource: { type: string; label: string } | null = null;

    for (let index: number = stack.length - 1; index >= 0; index--) {
      if (stack[index]!.resource) {
        resource = stack[index]!.resource;
        break;
      }
    }

    const blocks: Array<string> = stack.map((block: OpenBlock): string => {
      return block.name;
    });

    contexts.push({
      blocks,
      blockKey: blocks.join("/"),
      resourceType: resource?.type || "",
      resourceLabel: resource?.label || "",
    });

    if (braces.opens > 0) {
      const header: string = line.text.slice(0, line.text.indexOf("{"));

      stack.push({
        name: blockNameOf(header),
        resource: readResourceHeader(header),
      });

      for (let open: number = 1; open < braces.opens; open++) {
        stack.push({ name: "", resource: null });
      }
    }

    // What the line opened and closed again ("{ ... }") stays closed.
    for (let close: number = 0; close < braces.closes; close++) {
      stack.pop();
    }
  }

  return contexts;
}

/*
 * What each line sits in, for YAML (CloudFormation, Kubernetes, Pulumi):
 * the keys of the mappings it is indented under, and its resource - a
 * CloudFormation resource's `Type:` beside its Properties, a Kubernetes
 * document's `kind:`.
 */
function readYamlContexts(lines: Array<PatchLine>): Array<LineContext> {
  const contexts: Array<LineContext> = [];
  let stack: Array<{ indent: number; name: string }> = [];
  let hunk: number = -1;
  // A resource's type, by the path of the mapping it is set in.
  let typeByPath: Map<string, string> = new Map<string, string>();
  let kind: string = "";

  const reset: () => void = (): void => {
    stack = [];
    typeByPath = new Map<string, string>();
    kind = "";
  };

  for (const line of lines) {
    if (line.hunk !== hunk) {
      hunk = line.hunk;
      reset();
    }

    const text: string = line.text;
    const trimmed: string = text.trim();

    if (trimmed === "---") {
      reset();
      contexts.push({
        blocks: [],
        blockKey: "",
        resourceType: "",
        resourceLabel: "",
      });
      continue;
    }

    const indent: number = indentOf(text);

    if (trimmed.length > 0 && !trimmed.startsWith("#")) {
      while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
        stack.pop();
      }
    }

    const blocks: Array<string> = stack.map(
      (entry: { indent: number; name: string }): string => {
        return entry.name;
      },
    );
    const blockKey: string = blocks.join("/");
    let resourceType: string = kind;
    let resourceLabel: string = "";

    for (let depth: number = blocks.length; depth >= 1; depth--) {
      const type: string | undefined = typeByPath.get(
        blocks.slice(0, depth).join("/"),
      );

      if (type) {
        resourceType = type;
        resourceLabel = blocks[depth - 1] || "";
        break;
      }
    }

    contexts.push({ blocks, blockKey, resourceType, resourceLabel });

    const setting: InfrastructureSetting | null = readSetting(text);

    if (!setting) {
      continue;
    }

    if (setting.normalizedKey === "type" && setting.value.includes("::")) {
      typeByPath.set(blockKey, setting.value);
    }

    if (setting.normalizedKey === "kind" && blocks.length === 0) {
      kind = setting.value;
    }

    // A mapping's key, with what it holds on the lines under it.
    if (
      setting.value === "" ||
      setting.value === "|" ||
      setting.value === ">"
    ) {
      const isListItem: boolean = text.charAt(indent) === "-";

      stack.push({
        indent: isListItem ? indent + 2 : indent,
        name: setting.normalizedKey,
      });
    }
  }

  return contexts;
}

// The ports a store listens on: a firewall open to every address on one is a store's.
const DATA_STORE_PORTS: ReadonlyArray<number> = [
  445, 1433, 1521, 2049, 2379, 3306, 5432, 5439, 5984, 6379, 6380, 7000, 7001,
  7474, 7687, 8086, 8123, 9000, 9042, 9092, 9200, 9300, 9440, 11211, 27017,
  27018, 27019,
];

// The keys a rule reads its ports from.
const PORT_KEYS: ReadonlySet<string> = new Set<string>([
  "fromport",
  "toport",
  "port",
  "ports",
  "destinationportrange",
  "destinationportranges",
  "portrange",
  "targetport",
  "containerport",
]);

// The numbers a value holds: "5432", "[5432, 6379]", "3000-3399".
export function numbersIn(value: string): Array<number> {
  const numbers: Array<number> = [];
  let current: string = "";

  for (const character of `${value} `) {
    if (character >= "0" && character <= "9") {
      if (current.length < 12) {
        current += character;
      }

      continue;
    }

    if (current) {
      numbers.push(Number(current));
      current = "";
    }
  }

  return numbers;
}

/*
 * Whether the ports of a firewall rule are a store's: one of
 * DATA_STORE_PORTS, a range around one, or every port ("-1", "*", 0 to
 * 65535). No port in sight is false: a rule open to the world on a port
 * the hunk does not show is most often a web server's.
 */
export function isStorePortOpen(
  settings: Array<InfrastructureSetting>,
): boolean {
  const ports: Array<number> = [];

  for (const setting of settings) {
    if (!PORT_KEYS.has(setting.normalizedKey)) {
      continue;
    }

    if (
      setting.value === "*" ||
      setting.value === "-1" ||
      setting.value === "all"
    ) {
      return true;
    }

    ports.push(...numbersIn(setting.value));
  }

  if (ports.length === 0) {
    return false;
  }

  const low: number = Math.min(...ports);
  const high: number = Math.max(...ports);

  if (low === 0 && high >= 65535) {
    return true;
  }

  return DATA_STORE_PORTS.some((port: number): boolean => {
    return port >= low && port <= high;
  });
}

// Whether a firewall rule lets traffic out, not in.
function isEgress(context: SettingContext): boolean {
  if (
    context.blocks.some((block: string): boolean => {
      return block === "egress" || block === "securitygroupegress";
    })
  ) {
    return true;
  }

  return context.siblings.some((setting: InfrastructureSetting): boolean => {
    return (
      (setting.normalizedKey === "type" && setting.value === "egress") ||
      (setting.normalizedKey === "direction" &&
        (setting.value === "outbound" || setting.value === "egress"))
    );
  });
}

// The resources that are a store's own firewall: open on any port, the store is open.
const STORE_FIREWALL_TYPE_PARTS: ReadonlyArray<string> = [
  "sql_firewall_rule",
  "sql_server_firewall_rule",
  "mssql_firewall_rule",
  "postgresql_firewall_rule",
  "postgresql_flexible_server_firewall_rule",
  "mysql_firewall_rule",
  "mysql_flexible_server_firewall_rule",
  "mariadb_firewall_rule",
  "redis_firewall_rule",
  "cosmosdb",
  "sql_database_instance",
  "microsoft.sql/servers/firewallrules",
  "microsoft.dbforpostgresql",
  "microsoft.dbformysql",
];

function isStoreFirewall(context: SettingContext): boolean {
  const type: string = context.resourceType.toLowerCase();

  return STORE_FIREWALL_TYPE_PARTS.some((part: string): boolean => {
    return type.includes(part);
  });
}

/*
 * A Kubernetes Service's annotation that keeps its load balancer inside
 * the network: AWS's and Azure's "...-internal: true", GKE's
 * "load-balancer-type: Internal".
 */
function isInternalLoadBalancer(setting: InfrastructureSetting): boolean {
  if (!setting.normalizedKey.includes("loadbalancer")) {
    return false;
  }

  return (
    (setting.normalizedKey.endsWith("internal") && isTrue(setting.value)) ||
    setting.value === "internal"
  );
}

// A policy whose statement allows, with no condition that narrows it.
function isUnconditionalAllow(context: SettingContext): boolean {
  const allows: boolean = context.hunkSettings.some(
    (setting: InfrastructureSetting): boolean => {
      return setting.normalizedKey === "effect" && setting.value === "allow";
    },
  );
  const isConditioned: boolean =
    context.blocks.includes("condition") ||
    context.hunkSettings.some((setting: InfrastructureSetting): boolean => {
      return setting.normalizedKey === "condition";
    });

  return allows && !isConditioned;
}

// The policies of what is no store: a queue's, a topic's.
function isNoStorePolicy(context: SettingContext): boolean {
  const type: string = context.resourceType.toLowerCase();

  return (
    type.includes("sqs") ||
    type.includes("sns") ||
    type.includes("queue") ||
    type.includes("topic") ||
    type.includes("lambda")
  );
}

function isOpenToEveryAddress(value: string): boolean {
  return (
    value.includes("0.0.0.0/0") ||
    value.includes("::/0") ||
    value === "*" ||
    value === "internet" ||
    value === "any"
  );
}

function isTrue(value: string): boolean {
  return value === "true" || value === "yes" || value === "on";
}

function isFalse(value: string): boolean {
  return value === "false" || value === "no" || value === "off";
}

// A whole number of a value, or null.
function wholeNumberOf(value: string): number | null {
  if (!value || value.length > 6) {
    return null;
  }

  for (const character of value) {
    if (character < "0" || character > "9") {
      return null;
    }
  }

  return Number(value);
}

// The TLS versions older than 1.2, as each cloud writes them, and 1.2 in their style.
const WEAK_TLS_FIXES: Readonly<Record<string, string>> = {
  tls1_0: "TLS1_2",
  tls1_1: "TLS1_2",
  tls10: "Tls12",
  tls11: "Tls12",
  "tls1.0": "TLS1.2",
  "tls1.1": "TLS1.2",
  tlsv1: "TLSv1.2",
  "tlsv1.0": "TLSv1.2",
  "tlsv1.1": "TLSv1.2",
  tlsv1_0: "TLSv1_2",
  tlsv1_1: "TLSv1_2",
  "1.0": "1.2",
  "1.1": "1.2",
  tls_1_0: "TLS_1_2",
  tls_1_1: "TLS_1_2",
  "policy-min-tls-1-0-2019-07": "Policy-Min-TLS-1-2-2019-07",
};

/*
 * One rule: the keys it reads, the blocks the key must sit in when it
 * must, whether a value fails the check, and the value that fixes it.
 */
interface InfrastructureRule {
  checkId: string;
  keys: ReadonlyArray<string>;
  inBlocks?: ReadonlyArray<string> | undefined;
  fails: (value: string, context: SettingContext) => boolean;
  // The value that fixes it, written as the line writes its value; null for none.
  safeValue?: ((rawValue: string) => string | null) | undefined;
  // What the setting does, said of "the store": "makes the store readable by anyone".
  does: string;
  // How to fix it, in a sentence.
  fix: string;
}

// A value written the way the line writes its own: quotes kept, a boolean's case kept.
function asWritten(rawValue: string, safe: string): string {
  const raw: string = trimRawValue(rawValue);

  if (raw.startsWith('"')) {
    return `"${safe}"`;
  }

  if (raw.startsWith("'")) {
    return `'${safe}'`;
  }

  if (raw === "True" || raw === "False") {
    return safe === "true" ? "True" : safe === "false" ? "False" : safe;
  }

  return safe;
}

function setTo(safe: string): (rawValue: string) => string {
  return (rawValue: string): string => {
    return asWritten(rawValue, safe);
  };
}

/*
 * A value of an enumeration, in the case the line writes it: CloudFormation
 * and Bicep write "Private", Terraform "private".
 */
function setToLike(
  lower: string,
  capitalized: string,
): (rawValue: string) => string {
  return (rawValue: string): string => {
    const raw: string = trimRawValue(rawValue);
    const first: string =
      raw.startsWith('"') || raw.startsWith("'") ? raw.charAt(1) : raw.charAt(0);
    const isCapitalized: boolean = first >= "A" && first <= "Z";

    return asWritten(rawValue, isCapitalized ? capitalized : lower);
  };
}

export const INFRASTRUCTURE_RULES: ReadonlyArray<InfrastructureRule> = [
  // Exposure.
  {
    checkId: "public-read",
    keys: ["acl", "cannedacl"],
    fails: (value: string): boolean => {
      return value === "public-read" || value === "authenticated-read";
    },
    safeValue: setTo("private"),
    does: "makes the store readable by anyone on the internet",
    fix: "Set it to private, and share what must be public through a CDN or signed links.",
  },
  {
    checkId: "public-write",
    keys: ["acl", "cannedacl"],
    fails: (value: string): boolean => {
      return value === "public-read-write";
    },
    safeValue: setTo("private"),
    does: "lets anyone on the internet change what the store holds",
    fix: "Set it to private: no store should take writes from anyone.",
  },
  {
    checkId: "public-read",
    keys: ["accesscontrol"],
    fails: (value: string): boolean => {
      return value === "publicread" || value === "authenticatedread";
    },
    safeValue: setToLike("private", "Private"),
    does: "makes the store readable by anyone on the internet",
    fix: "Set it to Private, and share what must be public through a CDN or signed links.",
  },
  {
    checkId: "public-write",
    keys: ["accesscontrol"],
    fails: (value: string): boolean => {
      return value === "publicreadwrite";
    },
    safeValue: setToLike("private", "Private"),
    does: "lets anyone on the internet change what the store holds",
    fix: "Set it to Private: no store should take writes from anyone.",
  },
  {
    checkId: "public-read",
    keys: ["predefinedacl", "predefineddefaultobjectacl"],
    fails: (value: string): boolean => {
      return value === "publicread";
    },
    safeValue: setTo("private"),
    does: "makes the store readable by anyone on the internet",
    fix: "Set it to private, and grant read to the identities that need it.",
  },
  {
    checkId: "public-write",
    keys: ["predefinedacl", "predefineddefaultobjectacl"],
    fails: (value: string): boolean => {
      return value === "publicreadwrite";
    },
    safeValue: setTo("private"),
    does: "lets anyone on the internet change what the store holds",
    fix: "Set it to private: no store should take writes from anyone.",
  },
  {
    checkId: "public-read",
    keys: ["member", "members", "entity", "specialgroup"],
    fails: (value: string): boolean => {
      return (
        value.includes("allusers") || value.includes("allauthenticatedusers")
      );
    },
    does: "grants the store's access to everyone on the internet",
    fix: "Grant the role to the identities that need it, never to allUsers or allAuthenticatedUsers.",
  },
  {
    checkId: "public-read",
    keys: ["containeraccesstype", "publicaccess"],
    fails: (value: string): boolean => {
      return value === "blob" || value === "container";
    },
    safeValue: setToLike("private", "None"),
    does: "makes the store's blobs readable by anyone on the internet",
    fix: "Set it to private (None in Bicep), and share what must be public through a CDN or SAS links.",
  },
  {
    checkId: "public-read",
    keys: ["publicreadaccess"],
    fails: isTrue,
    safeValue: setTo("false"),
    does: "makes the store readable by anyone on the internet",
    fix: "Leave public read access off, and share what must be public through a CDN.",
  },
  {
    checkId: "public-read",
    keys: ["principal", "aws", "identifiers"],
    fails: (value: string, context: SettingContext): boolean => {
      const isEveryone: boolean =
        value === "*" || value === '["*"]' || value === "['*']";

      return (
        isEveryone && isUnconditionalAllow(context) && !isNoStorePolicy(context)
      );
    },
    does: "gives everyone on the internet access to the store through its policy",
    fix: "Name the identities the policy is for, or add a condition that holds it to your own network.",
  },
  {
    checkId: "public-access-not-blocked",
    keys: [
      "blockpublicacls",
      "blockpublicpolicy",
      "ignorepublicacls",
      "restrictpublicbuckets",
    ],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "turns off a block on making the store public",
    fix: "Keep all four public access blocks on, unless the store is meant to be public.",
  },
  {
    checkId: "public-access-not-blocked",
    keys: ["allowblobpublicaccess", "allownesteditemstobepublic"],
    fails: isTrue,
    safeValue: setTo("false"),
    does: "lets the store's containers be made public",
    fix: "Turn it off, so no container of the account can be made public.",
  },
  {
    checkId: "public-access-not-blocked",
    keys: ["publicaccessprevention"],
    fails: (value: string): boolean => {
      return value === "inherited" || value === "unspecified";
    },
    safeValue: setTo("enforced"),
    does: "lets the store be made public",
    fix: "Set it to enforced, so nothing in the bucket can be made public.",
  },
  {
    checkId: "internet-reachable",
    keys: ["publiclyaccessible"],
    fails: isTrue,
    safeValue: setTo("false"),
    does: "makes the database accept connections from the internet",
    fix: "Turn it off, and reach the database from inside its network.",
  },
  {
    checkId: "internet-reachable",
    keys: ["publicnetworkaccessenabled"],
    fails: isTrue,
    safeValue: setTo("false"),
    does: "makes the store accept connections from the internet",
    fix: "Turn public network access off, and reach the store through a private endpoint.",
  },
  {
    checkId: "internet-reachable",
    keys: ["publicnetworkaccess"],
    fails: (value: string): boolean => {
      return value === "enabled";
    },
    safeValue: setToLike("disabled", "Disabled"),
    does: "makes the store accept connections from the internet",
    fix: "Set public network access to Disabled, and reach the store through a private endpoint.",
  },
  {
    checkId: "internet-reachable",
    keys: ["type"],
    fails: (value: string, context: SettingContext): boolean => {
      return (
        value === "loadbalancer" &&
        context.resourceType === "service" &&
        isStorePortOpen(context.hunkSettings) &&
        !context.hunkSettings.some(isInternalLoadBalancer)
      );
    },
    safeValue: setTo("ClusterIP"),
    does: "puts the database behind a load balancer the internet can reach",
    fix: "Keep the database's Service a ClusterIP, or make its load balancer internal.",
  },
  {
    checkId: "open-to-all-addresses",
    keys: [
      "cidrblocks",
      "ipv6cidrblocks",
      "cidripv4",
      "cidripv6",
      "cidrip",
      "sourceranges",
      "sourceaddressprefix",
      "sourceaddressprefixes",
      "loadbalancersourceranges",
      "allowedipranges",
    ],
    fails: (value: string, context: SettingContext): boolean => {
      if (!isOpenToEveryAddress(value) || isEgress(context)) {
        return false;
      }

      return isStoreFirewall(context) || isStorePortOpen(context.siblings);
    },
    does: "opens the store's firewall to every address on the internet",
    fix: "Allow only the addresses that need it: the store's own network, or a VPN's.",
  },
  {
    checkId: "open-to-all-addresses",
    keys: ["value"],
    inBlocks: ["authorizednetworks"],
    fails: (value: string): boolean => {
      return isOpenToEveryAddress(value);
    },
    does: "lets every address on the internet connect to the database",
    fix: "Authorize only the networks that need it.",
  },
  {
    checkId: "open-to-all-addresses",
    keys: ["endipaddress"],
    fails: (value: string, context: SettingContext): boolean => {
      return (
        value === "255.255.255.255" &&
        context.siblings.some((setting: InfrastructureSetting): boolean => {
          return (
            setting.normalizedKey === "startipaddress" &&
            setting.value === "0.0.0.0"
          );
        })
      );
    },
    does: "opens the store's firewall to every address on the internet",
    fix: "Allow only the addresses that need it: the store's own network, or a VPN's.",
  },
  {
    checkId: "snapshot-public",
    keys: ["sharedaccounts"],
    fails: (value: string): boolean => {
      return (
        value === "all" || value.includes('"all"') || value.includes("'all'")
      );
    },
    does: "lets anyone restore a snapshot of the store",
    fix: "Share the snapshot with no one, or with the accounts that need it, by their id.",
  },
  {
    checkId: "snapshot-shared-externally",
    keys: ["sharedaccounts"],
    fails: (value: string): boolean => {
      return (
        !value.includes("all") &&
        numbersIn(value).some((number: number): boolean => {
          return number >= 100000;
        })
      );
    },
    does: "shares a snapshot of the store with other accounts",
    fix: "Share the snapshot only with accounts of your own organization.",
  },
  // Encryption.
  {
    checkId: "not-encrypted-at-rest",
    keys: [
      "storageencrypted",
      "encrypted",
      "atrestencryptionenabled",
      "transparentdataencryptionenabled",
    ],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "turns off the store's encryption at rest",
    fix: "Turn encryption at rest on.",
  },
  {
    checkId: "not-encrypted-at-rest",
    keys: ["encryption"],
    fails: (value: string): boolean => {
      return value.endsWith("unencrypted");
    },
    does: "leaves the store unencrypted",
    fix: "Encrypt the store: with its cloud's managed key, or one of your own.",
  },
  {
    checkId: "not-encrypted-at-rest",
    keys: ["enabled"],
    inBlocks: ["encryptatrest", "encryptionatrestoptions"],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "turns off the store's encryption at rest",
    fix: "Turn encryption at rest on.",
  },
  {
    checkId: "encryption-in-transit-not-enforced",
    keys: [
      "enablehttpstrafficonly",
      "httpstrafficonlyenabled",
      "supportshttpstrafficonly",
      "sslenforcementenabled",
      "transitencryptionenabled",
      "requiressl",
      "enforcehttps",
    ],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "lets clients reach the store without encryption",
    fix: "Require encrypted connections.",
  },
  {
    checkId: "encryption-in-transit-not-enforced",
    keys: ["enablenonsslport", "nonsslportenabled"],
    fails: isTrue,
    safeValue: setTo("false"),
    does: "opens a port of the store that takes unencrypted connections",
    fix: "Keep the non-TLS port closed.",
  },
  {
    checkId: "encryption-in-transit-not-enforced",
    keys: ["sslenforcement"],
    fails: (value: string): boolean => {
      return value === "disabled";
    },
    safeValue: setToLike("enabled", "Enabled"),
    does: "lets clients reach the store without encryption",
    fix: "Set SSL enforcement to Enabled.",
  },
  {
    checkId: "encryption-in-transit-not-enforced",
    keys: ["sslmode"],
    fails: (value: string): boolean => {
      return value === "allow_unencrypted_and_encrypted";
    },
    safeValue: setTo("ENCRYPTED_ONLY"),
    does: "lets clients reach the store without encryption",
    fix: "Set the SSL mode to ENCRYPTED_ONLY.",
  },
  {
    checkId: "weak-tls",
    keys: [
      "mintlsversion",
      "minimumtlsversion",
      "minimaltlsversion",
      "tlssecuritypolicy",
      "sslminimaltlsversionenforced",
    ],
    fails: (value: string): boolean => {
      return WEAK_TLS_FIXES[value] !== undefined;
    },
    safeValue: (rawValue: string): string | null => {
      const fixed: string | undefined =
        WEAK_TLS_FIXES[normalizeValue(rawValue)];

      return fixed ? asWritten(rawValue, fixed) : null;
    },
    does: "makes the store accept TLS older than 1.2",
    fix: "Accept TLS 1.2 or newer only.",
  },
  // Recovery.
  {
    checkId: "no-backups",
    keys: [
      "backupretentionperiod",
      "backupretentiondays",
      "automatedsnapshotretentionperiod",
      "snapshotretentionlimit",
    ],
    fails: (value: string): boolean => {
      const days: number | null = wholeNumberOf(value);

      return days !== null && days < 7;
    },
    safeValue: setTo("7"),
    does: "keeps the store's backups for less than 7 days",
    fix: "Keep backups for at least 7 days.",
  },
  {
    checkId: "no-backups",
    keys: ["enabled"],
    inBlocks: ["backupconfiguration"],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "turns off the store's backups",
    fix: "Turn backups on.",
  },
  {
    checkId: "no-point-in-time-recovery",
    keys: ["enabled"],
    inBlocks: ["pointintimerecovery"],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "turns off the store's point-in-time recovery",
    fix: "Turn point-in-time recovery on.",
  },
  {
    checkId: "no-point-in-time-recovery",
    keys: ["pointintimerecoveryenabled"],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "turns off the store's point-in-time recovery",
    fix: "Turn point-in-time recovery on.",
  },
  {
    checkId: "deletion-protection-off",
    keys: ["deletionprotection", "deletionprotectionenabled"],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "lets the store be deleted in one step",
    fix: "Turn deletion protection on.",
  },
  {
    checkId: "deleted-data-not-recoverable",
    keys: ["enabled"],
    inBlocks: ["versioning"],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "turns off the store's versioning",
    fix: "Keep versioning on, so a deleted or overwritten object can be brought back.",
  },
  {
    checkId: "deleted-data-not-recoverable",
    keys: ["status"],
    inBlocks: ["versioningconfiguration"],
    fails: (value: string): boolean => {
      return value === "suspended" || value === "disabled";
    },
    safeValue: setToLike("enabled", "Enabled"),
    does: "turns off the store's versioning",
    fix: "Keep versioning Enabled, so a deleted or overwritten object can be brought back.",
  },
  {
    checkId: "deleted-data-not-recoverable",
    keys: ["versioningenabled", "isversioningenabled"],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "turns off the store's versioning",
    fix: "Keep versioning on, so a deleted or overwritten blob can be brought back.",
  },
  // Visibility.
  {
    checkId: "access-not-logged",
    keys: ["enablelogging", "islogging"],
    fails: isFalse,
    safeValue: setTo("true"),
    does: "turns off the log of who reads the store",
    fix: "Keep access logging on.",
  },
  // Access.
  {
    checkId: "shared-key-access",
    keys: ["sharedaccesskeyenabled", "allowsharedkeyaccess"],
    fails: isTrue,
    safeValue: setTo("false"),
    does: "lets anyone with the account key read everything in the store",
    fix: "Turn shared key access off, and grant access to identities.",
  },
  {
    checkId: "object-acls-enabled",
    keys: ["objectownership"],
    fails: (value: string): boolean => {
      return value === "objectwriter" || value === "bucketownerpreferred";
    },
    safeValue: setTo("BucketOwnerEnforced"),
    does: "lets each object of the store carry access rules of its own",
    fix: "Set object ownership to BucketOwnerEnforced, so the bucket's policy alone decides who reads it.",
  },
];

// The keys that name a resource in the diff: its bucket's, its instance's, its account's.
const NAME_KEYS: ReadonlySet<string> = new Set<string>([
  "bucket",
  "bucketname",
  "name",
  "identifier",
  "dbinstanceidentifier",
  "clusteridentifier",
  "dbclusteridentifier",
  "storageaccountname",
  "accountname",
  "servername",
  "tablename",
  "domainname",
  "instancename",
  "cachename",
]);

/*
 * The names a resource's own label is too common to find a store by:
 * every module has a `this` and a `main`.
 */
const COMMON_LABELS: ReadonlySet<string> = new Set<string>([
  "this",
  "main",
  "default",
  "primary",
  "secondary",
  "bucket",
  "db",
  "database",
  "example",
  "test",
  "store",
  "storage",
  "data",
  "logs",
  "backup",
  "backups",
  "resource",
]);

// A literal name: no interpolation or reference in it.
function isLiteralName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes("${") &&
    !value.includes("{{") &&
    !value.includes("(") &&
    !value.includes(" ") &&
    !value.startsWith("var.") &&
    !value.startsWith("local.") &&
    !value.startsWith("!") &&
    !value.startsWith("[")
  );
}

// A reference to another resource of the file: aws_s3_bucket.assets.id.
function readReference(value: string): { type: string; label: string } | null {
  const parts: Array<string> = value.split(".");

  if (parts.length < 2 || parts.length > 4 || !parts[0]!.includes("_")) {
    return null;
  }

  return { type: parts[0]!, label: parts[1]! };
}

/*
 * The candidates of one file of infrastructure code: what its added lines
 * set that fails one of a store's checks.
 */
export function findInfrastructureLeaks(data: {
  path: string;
  lines: Array<PatchLine>;
}): Array<SensitiveDataCandidate> {
  const kind: InfrastructureCodeKind | null = getInfrastructureKind(
    data.path,
    data.lines,
  );

  if (!kind) {
    return [];
  }

  const newLines: Array<PatchLine> = readNewLines(data.lines);
  const isYaml: boolean = YAML_EXTENSIONS.has(extensionOf(data.path));
  const contexts: Array<LineContext> = isYaml
    ? readYamlContexts(newLines)
    : readBraceContexts(newLines);
  const settings: Array<InfrastructureSetting | null> = newLines.map(
    (line: PatchLine): InfrastructureSetting | null => {
      return readSetting(line.text);
    },
  );

  // The settings of each block and of each hunk, and the names of each resource.
  const settingsByBlock: Map<string, Array<InfrastructureSetting>> = new Map<
    string,
    Array<InfrastructureSetting>
  >();
  const settingsByHunk: Map<number, Array<InfrastructureSetting>> = new Map<
    number,
    Array<InfrastructureSetting>
  >();
  const namesByResource: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

  newLines.forEach((line: PatchLine, index: number): void => {
    const setting: InfrastructureSetting | null = settings[index] || null;
    const context: LineContext = contexts[index]!;

    if (!setting) {
      return;
    }

    const blockId: string = `${line.hunk}\u0000${context.blockKey}`;
    settingsByBlock.set(blockId, [
      ...(settingsByBlock.get(blockId) || []),
      setting,
    ]);
    settingsByHunk.set(line.hunk, [
      ...(settingsByHunk.get(line.hunk) || []),
      setting,
    ]);

    if (
      context.resourceType &&
      NAME_KEYS.has(setting.normalizedKey) &&
      isLiteralName(setting.value)
    ) {
      const resourceId: string = `${context.resourceType}.${context.resourceLabel}`;
      const names: Set<string> =
        namesByResource.get(resourceId) || new Set<string>();

      names.add(setting.value);
      namesByResource.set(resourceId, names);
    }
  });

  const candidates: Array<SensitiveDataCandidate> = [];

  newLines.forEach((line: PatchLine, index: number): void => {
    const setting: InfrastructureSetting | null = settings[index] || null;

    if (
      line.kind !== PatchLineKind.Added ||
      !setting ||
      isMarkedNotSensitive(newLines, index)
    ) {
      return;
    }

    const lineContext: LineContext = contexts[index]!;
    const context: SettingContext = {
      blocks: lineContext.blocks,
      resourceType: lineContext.resourceType,
      resourceLabel: lineContext.resourceLabel,
      siblings:
        settingsByBlock.get(`${line.hunk}\u0000${lineContext.blockKey}`) || [],
      hunkSettings: settingsByHunk.get(line.hunk) || [],
    };

    for (const rule of INFRASTRUCTURE_RULES) {
      if (!rule.keys.includes(setting.normalizedKey)) {
        continue;
      }

      if (
        rule.inBlocks &&
        !context.blocks.some((block: string): boolean => {
          return rule.inBlocks!.includes(block);
        })
      ) {
        continue;
      }

      if (!rule.fails(setting.value, context)) {
        continue;
      }

      candidates.push(
        toCandidate({
          path: data.path,
          kind,
          line,
          setting,
          context,
          rule,
          namesByResource,
        }),
      );

      // One point a line: the first rule it fails says it.
      break;
    }
  });

  return candidates;
}

// The names a resource is known by in the diff: literal names first, then its label.
function namesOf(data: {
  context: SettingContext;
  namesByResource: Map<string, Set<string>>;
}): Array<string> {
  const context: SettingContext = data.context;
  const names: Array<string> = [];
  const add: (name: string) => void = (name: string): void => {
    const lower: string = name.toLowerCase();

    if (lower && !names.includes(lower)) {
      names.push(lower);
    }
  };

  for (const name of data.namesByResource.get(
    `${context.resourceType}.${context.resourceLabel}`,
  ) || []) {
    add(name);
  }

  // A resource that names another by reference is about that one: its bucket.
  for (const sibling of context.siblings) {
    if (!NAME_KEYS.has(sibling.normalizedKey)) {
      continue;
    }

    const reference: { type: string; label: string } | null = readReference(
      sibling.value,
    );

    if (reference) {
      for (const name of data.namesByResource.get(
        `${reference.type}.${reference.label}`,
      ) || []) {
        add(name);
      }

      if (names.length === 0 && !COMMON_LABELS.has(reference.label)) {
        add(reference.label);
      }
    }
  }

  if (
    names.length === 0 &&
    context.resourceLabel &&
    !COMMON_LABELS.has(context.resourceLabel.toLowerCase())
  ) {
    add(context.resourceLabel);
  }

  return names.slice(0, 10);
}

function toCandidate(data: {
  path: string;
  kind: InfrastructureCodeKind;
  line: PatchLine;
  setting: InfrastructureSetting;
  context: SettingContext;
  rule: InfrastructureRule;
  namesByResource: Map<string, Set<string>>;
}): SensitiveDataCandidate {
  const context: SettingContext = data.context;
  const resource: string = (
    context.resourceType && context.resourceLabel
      ? `${context.resourceType}.${context.resourceLabel}`
      : context.resourceType
  ).slice(0, SENSITIVE_DATA_LIMITS.maxSubjectLength);
  const subject: string = data.setting.key.slice(
    0,
    SENSITIVE_DATA_LIMITS.maxSubjectLength,
  );
  const raw: string = trimRawValue(data.setting.rawValue);
  const shownValue: string = raw.slice(0, SENSITIVE_DATA_LIMITS.maxSubjectLength);
  const safe: string | null = data.rule.safeValue
    ? data.rule.safeValue(data.setting.rawValue)
    : null;
  const replacement: string | null =
    safe !== null && raw
      ? `${data.line.text.slice(0, data.setting.valueStart)}${safe}${data.line.text.slice(
          data.setting.valueStart + raw.length,
        )}`
      : null;
  const on: string = resource ? ` on \`${resource}\`` : "";

  return {
    kind: SensitiveDataLeakKind.Infrastructure,
    checkId: data.rule.checkId,
    path: data.path,
    line: data.line.newLine,
    lineText: data.line.text,
    subject,
    ...(resource ? { where: resource } : {}),
    value: shownValue,
    dataTypes: [],
    // Until the project's store is known: as sensitive as most stores are.
    sensitivity: DataSensitivity.Confidential,
    isBlocking: PUBLIC_STORE_CHECK_IDS.includes(data.rule.checkId),
    isStoreKnown: false,
    text: `Sets \`${subject}\` to \`${shownValue}\`${on} in ${INFRASTRUCTURE_CODE_NAMES[data.kind]}, which ${data.rule.does}.`,
    fix: data.rule.fix,
    ...(replacement !== null && replacement !== data.line.text
      ? {
          suggestion: {
            startLine: data.line.newLine,
            endLine: data.line.newLine,
            original: [data.line.text],
            replacement: [replacement],
            isByAi: false,
          },
        }
      : {}),
    resourceType: context.resourceType,
    resourceNames: namesOf({
      context,
      namesByResource: data.namesByResource,
    }),
  };
}
