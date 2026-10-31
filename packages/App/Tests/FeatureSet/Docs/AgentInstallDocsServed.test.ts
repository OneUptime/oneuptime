import { DOCS_LANGUAGES, listPages, readPage } from "./DocsContentSupport";
import {
  INSTALL_SCRIPTS,
  InstallScriptEntry,
  getInstallScriptEntry,
  getInstallScriptFile,
} from "Common/Types/InstallScripts/InstallScripts";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs' agent commands download the agents' install scripts and files
 * from OneUptime itself, at https://oneuptime.com/install/<agent>[/<file>]:
 * every OneUptime serves the files of its own release there
 * (packages/App/FeatureSet/Install), so a self-hosted reader puts their own
 * URL in its place, as each page says. Never from GitHub, whose master is
 * newer than the reader's OneUptime. Checked in every docs language.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

// The pages whose commands download from /install.
const PAGES: Array<string> = [
  "ai/infrastructure-ai-agents",
  "monitor/kubernetes-agent",
  "telemetry/ceph",
  "telemetry/databases",
  "telemetry/docker-swarm",
  "telemetry/host-otel-collector",
  "telemetry/kubernetes-agent",
  "telemetry/proxmox",
  "telemetry/storage-arrays",
  "telemetry/vmware",
];

const GITHUB_FILES: string = "raw.githubusercontent.com/OneUptime/oneuptime/";
const SERVED_ADDRESS: RegExp =
  /https:\/\/oneuptime\.com\/install\/([a-z0-9-]+)(?:\/([A-Za-z0-9._/-]+))?/g;
// A shell line continued on the next one.
const CONTINUED_LINE: RegExp = /\\$/;
const CURL_FLAGS: RegExp = /\bcurl\s+(-[A-Za-z]+)/;

// The English sentence that says a self-hosted OneUptime serves the same.
function isSelfHostedNote(line: string): boolean {
  return (
    line.startsWith("Every OneUptime serves ") &&
    line.includes("self-hosted OneUptime") &&
    line.includes("`https://oneuptime.com`")
  );
}

// The commands in a page's code blocks, a continued line joined to the next.
function commandsOf(markdown: string): Array<string> {
  const commands: Array<string> = [];
  let fenced: boolean = false;
  let command: string = "";

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) {
      continue;
    }
    command += line.replace(CONTINUED_LINE, " ");
    if (!CONTINUED_LINE.test(line)) {
      commands.push(command);
      command = "";
    }
  }

  return commands;
}

interface ServedAddress {
  language: string;
  page: string;
  name: string;
  file: string | undefined;
}

function servedAddresses(): Array<ServedAddress> {
  const addresses: Array<ServedAddress> = [];

  for (const language of DOCS_LANGUAGES) {
    for (const page of listPages(language)) {
      for (const match of readPage(language, page).matchAll(SERVED_ADDRESS)) {
        addresses.push({
          language,
          page,
          name: match[1]!,
          file: match[2],
        });
      }
    }
  }

  return addresses;
}

describe("the docs download the agents' files from OneUptime", () => {
  it.each(DOCS_LANGUAGES)(
    "%s: no page downloads anything from GitHub's copy of the repository",
    (language: string) => {
      const named: Array<string> = listPages(language).filter(
        (page: string): boolean => {
          return readPage(language, page).includes(GITHUB_FILES);
        },
      );

      expect(named).toEqual([]);
    },
  );

  it("names only a script or file every OneUptime serves, and this checkout has", () => {
    const addresses: Array<ServedAddress> = servedAddresses();

    // Every page above, in every language.
    expect(addresses.length).toBeGreaterThan(
      PAGES.length * DOCS_LANGUAGES.length,
    );

    for (const address of addresses) {
      const entry: InstallScriptEntry | undefined = getInstallScriptEntry(
        address.name,
      );
      const file: string | null = entry
        ? address.file === undefined
          ? entry.script
          : getInstallScriptFile(entry, address.file) || null
        : null;

      expect({ ...address, served: file !== null }).toEqual({
        ...address,
        served: true,
      });
      expect({
        ...address,
        inCheckout: fs.existsSync(
          path.join(REPO_ROOT, entry!.sourceDirectory, file!),
        ),
      }).toEqual({ ...address, inCheckout: true });
    }
  });

  it("names every served agent", () => {
    const named: Set<string> = new Set(
      servedAddresses().map((address: ServedAddress): string => {
        return address.name;
      }),
    );

    expect([...named].sort()).toEqual(
      INSTALL_SCRIPTS.map((entry: InstallScriptEntry): string => {
        return entry.name;
      }).sort(),
    );
  });

  it.each(DOCS_LANGUAGES)(
    "%s: every download from OneUptime fails on an error answer instead of saving it",
    (language: string) => {
      let downloads: number = 0;

      for (const page of PAGES) {
        for (const line of commandsOf(readPage(language, page))) {
          if (Array.from(line.matchAll(SERVED_ADDRESS)).length === 0) {
            continue;
          }
          downloads++;

          expect({ page, line, flags: line.match(CURL_FLAGS)?.[1] }).toEqual({
            page,
            line,
            flags: expect.stringContaining("f"),
          });
        }
      }

      // Each page downloads something from OneUptime.
      expect(downloads).toBeGreaterThan(PAGES.length);
    },
  );

  it.each(PAGES)(
    "%s tells a self-hosted reader to use their own URL, in every language, on the English line",
    (page: string) => {
      const english: Array<string> = readPage("en", page).split("\n");
      const notes: Array<number> = english
        .map((line: string, index: number): number => {
          return isSelfHostedNote(line) ? index : -1;
        })
        .filter((index: number): boolean => {
          return index > -1;
        });

      expect(notes.length).toBe(1);

      const note: string = english[notes[0]!]!;
      expect(
        note.includes("so you can read it before you run it") ||
          note.includes("open its address in a browser"),
      ).toBe(true);

      for (const language of DOCS_LANGUAGES) {
        const line: string =
          readPage(language, page).split("\n")[notes[0]!] || "";

        expect({
          language,
          names: line.includes("`https://oneuptime.com`"),
        }).toEqual({ language, names: true });
        if (language !== "en") {
          expect({ language, translated: line !== note }).toEqual({
            language,
            translated: true,
          });
        }
      }
    },
  );
});
