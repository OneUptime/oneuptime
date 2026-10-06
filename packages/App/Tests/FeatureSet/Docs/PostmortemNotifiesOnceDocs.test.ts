import Incident from "Common/Models/DatabaseModels/Incident";
import slugify from "Common/Server/Types/MarkdownSlugify";
import Permission from "Common/Types/Permission";
import IncidentPostmortemPublication, {
  PostmortemNotificationAction,
} from "Common/Types/StatusPage/IncidentPostmortemPublication";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs against when subscribers hear about a postmortem.
 *
 * They are told once, when it is published - the first time the status page
 * shows it, which takes Publish on Status Page on and a note written. Saving
 * it again, or editing it while it is published, tells nobody; publishing it
 * again after taking it off the status page tells them again
 * (IncidentPostmortemPublication). The English and Persian pages say so, the
 * labels and the API names they quote are the ones the product has, and
 * Markdown is not compiled, so these tests are what notices when the pages
 * and the server part ways.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);

function readDoc(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
}

// The text under a heading, up to the next heading of the same or a higher level.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line === heading;
  });

  expect(start).toBeGreaterThan(-1);

  const level: number = heading.indexOf(" ");
  const rest: Array<string> = lines.slice(start + 1);
  const end: number = rest.findIndex((line: string): boolean => {
    const match: RegExpMatchArray | null = line.match(/^(#+) /);
    return Boolean(match) && match![1]!.length <= level;
  });

  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

function postmortemBullet(language: string): string {
  const bullet: string | undefined = readDoc(language, "incidents/index.md")
    .split("\n")
    .find((line: string): boolean => {
      return line.startsWith("- **Postmortem** —");
    });

  expect(bullet).toBeDefined();

  return bullet!;
}

function inlineCode(markdown: string): Array<string> {
  return [...markdown.matchAll(/`([^`]+)`/g)]
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

const EN_HEADING: string = "#### The postmortem";
const FA_HEADING: string = "#### پس‌رویدادنامه";

describe("the subscriber docs on the postmortem", () => {
  const english: string = section(
    readDoc("en", "status-pages/subscribers.md"),
    EN_HEADING,
  ).replace(/\s+/g, " ");

  test("say subscribers are told once, when the status page first shows it", () => {
    expect(english).toContain(
      "Subscribers hear about an incident's postmortem once, when it is published: the first time the status page shows it.",
    );
    expect(english).toContain(
      "The status page shows a postmortem when **Publish on Status Page** is on and the postmortem has a note",
    );
  });

  test("say what tells nobody again, and what tells them again", () => {
    expect(english).toContain("**Saving it again tells nobody.**");
    expect(english).toContain(
      "**Editing a published postmortem tells nobody either.**",
    );
    expect(english).toContain(
      "**Taking it off the status page tells nobody, and publishing it again tells them again**",
    );
    expect(english).toContain(
      "**A postmortem switched on with no note shows nothing**",
    );
    expect(english).toContain(
      "**Notify Subscribers is read when the notification goes out.**",
    );
  });

  test("match what the server decides", () => {
    const note: string = "## What happened";

    // Saving it again, and editing it, while it is published.
    for (const written of [
      { postmortemNote: note, showPostmortemOnStatusPage: true },
      { postmortemNote: `${note}\n\nFollow-ups.` },
    ]) {
      expect(
        IncidentPostmortemPublication.isPublishedByUpdate({
          stored: { showPostmortemOnStatusPage: true, postmortemNote: note },
          written: written,
        }),
      ).toBe(false);
    }

    // Publishing it again after taking it off.
    expect(
      IncidentPostmortemPublication.isPublishedByUpdate({
        stored: { showPostmortemOnStatusPage: false, postmortemNote: note },
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toBe(true);

    // Switched on with no note: nothing on the status page.
    expect(
      IncidentPostmortemPublication.isPublished({
        showPostmortemOnStatusPage: true,
        postmortemNote: "  ",
      }),
    ).toBe(false);

    // Whitespace around the note is no change.
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: { postmortemNote: note },
        written: { postmortemNote: `\n${note}  ` },
      }),
    ).toBe(false);
  });

  test("say a whole-record write-back still publishes, and a publish that races a send is still announced once", () => {
    expect(english).toContain(
      "even when the request writes the whole incident back, its notification status as it stands included",
    );
    expect(english).toContain(
      "a postmortem published while one was being prepared is still announced once",
    );

    // The status written back as stored is no choice of the caller's.
    expect(
      IncidentPostmortemPublication.isStatusSetByUpdate({
        stored: {
          showPostmortemOnStatusPage: false,
          postmortemNote: "Note",
          subscriberNotificationStatusOnPostmortemPublished: "Skipped" as never,
        },
        written: {
          showPostmortemOnStatusPage: true,
          subscriberNotificationStatusOnPostmortemPublished: "Skipped",
        },
      }),
    ).toBe(false);
  });

  test("say the automatic AI draft never reaches subscribers, as the runner does", () => {
    expect(english).toContain(
      "The automatic AI postmortem draft is never written into a postmortem that is switched on",
    );

    const aiSre: string = readDoc("en", "ai/ai-sre.md").replace(/\s+/g, " ");

    expect(aiSre).toContain(
      "is not written into a postmortem already switched on with **Publish on Status Page**",
    );

    const runner: string = readSource(
      "Common/Server/Utils/AI/SRE/IncidentPostmortemRunner.ts",
    );

    expect(runner).toContain("showPostmortemOnStatusPage: true,");
    expect(runner).toContain(
      "if (incident.showPostmortemOnStatusPage === true) {",
    );
  });

  test("name API columns that incident editors may write", () => {
    const columns: Record<string, { update?: Array<Permission> }> =
      new Incident().getColumnAccessControlForAllColumns() as Record<
        string,
        { update?: Array<Permission> }
      >;

    for (const column of [
      "showPostmortemOnStatusPage",
      "postmortemNote",
      "subscriberNotificationStatusOnPostmortemPublished",
    ]) {
      expect(english).toContain(`\`${column}\``);
      expect(columns[column]?.update).toEqual(
        expect.arrayContaining([Permission.EditProjectIncident]),
      );
    }
  });

  test("quote the labels the product shows", () => {
    const sources: string = [
      "App/FeatureSet/Dashboard/src/Components/Postmortem/IncidentPostmortemForm.ts",
      "App/FeatureSet/Dashboard/src/Pages/Incidents/View/Postmortem.tsx",
    ]
      .map(readSource)
      .join("\n");

    for (const label of [
      "Publish on Status Page",
      "Notify Subscribers",
      "Edit Postmortem Note",
    ]) {
      expect(english).toContain(`**${label}**`);
      expect(sources).toContain(`"${label}"`);
    }

    // The feed item's own words.
    expect(english).toContain("**Postmortem Note updated**");
    expect(readSource("Common/Server/Services/IncidentService.ts")).toContain(
      "Postmortem Note updated for",
    );
  });

  /*
   * A postmortem published while its incident is hidden reached nobody, and
   * showing the incident used to leave it so (found in #4429). It is sent
   * when the incident is made visible, once.
   */
  test("say a postmortem published while its incident is hidden is sent when the incident is made visible, once", () => {
    expect(english).toContain(
      "**A postmortem published while its incident is hidden is sent when the incident is made visible.**",
    );
    expect(english).toContain(
      `the notification's status reads **${IncidentPostmortemPublication.hiddenIncidentLabel}**`,
    );
    expect(english).toContain(
      "Turning **Visible on Status Page** on sends it, once",
    );
    expect(english).toContain(
      "Hiding the incident and showing it again sends nothing more",
    );
    expect(english).toContain(
      "writing `isVisibleOnStatusPage` as `true` for a hidden incident sends a postmortem that waits for it",
    );

    // As the server decides: showing the incident queues the waiting postmortem...
    const waiting: Record<string, unknown> = {
      showPostmortemOnStatusPage: true,
      postmortemNote: "## What happened",
      isVisibleOnStatusPage: false,
      subscriberNotificationStatusOnPostmortemPublished: "Skipped",
      subscriberNotificationStatusMessageOnPostmortemPublished:
        IncidentPostmortemPublication.hiddenIncidentMessage,
    };

    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: waiting as never,
        written: { isVisibleOnStatusPage: true },
      }),
    ).toBe(PostmortemNotificationAction.QueueIfSkippedAsHidden);

    // ...but not one that was sent, nor one that is not published.
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: {
          ...waiting,
          subscriberNotificationStatusOnPostmortemPublished: "Success",
        } as never,
        written: { isVisibleOnStatusPage: true },
      }),
    ).toBe(PostmortemNotificationAction.None);
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: { ...waiting, showPostmortemOnStatusPage: false } as never,
        written: { isVisibleOnStatusPage: true },
      }),
    ).toBe(PostmortemNotificationAction.None);
  });

  test("quote the labels the incident's pages show for a postmortem that waits for its incident", () => {
    const settingsPage: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Incidents/View/Settings.tsx",
    );

    expect(english).toContain("**Visible on Status Page**");
    expect(settingsPage).toContain('"Visible on Status Page"');
    // The label is the rule's, drawn by the Postmortem page.
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Pages/Incidents/View/Postmortem.tsx",
      ),
    ).toContain("IncidentPostmortemPublication.hiddenIncidentLabel");
  });

  test("the Persian page says the same, with the same API names and labels", () => {
    const persian: string = section(
      readDoc("fa", "status-pages/subscribers.md"),
      FA_HEADING,
    );

    expect(inlineCode(persian)).toEqual(
      inlineCode(
        section(readDoc("en", "status-pages/subscribers.md"), EN_HEADING),
      ),
    );

    for (const label of [
      "**Publish on Status Page**",
      "**Notify Subscribers**",
      "**Edit Postmortem Note**",
      "**Postmortem Note updated**",
      "**Retry**",
      "**Visible on Status Page**",
      `**${IncidentPostmortemPublication.hiddenIncidentLabel}**`,
    ]) {
      expect(persian).toContain(label);
    }
  });
});

