import {
  MAX_ROWS_IN_ROLLUP,
  ROLLUP_PROJECT_NAME_MAX,
  ROLLUP_SUBJECT_LEAD_TITLE_MAX,
  ROLLUP_SUBJECT_MAX_CATEGORIES,
} from "../../../../Server/Utils/EmailRollup/EmailRollupConstants";
import {
  RollupEmail,
  RollupRow,
  buildRollupEmail,
  foldItems,
} from "../../../../Server/Utils/EmailRollup/EmailRollupRenderer";
import UserNotificationEmailRollupItem from "../../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import RollupCategory, {
  ROLLUP_CATEGORY_LABEL,
  ROLLUP_CATEGORY_ORDER,
} from "../../../../Types/NotificationSetting/NotificationEmailRollupCategory";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import { describe, expect, test } from "@jest/globals";

/*
 * The rollup email is the ONLY thing a flooded recipient sees instead of the
 * forty individual emails it replaces, so everything that can quietly ruin it
 * is pinned here.
 *
 * What breaks in production if this regresses:
 *
 *  - Fold on the wrong key and one incident's created / acknowledged /
 *    resolved emails stay three rows carrying three contradictory states,
 *    which is worse than the three separate emails were.
 *  - Count categories over the rendered slice instead of over every item and
 *    the email claims a 300-notification storm was 100 notifications, which
 *    breaks the one promise this feature makes: nothing was suppressed.
 *  - Get the escaping contract backwards and a resource title containing
 *    markup is either an XSS hole in a mail client or a wall of visible
 *    `&amp;lt;`. Both have already shipped in this repo's templates.
 *  - Leave the Handlebars braces in the subject and MailService, which
 *    compiles the subject as a template, substitutes an incident title away
 *    to an empty string on its way to the inbox.
 *  - Drop the opt-out from the footer copy and rollup becomes a thing that
 *    happens TO people: it is on by default with no preference, so this email
 *    is the only place a recipient who wants one email per event finds out
 *    they can have that back.
 *  - Stop alternating rowBackground and a hundred-row table is one flat wall
 *    of white, which is how it actually shipped: the template asked for
 *    {{#if @odd}}, a data variable Handlebars does not define.
 *
 * Pure and synchronous: no database, no clock, no mocks.
 */

const BASE_TIME_MS: number = Date.UTC(2026, 8, 3, 12, 0, 0);

type AtFunction = (offsetSeconds: number) => Date;

const at: AtFunction = (offsetSeconds: number): Date => {
  return new Date(BASE_TIME_MS + offsetSeconds * 1000);
};

interface ItemInput {
  createdAt: Date;
  subject: string;
  eventType?: NotificationSettingEventType | undefined;
  viewLink?: string | undefined;
  rollupCategory?: RollupCategory | undefined;
}

type MakeItemFunction = (input: ItemInput) => UserNotificationEmailRollupItem;

/*
 * exactOptionalPropertyTypes is on, so an optional property is assigned only
 * when there is something to assign - `item.viewLink = undefined` does not
 * compile, and a linkless item is exactly the case the fold has to handle.
 */
const makeItem: MakeItemFunction = (
  input: ItemInput,
): UserNotificationEmailRollupItem => {
  const item: UserNotificationEmailRollupItem =
    new UserNotificationEmailRollupItem();

  item.createdAt = input.createdAt;
  item.subject = input.subject;
  item.eventType =
    input.eventType ??
    NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;
  item.rollupCategory = input.rollupCategory ?? RollupCategory.Incidents;

  if (input.viewLink !== undefined) {
    item.viewLink = input.viewLink;
  }

  return item;
};

type SortAscendingFunction = (
  items: Array<UserNotificationEmailRollupItem>,
) => Array<UserNotificationEmailRollupItem>;

const sortAscending: SortAscendingFunction = (
  items: Array<UserNotificationEmailRollupItem>,
): Array<UserNotificationEmailRollupItem> => {
  return items
    .slice()
    .sort(
      (
        a: UserNotificationEmailRollupItem,
        b: UserNotificationEmailRollupItem,
      ): number => {
        return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
      },
    );
};

type BuildFunction = (
  items: Array<UserNotificationEmailRollupItem>,
  projectName?: string,
) => RollupEmail;

const build: BuildFunction = (
  items: Array<UserNotificationEmailRollupItem>,
  projectName: string = "Acme",
): RollupEmail => {
  return buildRollupEmail({
    projectName: projectName,
    projectHomeLink: "https://oneuptime.example.com/dashboard/p1/home",
    preferencesLink:
      "https://oneuptime.example.com/dashboard/p1/user-settings/notification-settings",
    items: sortAscending(items),
  });
};

type VarStringFunction = (email: RollupEmail, name: string) => string;

/*
 * Throws rather than stringifying, so a renamed variable fails the assertion
 * that reads it instead of quietly comparing against "undefined".
 */
const varString: VarStringFunction = (
  email: RollupEmail,
  name: string,
): string => {
  const value: string | JSONObject | undefined = email.vars[name];

  if (typeof value !== "string") {
    throw new Error(`Template var "${name}" is not a string`);
  }

  return value;
};

type VarRowsFunction = (email: RollupEmail) => Array<JSONObject>;

const varRows: VarRowsFunction = (email: RollupEmail): Array<JSONObject> => {
  return email.vars["rows"] as unknown as Array<JSONObject>;
};

type RowFieldFunction = (row: JSONObject, name: string) => string;

const rowField: RowFieldFunction = (row: JSONObject, name: string): string => {
  const value: JSONValue | undefined = row[name];

  if (typeof value !== "string") {
    throw new Error(`Row field "${name}" is not a string`);
  }

  return value;
};

/*
 * The vars the template hands to a TRIPLE stache. These carry plain text that
 * this builder has already escaped.
 */
