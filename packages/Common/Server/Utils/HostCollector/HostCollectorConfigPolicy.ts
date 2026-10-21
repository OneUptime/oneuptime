import yaml from "js-yaml";
import {
  HOST_COLLECTOR_CONFIG_MAX_BYTES,
  HOST_COLLECTOR_EXPORTER_ENDPOINT,
  HOST_COLLECTOR_INGESTION_KEY_ENV,
  HOST_COLLECTOR_INGESTION_KEY_REFERENCE,
} from "../../../Types/HostCollector/HostCollector";
import {
  FORBIDDEN_COMPONENT_SETTINGS,
  HostCollectorComponentKind,
  getAllowedComponentType,
  isForbiddenFileSetting,
} from "./HostCollectorComponentCatalog";

/*
 * What a Collector Config may do, checked every time one is saved, before
 * OneUptime sends it to any host.
 *
 * A config OneUptime sends runs on every host it applies to, as the user the
 * installer gave the collector. So it is held to what a host collector is
 * for - read the host and the services on it, and send that to this
 * OneUptime - and nothing a config could use to do more:
 *
 *   - only the components HostCollectorComponentCatalog allows;
 *   - it sends only to this OneUptime: every otlphttp exporter's endpoint is
 *     ${env:ONEUPTIME_URL}/otlp, its x-oneuptime-token header is
 *     ${env:ONEUPTIME_INGESTION_KEY}, and no other exporter sends anywhere;
 *   - the only ${...} it may use is ${env:NAME}: a file, an address or a
 *     secret store (${file:...}, ${https:...}, ${s3:...}) would be read on
 *     every host and could be sent on. The ingestion key may only be the
 *     exporter's header, never data;
 *   - no setting that runs a program (journald's journalctl_path) or sends a
 *     file it reads (a *_file credential);
 *   - service.telemetry may only set the collector's own log and metric
 *     levels: its log output paths would write files on the host.
 *
 * Anything a host can still refuse (a setting the collector does not know,
 * a receiver its system does not have) is checked by the collector on the
 * host before it switches to the config: the supervisor validates it, and a
 * config that does not start is rolled back there.
 *
 * Linear in the size of the config: the text is bounded, every node is
 * visited once, and a node reached twice (a YAML alias) is refused rather
 * than walked again.
 */

export interface HostCollectorConfigProblem {
  // Where, as a dotted path into the config ("" is the whole config).
  path: string;
  message: string;
}

export interface HostCollectorConfigCheckResult {
  isValid: boolean;
  problems: Array<HostCollectorConfigProblem>;
}

type ConfigValue = unknown;

interface ConfigMap {
  [key: string]: ConfigValue;
}

const TOP_LEVEL_SECTIONS: ReadonlyArray<string> = [
  "receivers",
  "processors",
  "exporters",
  "extensions",
  "connectors",
  "service",
];

const COMPONENT_SECTIONS: ReadonlyArray<HostCollectorComponentKind> = [
  HostCollectorComponentKind.Receiver,
  HostCollectorComponentKind.Processor,
  HostCollectorComponentKind.Exporter,
  HostCollectorComponentKind.Extension,
  HostCollectorComponentKind.Connector,
];

const PIPELINE_SIGNALS: ReadonlyArray<string> = [
  "traces",
  "metrics",
  "logs",
  "profiles",
];

const SERVICE_KEYS: ReadonlyArray<string> = [
  "pipelines",
  "extensions",
  "telemetry",
];

const PIPELINE_KEYS: ReadonlyArray<string> = [
  "receivers",
  "processors",
  "exporters",
];

// The otlphttp settings that would point part of its data somewhere else.
const OTLP_HTTP_FORBIDDEN_SETTINGS: ReadonlyArray<string> = [
  "traces_endpoint",
  "metrics_endpoint",
  "logs_endpoint",
  "profiles_endpoint",
  "auth",
];

