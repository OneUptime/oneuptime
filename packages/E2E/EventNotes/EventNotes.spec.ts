import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Renders the real public and private note pages of incidents, alerts,
 * scheduled maintenance events and both kinds of episode against the offline
 * fixture (Fixture/Fixture.js). The layouts, side menus, pages and the notes
 * feed are production components; only the data boundary is synthetic.
 *
 * Every test runs with the browser clock pinned and a network fence that
 * aborts anything leaving the fixture server, and fails on uncaught page
 * errors or on any request the fixture does not model.
 */

const PORT: string = "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");

function uuid(prefix: string, suffix: number): string {
  return `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const INCIDENT: string = `${DASHBOARD}/incidents/${uuid("20000000", 1042)}`;
const ALERT: string = `${DASHBOARD}/alerts/${uuid("30000000", 311)}`;
const MAINTENANCE: string = `${DASHBOARD}/scheduled-maintenance-events/${uuid("40000000", 58)}`;
const INCIDENT_EPISODE: string = `${DASHBOARD}/incidents/episodes/${uuid("50000000", 12)}`;
const ALERT_EPISODE: string = `${DASHBOARD}/alerts/episodes/${uuid("60000000", 7)}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/event-notes-ui",
);

interface NotesPage {
  name: string;
  path: string;
  visibility: "public" | "private";
  pageTitle: string;
  firstNote: string;
  hasSwitch: boolean;
  hasAI: boolean;
  hasAttachments: boolean;
}

const PAGES: Array<NotesPage> = [
  {
    name: "incident-public-notes",
    path: `${INCIDENT}/public-notes`,
    visibility: "public",
    pageTitle: "Incident - Checkout API returning 502s for EU customers",
    firstNote: "A fix has been rolled out to every EU region",
    hasSwitch: true,
    hasAI: true,
    hasAttachments: true,
  },
  {
    name: "incident-private-notes",
    path: `${INCIDENT}/internal-notes`,
    visibility: "private",
    pageTitle: "Incident - Checkout API returning 502s for EU customers",
    firstNote: "Watching the 5xx panel before closing out.",
    hasSwitch: true,
    hasAI: true,
    hasAttachments: true,
  },
  {
    name: "alert-private-notes",
    path: `${ALERT}/internal-notes`,
    visibility: "private",
    pageTitle: "Alert - p99 latency above 2s on payments-worker",
    firstNote: "Scaling the consumer group from 6 to 12 pods.",
    hasSwitch: false,
    hasAI: true,
    hasAttachments: true,
  },
  {
    name: "scheduled-maintenance-public-notes",
    path: `${MAINTENANCE}/public-notes`,
    visibility: "public",
    pageTitle: "Scheduled Event - Primary database failover drill",
    firstNote: "The failover drill starts at 22:00 UTC.",
    hasSwitch: true,
    hasAI: true,
    hasAttachments: true,
  },
  {
    name: "scheduled-maintenance-private-notes",
    path: `${MAINTENANCE}/internal-notes`,
    visibility: "private",
    pageTitle: "Scheduled Event - Primary database failover drill",
    firstNote: "Runbook reviewed.",
    hasSwitch: true,
    hasAI: true,
    hasAttachments: true,
  },
  {
    name: "incident-episode-public-notes",
    path: `${INCIDENT_EPISODE}/public-notes`,
    visibility: "public",
    pageTitle: "Episode - EU edge network degradation",
    firstNote: "Several services in Europe are degraded.",
    hasSwitch: true,
    hasAI: false,
    hasAttachments: true,
  },
  {
    name: "incident-episode-private-notes",
    path: `${INCIDENT_EPISODE}/internal-notes`,
    visibility: "private",
    pageTitle: "Episode - EU edge network degradation",
    firstNote: "Grouped INC-1042, INC-1043 and INC-1045",
    hasSwitch: true,
    hasAI: false,
    hasAttachments: false,
  },
  {
    name: "alert-episode-private-notes",
    path: `${ALERT_EPISODE}/internal-notes`,
    visibility: "private",
    pageTitle: "Episode - Payments worker saturation",
    firstNote: "All 5 alerts in this episode",
    hasSwitch: false,
    hasAI: false,
    hasAttachments: false,
  },
];

interface RecordedWrite {
  modelName: string;
  id?: string;
  formType?: number;
  data?: Record<string, unknown>;
  miscDataProps?: Record<string, unknown>;
}

interface RecordedModelRequest {
  modelName: string;
  query?: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  skip?: number;
  limit?: number;
}