const HTML_VAR_NAMES: Array<string> = [
  "rollupIntroHtml",
  "moreTextHtml",
  "preferencesHtml",
];

/*
 * The vars the template renders through a DOUBLE stache, where Handlebars
 * escapes them. These must arrive RAW - pre-escaping one would show the
 * recipient a literal "&amp;amp;".
 *
 * categoryCounts is the one that moved between the two lists when the summary
 * card replaced the TitleBlock the counts used to be rendered through, which
 * is exactly the kind of change that ships a wall of "&amp;quot;" to
 * everybody, so both lists are pinned rather than only the escaped one.
 */
const RAW_VAR_NAMES: Array<string> = [
  "rollupTitle",
  "summaryCount",
  "summaryWindow",
  "categoryCounts",
];

describe("foldItems", () => {
  test("four items sharing one view link fold to one row carrying the latest subject", () => {
    const link: string =
      "https://oneuptime.example.com/dashboard/p1/incidents/i1";

    const rows: Array<RollupRow> = foldItems(
      sortAscending([
        makeItem({
          createdAt: at(0),
          subject: "Checkout is down",
          viewLink: link,
        }),
        makeItem({
          createdAt: at(60),
          subject: "Checkout is down - acknowledged",
          viewLink: link,
        }),
        makeItem({
          createdAt: at(120),
          subject: "Checkout is down - investigating",
          viewLink: link,
        }),
        makeItem({
          createdAt: at(180),
          subject: "Checkout is down - resolved",
          viewLink: link,
        }),
      ]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Checkout is down - resolved");
    expect(rows[0]!.itemCount).toBe(4);
    expect(rows[0]!.itemCount).toBe(4);
    expect(rows[0]!.link).toBe(link);
    expect(rows[0]!.hasLink).toBe("true");
  });

  test("the fold key is the link ALONE, so a different event type on the same resource still folds", () => {
    const link: string =
      "https://oneuptime.example.com/dashboard/p1/incidents/i1";

    const rows: Array<RollupRow> = foldItems(
      sortAscending([
        makeItem({
          createdAt: at(0),
          subject: "Incident created",
          viewLink: link,
          eventType:
            NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
        }),
        makeItem({
          createdAt: at(60),
          subject: "Incident state changed",
          viewLink: link,
          eventType:
            NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
        }),
      ]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Incident state changed");
    expect(rows[0]!.itemCount).toBe(2);
  });

  test("two different links produce two rows, newest group first", () => {
    const older: string =
      "https://oneuptime.example.com/dashboard/p1/alerts/a1";
    const newer: string =
      "https://oneuptime.example.com/dashboard/p1/incidents/i9";

    const rows: Array<RollupRow> = foldItems(
      sortAscending([
        makeItem({ createdAt: at(0), subject: "Old alert", viewLink: older }),
        makeItem({
          createdAt: at(30),
          subject: "Old alert again",
          viewLink: older,
        }),
        makeItem({
          createdAt: at(600),
          subject: "Fresh incident",
          viewLink: newer,
        }),
      ]),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!.title).toBe("Fresh incident");
    expect(rows[0]!.itemCount).toBe(1);
    expect(rows[1]!.title).toBe("Old alert again");
    expect(rows[1]!.itemCount).toBe(2);
  });

  test("items with no view link fold on event type plus subject", () => {
    const rows: Array<RollupRow> = foldItems(
      sortAscending([
        makeItem({
          createdAt: at(0),
          subject: "Probe eu-west is disconnected",
          eventType:
            NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
          rollupCategory: RollupCategory.Probes,
        }),
        makeItem({
          createdAt: at(60),
          subject: "Probe eu-west is disconnected",
          eventType:
            NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
          rollupCategory: RollupCategory.Probes,
        }),
        makeItem({
          createdAt: at(120),
          subject: "Probe us-east is disconnected",
          eventType:
            NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
          rollupCategory: RollupCategory.Probes,
        }),
        /*
         * Same words, different event: these are two genuinely different
         * notices and must not be collapsed into one line.
         */
        makeItem({
          createdAt: at(180),
          subject: "Probe us-east is disconnected",
          eventType:
            NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION,
          rollupCategory: RollupCategory.Probes,
        }),
      ]),
    );

    const counts: Array<number> = rows.map((row: RollupRow): number => {
      return row.itemCount;
    });

    expect(rows).toHaveLength(3);
    expect(counts).toEqual([1, 1, 2]);
    expect(
      rows.every((row: RollupRow): boolean => {
        return row.hasLink === "false" && row.link === "";
      }),
    ).toBe(true);
  });

  test("an empty list folds to no rows", () => {
    expect(foldItems([])).toEqual([]);
  });
});

describe("buildRollupEmail category counts", () => {
  test("counts every item, not the rendered slice: 300 items, 100 rows, 300 counted", () => {
    const items: Array<UserNotificationEmailRollupItem> = [];

    for (let index: number = 0; index < 300; index++) {
      items.push(
        makeItem({
          createdAt: at(index),
          subject: `Event ${index}`,
          viewLink: `https://oneuptime.example.com/dashboard/p1/r/${index}`,
          rollupCategory:
            index < 200 ? RollupCategory.Monitors : RollupCategory.Incidents,
        }),
      );
    }

    const email: RollupEmail = build(items);

    expect(varRows(email)).toHaveLength(MAX_ROWS_IN_ROLLUP);

    const counts: string = varString(email, "categoryCounts");

    expect(counts).toBe("200 Monitors · 100 Incidents");

    let total: number = 0;

    for (const part of counts.split(" · ")) {
      total = total + Number(part.split(" ")[0]!);
    }

    expect(total).toBe(300);
  });

  test("counts are ordered by size descending, then by label ascending", () => {
    const items: Array<UserNotificationEmailRollupItem> = [
      makeItem({
        createdAt: at(1),
        subject: "s",
        rollupCategory: RollupCategory.StatusPages,
      }),
      makeItem({
        createdAt: at(2),
        subject: "a",
        rollupCategory: RollupCategory.Alerts,
      }),
      makeItem({
        createdAt: at(3),
        subject: "m1",
        rollupCategory: RollupCategory.Monitors,
      }),
      makeItem({
        createdAt: at(4),
        subject: "m2",
        rollupCategory: RollupCategory.Monitors,
      }),
    ];

    expect(varString(build(items), "categoryCounts")).toBe(
      "2 Monitors · 1 Alerts · 1 Status Pages",
    );
  });

  test("a category code the build has never heard of counts as Other rather than crashing", () => {
    const item: UserNotificationEmailRollupItem = makeItem({
      createdAt: at(0),
      subject: "From a newer build",
    });

    item.rollupCategory = "quantum-widgets" as RollupCategory;

    expect(varString(build([item]), "categoryCounts")).toBe("1 Other");
  });
});

describe("buildRollupEmail row cap", () => {
  /*
   * 150 groups, of which the oldest 50 carry two items each. The hidden ROW
   * count and the hidden ITEM count are deliberately different numbers so a
   * copy bug that reports one where it means the other cannot pass.
   */
  type BuildOversizedFunction = () => Array<UserNotificationEmailRollupItem>;

  const buildOversized: BuildOversizedFunction =
    (): Array<UserNotificationEmailRollupItem> => {
      const items: Array<UserNotificationEmailRollupItem> = [];

      for (let group: number = 0; group < 150; group++) {
        const link: string = `https://oneuptime.example.com/dashboard/p1/r/${group}`;

        items.push(
          makeItem({
            createdAt: at(group * 60),
            subject: `Group ${group}`,
            viewLink: link,
          }),
        );

        if (group < 50) {
          items.push(
            makeItem({
              createdAt: at(group * 60 + 1),
              subject: `Group ${group} update`,
              viewLink: link,
            }),
          );
        }
      }

      return items;
    };

  test("renders at most MAX_ROWS_IN_ROLLUP rows and flags the rest", () => {
    const email: RollupEmail = build(buildOversized());

    expect(varRows(email)).toHaveLength(100);
    expect(varString(email, "hasMore")).toBe("true");
  });

  test("the tail names the true hidden row count and hidden item count", () => {
    const email: RollupEmail = build(buildOversized());
    const moreText: string = varString(email, "moreTextHtml");

    expect(moreText).toContain("50 more updates");
    expect(moreText).toContain("covering 100 notifications");
    expect(moreText).toContain("are not listed here");
  });

  test("nothing hidden means no tail at all", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "One thing" }),
      makeItem({ createdAt: at(1), subject: "Another thing" }),
    ]);

    expect(varString(email, "hasMore")).toBe("false");
    expect(varString(email, "moreTextHtml")).toBe("");
  });
});

