import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Where the docs send a reader for an AI agent's actions.
 *
 * "We can have both of these buttons, like "Test Connection" and "Reset
 * Agent," in a more button style with three dots. Please do this for all
 * the other resources in the project."
 *
 * Every AI agent page - a Kubernetes cluster's and every other resource's -
 * keeps the agent's status in its card's header and puts Test connection,
 * Reset agent and (on a cluster bound to a Runner outside the chart) Switch
 * to the AI agent in one ⋯ beside it (Components/AiAccess/AiAgentActions.ts).
 * A page that still says "the Test connection button", or puts an action
 * "on the AI agent page" without the menu, sends the reader looking for a
 * button that is not there.
 *
 * The other languages' copies of these pages do not describe the agent's
 * actions yet; the last test keeps it that way until they do, so a
 * translation added later is checked too.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

// The English pages that describe an AI agent's actions.
const PAGES: Array<string> = [
  "ai/ai-sre.md",
  "ai/infrastructure-ai-agents.md",
  "telemetry/kubernetes-agent.md",
];

const ACTIONS: Array<string> = [
  "**Test connection**",
  "**Reset agent**",
  "**Switch to the AI agent**",
];

// How the docs name the menu: the ⋯ beside the agent's status.
const MENU: string = "**⋯** menu";

// "Who may change it" lists who may run an action, not where it is.
const PERMISSIONS_PARAGRAPH: RegExp =
  /takes the same people|open to anyone who may/;

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

// Every paragraph (or list item) of a page that names one of the actions.
function paragraphsNaming(text: string, action: string): Array<string> {
  return text.split(/\n\s*\n|\n(?=- )/).filter((paragraph: string): boolean => {
    return paragraph.includes(action);
  });
}

/*
 * An AI agent action said to be somewhere other than the agent card's ⋯:
 * "the Test connection button", or the action "on the AI agent page" with
 * no menu in the same sentence.
 */
function misplacedMentions(text: string): Array<string> {
  const found: Array<string> = [];

  for (const action of ACTIONS) {
    const name: string = action.replace(/\*/g, "");

    for (const paragraph of paragraphsNaming(text, action)) {
      for (const sentence of paragraph.split(/(?<=\.)\s+(?=\*\*|[A-Z])/)) {
        if (!sentence.includes(action)) {
          continue;
        }

        if (new RegExp(`${name}\\*\\* button`).test(sentence)) {
          found.push(sentence);
          continue;
        }

        if (
          new RegExp(`\\*\\*${name}\\*\\* on the AI agent page`).test(
            sentence,
          ) &&
          !sentence.includes(MENU)
        ) {
          found.push(sentence);
        }
      }
    }
  }

  return found;
}

function localeDirs(): Array<string> {
  return fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return entry.isDirectory() && entry.name !== "en";
    })
    .map((entry: fs.Dirent): string => {
      return entry.name;
    });
}

describe("the docs put an AI agent's actions in the ⋯ next to its status", () => {
  for (const page of PAGES) {
    it(`never sends the reader to a button that is gone, in ${page}`, () => {
      expect(
        misplacedMentions(read(path.join(CONTENT_DIR, "en", page))),
      ).toEqual([]);
    });
  }

  it("the Infrastructure AI Agents page lists the actions in the ⋯ on every resource's AI agent page", () => {
    const text: string = read(
      path.join(CONTENT_DIR, "en", "ai/infrastructure-ai-agents.md"),
    );

    expect(text).toContain(
      "and, in the **⋯** menu next to the agent's status, **Test connection** and **Reset agent**.",
    );
    expect(text).toContain(
      "**Test connection**, in the **⋯** menu next to the agent's status on the AI agent page, runs these read-only commands through the agent and shows their output in the agent's card:",
    );
    expect(text).toContain(
      "**Reset agent**, in the same **⋯** menu on the AI agent page, makes OneUptime forget the agent's key once you confirm it;",
    );
    // The table of what Test connection runs, per resource, is still there.
    expect(text).toContain("| Test connection runs");
  });

  it("the AI SRE page puts the cluster's test, reset and switch in the ⋯", () => {
    const text: string = read(path.join(CONTENT_DIR, "en", "ai/ai-sre.md"));

    expect(text).toContain(
      "**Test connection**, in the **⋯** menu next to the agent's status on the AI agent page, runs `kubectl version` and `kubectl auth can-i --list` through the agent",
    );
    expect(text).toContain(
      "**Reset agent**, in the same menu, makes the server forget the agent's key once you confirm it;",
    );
    expect(text).toContain(
      "offers **Switch to the AI agent** in the **⋯** menu next to the agent's status.",
    );
    // Who may reset is unchanged.
    expect(text).toContain("**Reset agent** takes the same people");
  });

  it("the Kubernetes agent page puts the test and the reset in the ⋯", () => {
    const text: string = read(
      path.join(CONTENT_DIR, "en", "telemetry/kubernetes-agent.md"),
    );

    expect(text).toContain(
      "shows it as Connected within a minute, and **Test connection**, in the **⋯** menu next to that status, runs `kubectl version` and `kubectl auth can-i --list` through it.",
    );
    expect(text).toContain(
      "**Reset agent**, in the **⋯** menu next to the agent's status on the AI agent page, makes the server forget the agent's key once you confirm it (a Project Owner, a Project Admin or **Edit Auto Remediation Rule** may do it);",
    );
  });

  it("every English mention of an action is in a paragraph that names the ⋯", () => {
    for (const page of PAGES) {
      const text: string = read(path.join(CONTENT_DIR, "en", page));

      for (const action of ACTIONS) {
        for (const paragraph of paragraphsNaming(text, action)) {
          if (PERMISSIONS_PARAGRAPH.test(paragraph)) {
            continue;
          }
          // Table rows name the test's commands, not where it is.
          if (paragraph.trim().startsWith("|")) {
            continue;
          }

          expect({
            page,
            action,
            namesTheMenu: paragraph.includes(MENU),
          }).toEqual({ page, action, namesTheMenu: true });
        }
      }
    }
  });

  it("no translated copy of these pages describes the actions somewhere else", () => {
    const locales: Array<string> = localeDirs();

    // So the check below cannot pass by reading nothing.
    expect(locales.length).toBeGreaterThanOrEqual(16);

    for (const locale of locales) {
      for (const page of PAGES) {
        const file: string = path.join(CONTENT_DIR, locale, page);

        if (!fs.existsSync(file)) {
          continue;
        }

        expect({
          file: `${locale}/${page}`,
          misplaced: misplacedMentions(read(file)),
        }).toEqual({ file: `${locale}/${page}`, misplaced: [] });
      }
    }
  });

  // The detector itself, on copy written to trip it and copy that should not.
  describe("the detector", () => {
    it("catches the old wording", () => {
      expect(
        misplacedMentions(
          "The cluster's page shows it as Connected, and its **Test connection** button runs `kubectl version` through it.",
        ),
      ).toHaveLength(1);
      expect(
        misplacedMentions(
          "**Reset agent** on the AI agent page makes the server forget the agent's key.",
        ),
      ).toHaveLength(1);
    });

    it("passes the new wording", () => {
      expect(
        misplacedMentions(
          "**Test connection**, in the **⋯** menu next to the agent's status on the AI agent page, runs it. **Reset agent**, in the same menu, resets it.",
        ),
      ).toEqual([]);
      expect(
        misplacedMentions(
          "**Reset agent** on the AI agent page, in its **⋯** menu, makes the server forget the agent's key.",
        ),
      ).toEqual([]);
    });
  });
});