interface FixtureState {
  listRequests: Array<RecordedModelRequest>;
  getItemRequests: Array<RecordedModelRequest>;
  apiRequests: Array<{ method: string; url: string; body: unknown }>;
  creates: Array<RecordedWrite>;
  updates: Array<RecordedWrite>;
  deletes: Array<RecordedWrite>;
  unhandled: Array<unknown>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    await route.abort();
  });

  // Every fixture date is relative to the moment the page loads.
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __eventNotesFixture?: unknown })
          .__eventNotesFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });

  if (hasFixture) {
    expect(
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(
  page: Page,
  notesPage: NotesPage,
  query: string = "",
): Promise<void> {
  await page.goto(`${notesPage.path}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByTestId("event-notes")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("notes-loading")).toHaveCount(0, {
    timeout: 30000,
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __eventNotesFixture: FixtureState })
          .__eventNotesFixture,
      ),
    ) as FixtureState;
  });
}

function notesPage(name: string): NotesPage {
  return PAGES.find((candidate: NotesPage) => {
    return candidate.name === name;
  })!;
}

const INCIDENT_PUBLIC: NotesPage = notesPage("incident-public-notes");
const INCIDENT_PRIVATE: NotesPage = notesPage("incident-private-notes");
const ALERT_PRIVATE: NotesPage = notesPage("alert-private-notes");

function cards(page: Page): Locator {
  return page.getByTestId("note-card");
}

function card(page: Page, text: string): Locator {
  return cards(page).filter({ hasText: text });
}

async function openComposer(page: Page): Promise<Locator> {
  await page
    .getByTestId("note-composer-prompt")
    .getByRole("button")
    .first()
    .click();
  const composer: Locator = page.getByTestId("note-composer");
  await expect(composer).toBeVisible();
  await expect(
    composer.locator('[contenteditable="true"]').first(),
  ).toBeFocused();
  return composer;
}

async function openActions(noteCard: Locator): Promise<void> {
  await noteCard.getByRole("button", { name: "Note actions" }).click();
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
  });
}

/*
 * ---------------------------------------------------------------------------
 * Every note page
 * ---------------------------------------------------------------------------
 */

test.describe("every note page", () => {
  for (const notesPageCase of PAGES) {
    test(`${notesPageCase.name} shows its feed and composer`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, notesPageCase);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        notesPageCase.pageTitle,
      );

      const header: Locator = page.getByTestId("notes-header");
      await expect(
        header.getByRole("heading", {
          name:
            notesPageCase.visibility === "public"
              ? /Public notes/
              : /Private notes/,
        }),
      ).toBeVisible();

      await expect(cards(page).first()).toContainText(notesPageCase.firstNote);
      await expect(page.getByTestId("notes-visibility-switch")).toHaveCount(
        notesPageCase.hasSwitch ? 1 : 0,
      );
      await expect(page.getByTestId("note-ai-button")).toHaveCount(
        notesPageCase.hasAI ? 1 : 0,
      );

      const composer: Locator = await openComposer(page);
      await expect(composer.getByTestId("note-audience")).toContainText(
        notesPageCase.visibility === "public"
          ? "Visible on your status page"
          : "Only your team can see this",
      );
      await expect(composer.getByTestId("note-notify-checkbox")).toHaveCount(
        notesPageCase.visibility === "public" ? 1 : 0,
      );
      await expect(composer.getByTestId("note-attach-button")).toHaveCount(
        notesPageCase.hasAttachments ? 1 : 0,
      );

      // The feed asked for this event's notes only.
      const list: RecordedModelRequest | undefined = (
        await fixture(page)
      ).listRequests.find((request: RecordedModelRequest) => {
        return request.modelName.toLowerCase().includes("note");
      });
      expect(list).toBeDefined();
      expect(Object.keys(list!.query || {})).toHaveLength(2);
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * Writing notes
 * ---------------------------------------------------------------------------
 */

test.describe("writing a note", () => {
  test("types, posts with the keyboard, and sends exactly what was typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);
    const composer: Locator = await openComposer(page);

    await page.keyboard.type("We are rolling out a fix to the last region.");
    await expect(composer.getByTestId("note-submit")).toBeEnabled();
    await page.keyboard.press("ControlOrMeta+Enter");

    await expect(
      card(page, "We are rolling out a fix to the last region."),
    ).toHaveCount(1);

    const created: RecordedWrite = (await fixture(page)).creates[0]!;
    expect(created.modelName).toBe("IncidentPublicNote");
    expect(created.data!["note"]).toBe(
      "We are rolling out a fix to the last region.",
    );
    expect(
      created.data!["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"],
    ).toBe(true);
    expect(created.data!["incidentId"]).toMatchObject({
      value: uuid("20000000", 1042),
    });
    expect(created.data!["postedAt"]).toBeDefined();

    // Ready for the next note straight away.
    await expect(composer.locator('[contenteditable="true"]')).toHaveText("");
    await expect(composer.getByTestId("note-submit")).toBeDisabled();
    await expect(page.getByTestId("notes-count")).toHaveText("5");
  });

  test("a new public note's notification settles without a refresh", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);
    await openComposer(page);
    await page.keyboard.type("Watch this badge.");
    await page.getByTestId("note-submit").click();

    const badge: Locator = card(page, "Watch this badge.").getByTestId(
      "note-notification-status",
    );
    await expect(badge).toHaveText("Notifying subscribers");
    await expect(badge).toHaveText("Subscribers notified", {
      timeout: 30000,
    });
  });

  test("an incident declared quietly starts unticked, explains why, and posts false", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC, "quiet=1");
    const composer: Locator = await openComposer(page);

    await expect(
      composer.getByTestId("note-notify-checkbox"),
    ).not.toBeChecked();
    await expect(composer.getByTestId("note-notify-description")).toHaveText(
      "Unticked by default because status page subscribers were not notified when this incident was declared.",
    );

    await page.keyboard.type("Quiet update.");
    await composer.getByTestId("note-submit").click();
    await expect(card(page, "Quiet update.")).toHaveCount(1);

    expect(
      (await fixture(page)).creates[0]!.data![
        "shouldStatusPageSubscribersBeNotifiedOnNoteCreated"
      ],
    ).toBe(false);
    await expect(
      card(page, "Quiet update.").getByTestId("note-notification-status"),
    ).toHaveText("Subscribers not notified");
  });

  test("a template is inserted into the note, after what was typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);
    const composer: Locator = await openComposer(page);
    await page.keyboard.type("Update for EU customers.");

    await composer.getByTestId("note-template-menu-button").click();
    const menu: Locator = page.getByTestId("note-template-menu");
    await menu.getByRole("button", { name: /^Identified/ }).click();
    await expect(menu).toHaveCount(0);

    await expect(composer.locator('[contenteditable="true"]')).toContainText(
      "Update for EU customers.",
    );
    await expect(composer.locator('[contenteditable="true"]')).toContainText(
      "We have found the cause and are working on a fix.",
    );

    await composer.getByTestId("note-submit").click();
    await expect(card(page, "We have found the cause")).toHaveCount(1);
    expect((await fixture(page)).creates[0]!.data!["note"]).toBe(
      "Update for EU customers.\n\n**Identified.** We have found the cause and are working on a fix.",
    );
  });

  test("with no templates the menu says where to make one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC, "templates=none");

    await page.getByTestId("note-template-menu-button").click();
    const empty: Locator = page.getByTestId("note-templates-empty");
    await expect(empty).toContainText("No note templates yet");
    await expect(
      empty.getByRole("link", { name: /Create a template/ }),
    ).toHaveAttribute("href", `${DASHBOARD}/incidents/settings/note-templates`);
  });

  test("an AI draft lands in the composer and is only posted when asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);

    await page.getByTestId("note-ai-button").click();
    await page.getByRole("button", { name: "Generate with AI" }).click();

    const composer: Locator = page.getByTestId("note-composer");
    await expect(composer.locator('[contenteditable="true"]')).toContainText(
      "a fix is being deployed",
    );
    expect((await fixture(page)).creates).toHaveLength(0);

    const request: { url: string; body: unknown } | undefined = (
      await fixture(page)
    ).apiRequests.find((entry: { url: string }) => {
      return entry.url.includes("/incident/generate-note-from-ai/");
    });
    expect(request?.body).toMatchObject({ noteType: "public" });
  });

  test("backdating a public note sends the chosen time", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);
    const composer: Locator = await openComposer(page);
    await page.keyboard.type("Backdated.");

    await composer.getByTestId("note-posted-at-button").click();
    await composer.getByTestId("note-posted-at-input").fill("2026-09-14T17:05");
    await expect(composer.getByTestId("note-posted-at-button")).toContainText(
      "Sep 14",
    );
    await composer.getByTestId("note-submit").click();
    await expect(card(page, "Backdated.")).toHaveCount(1);

    expect((await fixture(page)).creates[0]!.data!["postedAt"]).toMatchObject({
      value: "2026-09-14T17:05:00.000Z",
    });
  });

  test("a refused post keeps the draft and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PRIVATE, "fail=create");
    const composer: Locator = await openComposer(page);
    await page.keyboard.type("Do not lose me.");
    await composer.getByTestId("note-submit").click();

    await expect(composer.getByTestId("note-composer-error")).toContainText(
      "Notes cannot be posted while the incident is being merged.",
    );
    await expect(composer.locator('[contenteditable="true"]')).toHaveText(
      "Do not lose me.",
    );
  });

  test("cancelling a draft asks before throwing it away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PRIVATE);
    const composer: Locator = await openComposer(page);
    await page.keyboard.type("Half a thought");

    await composer.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Keep writing" }).click();
    await expect(composer.locator('[contenteditable="true"]')).toHaveText(
      "Half a thought",
    );

    await composer.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByTestId("note-composer")).toHaveCount(0);
    await expect(page.getByTestId("note-composer-prompt")).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Editing, deleting and notifications
 * ---------------------------------------------------------------------------
 */

test.describe("managing notes", () => {
  test("edits a public note in place and asks for an update notification", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);
    const noteCard: Locator = card(page, "rotating it now");

    await openActions(noteCard);
    await page.getByRole("menuitem", { name: "Edit note" }).click();

    const composer: Locator = noteCard.getByTestId("note-edit-composer");
    await expect(composer).toBeVisible();
    await expect(composer.getByTestId("note-attachment-summary")).toContainText(
      "lb-eu-west-1-errors.png",
    );
    await composer.locator('[contenteditable="true"]').first().click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Rotation complete.");
    await composer.getByTestId("note-notify-checkbox").check();
    await composer.getByTestId("note-submit").click();

    await expect(noteCard.getByTestId("note-edit-composer")).toHaveCount(0);
    await expect(noteCard.getByTestId("note-body")).toContainText(
      "Rotation complete.",
    );
    await expect(
      noteCard.getByTestId("note-update-notification-status"),
    ).toBeVisible();

    const update: RecordedWrite = (await fixture(page)).updates.find(
      (entry: RecordedWrite) => {
        return entry.modelName === "IncidentPublicNote";
      },
    )!;
    expect(update.data!["_id"]).toBe(uuid("70000000", 2));
    expect(String(update.data!["note"])).toContain("Rotation complete.");
    expect(update.miscDataProps).toEqual({ notifySubscribersOfUpdate: true });
  });

  test("deletes a note after confirming", async ({ page }: { page: Page }) => {
    await open(page, INCIDENT_PRIVATE);
    const noteCard: Locator = card(page, "Paged the edge on-call.");

    await openActions(noteCard);
    await page.getByRole("menuitem", { name: "Delete note" }).click();
    await expect(page.getByText("Delete this private note?")).toBeVisible();
    await page.getByRole("button", { name: "Delete note" }).click();

    await expect(card(page, "Paged the edge on-call.")).toHaveCount(0);
    expect((await fixture(page)).deletes).toEqual([
      {
        modelName: "IncidentInternalNote",
        id: uuid("70000000", 7),
      },
    ]);
  });

  test("a failed notification explains itself and can be retried", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);
    const badge: Locator = card(page, "rotating it now").getByTestId(
      "note-notification-status",
    );
    await expect(badge).toHaveText("Notification failed");

    await badge.click();
    await expect(
      page.getByText("1,284 subscribers were not notified."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry notification" }).click();

    await expect(badge).not.toHaveText("Notification failed");
    const retry: RecordedWrite = (await fixture(page)).updates[0]!;
    expect(retry.id).toBe(uuid("70000000", 2));
    expect(retry.data).toEqual({
      subscriberNotificationStatusOnNoteCreated: "Pending",
      subscriberNotificationStatusMessage: null,
    });
  });

  test("a refused retry keeps the dialog open with the reason", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC, "fail=resend");
    await card(page, "rotating it now")
      .getByTestId("note-notification-status")
      .click();
    await page.getByRole("button", { name: "Retry notification" }).click();

    await expect(
      page.getByText(
        "Notifications cannot be resent while the SMTP relay is down.",
      ),
    ).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Reading the feed
 * ---------------------------------------------------------------------------
 */

test.describe("reading the feed", () => {
  test("groups notes by day and marks where they came from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);

    const days: Locator = page.getByTestId("notes-day");
    await expect(days).toHaveCount(2);
    await expect(days.nth(0)).toContainText("Today");
    await expect(days.nth(1)).toContainText("Yesterday");
    await expect(card(page, "Our engineers have been paged")).toContainText(
      "via Slack",
    );
    await expect(
      card(page, "We are investigating reports").getByTestId("note-author"),
    ).toHaveText("OneUptime");
    await expect(
      card(page, "rotating it now").getByTestId("note-attachment"),
    ).toHaveCount(2);
  });

  test("searches and sorts", async ({ page }: { page: Page }) => {
    await open(page, INCIDENT_PRIVATE);

    await page.getByTestId("notes-search").fill("renewal");
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId("notes-summary")).toHaveText("1 match");

    await page.getByTestId("notes-search").fill("");
    await expect(cards(page)).toHaveCount(3);

    await page.getByTestId("notes-sort").click();
    await expect(page.getByTestId("notes-sort")).toHaveText("Oldest first");
    await expect(cards(page).first()).toContainText("Paged the edge on-call.");
  });

  test("pages through a long feed", async ({ page }: { page: Page }) => {
    await open(page, INCIDENT_PUBLIC, "notes=many");

    await expect(cards(page)).toHaveCount(25);
    await page.getByTestId("notes-load-more").click();
    await expect(cards(page)).toHaveCount(34);
    await expect(page.getByTestId("notes-load-more")).toHaveCount(0);
  });

  test("an empty feed invites the first note", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC, "notes=empty");

    const empty: Locator = page.getByTestId("notes-empty");
    await expect(empty).toContainText("No public updates yet");
    await empty.getByRole("button", { name: "Post the first update" }).click();
    await expect(page.getByTestId("note-composer")).toBeVisible();
  });

  test("a failed load can be retried", async ({ page }: { page: Page }) => {
    await open(page, ALERT_PRIVATE, "fail=list");

    await expect(page.getByTestId("notes-error")).toContainText(
      "The notes service is unavailable.",
    );
  });

  test("the switch moves between private and public notes of the same event", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);

    await page
      .getByTestId("notes-visibility-switch")
      .getByRole("link", { name: "Private" })
      .click();

    await expect(page).toHaveURL(new RegExp(`${INCIDENT_PRIVATE.path}$`));
    await expect(
      page.getByTestId("notes-header").getByRole("heading", {
        name: /Private notes/,
      }),
    ).toBeVisible();
    await expect(cards(page).first()).toContainText(INCIDENT_PRIVATE.firstNote);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Permissions and small screens
 * ---------------------------------------------------------------------------
 */

test.describe("permissions", () => {
  test("a viewer reads notes but is told why they cannot write", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC, "role=viewer");

    await expect(page.getByTestId("note-composer-locked")).toContainText(
      "You do not have permission to create",
    );
    await expect(page.getByTestId("note-composer-prompt")).toHaveCount(0);

    await openActions(cards(page).first());
    await expect(
      page.getByRole("menuitem", { name: "Edit note" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("menuitem", { name: "Delete note" }),
    ).toBeDisabled();
  });

  test("a project member writes notes through the real permission checks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC, "role=member");
    const composer: Locator = await openComposer(page);

    await expect(composer.getByTestId("note-notify-checkbox")).toBeVisible();
    await expect(composer.getByTestId("note-posted-at-button")).toBeVisible();
  });
});

test.describe("small screens", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("nothing spills sideways on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);

    const overflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow).toBeLessThanOrEqual(0);

    // Every note keeps its menu inside its card.
    for (const noteCard of await cards(page).all()) {
      const cardBox: { x: number; width: number } | null = await noteCard
        .locator("article")
        .boundingBox();
      const menuBox: { x: number; width: number } | null = await noteCard
        .getByRole("button", { name: "Note actions" })
        .boundingBox();
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(
        cardBox!.x + cardBox!.width,
      );
    }

    await screenshot(page, "incident-public-notes-mobile");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Screenshots (pinned clock, synthetic data)
 * ---------------------------------------------------------------------------
 */

test.describe("screenshots", () => {
  for (const notesPageCase of PAGES) {
    test(`${notesPageCase.name} full page`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, notesPageCase);
      await screenshot(page, notesPageCase.name);
    });
  }

  test("composer with a template menu open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PUBLIC);
    const composer: Locator = await openComposer(page);
    await page.keyboard.type("We are rolling out a fix.");
    await composer.getByTestId("note-template-menu-button").click();
    await expect(page.getByTestId("note-template-menu")).toBeVisible();
    await screenshot(page, "incident-public-notes-composer");
  });
});