describe("the declaring docs on publishing a hidden incident later", () => {
  test.each([
    ["en", "[The postmortem](/docs/status-pages/subscribers#the-postmortem)"],
    [
      "fa",
      `(/docs/status-pages/subscribers#${slugify(FA_HEADING.replace(/^#+ /, ""))})`,
    ],
  ])(
    "the %s page says its postmortem needs no box, and links to the subscriber docs' section",
    (language: string, link: string) => {
      const paragraph: string | undefined = readDoc(
        language,
        "incidents/declaring-incidents.md",
      )
        .split("\n")
        .find((line: string): boolean => {
          return line.includes("notifySubscribersOfIncidentCreatedOnPublish");
        });

      expect(paragraph).toBeDefined();
      expect(paragraph).toContain("**Visible on Status Page**");
      expect(paragraph).toContain(link);
    },
  );

  test("the English page says it is sent once", () => {
    expect(readDoc("en", "incidents/declaring-incidents.md")).toContain(
      "A postmortem published while the incident was hidden needs no box: turning **Visible on Status Page** on sends it once",
    );
  });
});

describe("the incident page's Postmortem item", () => {
  test("says subscribers are told once, and links to the subscriber docs' section", () => {
    const bullet: string = postmortemBullet("en");

    expect(bullet).toContain(
      "Subscribers are told once, when the postmortem is published",
    );
    expect(bullet).toContain(
      "Saving it again, or editing it while it is published, updates the status page and tells nobody",
    );
    expect(bullet).toContain(
      `(/docs/status-pages/subscribers#${slugify(EN_HEADING.replace(/^#+ /, ""))})`,
    );
    expect(bullet).toContain(
      "One published while the incident is hidden is sent when the incident is made visible.",
    );
  });

  test("the Persian item says it too, and links to the Persian section", () => {
    const bullet: string = postmortemBullet("fa");

    expect(bullet).toContain("**Publish on Status Page**");
    expect(bullet).toContain(
      `(/docs/status-pages/subscribers#${slugify(FA_HEADING.replace(/^#+ /, ""))})`,
    );
  });
});

describe("the incident feed docs", () => {
  test.each(["en", "fa"])(
    "the %s page says a PostmortemNote item follows a changed note, not every save",
    (language: string) => {
      const line: string | undefined = readDoc(
        language,
        "incidents/notes-owners-and-feed.md",
      )
        .split("\n")
        .find((candidate: string): boolean => {
          return (
            candidate.includes("`PostmortemNote`") &&
            candidate.startsWith("- **")
          );
        });

      expect(line).toBeDefined();
      // The sentence after the list names the item a second time.
      expect(line!.split("`PostmortemNote`").length - 1).toBe(2);
    },
  );
});
