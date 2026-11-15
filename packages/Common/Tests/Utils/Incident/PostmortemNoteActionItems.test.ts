import PostmortemNoteActionItems, {
  ACTION_ITEM_HEADING_SUBSTRINGS,
  ACTION_ITEM_HEADING_WORDS,
  MAX_ACTION_ITEM_TITLE_LENGTH,
  MAX_NOTE_ACTION_ITEMS,
  PostmortemNoteActionItem,
} from "../../../Utils/Incident/PostmortemNoteActionItems";
import {
  AITemplate,
  POSTMORTEM_TEMPLATES,
} from "../../../UI/Components/AI/AITemplates";
import { describe, expect, test } from "@jest/globals";

/*
 * A postmortem's action items, read out of its note (#6801): what the
 * postmortem offers to track in one click. Read on the notes people and
 * OneUptime AI actually write - the three outlines OneUptime AI fills in
 * and the project's own templates start from, filled in and left as they
 * are - and on the shapes a note takes beside them.
 */

const titlesOf: (items: Array<PostmortemNoteActionItem>) => Array<string> = (
  items: Array<PostmortemNoteActionItem>,
): Array<string> => {
  return items.map((item: PostmortemNoteActionItem): string => {
    return item.title;
  });
};

const templateNamed: (id: string) => AITemplate = (id: string): AITemplate => {
  const template: AITemplate | undefined = POSTMORTEM_TEMPLATES.find(
    (candidate: AITemplate): boolean => {
      return candidate.id === id;
    },
  );

  if (!template) {
    throw new Error(`No postmortem template ${id}.`);
  }

  return template;
};

describe("a note with nothing to read", () => {
  test("lists no action items when it is empty", () => {
    expect(PostmortemNoteActionItems.read(undefined)).toEqual([]);
    expect(PostmortemNoteActionItems.read(null)).toEqual([]);
    expect(PostmortemNoteActionItems.read("")).toEqual([]);
    expect(PostmortemNoteActionItems.read("  \n\n ")).toEqual([]);
  });

  test("lists none when no section names action items, however many lists it has", () => {
    const note: string = `## What Happened
- The database ran out of connections
- Checkout returned 503s

## Lessons Learned
- Alerts fired late`;

    expect(PostmortemNoteActionItems.read(note)).toEqual([]);
  });

  test("lists none from an outline left as it is: its placeholders are not actions", () => {
    for (const template of POSTMORTEM_TEMPLATES) {
      expect(PostmortemNoteActionItems.read(template.content)).toEqual([]);
    }
  });
});

describe("the outlines OneUptime AI fills in", () => {
  test("Standard Postmortem: the checklist under Action Items, checked items done", () => {
    const note: string = templateNamed("default-standard")
      .content.replace(
        "- [ ] [Action item 1]",
        "- [x] Increase the connection pool from 10 to 20",
      )
      .replace(
        "- [ ] [Action item 2]",
        "- [ ] Alert on connection pool usage above 80%",
      )
      .replace(
        "- [ ] [Action item 3]",
        "- [ ] Add a regression test for the authentication service leak",
      );

    expect(PostmortemNoteActionItems.read(note)).toEqual([
      { title: "Increase the connection pool from 10 to 20", isDone: true },
      { title: "Alert on connection pool usage above 80%", isDone: false },
      {
        title: "Add a regression test for the authentication service leak",
        isDone: false,
      },
    ]);
  });

  test("Detailed Technical Postmortem: each row of the Action Items table, with its owner and due date", () => {
    const note: string = templateNamed("default-detailed").content.replace(
      "| [Action] | [Name] | [High/Medium/Low] | [Date] |",
      [
        "| Add a monitor for the queue depth | Ana Silva | High | 2026-11-20 |",
        "| Write a runbook for failing over the database | [Name] | Medium | next week |",
      ].join("\n"),
    );

    const items: Array<PostmortemNoteActionItem> =
      PostmortemNoteActionItems.read(note);

    expect(items).toEqual([
      {
        title: "Add a monitor for the queue depth",
        isDone: false,
        ownerText: "Ana Silva",
        dueDay: "2026-11-20",
      },
      // A placeholder owner is no owner, and "next week" is no date.
      {
        title: "Write a runbook for failing over the database",
        isDone: false,
      },
    ]);
  });

  test("Detailed Technical Postmortem: what went well and wrong, under Prevention, is not an action item", () => {
    const note: string = templateNamed("default-detailed")
      .content.replace("- [Item 1]", "- Paging reached the right person")
      .replace("- [Item 2]", "- The dashboards were clear");

    expect(PostmortemNoteActionItems.read(note)).toEqual([]);
  });

  test("Brief Postmortem: the checklist under How We Prevent It", () => {
    const note: string = templateNamed("default-brief").content.replace(
      "- [ ] [Prevention action 1]",
      "- [ ] Rate-limit the export endpoint",
    );

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "Rate-limit the export endpoint",
    ]);
  });
});

