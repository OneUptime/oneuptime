import { AI_CONTEXT, LLM_PROVIDERS } from "./AiDocsPages";
import { readPage } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  AI_CONTEXT_ACTIVITY_COPY,
  AI_CONTEXT_CARD_COPY,
  AI_CONTEXT_OUTLINE_BUTTON_TEXT,
  AI_RULE_AI_CONTEXT_FIELD_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/AiContextCopy";
import { RULE_LLM_PROVIDER_FIELD_COPY } from "../../../FeatureSet/Dashboard/src/Components/AI/RuleLlmProviderCopy";
import Project from "Common/Models/DatabaseModels/Project";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import {
  AiContextActivity,
  AI_CONTEXT_BYTES_PER_TOKEN,
  AI_CONTEXT_COLUMN,
  AI_CONTEXT_RUN_MAX_CHARACTERS,
  AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
  PROJECT_AI_CONTEXT_MAX_CHARACTERS,
  composeAiContext,
  estimateAiContextTokens,
} from "Common/Types/AI/AiContext";
import {
  AI_CONTEXT_PROMPT_HEADING,
  withAiContext,
} from "Common/Server/Utils/AI/AiContext/AiContextPrompt";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The AI Context docs page (ai/ai-context, issue #5198) against the product
 * it describes: the limits and the token estimate the server holds the notes
 * to, the card's and the rule field's labels, where the notes go in a
 * prompt, who may change and read them, and the API field. Markdown is not
 * compiled, so nothing else notices when one of them changes.
 */

const ENGLISH: string = readPage("en", AI_CONTEXT);

const CARD_MODEL_DETAIL: string = path.resolve(
  __dirname,
  "../../../../Common/UI/Components/ModelDetail/CardModelDetail.tsx",
);

// A section of the page: from its heading to the next of the same level.
function section(heading: string): string {
  const start: number = ENGLISH.indexOf(`\n${heading}\n`);

  expect(start).toBeGreaterThan(-1);

  const next: number = ENGLISH.indexOf("\n## ", start + heading.length + 2);

  return ENGLISH.slice(start, next === -1 ? undefined : next);
}

function permissionTitles(permissions: Array<Permission>): Array<string> {
  return permissions.map((permission: Permission): string => {
    return PermissionHelper.getTitle(permission);
  });
}

function bold(text: string): string {
  return `**${text}**`;
}

describe("the AI Context page", () => {
  /*
   * Among the pages that set OneUptime AI up for a project: which model it
   * uses (LLM Providers, and Microsoft Foundry under it), what it knows
   * about the project, and the tools it may use.
   */
  it("is in the AI group, between the model OneUptime AI uses and the tools it may use", () => {
    const group: NavGroup = DocsNav.find((candidate: NavGroup): boolean => {
      return candidate.title === "AI";
    }) as NavGroup;
    const urls: Array<string> = group.links.map((link: NavLink): string => {
      return link.url;
    });
    const at: number = urls.indexOf(`/docs/${AI_CONTEXT}`);

    expect(at).toBeGreaterThan(urls.indexOf(`/docs/${LLM_PROVIDERS}`));
    expect(urls.slice(at - 1, at + 2)).toEqual([
      "/docs/ai/microsoft-foundry",
      `/docs/${AI_CONTEXT}`,
      "/docs/ai/external-mcp-servers",
    ]);
    expect(ENGLISH.split("\n")[0]).toBe("# AI Context");
  });

  it("states the limits the server holds the notes to", () => {
    // The table's rows, under its header.
    const limits: Array<Array<string>> = tables(section("## Limits"))[0]!.slice(
      1,
    );
    const english: (value: number) => string = (value: number): string => {
      return `${value.toLocaleString("en-US")} characters`;
    };

    expect(limits).toEqual([
      ["The project's AI context", english(PROJECT_AI_CONTEXT_MAX_CHARACTERS)],
      ["An AI rule's AI context", english(AI_RULE_AI_CONTEXT_MAX_CHARACTERS)],
      [
        "All the AI context one run reads",
        english(AI_CONTEXT_RUN_MAX_CHARACTERS),
      ],
    ]);
    expect(section("## Limits")).toContain(
      `past ${AI_CONTEXT_RUN_MAX_CHARACTERS.toLocaleString("en-US")} characters is left out whole`,
    );
  });

  it("says a run that would pass its limit leaves the rule out whole, as the server does", () => {
    const read: AiContextActivity = composeAiContext({
      projectContext: "p".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS),
      rules: ["A", "B", "C"].map((name: string) => {
        return {
          id: name,
          name,
          aiContext: name.repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS),
        };
      }),
    })!;

    // The project's first, then the rules by name, until the next would not fit.
    expect(
      read.parts.map((part: { text: string }) => {
        return part.text[0];
      }),
    ).toEqual(["p", "A", "B"]);
    expect(read.leftOutRuleNames).toEqual(["C"]);
    expect(section("## Limits")).toContain(
      "A run reads the project's notes first, then each matching rule's in the order of their names.",
    );
  });

  it("estimates tokens the way the product does: UTF-8 bytes divided by 4, rounded up", () => {
    expect(AI_CONTEXT_BYTES_PER_TOKEN).toBe(4);
    expect(section("## Limits")).toContain(
      `the notes' size in UTF-8 bytes divided by ${AI_CONTEXT_BYTES_PER_TOKEN}, rounded up`,
    );
    // Nine bytes - "é" is two - are about three tokens, rounded up.
    expect(estimateAiContextTokens("é".repeat(4) + "a")).toBe(3);
  });

  it("names the card, its buttons and its dialog's save as the Dashboard draws them", () => {
    const write: string = section("## Write the AI context");

    for (const label of [
      AI_CONTEXT_CARD_COPY.cardTitle,
      AI_CONTEXT_CARD_COPY.addButtonText,
      AI_CONTEXT_CARD_COPY.editButtonText,
      AI_CONTEXT_OUTLINE_BUTTON_TEXT,
      "Enable AI",
    ]) {
      expect(write).toContain(bold(label));
    }

    // The card's dialog saves with CardModelDetail's own button.
    expect(fs.readFileSync(CARD_MODEL_DETAIL, "utf8")).toContain(
      "submitButtonText={`Save Changes`}",
    );
    expect(write).toContain(bold("Save Changes"));
    expect(write).toContain(bold("Project Settings → AI → AI Features"));
  });

  it("names the rule's field where the rule's form draws it: More fields, after LLM Provider", () => {
    const rule: string = section("## An AI rule's own notes");

    expect(AI_RULE_AI_CONTEXT_FIELD_COPY.title).toBe("AI context");
    expect(rule).toContain(
      `Write them in the rule's ${bold(AI_RULE_AI_CONTEXT_FIELD_COPY.title)}, under ${bold(MORE_FIELDS_SECTION_TITLE)}, after ${bold(RULE_LLM_PROVIDER_FIELD_COPY.title)}.`,
    );
  });

  it("names the run's line and its button as the activity draws them", () => {
    const run: string = section("## What a run read");

    expect(run).toContain(bold(AI_CONTEXT_ACTIVITY_COPY.projectOnly));
    expect(run).toContain(bold(AI_CONTEXT_ACTIVITY_COPY.viewButtonText));
  });

  it("puts the notes where the product does: first in the system prompt", () => {
    const read: AiContextActivity = composeAiContext({
      projectContext: "checkout-api depends on payments-db.",
    })!;
    const prompt: string = withAiContext("OneUptime AI's own rules.", read);

    expect(prompt.indexOf(AI_CONTEXT_PROMPT_HEADING)).toBeLessThan(
      prompt.indexOf("OneUptime AI's own rules."),
    );
    expect(prompt.indexOf("checkout-api depends on payments-db.")).toBeLessThan(
      prompt.indexOf("OneUptime AI's own rules."),
    );
    expect(section("## How it works")).toContain(
      "OneUptime AI puts the AI context at the very start of its system prompt, ahead of its own instructions and the run's data",
    );
  });

  it("names who may change the project's notes, and who may read them, from the column's own access", () => {
    const access: { read?: Array<Permission>; update?: Array<Permission> } =
      new Project().getColumnAccessControlFor(AI_CONTEXT_COLUMN) || {};
    const changers: Array<string> = permissionTitles(access.update || []);
    const readers: Array<string> = permissionTitles(
      (access.read || []).filter((permission: Permission): boolean => {
        return !(access.update || []).includes(permission);
      }),
    );
    const who: string = section("## Who can change it");

    expect(changers).toEqual(["Project Owner", "Project Admin"]);
    expect(readers).toEqual(["Project Member", "Viewer", "Read Project"]);
    expect(who).toContain(
      `${bold(changers[0]!)} and ${bold(changers[1]!)} can change the project's AI context.`,
    );
    expect(who).toContain(
      `${bold(readers[0]!)}, ${bold(readers[1]!)} and ${bold(readers[2]!)} can read it.`,
    );
  });

  it("names the API field the project and an AI rule each keep their notes in", () => {
    expect(AI_CONTEXT_COLUMN).toBe("aiContext");
    expect(
      new Project().getTableColumnMetadata(AI_CONTEXT_COLUMN),
    ).toBeDefined();
    expect(
      new AutoRemediationRule().getTableColumnMetadata(AI_CONTEXT_COLUMN),
    ).toBeDefined();
    expect(section("## Who can change it")).toContain(
      "the project's notes are the project's `aiContext`, and an AI rule's are the rule's own `aiContext`",
    );
  });

  it("warns, in the dialog's own words, to leave secrets out", () => {
    const warning: string =
      "Leave secrets out: anyone who can see what an AI run did can read the notes it was given.";

    expect(AI_CONTEXT_CARD_COPY.editModalDescription).toContain(warning);
    expect(ENGLISH).toContain(`> ${warning}`);
  });
});