const TOKEN_HEADER: string = "x-oneuptime-token";

/*
 * How deep and how big a config may be. A collector config is a few levels
 * deep and a few hundred nodes; these bound the walk for anything else.
 */
const MAX_DEPTH: number = 32;
const MAX_NODES: number = 50000;

// Words for each kind of component, in messages.
const KIND_WORDS: Record<HostCollectorComponentKind, string> = {
  [HostCollectorComponentKind.Receiver]: "receiver",
  [HostCollectorComponentKind.Processor]: "processor",
  [HostCollectorComponentKind.Exporter]: "exporter",
  [HostCollectorComponentKind.Extension]: "extension",
  [HostCollectorComponentKind.Connector]: "connector",
};

function isMap(value: ConfigValue): value is ConfigMap {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

// The type part of a component id: "filelog" of "filelog/app".
export function getComponentTypeFromId(id: string): string {
  const slash: number = id.indexOf("/");
  return slash === -1 ? id : id.substring(0, slash);
}

function isLetter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

// An environment variable's name: a letter or _, then letters, digits or _.
export function isEnvironmentVariableName(name: string): boolean {
  if (name.length === 0 || name.length > 128) {
    return false;
  }

  for (let index: number = 0; index < name.length; index++) {
    const char: string = name.charAt(index);
    const isAllowed: boolean =
      isLetter(char) || char === "_" || (index > 0 && isDigit(char));

    if (!isAllowed) {
      return false;
    }
  }

  return true;
}

export interface ConfigReference {
  // The text between ${ and }, or the name after a bare $.
  body: string;
  isBraced: boolean;
}

/*
 * Every ${...} (and bare $NAME) a collector would expand in this text, in
 * order. $$ is a literal $, and a $ that starts neither is literal too (a
 * regular expression's end anchor). A ${ with no closing brace is reported
 * with the rest of the text as its body, so it cannot hide a reference.
 *
 * A loop with indexOf, not a regular expression: config text is written by
 * people outside OneUptime, so the scan stays linear in its length.
 */
export function findConfigReferences(text: string): Array<ConfigReference> {
  const references: Array<ConfigReference> = [];
  let index: number = text.indexOf("$");

  while (index !== -1 && index < text.length) {
    const next: string = text.charAt(index + 1);

    if (next === "$") {
      index = text.indexOf("$", index + 2);
      continue;
    }

    if (next === "{") {
      const close: number = text.indexOf("}", index + 2);
      const end: number = close === -1 ? text.length : close;
      references.push({
        body: text.substring(index + 2, end),
        isBraced: true,
      });
      index = close === -1 ? -1 : text.indexOf("$", close + 1);
      continue;
    }

    if (isLetter(next) || next === "_") {
      let end: number = index + 1;
      while (
        end < text.length &&
        (isLetter(text.charAt(end)) ||
          isDigit(text.charAt(end)) ||
          text.charAt(end) === "_")
      ) {
        end++;
      }
      references.push({
        body: text.substring(index + 1, end),
        isBraced: false,
      });
      index = text.indexOf("$", end);
      continue;
    }

    index = text.indexOf("$", index + 1);
  }

  return references;
}

/*
 * The environment variable a reference reads, or null when it reads
 * anything else: another provider (${file:...}), or a name that is not one.
 * ${env:NAME:-default} reads NAME.
 */
export function getReferencedEnvironmentVariable(
  reference: ConfigReference,
): string | null {
  if (!reference.isBraced) {
    return isEnvironmentVariableName(reference.body) ? reference.body : null;
  }

  let body: string = reference.body;

  if (body.startsWith("env:")) {
    body = body.substring("env:".length);
  } else if (body.indexOf(":") !== -1) {
    const defaultMarker: number = body.indexOf(":-");
    const colon: number = body.indexOf(":");
    // ${NAME:-default} is env too; ${scheme:value} is not.
    if (defaultMarker === -1 || colon !== defaultMarker) {
      return null;
    }
  }

  const defaultMarker: number = body.indexOf(":-");
  const name: string =
    defaultMarker === -1 ? body : body.substring(0, defaultMarker);

  if (defaultMarker !== -1) {
    const fallback: string = body.substring(defaultMarker + 2);
    if (fallback.indexOf("$") !== -1) {
      return null;
    }
  }

  return isEnvironmentVariableName(name) ? name : null;
}

class ConfigChecker {
  public problems: Array<HostCollectorConfigProblem> = [];
  // Maps and lists already walked, to refuse one reached again (an alias).
  private seen: Set<unknown> = new Set<unknown>();
  private nodeCount: number = 0;
  private hasStoppedWalking: boolean = false;

  public add(path: string, message: string): void {
    this.problems.push({ path, message });
  }

  /*
   * Visits every node once. Refuses a node reached a second time (a YAML
   * alias), one too deep, and stops counting once the config is too big.
   */
  public walk(
    value: ConfigValue,
    path: string,
    depth: number,
    visit: (node: WalkedNode) => void,
    key: string | null = null,
    section: string | null = null,
    component: string | null = null,
    parentKey: string | null = null,
  ): void {
    if (this.hasStoppedWalking) {
      return;
    }

    this.nodeCount++;
    if (this.nodeCount > MAX_NODES) {
      this.hasStoppedWalking = true;
      this.add("", "This config has too many settings to check.");
      return;
    }

    if (depth > MAX_DEPTH) {
      this.hasStoppedWalking = true;
      this.add(path, "This config nests settings too deeply to check.");
      return;
    }

    visit({ value, path, key, depth, section, component, parentKey });

    if (typeof value !== "object" || value === null) {
      return;
    }

    if (this.seen.has(value)) {
      this.add(
        path,
        "YAML anchors and aliases are not supported. Write the settings out in full.",
      );
      return;
    }
    this.seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item: ConfigValue, index: number): void => {
        this.walk(
          item,
          `${path}[${index}]`,
          depth + 1,
          visit,
          null,
          section,
          component,
          key,
        );
      });
      return;
    }

    for (const childKey of Object.keys(value)) {
      this.walk(
        (value as ConfigMap)[childKey],
        joinPath(path, childKey),
        depth + 1,
        visit,
        childKey,
        depth === 0 ? childKey : section,
        depth === 1 ? childKey : component,
        key,
      );
    }
  }
}