describe("the sections that hold action items", () => {
  test("a bold line on its own is a heading, as a responder's note writes it", () => {
    const note: string = `## Root Cause Analysis

Investigated the database connection timeout.

**Action Items:**
- Applied hotfix to authentication service
- Increased connection pool size from 10 to 20
- Added monitoring alerts for connection pool usage

**Lessons:**
- Not an action item`;

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "Applied hotfix to authentication service",
      "Increased connection pool size from 10 to 20",
      "Added monitoring alerts for connection pool usage",
    ]);
  });

  test("a section runs to the next heading of its level, keeping its own sub-headings", () => {
    const note: string = `# Postmortem

## Action Items

### This week
1. Roll back the cache change
2. Page the database team on pool exhaustion

### This quarter
- Move sessions out of Postgres

## Appendix
- Graphs`;

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "Roll back the cache change",
      "Page the database team on pool exhaustion",
      "Move sessions out of Postgres",
    ]);
  });

  test("a heading may say it in many ways", () => {
    for (const heading of [
      "## Follow-ups",
      "## Follow-up Actions",
      "## Next Steps",
      "### Corrective Actions",
      "### Preventive actions",
      "## Open Action Items",
      "## Action Items (owners and dates)",
      "## TODO",
      "## To Do",
      "## Tasks",
    ]) {
      expect(
        titlesOf(
          PostmortemNoteActionItems.read(
            `${heading}\n- Add a canary for the deploy`,
          ),
        ),
      ).toEqual(["Add a canary for the deploy"]);
    }
  });

  test("a heading that only mentions doing something is not one", () => {
    for (const heading of [
      "## How to do a rollback",
      "## Prevention",
      "## Actions taken during the incident",
      "## Next Update",
      "## Mitigation & Resolution",
    ]) {
      expect(
        PostmortemNoteActionItems.read(`${heading}\n- Restarted the pods`),
      ).toEqual([]);
    }
  });

  test("a heading in each of the Dashboard's other languages", () => {
    for (const heading of [
      "## Aktionspunkte",
      "## Nächste Schritte",
      "## Plan d'action",
      "## Prochaines étapes",
      "## Próximos pasos",
      "## Azioni correttive",
      "## Itens de ação",
      "## Actiepunten",
      "## Handlingspunkter",
      "## Neste steg",
      "## Åtgärdspunkter",
      "## Следующие шаги",
      "## アクションアイテム",
      "## 재발 방지 대책",
      "## 后续行动",
      "## 行動項目",
      "## कार्य आइटम",
      "## گام‌های بعدی",
      "## الخطوات التالية",
    ]) {
      expect(
        titlesOf(PostmortemNoteActionItems.read(`${heading}\n- Fix the cache`)),
      ).toEqual(["Fix the cache"]);
    }
  });

  test("every heading word is matched as it is written in the table", () => {
    for (const phrase of ACTION_ITEM_HEADING_WORDS) {
      expect(PostmortemNoteActionItems.isActionItemHeading(phrase)).toBe(true);
    }

    for (const phrase of ACTION_ITEM_HEADING_SUBSTRINGS) {
      expect(PostmortemNoteActionItems.isActionItemHeading(phrase)).toBe(true);
    }
  });

  test("two action items sections are both read, in order", () => {
    const note: string = `## Action Items
- First

## Timeline
- 10:00 paged

## Follow-ups
- Second`;

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "First",
      "Second",
    ]);
  });
});

