/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced - same idiom as
 * RumDocsFacts.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import {
  RUM_ANDROID_SETUP_DOCS_URL,
  RUM_MOBILE_SETUP_DOCS_URL,
} from "../../../FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import OtelIngestBaseService from "../../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import { DocsFence, readPage, scanMarkdown } from "./DocsContentSupport";
import { sectionInLanguage } from "./NetworkDocsLabels";
import { ANDROID_SETUP, MOBILE_SETUP } from "./RumDocsPages";
import InventoryItem, {
  ExtractedEntity,
} from "Common/Server/Utils/Telemetry/TelemetryEntity";
import { INVENTORY_ASSET_ATTRIBUTE_KEYS } from "Common/Utils/Inventory/InventoryAssetDetails";
import {
  ESPER_DEVICE_NAME_PLACEHOLDER,
  ESPER_PLACEHOLDERS_MIN_AGENT_VERSION,
  ESPER_SERIAL_NUMBER_PLACEHOLDER,
  MANAGED_DEVICE_HOST_NAME_ATTRIBUTE,
  MANAGED_DEVICE_SERIAL_NUMBER_ATTRIBUTE,
  canonicalizeManagedDeviceIdentity,
  getManagedDeviceHostName,
} from "Common/Types/DeviceManagement/ManagedDeviceIdentity";
import { keyForHost } from "Common/Utils/Telemetry/EntityKey";
import {
  ANR_EXCEPTION_TYPE,
  MOBILE_APP_FAULT_EVENT_NAMES,
  MobileAppFaultKind,
  getMobileAppFaultKind,
} from "Common/Utils/Telemetry/MobileAppFaults";
import { SESSION_ID_ATTRIBUTE_KEYS } from "Common/Utils/Telemetry/CorrelationIdAttributes";
import { APP_INSTALLATION_ID_ATTRIBUTE } from "Common/Types/Rum/MobileAppTelemetry";
import {
  MOBILE_ANR_RATE_PERCENT,
  MOBILE_CRASH_RATE_PERCENT,
  getRumAlertTemplateById,
} from "Common/Types/Monitor/RumAlertTemplates";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import EntityType from "Common/Types/Telemetry/EntityType";
import { describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #9533: the Android Setup page (docs/rum/android-setup), held to the
 * product it describes. What the page tells a reader OneUptime does with
 * OpenTelemetry Android's telemetry - crashes and ANRs as unhandled
 * exceptions, the type an ANR is listed under, a kiosk named in host.name
 * reaching Inventory as a host and never Hosts, how long a silent device
 * stays - is read here from the code that does it, so the page and the
 * product cannot drift apart. RumDocsTranslations holds every translation to
 * this English page.
 *
 * What the page says about the SDK itself (its coordinates, its DSL, its
 * event names and resource) was read from OpenTelemetry Android 1.8.1's
 * source; the Kotlin is not compiled here.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");

const SOURCES: Record<string, string> = {
  pruneStaleEntities:
    "packages/App/FeatureSet/Workers/Jobs/TelemetryEntity/PruneStaleEntities.ts",
  telemetryIngestMiddleware:
    "packages/Common/Server/Middleware/TelemetryIngest.ts",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

function section(heading: string): string {
  return sectionInLanguage("en", ANDROID_SETUP, heading);
}

function fences(language: string): Array<DocsFence> {
  return scanMarkdown(englishPage(ANDROID_SETUP)).fences.filter(
    (fence: DocsFence): boolean => {
      return fence.lang === language;
    },
  );
}

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

/*
 * The resource OpenTelemetry Android 1.8.1 builds (core's AndroidResource),
 * over which the page's `resource { }` block puts its keys.
 */
const AGENT_RESOURCE: Record<string, string> = {
  "service.name": "Kiosk Ordering",
  "service.version": "4.2.0",
  "telemetry.sdk.name": "opentelemetry",
  "telemetry.sdk.language": "java",
  "telemetry.sdk.version": "1.8.1-alpha",
  "device.model.identifier": "Elo-i3-15",
  "device.model.name": "Elo-i3-15",
  "device.manufacturer": "Elo Touch Solutions",
  "os.name": "Android",
  "os.type": "linux",
  "os.version": "13",
  "os.build_id": "TQ3A.230901.001",
  "os.description": "Android Version 13 (Build TQ3A.230901.001 API level 33)",
  "android.os.api_level": "33",
  "app.installation.id": "0f5c8e2a-6a39-4f0e-9d0e-6c1b7f2a9e41",
};

/*
 * The `put("key", value)` lines of the page's kiosk resource block, with
 * each value the page leaves to a variable given one.
 */
function kioskResourceFromPage(): Record<string, string> {
  const block: DocsFence | undefined = fences("kotlin").find(
    (fence: DocsFence): boolean => {
      return fence.code.includes('put("host.name"');
    },
  );

  expect(block).toBeDefined();

  const values: Record<string, string> = {
    deviceName: "store-0412-kiosk-02",
    serialNumber: "R9J1A2B3C4",
  };
  const resource: Record<string, string> = {};

  for (const match of block!.code.matchAll(
    /put\("([^"]+)",\s*(?:"([^"]*)"|(\w+))\)/g,
  )) {
    resource[match[1]!] = match[2] ?? (values[match[3]!] as string);
  }

  return resource;
}

function kioskAttributes(): JSONArray {
  return Object.entries({ ...AGENT_RESOURCE, ...kioskResourceFromPage() }).map(
    ([key, value]: [string, string]): JSONObject => {
      return stringAttribute(key, value);
    },
  ) as JSONArray;
}

describe("the page in the docs and in the product", () => {
  it("is the page the Dashboard's mobile guide links Android readers to", () => {
    expect(RUM_ANDROID_SETUP_DOCS_URL).toBe(`/docs/${ANDROID_SETUP}`);
  });

  it("is linked from Mobile Setup's Android tab, and links back to it", () => {
    expect(englishPage(MOBILE_SETUP)).toContain(
      `[Android Setup](${RUM_ANDROID_SETUP_DOCS_URL})`,
    );
    expect(englishPage(ANDROID_SETUP)).toContain(
      `[Mobile Setup](${RUM_MOBILE_SETUP_DOCS_URL})`,
    );
  });
});

describe("crashes and ANRs, as ingest files them", () => {
  const reports: string = section("## What it reports");

  it("names the crash event the current agent sends, which ingest reads as a crash", () => {
    expect(reports).toContain("An `app.crash` event");
    expect(MOBILE_APP_FAULT_EVENT_NAMES[MobileAppFaultKind.Crash]).toContain(
      "app.crash",
    );
    expect(getMobileAppFaultKind({ "event.name": "app.crash" })).toBe(
      MobileAppFaultKind.Crash,
    );
  });

  it("names the ANR event, which ingest reads as an ANR", () => {
    expect(reports).toContain("A `device.anr` event");
    expect(getMobileAppFaultKind({ "event.name": "device.anr" })).toBe(
      MobileAppFaultKind.Anr,
    );
  });

  it("lists an ANR under the type ingest gives it", () => {
    expect(reports).toContain(`under the type \`${ANR_EXCEPTION_TYPE}\``);
  });

  it("says both reach Exceptions as unhandled", () => {
    expect(reports).toMatch(
      /\| Crashes \| [^|]+\| \*\*Exceptions\*\*, as unhandled \|/,
    );
    expect(reports).toMatch(
      /\| ANRs \| [^|]+\| \*\*Exceptions\*\*, as unhandled, under the type `ANR` \|/,
    );
  });

  it("finds a session by the key ingest reads a session id from", () => {
    expect(SESSION_ID_ATTRIBUTE_KEYS[0]).toBe("session.id");
    expect(reports).toContain("searched with `@session.id:`");
  });

  /*
   * #9716: crash-free installs, from the install key the Overview's reads
   * count, and the crash and ANR rate recommendations' own thresholds.
   */
  it("names the install key the Overview counts crash-free installs by", () => {
    expect(APP_INSTALLATION_ID_ATTRIBUTE).toBe("app.installation.id");
    expect(reports).toContain(
      `Under **Crash-free sessions**, the line reads the same share of installs: the \`${APP_INSTALLATION_ID_ATTRIBUTE}\` OpenTelemetry Android 1.1 and later set`,
    );
  });

  it("states the rate recommendations' thresholds as they alert", () => {
    expect(getRumAlertTemplateById("rum-app-crash-rate")?.name).toBe(
      "App Crash Rate",
    );
    expect(getRumAlertTemplateById("rum-app-anr-rate")?.name).toBe(
      "App ANR Rate",
    );
    expect(reports).toContain(
      `above Android vitals' ${MOBILE_CRASH_RATE_PERCENT}% and ${MOBILE_ANR_RATE_PERCENT}%`,
    );
    expect(reports).toContain("**App Crash Rate** and **App ANR Rate**");
  });
});

describe("the endpoint and the key", () => {
  it("sends with the header ingest reads the key from", () => {
    expect(source("telemetryIngestMiddleware")).toContain(
      '"x-oneuptime-token"',
    );

    const init: DocsFence | undefined = fences("kotlin").find(
      (fence: DocsFence): boolean => {
        return fence.code.includes("OpenTelemetryRumInitializer.initialize");
      },
    );

    expect(init!.code).toContain('baseUrl = "https://oneuptime.com/otlp"');
    expect(init!.code).toContain(
      'baseHeaders = mapOf("x-oneuptime-token" to BuildConfig.ONEUPTIME_TOKEN)',
    );
  });

  it("names the service, so the app is not named after its launcher label", () => {
    const init: DocsFence | undefined = fences("kotlin").find(
      (fence: DocsFence): boolean => {
        return fence.code.includes("OpenTelemetryRumInitializer.initialize");
      },
    );

    expect(init!.code).toContain('put("service.name", "kiosk-ordering")');
  });
});

describe("a kiosk named in host.name", () => {
  it("is still mobile RUM: the agent's own device attributes say so", () => {
    expect(baseService["getRumClientType"](kioskAttributes())).toBe("mobile");
  });

  it("makes no Host, though the agent sets os.type", () => {
    expect(
      baseService["getDiscoverableHostName"]({
        projectId: undefined,
        attributes: kioskAttributes(),
      }),
    ).toBeNull();
    expect(section("### Name each device")).toContain(
      "the device does not become a host in **Hosts**",
    );
  });

  it("reaches Inventory as a host, with each fact the page sets and the agent reports", () => {
    const resource: Record<string, string> = {
      ...AGENT_RESOURCE,
      ...kioskResourceFromPage(),
    };
    const host: ExtractedEntity | undefined = InventoryItem.extractEntities({
      projectId: "5f3e9c1a-0000-4000-8000-000000000001",
      attributes: resource,
    }).find((entity: ExtractedEntity): boolean => {
      return entity.entityType === EntityType.Host;
    });

    expect(host?.identifyingAttributes).toEqual({
      "host.name": "store-0412-kiosk-02",
    });

    // Every key the page puts, but the service, is an Inventory asset fact.
    const assetKeys: Array<string> = Object.values(
      INVENTORY_ASSET_ATTRIBUTE_KEYS,
    );
    for (const key of Object.keys(kioskResourceFromPage())) {
      if (key === "service.name" || key === "host.name") {
        continue;
      }
      expect({ key, asset: assetKeys.includes(key) }).toEqual({
        key,
        asset: true,
      });
      expect(host?.descriptiveAttributes?.[key]).toBe(resource[key]);
    }

    // The make, model and OS version the page says the agent reports.
    expect(host?.descriptiveAttributes).toMatchObject({
      "device.manufacturer": "Elo Touch Solutions",
      "device.model.name": "Elo-i3-15",
      "os.version": "13",
    });
  });

  it("has its own logs, traces and exceptions on its Inventory page: its rows carry its host's key", () => {
    const resource: Record<string, string> = {
      ...AGENT_RESOURCE,
      ...kioskResourceFromPage(),
    };
    const projectId: string = "5f3e9c1a-0000-4000-8000-000000000001";
    const host: ExtractedEntity | undefined = InventoryItem.extractEntities({
      projectId,
      attributes: resource,
    }).find((entity: ExtractedEntity): boolean => {
      return entity.entityType === EntityType.Host;
    });

    /*
     * resolveTelemetryResource stamps every span, log and exception row of
     * the batch with these keys, and the item's signal pages filter on its
     * one key.
     */
    expect(
      InventoryItem.extractEntityKeys({ projectId, attributes: resource }),
    ).toContain(host!.entityKey);

    for (const [page, filter] of [
      ["Logs", "entityKeys: new Includes([signal.entityKey])"],
      ["Traces", "entityKeysFilter={[signal.entityKey]}"],
      ["Exceptions", "entityKeysFilter={[signal.entityKey]}"],
    ] as Array<[string, string]>) {
      expect(
        fs.readFileSync(
          path.join(
            REPO_DIR,
            `packages/App/FeatureSet/Dashboard/src/Pages/Inventory/View/${page}.tsx`,
          ),
          "utf8",
        ),
      ).toContain(filter);
    }

    expect(section("### Name each device")).toContain(
      "The device's page in **Inventory** shows its own logs, traces and exceptions",
    );
  });

  it("is the one item the Esper import keeps for the device: its host has the key the import gives the device's Esper name", () => {
    const projectId: string = "5f3e9c1a-0000-4000-8000-000000000001";
    const host: ExtractedEntity | undefined = InventoryItem.extractEntities({
      projectId,
      attributes: { ...AGENT_RESOURCE, ...kioskResourceFromPage() },
    }).find((entity: ExtractedEntity): boolean => {
      return entity.entityType === EntityType.Host;
    });

    // The device as Esper names it: ManagedDeviceInventory keys its host so.
    expect(host?.entityKey).toBe(
      keyForHost(
        projectId,
        canonicalizeManagedDeviceIdentity(
          getManagedDeviceHostName({
            deviceName: "store-0412-kiosk-02",
            serialNumber: "R9J1A2B3C4",
            providerDeviceId: "6f0d7c1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f",
          }),
        ),
      ),
    );
    expect(section("### Import the fleet from Esper")).toContain(
      "OneUptime finds a device's item by `host.name`, then by `host.serial_number`, so give each device the same name and serial number in every app that reports from it, and in the Android Agent's `device_name` and `device_serial` settings.",
    );
  });

  it("leaves Inventory after the days the page says, the discovered host's prune TTL", () => {
    expect(source("pruneStaleEntities")).toContain(
      "[EntityType.Host, 30 * 24],",
    );
    expect(section("### Name each device")).toContain(
      "A device that sends nothing for 30 days leaves **Inventory**.",
    );
  });
});

describe("the code samples", () => {
  it("pins one agent version everywhere, and the instrumentation modules to its alpha", () => {
    const gradle: string = fences("kotlin")
      .map((fence: DocsFence): string => {
        return fence.code;
      })
      .join("\n");
    const agentVersions: Set<string> = new Set<string>(
      Array.from(
        gradle.matchAll(/io\.opentelemetry\.android:android-agent:([\w.-]+)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      }),
    );
    const moduleVersions: Set<string> = new Set<string>(
      Array.from(
        gradle.matchAll(
          /io\.opentelemetry\.android\.instrumentation:[\w-]+:([\w.-]+)/g,
        ),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      }),
    );

    expect(Array.from(agentVersions)).toEqual(["1.8.1"]);
    expect(Array.from(moduleVersions)).toEqual(["1.8.1-alpha"]);
  });

  it("closes every brace and parenthesis it opens", () => {
    for (const fence of [...fences("kotlin"), ...fences("json")]) {
      const opened: number = (fence.code.match(/[{(]/g) || []).length;
      const closed: number = (fence.code.match(/[})]/g) || []).length;

      expect({ line: fence.line, opened }).toEqual({
        line: fence.line,
        opened: closed,
      });
    }
  });

  it("gives the managed configuration as JSON that parses, with Esper's own placeholders", () => {
    const [json] = fences("json");
    const configuration: Record<string, string> = JSON.parse(json!.code);

    expect(configuration).toEqual({
      oneuptime_token: "YOUR_TELEMETRY_INGESTION_TOKEN",
      device_name: "${esper.deviceName}",
      device_serial: "${esper.serialNumber}",
    });

    // The keys the app reads are the keys the configuration sets.
    const reader: DocsFence | undefined = fences("kotlin").find(
      (fence: DocsFence): boolean => {
        return fence.code.includes("RestrictionsManager");
      },
    );
    for (const key of Object.keys(configuration)) {
      expect(reader!.code).toContain(`getString("${key}")`);
    }
  });

  it("names each device by the identity contract the Esper import matches on: its Esper name and serial number", () => {
    const [json] = fences("json");
    const configuration: Record<string, string> = JSON.parse(json!.code);
    const reader: DocsFence | undefined = fences("kotlin").find(
      (fence: DocsFence): boolean => {
        return fence.code.includes("RestrictionsManager");
      },
    );
    const resource: DocsFence | undefined = fences("kotlin").find(
      (fence: DocsFence): boolean => {
        return fence.code.includes('put("host.name"');
      },
    );

    // val deviceName = restrictions.getString("device_name") ...
    const keyOfVariable: Map<string, string> = new Map<string, string>();
    for (const match of reader!.code.matchAll(
      /val (\w+) = restrictions\.getString\("([^"]+)"\)/g,
    )) {
      keyOfVariable.set(match[1]!, match[2]!);
    }

    // put("host.name", deviceName): each attribute's placeholder in Esper.
    const placeholderOf: Record<string, string> = {};
    for (const match of resource!.code.matchAll(/put\("([^"]+)",\s*(\w+)\)/g)) {
      const key: string | undefined = keyOfVariable.get(match[2]!);

      if (key) {
        placeholderOf[match[1]!] = configuration[key]!;
      }
    }

    expect(placeholderOf).toEqual({
      [MANAGED_DEVICE_HOST_NAME_ATTRIBUTE]: ESPER_DEVICE_NAME_PLACEHOLDER,
      [MANAGED_DEVICE_SERIAL_NUMBER_ATTRIBUTE]: ESPER_SERIAL_NUMBER_PLACEHOLDER,
    });
    expect(englishPage(ANDROID_SETUP)).toContain(
      `with Esper Agent ${ESPER_PLACEHOLDERS_MIN_AGENT_VERSION} or later`,
    );
  });
});