/*
 * One node of the config as the walk meets it. depth is 1 for a section
 * (receivers), 2 for a component (filelog/app) and 3 and more for its
 * settings; section is the top-level section it is in, component the
 * component (or pipeline) under it, and parentKey the key of the map or list
 * that holds it.
 */
interface WalkedNode {
  value: ConfigValue;
  path: string;
  key: string | null;
  depth: number;
  section: string | null;
  component: string | null;
  parentKey: string | null;
}

// A component's own settings: three levels down in a component section.
function isComponentSetting(node: WalkedNode): boolean {
  return (
    node.depth >= 3 &&
    node.section !== null &&
    (COMPONENT_SECTIONS as ReadonlyArray<string>).includes(node.section)
  );
}

export default class HostCollectorConfigPolicy {
  /*
   * Checks a config against everything above. The problems are in the
   * order a reader meets them in the config; an empty list means OneUptime
   * may send it.
   */
  public static check(text: string): HostCollectorConfigCheckResult {
    const checker: ConfigChecker = new ConfigChecker();

    if (typeof text !== "string" || text.trim().length === 0) {
      checker.add("", "The config is empty.");
      return HostCollectorConfigPolicy.result(checker);
    }

    if (Buffer.byteLength(text, "utf8") > HOST_COLLECTOR_CONFIG_MAX_BYTES) {
      checker.add(
        "",
        `The config is larger than ${Math.round(
          HOST_COLLECTOR_CONFIG_MAX_BYTES / 1024,
        )} KB.`,
      );
      return HostCollectorConfigPolicy.result(checker);
    }

    let document: ConfigValue = undefined;

    try {
      document = yaml.load(text, {
        schema: yaml.CORE_SCHEMA,
        json: false,
      });
    } catch (err) {
      const reason: string =
        err instanceof yaml.YAMLException
          ? err.message.split("\n")[0] || "it is not valid YAML"
          : "it is not valid YAML";
      checker.add("", `The config is not valid YAML: ${reason}`);
      return HostCollectorConfigPolicy.result(checker);
    }

    if (!isMap(document)) {
      checker.add(
        "",
        "The config must be a YAML map with receivers, processors, exporters and service.",
      );
      return HostCollectorConfigPolicy.result(checker);
    }

    HostCollectorConfigPolicy.checkTopLevel(document, checker);
    HostCollectorConfigPolicy.checkWholeDocument(document, checker);

    if (checker.problems.length > 0) {
      // The rest reads sections the walk above found broken.
      return HostCollectorConfigPolicy.result(checker);
    }

    const definedIds: Record<
      HostCollectorComponentKind,
      Set<string>
    > = HostCollectorConfigPolicy.checkComponents(document, checker);

    HostCollectorConfigPolicy.checkService(document, definedIds, checker);

    return HostCollectorConfigPolicy.result(checker);
  }

