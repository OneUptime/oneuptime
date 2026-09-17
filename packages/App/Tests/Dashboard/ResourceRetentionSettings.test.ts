import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Retention is applied when telemetry is written, but the only way a user can
 * configure it is through each resource's Settings page. A missing card does
 * not break ingest or compilation: the model and API keep supporting the
 * columns while that particular resource silently has no control for them.
 *
 * Keep this source-level suite independent of React. App's test install does
 * not contain the Dashboard's browser dependency tree, and these invariants
 * are wiring contracts rather than component-library behaviour (the shared
 * form has its own rendered tests in Common).
 */

const REPOSITORY_ROOT: string = path.join(__dirname, "../../..");
const DASHBOARD_SRC: string = path.join(
  REPOSITORY_ROOT,
  "App/FeatureSet/Dashboard/src",
);

interface ResourceSettingsSpec {
  resource: string;
  model: string;
}

/*
 * The standard telemetry resources whose analytics rows can inherit a
 * resource-level retention policy. Network Device and Inventory settings are
 * intentionally outside this list: they do not use this two-column retention
 * contract.
 */
const STANDARD_TELEMETRY_RESOURCES: Array<ResourceSettingsSpec> = [
  { resource: "Rum", model: "RumApplication" },
  { resource: "Cloud", model: "CloudResource" },
  { resource: "Serverless", model: "ServerlessFunction" },
  { resource: "Kubernetes", model: "KubernetesCluster" },
  { resource: "Docker", model: "DockerHost" },
  { resource: "Podman", model: "PodmanHost" },
  { resource: "DockerSwarm", model: "DockerSwarmCluster" },
  { resource: "Host", model: "Host" },
  { resource: "Ceph", model: "CephCluster" },
  { resource: "VMware", model: "VMwareVCenter" },
  { resource: "IoT", model: "IoTFleet" },
  { resource: "Proxmox", model: "ProxmoxCluster" },
  { resource: "Service", model: "Service" },
];

const SHARED_RETENTION_COMPONENT: string = "TelemetryResourceRetentionSettings";
const BLOCK_COMMENT_PATTERN: RegExp = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
const LINE_COMMENT_PATTERN: RegExp = new RegExp("(^|[^:])//[^\\n]*", "g");

function stripComments(source: string): string {
  return source
    .replace(BLOCK_COMMENT_PATTERN, " ")
    .replace(LINE_COMMENT_PATTERN, "$1");
}

function readFile(filename: string): string {
  return stripComments(fs.readFileSync(filename, "utf8"));
}

function settingsFilename(resource: string): string {
  return path.join(DASHBOARD_SRC, `Pages/${resource}/View/Settings.tsx`);
}

function resolveImport(
  importerFilename: string,
  importSpecifier: string,
): string {
  let unresolved: string;

  if (importSpecifier.startsWith("Common/")) {
    unresolved = path.join(
      REPOSITORY_ROOT,
      "Common",
      importSpecifier.slice("Common/".length),
    );
  } else {
    unresolved = path.resolve(path.dirname(importerFilename), importSpecifier);
  }

  const candidates: Array<string> = [
    unresolved,
    `${unresolved}.tsx`,
    `${unresolved}.ts`,
    path.join(unresolved, "Index.tsx"),
    path.join(unresolved, "Index.ts"),
  ];
  const resolved: string | undefined = candidates.find((candidate: string) => {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  });

  if (!resolved) {
    throw new Error(
      `Could not resolve ${importSpecifier} from ${importerFilename}`,
    );
  }

  return resolved;
}

interface RetentionSettingsSource {
  page: string;
  implementation: string;
  combined: string;
  sharedInvocation: string | null;
}

/*
 * Existing pages declare their two CardModelDetail instances inline. The new
 * pages may use that pattern or factor the duplicated cards into the shared
 * component named above. Resolve either shape so this test protects the
 * customer-visible contract instead of freezing an implementation choice.
 */
function retentionSettingsSource(
  spec: ResourceSettingsSpec,
): RetentionSettingsSource {
  const filename: string = settingsFilename(spec.resource);
  const page: string = readFile(filename);
  const importPattern: RegExp = new RegExp(
    `import\\s+${SHARED_RETENTION_COMPONENT}\\s+from\\s+["']([^"']+)["']`,
  );
  const importMatch: RegExpMatchArray | null = page.match(importPattern);

  if (!importMatch) {
    return {
      page,
      implementation: page,
      combined: page,
      sharedInvocation: null,
    };
  }

  const sharedFilename: string = resolveImport(filename, importMatch[1]!);
  const implementation: string = readFile(sharedFilename);
  const invocationPattern: RegExp = new RegExp(
    `<${SHARED_RETENTION_COMPONENT}\\b[\\s\\S]*?\\/>`,
  );
  const invocation: RegExpMatchArray | null = page.match(invocationPattern);

  expect(invocation).not.toBeNull();

  return {
    page,
    implementation,
    combined: `${page}\n${implementation}`,
    sharedInvocation: invocation?.[0] || null,
  };
}

