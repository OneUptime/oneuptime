jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import { HelpAndSupportServerSettingsClass } from "../../../../Server/Utils/HelpAndSupport/HelpAndSupportServerSettings";
import {
  DEFAULT_INVITE_MESSAGE,
  DEFAULT_NO_PROJECT_MESSAGE,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  getDefaultHelpAndSupportSettings,
} from "../../../../Types/HelpAndSupport/HelpAndSupport";
import { JSONObject } from "../../../../Types/JSON";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHERE THE SERVER SENDS ITS PEOPLE FOR HELP, ON THE SERVER (#10864-#10866).
 *
 * Every env.js, every invitation screen and every Give feedback asks, so
 * what an admin saved is kept a moment; a change made here takes effect at
 * once. A read that fails keeps the settings read before - a database blip
 * never puts a server's own links back to OneUptime's - and only a server
 * that never read them answers every default.
 */

class TestSettings extends HelpAndSupportServerSettingsClass {
  public stored: unknown = null;
  public reads: number = 0;
  public writes: Array<JSONObject> = [];
  public failNextRead: boolean = false;
  public time: number = 1_000_000;

  public override now(): number {
    return this.time;
  }

  public override async readStored(): Promise<unknown> {
    this.reads++;

    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error("connection refused");
    }

    return this.stored;
  }

  public override async writeStored(settings: JSONObject): Promise<void> {
    this.writes.push(settings);
    this.stored = settings;
  }
}

let settings: TestSettings;

beforeEach(() => {
  settings = new TestSettings();
});

describe("reading", () => {
  test("nothing saved is every default", async () => {
    expect(await settings.getSettings()).toEqual(
      getDefaultHelpAndSupportSettings(),
    );
  });

  test("what an admin saved, read by the rules it was kept by", async () => {
    settings.stored = {
      supportEmail: { choice: "email", value: "it-help@example.com" },
      chat: { choice: "link", value: "javascript:alert(1)" },
    };

    const read: HelpAndSupportSettings = await settings.getSettings();

    expect(read[HelpItem.SupportEmail]).toEqual({
      choice: HelpChoice.Email,
      value: "it-help@example.com",
    });
    // A link written straight into the database that would be refused is never served.
    expect(read[HelpItem.Chat]).toEqual({
      choice: HelpChoice.Default,
      value: null,
    });
  });

  test("is kept for a moment: many asks, one read", async () => {
    await settings.getSettings();
    await settings.getSettings();
    settings.time += 29_000;
    await settings.getSettings();

    expect(settings.reads).toBe(1);

    settings.time += 2_000;
    await settings.getSettings();

    expect(settings.reads).toBe(2);
  });

  test("a read that fails keeps the settings read before", async () => {
    settings.stored = { requestDemo: { choice: "hidden" } };
    await settings.getSettings();

    settings.time += 60_000;
    settings.failNextRead = true;

    const read: HelpAndSupportSettings = await settings.getSettings();

    expect(read[HelpItem.RequestDemo].choice).toBe(HelpChoice.Hidden);
  });

  test("a server that never read them answers every default when the read fails", async () => {
    settings.failNextRead = true;

    expect(await settings.getSettings()).toEqual(
      getDefaultHelpAndSupportSettings(),
    );
  });
});

describe("saving one place", () => {
  test("keeps only the places off their default, and takes effect at once", async () => {
    await settings.getSettings();

    const saved: HelpAndSupportSettings = await settings.save({
      item: HelpItem.GitHub,
      setting: { choice: HelpChoice.Hidden, value: null },
    });

    expect(settings.writes).toEqual([{ gitHub: { choice: "hidden" } }]);
    expect(saved[HelpItem.GitHub].choice).toBe(HelpChoice.Hidden);

    const readsBefore: number = settings.reads;

    expect((await settings.getSettings())[HelpItem.GitHub].choice).toBe(
      HelpChoice.Hidden,
    );
    // Served from what was just written, without a read.
    expect(settings.reads).toBe(readsBefore);
  });

  test("reads fresh first, so another admin's change is kept", async () => {
    settings.stored = { requestDemo: { choice: "hidden" } };

    await settings.save({
      item: HelpItem.SupportEmail,
      setting: { choice: HelpChoice.Email, value: "it-help@example.com" },
    });

    expect(settings.writes[0]).toEqual({
      supportEmail: { choice: "email", value: "it-help@example.com" },
      requestDemo: { choice: "hidden" },
    });
  });

  test("back to the default takes the place out of what is kept", async () => {
    settings.stored = { requestDemo: { choice: "hidden" } };

    await settings.save({
      item: HelpItem.RequestDemo,
      setting: { choice: HelpChoice.Default, value: null },
    });

    expect(settings.writes[0]).toEqual({});
  });

  test("a value that would be refused is never written, even if handed in", async () => {
    await settings.save({
      item: HelpItem.HelpLink,
      setting: { choice: HelpChoice.Link, value: "javascript:alert(1)" },
    });

    expect(settings.writes[0]).toEqual({});
  });
});

describe("the sign-in message", () => {
  test("is the default sentence of each screen until an admin writes one", async () => {
    expect(await settings.getInviteMessage()).toBe(DEFAULT_INVITE_MESSAGE);
    expect(await settings.getNoProjectMessage()).toBe(
      DEFAULT_NO_PROJECT_MESSAGE,
    );
  });

  test("is the server's own words on both screens once written", async () => {
    settings.stored = {
      inviteMessage: {
        choice: "text",
        value: "Ask the IT service desk: it-help@example.com",
      },
    };

    expect(await settings.getInviteMessage()).toBe(
      "Ask the IT service desk: it-help@example.com",
    );
    expect(await settings.getNoProjectMessage()).toBe(
      "Ask the IT service desk: it-help@example.com",
    );
  });
});