  /*
   * One message for an API error: the first few problems, each with where
   * it is.
   */
  public static describeProblems(
    problems: Array<HostCollectorConfigProblem>,
    limit: number = 5,
  ): string {
    const lines: Array<string> = problems
      .slice(0, limit)
      .map((problem: HostCollectorConfigProblem): string => {
        return problem.path
          ? `${problem.path}: ${problem.message}`
          : problem.message;
      });

    const more: number = problems.length - lines.length;
    if (more > 0) {
      lines.push(`and ${more} more ${more === 1 ? "problem" : "problems"}.`);
    }

    return lines.join(" ");
  }

  private static result(
    checker: ConfigChecker,
  ): HostCollectorConfigCheckResult {
    return {
      isValid: checker.problems.length === 0,
      problems: checker.problems,
    };
  }

  private static checkTopLevel(
    document: ConfigMap,
    checker: ConfigChecker,
  ): void {
    for (const key of Object.keys(document)) {
      if (!TOP_LEVEL_SECTIONS.includes(key)) {
        checker.add(
          key,
          `Unknown section. A config has ${TOP_LEVEL_SECTIONS.join(", ")}.`,
        );
      }
    }

    for (const section of COMPONENT_SECTIONS) {
      const value: ConfigValue = document[section];
      if (value !== undefined && value !== null && !isMap(value)) {
        checker.add(section, "This section must be a map of components.");
      }
    }

    if (!isMap(document["service"])) {
      checker.add(
        "service",
        "The config needs a service section with its pipelines.",
      );
    }
  }

  /*
   * What holds anywhere in a config: aliases, ${...} references, and
   * settings that send a file. Exporter headers are where the key may be.
   */
  private static checkWholeDocument(
    document: ConfigMap,
    checker: ConfigChecker,
  ): void {
    checker.walk(document, "", 0, (node: WalkedNode): void => {
      if (node.key !== null) {
        HostCollectorConfigPolicy.checkText({
          text: node.key,
          node: node,
          checker: checker,
          isKey: true,
        });

        if (isComponentSetting(node) && isForbiddenFileSetting(node.key)) {
          checker.add(
            node.path,
            "Settings that read a file and send its contents are not allowed in a config OneUptime sends to hosts.",
          );
        }
      }

      if (typeof node.value === "string") {
        HostCollectorConfigPolicy.checkText({
          text: node.value,
          node: node,
          checker: checker,
          isKey: false,
        });
      }
    });
  }

