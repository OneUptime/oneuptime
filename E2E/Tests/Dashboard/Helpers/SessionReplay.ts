import crypto from "crypto";
import { BASE_URL } from "../../../Config";
import { APIResponse, Locator, Page, expect } from "@playwright/test";
import URL from "Common/Types/API/URL";
import { gotoProjectPage } from "./ProductOnboarding";

/*
 * Helpers for the session replay end-to-end spec.
 *
 * The recorder itself is a browser bundle served to third-party origins, and
 * driving it for real would mean standing up a second web server just to host
 * a page with a script tag on it. Everything AFTER the recorder is what these
 * helpers exercise: the exact wire frame the recorder produces, posted to the
 * real ingest endpoint with a real ingestion key, and then read back through
 * the real dashboard.
 *
 * The frame format is deliberately built here by hand rather than imported
 * from the recorder. The wire contract has two independent implementations —
 * Transport.ts writes it, SessionReplayEnvelopeParser.ts reads it — and a
 * helper that shared code with either side would stop being a test of the
 * contract between them.
 */

/* Mirrors SESSION_REPLAY_WIRE_VERSION / SESSION_REPLAY_SCHEMA_VERSION. */
const WIRE_VERSION: number = 1;
const SCHEMA_VERSION: number = 1;

const CHUNK_CONTENT_TYPE: string =
  "application/vnd.oneuptime.session-replay.v1";

export interface SessionReplayChunkOptions {
  page: Page;
  ingestionKey: string;
  appIdentifier: string;
  sessionId: string;
  tabId: string;
  chunkIndex: number;
  sessionStartUnixMs: number;

  /* Where the page was when this chunk was flushed. */
  url: string;

  /* Every distinct page the chunk covered, in order. */
  routes?: Array<string>;

  isFinal?: boolean;
  hasFullSnapshot?: boolean;
  errorCount?: number;
  rageClickCount?: number;
  routeCount?: number;

  /* Only sent on chunk 0 and the final chunk, exactly as the recorder does. */
  identifiedUserRef?: string;
}

/*
 * 32 lowercase hex, matching what SessionId.generateId() mints in the
 * browser - 16 bytes from a CSPRNG, not Math.random(). The recorder uses
 * crypto.getRandomValues for the same reason a session id is not guessable,
 * and a fixture that generated ids a different way would be testing a
 * different shape of value.
 */
type HexIdFunction = () => string;

export const hexId: HexIdFunction = (): string => {
  return crypto.randomBytes(16).toString("hex");
};

type PostSessionReplayChunkFunction = (
  data: SessionReplayChunkOptions,
) => Promise<void>;

/*
 * One frame: `<envelope JSON>\n<payload>`, where payloadBytes is the byte
 * length of the payload. The payload is a small but REAL rrweb event array —
 * a Meta event plus an incremental one — so the player has something valid to
 * parse if this session is opened by hand.
 */
export const postSessionReplayChunk: PostSessionReplayChunkFunction = async (
  data: SessionReplayChunkOptions,
): Promise<void> => {
  const chunkUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute("/telemetry/session-replay/v1/chunk")
    .toString();

  const nowUnixMs: number = Date.now();

  const events: Array<unknown> = [
    {
      type: 4,
      data: { href: data.url, width: 1440, height: 900 },
      timestamp: nowUnixMs,
    },
    {
      type: 3,
      data: { source: 2, type: 2, id: 7 },
      timestamp: nowUnixMs + 10,
    },
  ];

  const payload: string = JSON.stringify(events);
  const payloadBytes: number = Buffer.byteLength(payload, "utf8");

  const envelope: Record<string, unknown> = {
    v: WIRE_VERSION,
    appIdentifier: data.appIdentifier,
    sessionId: data.sessionId,
    tabId: data.tabId,
    chunkIndex: data.chunkIndex,
    sessionStartUnixMs: data.sessionStartUnixMs,
    clientSendUnixMs: nowUnixMs,
    chunkStartOffsetMs: data.chunkIndex * 15000,
    chunkEndOffsetMs: (data.chunkIndex + 1) * 15000,
    eventCount: events.length,
    hasFullSnapshot: data.hasFullSnapshot ?? data.chunkIndex === 0,
    isFinal: data.isFinal ?? false,
    recorderKind: "dom",
    schemaVersion: SCHEMA_VERSION,
    rrwebVersion: "2.1.1",
    recorderVersion: "12.0.0",
    maskingMode: "MaskSensitiveInputsOnly",
    consentState: "NotRequired",
    triggerReason: "manual",
    payloadEncoding: "identity",
    payloadBytes: payloadBytes,
    url: data.url,
    routes: data.routes ?? [data.url],
    signals: {
      errorCount: data.errorCount ?? 0,
      rageClickCount: data.rageClickCount ?? 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      routeCount: data.routeCount ?? 0,
    },
    fidelityNotices: [],
    droppedEvents: 0,
    flushFailures: 0,
  };

  const isMetaChunk: boolean =
    data.chunkIndex === 0 || envelope["isFinal"] === true;

  if (isMetaChunk) {
    const meta: Record<string, unknown> = {
      /*
       * The ENTRY url, not the current one. The recorder captures this once
       * at start(), so it is the same value on chunk 0 and on the final
       * chunk even after the page has navigated.
       */
      entryUrl: data.routes?.[0] ?? data.url,
      browserName: "Chrome",
      browserVersion: "141",
      osName: "macOS",
      deviceType: "desktop",
      viewportWidth: 1440,
      viewportHeight: 900,
    };

    if (data.identifiedUserRef) {
      meta["identifiedUserRef"] = data.identifiedUserRef;
    }

    envelope["meta"] = meta;
  }

  const body: Buffer = Buffer.concat([
    new Uint8Array(Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8")),
    new Uint8Array(Buffer.from(payload, "utf8")),
  ]);

  const response: APIResponse = await data.page.request.post(chunkUrl, {
    headers: {
      "content-type": CHUNK_CONTENT_TYPE,
      "x-oneuptime-token": data.ingestionKey,
      "x-oneuptime-app-identifier": data.appIdentifier,
    },
    data: body,
  });

  /*
   * 202 is the only success. A 204 means the server DELIBERATELY refused
   * (disabled, unsampled, over budget) and would leave the rest of the spec
   * asserting against a session that was never stored, so it fails here with
   * the reason rather than 180 seconds later with "not visible".
   */
  expect(
    response.status(),
    `chunk ${data.chunkIndex} refused: ${await response.text()}`,
  ).toBe(202);
};

type CreateRumApplicationFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
  appIdentifier: string;
}) => Promise<void>;