describe("the items of a section", () => {
  test("a nested item is a detail of the one above it", () => {
    const note: string = `## Action Items
- Increase the pool size
  - from 10 to 20
  - in every region
- Alert on pool usage`;

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "Increase the pool size",
      "Alert on pool usage",
    ]);
  });

  test("an indented list is the outermost one when the section has no other", () => {
    const note: string = `## Action Items
   - Increase the pool size
   - Alert on pool usage`;

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "Increase the pool size",
      "Alert on pool usage",
    ]);
  });

  test("Markdown's marks are taken off, an underscore inside a name stays", () => {
    const note: string = `## Action Items
- **Alert** on \`db_pool_wait_seconds\` above _two_ seconds
- Read [the pool guide](https://example.com/pool) and ~~skip~~ apply it`;

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "Alert on db_pool_wait_seconds above two seconds",
      "Read the pool guide and skip apply it",
    ]);
  });

  test("an owner and a due date written in the item go to their own fields", () => {
    const note: string = `## Action Items
- [ ] Increase the pool (Owner: Ana Silva, due 2026-11-20)
- [ ] Ship the fix by 2026-12-01
- [ ] Write the runbook - owner: Kim`;

    expect(PostmortemNoteActionItems.read(note)).toEqual([
      {
        title: "Increase the pool",
        isDone: false,
        ownerText: "Ana Silva",
        dueDay: "2026-11-20",
      },
      {
        title: "Ship the fix",
        isDone: false,
        dueDay: "2026-12-01",
      },
      { title: "Write the runbook", isDone: false, ownerText: "Kim" },
    ]);
  });

  test("a date that is no day is no due date", () => {
    expect(
      PostmortemNoteActionItems.read(
        "## Action Items\n| Action | Due |\n|---|---|\n| Fix it | 2026-02-30 |",
      ),
    ).toEqual([{ title: "Fix it", isDone: false }]);
  });

  test("an item that says there is nothing to do is not one", () => {
    const note: string = `## Action Items
- None.
- N/A
- TBD
- Not available in the incident record.
- [ ]
- Real one`;

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "Real one",
    ]);
  });

  test("a code block in the section is not read, nor a heading inside it", () => {
    const note: string = `## Action Items
- Rotate the key
\`\`\`
- not an item
## Action Items
- still not an item
\`\`\`
- Audit the vault`;

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "Rotate the key",
      "Audit the vault",
    ]);
  });

  test("a long item is cut to the length a title holds", () => {
    const long: string = "a".repeat(MAX_ACTION_ITEM_TITLE_LENGTH + 40);
    const items: Array<PostmortemNoteActionItem> =
      PostmortemNoteActionItems.read(`## Action Items\n- ${long}`);

    expect(items[0]!.title.length).toBe(MAX_ACTION_ITEM_TITLE_LENGTH);
    expect(items[0]!.title.endsWith("…")).toBe(true);
  });

  test("a note is read for at most so many items", () => {
    const lines: Array<string> = ["## Action Items"];

    for (let index: number = 0; index < MAX_NOTE_ACTION_ITEMS + 10; index++) {
      lines.push(`- Item ${index}`);
    }

    expect(PostmortemNoteActionItems.read(lines.join("\n"))).toHaveLength(
      MAX_NOTE_ACTION_ITEMS,
    );
  });

  test("Windows line endings read as any other", () => {
    expect(
      titlesOf(
        PostmortemNoteActionItems.read("## Action Items\r\n- One\r\n- Two\r\n"),
      ),
    ).toEqual(["One", "Two"]);
  });
});