  private static checkText(data: {
    text: string;
    node: WalkedNode;
    checker: ConfigChecker;
    isKey: boolean;
  }): void {
    const { text, node, checker, isKey } = data;

    if (text.indexOf("$") === -1) {
      return;
    }

    for (const reference of findConfigReferences(text)) {
      const name: string | null = getReferencedEnvironmentVariable(reference);

      if (name === null) {
        checker.add(
          node.path,
          "The only ${...} a config OneUptime sends may use is ${env:NAME}. Files, addresses and secret stores are read on every host and are not allowed.",
        );
        continue;
      }

      if (
        name === HOST_COLLECTOR_INGESTION_KEY_ENV &&
        (isKey ||
          text !== HOST_COLLECTOR_INGESTION_KEY_REFERENCE ||
          !HostCollectorConfigPolicy.isTokenHeader(node))
      ) {
        checker.add(
          node.path,
          `\${env:${HOST_COLLECTOR_INGESTION_KEY_ENV}} may only be the ${TOKEN_HEADER} header of an exporter.`,
        );
      }
    }
  }

  /*
   * exporters.<otlphttp id>.headers.x-oneuptime-token, and nothing that
   * only reads like it: the header itself, four levels down in an otlphttp
   * exporter's headers map, so a key that holds dots
   * ("a.headers.x-oneuptime-token") is not taken for it.
   */
  private static isTokenHeader(node: WalkedNode): boolean {
    return (
      node.depth === 4 &&
      node.section === HostCollectorComponentKind.Exporter &&
      node.parentKey === "headers" &&
      node.key === TOKEN_HEADER &&
      node.component !== null &&
      getAllowedComponentType(
        HostCollectorComponentKind.Exporter,
        getComponentTypeFromId(node.component),
      ) === "otlp_http"
    );
  }

  private static checkComponents(
    document: ConfigMap,
    checker: ConfigChecker,
  ): Record<HostCollectorComponentKind, Set<string>> {
    const definedIds: Record<HostCollectorComponentKind, Set<string>> = {
      [HostCollectorComponentKind.Receiver]: new Set<string>(),
      [HostCollectorComponentKind.Processor]: new Set<string>(),
      [HostCollectorComponentKind.Exporter]: new Set<string>(),
      [HostCollectorComponentKind.Extension]: new Set<string>(),
      [HostCollectorComponentKind.Connector]: new Set<string>(),
    };

    for (const kind of COMPONENT_SECTIONS) {
      const section: ConfigValue = document[kind];
      if (!isMap(section)) {
        continue;
      }

      for (const id of Object.keys(section)) {
        const path: string = `${kind}.${id}`;
        const settings: ConfigValue = section[id];
        definedIds[kind].add(id);

        if (id.trim() !== id || id.length === 0) {
          checker.add(
            path,
            "A component's name may not start or end with a space.",
          );
          continue;
        }

        const type: string = getComponentTypeFromId(id);
        const allowedType: string | null = getAllowedComponentType(kind, type);

        if (!allowedType) {
          checker.add(
            path,
            `The ${type} ${KIND_WORDS[kind]} is not one a config OneUptime sends to hosts may use. To run it, install the collector yourself and manage its config.yaml on the host.`,
          );
          continue;
        }

        if (settings !== null && settings !== undefined && !isMap(settings)) {
          checker.add(path, "A component's settings must be a map.");
          continue;
        }

        const forbidden: ReadonlyArray<string> =
          FORBIDDEN_COMPONENT_SETTINGS[allowedType] || [];
        for (const setting of forbidden) {
          if (isMap(settings) && settings[setting] !== undefined) {
            checker.add(
              joinPath(path, setting),
              "This setting is not allowed in a config OneUptime sends to hosts.",
            );
          }
        }

        if (
          kind === HostCollectorComponentKind.Exporter &&
          allowedType === "otlp_http"
        ) {
          HostCollectorConfigPolicy.checkOneUptimeExporter(
            path,
            isMap(settings) ? settings : {},
            checker,
          );
        }
      }
    }

    return definedIds;
  }

