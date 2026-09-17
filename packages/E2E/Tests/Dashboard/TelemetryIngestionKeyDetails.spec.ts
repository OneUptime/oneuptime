import { BASE_URL } from "../../Config";
import { JSONish, createItem, requestJson } from "./Helpers/MonitorAlerting";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The ingestion key DETAIL page: what it says about a key, and whether the
 * allowlist it shows can actually be corrected from there.
 *
 * The creation wizard has its own spec. Nothing covered the page a customer
 * lands on afterwards, and the two do not share their handling of Allowed
 * Origins - the wizard converts the JSON editor's text into a list in
 * onBeforeCreate, a hook that only runs on create. So the edit form used to
 * send the string '["https://app.example.com"]' to a column that holds a
 * list, and the server refused it: the allowlist could not be changed from
 * the page that displays it, which is what you reach for the morning a
 * domain moves.
 *
 * Keys are seeded through the same REST API the dashboard uses (so the real
 * create hooks and billing admission run) and read back the same way, so an
 * assertion is about what was PERSISTED rather than about what the page
 * happens to be rendering.
 *
 * cd E2E && HOST=dev.oneuptime.com HTTP_PROTOCOL=https \
 *   npx playwright test Tests/Dashboard/TelemetryIngestionKeyDetails.spec.ts \
 *   --project=chromium --retries=0
 */

interface StoredKey {
  _id: string;
  name: string;
  keyType: string;
  allowedOrigins?: Array<string> | undefined;
  pinnedServiceName?: string | undefined;
}

interface SharedContext {
  page: Page;
  projectId: string;
  browserKeyId: string;
  serverKeyWithOriginsId: string;
  serverKeyId: string;
}

