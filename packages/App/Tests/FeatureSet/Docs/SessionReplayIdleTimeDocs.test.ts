import {
  SESSION_REPLAY_IDLE_PAUSE_MS,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
} from "Common/Types/Rum/SessionReplay";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Session Replay "Idle time" section against the recorder it describes
 * (#4208).
 *
 * The section is the answer to "does an idle tab cost me anything", so
 * every number and every list in it is a claim the code can contradict:
 * how long until recording pauses, how long until the session ends, which
 * inputs count as someone being there, which diagnostics codes say so and
 * what getDiagnostics() reports meanwhile. Each is read back from the
 * source here rather than restated, so changing the behaviour without the
 * page fails.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Docs/Content/en",
);
const RECORDER_FILE: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/BrowserRecorder/src/Recorder.ts",
);
const PLAYER_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Dashboard/src/Components/SessionReplay",
);
const MOBILE_RECORDER_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/MobileRecorder/src",
);

const PAGE: string = "telemetry/session-replay";
const TROUBLESHOOTING_PAGE: string = "rum/session-replay-troubleshooting";
const HEADING: string = "## Idle time";

function readPage(relative: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, `${relative}.md`), "utf8");
}

/* The body of one heading's section, up to the next heading of its level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  if (start < 0) {
    return "";
  }

  const level: number = heading.indexOf(" ");
  const rest: Array<string> = lines.slice(start + 1);
  const end: number = rest.findIndex((line: string): boolean => {
    const match: RegExpMatchArray | null = line.match(/^(#+) /);
    return match !== null && (match[1] || "").length <= level;
  });

  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/* The string literals of one `const NAME ... = [ ... ];` array in a source file. */
function arrayLiterals(source: string, name: string): Array<string> {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`),
  );

  return Array.from((match?.[1] || "").matchAll(/"([^"]+)"/g)).map(
    (literal: RegExpMatchArray): string => {
      return literal[1] || "";
    },
  );
}

/* How the section names each DOM event the recorder treats as a person. */
const INPUT_WORDING: Record<string, string> = {
  keydown: "key press",
  mousedown: "mouse button",
  mousemove: "the mouse moving",
  wheel: "the wheel",
  touchstart: "a touch",
  touchmove: "a touch",
};

describe("Session Replay idle time docs", (): void => {
  const page: string = readPage(PAGE);
  const idle: string = section(page, HEADING);

  it("has the section, under the anchor its links use", (): void => {
    expect(idle.length).toBeGreaterThan(0);
    expect(slugify("Idle time")).toBe("idle-time");

    const linkingPages: Array<string> = [
      readPage(PAGE),
      readPage(TROUBLESHOOTING_PAGE),
    ];

    for (const markdown of linkingPages) {
      expect(markdown).toMatch(
        /\]\((\/docs\/telemetry\/session-replay)?#idle-time\)/,
      );
    }
  });

  it("states the pause and the session end the recorder actually uses", (): void => {
    expect(SESSION_REPLAY_IDLE_PAUSE_MS).toBe(5 * 60 * 1000);
    expect(SESSION_REPLAY_IDLE_ROLLOVER_MS).toBe(30 * 60 * 1000);

    expect(idle).toContain(
      "After five minutes without input, recording pauses.",
    );
    expect(idle).toContain("Within 30 minutes of the last input");
    expect(idle).toContain("The five minutes and the 30 minutes are fixed.");
  });

  it("names exactly the inputs the recorder listens for", (): void => {
    const listened: Array<string> = arrayLiterals(
      fs.readFileSync(RECORDER_FILE, "utf8"),
      "USER_INPUT_EVENTS",
    );

    /* A new input means a new phrase here: the table above must grow too. */
    expect(listened.sort()).toEqual(Object.keys(INPUT_WORDING).sort());

    for (const type of listened) {
      expect(idle).toContain(INPUT_WORDING[type] as string);
    }
  });

  it("says what is and is not recorded while paused", (): void => {
    for (const claim of [
      "_Recording paused_",
      "_Recording resumed_",
      "no uploads, nothing stored",
      "carry no session id while paused",
      "web vitals",
      "`track()` call is dropped",
      "whatever **Skip idle** is set to",
      "adds nothing to the bytes stored",
      "OneUptimeReplay.captureSession()",
    ]) {
      expect(idle).toContain(claim);
    }
  });

  it("lists the paused state among getDiagnostics() states, as the recorder reports it", (): void => {
    const recorder: string = fs.readFileSync(RECORDER_FILE, "utf8");

    expect(recorder).toMatch(/export type RecorderState =[^;]*\| "paused"/);
    expect(page).toContain(
      "`paused` (nobody has touched the page for five minutes",
    );
  });

  it("explains both diagnostics codes on the troubleshooting page", (): void => {
    const troubleshooting: string = readPage(TROUBLESHOOTING_PAGE);
    const recorder: string = fs.readFileSync(RECORDER_FILE, "utf8");

    for (const code of ["recording-paused-idle", "recording-resumed"]) {
      expect(recorder).toContain(`"${code}"`);
      expect(troubleshooting).toContain(`| \`${code}\``);
    }
  });

  /*
   * The player half of the story: what the page says a viewer sees is the
   * copy the player actually draws.
   */
  it("describes the paused band in the player's own words", (): void => {
    const overlays: string = fs.readFileSync(
      path.join(PLAYER_DIR, "ReplayStageOverlays.tsx"),
      "utf8",
    );
    const timeline: string = fs.readFileSync(
      path.join(PLAYER_DIR, "ReplayTimeline.tsx"),
      "utf8",
    );
    const player: string = section(page, "### The player");

    expect(overlays).toContain(
      "`Skipped ${length}: recording paused while the page was idle`",
    );
    expect(player).toContain(
      "_Skipped 23m: recording paused while the page was idle_",
    );

    expect(timeline).toContain('label: "Recording paused"');
    expect(player).toContain("A **Recording paused** stretch");
    expect(player).toContain("Playback always jumps over it");
  });

  /*
   * The React Native SDK keeps its own copy of the contract (it cannot
   * import Common into a customer's app), so the page's claims about it are
   * read back from that copy and from the recorder itself.
   */
  it("describes the React Native pause as the SDK implements it", (): void => {
    const contract: string = fs.readFileSync(
      path.join(MOBILE_RECORDER_DIR, "Contract.ts"),
      "utf8",
    );
    const recorder: string = fs.readFileSync(
      path.join(MOBILE_RECORDER_DIR, "MobileReplayRecorder.ts"),
      "utf8",
    );

    expect(contract).toMatch(
      /export const SESSION_REPLAY_IDLE_PAUSE_MS: number = 5 \* 60_000;/,
    );
    expect(recorder).toContain('"keyboardDidShow"');
    expect(recorder).toContain('"keyboardDidHide"');
    expect(recorder).toMatch(/\| "paused"/);

    expect(idle).toContain("**React Native** pauses the same way.");
    expect(idle).toContain("the soft keyboard showing or hiding");
    expect(idle).toContain("It never pauses while the soft keyboard is up");
    expect(idle).toContain("`getDiagnostics().status` reads `paused`");
  });

  it("no longer counts a scroll or input the page makes by itself as activity", (): void => {
    const sessionList: string = section(page, "### The session list");

    expect(sessionList).toContain(
      "Thirty minutes with no key, click, mouse movement, wheel or touch",
    );
    expect(sessionList).not.toContain("no mouse, scroll, input or click");
  });
});