function fieldBindingCount(source: string, field: string): number {
  const pattern: RegExp = new RegExp(
    `field\\s*:\\s*\\{\\s*${field}\\s*:\\s*true\\s*,?\\s*\\}`,
    "g",
  );

  return source.match(pattern)?.length || 0;
}

function modelDetailIds(source: string): Array<string> {
  const blocks: Array<string> = Array.from(
    source.matchAll(
      new RegExp("modelDetailProps\\s*=\\s*\\{\\{([\\s\\S]*?)\\}\\}", "g"),
    ),
  ).map((match: RegExpMatchArray): string => {
    return match[1] || "";
  });

  return blocks.flatMap((block: string): Array<string> => {
    const id: RegExpMatchArray | null = block.match(
      new RegExp("\\bid\\s*:\\s*([^,\\n]+)"),
    );

    return id?.[1] ? [id[1].trim()] : [];
  });
}

function assertOwnModelAndId(
  spec: ResourceSettingsSpec,
  source: RetentionSettingsSource,
): void {
  if (source.sharedInvocation) {
    expect(source.sharedInvocation).toContain(`modelType={${spec.model}}`);
    expect(source.sharedInvocation).toMatch(
      new RegExp("modelId\\s*=\\s*\\{\\s*modelId\\s*\\}"),
    );
  } else {
    expect(source.implementation).toContain(`modelType: ${spec.model}`);
    expect(source.implementation).toMatch(
      new RegExp("modelId\\s*:\\s*modelId"),
    );
  }

  /* The archive card is a second, independent proof of the page's identity. */
  expect(source.page).toContain(`<ArchiveResourceCard<${spec.model}>`);
  expect(source.page).toContain(`modelType={${spec.model}}`);
  expect(source.page).toMatch(
    new RegExp("modelId\\s*=\\s*\\{\\s*modelId\\s*\\}"),
  );
}