describe("buildRollupEmail subject grammar", () => {
  test("more than one notification reads [project] N notifications", () => {
    const items: Array<UserNotificationEmailRollupItem> = [];

    for (let index: number = 0; index < 12; index++) {
      items.push(makeItem({ createdAt: at(index), subject: `Event ${index}` }));
    }

    expect(build(items).subject).toBe("[Acme] 12 notifications: 12 Incidents");
  });

  test("exactly one notification leads with its title", () => {
    expect(
      build([makeItem({ createdAt: at(0), subject: "Checkout is down" })])
        .subject,
    ).toBe("[Acme] 1 notification: Checkout is down");
  });

  test("the lead title is truncated to ROLLUP_SUBJECT_LEAD_TITLE_MAX", () => {
    const longTitle: string = "T".repeat(200);
    const subject: string = build([
      makeItem({ createdAt: at(0), subject: longTitle }),
    ]).subject;

    const lead: string = subject.replace("[Acme] 1 notification: ", "");

    expect(lead).toHaveLength(ROLLUP_SUBJECT_LEAD_TITLE_MAX);
    expect(lead).toBe(`${"T".repeat(79)}…`);
  });

  test("the project name is truncated to ROLLUP_PROJECT_NAME_MAX", () => {
    const subject: string = build(
      [
        makeItem({ createdAt: at(0), subject: "a" }),
        makeItem({ createdAt: at(1), subject: "b" }),
      ],
      "P".repeat(200),
    ).subject;

    expect(subject).toBe(`[${"P".repeat(59)}…] 2 notifications: 2 Incidents`);
    expect(subject.indexOf("]") - 1).toBe(ROLLUP_PROJECT_NAME_MAX);
  });

  test("handlebars braces are stripped, because MailService compiles the subject", () => {
    const subject: string = build(
      [
        makeItem({ createdAt: at(0), subject: "a" }),
        makeItem({ createdAt: at(1), subject: "b" }),
      ],
      "{{constructor}}",
    ).subject;

    expect(subject).toBe("[constructor] 2 notifications: 2 Incidents");
    expect(subject).not.toContain("{{");
  });

  test("braces are stripped from the lead title too", () => {
    expect(
      build([
        makeItem({ createdAt: at(0), subject: "{{projectName}} is down" }),
      ]).subject,
    ).toBe("[Acme] 1 notification: projectName is down");
  });

  test("an unnamed project falls back to prose rather than an empty bracket", () => {
    expect(
      build(
        [
          makeItem({ createdAt: at(0), subject: "a" }),
          makeItem({ createdAt: at(1), subject: "b" }),
        ],
        "",
      ).subject,
    ).toBe("[your project] 2 notifications: 2 Incidents");
  });
});

