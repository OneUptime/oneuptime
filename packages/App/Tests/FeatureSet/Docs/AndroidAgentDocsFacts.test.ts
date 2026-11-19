import { DocsFence, readPage, scanMarkdown } from "./DocsContentSupport";
import {
  HostAlertTemplate,
  getHostAlertTemplatesFor,
} from "Common/Types/Monitor/HostAlertTemplates";
import { HOST_LOG_SESSION_DURATIONS } from "Common/Types/Host/HostLogSession";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Android Agent page (telemetry/android-agent) held to the agent it
 * describes (agents/AndroidAgent): every claim a person deploying it acts
 * on - a managed configuration key, its default, the permission command,
 * the event and metric names to search for, the release asset, the alert
 * templates - is read from the agent's own files here, so the page and the
 * agent cannot drift apart unnoticed.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT: string = path.join(REPO_ROOT, "agents/AndroidAgent");
const PAGE: string = "telemetry/android-agent";
const markdown: string = readPage("en", PAGE);

function agentFile(relativePath: string): string {
  return fs.readFileSync(path.join(AGENT, relativePath), "utf8");
}

const RESTRICTION: RegExp = /<restriction\b([\s\S]*?)\/>/g;
const RESTRICTION_KEY: RegExp = /android:key="([^"]+)"/;
const RESTRICTION_DEFAULT: RegExp = /android:defaultValue="([^"]+)"/;
// A row of the page's settings table: | `key` | what it sets | default |
const SETTINGS_ROW: RegExp = /^\| `([a-z_]+)` \| [^|]+ \| ([^|]+) \|$/;
const APPLICATION_ID: RegExp = /applicationId = "([^"]+)"/;

// A managed configuration key and its default, when it has one.
interface Restriction {
  key: string;
  defaultValue: string | undefined;
}

// The keys app_restrictions.xml declares, in order, with their defaults.
function restrictions(): Array<Restriction> {
  const xml: string = agentFile("app/src/main/res/xml/app_restrictions.xml");
  return Array.from(xml.matchAll(RESTRICTION)).map(
    (match: RegExpMatchArray) => {
      const body: string = match[1]!;
      const key: string = RESTRICTION_KEY.exec(body)![1]!;
      const defaultValue: string | undefined =
        RESTRICTION_DEFAULT.exec(body)?.[1];
      return { key, defaultValue };
    },
  );
}

// The page's settings table: key -> its "Default" cell.
function settingsTable(): Map<string, string> {
  const rows: Map<string, string> = new Map();
  for (const line of markdown.split("\n")) {
    const match: RegExpExecArray | null = SETTINGS_ROW.exec(line);
    if (match) {
      rows.set(match[1]!, match[2]!.trim());
    }
  }
  return rows;
}

function goldenMetricNames(): Set<string> {
  const json: JSONObject = JSON.parse(
    agentFile("app/src/test/resources/otlp/android-agent-metrics.json"),
  ) as JSONObject;
  const metrics: JSONArray = (
    (
      ((json["resourceMetrics"] as JSONArray)[0] as JSONObject)[
        "scopeMetrics"
      ] as JSONArray
    )[0] as JSONObject
  )["metrics"] as JSONArray;
  return new Set(
    metrics.map((metric: unknown) => {
      return (metric as JSONObject)["name"] as string;
    }),
  );
}

describe("Android Agent docs: the settings are the agent's", () => {
  it("lists every managed configuration key the agent declares, and no other", () => {
    expect(Array.from(settingsTable().keys())).toEqual(
      restrictions().map((restriction: Restriction) => {
        return restriction.key;
      }),
    );
  });

  it("gives each key the default the agent has", () => {
    const table: Map<string, string> = settingsTable();
    for (const restriction of restrictions()) {
      if (restriction.defaultValue !== undefined) {
        expect({
          key: restriction.key,
          default: table.get(restriction.key),
        }).toEqual({
          key: restriction.key,
          default: `\`${restriction.defaultValue}\``,
        });
      }
    }
    // A device nobody names is an "Android device" (ConfigResolver.DEFAULT_DEVICE_TYPE).
    expect(table.get("device_type")).toBe("`Android device`");
    expect(
      agentFile(
        "app/src/main/java/com/oneuptime/androidagent/config/AgentConfig.kt",
      ),
    ).toContain('DEFAULT_DEVICE_TYPE: String = "Android device"');
  });

  it("pastes a managed configuration that parses, with only keys the agent reads", () => {
    const fence: DocsFence | undefined = scanMarkdown(markdown).fences.find(
      (candidate: DocsFence) => {
        return candidate.lang === "json";
      },
    );
    const keys: Array<string> = restrictions().map(
      (restriction: Restriction) => {
        return restriction.key;
      },
    );

    expect(fence).toBeDefined();
    const configuration: JSONObject = JSON.parse(fence!.code) as JSONObject;
    for (const key of Object.keys(configuration)) {
      expect(keys).toContain(key);
    }
    expect(configuration["device_name"]).toBe("${esper.deviceName}");
    expect(configuration["oneuptime_token"]).toBe(
      "YOUR_TELEMETRY_INGESTION_TOKEN",
    );
  });

  it("states the interval's bounds the agent enforces", () => {
    const parser: string = agentFile(
      "app/src/main/java/com/oneuptime/androidagent/config/ManagedSettings.kt",
    );

    expect(parser).toContain("MIN_INTERVAL_SECONDS: Int = 30");
    expect(parser).toContain("MAX_INTERVAL_SECONDS: Int = 600");
    expect(markdown).toContain("from 30 to 600 seconds");
  });
});

