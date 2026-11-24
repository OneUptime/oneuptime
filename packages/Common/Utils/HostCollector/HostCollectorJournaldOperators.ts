import yaml from "js-yaml";
import { HOST_COLLECTOR_CONFIG_MAX_BYTES } from "../../Types/HostCollector/HostCollector";
import {
  JOURNALD_RECEIVER,
  JOURNALD_SYSTEMD_UNIT_ATTRIBUTE,
} from "./HostCollectorDefaultConfig";

/*
 * A COLLECTOR CONFIG'S JOURNALD RECEIVER, AND ONEUPTIME'S OPERATORS (#10127).
 *
 * OneUptime's default config for Linux hands its journald receiver
 * operators (HostCollectorDefaultConfig's JOURNALD_RECEIVER, #9748): each
 * journal line is sent as its message, under the systemd unit it is about,
 * with systemd's result and exit status for a unit that failed - what a
 * failed unit's page, the host's Systemd Units list and its Needs attention
 * say why it failed from. A Collector Config a project wrote itself before
 * that has a journald receiver with no operators: its hosts send each line
 * as the whole journal entry in JSON, under no unit, and every failed unit
 * on them says "Its journal ... does not say why". Nothing said so where
 * the config is edited.
 *
 * checkJournaldOperators reads a config for what that costs: a journald
 * receiver (journald, or journald/<name>) with no operators, or with
 * operators of its own that file no line under its unit. Operators that
 * name the unit's attribute (systemd.unit.name) are taken to do it, the
 * default's or a person's own.
 *
 * addJournaldOperators writes the default's operators under each journald
 * receiver that has none, into the config's own text: every other line,
 * key and comment stays as the person wrote it. The result is read back
 * before it is offered - the receivers now hold exactly the default's
 * operators, and nothing else of the config changed - or nothing is
 * offered. A receiver with operators of its own is never touched: two
 * lists of operators cannot be merged for someone, so the page shows the
 * default's to copy.
 *
 * React-free: the Dashboard's page and Common's tests read it alike.
 */

export enum JournaldOperatorsState {
  // No journald receiver: the config reads no journal, so nothing is missed.
  NoJournal = "no-journal",
  // Every journald receiver files each line under its unit.
  FilesUnderUnit = "files-under-unit",
  // A journald receiver has no operators: OneUptime's can be added.
  Missing = "missing",
  /*
   * A journald receiver has operators of its own, none of which files a
   * line under its unit (and none is missing them).
   */
  OwnOperators = "own-operators",
  // The YAML does not read, or is no config: its editor says why.
  Unreadable = "unreadable",
}

export interface JournaldOperatorsCheck {
  state: JournaldOperatorsState;
  /*
   * The receivers that file no line under its unit, as the config names
   * them ("journald", "journald/kernel"), in the config's order.
   */
  receivers: Array<string>;
}

// A config's receivers' names: journald's own, and its named copies.
const JOURNALD_RECEIVER_NAME: RegExp = /^journald(?:\/.*)?$/;

type ConfigMap = Record<string, unknown>;

function asMap(value: unknown): ConfigMap | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ConfigMap)
    : null;
}

/*
 * The config as the server's check reads it (HostCollectorConfigPolicy: the
 * core schema, a key twice refused), or null when it does not read as a
 * map. A config past what a save takes is not read.
 */
function readConfig(configYaml: string): ConfigMap | null {
  if (
    !configYaml.trim() ||
    configYaml.length > HOST_COLLECTOR_CONFIG_MAX_BYTES
  ) {
    return null;
  }

  try {
    return asMap(
      yaml.load(configYaml, { schema: yaml.CORE_SCHEMA, json: false }),
    );
  } catch {
    return null;
  }
}

/*
 * The default's operators, as its receiver writes them: the lines of
 * JOURNALD_RECEIVER from its `operators:` on, at the receiver's own
 * indentation (four spaces), comments included.
 */
const OPERATORS_KEY_LINE: string = "    operators:";

function getDefaultOperatorLines(): Array<string> {
  const lines: Array<string> = JOURNALD_RECEIVER.split("\n");
  const start: number = lines.indexOf(OPERATORS_KEY_LINE);

  return start === -1 ? [] : lines.slice(start);
}

