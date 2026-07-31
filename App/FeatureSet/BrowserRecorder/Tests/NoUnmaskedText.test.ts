import { SessionReplayConfigResponse } from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { RecorderInitOptions } from "../src/Config";
import Recorder from "../src/Recorder";

/*
 * THE test for this package.
 *
 * Everything else here checks that a mechanism behaves. This checks the only
 * promise that actually matters: that no readable page content reaches the
 * wire. It runs the real recorder, with the real rrweb, over a realistic
 * page, and greps the ACTUAL BYTES of every POST body - not the event objects
 * an intermediate layer handed us, because a leak introduced after
 * serialisation would be invisible to that.
 *
 * Known and documented limits of this guarantee, stated here so nobody reads
 * it as broader than it is:
 *
 *  - It covers text nodes and input values, which is what MaskAllText means.
 *  - It does NOT cover arbitrary attribute values (data-email="...", a title
 *    attribute, an href). rrweb serialises attributes verbatim, and walking
 *    a full snapshot to rewrite them would cost more than it protects. The
 *    supported control for those is blockSelectors / .oneuptime-block.
 */

const SECRETS: Record<string, string> = {
  heading: "Invoice for Alice Hartwell",
  paragraph: "Your account balance is 84,220.19 GBP as of March",
  listItem: "Order 8891 shipped to 14 Marlborough Terrace",
  option: "Barclays current account ending 4417",
  buttonLabel: "Pay Alice Hartwell now",
  typedEmail: "alice.hartwell@example.com",
  typedPassword: "correct-horse-battery-staple",
  typedCard: "4111111111111111",
  typedNote: "Mum's maiden name is Whitcombe",
  consoleMessage: "checkout failed for alice.hartwell@example.com",
  errorMessage: "could not charge card 4111111111111111",
  urlToken: "eyJhbGciOiJIUzI1NiJ9-super-secret-reset-token",
};

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

function maskAllTextConfig(): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    consentMode: SessionReplayConsentMode.NotRequired,

    /* Upload from the first event, so every byte the recorder produces is inspected. */
    samplePercentage: 100,
    maskSelectors: [],
    blockSelectors: [],
    urlAllowlist: [],
    ignoreErrorPatterns: [],
    recordCanvas: false,
    captureUserIdentity: false,
    respectDoNotTrack: true,
    configEpoch: 1,
    directive: "continue",
  };
}

function buildPage(): void {
  document.body.innerHTML = `
    <header><h1>${SECRETS["heading"]}</h1></header>
    <main>
      <p id="balance">${SECRETS["paragraph"]}</p>
      <ul><li>${SECRETS["listItem"]}</li></ul>
      <form id="pay">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" />
        <input id="password" name="password" type="password" autocomplete="current-password" />
        <input id="card" name="card" type="text" autocomplete="cc-number" />
        <textarea id="note"></textarea>
        <select id="account">
          <option value="1">${SECRETS["option"]}</option>
        </select>
        <button type="button" id="pay-button">${SECRETS["buttonLabel"]}</button>
      </form>
    </main>
  `;

  const email: HTMLInputElement = document.getElementById(
    "email",
  ) as HTMLInputElement;
  const password: HTMLInputElement = document.getElementById(
    "password",
  ) as HTMLInputElement;
  const card: HTMLInputElement = document.getElementById(
    "card",
  ) as HTMLInputElement;
  const note: HTMLTextAreaElement = document.getElementById(
    "note",
  ) as HTMLTextAreaElement;

  email.value = SECRETS["typedEmail"] as string;
  email.setAttribute("value", SECRETS["typedEmail"] as string);
  password.value = SECRETS["typedPassword"] as string;
  password.setAttribute("value", SECRETS["typedPassword"] as string);
  card.value = SECRETS["typedCard"] as string;
  card.setAttribute("value", SECRETS["typedCard"] as string);
  note.value = SECRETS["typedNote"] as string;
  note.textContent = SECRETS["typedNote"] as string;
}