describe("buildRollupEmail escaping contract", () => {
  /*
   * The fixture carries EVERY character escapeHtml touches - & < > " and ' -
   * on purpose. A fixture built only from <script>alert(1)</script> exercises
   * two of the five, and, worse, a fixture with no escapable character at all
   * makes the whole contract untestable: raw and pre-escaped are then the
   * same bytes, so a test written against it passes whichever way round the
   * two are wired. Both halves of the contract are asserted here, because
   * both halves fail silently in production:
   *
   *   raw value in a triple stache  -> live markup in a mail client
   *   pre-escaped value in a double -> the recipient reads "&amp;lt;"
   *
   * `&` in a project name is the common case (Marks & Spencer), and `"` in a
   * title is the common case for a monitor named after a quoted hostname.
   */
  const hostileProject: string = "A&B <\"Corp\"> 'Ltd'";
  const hostileSubject: string =
    "Disk \"sda1\" > 90% & <b>hot</b> at 'eu-west'";

  /* What escapeHtml makes of hostileProject. Escaped once, never twice. */
  const projectEscapedOnce: string =
    "A&amp;B &lt;&quot;Corp&quot;&gt; &#39;Ltd&#39;";

  /*
   * An `&` that does not open one of the five entities escapeHtml produces.
   * A pre-escaped var containing one was escaped too few times - which is
   * exactly what dropping the `&` replace from escapeHtml would do, while
   * leaving every angle bracket looking correct.
   */
  const unescapedAmpersand: RegExp = /&(?!(?:amp|lt|gt|quot|#39);)/;

  type HostileEmailFunction = () => RollupEmail;

  const hostileEmail: HostileEmailFunction = (): RollupEmail => {
    return build(
      [
        makeItem({
          createdAt: at(0),
          subject: hostileSubject,
          viewLink: "https://oneuptime.example.com/dashboard/p1/incidents/i1",
        }),
        makeItem({ createdAt: at(1), subject: "Something ordinary" }),
      ],
      hostileProject,
    );
  };

  test("a var the template feeds to a DOUBLE stache arrives RAW, byte for byte", () => {
    const email: RollupEmail = hostileEmail();
    const rows: Array<JSONObject> = varRows(email);

    /* rollupTitle -> {{> EmailTitle title=... }} -> {{title}} */
    expect(varString(email, "rollupTitle")).toBe(
      `2 notifications from ${hostileProject}`,
    );

    /* rows[].title -> {{this.title}} in this template's own table. */
    expect(rowField(rows[1]!, "title")).toBe(hostileSubject);

    /*
     * Not one of the five has become an entity yet: Handlebars has not run,
     * and when it does it must be the FIRST and only pass over these bytes.
     */
    expect(varString(email, "rollupTitle")).not.toContain("&amp;");
    expect(varString(email, "rollupTitle")).not.toContain("&lt;");
    expect(rowField(rows[1]!, "title")).not.toContain("&quot;");
    expect(rowField(rows[1]!, "title")).not.toContain("&#39;");
  });

  test("a var the template feeds to a TRIPLE stache arrives PRE-ESCAPED, exactly once", () => {
    const email: RollupEmail = hostileEmail();

    /* rollupIntroHtml -> {{> InfoBlock info=... }} -> {{{info}}} */
    expect(varString(email, "rollupIntroHtml")).toContain(projectEscapedOnce);

    for (const name of HTML_VAR_NAMES) {
      const value: string = varString(email, name);

      /* Escaped at least once: nothing a triple stache would render live. */
      expect(value).not.toContain("<");
      expect(value).not.toContain(">");
      expect(value).not.toContain('"');
      expect(value).not.toContain("'");
      expect(value).not.toMatch(unescapedAmpersand);

      /* And at most once: escaped twice reads as literal "&amp;lt;". */
      expect(value).not.toContain("&amp;amp;");
      expect(value).not.toContain("&amp;lt;");
      expect(value).not.toContain("&amp;gt;");
      expect(value).not.toContain("&amp;quot;");
      expect(value).not.toContain("&amp;#39;");
    }
  });

  test("the raw links are passed through untouched for their href attributes", () => {
    const email: RollupEmail = hostileEmail();

    expect(varString(email, "projectHomeLink")).toBe(
      "https://oneuptime.example.com/dashboard/p1/home",
    );
    expect(varString(email, "preferencesLink")).toBe(
      "https://oneuptime.example.com/dashboard/p1/user-settings/notification-settings",
    );
  });
});

describe("buildRollupEmail zebra striping", () => {
  /*
   * The template used to decide the stripe itself, with {{#if @odd}}.
   * Handlebars defines @index, @first, @last, @key, @root and @level - and
   * NOT @odd - and an unknown @-variable resolves to undefined instead of
   * erroring, so that condition was false on every single row and the table
   * rendered flat white. Nothing failed, nothing logged, and no test noticed.
   *
   * The colour is a builder field now, and these are the assertions that
   * would have caught it: the sequence itself, pinned per index.
   */
  type StripedEmailFunction = (rowCount: number) => RollupEmail;

  const stripedEmail: StripedEmailFunction = (
    rowCount: number,
  ): RollupEmail => {
    const items: Array<UserNotificationEmailRollupItem> = [];

    for (let index: number = 0; index < rowCount; index++) {
      items.push(
        makeItem({
          createdAt: at(index * 60),
          subject: `Event ${index}`,
          viewLink: `https://oneuptime.example.com/dashboard/p1/r/${index}`,
        }),
      );
    }

    return build(items);
  };

  type BackgroundsFunction = (email: RollupEmail) => Array<string>;

  const backgrounds: BackgroundsFunction = (
    email: RollupEmail,
  ): Array<string> => {
    return varRows(email).map((row: JSONObject): string => {
      return rowField(row, "rowBackground");
    });
  };

  test("row backgrounds alternate, starting white on the first row", () => {
    expect(backgrounds(stripedEmail(5))).toEqual([
      "#ffffff",
      "#f7f9fc",
      "#ffffff",
      "#f7f9fc",
      "#ffffff",
    ]);
  });

  test("a one-row rollup is white, never the stripe colour", () => {
    expect(backgrounds(stripedEmail(1))).toEqual(["#ffffff"]);
  });

  test("every rendered row carries a colour and no two neighbours share one", () => {
    const colours: Array<string> = backgrounds(
      stripedEmail(MAX_ROWS_IN_ROLLUP + 20),
    );

    expect(colours).toHaveLength(MAX_ROWS_IN_ROLLUP);

    for (let index: number = 1; index < colours.length; index++) {
      expect(colours[index]!).not.toBe(colours[index - 1]!);
    }
  });
});

describe("buildRollupEmail singular and plural copy", () => {
  test("one item reads in the singular throughout", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "Checkout is down" }),
    ]);

    expect(varString(email, "rollupTitle")).toBe("1 notification from Acme");
    expect(varString(email, "summaryCount")).toBe("1 notification");
    expect(varString(email, "rollupIntroHtml")).toBe(
      "OneUptime grouped this notification from Acme into a single email. Nothing was suppressed.",
    );
    expect(varRows(email)).toHaveLength(1);

    /*
     * A single-update row says WHEN and nothing else. "1 update" would be
     * noise on every row of the common case - most rows in a real rollup are
     * one event about one resource.
     */
    expect(rowField(varRows(email)[0]!, "metaLabel")).toBe("12:00 UTC");
    expect(rowField(varRows(email)[0]!, "sectionCount")).toBe("1 update");
  });

  test("many items read in the plural throughout", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "a" }),
      makeItem({ createdAt: at(1), subject: "b" }),
    ]);

    expect(varString(email, "rollupTitle")).toBe("2 notifications from Acme");
    expect(varString(email, "summaryCount")).toBe("2 notifications");
    expect(varString(email, "rollupIntroHtml")).toBe(
      "OneUptime grouped these 2 notifications from Acme into a single email " +
        "instead of sending 2 separate messages. Nothing was suppressed.",
    );
  });

  test("exactly one hidden row and one hidden item read in the singular", () => {
    const items: Array<UserNotificationEmailRollupItem> = [];

    for (let index: number = 0; index < MAX_ROWS_IN_ROLLUP + 1; index++) {
      items.push(
        makeItem({
          createdAt: at(index * 60),
          subject: `Event ${index}`,
          viewLink: `https://oneuptime.example.com/dashboard/p1/r/${index}`,
        }),
      );
    }

    const moreText: string = varString(build(items), "moreTextHtml");

    expect(moreText).toContain("1 more update ");
    expect(moreText).toContain("covering 1 notification)");
    expect(moreText).toContain("is not listed here");
  });
});

