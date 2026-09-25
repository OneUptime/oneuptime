import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Three things the OTLP ingest fixes for issue #3978 made false, checked
 * wherever the docs repeat them: every docs page in every language, the
 * Dashboard's in-app install guides, the agent READMEs, the notes
 * `helm install` prints for the Kubernetes agent and the diagnostic scripts
 * the docs send people to.
 *
 * (a) "OneUptime needs the JSON encoder." It does not: ingest decodes the
 *     exporter's default protobuf. Worse, a collector applies configured
 *     headers over the exporter's own, so a leftover
 *     `"Content-Type": "application/json"` next to the default encoding
 *     labels protobuf bytes as JSON, and ingest picks its decoder from that
 *     header (OtelPayloadDecoder.formatFromContentType). No otlphttp exporter
 *     example may set either, unless allow-listed below with a reason.
 *     OpenTelemetryCollectorExampleDocs.test.ts pins the telemetry/
 *     open-telemetry example in full; this covers every other page. The
 *     words that went with that setup must not come back either: "JSON is
 *     required", "if using a collector, ensure encoding: json is set", and
 *     the "requires the JSON encoder" YAML comment, in every language.
 *
 *     While here, profiles: the otlphttp exporter posts profiles to
 *     <endpoint>/v1development/profiles, which ingest does not serve, so a
 *     profiles example must set profiles_endpoint to /otlp/v1/profiles (the
 *     Helm chart's own profiling exporter does, configmap-profiling.yaml).
 *
 * (b) "The proxy in front of /otlp accepts 1 MB." The bundled nginx now sets
 *     client_max_body_size on /otlp, in every server block that routes it;
 *     the RUM troubleshooting page must quote that value, read here from
 *     packages/Nginx/default.conf.template, and may name a smaller figure
 *     only for an operator's own proxy.
 *
 * (c) "OTLP answers a bad token with a silent 200, so the collector logs look
 *     clean." Ingest answers 401 (missing, unknown or expired key) or 422
 *     (disabled key, browser key); both are non-retryable, so the collector
 *     drops the batch and logs a permanent "Exporting failed" error. The
 *     phrasings that claimed otherwise, in each language they were written
 *     in, must not come back. A past-tense note about servers from before
 *     that change is fine and is not matched.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const CONTENT_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Docs/Content",
);
const DASHBOARD_SRC_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Dashboard/src",
);
const NGINX_TEMPLATE_FILE: string = path.join(
  PACKAGES_DIR,
  "Nginx/default.conf.template",
);
const OTEL_INGEST_ROUTER_FILE: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Telemetry/API/OTelIngest.ts",
);
const AGENTS_DIR: string = path.join(REPO_ROOT, "agents");
const KUBERNETES_AGENT_CHART_DIR: string = path.join(
  REPO_ROOT,
  "HelmChart/Public/kubernetes-agent",
);

const PROFILES_ROUTE: string = "/otlp/v1/profiles";
const RUM_TROUBLESHOOTING_PAGE: string = "rum/troubleshooting.md";
const KUBERNETES_AGENT_PAGE: string = "telemetry/kubernetes-agent.md";

/*
 * Exporter examples that may keep `encoding: json` or a JSON Content-Type,
 * each with the reason a reader genuinely needs it. Empty: every page that
 * had them was checked and works with the default protobuf encoding. An
 * entry that stops matching anything fails the suite, so the list cannot
 * outlive its reason.
 */
interface JsonExporterAllowance {
  // Path relative to the repository root.
  file: string;
  reason: string;
}

const JSON_EXPORTER_ALLOW_LIST: ReadonlyArray<JsonExporterAllowance> = [];

/*
 * js-yaml from Common/node_modules, as OpenTelemetryCollectorExampleDocs
 * .test.ts loads it and for the same reason: Common declares js-yaml 4, App
 * declares no YAML parser. loadAll because a docs block may hold several
 * documents (a Kubernetes manifest, say).
 */
interface JsYamlModule {
  loadAll: (text: string) => Array<unknown>;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(PACKAGES_DIR, "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

type YamlMap = { [key: string]: unknown };

interface FencedBlock {
  info: string;
  body: string;
  // 1-based line of the opening fence.
  startLine: number;
}

function isMapping(value: unknown): value is YamlMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativeToRepo(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function listFiles(
  dir: string,
  include: (file: string) => boolean,
): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        found.push(...listFiles(full, include));
      }
    } else if (include(full)) {
      found.push(full);
    }
  }

  return found.sort();
}

const fileCache: Map<string, string> = new Map<string, string>();

function read(file: string): string {
  const cached: string | undefined = fileCache.get(file);

  if (cached !== undefined) {
    return cached;
  }

  const text: string = fs.readFileSync(file, "utf8");
  fileCache.set(file, text);
  return text;
}

const OPENING_FENCE: RegExp = /^(\s*)(`{3,}|~{3,})\s*([^\s`{]*)/;

/*
 * Fenced code blocks, in page order. A closing fence is the opening
 * character repeated at least as many times with nothing else on the line;
 * an unterminated fence throws rather than dropping the block.
 */
interface OpenFence {
  indent: number;
  marker: string;
  info: string;
  startLine: number;
  body: Array<string>;
}

function fencedBlocksOf(markdown: string, where: string): Array<FencedBlock> {
  const lines: Array<string> = markdown.split(/\r?\n/);
  const blocks: Array<FencedBlock> = [];
  let open: OpenFence | null = null;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index]!;

    if (open === null) {
      const match: RegExpMatchArray | null = line.match(OPENING_FENCE);

      if (match) {
        open = {
          indent: match[1]!.length,
          marker: match[2]!,
          info: match[3]!.toLowerCase(),
          startLine: index + 1,
          body: [],
        };
      }
      continue;
    }

    const trimmed: string = line.trim();

    if (
      trimmed.length >= open.marker.length &&
      trimmed === open.marker[0]!.repeat(trimmed.length)
    ) {
      blocks.push({
        info: open.info,
        body: open.body.join("\n"),
        startLine: open.startLine,
      });
      open = null;
      continue;
    }

    let removed: number = 0;
    while (removed < open.indent && line[removed] === " ") {
      removed++;
    }
    open.body.push(line.slice(removed));
  }

  if (open !== null) {
    throw new Error(
      `${where}: unterminated code fence opened on line ${open.startLine}`,
    );
  }

  return blocks;
}