describe("standard telemetry resource retention Settings", () => {
  test("the inventory contains all 13 standard resource types", () => {
    expect(STANDARD_TELEMETRY_RESOURCES).toHaveLength(13);
  });

  test.each(STANDARD_TELEMETRY_RESOURCES)(
    "$resource binds both retention columns in editable and read views",
    (spec: ResourceSettingsSpec): void => {
      const source: RetentionSettingsSource = retentionSettingsSource(spec);

      assertOwnModelAndId(spec, source);

      /* Once in formFields and once in the read-view fields. */
      expect(
        fieldBindingCount(source.implementation, "retainTelemetryDataForDays"),
      ).toBeGreaterThanOrEqual(2);
      expect(
        fieldBindingCount(source.implementation, "telemetryRetentionConfig"),
      ).toBeGreaterThanOrEqual(2);

      expect(source.combined).toContain("TelemetryRetentionConfigForm");
      expect(source.combined).toContain("TelemetryRetentionConfigSummary");
    },
  );

  test.each(STANDARD_TELEMETRY_RESOURCES)(
    "$resource gives every retention detail card a unique DOM id",
    (spec: ResourceSettingsSpec): void => {
      const source: RetentionSettingsSource = retentionSettingsSource(spec);
      const replaySource: string =
        spec.resource === "Rum" ? rumReplaySettingsSource().combined : "";
      const ids: Array<string> = modelDetailIds(
        `${source.implementation}\n${replaySource}`,
      );

      expect(ids.length).toBeGreaterThanOrEqual(2);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  test.each(STANDARD_TELEMETRY_RESOURCES)(
    "$resource keeps archive controls after retention controls",
    (spec: ResourceSettingsSpec): void => {
      const source: RetentionSettingsSource = retentionSettingsSource(spec);
      const archivePosition: number = source.page.indexOf(
        "<ArchiveResourceCard",
      );
      const retentionPosition: number = source.sharedInvocation
        ? source.page.indexOf(source.sharedInvocation)
        : source.page.lastIndexOf("telemetryRetentionConfig: true");

      expect(retentionPosition).toBeGreaterThanOrEqual(0);
      expect(archivePosition).toBeGreaterThan(retentionPosition);
    },
  );
});

function sharedInvocationEnablesReplay(invocation: string | null): boolean {
  if (!invocation || !new RegExp("sessionReplay", "i").test(invocation)) {
    return false;
  }

  /* An explicit false is documentation, not enablement. */
  return !new RegExp(
    "sessionReplay[A-Za-z]*\\s*=\\s*\\{\\s*false\\s*\\}",
    "i",
  ).test(invocation);
}

const SESSION_REPLAY_RETENTION_COMPONENT: string =
  "SessionReplayRetentionSettingsCard";

interface ReplaySettingsSource {
  page: string;
  combined: string;
  controlPosition: number;
}

function importSpecifierFor(
  source: string,
  importedIdentifier: string,
): string | null {
  const importStatements: Array<RegExpMatchArray> = Array.from(
    source.matchAll(
      new RegExp("import\\s+[\\s\\S]*?from\\s+[\"']([^\"']+)[\"'];", "g"),
    ),
  );
  const matchingImport: RegExpMatchArray | undefined = importStatements.find(
    (statement: RegExpMatchArray): boolean => {
      return (statement[0] || "").includes(importedIdentifier);
    },
  );

  return matchingImport?.[1] || null;
}

/*
 * Replay retention has a small card of its own and may import its closed-set
 * options from a sibling helper. Follow both imports so the assertion reaches
 * the actual field and the shared allowed-day constant, while still accepting
 * a future implementation that puts the card directly in the page.
 */
function rumReplaySettingsSource(): ReplaySettingsSource {
  const pageFilename: string = settingsFilename("Rum");
  const page: string = readFile(pageFilename);
  const componentImport: string | null = importSpecifierFor(
    page,
    SESSION_REPLAY_RETENTION_COMPONENT,
  );
  let fieldOwnerFilename: string = pageFilename;
  let fieldOwner: string = page;
  let controlPosition: number = page.indexOf("sessionReplayRetentionInDays");

  if (componentImport) {
    fieldOwnerFilename = resolveImport(pageFilename, componentImport);
    fieldOwner = readFile(fieldOwnerFilename);
    controlPosition = page.indexOf(`<${SESSION_REPLAY_RETENTION_COMPONENT}`);
  }

  const optionsImport: string | null = importSpecifierFor(
    fieldOwner,
    "SESSION_REPLAY_RETENTION_OPTIONS",
  );
  const optionsSource: string = optionsImport
    ? readFile(resolveImport(fieldOwnerFilename, optionsImport))
    : "";

  return {
    page,
    combined: `${page}\n${fieldOwner}\n${optionsSource}`,
    controlPosition,
  };
}

describe("RUM session replay retention Settings", () => {
  test("RUM exposes the dedicated replay field with the closed-set dropdown", () => {
    const source: ReplaySettingsSource = rumReplaySettingsSource();

    expect(source.controlPosition).toBeGreaterThanOrEqual(0);
    expect(
      fieldBindingCount(source.combined, "sessionReplayRetentionInDays"),
    ).toBeGreaterThanOrEqual(2);
    expect(source.combined).toContain("SESSION_REPLAY_ALLOWED_RETENTION_DAYS");
    expect(source.combined).toMatch(
      new RegExp(
        "sessionReplayRetentionInDays\\s*:\\s*true\\s*\\}[\\s\\S]{0,800}" +
          "fieldType\\s*:\\s*FormFieldSchemaType\\.Dropdown",
      ),
    );

    const archivePosition: number = source.page.indexOf("<ArchiveResourceCard");

    expect(archivePosition).toBeGreaterThan(source.controlPosition);
  });

  test.each([
    { resource: "Cloud", model: "CloudResource" },
    { resource: "Serverless", model: "ServerlessFunction" },
  ])(
    "$resource does not enable the RUM-only replay retention control",
    (spec: ResourceSettingsSpec): void => {
      const source: RetentionSettingsSource = retentionSettingsSource(spec);

      expect(
        fieldBindingCount(source.page, "sessionReplayRetentionInDays"),
      ).toBe(0);
      expect(
        fieldBindingCount(
          source.implementation,
          "sessionReplayRetentionInDays",
        ),
      ).toBe(0);
      expect(source.page).not.toContain(SESSION_REPLAY_RETENTION_COMPONENT);
      expect(sharedInvocationEnablesReplay(source.sharedInvocation)).toBe(
        false,
      );
    },
  );
});