describe("Android Agent docs: what to run and where to look", () => {
  it("grants READ_LOGS to the agent's own package", () => {
    const build: string = agentFile("app/build.gradle.kts");
    const applicationId: string = APPLICATION_ID.exec(build)![1]!;

    expect(markdown).toContain(
      `adb shell pm grant ${applicationId} android.permission.READ_LOGS`,
    );
  });

  it("names the release asset release.yml attaches", () => {
    const release: string = fs.readFileSync(
      path.join(REPO_ROOT, ".github/workflows/release.yml"),
      "utf8",
    );

    expect(release).toContain("oneuptime-android-agent.apk");
    expect(markdown).toContain("`oneuptime-android-agent.apk`");
  });

  it("names metrics the agent sends", () => {
    const names: Set<string> = goldenMetricNames();
    for (const metric of [
      "hw.battery.charge",
      "hw.temperature",
      "android.battery.plugged",
      "android.thermal.status",
      "android.thermal.headroom",
    ]) {
      expect({ metric, sent: names.has(metric) }).toEqual({
        metric,
        sent: true,
      });
      expect(markdown).toContain(`\`${metric}\``);
    }
  });

  it("searches for event names the agent sends", () => {
    const logs: string = agentFile(
      "app/src/test/resources/otlp/android-agent-logs.json",
    );
    for (const event of ["device.boot", "android.package.inventory"]) {
      expect(logs).toContain(`"stringValue": "${event}"`);
      expect(markdown).toContain(`\`@event.name:${event}\``);
    }
    expect(
      agentFile(
        "app/src/main/java/com/oneuptime/androidagent/boot/BootTracker.kt",
      ),
    ).toContain('"android.boot.recent_count"');
    expect(markdown).toContain("`android.boot.recent_count`");
  });

  it("names every alert template an Android device is offered", () => {
    const names: Array<string> = getHostAlertTemplatesFor({
      isAndroid: true,
      reportsCpu: true,
    }).map((template: HostAlertTemplate) => {
      return template.name;
    });

    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      expect({ name, named: markdown.includes(name) }).toEqual({
        name,
        named: true,
      });
    }
    // A server's own, never offered to a device, is not named as one.
    expect(markdown).not.toContain("High Filesystem Usage");
  });

  it("runs the agent's own commands for DropBox, usage access and device owner", () => {
    const events: string = agentFile(
      "app/src/main/java/com/oneuptime/androidagent/agent/AgentEvents.kt",
    );
    const command: (name: string) => string = (name: string): string => {
      const match: RegExpExecArray | null = new RegExp(
        `const val ${name}: String = "([^"]+)"`,
      ).exec(events);
      expect(match).not.toBeNull();
      return match![1]!;
    };

    for (const name of [
      "GRANT_COMMAND",
      "GRANT_DROPBOX_COMMAND",
      "USAGE_ACCESS_COMMAND",
      "DEVICE_OWNER_COMMAND",
    ]) {
      expect(markdown).toContain(command(name));
    }
  });

  it("offers log sessions as long as the agent runs one, at the levels it reads", () => {
    const manager: string = agentFile(
      "app/src/main/java/com/oneuptime/androidagent/logsession/LogSessionManager.kt",
    );

    expect(Math.min(...HOST_LOG_SESSION_DURATIONS)).toBe(15);
    expect(Math.max(...HOST_LOG_SESSION_DURATIONS)).toBe(240);
    expect(manager).toContain("const val MAX_DURATION_MINUTES: Int = 240");
    expect(markdown).toContain("from 15 minutes to 4 hours");
    expect(markdown).toContain("**Info**, **Debug** or **Verbose**");
  });

  it("links the app instrumentation guide, which links back", () => {
    expect(markdown).toContain("(/docs/rum/android-setup)");
    expect(readPage("en", "rum/android-setup")).toContain(
      "(/docs/telemetry/android-agent)",
    );
  });
});