/*
 * Creates a RUM application THROUGH THE DASHBOARD FORM, which is the point.
 *
 * appIdentifier is a required column with no default, and it shipped with an
 * empty create ACL — so ModelForm stripped the field out of the rendered form
 * and the POST that followed was rejected by the server with "appIdentifier
 * is required". The Create button was a dead end for every user, and the only
 * way a RUM application could exist was auto-discovery from telemetry. Nothing
 * failed at build time and no unit test covered the form, which is why this
 * assertion lives at this level.
 */
export const createRumApplication: CreateRumApplicationFunction = async (data: {
  page: Page;
  projectId: string;
  name: string;
  appIdentifier: string;
}): Promise<void> => {
  const page: Page = data.page;

  const rumUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${data.projectId}/rum`)
    .toString();

  await gotoProjectPage({
    page,
    projectId: data.projectId,
    url: rumUrl,
    ready: page.getByRole("button", { name: "Create RUM Application" }),
  });

  await page.getByRole("button", { name: "Create RUM Application" }).click();
  await page.getByTestId("modal").waitFor({ state: "visible" });

  await page
    .locator("input[placeholder='storefront-web']")
    .first()
    .fill(data.name);

  /*
   * The App Identifier input. It shares the placeholder with Name, so it is
   * addressed by position — and its very presence is the regression this
   * helper exists to catch: when the column was not creatable, this locator
   * resolved to nothing.
   */
  const identifierInput: Locator = page
    .locator("input[placeholder='storefront-web']")
    .nth(1);

  await expect(
    identifierInput,
    "The create form must render an App Identifier field - the server requires the column",
  ).toBeVisible();

  await identifierInput.fill(data.appIdentifier);

  await page
    .getByRole("button", { name: "Create RUM Application" })
    .last()
    .click();

  /* The modal closes only on a successful create. */
  await page.getByTestId("modal").waitFor({ state: "hidden", timeout: 60000 });

  await expect(page.getByText(data.name).first()).toBeVisible({
    timeout: 60000,
  });
};

type OpenSessionReplayListFunction = (data: {
  page: Page;
  projectId: string;
  rumApplicationId: string;
}) => Promise<void>;

export const openSessionReplayList: OpenSessionReplayListFunction =
  async (data: {
    page: Page;
    projectId: string;
    rumApplicationId: string;
  }): Promise<void> => {
    const listUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(
        `/dashboard/${data.projectId}/rum/${data.rumApplicationId}/session-replay`,
      )
      .toString();

    await gotoProjectPage({
      page: data.page,
      projectId: data.projectId,
      url: listUrl,
      ready: data.page.getByText("Session Replay").first(),
    });
  };

type ReadRumApplicationIdFunction = (data: {
  page: Page;
  projectId: string;
  appIdentifier: string;
}) => Promise<string>;

/*
 * The application's id, read back through the same CRUD API the dashboard
 * uses. Needed because every replay read route is scoped to it.
 */
export const readRumApplicationId: ReadRumApplicationIdFunction = async (data: {
  page: Page;
  projectId: string;
  appIdentifier: string;
}): Promise<string> => {
  const listUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute("/api/rum-application/get-list")
    .toString();

  /*
   * tenantid is what ProjectAuthorization resolves the caller's project role
   * from. Without it the CRUD API cannot tell which project this user is a
   * member of and answers "You do not have permissions to read RUM
   * Application" - which reads like a permission bug rather than a missing
   * header. Every other E2E helper that calls the CRUD API sends it.
   */
  const response: APIResponse = await data.page.request.post(listUrl, {
    headers: {
      "content-type": "application/json",
      tenantid: data.projectId,
    },
    data: {
      query: {
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
      },
      select: { _id: true, appIdentifier: true },
      limit: 10,
      skip: 0,
      sort: {},
    },
  });

  expect(response.status(), await response.text()).toBe(200);

  const body: {
    data?: Array<{ _id?: string; appIdentifier?: string }>;
  } = (await response.json()) as {
    data?: Array<{ _id?: string; appIdentifier?: string }>;
  };

  const match: { _id?: string } | undefined = (body.data || []).find(
    (row: { appIdentifier?: string }): boolean => {
      return row.appIdentifier === data.appIdentifier;
    },
  );

  expect(
    match?._id,
    `No RUM application found for identifier ${data.appIdentifier}`,
  ).toBeTruthy();

  return match!._id!;
};
