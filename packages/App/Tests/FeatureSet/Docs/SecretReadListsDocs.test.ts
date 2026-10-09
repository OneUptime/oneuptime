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
 * - A project's probes and AI agents are read only by its members whose
 *   roles may read them, and the global lists by signed-in users.
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
      "**An LLM provider's Additional Parameters are read like its API key.**",
      "so they are now read only by project owners and admins (`ProjectOwner`, `ProjectAdmin`), as the **API Key** already was.",
      "Other members, and API keys holding their roles, get a `422` when they ask for `additionalParams`; they can read the new read-only `hasAdditionalParams` field instead, which says whether any parameters are saved and is filled in for existing providers on start.",
      "Members who may edit a provider can still replace its parameters.",
      "a Terraform API key that manages `additional_params` needs `ProjectOwner` or `ProjectAdmin`.",
      "Everyone who reads a provider reads its **Base URL**, so keep keys and tokens out of it.",
      "[Who can see a provider](/docs/ai/llm-provider#setting-up-an-llm-provider)",
    ]) {
      expect([sentence, otherChanges.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }
  });

  test("say probes and AI agents are read only by members of their project", () => {
    for (const sentence of [
      "**Probes and AI agents are read only by members of their project.**",
      "Reading a project's probes or AI agents takes a role that may read them, such as **Viewer**, **Settings Viewer**, **Read Probe** or **Read AI Agent** (and the monitor roles, for probes), and a request without a signed-in user or an API key is answered with a `401`.",
      "The lists of global probes and global AI agents answer signed-in users only.",
    ]) {
      expect([sentence, otherChanges.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }
  });

  test("link to a heading the LLM provider guide has", () => {
    expect(read("ai/llm-provider.md")).toContain(
      "\n## Setting Up an LLM Provider\n",
    );
    expect(read("ai/llm-provider.md")).toContain("**Who can see a provider.**");
  });
});
