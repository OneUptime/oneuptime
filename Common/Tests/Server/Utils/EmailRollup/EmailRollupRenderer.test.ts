import {
  MAX_ROWS_IN_ROLLUP,
  ROLLUP_PROJECT_NAME_MAX,
  ROLLUP_SUBJECT_LEAD_TITLE_MAX,
} from "../../../../Server/Utils/EmailRollup/EmailRollupConstants";
import {
  RollupEmail,
  RollupRow,
  buildRollupEmail,
  foldItems,
} from "../../../../Server/Utils/EmailRollup/EmailRollupRenderer";
import UserNotificationEmailRollupItem from "../../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import RollupCategory from "../../../../Types/NotificationSetting/NotificationEmailRollupCategory";
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

const HTML_VAR_NAMES: Array<string> = [
  "rollupIntroHtml",
  "categoryCountsHtml",
  "moreTextHtml",
  "preferencesHtml",
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
    expect(rows[0]!.updatesLabel).toBe("4 updates");
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
    expect(rows[0]!.updatesLabel).toBe("2 updates");
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
    expect(rows[0]!.updatesLabel).toBe("");
    expect(rows[1]!.title).toBe("Old alert again");
    expect(rows[1]!.updatesLabel).toBe("2 updates");
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

    const labels: Array<string> = rows.map((row: RollupRow): string => {
      return row.updatesLabel;
    });

    expect(rows).toHaveLength(3);
    expect(labels).toEqual(["", "", "2 updates"]);
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

    const counts: string = varString(email, "categoryCountsHtml");

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

    expect(varString(build(items), "categoryCountsHtml")).toBe(
      "2 Monitors · 1 Alerts · 1 Status Pages",
    );
  });

  test("a category code the build has never heard of counts as Other rather than crashing", () => {
    const item: UserNotificationEmailRollupItem = makeItem({
      createdAt: at(0),
      subject: "From a newer build",
    });

    item.rollupCategory = "quantum-widgets" as RollupCategory;

    expect(varString(build([item]), "categoryCountsHtml")).toBe("1 Other");
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

    expect(build(items).subject).toBe("[Acme] 12 notifications");
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

    expect(subject).toBe(`[${"P".repeat(59)}…] 2 notifications`);
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

    expect(subject).toBe("[constructor] 2 notifications");
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
    ).toBe("[your project] 2 notifications");
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
      "#f0f3f9",
      "#ffffff",
      "#f0f3f9",
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
    expect(varString(email, "rollupIntroHtml")).toContain(
      "1 notification from Acme arrived",
    );
    expect(varString(email, "rollupIntroHtml")).toContain(
      "It has been grouped",
    );
    expect(varRows(email)).toHaveLength(1);
    expect(rowField(varRows(email)[0]!, "updatesLabel")).toBe("");
  });

  test("many items read in the plural throughout", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "a" }),
      makeItem({ createdAt: at(1), subject: "b" }),
    ]);

    expect(varString(email, "rollupTitle")).toBe("2 notifications from Acme");
    expect(varString(email, "rollupIntroHtml")).toContain(
      "They have been grouped",
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
  test("every variable the template needs is present, and rows carry exactly five fields", () => {
    const email: RollupEmail = build([
      makeItem({
        createdAt: at(0),
        subject: "Checkout is down",
        viewLink: "https://oneuptime.example.com/dashboard/p1/incidents/i1",
      }),
    ]);

    expect(Object.keys(email.vars).sort()).toEqual(
      [
        "categoryCountsHtml",
        "hasMore",
        "moreTextHtml",
        "preferencesHtml",
        "preferencesLink",
        "projectHomeLink",
        "rollupIntroHtml",
        "rollupTitle",
        "rows",
      ].sort(),
    );

    /*
     * Exactly these, no more: a row field the template reads and the builder
     * does not set renders as the empty string, and rowBackground lives
     * inside a style attribute, where empty means `background-color: ;` and a
     * mail client throws the whole declaration away.
     */
    expect(Object.keys(varRows(email)[0]!).sort()).toEqual(
      ["hasLink", "link", "rowBackground", "title", "updatesLabel"].sort(),
    );
  });

  test("the preferences copy explains why one email arrived instead of several", () => {
    const email: RollupEmail = build([
      makeItem({ createdAt: at(0), subject: "a" }),
    ]);

    expect(varString(email, "preferencesHtml")).toContain(
      "groups owner notifications into a single email",
    );
  });
});
