import {
  DocsLink,
  scanMarkdown,
  TRANSLATED_LANGUAGES,
} from "./DocsContentSupport";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import { isRedirectOnSameServer } from "Common/Utils/SameServerRedirect";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the upgrade guide says about the redirects of requests that carry a
 * key, held to the code that decides them:
 *
 *   - the note (installation/upgrading, "Other changes in 14") sits after
 *     the note on the keys a global probe and the bundled Runner may not use
 *     and before the note on the bundled datastores' passwords
 *     (DatastorePasswordUpgradeDocs);
 *   - what it says a request follows - the same address, or that address
 *     moved from http to https - and refuses - another server, a host name
 *     of another domain - is what SameServerRedirect decides;
 *   - the settings it names are the ones the probe and the Runner, and the
 *     infrastructure agent, read their OneUptime address from, and the
 *     agent's requests check their redirects;
 *   - every translation carries it in the English note's place, under a
 *     lead of its own, with the English note's code and no link.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const NOTE_LEAD: string =
  "**Probes, Runners, the infrastructure agent and OneUptime's own services follow redirects only on the server they call.**";
// The note before it (ProbeRunnerKeyUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**A global probe and the bundled Runner no longer authenticate with a key the repository ships.**";
// The note after it (DatastorePasswordUpgradeDocs).
const NEXT_LEAD: string =
  "**The bundled ClickHouse and Valkey get passwords of their own.**";

const ADDRESS_SETTING: string = "ONEUPTIME_URL";

// Where the probe and the Runner read the address they send their keys to.
const ADDRESS_READERS: Array<string> = [
  "packages/Probe/Config.ts",
  "packages/Runner/Config.ts",
];

// The infrastructure agent's own setting for that address, a flag of its configure command.
const AGENT_ADDRESS_SETTING: string = "--oneuptime-url";
const AGENT_DIRECTORY: string = "agents/InfrastructureAgent";

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

function linksOf(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return link.target;
  });
}