/* ------------------------------------------------------------------ (a) */

const OTLP_HTTP_EXPORTER_ID: RegExp = /^otlp_?http(\/.+)?$/;
const MENTIONS_OTLP_HTTP: RegExp = /\botlp_?http\b/;
const ABSOLUTE_HTTP_URL: RegExp = /^https?:\/\//;

/*
 * The raw-text twins of the parsed checks: a commented-out
 * `# encoding: json` parses to nothing, but a reader copies it and
 * uncomments it. Line-anchored so prose that mentions `encoding: json` as an
 * accepted option (iot-devices) is not a violation.
 */
const RAW_JSON_ENCODING_LINE: RegExp = /^\s*#?\s*encoding\s*:\s*["']?json\b/i;
const RAW_JSON_CONTENT_TYPE: RegExp =
  /["']?content-type["']?\s*:\s*["']?application\/json/i;

interface CollectorExample {
  file: string;
  startLine: number;
  config: YamlMap;
}

interface Violation {
  file: string;
  where: string;
  what: string;
}

function docsPages(): Array<string> {
  return listFiles(CONTENT_DIR, (file: string): boolean => {
    return file.endsWith(".md");
  });
}

// The Dashboard's in-app install guides: documentationMarkdown.ts and friends.
const DASHBOARD_GUIDE_FILE_NAME: RegExp = /^documentationMarkdown.*\.ts$/i;

function dashboardGuides(): Array<string> {
  return listFiles(DASHBOARD_SRC_DIR, (file: string): boolean => {
    return DASHBOARD_GUIDE_FILE_NAME.test(path.basename(file));
  });
}

/*
 * Every mapping named `exporters`, at any depth, so a collector config
 * nested inside a Helm values block or a manifest is found too.
 */
function exporterMappingsIn(value: unknown): Array<YamlMap> {
  if (Array.isArray(value)) {
    return value.flatMap(exporterMappingsIn);
  }

  if (!isMapping(value)) {
    return [];
  }

  const found: Array<YamlMap> = [];

  for (const [key, child] of Object.entries(value)) {
    if (key === "exporters" && isMapping(child)) {
      found.push(child);
    }
    found.push(...exporterMappingsIn(child));
  }

  return found;
}

function otlpHttpExportersIn(
  exporters: YamlMap,
): Array<{ id: string; exporter: YamlMap }> {
  return Object.keys(exporters)
    .filter((id: string): boolean => {
      return OTLP_HTTP_EXPORTER_ID.test(id) && isMapping(exporters[id]);
    })
    .map((id: string): { id: string; exporter: YamlMap } => {
      return { id, exporter: exporters[id] as YamlMap };
    });
}

function jsonSetupOf(exporter: YamlMap): Array<string> {
  const problems: Array<string> = [];

  if (String(exporter["encoding"]).toLowerCase() === "json") {
    problems.push("encoding: json");
  }

  const headers: unknown = exporter["headers"];

  if (isMapping(headers)) {
    for (const [name, value] of Object.entries(headers)) {
      if (
        name.toLowerCase() === "content-type" &&
        String(value).toLowerCase().includes("application/json")
      ) {
        problems.push(`headers.${name}: ${String(value)}`);
      }
    }
  }

  return problems;
}

// Collector configs from the yaml blocks of one page that name an otlphttp exporter.
function collectorExamplesOf(file: string): Array<CollectorExample> {
  const examples: Array<CollectorExample> = [];

  for (const block of fencedBlocksOf(read(file), relativeToRepo(file))) {
    if (
      !["yaml", "yml"].includes(block.info) ||
      !MENTIONS_OTLP_HTTP.test(block.body)
    ) {
      continue;
    }

    for (const document of jsYaml.loadAll(block.body)) {
      if (!isMapping(document)) {
        continue;
      }

      if (
        exporterMappingsIn(document).some((exporters: YamlMap): boolean => {
          return otlpHttpExportersIn(exporters).length > 0;
        })
      ) {
        examples.push({
          file: relativeToRepo(file),
          startLine: block.startLine,
          config: document,
        });
      }
    }
  }

  return examples;
}

function jsonExporterViolations(): Array<Violation> {
  const violations: Array<Violation> = [];

  for (const file of docsPages()) {
    for (const example of collectorExamplesOf(file)) {
      for (const exporters of exporterMappingsIn(example.config)) {
        for (const { id, exporter } of otlpHttpExportersIn(exporters)) {
          for (const problem of jsonSetupOf(exporter)) {
            violations.push({
              file: example.file,
              where: `yaml block at line ${example.startLine}, exporters.${id}`,
              what: problem,
            });
          }
        }
      }
    }

    for (const block of fencedBlocksOf(read(file), relativeToRepo(file))) {
      if (!MENTIONS_OTLP_HTTP.test(block.body)) {
        continue;
      }

      block.body.split("\n").forEach((line: string, index: number): void => {
        if (
          RAW_JSON_ENCODING_LINE.test(line) ||
          RAW_JSON_CONTENT_TYPE.test(line)
        ) {
          violations.push({
            file: relativeToRepo(file),
            where: `line ${block.startLine + 1 + index}`,
            what: line.trim(),
          });
        }
      });
    }
  }

  /*
   * The in-app guides are TypeScript with the markdown in template literals
   * (fences escaped), so they are read line by line.
   */
  for (const file of dashboardGuides()) {
    read(file)
      .split("\n")
      .forEach((line: string, index: number): void => {
        if (
          RAW_JSON_ENCODING_LINE.test(line) ||
          RAW_JSON_CONTENT_TYPE.test(line)
        ) {
          violations.push({
            file: relativeToRepo(file),
            where: `line ${index + 1}`,
            what: line.trim(),
          });
        }
      });
  }

  return violations;
}

/*
 * The words that went with that setup, in each language they were written
 * in: "`encoding: json` and the JSON Content-Type header are required", the
 * troubleshooting step "if using a collector, ensure `encoding: json` and
 * ... are set", and the YAML comment "OneUptime requires the JSON encoder
 * instead of the default Proto(buf)". Removing the exporter lines leaves
 * these behind, so (a) alone does not catch them.
 *
 * The first two are read only on lines that name `encoding: json`, the
 * collector option: REST API pages rightly require
 * `Content-Type: application/json`, and "required" alone says nothing.
 */
