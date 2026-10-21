import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT THE UPGRADE NOTES SAY ABOUT WHO READS AN LLM PROVIDER'S ADDITIONAL
 * PARAMETERS, PROBES AND AI AGENTS.
 *
 * - An LLM provider's Additional Parameters are read by project owners and
 *   admins alone, like its API key; other members read whether any are
 *   saved (hasAdditionalParams), and the Terraform provider and the MCP
 *   server leave out what an API key may not read.
 * - Its Base URL, where the key and the parameters are sent, is changed by
 *   project owners and admins alone.
 * - A project's probes and AI agents are read only by its members whose
 *   roles may read them, and the global lists by signed-in users. Whoever
 *   may pick a probe reads what a picker shows of it, never its key.
 * - The custom probe guide says where to copy a probe's ID and key, and who
 *   sees the key.
 *
 * The LLM provider guide's "Who can see a provider" paragraph is pinned by
 * SubscriberAndRunScopeDocs.test.ts. These are the English pages; the
 * translated guides follow in their own translation pass.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function read(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

// The text under `heading`, up to the next heading of the same level.
function sectionOf(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const level: string = heading.split(" ")[0] as string;
  const bodyStart: number = start + heading.length + 2;
  const next: number = markdown.indexOf(`\n${level} `, bodyStart);

  return markdown.slice(bodyStart, next === -1 ? undefined : next);
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

describe("the 14 upgrade notes", () => {
  const otherChanges: string = squash(
    sectionOf(read("installation/upgrading.md"), "### Other changes in 14"),
  );

  test("say an LLM provider's Additional Parameters are read like its API key", () => {
    for (const sentence of [
      "**An LLM provider's Additional Parameters are read like its API key, and its Base URL is changed only by those who may read them.**",
      "so they are now read only by project owners and admins (`ProjectOwner`, `ProjectAdmin`), as the **API Key** already was.",
      "Other members, and API keys holding their roles, get a `422` when they ask for `additionalParams`; they can read the new read-only `hasAdditionalParams` field instead, which says whether any parameters are saved and is worked out from them on every read.",
      "Members who may edit a provider can still replace its API key and its parameters.",
      "a Terraform API key that manages `additional_params` or `base_url` needs `ProjectOwner` or `ProjectAdmin`.",
      "Everyone who reads a provider reads its **Base URL**, so keep keys and tokens out of it.",
      "[Who can see a provider](/docs/ai/llm-provider#setting-up-an-llm-provider)",
    ]) {
      expect([sentence, otherChanges.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }
  });

  test("say who changes an LLM provider's Base URL, and why", () => {
    for (const sentence of [
      "The API key and the parameters are sent to the provider's **Base URL**, so changing `baseUrl` now needs `ProjectOwner` or `ProjectAdmin` as well; anyone else gets a `422` that names who may change it.",
    ]) {
      expect([sentence, otherChanges.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }

    // No stored copy, so nothing is filled in on start any more.
    expect(otherChanges).not.toContain("filled in for existing providers");
  });

  test("say probes and AI agents are read only by members of their project", () => {
    for (const sentence of [
      "**Probes and AI agents are read only by members of their project.**",
      "Reading a project's probes or AI agents takes a role that may read them, such as **Viewer**, **Settings Viewer**, **Read Probe** or **Read AI Agent** (and the monitor roles, for probes), and a request without a signed-in user or an API key is answered with a `401`.",
      "Whoever may read, create or edit monitors, a monitor's probes, network devices, their discovery scans or network sites reads what a probe picker shows of the project's probes - name, description, icon, status and whether new monitors start with it - but not a probe's key, version, labels or packet capture report.",
      "A probe's key stays with project owners and admins.",
      "The lists of global probes and global AI agents answer signed-in users only.",
    ]) {
      expect([sentence, otherChanges.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }
  });

  test("the LLM provider guide says who changes the Base URL", () => {
    expect(squash(read("ai/llm-provider.md"))).toContain(
      "Only project owners and admins can change a provider's **Base URL**, because its API Key and Additional Parameters are sent to that address; the other members who may edit a provider can change everything else.",
    );
  });

  test("the custom probe guide says where to copy a probe's ID and key, and who sees the key", () => {
    expect(squash(read("probe/custom-probe.md"))).toContain(
      "To copy them, open the probe's menu in the **Custom Probes** table and pick **Show ID and Key**. Everyone who can see the table can copy a probe's ID; its key is shown only to project owners and admins, who see **Show ID and Key** where the others see **Show ID**.",
    );
  });

  test("link to a heading the LLM provider guide has", () => {
    expect(read("ai/llm-provider.md")).toContain(
      "\n## Setting Up an LLM Provider\n",
    );
    expect(read("ai/llm-provider.md")).toContain("**Who can see a provider.**");
  });
});