describe("buildRollupEmail variable set", () => {
  test("every variable the template needs is present, and rows carry exactly eight fields", () => {
    const email: RollupEmail = build([
      makeItem({
        createdAt: at(0),
        subject: "Checkout is down",
        viewLink: "https://oneuptime.example.com/dashboard/p1/incidents/i1",
      }),
    ]);

    expect(Object.keys(email.vars).sort()).toEqual(
      [
        "categoryCounts",
        "hasMore",
        "moreTextHtml",
        "preferencesHtml",
        "preferencesLink",
        "projectHomeLink",
        "rollupIntroHtml",
        "rollupTitle",
        "rows",
        "summaryCount",
        "summaryWindow",
      ].sort(),
    );

    /*
     * Exactly these, no more: a row field the template reads and the builder
     * does not set renders as the empty string, and rowBackground lives
     * inside a style attribute, where empty means `background-color: ;` and a
     * mail client throws the whole declaration away.
     */
    expect(Object.keys(varRows(email)[0]!).sort()).toEqual(
      [
        "hasLink",
        "isSectionStart",
        "link",
        "metaLabel",
        "rowBackground",
        "sectionCount",
        "sectionLabel",
        "title",
      ].sort(),
    );
  });

  test("the preferences copy explains the batching AND names the way out of it", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "a" }),
    ]);

    const preferences: string = varString(email, "preferencesHtml");

    /* Why an email the recipient did not recognise arrived at all. */
    expect(preferences).toContain(
      "groups owner notifications into a single email",
    );

    /*
     * And the escape hatch, which is the half that regresses silently.
     * Rollup is on for everyone with no preference and no announcement, so
     * this paragraph is the only place a recipient learns the opt-out exists
     * - copy that merely says "choose which notifications you receive" sends
     * them to a page whose most useful switch it never mentioned, and they
     * conclude batching is mandatory.
     */
    expect(preferences).toContain("turn off email rollup for this project");
    expect(preferences).toContain("notification settings");

    /*
     * The template renders preferencesLink as a bare URL on the line below
     * this text, so the text has to hand off to it. End on a full stop and
     * the reader gets a naked link with nothing claiming it.
     */
    expect(preferences.endsWith(":")).toBe(true);
  });
});

/*
 * The rest of this file pins the SHAPE of the rollup email: which section a
 * row lands in, what order the sections come in, what each row says about
 * when it happened, and whether the numbers in the three places this email
 * counts things agree with each other.
 *
 * All of it is behaviour a reader notices immediately and no type checks:
 * every field below is a string in a Dictionary, and every one of them
 * renders as the empty string when it is wrong.
 */

type SectionSummary = {
  label: string;
  count: string;
  titles: Array<string>;
};

type SectionsOfFunction = (email: RollupEmail) => Array<SectionSummary>;

/*
 * Rebuild the sections from the flat rows the way the TEMPLATE does - by
 * starting a new one every time isSectionStart is "true" - rather than by
 * reading the builder's internals. A section boundary that the builder knows
 * about and the flag does not express is invisible in the email, so it has to
 * be invisible here too.
 */