const NAMES_JSON_ENCODING: RegExp = /encoding:\s*["']?json\b/i;
const MENTIONS_PROTOBUF: RegExp = /protobuf/i;
const JSON_REQUIRED_WORDING: RegExp =
  /\brequired\b|\bmust\b|\bensure\b|erforderlich|stellen Sie sicher|obligatori|obbligatori|obrigatóri|asegúrate|vereist|zorg er|påkrevd|påse\b|påkrævet|sørg for|certifique-se|обязательн|убедитесь|krävs|säkerställ|\brequis\b|assurez-vous|आवश्यक|सुनिश्चित|assicurati|必須|確認します|필수|확인하세요|必需|请确保|必填|請確保/iu;
const JSON_ENCODER_COMMENT: RegExp =
  /^\s*#.*(?:JSON.*Proto\(buf\)|Proto\(buf\).*JSON)/;

/*
 * The three, verbatim, in every language that carried them: the iot-devices
 * pages before the fix (de es nl no pt ru sv zh-CN zh-TW until #3978; en da
 * fr hi it ja ko until the MQTT rewrite) and the open-telemetry example's
 * comment. Persian was translated after the fix and never had them.
 */
interface OldJsonRequirement {
  lang: string;
  prose: string;
  step: string;
  comment: string;
}

const OLD_JSON_REQUIREMENTS: ReadonlyArray<OldJsonRequirement> = [
  {
    lang: "en",
    prose:
      "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Note `encoding: json` and the `Content-Type: application/json` header are required.",
    step: "3. If using a collector, ensure `encoding: json` and `Content-Type: application/json` are set on the `otlphttp` exporter.",
    comment: "    # Requires use JSON encoder insted of default Proto(buf)",
  },
  {
    lang: "da",
    prose:
      "Bemærk, at `encoding: json` og headeren `Content-Type: application/json` er påkrævet.",
    step: "3. Hvis du bruger en collector, så sørg for, at `encoding: json` og `Content-Type: application/json` er sat på `otlphttp`-eksportøren.",
    comment:
      "    # OneUptime kræver JSON-encoderen i stedet for standard Proto(buf)",
  },
  {
    lang: "de",
    prose:
      "Beachten Sie, dass `encoding: json` und der Header `Content-Type: application/json` erforderlich sind.",
    step: "3. Wenn Sie einen Collector verwenden, stellen Sie sicher, dass `encoding: json` und `Content-Type: application/json` am `otlphttp`-Exporter gesetzt sind.",
    comment:
      "    # OneUptime erfordert den JSON-Encoder anstelle des standardmäßigen Proto(buf)",
  },
  {
    lang: "es",
    prose:
      "Ten en cuenta que `encoding: json` y el encabezado `Content-Type: application/json` son obligatorios.",
    step: "3. Si usas un collector, asegúrate de que `encoding: json` y `Content-Type: application/json` estén establecidos en el exportador `otlphttp`.",
    comment:
      "    # OneUptime requiere el codificador JSON en lugar del Proto(buf) predeterminado",
  },
  {
    lang: "fr",
    prose:
      "Notez que `encoding: json` et l'en-tête `Content-Type: application/json` sont requis.",
    step: "3. Si vous utilisez un collector, assurez-vous que `encoding: json` et `Content-Type: application/json` sont définis sur l'exportateur `otlphttp`.",
    comment:
      "    # OneUptime requiert l'encodeur JSON au lieu du Proto(buf) par défaut",
  },
  {
    lang: "hi",
    prose:
      "ध्यान दें कि `encoding: json` और `Content-Type: application/json` हेडर आवश्यक हैं।",
    step: "3. यदि कलेक्टर का उपयोग कर रहे हैं, तो सुनिश्चित करें कि `otlphttp` एक्सपोर्टर पर `encoding: json` और `Content-Type: application/json` सेट हैं।",
    comment: "    # Default Proto(buf) के बजाय JSON encoder उपयोग आवश्यक",
  },
  {
    lang: "it",
    prose:
      "Nota che `encoding: json` e l'header `Content-Type: application/json` sono obbligatori.",
    step: "3. Se usi un collector, assicurati che `encoding: json` e `Content-Type: application/json` siano impostati sull'exporter `otlphttp`.",
    comment:
      "    # OneUptime richiede l'encoder JSON anziché il Proto(buf) predefinito",
  },
  {
    lang: "ja",
    prose:
      "`encoding: json` と `Content-Type: application/json` ヘッダーが必須である点に注意してください。",
    step: "3. コレクターを使用している場合は、`otlphttp` エクスポーターに `encoding: json` と `Content-Type: application/json` が設定されていることを確認します。",
    comment:
      "    # デフォルトのProto(buf)の代わりにJSONエンコーダーを使用する必要があります",
  },
  {
    lang: "ko",
    prose:
      "`encoding: json`과 `Content-Type: application/json` 헤더가 필수임에 유의하세요.",
    step: "3. collector를 사용하는 경우, `otlphttp` 익스포터에 `encoding: json`과 `Content-Type: application/json`이 설정되어 있는지 확인하세요.",
    comment: "    # 기본 Proto(buf) 대신 JSON 인코더 사용 필요",
  },
  {
    lang: "nl",
    prose:
      "Let op: `encoding: json` en de `Content-Type: application/json`-header zijn vereist.",
    step: "3. Als je een collector gebruikt, zorg er dan voor dat `encoding: json` en `Content-Type: application/json` zijn ingesteld op de `otlphttp`-exporter.",
    comment:
      "    # OneUptime vereist de JSON-encoder in plaats van de standaard Proto(buf)",
  },
  {
    lang: "no",
    prose:
      "Merk at `encoding: json` og headeren `Content-Type: application/json` er påkrevd.",
    step: "3. Hvis du bruker en collector, påse at `encoding: json` og `Content-Type: application/json` er satt på `otlphttp`-eksportøren.",
    comment:
      "    # OneUptime krever JSON-koderen i stedet for standard Proto(buf)",
  },
  {
    lang: "pt",
    prose:
      "Observe que `encoding: json` e o cabeçalho `Content-Type: application/json` são obrigatórios.",
    step: "3. Se estiver usando um coletor, certifique-se de que `encoding: json` e `Content-Type: application/json` estejam definidos no exportador `otlphttp`.",
    comment:
      "    # O OneUptime requer o codificador JSON em vez do Proto(buf) padrão",
  },
  {
    lang: "ru",
    prose:
      "Обратите внимание, что `encoding: json` и заголовок `Content-Type: application/json` обязательны.",
    step: "3. Если используете коллектор, убедитесь, что для экспортёра `otlphttp` заданы `encoding: json` и `Content-Type: application/json`.",
    comment:
      "    # OneUptime требует кодировщик JSON вместо Proto(buf) по умолчанию",
  },
  {
    lang: "sv",
    prose:
      "Observera att `encoding: json` och headern `Content-Type: application/json` krävs.",
    step: "3. Om du använder en collector, säkerställ att `encoding: json` och `Content-Type: application/json` är inställda på `otlphttp`-exportören.",
    comment:
      "    # OneUptime kräver JSON-kodaren i stället för standardvärdet Proto(buf)",
  },
  {
    lang: "zh-CN",
    prose:
      "请注意 `encoding: json` 和 `Content-Type: application/json` 请求头是必需的。",
    step: "3. 如果使用采集器，请确保在 `otlphttp` 导出器上设置了 `encoding: json` 和 `Content-Type: application/json`。",
    comment: "    # OneUptime 要求使用 JSON 编码器，而不是默认的 Proto(buf)",
  },
  {
    lang: "zh-TW",
    prose:
      "請注意 `encoding: json` 與 `Content-Type: application/json` 標頭為必填。",
    step: "3. 如果使用 collector，請確保 `otlphttp` 匯出器上有設定 `encoding: json` 與 `Content-Type: application/json`。",
    comment: "    # OneUptime 需要 JSON 編碼器，而非預設的 Proto(buf)",
  },
];

function jsonRequiredClaimsIn(text: string): Array<string> {
  const hits: Array<string> = [];

  text.split("\n").forEach((line: string, index: number): void => {
    if (
      (NAMES_JSON_ENCODING.test(line) && JSON_REQUIRED_WORDING.test(line)) ||
      JSON_ENCODER_COMMENT.test(line)
    ) {
      hits.push(`line ${index + 1}: ${line.trim()}`);
    }
  });

  return hits;
}

function isAllowed(violation: Violation): boolean {
  return JSON_EXPORTER_ALLOW_LIST.some(
    (allowance: JsonExporterAllowance): boolean => {
      return allowance.file === violation.file;
    },
  );
}

/* ------------------------------------------------------------------ (b) */

interface NginxSize {
  megabytes: number;
  // What the template says, or the nginx default when it says nothing.
  source: string;
}

/*
 * client_max_body_size inside every `location <path> {` (one per server
 * block that routes the path), in MB: nginx's k/m/g are binary multiples, as
 * MB is used on the page. Without the directive nginx applies its 1m
 * default, which is what the page would then have to say. Comments are
 * dropped first, so neither a commented-out directive nor a brace in a
 * comment counts.
 */
function clientMaxBodySizesFor(
  template: string,
  location: string,
): Array<NginxSize> {
  const uncommented: string = template
    .split("\n")
    .map((line: string): string => {
      return line.replace(/#.*$/, "");
    })
    .join("\n");
  const opening: RegExp = new RegExp(
    `^\\s*location\\s+${location.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*\\{`,
    "gm",
  );
  const sizes: Array<NginxSize> = [];

  for (const match of uncommented.matchAll(opening)) {
    let depth: number = 0;
    let end: number = match.index! + match[0].length - 1;

    for (; end < uncommented.length; end++) {
      if (uncommented[end] === "{") {
        depth++;
      } else if (uncommented[end] === "}") {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }

    sizes.push(sizeIn(uncommented.slice(match.index, end)));
  }

  if (sizes.length === 0) {
    throw new Error(`no "location ${location} {" block in the nginx template`);
  }

  return sizes;
}

function sizeIn(body: string): NginxSize {
  const size: RegExpMatchArray | null = body.match(
    /\bclient_max_body_size\s+(\d+)([kKmMgG]?)\s*;/,
  );

  if (!size) {
    return { megabytes: 1, source: "nginx default (1m)" };
  }

  const value: number = Number(size[1]);
  const unit: string = size[2]!.toLowerCase();
  const megabytes: number =
    unit === "g"
      ? value * 1024
      : unit === "m"
        ? value
        : unit === "k"
          ? value / 1024
          : value / (1024 * 1024);

  return { megabytes, source: `client_max_body_size ${size[1]}${size[2]}` };
}

const DIGIT_SETS: ReadonlyArray<string> = [
  "0123456789",
  "۰۱۲۳۴۵۶۷۸۹", // Persian
  "٠١٢٣٤٥٦٧٨٩", // Arabic-Indic
];

function toAsciiDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (digit: string): string => {
    for (const set of DIGIT_SETS) {
      const index: number = set.indexOf(digit);
      if (index >= 0) {
        return String(index);
      }
    }
    return digit;
  });
}

// "4 MB", "۴ مگابایت": the sizes a paragraph states, in MB.
const SIZE_IN_MB: RegExp = /(\d+(?:\.\d+)?)\s*(?:MB|MiB|مگابایت)/g;

function sizesIn(text: string): Array<number> {
  return [...toAsciiDigits(text).matchAll(SIZE_IN_MB)].map(
    (match: RegExpMatchArray): number => {
      return Number(match[1]);
    },
  );
}

// Clauses split on the punctuation the pages use between them.
function clausesOf(paragraph: string): Array<string> {
  return paragraph.split(/\s[—–]\s|[.;؛]\s/);
}

function paragraph413Of(file: string): string {
  const paragraphs: Array<string> = read(file)
    .split(/\n\s*\n/)
    .filter((paragraph: string): boolean => {
      return paragraph.trimStart().startsWith("**`413`.**");
    });

  expect({ file: relativeToRepo(file), paragraphs: paragraphs.length }).toEqual(
    { file: relativeToRepo(file), paragraphs: 1 },
  );

  return paragraphs[0]!;
}

/* ------------------------------------------------------------------ (c) */

interface StaleClaim {
  name: string;
  pattern: RegExp;
}

/*
 * The phrasings the docs, READMEs, in-app guides and scripts used. The
 * multilingual one is "deliberately ... 200", in each language the
 * Kubernetes agent page is translated into, with or without the backticks
 * (the Persian profiles page wrote a bare "HTTP 200") and in Latin or
 * Persian digits.
 */
const STALE_CLAIMS: ReadonlyArray<StaleClaim> = [
  { name: "a silent 200", pattern: /silent(?:ly)?[ \t]*\\?`?200\b/i },
  {
    name: "200 even for a bad token",
    pattern:
      /\b200\\?`?[^.\n]{0,20}\beven\b[^.\n]{0,20}\b(?:bad|invalid|wrong|revoked)\b/i,
  },
  { name: "/otlp returns 200", pattern: /\/otlp returns 200\b/i },
  {
    name: "a bad token also returns 2xx",
    pattern: /\bbad (?:token|key) also returns 2xx/i,
  },
  {
    name: "deliberately ... 200",
    pattern:
      /(?:deliberately|med vilje|absichtlich|deliberadamente|عمداً|délibérément|जानबूझकर|deliberatamente|意図的に|의도적으로|bewust|намеренно|avsiktligt|刻意)[^`\n]{0,80}\\?`?(?<![0-9۰-۹.])(?:200|۲۰۰)(?![0-9۰-۹])/u,
  },
  { name: "a silent 200 (fa)", pattern: /`200`\s*خاموشی/u },
  {
    name: "the collector log looks clean",
    pattern:
      /collector logs? (?:look|looks) clean|logs? show no errors|logs no errors while/i,
  },
  {
    name: "no errors does not mean data is landing",
    pattern:
      /absence of errors does NOT mean|no errors here does \*\*not\*\* mean/i,
  },
];

function claimScannedFiles(): Array<string> {
  const agentFiles: Array<string> = fs
    .readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return entry.isDirectory();
    })
    .flatMap((entry: fs.Dirent): Array<string> => {
      return ["README.md", "troubleshoot.sh"]
        .map((name: string): string => {
          return path.join(AGENTS_DIR, entry.name, name);
        })
        .filter((file: string): boolean => {
          return fs.existsSync(file);
        });
    });

  return [
    ...docsPages(),
    ...dashboardGuides(),
    path.join(KUBERNETES_AGENT_CHART_DIR, "README.md"),
    path.join(KUBERNETES_AGENT_CHART_DIR, "troubleshoot.sh"),
    // What `helm install` / `helm upgrade` prints: the first advice most read.
    path.join(KUBERNETES_AGENT_CHART_DIR, "templates/NOTES.txt"),
    ...agentFiles,
  ];
}

