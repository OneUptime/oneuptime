import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardRecorder, {
  DASHBOARD_BLOCK_SELECTORS,
  RECORDER_LOADER_PATH,
  RECORDER_SCRIPT_ATTRIBUTE,
  getDashboardRecorderInitOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardRecorder";
import { DashboardRecordingConfig } from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardRecordingConfig";
import { PRODUCT_TEXT_CLASS_NAME } from "../../../UI/Utils/ProductText";

/*
 * How the Dashboard loads OneUptime's own recorder (#6834): the docs' init
 * global and loader script, from the configured host, asking for more
 * masking than any policy gives - every word masked but the product's own,
 * images, canvases, code and monospace text left out - and with consent
 * granted only because the person already gave it.
 */

const INIT_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY__";
const QUEUE_GLOBAL: string = "OneUptimeReplayQueue";

const CONFIG: DashboardRecordingConfig = {
  host: "https://oneuptime.com",
  token: "ingestion-key",
  appIdentifier: "dashboard-app",
};

const windowRecord: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return window as unknown as Record<string, unknown>;
};

const queue: () => Array<Array<unknown>> = (): Array<Array<unknown>> => {
  return (windowRecord()[QUEUE_GLOBAL] as Array<Array<unknown>>) || [];
};

const scripts: () => Array<HTMLScriptElement> =
  (): Array<HTMLScriptElement> => {
    return Array.from(
      document.querySelectorAll<HTMLScriptElement>(
        `script[${RECORDER_SCRIPT_ATTRIBUTE}]`,
      ),
    );
  };

describe("DashboardRecorder", () => {
  beforeEach(() => {
    delete windowRecord()[INIT_GLOBAL];
    delete windowRecord()[QUEUE_GLOBAL];
    document.head.innerHTML = "";
  });

  afterEach(() => {
    delete windowRecord()[INIT_GLOBAL];
    delete windowRecord()[QUEUE_GLOBAL];
    document.head.innerHTML = "";
  });

  test("asks for MaskAllText, Do Not Track honoured, nothing kept on disk, and the blocked elements", () => {
    expect(getDashboardRecorderInitOptions(CONFIG)).toEqual({
      host: CONFIG.host,
      token: CONFIG.token,
      appIdentifier: CONFIG.appIdentifier,
      respectDoNotTrack: true,
      offlineStorage: false,
      maskAllText: true,
      blockSelectors: [...DASHBOARD_BLOCK_SELECTORS],
    });
  });

  test("blocks images, canvases, frames, code and monospace text (keys, ids, log lines)", () => {
    for (const selector of [
      "img",
      "canvas",
      "iframe",
      "pre",
      "code",
      ".font-mono",
    ]) {
      expect(DASHBOARD_BLOCK_SELECTORS).toContain(selector);
    }

    // Every one is a selector a browser can use.
    for (const selector of DASHBOARD_BLOCK_SELECTORS) {
      expect(() => {
        document.createDocumentFragment().querySelector(selector);
      }).not.toThrow();
    }
  });

  test("loads the docs' loader from the configured host, once", () => {
    DashboardRecorder.start(CONFIG);
    DashboardRecorder.start(CONFIG);

    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.src).toBe(`${CONFIG.host}${RECORDER_LOADER_PATH}`);
    expect(scripts()[0]?.async).toBe(true);
    expect(windowRecord()[INIT_GLOBAL]).toEqual(
      getDashboardRecorderInitOptions(CONFIG),
    );
  });

  test("grants consent first: the person gave it before any of this was fetched", () => {
    DashboardRecorder.start(CONFIG);

    expect(queue()).toEqual([["grantConsent"]]);
  });

  test("starts paused when asked, so it never snapshots the page it should not see", () => {
    DashboardRecorder.start(CONFIG, { startPaused: true });

    expect(queue()).toEqual([["grantConsent"], ["pause"]]);
  });

  test("speaks to the recorder through its queue: pause, resume, markers, tags, and a stop that keeps nothing", () => {
    DashboardRecorder.start(CONFIG);
    DashboardRecorder.pause();
    DashboardRecorder.resume();
    DashboardRecorder.track("frustration/page_left_quickly");
    DashboardRecorder.setTags({ page: "/dashboard/:projectId/home" });
    DashboardRecorder.stop();

    expect(queue()).toEqual([
      ["grantConsent"],
      ["pause"],
      ["resume"],
      ["track", "frustration/page_left_quickly"],
      ["setTags", { page: "/dashboard/:projectId/home" }],
      ["revokeConsent"],
      ["stop"],
    ]);
  });

  test("lets the queue go when the recorder could not load, and adds nothing more to it", () => {
    DashboardRecorder.start(CONFIG);
    scripts()[0]?.dispatchEvent(new Event("error"));

    expect(DashboardRecorder.hasFailedToLoad()).toBe(true);
    expect(windowRecord()[QUEUE_GLOBAL]).toBeUndefined();

    DashboardRecorder.pause();

    expect(windowRecord()[QUEUE_GLOBAL]).toBeUndefined();
  });
});

describe("the product's own words", () => {
  test("are marked with the class the recorder reveals", () => {
    const masking: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/BrowserRecorder/src/Masking.ts",
      ),
      "utf8",
    );

    expect(masking).toContain(
      `export const UNMASK_CLASS_NAME: string = "${PRODUCT_TEXT_CLASS_NAME}";`,
    );
  });

  test("the commands it queues are commands the recorder accepts", () => {
    const index: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/BrowserRecorder/src/Index.ts",
      ),
      "utf8",
    );

    for (const command of [
      "grantConsent",
      "revokeConsent",
      "pause",
      "resume",
      "track",
      "setTags",
      "stop",
    ]) {
      expect(index).toContain(`command === "${command}"`);
    }
  });

  test("the init options it sets are ones the recorder reads", () => {
    const pageMasking: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/BrowserRecorder/src/PageMasking.ts",
      ),
      "utf8",
    );
    const config: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/BrowserRecorder/src/Config.ts",
      ),
      "utf8",
    );

    expect(pageMasking).toContain('record["maskAllText"] === true');
    expect(pageMasking).toContain('record["blockSelectors"]');
    expect(config).toContain('raw["respectDoNotTrack"]');
    expect(config).toContain('raw["offlineStorage"]');
    expect(config).toContain("__ONEUPTIME_SESSION_REPLAY__");
  });
});
