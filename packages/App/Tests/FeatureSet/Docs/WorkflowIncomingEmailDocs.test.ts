import Workflow from "Common/Models/DatabaseModels/Workflow";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import { PermissionHelper } from "Common/Types/Permission";
import ComponentMetadata, {
  ReturnValue,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Components from "Common/Types/Workflow/Components";
import { MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH } from "Common/Types/Workflow/IncomingEmailTrigger";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs for the Incoming Email trigger, against the product.
 *
 * Markdown is not compiled, so nothing else notices when a button the page
 * tells readers to click is renamed, when a value it lists stops being one
 * the trigger hands on, or when the people it says may see the address are
 * no longer the ones who can. The panel is React, which App does not load, so
 * its source is read as text.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

const PANEL_SOURCE: string = path.resolve(
  __dirname,
  "../../../../Common/UI/Components/Workflow/IncomingEmailTriggerPanel.tsx",
);

const readDoc: (page: string) => string = (page: string): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
};

/*
 * The text under `heading` up to the next heading of the same or a higher
 * level.
 */
const sectionOf: (page: string, heading: string) => string = (
  page: string,
  heading: string,
): string => {
  const start: number = page.indexOf(`\n${heading}\n`);

  expect(start).toBeGreaterThanOrEqual(0);

  const level: number = heading.indexOf(" ");
  const rest: string = page.slice(start + heading.length + 2);
  const next: RegExpMatchArray | null = rest.match(
    new RegExp(`^#{1,${level}} `, "m"),
  );

  return next && next.index !== undefined ? rest.slice(0, next.index) : rest;
};

const FENCE: RegExp = /^\s*```/;
const HEADING: RegExp = /^#{1,6} /;

// A `#` line inside a fenced block is a comment, not a heading.
const headingSlugs: (markdown: string) => Array<string> = (
  markdown: string,
): Array<string> => {
  let inFence: boolean = false;

  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return false;
      }

      return !inFence && HEADING.test(line);
    })
    .map((line: string): string => {
      return slugify(line.replace(HEADING, "").trim());
    });
};

const triggers: string = readDoc("workflows/triggers.md");
const configuration: string = readDoc("workflows/configuration.md");
const inboundGuide: string = readDoc("self-hosted/sendgrid-inbound-email.md");
const section: string = sectionOf(triggers, "## Incoming Email");
const security: string = sectionOf(configuration, "## Incoming email security");

const metadata: ComponentMetadata = Components.find(
  (component: ComponentMetadata) => {
    return component.id === ComponentID.IncomingEmail;
  },
)!;

describe("the Incoming Email section of the triggers page", () => {
  test("quotes the panel's own button names", () => {
    const panel: string = fs.readFileSync(PANEL_SOURCE, "utf8");

    for (const label of ["Copy address", "Reset address", "Show"]) {
      expect(section).toContain(`**${label}**`);
      expect(panel).toContain(`"${label}"`);
    }
  });

  test("lists every value the trigger hands on, by the name the step shows", () => {
    for (const returnValue of metadata.returnValues as Array<ReturnValue>) {
      expect({
        value: returnValue.name,
        listed: section.includes(`**${returnValue.name}**`),
      }).toEqual({
        value: returnValue.name,
        listed: true,
      });
    }
  });

  test("the size it says bodies are cut at is the one the trigger cuts at", () => {
    expect(MAX_INCOMING_EMAIL_TRIGGER_BODY_LENGTH).toBe(1024 * 1024);
    expect(section).toContain("cut at 1 MB");
  });

  test("its links land on headings that exist", () => {
    expect(section).toContain(
      "(/docs/workflows/configuration#incoming-email-security)",
    );
    expect(headingSlugs(configuration)).toContain("incoming-email-security");

    expect(section).toContain("(/docs/self-hosted/sendgrid-inbound-email)");
  });

  test("the page counts the trigger among the kinds, and in the chooser", () => {
    expect(triggers).toContain("You pick from five kinds.");
    expect(triggers).toMatch(
      /\| Start from an email\s+\| \*\*Incoming Email\*\*/,
    );
  });

  test("the Webhook section still ends where it did, before Incoming Email", () => {
    const webhookStart: number = triggers.indexOf("## Webhook");
    const webhookEnd: number = triggers.indexOf("\n## ", webhookStart + 1);

    expect(triggers.slice(webhookEnd + 1).startsWith("## Incoming Email")).toBe(
      true,
    );
  });
});

describe("incoming email security", () => {
  test("names exactly the permissions that can read the key", () => {
    const accessControl: ColumnAccessControl | null =
      new Workflow().getColumnAccessControlFor("incomingEmailSecretKey");
    const titles: Array<string> = PermissionHelper.getPermissionTitles(
      accessControl?.read || [],
    );

    expect(titles.sort()).toEqual(
      [
        "Edit Workflow",
        "Project Admin",
        "Project Owner",
        "Workflow Admin",
      ].sort(),
    );

    for (const title of titles) {
      expect(security).toContain(`**${title}**`);
    }
  });

  test("says how to reset a leaked address, with the panel's button", () => {
    expect(security).toContain("**Reset address**");
    expect(security).toContain("**Copy address**");
  });

  test("the permissions list says Edit Workflow is what it takes to see the address", () => {
    expect(configuration).toContain(
      "to see or reset a workflow's webhook URL and incoming email address",
    );
  });

  test("turning a workflow off is said to stop incoming email too", () => {
    expect(configuration).toContain(
      "webhook calls, incoming email, scheduled times, and OneUptime events are all ignored",
    );
  });
});

describe("the self-hosted inbound email guide", () => {
  test("says workflows use the same setup, and links to the trigger", () => {
    expect(inboundGuide).toContain("(/docs/workflows/triggers#incoming-email)");
    expect(headingSlugs(triggers)).toContain("incoming-email");
  });

  test("shows a workflow address in the shape the trigger gives", () => {
    expect(inboundGuide).toContain("`workflow-…@inbound.yourdomain.com`");
  });
});