function staleClaimsIn(text: string): Array<string> {
  const hits: Array<string> = [];

  text.split("\n").forEach((line: string, index: number): void => {
    for (const claim of STALE_CLAIMS) {
      if (claim.pattern.test(line)) {
        hits.push(`line ${index + 1}: ${claim.name}`);
      }
    }
  });

  return hits;
}

/* ------------------------------------------------------------------ tests */

describe("OTLP ingest claims across the docs (issue #3978)", () => {
  describe("the readers this file relies on", () => {
    it("finds collector exporters at any depth and flags only the JSON setup", () => {
      const document: unknown = jsYaml.loadAll(
        [
          "config:",
          "  exporters:",
          "    otlphttp:",
          "      encoding: json",
          "      headers:",
          '        "Content-Type": "application/json"',
          "    otlp_http/oneuptime:",
          "      encoding: proto",
          "    debug: {}",
        ].join("\n"),
      )[0];
      const exporters: Array<YamlMap> = exporterMappingsIn(document);

      expect(exporters).toHaveLength(1);
      expect(
        otlpHttpExportersIn(exporters[0]!).map(
          (found: { id: string; exporter: YamlMap }): Array<string> => {
            return [found.id, ...jsonSetupOf(found.exporter)];
          },
        ),
      ).toEqual([
        [
          "otlphttp",
          "encoding: json",
          "headers.Content-Type: application/json",
        ],
        ["otlp_http/oneuptime"],
      ]);
    });

    it("flags commented-out JSON lines but not prose that names the option", () => {
      expect(RAW_JSON_ENCODING_LINE.test("    # encoding: json")).toBe(true);
      expect(RAW_JSON_ENCODING_LINE.test('    encoding: "json"')).toBe(true);
      expect(RAW_JSON_ENCODING_LINE.test("    encoding: proto")).toBe(false);
      expect(
        RAW_JSON_ENCODING_LINE.test(
          "- Both the default protobuf encoding and `encoding: json` are accepted.",
        ),
      ).toBe(false);
      expect(
        RAW_JSON_CONTENT_TYPE.test('      "Content-Type": "application/json"'),
      ).toBe(true);
      expect(
        RAW_JSON_CONTENT_TYPE.test("headers: {content-type: application/json}"),
      ).toBe(true);
    });

    it.each(
      OLD_JSON_REQUIREMENTS.flatMap(
        (old: OldJsonRequirement): Array<[string, string]> => {
          return [
            [`${old.lang} sentence`, old.prose],
            [`${old.lang} troubleshooting step`, old.step],
            [`${old.lang} YAML comment`, old.comment],
          ];
        },
      ),
    )(
      "recognises the old %s saying JSON is required",
      (_which: string, line: string): void => {
        expect(jsonRequiredClaimsIn(line)).not.toEqual([]);
      },
    );

    it.each([
      "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.",
      "- **`otlphttp`** sendet über HTTPS an OneUptime mit angehängtem Erfassungstoken. Sowohl die standardmäßige Protobuf-Kodierung als auch `encoding: json` werden akzeptiert.",
      "- **`otlphttp`** 通过 HTTPS 携带采集令牌发送到 OneUptime。默认的 protobuf 编码和 `encoding: json` 均可接受。",
      // A REST API may well require the JSON Content-Type; only the collector option counts.
      "Requests must set the `Content-Type: application/json` header.",
      "    # Export over HTTP",
    ])("does not read %s as a JSON requirement", (line: string): void => {
      expect(jsonRequiredClaimsIn(line)).toEqual([]);
    });

    it("reads client_max_body_size from every block of the named location only, in MB", () => {
      const template: string = [
        "server {",
        "    location /otlp-other {",
        "        client_max_body_size 9M;",
        "    }",
        "    location /otlp {",
        "        set $backend http://${HOST}:${PORT};",
        "        if ($x) { set $y 1; }",
        "        # client_max_body_size 99M; a stray } in a comment",
        "        client_max_body_size 4M;",
        "    }",
        "    location /bare {",
        "        proxy_pass http://app;",
        "    }",
        "    location /kb {",
        "        client_max_body_size 512k;",
        "    }",
        "}",
        "server {",
        "    location /otlp {",
        "        client_max_body_size 2M;",
        "    }",
        "}",
      ].join("\n");

      expect(
        clientMaxBodySizesFor(template, "/otlp").map(
          (size: NginxSize): number => {
            return size.megabytes;
          },
        ),
      ).toEqual([4, 2]);
      expect(clientMaxBodySizesFor(template, "/otlp-other")).toEqual([
        { megabytes: 9, source: "client_max_body_size 9M" },
      ]);
      expect(clientMaxBodySizesFor(template, "/kb")[0]!.megabytes).toBe(0.5);
      expect(clientMaxBodySizesFor(template, "/bare")).toEqual([
        { megabytes: 1, source: "nginx default (1m)" },
      ]);
      expect(() => {
        return clientMaxBodySizesFor(template, "/missing");
      }).toThrow('no "location /missing {" block');
    });

    it("reads sizes in Latin and Persian digits", () => {
      expect(sizesIn("up to 4 MB on `/otlp`, ingress-nginx 1 MB")).toEqual([
        4, 1,
      ]);
      expect(sizesIn("تا ۴ مگابایت را می‌پذیرد — ‏۱ مگابایت است")).toEqual([
        4, 1,
      ]);
    });

    /*
     * One stale sentence per language it was written in, verbatim from the
     * pages before the fix, and the sentences that replaced them, so a
     * pattern that silently stopped matching would fail here first.
     */
    it.each([
      [
        "en",
        "This is easy to miss because the OTLP ingest endpoints deliberately return HTTP `200` even for a bad token (so a misconfigured collector can't retry-storm the server).",
      ],
      [
        "en",
        "OneUptime's OTLP endpoints deliberately return a silent `200` on a bad ingestion token (so a misconfigured collector cannot retry-flood the server), which means the collector logs look clean even when every datapoint is being dropped.",
      ],
      [
        "en",
        "(OneUptime answers a bad key with a silent `200`, so only this check proves it).",
      ],
      [
        "en",
        "which is hard to spot because the OTLP endpoints answer `200` even for a bad token",
      ],
      [
        "en (dashboard)",
        "(OneUptime's OTLP endpoints return a silent \\`200\\` on a bad ingestion key, so log inspection alone cannot tell you the key is wrong",
      ],
      [
        "en (chart NOTES.txt)",
        "ingestion key — which is silently dropped, so the collector logs look clean),",
      ],
      [
        "en (script)",
        "#   POST /otlp/v1/metrics → reachability only (returns 200 even on a bad token)",
      ],
      [
        "en (script)",
        'printf "This is the classic trap: /otlp returns 200 and drops the data, so the agent\\n"',
      ],
      [
        "en (script)",
        'detail "NOTE: a bad token ALSO returns 2xx (silent drop). The token probe below settles it."',
      ],
      ["en (script)", "# healthy and the collector logs show no errors."],
      [
        "en (script)",
        'detail "(Expected when a token is silently dropped — absence of errors does NOT mean data is landing.)"',
      ],
      [
        "da",
        "fordi OTLP-ingest-endpoints med vilje returnerer HTTP `200`, selv for et dårligt token",
      ],
      [
        "de",
        "weil die OTLP-Ingest-Endpunkte absichtlich HTTP `200` zurückgeben, selbst bei einem fehlerhaften Token",
      ],
      [
        "es",
        "porque los endpoints de ingesta de OTLP devuelven deliberadamente HTTP `200` incluso para un token incorrecto",
      ],
      [
        "fa",
        "چون نقاط پایانی دریافت OTLP عمداً حتی برای نشانه بد هم HTTP‏ `200` برمی‌گردانند",
      ],
      [
        "fa",
        "نقطه‌های پایانی OTLP در OneUptime عمداً روی توکن دریافت بد `200` خاموشی برمی‌گردانند",
      ],
      [
        "fa (profiles, no backticks)",
        "1. **توکنتان را بررسی کنید.** نقطه‌های پایانی دریافت عمداً حتی برای توکن نامعتبر هم HTTP 200 برمی‌گردانند (تا عاملی که بد پیکربندی شده کارساز را با تلاش دوباره طوفانی نکند)، یعنی یک غلط تایپی خاموش در توکن از سمت عامل نامرئی است. به‌جایش از نقطه پایانی اعتبارسنجی بپرسید:",
      ],
      [
        "fa (Persian digits)",
        "نقطه‌های پایانی دریافت عمداً HTTP ۲۰۰ برمی‌گردانند",
      ],
      [
        "fr",
        "car les points de terminaison d'ingestion OTLP renvoient délibérément un HTTP `200` même pour un jeton incorrect",
      ],
      [
        "hi",
        "क्योंकि OTLP ingest endpoints जानबूझकर एक खराब token के लिए भी HTTP `200` लौटाते हैं",
      ],
      [
        "it",
        "perché gli endpoint di ingestione OTLP restituiscono deliberatamente HTTP `200` anche per un token non valido",
      ],
      [
        "ja",
        "OTLP 取り込みエンドポイントは、不正なトークンに対しても意図的に HTTP `200` を返すため",
      ],
      [
        "ko",
        "OTLP 수집 엔드포인트는 잘못된 토큰에 대해서도 의도적으로 HTTP `200`을 반환하기 때문에",
      ],
      [
        "nl",
        "omdat de OTLP-ingest-endpoints bewust HTTP `200` retourneren, zelfs voor een ongeldig token",
      ],
      [
        "no",
        "fordi OTLP-ingest-endepunktene med vilje returnerer HTTP `200` selv for et dårlig token",
      ],
      [
        "pt",
        "porque os endpoints de ingestão OTLP retornam deliberadamente HTTP `200` mesmo para um token inválido",
      ],
      [
        "ru",
        "потому что эндпоинты приёма OTLP намеренно возвращают HTTP `200` даже для неверного токена",
      ],
      [
        "sv",
        "eftersom OTLP-ingestslutpunkterna avsiktligt returnerar HTTP `200` även för en felaktig token",
      ],
      ["zh-CN", "因为 OTLP 摄取端点即使对于错误的令牌也会刻意返回 HTTP `200`"],
      [
        "zh-TW",
        "因為 OTLP 接收端點即使對於錯誤的 token 也會刻意回傳 HTTP `200`",
      ],
    ])(
      "recognises the old %s phrasing",
      (_lang: string, sentence: string): void => {
        expect(staleClaimsIn(sentence)).not.toEqual([]);
      },
    );

    it.each([
      "OneUptime refuses such a key: the OTLP endpoints answer HTTP `401` for a missing, unknown or expired key and `422` for a disabled key or a browser key.",
      "# actually arriving. (Servers older than mid-2026 answered 200 instead and",
      'detail "NOTE: servers older than mid-2026 answered 2xx even for a bad key. The token probe below settles it."',
      "#                           predate the endpoint answer 2xx whatever the key",
      "`/otlp/v1/validate` returns 200 for the token in the deployed build.",
      "La 13 respondía `200` primero y encolaba después",
      "The poller deliberately waits 1200 ms between pages.",
      'ingestion key: OneUptime refuses it with 401/422, and the collector only logs "Exporting failed. Dropping data.", which is easy to miss), run the diagnostic',
      "1. **توکنتان را بررسی کنید.** نقطه‌های پایانی دریافت به درخواستی که توکن ندارد یا توکنش نامعتبر است با `401` پاسخ می‌دهند، اما بیشتر پروفایل‌گیرها این پاسخ را جایی که به چشم شما بیاید گزارش نمی‌کنند (برای نمونه، پروفایل‌گیر ‎.NET پاسخ‌های HTTP را فقط در سطح debug ثبت می‌کند). مستقیم از نقطه پایانی اعتبارسنجی بپرسید:",
    ])("does not flag %s", (sentence: string): void => {
      expect(staleClaimsIn(sentence)).toEqual([]);
    });
  });

  describe("(a) collector examples keep the default protobuf encoding", () => {
    it("finds the examples it is meant to check", () => {
      const files: Array<string> = docsPages()
        .filter((file: string): boolean => {
          return collectorExamplesOf(file).length > 0;
        })
        .map(relativeToRepo);

      /*
       * Guards against a reader bug turning every check below into a pass
       * over nothing: these pages all carry an otlphttp example today.
       */
      const expected: Array<string> = [
        "en/telemetry/open-telemetry.md",
        "en/telemetry/iot-devices.md",
        "en/telemetry/gemini-cli-and-copilot.md",
        "fa/telemetry/gemini-cli-and-copilot.md",
        ...SUPPORTED_DOCS_LANGUAGE_CODES.map((lang: string): string => {
          return `${lang}/telemetry/iot-devices.md`;
        }),
      ].map((page: string): string => {
        return relativeToRepo(path.join(CONTENT_DIR, page));
      });

      expect(files).toEqual(expect.arrayContaining(expected));
      expect(dashboardGuides().length).toBeGreaterThan(0);
    });

    it("sets neither encoding: json nor a JSON Content-Type on any otlphttp exporter", () => {
      const violations: Array<Violation> = jsonExporterViolations().filter(
        (violation: Violation): boolean => {
          return !isAllowed(violation);
        },
      );

      expect(violations).toEqual([]);
    });

    it("allow-lists only pages that still need it", () => {
      const violations: Array<Violation> = jsonExporterViolations();

      for (const allowance of JSON_EXPORTER_ALLOW_LIST) {
        expect({
          file: allowance.file,
          reason: allowance.reason.trim().length > 0,
          stillNeeded: violations.some((violation: Violation): boolean => {
            return violation.file === allowance.file;
          }),
        }).toEqual({ file: allowance.file, reason: true, stillNeeded: true });
      }
    });

    it("no page, guide, README or script says the JSON encoding is required", () => {
      const hits: Array<string> = claimScannedFiles().flatMap(
        (file: string): Array<string> => {
          return jsonRequiredClaimsIn(read(file)).map((hit: string): string => {
            return `${relativeToRepo(file)} ${hit}`;
          });
        },
      );

      expect(hits).toEqual([]);
    });

    /*
     * The positive half, so the check above cannot pass because the
     * sentence went missing: every IoT page, in every language, and the
     * in-app IoT guide say the exporter's default protobuf and
     * `encoding: json` are both accepted.
     */
    it.each([
      ...SUPPORTED_DOCS_LANGUAGE_CODES.map((lang: string): string => {
        return relativeToRepo(
          path.join(CONTENT_DIR, lang, "telemetry/iot-devices.md"),
        );
      }),
      relativeToRepo(
        path.join(
          DASHBOARD_SRC_DIR,
          "Pages/IoT/Utils/DocumentationMarkdown.ts",
        ),
      ),
    ])(
      "%s says protobuf and encoding: json are both accepted",
      (file: string): void => {
        const lines: Array<string> = read(path.join(REPO_ROOT, file))
          .split("\n")
          .filter((line: string): boolean => {
            return (
              NAMES_JSON_ENCODING.test(line) && MENTIONS_PROTOBUF.test(line)
            );
          });

        expect({ file, lines: lines.length }).toEqual({ file, lines: 1 });
      },
    );

    it("sends profiles to the route ingest serves, not <endpoint>/v1development/profiles", () => {
      const router: string = read(OTEL_INGEST_ROUTER_FILE);

      expect(router).toMatch(
        new RegExp(
          `router\\.post\\(\\s*"${PROFILES_ROUTE.replace(/\//g, "\\/")}"`,
        ),
      );

      const profileExporters: Array<{
        where: string;
        profilesEndpoint: unknown;
      }> = [];

      for (const file of docsPages()) {
        for (const example of collectorExamplesOf(file)) {
          const pipelines: unknown = isMapping(example.config["service"])
            ? (example.config["service"] as YamlMap)["pipelines"]
            : undefined;

          if (!isMapping(pipelines)) {
            continue;
          }

          const exporters: YamlMap = isMapping(example.config["exporters"])
            ? (example.config["exporters"] as YamlMap)
            : {};

          for (const [pipelineId, pipeline] of Object.entries(pipelines)) {
            if (
              pipelineId.split("/")[0] !== "profiles" ||
              !isMapping(pipeline)
            ) {
              continue;
            }

            const named: Array<unknown> = Array.isArray(pipeline["exporters"])
              ? (pipeline["exporters"] as Array<unknown>)
              : [];

            for (const id of named) {
              const exporter: unknown = exporters[String(id)];

              if (
                OTLP_HTTP_EXPORTER_ID.test(String(id)) &&
                isMapping(exporter)
              ) {
                profileExporters.push({
                  where: `${example.file}:${example.startLine} ${String(id)}`,
                  profilesEndpoint: exporter["profiles_endpoint"],
                });
              }
            }
          }
        }
      }

      /*
       * Most translated profiles pages still carry the collector example
       * (English now documents Pyroscope ingest instead), so an empty list
       * means the reader broke, not that there is nothing to check.
       */
      expect(profileExporters.length).toBeGreaterThan(0);

      for (const found of profileExporters) {
        const endpoint: string = String(found.profilesEndpoint);

        expect({
          where: found.where,
          path: ABSOLUTE_HTTP_URL.test(endpoint)
            ? new URL(endpoint).pathname
            : endpoint,
        }).toEqual({ where: found.where, path: PROFILES_ROUTE });
      }
    });
  });

  describe("(b) the RUM troubleshooting page quotes the /otlp body limit nginx sets", () => {
    const limits: Array<NginxSize> = clientMaxBodySizesFor(
      read(NGINX_TEMPLATE_FILE),
      "/otlp",
    );
    const limit: NginxSize = limits[0]!;

    const pages: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.map(
      (lang: string): string => {
        return path.join(CONTENT_DIR, lang, RUM_TROUBLESHOOTING_PAGE);
      },
    ).filter((file: string): boolean => {
      return fs.existsSync(file);
    });

    /*
     * The template routes /otlp in more than one server block; the page
     * states one figure, so every block has to agree on it.
     */
    it("has one /otlp limit across every server block", () => {
      expect(
        limits.map((size: NginxSize): number => {
          return size.megabytes;
        }),
      ).toEqual(
        limits.map((): number => {
          return limit.megabytes;
        }),
      );
    });

    it("exists in English, at least", () => {
      expect(pages).toContain(
        path.join(CONTENT_DIR, DEFAULT_DOCS_LANGUAGE, RUM_TROUBLESHOOTING_PAGE),
      );
    });

    it.each(pages.map(relativeToRepo))("%s", (page: string): void => {
      const paragraph: string = paragraph413Of(path.join(REPO_ROOT, page));
      const clauses: Array<string> = clausesOf(paragraph);

      // OneUptime's own limit, stated in a clause about /otlp.
      const ownLimitClauses: Array<string> = clauses.filter(
        (clause: string): boolean => {
          return (
            clause.includes("`/otlp`") &&
            sizesIn(clause).includes(limit.megabytes)
          );
        },
      );

      expect({
        page,
        nginx: limit.source,
        ownLimitClauses: ownLimitClauses.length,
      }).toEqual({ page, nginx: limit.source, ownLimitClauses: 1 });

      /*
       * Any other figure belongs to an operator's own proxy: ingress-nginx,
       * whose documented proxy-body-size default is 1m.
       */
      for (const clause of clauses) {
        for (const size of sizesIn(clause)) {
          if (size === limit.megabytes) {
            continue;
          }

          expect({ page, clause: clause.trim(), size }).toEqual({
            page,
            clause: expect.stringContaining("ingress-nginx"),
            size: 1,
          });
        }
      }

      expect(paragraph).toContain("ingress-nginx");
    });
  });

  describe("(c) nothing claims OTLP answers a bad key with 200", () => {
    it("scans the docs, the in-app guides, the READMEs, the chart's install notes and the diagnostic scripts", () => {
      const files: Array<string> = claimScannedFiles().map(relativeToRepo);

      expect(files).toEqual(
        expect.arrayContaining([
          "HelmChart/Public/kubernetes-agent/README.md",
          "HelmChart/Public/kubernetes-agent/troubleshoot.sh",
          "HelmChart/Public/kubernetes-agent/templates/NOTES.txt",
          "agents/CephAgent/troubleshoot.sh",
          "agents/DatabaseAgent/troubleshoot.sh",
          "agents/DockerSwarmAgent/troubleshoot.sh",
          "agents/ProxmoxAgent/troubleshoot.sh",
          "agents/VMwareAgent/troubleshoot.sh",
          "agents/CephAgent/README.md",
        ]),
      );
    });

    it("finds none of the old phrasings anywhere", () => {
      const hits: Array<string> = claimScannedFiles().flatMap(
        (file: string): Array<string> => {
          return staleClaimsIn(read(file)).map((hit: string): string => {
            return `${relativeToRepo(file)} ${hit}`;
          });
        },
      );

      expect(hits).toEqual([]);
    });

    /*
     * The Kubernetes agent page is the one translated into every language,
     * and the paragraph that carried the claim now says what happens.
     * Anchored on the metrics-collector `kubectl logs` step, the same
     * command in every translation; the paragraph is three lines above it.
     */
    it.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
      "%s kubernetes-agent page names the 401 / 422 refusal and the collector's log line",
      (lang: string): void => {
        const lines: Array<string> = read(
          path.join(CONTENT_DIR, lang, KUBERNETES_AGENT_PAGE),
        ).split("\n");
        const step: number = lines.findIndex((line: string): boolean => {
          return line.includes(
            "kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector`",
          );
        });

        expect({ lang, found: step >= 3 }).toEqual({ lang, found: true });

        const paragraph: string = lines[step - 3]!;

        for (const token of [
          "`401`",
          "`422`",
          "`Exporting failed. Dropping data.`",
        ]) {
          expect({ lang, token, present: paragraph.includes(token) }).toEqual({
            lang,
            token,
            present: true,
          });
        }
        expect(lines[step]).toContain("`HTTP Status Code 401`");
      },
    );
  });
});