const sectionsOf: SectionsOfFunction = (
  email: RollupEmail,
): Array<SectionSummary> => {
  const sections: Array<SectionSummary> = [];

  for (const row of varRows(email)) {
    const title: string = rowField(row, "title");

    if (rowField(row, "isSectionStart") === "true") {
      sections.push({
        label: rowField(row, "sectionLabel"),
        count: rowField(row, "sectionCount"),
        titles: [title],
      });
      continue;
    }

    const current: SectionSummary | undefined = sections[sections.length - 1];

    if (!current) {
      throw new Error("A row appeared before any section started");
    }

    current.titles.push(title);
  }

  return sections;
};

describe("buildRollupEmail sections", () => {
  type MixedItemsFunction = () => Array<UserNotificationEmailRollupItem>;

  /*
   * Deliberately seeded OUT of the order the sections must come out in, and
   * with the biggest category last: a builder that grouped by first
   * appearance, or that sorted sections by size the way the summary card
   * sorts its counts, passes neither of the next two tests.
   */
  const mixedItems: MixedItemsFunction =
    (): Array<UserNotificationEmailRollupItem> => {
      return [
        makeItem({
          createdAt: at(0),
          subject: "Probe eu-west is disconnected",
          viewLink: "https://oneuptime.example.com/dashboard/p1/probes/p1",
          rollupCategory: RollupCategory.Probes,
        }),
        makeItem({
          createdAt: at(60),
          subject: "api.acme.com is offline",
          viewLink: "https://oneuptime.example.com/dashboard/p1/monitors/m1",
          rollupCategory: RollupCategory.Monitors,
        }),
        makeItem({
          createdAt: at(120),
          subject: "Checkout is down",
          viewLink: "https://oneuptime.example.com/dashboard/p1/incidents/i1",
          rollupCategory: RollupCategory.Incidents,
        }),
        makeItem({
          createdAt: at(180),
          subject: "Checkout is down - acknowledged",
          viewLink: "https://oneuptime.example.com/dashboard/p1/incidents/i1",
          rollupCategory: RollupCategory.Incidents,
        }),
        makeItem({
          createdAt: at(240),
          subject: "Error rate above 5%",
          viewLink: "https://oneuptime.example.com/dashboard/p1/alerts/a1",
          rollupCategory: RollupCategory.Alerts,
        }),
      ];
    };

  test("rows are grouped into one section per category", () => {
    const sections: Array<SectionSummary> = sectionsOf(build(mixedItems()));

    expect(
      sections.map((section: SectionSummary): string => {
        return section.label;
      }),
    ).toEqual(["Incidents", "Alerts", "Monitors", "Probes"]);
  });

  test("sections follow ROLLUP_CATEGORY_ORDER, not size and not arrival order", () => {
    const sections: Array<SectionSummary> = sectionsOf(build(mixedItems()));

    const orderedLabels: Array<string> = ROLLUP_CATEGORY_ORDER.filter(
      (category: RollupCategory): boolean => {
        return [
          RollupCategory.Incidents,
          RollupCategory.Alerts,
          RollupCategory.Monitors,
          RollupCategory.Probes,
        ].includes(category);
      },
    ).map((category: RollupCategory): string => {
      return ROLLUP_CATEGORY_LABEL[category];
    });

    expect(
      sections.map((section: SectionSummary): string => {
        return section.label;
      }),
    ).toEqual(orderedLabels);
  });

  test("exactly one row per section is flagged as its start", () => {
    const email: RollupEmail = build(mixedItems());

    const starts: number = varRows(email).filter((row: JSONObject): boolean => {
      return rowField(row, "isSectionStart") === "true";
    }).length;

    expect(starts).toBe(4);
    expect(rowField(varRows(email)[0]!, "isSectionStart")).toBe("true");
  });

  test("every row carries its own section's label and count, not only the first", () => {
    const email: RollupEmail = build(mixedItems());

    for (const row of varRows(email)) {
      expect(rowField(row, "sectionLabel").length).toBeGreaterThan(0);
      expect(rowField(row, "sectionCount")).toMatch(/^\d+ updates?$/);
    }
  });

  test("rows inside a section stay newest first", () => {
    const link: string = "https://oneuptime.example.com/dashboard/p1/i";

    const email: RollupEmail = build([
      makeItem({
        createdAt: at(0),
        subject: "Oldest",
        viewLink: `${link}/1`,
      }),
      makeItem({
        createdAt: at(60),
        subject: "Middle",
        viewLink: `${link}/2`,
      }),
      makeItem({
        createdAt: at(120),
        subject: "Newest",
        viewLink: `${link}/3`,
      }),
    ]);

    expect(sectionsOf(email)[0]!.titles).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });

  test("the section count is UPDATES, so it equals the summary card's count for that category", () => {
    const sections: Array<SectionSummary> = sectionsOf(build(mixedItems()));

    /* Two notifications about ONE incident: one row, and a heading saying 2. */
    expect(sections[0]!.label).toBe("Incidents");
    expect(sections[0]!.titles).toHaveLength(1);
    expect(sections[0]!.count).toBe("2 updates");

    const counts: string = varString(build(mixedItems()), "categoryCounts");

    expect(counts).toContain("2 Incidents");
  });

  test("the section counts add up to the summary count, every category", () => {
    const email: RollupEmail = build(mixedItems());

    let total: number = 0;

    for (const section of sectionsOf(email)) {
      total = total + Number(section.count.split(" ")[0]!);
    }

    expect(varString(email, "summaryCount")).toBe(`${total} notifications`);
    expect(total).toBe(5);
  });

  test("one update reads in the singular in a section heading", () => {
    const sections: Array<SectionSummary> = sectionsOf(build(mixedItems()));

    expect(sections[1]!.label).toBe("Alerts");
    expect(sections[1]!.count).toBe("1 update");
  });

  test("a category the build has never heard of renders under Other rather than vanishing", () => {
    const item: UserNotificationEmailRollupItem = makeItem({
      createdAt: at(0),
      subject: "From a newer build",
    });

    item.rollupCategory = "quantum-widgets" as RollupCategory;

    const sections: Array<SectionSummary> = sectionsOf(build([item]));

    expect(sections).toHaveLength(1);
    expect(sections[0]!.label).toBe("Other");
    expect(sections[0]!.titles).toEqual(["From a newer build"]);
  });

  test("EVERY row survives grouping - a section is a heading, never a filter", () => {
    const items: Array<UserNotificationEmailRollupItem> = [];

    for (const category of ROLLUP_CATEGORY_ORDER) {
      items.push(
        makeItem({
          createdAt: at(items.length * 60),
          subject: `Something in ${category}`,
          viewLink: `https://oneuptime.example.com/dashboard/p1/r/${category}`,
          rollupCategory: category,
        }),
      );
    }

    const email: RollupEmail = build(items);

    expect(varRows(email)).toHaveLength(ROLLUP_CATEGORY_ORDER.length);
    expect(sectionsOf(email)).toHaveLength(ROLLUP_CATEGORY_ORDER.length);
    expect(
      sectionsOf(email).map((section: SectionSummary): string => {
        return section.label;
      }),
    ).toEqual(
      ROLLUP_CATEGORY_ORDER.map((category: RollupCategory): string => {
        return ROLLUP_CATEGORY_LABEL[category];
      }),
    );
  });

  test("the zebra stripe restarts at white in every section", () => {
    const items: Array<UserNotificationEmailRollupItem> = [];

    /* Two incidents, then two monitors: without a restart the third row is striped. */
    for (let index: number = 0; index < 2; index++) {
      items.push(
        makeItem({
          createdAt: at(index * 60),
          subject: `Incident ${index}`,
          viewLink: `https://oneuptime.example.com/dashboard/p1/incidents/${index}`,
          rollupCategory: RollupCategory.Incidents,
        }),
      );
      items.push(
        makeItem({
          createdAt: at(index * 60 + 1),
          subject: `Monitor ${index}`,
          viewLink: `https://oneuptime.example.com/dashboard/p1/monitors/${index}`,
          rollupCategory: RollupCategory.Monitors,
        }),
      );
    }

    const colours: Array<string> = varRows(build(items)).map(
      (row: JSONObject): string => {
        return rowField(row, "rowBackground");
      },
    );

    expect(colours).toEqual(["#ffffff", "#f7f9fc", "#ffffff", "#f7f9fc"]);
  });
});