test.describe("Telemetry ingestion key details", () => {
  test.describe.configure({ mode: "serial" });

  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    browserKeyId: "",
    serverKeyWithOriginsId: "",
    serverKeyId: "",
  };

  const detailUrl: (keyId: string) => string = (keyId: string): string => {
    return URL.fromString(BASE_URL.toString())
      .addRoute(
        `/dashboard/${ctx.projectId}/settings/telemetry-ingestion-keys/${keyId}`,
      )
      .toString();
  };

  const modal: () => Locator = (): Locator => {
    return ctx.page.getByTestId("modal");
  };

  /*
   * The rendered editor, not Monaco's focusable control. That control is a
   * hidden textarea Monaco parks at the caret and collapses to zero size
   * whenever the editor is not focused, so Firefox reports it as hidden and
   * every actionability check on it times out.
   */
  const originsEditor: () => Locator = (): Locator => {
    return modal().locator(".monaco-editor").first();
  };

  const originsLines: () => Locator = (): Locator => {
    return modal().locator(".monaco-editor .view-lines");
  };

  const seedKey: (item: JSONish) => Promise<string> = async (
    item: JSONish,
  ): Promise<string> => {
    const created: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/telemetry-ingestion-key",
      item: { ...item, projectId: ctx.projectId },
    });

    const id: unknown = created["_id"];
    const keyId: string =
      typeof id === "string" ? id : String((id as JSONish)?.["value"] || "");

    expect(
      keyId,
      `seeded key "${String(item["name"])}" should have an id`,
    ).not.toBe("");

    return keyId;
  };

  const readKey: (keyId: string) => Promise<StoredKey> = async (
    keyId: string,
  ): Promise<StoredKey> => {
    const body: JSONish = await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/telemetry-ingestion-key/get-list",
      body: {
        query: { projectId: ctx.projectId, _id: keyId },
        select: {
          _id: true,
          name: true,
          keyType: true,
          allowedOrigins: true,
          pinnedServiceName: true,
        },
        limit: 2,
        skip: 0,
        sort: {},
      },
    });

    const rows: Array<StoredKey> = (body["data"] || []) as Array<StoredKey>;
    expect(rows).toHaveLength(1);

    return rows[0]!;
  };

  /*
   * Replaces the whole document in the Monaco editor.
   *
   * insertText does NOT escape Monaco's auto-closing brackets - it replays
   * the string a character at a time through the same interceptors as
   * typing - so anything Monaco closed for us is deleted afterwards. It
   * always sits after the caret, on the caret's line; with nothing there the
   * selection is empty and Delete at the end of the document does nothing.
   */
  const fillOrigins: (value: string) => Promise<void> = async (
    value: string,
  ): Promise<void> => {
    await expect(originsEditor()).toBeVisible({ timeout: 30000 });
    await originsLines().click();
    await ctx.page.keyboard.press("ControlOrMeta+A");
    await ctx.page.keyboard.press("Backspace");
    await expect(originsLines()).toHaveText("");
    await ctx.page.keyboard.insertText(value);
    await ctx.page.keyboard.press("Shift+End");
    await ctx.page.keyboard.press("Delete");
    // Blur so Monaco flushes its onChange into the form.
    await modal().getByPlaceholder("storefront-web", { exact: true }).focus();
  };

  const openEditForm: () => Promise<void> = async (): Promise<void> => {
    await ctx.page
      .getByRole("button", {
        name: "Edit Telemetry Ingestion Key",
        exact: true,
      })
      .click();
    await expect(modal()).toBeVisible();
    await expect(originsEditor()).toBeVisible({ timeout: 30000 });
  };

  const saveButton: () => Locator = (): Locator => {
    return modal().getByTestId("modal-footer-submit-button");
  };

  const openKey: (keyId: string) => Promise<void> = async (
    keyId: string,
  ): Promise<void> => {
    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url: detailUrl(keyId),
      ready: ctx.page.getByRole("button", {
        name: "Edit Telemetry Ingestion Key",
        exact: true,
      }),
    });
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Ingestion Key Details",
      preferredPlanName: "Free",
    });

    ctx.browserKeyId = await seedKey({
      name: "Details browser key",
      description: "Public telemetry for the storefront.",
      keyType: "Browser",
      allowedOrigins: ["https://app.example.com", "https://*.example.org"],
      pinnedServiceName: "storefront-web",
    });

    /*
     * A server key carrying an allowlist: valid, and the case the service's
     * own comment calls "a list typed in for later". Clearing it is the
     * legitimate way to drop those leftovers.
     */
    ctx.serverKeyWithOriginsId = await seedKey({
      name: "Details server key with origins",
      keyType: "Server",
      allowedOrigins: ["https://retired.example.com"],
    });

    ctx.serverKeyId = await seedKey({
      name: "Details server key",
      keyType: "Server",
    });
  });

  test.afterAll(async () => {
    try {
      if (ctx.projectId) {
        const response: APIResponse = await ctx.page.request.delete(
          URL.fromString(BASE_URL.toString())
            .addRoute(`/api/project/${ctx.projectId}`)
            .toString(),
          { headers: { tenantid: ctx.projectId } },
        );
        expect(
          response.ok(),
          "The temporary ingestion key details project is deleted",
        ).toBe(true);
      }
    } finally {
      await ctx.page?.close();
    }
  });

  test("shows a browser key's type and every origin it accepts", async () => {
    await openKey(ctx.browserKeyId);

    /*
     * The pill's own sentence rather than the word "Browser", which also
     * appears in the key type's explanation beside it.
     */
    await expect(
      ctx.page.getByText(/Safe to publish in a page/i),
    ).toBeVisible();
    await expect(
      ctx.page.getByText("https://app.example.com", { exact: true }),
    ).toBeVisible();
    await expect(
      ctx.page.getByText("https://*.example.org", { exact: true }),
    ).toBeVisible();
    await expect(
      ctx.page.getByText("storefront-web", { exact: true }),
    ).toBeVisible();
  });

  /*
   * A server key is never origin checked, so a blank cell there would be
   * correct but unreadable - and the same blank cell on a browser key would
   * read as "no restriction", which is the exact opposite of what is
   * happening to that customer's telemetry.
   */
  test("says an allowlist is unused on a server key rather than leaving it blank", async () => {
    await openKey(ctx.serverKeyId);

    await expect(
      ctx.page.getByText(/keep it on your servers and collectors/i),
    ).toBeVisible();
    await expect(
      ctx.page.getByText(/a server key is never origin checked/i),
    ).toBeVisible();
  });

  test("does not offer the key type for editing", async () => {
    await openKey(ctx.browserKeyId);
    await openEditForm();

    await expect(modal().getByTestId("card-select-option-Browser")).toHaveCount(
      0,
    );
    await expect(modal().getByText("Key Type", { exact: true })).toHaveCount(0);

    await modal().getByTestId("modal-footer-close-button").click();
    await expect(modal()).toBeHidden();
  });

  /*
   * The page's own rules, applied before anything is sent. A path is the
   * one that matters most: the matcher compares origins, so
   * "https://app.example.com/admin" would match every request from that
   * host - looser than what was written, and read as tighter.
   */
  test("refuses an origin carrying a path without sending it", async () => {
    await openKey(ctx.browserKeyId);
    await openEditForm();

    await fillOrigins('["https://app.example.com/admin"]');
    await saveButton().click();

    await expect(modal().getByText(/must not contain a path/)).toBeVisible();
    await expect(modal()).toBeVisible();

    await modal().getByTestId("modal-footer-close-button").click();
    await expect(modal()).toBeHidden();

    const stored: StoredKey = await readKey(ctx.browserKeyId);
    expect(stored.allowedOrigins).toEqual([
      "https://app.example.com",
      "https://*.example.org",
    ]);
  });

  test("refuses origins that are not valid JSON without sending them", async () => {
    await openKey(ctx.browserKeyId);
    await openEditForm();

    await fillOrigins('["https://app.example.com"');
    await saveButton().click();

    await expect(
      modal().getByText(/Allowed Origins is not valid JSON\./),
    ).toBeVisible();

    await modal().getByTestId("modal-footer-close-button").click();
    await expect(modal()).toBeHidden();
  });

  /*
   * The whole point of the page. An edited allowlist has to reach the API as
   * a list of origins; as JSON TEXT the server refuses it outright, and the
   * allowlist can never be corrected after a domain changes.
   */
  test("saves an edited allowlist as a list of origins", async () => {
    await openKey(ctx.browserKeyId);
    await openEditForm();

    await fillOrigins(
      '["https://checkout.example.com", "https://*.example.net"]',
    );
    await saveButton().click();
    await expect(modal()).toBeHidden({ timeout: 30000 });

    const stored: StoredKey = await readKey(ctx.browserKeyId);
    expect(stored.allowedOrigins).toEqual([
      "https://checkout.example.com",
      "https://*.example.net",
    ]);

    await expect(
      ctx.page.getByText("https://checkout.example.com", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      ctx.page.getByText("https://app.example.com", { exact: true }),
    ).toHaveCount(0);
  });

  /*
   * Clearing a SERVER key's leftover allowlist is the one case where an
   * empty list is allowed, so the form must not stand in the way - and the
   * page has to say what empty now means, because a blank cell would read
   * as "no restriction" on the key type where empty means the opposite.
   */
  test("clears a server key's leftover allowlist", async () => {
    await openKey(ctx.serverKeyWithOriginsId);
    await openEditForm();

    await fillOrigins("[]");
    await saveButton().click();
    await expect(modal()).toBeHidden({ timeout: 30000 });

    const stored: StoredKey = await readKey(ctx.serverKeyWithOriginsId);
    expect(stored.allowedOrigins).toEqual([]);

    await expect(
      ctx.page.getByText(/a server key is never origin checked/i),
    ).toBeVisible({ timeout: 30000 });
  });

  /*
   * The other direction, and the one that matters: an empty allowlist on a
   * BROWSER key is a key that accepts nothing, so the server refuses to
   * write it. The form cannot tell - it never loads keyType, deliberately,
   * because a field that vanishes for the key type that requires it is the
   * worst failure mode - so this refusal is the server's, and the test is
   * here to prove the customer is told what to do instead rather than left
   * with a saved key that silently stopped working.
   */
  test("refuses to clear a browser key's allowlist, and says what to do instead", async () => {
    await openKey(ctx.browserKeyId);
    await openEditForm();

    await fillOrigins("[]");
    await saveButton().click();

    await expect(
      modal().getByText(/must keep at least one allowed origin/i),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      modal().getByText(/turn the key off or delete it instead/i),
    ).toBeVisible();

    await modal().getByTestId("modal-footer-close-button").click();
    await expect(modal()).toBeHidden();

    const stored: StoredKey = await readKey(ctx.browserKeyId);
    expect(stored.allowedOrigins).toEqual([
      "https://checkout.example.com",
      "https://*.example.net",
    ]);
  });
});