describe("the English upgrade note on the redirects of requests that carry a key", () => {
  it("is a note of the 13 → 14 changes, once, after the note on the global-probe and Runner keys and before the note on the bundled datastores' passwords", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("says which redirects are followed and which fail, as the code decides", () => {
    expect(ENGLISH_NOTE).toContain(
      "A request that carries one of their keys follows a redirect to the same address, or to that address moved from `http` to `https`, and nowhere else: a redirect to another server fails the request, with an error that names that server.",
    );

    // The same address, and that address moved from http to https.
    expect(
      isRedirectOnSameServer(
        "https://oneuptime.example.com/probe-ingest/alive",
        "https://oneuptime.example.com/probe-ingest/alive/",
      ),
    ).toBe(true);
    expect(
      isRedirectOnSameServer(
        "http://oneuptime.example.com/probe-ingest/alive",
        "https://oneuptime.example.com/probe-ingest/alive",
      ),
    ).toBe(true);

    // Another server, and a host name of another domain.
    expect(
      isRedirectOnSameServer(
        "https://oneuptime.example.com/probe-ingest/alive",
        "https://collector.example.net/probe-ingest/alive",
      ),
    ).toBe(false);
    expect(
      isRedirectOnSameServer(
        "https://oneuptime.old-example.com/runner-ingest/heartbeat",
        "https://oneuptime.example.com/runner-ingest/heartbeat",
      ),
    ).toBe(false);
  });

  it("names the settings the probe, the Runner and the infrastructure agent read their OneUptime address from, and who sees no change", () => {
    expect(ENGLISH_NOTE).toContain(
      "If your OneUptime address redirects to another host name, such as an old domain to a new one, set `ONEUPTIME_URL` on your probes and Runners, and the infrastructure agent's `--oneuptime-url`, to the address it redirects to.",
    );
    expect(ENGLISH_NOTE).toContain(
      "An address that answers directly, or only moves from `http` to `https`, sees no change.",
    );

    for (const reader of ADDRESS_READERS) {
      expect({
        reader,
        reads: fs
          .readFileSync(path.join(REPO_ROOT, reader), "utf8")
          .includes(`process.env["${ADDRESS_SETTING}"]`),
      }).toEqual({ reader, reads: true });
    }

    // The agent's configure command takes the flag the note names.
    expect(
      fs
        .readFileSync(path.join(REPO_ROOT, AGENT_DIRECTORY, "main.go"), "utf8")
        .includes(
          `installFlags.String("${AGENT_ADDRESS_SETTING.replace("--", "")}"`,
        ),
    ).toBe(true);
  });

  /*
   * Since #5244 the agent makes every client in one place, newHTTPClient
   * (client.go), which also gives each request a deadline. So: every client
   * literal in the agent's code checks its redirects, nothing sends through
   * Go's default client (http.Get and the rest skip the check), and both of
   * the agent's requests go through newHTTPClient.
   */
  it("holds the infrastructure agent to it: every request it sends checks its redirects", () => {
    const directory: string = path.join(REPO_ROOT, AGENT_DIRECTORY);
    const sources: Array<{ file: string; text: string }> = fs
      .readdirSync(directory)
      .filter((file: string): boolean => {
        return file.endsWith(".go") && !file.endsWith("_test.go");
      })
      .map((file: string): { file: string; text: string } => {
        return {
          file,
          text: fs.readFileSync(path.join(directory, file), "utf8"),
        };
      });

    const clientLiterals: Array<{ file: string; checksRedirects: boolean }> =
      sources.flatMap(
        (source: {
          file: string;
          text: string;
        }): Array<{ file: string; checksRedirects: boolean }> => {
          return source.text
            .split("&http.Client{")
            .slice(1)
            .map((rest: string): { file: string; checksRedirects: boolean } => {
              return {
                file: source.file,
                checksRedirects: rest
                  .slice(0, rest.indexOf("}"))
                  .includes("CheckRedirect: sameServerRedirectsOnly"),
              };
            });
        },
      );

    expect(clientLiterals).toEqual([
      { file: "client.go", checksRedirects: true },
    ]);

    // Go's default client and the helpers that send through it.
    const defaultClientUse: RegExp =
      /http\.(DefaultClient|Get\(|Post\(|PostForm\(|Head\()/;

    for (const source of sources) {
      expect({
        file: source.file,
        defaultClient: defaultClientUse.test(source.text),
      }).toEqual({ file: source.file, defaultClient: false });
    }

    // Its two requests: the secret key's check, and each report.
    const agent: string = fs.readFileSync(
      path.join(directory, "agent.go"),
      "utf8",
    );
    expect(agent.split("newHTTPClient(proxyUrl).Do(").length - 1).toBe(2);

    expect(
      fs.readFileSync(path.join(directory, "redirect.go"), "utf8"),
    ).toContain("func sameServerRedirectsOnly(");
  });

  it("carries its code and no link", () => {
    // inlineCode lists a text's code spans sorted.
    expect(inlineCode(ENGLISH_NOTE)).toEqual(
      [
        "http",
        "https",
        ADDRESS_SETTING,
        AGENT_ADDRESS_SETTING,
        "http",
        "https",
      ].sort(),
    );
    expect(linksOf(ENGLISH_NOTE)).toEqual([]);
  });
});

describe.each(TRANSLATED_LANGUAGES)("in %s", (language: string) => {
  const items: Array<string> = otherChangesItems(language);
  const note: string = flattened(items[NOTE_INDEX] || "");

  it("the upgrade note is in the English note's place, under a lead of its own", () => {
    expect(items).toHaveLength(ENGLISH_ITEMS.length);
    expect(note.startsWith("- **")).toBe(true);
    expect(note).not.toContain(NOTE_LEAD);
    expect(items[NOTE_INDEX + 1]!.startsWith("- ")).toBe(true);
  });

  it("carries the English note's code, and no link", () => {
    expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));
    expect(linksOf(note)).toEqual([]);
  });
});