  private static checkOneUptimeExporter(
    path: string,
    settings: ConfigMap,
    checker: ConfigChecker,
  ): void {
    if (settings["endpoint"] !== HOST_COLLECTOR_EXPORTER_ENDPOINT) {
      checker.add(
        joinPath(path, "endpoint"),
        `An otlphttp exporter sends only to this OneUptime: set its endpoint to ${HOST_COLLECTOR_EXPORTER_ENDPOINT}.`,
      );
    }

    for (const setting of OTLP_HTTP_FORBIDDEN_SETTINGS) {
      if (settings[setting] !== undefined) {
        checker.add(
          joinPath(path, setting),
          "This setting would send data somewhere else, and is not allowed.",
        );
      }
    }

    const headers: ConfigValue = settings["headers"];
    const token: ConfigValue = isMap(headers)
      ? headers[TOKEN_HEADER]
      : undefined;

    if (token !== HOST_COLLECTOR_INGESTION_KEY_REFERENCE) {
      checker.add(
        joinPath(path, `headers.${TOKEN_HEADER}`),
        `Set this header to ${HOST_COLLECTOR_INGESTION_KEY_REFERENCE}: each host sends with the key it was installed with, and a config never holds a key.`,
      );
    }
  }

  private static checkService(
    document: ConfigMap,
    definedIds: Record<HostCollectorComponentKind, Set<string>>,
    checker: ConfigChecker,
  ): void {
    const service: ConfigMap = document["service"] as ConfigMap;

    for (const key of Object.keys(service)) {
      if (!SERVICE_KEYS.includes(key)) {
        checker.add(
          `service.${key}`,
          `Unknown setting. The service section has ${SERVICE_KEYS.join(", ")}.`,
        );
      }
    }

    HostCollectorConfigPolicy.checkServiceExtensions(
      service["extensions"],
      definedIds,
      checker,
    );
    HostCollectorConfigPolicy.checkServiceTelemetry(
      service["telemetry"],
      checker,
    );

    const pipelines: ConfigValue = service["pipelines"];

    if (!isMap(pipelines) || Object.keys(pipelines).length === 0) {
      checker.add(
        "service.pipelines",
        "The config needs at least one pipeline: what to read, and where to send it.",
      );
      return;
    }

    let sendsToOneUptime: boolean = false;

    for (const id of Object.keys(pipelines)) {
      const path: string = `service.pipelines.${id}`;
      const signal: string = getComponentTypeFromId(id);
      const pipeline: ConfigValue = pipelines[id];

      if (!PIPELINE_SIGNALS.includes(signal)) {
        checker.add(
          path,
          `A pipeline is named after what it carries: ${PIPELINE_SIGNALS.join(", ")}.`,
        );
        continue;
      }

      if (!isMap(pipeline)) {
        checker.add(
          path,
          "A pipeline must be a map with its receivers and exporters.",
        );
        continue;
      }

      for (const key of Object.keys(pipeline)) {
        if (!PIPELINE_KEYS.includes(key)) {
          checker.add(
            `${path}.${key}`,
            `Unknown setting. A pipeline has ${PIPELINE_KEYS.join(", ")}.`,
          );
        }
      }

      HostCollectorConfigPolicy.checkPipelineList({
        list: pipeline["receivers"],
        path: `${path}.receivers`,
        isRequired: true,
        definedIn: [
          definedIds[HostCollectorComponentKind.Receiver],
          definedIds[HostCollectorComponentKind.Connector],
        ],
        missingMessage: "is not defined under receivers or connectors.",
        checker,
      });

      HostCollectorConfigPolicy.checkPipelineList({
        list: pipeline["processors"],
        path: `${path}.processors`,
        isRequired: false,
        definedIn: [definedIds[HostCollectorComponentKind.Processor]],
        missingMessage: "is not defined under processors.",
        checker,
      });

      const exporters: Array<string> =
        HostCollectorConfigPolicy.checkPipelineList({
          list: pipeline["exporters"],
          path: `${path}.exporters`,
          isRequired: true,
          definedIn: [
            definedIds[HostCollectorComponentKind.Exporter],
            definedIds[HostCollectorComponentKind.Connector],
          ],
          missingMessage: "is not defined under exporters or connectors.",
          checker,
        });

      for (const exporter of exporters) {
        if (
          definedIds[HostCollectorComponentKind.Exporter].has(exporter) &&
          getAllowedComponentType(
            HostCollectorComponentKind.Exporter,
            getComponentTypeFromId(exporter),
          ) === "otlp_http"
        ) {
          sendsToOneUptime = true;
        }
      }
    }

    if (!sendsToOneUptime && checker.problems.length === 0) {
      checker.add(
        "service.pipelines",
        "No pipeline sends to OneUptime: add the otlphttp exporter to at least one.",
      );
    }
  }

