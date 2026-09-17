import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #3866 — the discovered-host Attributes card showed only host.name,
 * host.arch and os.type, so a CMDB sync could not read the machine's IP,
 * serial number, make or model.
 *
 * The extractor change is covered by unit tests in packages/Common. What
 * cannot be unit tested is the half of the feature that lives in text and
 * in hardcoded lists: the collector config we hand people has to actually
 * ask for these attributes, and the topology drawer has its own key
 * allowlist that will silently omit anything not added to it.
 *
 * Source-wiring rather than rendering: packages/App runs under
 * testEnvironment "node" with no React renderer, and importing a Dashboard
 * .tsx pulls in RouteMap / Common/UI/Config, which read `window` at module
 * load. See SystemdUnitsPageWiring.test.ts, whose helpers these mirror.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const DOCS_CONTENT: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

function readCode(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

function readDoc(...relativeParts: Array<string>): string {
  return fs.readFileSync(path.join(DOCS_CONTENT, ...relativeParts), "utf8");
}

/** The attributes issue #3866 asked for, under the keys we settled on. */
const REQUESTED_ATTRIBUTES: Array<string> = [
  "host.ip",
  "host.serial_number",
  "device.manufacturer",
  "device.model.name",
];

/** Detector attributes that fill the same card and cost no extra config. */
const DETECTED_ATTRIBUTES: Array<string> = [
  "host.arch",
  "host.id",
  "os.type",
  "os.description",
];

describe("host asset attributes are wired end to end (issue #3866)", () => {
  describe("the topology drawer does not disagree with the Inventory page", () => {
    /*
     * DETAIL_ATTRIBUTES is a second, independent key allowlist. Nothing
     * fails when a key is missing from it — the drawer just quietly shows
     * fewer facts about the same machine than its own Inventory item does.
     */
    test.each(REQUESTED_ATTRIBUTES)("%s has a drawer row", (key: string) => {
      expect(
        readCode("Components", "Topology", "EntityDetailPanel.tsx"),
      ).toContain(`key: "${key}"`);
    });

    test("each one is labelled in prose, not left as a dotted key", () => {
      const source: string = readCode(
        "Components",
        "Topology",
        "EntityDetailPanel.tsx",
      );

      for (const label of [
        "IP Address",
        "Serial Number",
        "Manufacturer",
        "Model Name",
      ]) {
        expect(source).toContain(`label: "${label}"`);
      }
    });
  });

  describe("the generated collector config asks for the detected attributes", () => {
    test.each(DETECTED_ATTRIBUTES.concat(["host.ip"]))(
      "%s is enabled in the system detector",
      (key: string) => {
        expect(
          readSource("Pages", "Host", "Utils", "DocumentationMarkdown.ts"),
        ).toContain(`${key}: enabled: true`);
      },
    );
  });

  describe("the generated docs explain the three with no detector", () => {
    const generated: () => string = (): string => {
      return readSource("Pages", "Host", "Utils", "DocumentationMarkdown.ts");
    };

    test("a resource processor is shown, wired into the metrics pipeline", () => {
      expect(generated()).toContain("resource/oneuptime-hardware");
      expect(generated()).toContain(
        "processors: [resourcedetection, resource/oneuptime-hardware, batch]",
      );
    });

    test.each([
      "host.serial_number",
      "device.manufacturer",
      "device.model.name",
    ])("%s is named in the stamping instructions", (key: string) => {
      expect(generated()).toContain(key);
    });

    test("the Windows method reads WMI through CIM cmdlets", () => {
      const source: string = generated();

      expect(source).toContain("Get-CimInstance");
      expect(source).toContain("Win32_BIOS");
      expect(source).toContain("Win32_ComputerSystem");
    });

    /*
     * Get-WmiObject is absent from PowerShell 7+, and wmic is deprecated
     * and removed from recent Windows builds. Either would be advice that
     * fails on a current machine.
     *
     * Matched as an invocation — `Get-WmiObject -ClassName …` — rather
     * than as a bare mention, because naming the deprecated cmdlet to tell
     * people not to use it is exactly what the page should do.
     */
    test.each([/Get-WmiObject\s+-/, /\bwmic\s+\w/])(
      "%s is never the command we tell people to run",
      (invocation: RegExp) => {
        expect(
          readCode("Pages", "Host", "Utils", "DocumentationMarkdown.ts"),
        ).not.toMatch(invocation);
      },
    );

    test("the deprecated cmdlet is named, so nobody reaches for it", () => {
      expect(generated()).toMatch(/not the deprecated .{0,4}Get-WmiObject/);
    });

    test("the alternative host.* spellings are documented as accepted", () => {
      expect(generated()).toContain("host.manufacturer");
      expect(generated()).toContain("host.model.name");
    });
  });

  describe("the docs site page", () => {
    function languageDirectories(): Array<string> {
      return fs
        .readdirSync(DOCS_CONTENT, { withFileTypes: true })
        .filter((entry: fs.Dirent): boolean => {
          return (
            entry.isDirectory() &&
            fs.existsSync(
              path.join(
                DOCS_CONTENT,
                entry.name,
                "telemetry",
                "host-otel-collector.md",
              ),
            )
          );
        })
        .map((entry: fs.Dirent): string => {
          return entry.name;
        });
    }

    /*
     * A reader who follows the docs page rather than copying the
     * dashboard's generated config used to get no host.ip at all — the
     * page's resourcedetection blocks were the bare four-line form. The
     * YAML is not translated, so every language must carry the fix.
     */
    test("every language enables the opt-in detector attributes", () => {
      const languages: Array<string> = languageDirectories();
      expect(languages.length).toBeGreaterThan(1);

      for (const language of languages) {
        const doc: string = readDoc(
          language,
          "telemetry",
          "host-otel-collector.md",
        );
        const blocks: number = (doc.match(/ {2}resourcedetection:\n/g) || [])
          .length;

        expect(blocks).toBeGreaterThan(0);
        expect((doc.match(/ {6}resource_attributes:\n/g) || []).length).toBe(
          blocks,
        );

        for (const key of [
          "host.arch",
          "host.id",
          "host.ip",
          "os.description",
        ]) {
          expect(
            (
              doc.match(
                new RegExp(
                  `${key.replace(".", "\\.")}:\\n {10}enabled: true`,
                  "g",
                ),
              ) || []
            ).length,
          ).toBe(blocks);
        }
      }
    });

    test("English documents the stamped attributes and where they come from", () => {
      const doc: string = readDoc("en", "telemetry", "host-otel-collector.md");

      expect(doc).toContain(
        "### Inventory attributes (IP, serial number, make, model)",
      );
      for (const key of REQUESTED_ATTRIBUTES) {
        expect(doc).toContain(key);
      }
      expect(doc).toContain("/sys/class/dmi/id/product_serial");
      expect(doc).toContain("Get-CimInstance");
      expect(doc).toContain("sysctl -n hw.model");
    });

    /*
     * sc.exe cannot set service environment variables and setx sets one the
     * running service never re-reads, so the registry path is the only
     * correct instruction for the env-var route on Windows.
     */
    test("English names the Windows service Environment registry key", () => {
      expect(readDoc("en", "telemetry", "host-otel-collector.md")).toContain(
        "HKLM\\SYSTEM\\CurrentControlSet\\Services\\otelcol-contrib",
      );
    });

    test("English warns that OTEL_RESOURCE_ATTRIBUTES values need encoding", () => {
      const doc: string = readDoc("en", "telemetry", "host-otel-collector.md");

      expect(doc).toContain("OTEL_RESOURCE_ATTRIBUTES");
      expect(doc).toContain("Percent-encode every value");
    });

    /*
     * SystemdUnitsPageWiring.test.ts asserts every language has the same
     * number of copy-whole configs as English. A new YAML fence carrying
     * the ingestion token AND a pipelines block would be counted as a
     * fifth, failing all sixteen translations at once.
     */
    test("the new section did not add a copy-whole config", () => {
      const doc: string = readDoc("en", "telemetry", "host-otel-collector.md");
      const section: string = doc.substring(
        doc.indexOf(
          "### Inventory attributes (IP, serial number, make, model)",
        ),
        doc.indexOf("### Complete example — Linux host"),
      );

      expect(section.length).toBeGreaterThan(0);
      expect(section).not.toContain(
        "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN",
      );
    });

    test("the CMDB page lists the keys a sync should read", () => {
      const doc: string = readDoc("en", "inventory", "cmdb-sync.md");

      for (const key of REQUESTED_ATTRIBUTES.concat(DETECTED_ATTRIBUTES)) {
        expect(doc).toContain(key);
      }
    });
  });
});