describe("no unmasked page text reaches the wire", (): void => {
  let fetchMock: jest.Mock;
  let recorder: Recorder | null = null;

  const flushUploads: () => Promise<void> = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  };

  const allPostedBytes: () => string = (): string => {
    return fetchMock.mock.calls
      .map((call: Array<unknown>): string => {
        const init: Record<string, unknown> = call[1] as Record<
          string,
          unknown
        >;

        return new TextDecoder().decode(init["body"] as Uint8Array);
      })
      .join("\n");
  };

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();

    window.history.replaceState(
      {},
      "",
      `/reset-password?token=${SECRETS["urlToken"]}`,
    );

    /*
     * Identity encoding keeps the emitted bytes greppable. gzip would only
     * hide a leak from the assertion, never from an attacker.
     */
    delete (globalThis as unknown as Record<string, unknown>)[
      "CompressionStream"
    ];

    fetchMock = jest.fn().mockResolvedValue({
      status: 202,
      headers: {
        get: (): string | null => {
          return null;
        },
      },
      text: async (): Promise<string> => {
        return "";
      },
    });

    (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;
    (window as unknown as Record<string, unknown>)["fetch"] = fetchMock;

    buildPage();
  });

  afterEach((): void => {
    if (recorder) {
      recorder.stop();
      recorder = null;
    }

    jest.restoreAllMocks();
  });

  it("emits no secret from the initial snapshot, mutations, inputs, console or errors", async (): Promise<void> => {
    const instance: Recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: maskAllTextConfig(),
    });

    instance.start();
    recorder = instance;

    /* A mutation carrying new text. */
    const added: HTMLParagraphElement = document.createElement("p");
    added.textContent = SECRETS["listItem"] as string;
    document.body.appendChild(added);

    /* A typed input, then the show-password toggle. */
    const password: HTMLInputElement = document.getElementById(
      "password",
    ) as HTMLInputElement;

    password.dispatchEvent(new Event("input", { bubbles: true }));
    password.setAttribute("type", "text");
    password.dispatchEvent(new Event("input", { bubbles: true }));

    /*
     * A console call and an uncaught error, both quoting user data. The
     * eslint no-console rule is disabled for the one line: exercising the
     * console recorder is the entire point of it.
     */
    // eslint-disable-next-line no-console
    console.error(SECRETS["consoleMessage"]);
    window.dispatchEvent(
      new ErrorEvent("error", { message: SECRETS["errorMessage"] as string }),
    );

    instance.trigger(SessionReplayTriggerReason.Manual);

    await flushUploads();

    /* Seal the session so the tail is inspected too. */
    const hide: Event = new Event("pagehide");
    Object.defineProperty(hide, "persisted", { value: false });
    window.dispatchEvent(hide);

    await flushUploads();

    const posted: string = allPostedBytes();

    /* Positive control: something substantial really was recorded. */
    expect(fetchMock).toHaveBeenCalled();
    expect(posted.length).toBeGreaterThan(500);
    expect(posted).toContain("•");

    for (const [name, secret] of Object.entries(SECRETS)) {
      expect(`${name}:${posted}`).not.toContain(secret);
    }

    /* Individual high-value fragments, in case a secret was split. */
    for (const fragment of [
      "Hartwell",
      "4111111111111111",
      "battery-staple",
      "Whitcombe",
      "Marlborough",
      "Barclays",
      "super-secret-reset-token",
    ]) {
      expect(posted).not.toContain(fragment);
    }
  });

  /*
   * The show-password toggle must not even be VISIBLE in the stream: a viewer
   * who sees type change to text next to a masked value knows exactly what
   * field they are looking at.
   */
  it("suppresses the show-password type mutation itself", async (): Promise<void> => {
    const instance: Recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: maskAllTextConfig(),
    });

    instance.start();
    recorder = instance;

    const password: HTMLInputElement = document.getElementById(
      "password",
    ) as HTMLInputElement;

    password.setAttribute("type", "text");
    password.setAttribute("data-revealed", "true");

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });

    /*
     * Sealing the session is what forces the open chunk out; the recorder is
     * already uploading, so trigger() alone would be a no-op.
     */
    const hide: Event = new Event("pagehide");
    Object.defineProperty(hide, "persisted", { value: false });
    window.dispatchEvent(hide);

    await flushUploads();

    /*
     * Asserted against the parsed mutation events rather than the raw bytes:
     * `"type":"text"` legitimately appears in the initial snapshot for every
     * ordinary text input on the page, so a substring match would be testing
     * nothing.
     */
    const mutatedAttributes: Array<Record<string, unknown>> = [];

    for (const call of fetchMock.mock.calls) {
      const init: Record<string, unknown> = call[1] as Record<string, unknown>;
      const text: string = new TextDecoder().decode(init["body"] as Uint8Array);
      const payload: string = text.slice(text.indexOf("\n") + 1);

      const events: Array<Record<string, unknown>> = JSON.parse(
        payload,
      ) as Array<Record<string, unknown>>;

      for (const event of events) {
        const data: Record<string, unknown> = (event["data"] || {}) as Record<
          string,
          unknown
        >;

        if (event["type"] !== 3 || data["source"] !== 0) {
          continue;
        }

        for (const entry of (data["attributes"] || []) as Array<
          Record<string, unknown>
        >) {
          mutatedAttributes.push(
            entry["attributes"] as Record<string, unknown>,
          );
        }
      }
    }

    const keys: Array<string> = mutatedAttributes.flatMap(
      (attributes: Record<string, unknown>): Array<string> => {
        return Object.keys(attributes);
      },
    );

    /*
     * Asserted as an exact set, not as "type is absent".
     *
     * rrweb 2.1.1 writes its OWN marker onto the live element when it sees a
     * type mutation away from password (rrweb.js:11918), so the emitted
     * mutations for a show-password toggle were
     * [{"data-revealed":"true"},{"data-rr-is-password":"true"}]. Asserting
     * only that "type" is absent passed while the marker disclosed exactly
     * the same fact: which masked field is the password. An exact set makes
     * any future rrweb-authored marker attribute fail here instead of
     * slipping through.
     */
    expect(keys).toEqual(["data-revealed"]);
  });

  /*
   * MaskInputsOnly is offered and labelled less safe. Static text is recorded
   * verbatim in that mode - but input values, including a password behind a
   * reveal toggle, still are not.
   */
  it("still masks every input value in MaskInputsOnly mode", async (): Promise<void> => {
    const instance: Recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: {
        ...maskAllTextConfig(),
        maskingMode: SessionReplayMaskingMode.MaskInputsOnly,
      },
    });

    instance.start();
    recorder = instance;

    instance.trigger(SessionReplayTriggerReason.Manual);

    await flushUploads();

    const posted: string = allPostedBytes();

    /* Static text is intentionally readable in this mode. */
    expect(posted).toContain("Hartwell");

    /* Values never are. */
    expect(posted).not.toContain("battery-staple");
    expect(posted).not.toContain("4111111111111111");
    expect(posted).not.toContain("alice.hartwell@example.com");
  });
});