  // The component ids a pipeline list names, after checking each.
  private static checkPipelineList(data: {
    list: ConfigValue;
    path: string;
    isRequired: boolean;
    definedIn: Array<Set<string>>;
    missingMessage: string;
    checker: ConfigChecker;
  }): Array<string> {
    if (data.list === undefined || data.list === null) {
      if (data.isRequired) {
        data.checker.add(data.path, "This list is required.");
      }
      return [];
    }

    if (
      !Array.isArray(data.list) ||
      (data.isRequired && data.list.length === 0)
    ) {
      data.checker.add(data.path, "This must be a list of component names.");
      return [];
    }

    const ids: Array<string> = [];

    data.list.forEach((item: ConfigValue, index: number): void => {
      if (typeof item !== "string") {
        data.checker.add(
          `${data.path}[${index}]`,
          "This must be a component name.",
        );
        return;
      }

      const isDefined: boolean = data.definedIn.some(
        (defined: Set<string>): boolean => {
          return defined.has(item);
        },
      );

      if (!isDefined) {
        data.checker.add(
          `${data.path}[${index}]`,
          `${item} ${data.missingMessage}`,
        );
        return;
      }

      ids.push(item);
    });

    return ids;
  }

  private static checkServiceExtensions(
    extensions: ConfigValue,
    definedIds: Record<HostCollectorComponentKind, Set<string>>,
    checker: ConfigChecker,
  ): void {
    if (extensions === undefined || extensions === null) {
      return;
    }

    if (!Array.isArray(extensions)) {
      checker.add(
        "service.extensions",
        "This must be a list of extension names.",
      );
      return;
    }

    extensions.forEach((item: ConfigValue, index: number): void => {
      if (
        typeof item !== "string" ||
        !definedIds[HostCollectorComponentKind.Extension].has(item)
      ) {
        checker.add(
          `service.extensions[${index}]`,
          "This extension is not defined under extensions.",
        );
      }
    });
  }

  /*
   * The collector's own logs and metrics. Only their levels: output paths
   * write files on the host, and readers and processors send the
   * collector's telemetry to an address of their own.
   */
  private static checkServiceTelemetry(
    telemetry: ConfigValue,
    checker: ConfigChecker,
  ): void {
    if (telemetry === undefined || telemetry === null) {
      return;
    }

    if (!isMap(telemetry)) {
      checker.add("service.telemetry", "This must be a map.");
      return;
    }

    for (const key of Object.keys(telemetry)) {
      const value: ConfigValue = telemetry[key];
      const isLevelOnly: boolean =
        (key === "logs" || key === "metrics") &&
        isMap(value) &&
        Object.keys(value).every((setting: string): boolean => {
          return setting === "level";
        });

      if (!isLevelOnly) {
        checker.add(
          `service.telemetry.${key}`,
          "A config OneUptime sends may only set service.telemetry.logs.level and service.telemetry.metrics.level.",
        );
      }
    }
  }
}