const DEFAULT_OPERATOR_INDENT: number = 4;

// The default's operators, as a config reads them.
export function getDefaultJournaldOperators(): Array<unknown> {
  const receiver: ConfigMap | null = asMap(
    asMap(readConfig(`receivers:\n${JOURNALD_RECEIVER}\n`)?.["receivers"])?.[
      "journald"
    ],
  );

  return Array.isArray(receiver?.["operators"])
    ? (receiver?.["operators"] as Array<unknown>)
    : [];
}

// Whether a receiver's operators file each line under its unit.
function filesUnderUnit(operators: unknown): boolean {
  return (
    Array.isArray(operators) &&
    operators.length > 0 &&
    JSON.stringify(operators).includes(JOURNALD_SYSTEMD_UNIT_ATTRIBUTE)
  );
}

function getJournaldReceivers(
  config: ConfigMap,
): Array<{ name: string; receiver: ConfigMap | null }> {
  const receivers: ConfigMap | null = asMap(config["receivers"]);

  if (!receivers) {
    return [];
  }

  return Object.keys(receivers)
    .filter((name: string): boolean => {
      return JOURNALD_RECEIVER_NAME.test(name);
    })
    .map((name: string) => {
      return { name: name, receiver: asMap(receivers[name]) };
    });
}

export function checkJournaldOperators(
  configYaml: string | null | undefined,
): JournaldOperatorsCheck {
  const config: ConfigMap | null = readConfig(configYaml || "");

  if (!config) {
    return { state: JournaldOperatorsState.Unreadable, receivers: [] };
  }

  const journaldReceivers: Array<{ name: string; receiver: ConfigMap | null }> =
    getJournaldReceivers(config);

  if (journaldReceivers.length === 0) {
    return { state: JournaldOperatorsState.NoJournal, receivers: [] };
  }

  const missing: Array<string> = [];
  const own: Array<string> = [];

  for (const { name, receiver } of journaldReceivers) {
    const operators: unknown = receiver?.["operators"];

    if (
      operators === undefined ||
      operators === null ||
      (Array.isArray(operators) && operators.length === 0)
    ) {
      missing.push(name);
    } else if (!filesUnderUnit(operators)) {
      own.push(name);
    }
  }

  if (missing.length > 0) {
    return { state: JournaldOperatorsState.Missing, receivers: missing };
  }

  if (own.length > 0) {
    return { state: JournaldOperatorsState.OwnOperators, receivers: own };
  }

  return { state: JournaldOperatorsState.FilesUnderUnit, receivers: [] };
}

// A line's indentation, in spaces; a tab is no YAML indentation.
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

// A line that holds nothing: blank, or only a comment.
function isNothing(line: string): boolean {
  const trimmed: string = line.trim();

  return trimmed === "" || trimmed.startsWith("#");
}