describe("buildRollupEmail times", () => {
  test("a single-update row carries only its timestamp", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "Checkout is down" }),
    ]);

    expect(rowField(varRows(email)[0]!, "metaLabel")).toBe("12:00 UTC");
  });

  test("a folded row carries its update count and the time of the LATEST of them", () => {
    const link: string = "https://oneuptime.example.com/dashboard/p1/i1";

    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "Down", viewLink: link }),
      makeItem({ createdAt: at(9 * 60), subject: "Acked", viewLink: link }),
      makeItem({ createdAt: at(21 * 60), subject: "Resolved", viewLink: link }),
    ]);

    expect(rowField(varRows(email)[0]!, "metaLabel")).toBe(
      "3 updates · latest 12:21 UTC",
    );
  });

  test("times are UTC and zero padded, whatever the process timezone is", () => {
    const email: RollupEmail = build([
      makeItem({
        createdAt: new Date(Date.UTC(2026, 8, 3, 4, 5, 0)),
        subject: "Early",
      }),
    ]);

    expect(rowField(varRows(email)[0]!, "metaLabel")).toBe("04:05 UTC");
  });

  test("the summary window spans the earliest and latest notification", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "First" }),
      makeItem({ createdAt: at(26 * 60), subject: "Last" }),
    ]);

    expect(varString(email, "summaryWindow")).toBe("12:00 UTC to 12:26 UTC");
  });

  test("a window that starts and ends in the same minute is printed once, not as a range", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "a" }),
      makeItem({ createdAt: at(30), subject: "b" }),
    ]);

    expect(varString(email, "summaryWindow")).toBe("12:00 UTC");
  });

  test("a rollup that spans two UTC days prints the date on EVERY time", () => {
    const email: RollupEmail = build([
      makeItem({
        createdAt: new Date(Date.UTC(2026, 8, 3, 23, 50, 0)),
        subject: "Late on the third",
        viewLink: "https://oneuptime.example.com/dashboard/p1/r/1",
      }),
      makeItem({
        createdAt: new Date(Date.UTC(2026, 8, 4, 0, 10, 0)),
        subject: "Early on the fourth",
        viewLink: "https://oneuptime.example.com/dashboard/p1/r/2",
      }),
    ]);

    expect(varString(email, "summaryWindow")).toBe(
      "Sep 3, 23:50 UTC to Sep 4, 00:10 UTC",
    );

    /*
     * BOTH rows, not only the one on the later day: a table where some times
     * carry a date and others do not is read as though they are all on the
     * same day, which is the misreading the date exists to prevent.
     */
    expect(rowField(varRows(email)[0]!, "metaLabel")).toBe("Sep 4, 00:10 UTC");
    expect(rowField(varRows(email)[1]!, "metaLabel")).toBe("Sep 3, 23:50 UTC");
  });

  test("a rollup inside one UTC day prints no date at all", () => {
    const email: RollupEmail = build([
      makeItem({
        createdAt: new Date(Date.UTC(2026, 8, 3, 0, 1, 0)),
        subject: "Just after midnight",
        viewLink: "https://oneuptime.example.com/dashboard/p1/r/1",
      }),
      makeItem({
        createdAt: new Date(Date.UTC(2026, 8, 3, 23, 59, 0)),
        subject: "Just before the next one",
        viewLink: "https://oneuptime.example.com/dashboard/p1/r/2",
      }),
    ]);

    expect(varString(email, "summaryWindow")).toBe("00:01 UTC to 23:59 UTC");
    expect(rowField(varRows(email)[0]!, "metaLabel")).toBe("23:59 UTC");
  });

  test("the window covers items the row cap hid, because the card counts them too", () => {
    const items: Array<UserNotificationEmailRollupItem> = [];

    for (let index: number = 0; index < MAX_ROWS_IN_ROLLUP + 10; index++) {
      items.push(
        makeItem({
          createdAt: at(index * 60),
          subject: `Event ${index}`,
          viewLink: `https://oneuptime.example.com/dashboard/p1/r/${index}`,
        }),
      );
    }

    /* The oldest ten rows are not rendered; the window still starts at 12:00. */
    expect(varString(build(items), "summaryWindow")).toBe(
      "12:00 UTC to 13:49 UTC",
    );
  });

  test("an item with no createdAt at all leaves the window empty rather than printing 1970", () => {
    const item: UserNotificationEmailRollupItem = makeItem({
      createdAt: at(0),
      subject: "No timestamp",
    });

    delete (item as unknown as { createdAt?: Date }).createdAt;

    const email: RollupEmail = build([item]);

    expect(varString(email, "summaryWindow")).toBe("");
    expect(rowField(varRows(email)[0]!, "metaLabel")).not.toContain("1970");
  });
});