describe("a table of action items", () => {
  test("the action is read from the column named for it, wherever it is", () => {
    const note: string = `## Action Items
| Owner | Task | Status | Deadline |
|:------|:-----|:------:|---------:|
| Ana | Add a canary | Done | 2026-11-20 |
| Kim | Tune the alert | Open | |
| Lee | Retire the old host | ✅ | |`;

    expect(PostmortemNoteActionItems.read(note)).toEqual([
      {
        title: "Add a canary",
        isDone: true,
        ownerText: "Ana",
        dueDay: "2026-11-20",
      },
      { title: "Tune the alert", isDone: false, ownerText: "Kim" },
      { title: "Retire the old host", isDone: true, ownerText: "Lee" },
    ]);
  });

  test("with no column named for the action, the first column is the action", () => {
    const note: string = `## Follow-ups
| Fix | Who |
| --- | --- |
| Pin the base image | Ana |`;

    expect(PostmortemNoteActionItems.read(note)).toEqual([
      { title: "Pin the base image", isDone: false, ownerText: "Ana" },
    ]);
  });

  test("an escaped pipe stays in its cell", () => {
    const note: string = `## Action Items
| Action | Owner |
| --- | --- |
| Grep for a \\| b in the logs | Ana |`;

    expect(titlesOf(PostmortemNoteActionItems.read(note))).toEqual([
      "Grep for a | b in the logs",
    ]);
  });

  test("rows without a separator row are not a table", () => {
    const note: string = `## Action Items
| Not | a table |
| Still | not |`;

    expect(PostmortemNoteActionItems.read(note)).toEqual([]);
  });
});

describe("a due day, placed as the Due Date picker places one", () => {
  test("is the start of that day in the reader's time zone", () => {
    expect(
      PostmortemNoteActionItems.toDueDate("2026-11-20", "Asia/Kolkata"),
    ).toEqual(new Date("2026-11-19T18:30:00.000Z"));
    expect(
      PostmortemNoteActionItems.toDueDate("2026-11-20", "America/New_York"),
    ).toEqual(new Date("2026-11-20T05:00:00.000Z"));
  });

  test("is the start of that day in UTC for a zone this build does not know", () => {
    expect(
      PostmortemNoteActionItems.toDueDate("2026-11-20", "Mars/Olympus_Mons"),
    ).toEqual(new Date("2026-11-20T00:00:00.000Z"));
  });

  test("is no date for anything that is not a day", () => {
    expect(PostmortemNoteActionItems.toDueDate("next week", "UTC")).toBeNull();
    expect(PostmortemNoteActionItems.toDueDate("2026-02-30", "UTC")).toBeNull();
  });
});

describe("the items not tracked yet", () => {
  const items: Array<PostmortemNoteActionItem> = [
    { title: "Increase the connection pool", isDone: false },
    { title: "Alert on pool usage", isDone: false },
    { title: "alert on pool usage.", isDone: false },
    { title: "Write the runbook", isDone: true },
  ];

  test("leave out those the incident tracks, whatever their case and punctuation", () => {
    expect(
      PostmortemNoteActionItems.getUntracked({
        items: items,
        trackedTitles: [
          "increase the connection pool!",
          "  Write   the runbook",
        ],
      }),
    ).toEqual([{ title: "Alert on pool usage", isDone: false }]);
  });

  test("count an item the note lists twice once", () => {
    expect(
      titlesOf(
        PostmortemNoteActionItems.getUntracked({
          items: items,
          trackedTitles: [],
        }),
      ),
    ).toEqual([
      "Increase the connection pool",
      "Alert on pool usage",
      "Write the runbook",
    ]);
  });

  test("are none once every one is tracked", () => {
    expect(
      PostmortemNoteActionItems.getUntracked({
        items: items,
        trackedTitles: [
          "Increase the connection pool",
          "Alert on pool usage",
          "Write the runbook",
        ],
      }),
    ).toEqual([]);
  });
});