// A key's line, its key written plain or in quotes, and what follows its colon.
const KEY_LINE: RegExp =
  /^(?:"([^"\\]*)"|'([^']*)'|([^\s#:'"][^:#]*?))[ \t]*:(?:[ \t]+(.*)|)$/;

// The config's receivers' own key, at the top, as a block.
const RECEIVERS_LINE: RegExp = /^receivers[ \t]*:[ \t]*(?:#.*)?$/;

// A receiver written as nothing: the block its operators go into.
const NO_VALUE: RegExp = /^(?:null|~)$/;

/*
 * Where a journald receiver's block ends in the config's lines: after its
 * last line indented under its key (a comment there is its own).
 */
function getBlockEnd(
  lines: ReadonlyArray<string>,
  keyLine: number,
  keyIndent: number,
): number {
  let end: number = keyLine + 1;

  for (let index: number = keyLine + 1; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (line.trim() === "") {
      continue;
    }

    if (indentOf(line) <= keyIndent) {
      break;
    }

    end = index + 1;
  }

  return end;
}

// The default's operator lines, at `indent` for their `operators:` key.
function getOperatorLinesAt(indent: number): Array<string> {
  return getDefaultOperatorLines().map((line: string): string => {
    if (!line.trim()) {
      return "";
    }

    return `${" ".repeat(indent)}${line.slice(DEFAULT_OPERATOR_INDENT)}`;
  });
}

// Two values a config reads to, compared as YAML's data.
function isSameData(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function addJournaldOperators(
  configYaml: string | null | undefined,
): string | null {
  const text: string = configYaml || "";
  const check: JournaldOperatorsCheck = checkJournaldOperators(text);

  if (check.state !== JournaldOperatorsState.Missing) {
    return null;
  }

  // A tab indents nothing in YAML: a config that holds one is left alone.
  if (text.includes("\t")) {
    return null;
  }

  const newline: string = text.includes("\r\n") ? "\r\n" : "\n";
  const lines: Array<string> = text.split(/\r?\n/);
  const receiversLine: number = lines.findIndex((line: string): boolean => {
    return RECEIVERS_LINE.test(line);
  });

  if (receiversLine === -1) {
    return null;
  }

  // The receivers' own indentation: their first key's.
  let receiverIndent: number = -1;

  for (let index: number = receiversLine + 1; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (isNothing(line)) {
      continue;
    }

    receiverIndent = indentOf(line);
    break;
  }

  if (receiverIndent <= 0) {
    return null;
  }

  const insertions: Array<{ at: number; lines: Array<string> }> = [];
  const toAdd: Set<string> = new Set<string>(check.receivers);

  for (let index: number = receiversLine + 1; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (isNothing(line)) {
      continue;
    }

    const indent: number = indentOf(line);

    // Past the receivers' section.
    if (indent === 0) {
      break;
    }

    if (indent !== receiverIndent) {
      continue;
    }

    const key: RegExpExecArray | null = KEY_LINE.exec(line.slice(indent));
    const name: string | undefined = key ? key[1] ?? key[2] ?? key[3] : "";

    if (!key || !name || !toAdd.has(name.trim())) {
      continue;
    }

    const value: string = (key[4] || "").trim();

    // A receiver written in one line ({ ... }) is no block to add to.
    if (value && !value.startsWith("#") && !NO_VALUE.test(value)) {
      return null;
    }

    const end: number = getBlockEnd(lines, index, indent);
    let childIndent: number = -1;

    for (let child: number = index + 1; child < end; child++) {
      if (!isNothing(lines[child] as string)) {
        childIndent = indentOf(lines[child] as string);
        break;
      }
    }

    const keyLine: string =
      value && !value.startsWith("#")
        ? // "journald: null" becomes the block its operators go into.
          line.slice(0, line.length - (key[4] || "").length).trimEnd()
        : line;

    lines[index] = keyLine;
    insertions.push({
      at: end,
      lines: getOperatorLinesAt(
        childIndent > indent ? childIndent : indent + receiverIndent,
      ),
    });
    toAdd.delete(name.trim());
  }

  // Each receiver found where the config's data says it is, or nothing.
  if (toAdd.size > 0) {
    return null;
  }

  for (const insertion of [...insertions].reverse()) {
    lines.splice(insertion.at, 0, ...insertion.lines);
  }

  const added: string = lines.join(newline);

  return isAddedAsWritten({
    before: text,
    after: added,
    receivers: check.receivers,
  })
    ? added
    : null;
}

/*
 * Whether `after` is `before` with the default's operators under each of
 * `receivers`, and nothing else of the config's data changed.
 */
function isAddedAsWritten(data: {
  before: string;
  after: string;
  receivers: ReadonlyArray<string>;
}): boolean {
  const before: ConfigMap | null = readConfig(data.before);
  const after: ConfigMap | null = readConfig(data.after);

  if (!before || !after) {
    return false;
  }

  const expected: ConfigMap = JSON.parse(JSON.stringify(before)) as ConfigMap;
  const receivers: ConfigMap | null = asMap(expected["receivers"]);

  if (!receivers) {
    return false;
  }

  for (const name of data.receivers) {
    receivers[name] = {
      ...(asMap(receivers[name]) || {}),
      operators: getDefaultJournaldOperators(),
    };
  }

  return isSameData(expected, after);
}