describe("buildRollupEmail subject category summary", () => {
  type SpreadFunction = (
    counts: Array<[RollupCategory, number]>,
  ) => Array<UserNotificationEmailRollupItem>;

  const spread: SpreadFunction = (
    counts: Array<[RollupCategory, number]>,
  ): Array<UserNotificationEmailRollupItem> => {
    const items: Array<UserNotificationEmailRollupItem> = [];

    for (const [category, count] of counts) {
      for (let index: number = 0; index < count; index++) {
        items.push(
          makeItem({
            createdAt: at(items.length * 60),
            subject: `${category} ${index}`,
            viewLink: `https://oneuptime.example.com/dashboard/p1/r/${category}/${index}`,
            rollupCategory: category,
          }),
        );
      }
    }

    return items;
  };

  test("the subject names what kind of storm this is, biggest category first", () => {
    const subject: string = build(
      spread([
        [RollupCategory.Monitors, 2],
        [RollupCategory.Incidents, 5],
      ]),
    ).subject;

    expect(subject).toBe("[Acme] 7 notifications: 5 Incidents, 2 Monitors");
  });

  test("at most ROLLUP_SUBJECT_MAX_CATEGORIES are named, and the rest are counted", () => {
    const subject: string = build(
      spread([
        [RollupCategory.Incidents, 5],
        [RollupCategory.Monitors, 4],
        [RollupCategory.Alerts, 3],
        [RollupCategory.Probes, 2],
        [RollupCategory.StatusPages, 1],
      ]),
    ).subject;

    expect(subject).toBe(
      "[Acme] 15 notifications: 5 Incidents, 4 Monitors, 3 Alerts +2 more",
    );
    expect(subject.split(", ")).toHaveLength(ROLLUP_SUBJECT_MAX_CATEGORIES);
  });

  test("exactly ROLLUP_SUBJECT_MAX_CATEGORIES categories claims nothing is left over", () => {
    const subject: string = build(
      spread([
        [RollupCategory.Incidents, 3],
        [RollupCategory.Monitors, 2],
        [RollupCategory.Alerts, 1],
      ]),
    ).subject;

    expect(subject).toBe(
      "[Acme] 6 notifications: 3 Incidents, 2 Monitors, 1 Alerts",
    );
    expect(subject).not.toContain("+");
  });

  test("the subject's counts are the summary card's counts", () => {
    const items: Array<UserNotificationEmailRollupItem> = spread([
      [RollupCategory.Incidents, 5],
      [RollupCategory.Monitors, 2],
    ]);

    const email: RollupEmail = build(items);

    expect(email.subject).toContain("5 Incidents, 2 Monitors");
    expect(varString(email, "categoryCounts")).toBe("5 Incidents · 2 Monitors");
  });

  test("a one-notification rollup still leads with the title, not with a category", () => {
    expect(
      build([makeItem({ createdAt: at(0), subject: "Checkout is down" })])
        .subject,
    ).toBe("[Acme] 1 notification: Checkout is down");
  });
});

describe("buildRollupEmail raw and pre-escaped vars stay on their own side", () => {
  test("every RAW var is free of the entities a double stache would escape twice", () => {
    const email: RollupEmail = build(
      [
        makeItem({ createdAt: at(0), subject: "a" }),
        makeItem({ createdAt: at(60), subject: "b" }),
      ],
      'A&B <"Corp">',
    );

    for (const name of RAW_VAR_NAMES) {
      const value: string = varString(email, name);

      expect(value).not.toContain("&amp;");
      expect(value).not.toContain("&lt;");
      expect(value).not.toContain("&quot;");
      expect(value).not.toContain("&#39;");
    }
  });

  test("the raw and pre-escaped lists together cover every string var the builder sets", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "a" }),
    ]);

    const stringVars: Array<string> = Object.keys(email.vars).filter(
      (name: string): boolean => {
        return typeof email.vars[name] === "string";
      },
    );

    const classified: Array<string> = [
      ...RAW_VAR_NAMES,
      ...HTML_VAR_NAMES,
      /* Links, which are neither: they go in an href and are never prose. */
      "projectHomeLink",
      "preferencesLink",
      /* A flag the template compares against a literal. */
      "hasMore",
    ];

    for (const name of stringVars) {
      expect(classified).toContain(name);
    }
  });
});
