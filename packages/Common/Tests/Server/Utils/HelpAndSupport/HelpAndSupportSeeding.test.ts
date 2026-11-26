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

import logger from "../../../../Server/Utils/Logger";
import HelpAndSupportServerSettings, {
  HelpAndSupportServerSettingsClass,
} from "../../../../Server/Utils/HelpAndSupport/HelpAndSupportServerSettings";
import {
  HelpAndSupportSeedOutcome,
  HelpAndSupportSeedingClass,
} from "../../../../Server/Utils/HelpAndSupport/HelpAndSupportSeeding";
import {
  HelpAndSupportProblems,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  readHelpAndSupportSettings,
} from "../../../../Types/HelpAndSupport/HelpAndSupport";
import {
  SEEDED_ITEMS_KEY,
  readSeededItems,
} from "../../../../Types/HelpAndSupport/HelpAndSupportSeed";
import { JSONObject } from "../../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * HELP AND SUPPORT FROM THE SERVER'S CONFIGURATION, ON THE SERVER (#10938).
 *
 * The Helm chart's helpAndSupport values (HELP_AND_SUPPORT_* in config.env)
 * seed Admin Dashboard > Settings > Help and Support at a server's first
 * start, and never again once anything is saved: a restart after an admin
 * changed a setting keeps the admin's change, a value changed in the
 * configuration later is not applied (and the log says so), and a value the
 * page would refuse is left out and said in the log. One database stands in
 * for every start of one server, the same row the page saves to.
 */

type LogMock = ReturnType<typeof jest.fn>;

const loggerMock: Record<"debug" | "info" | "warn" | "error", LogMock> =
  logger as unknown as Record<"debug" | "info" | "warn" | "error", LogMock>;

// The server's settings row, as both the seeding and the page read and write it.
interface Row {
  exists: boolean;
  helpAndSupport: JSONObject | null;
  failNextWrite: boolean;
}

class TestSeeding extends HelpAndSupportSeedingClass {
  public environment: Record<string, string | undefined> = {};
  public writes: Array<JSONObject> = [];
  public row: Row;

  public constructor(row: Row) {
    super();
    this.row = row;
  }

  public override getEnvironment(): Readonly<
    Record<string, string | undefined>
  > {
    return this.environment;
  }

  public override async readStored(): Promise<unknown | null | undefined> {
    if (!this.row.exists) {
      return undefined;
    }

    return this.row.helpAndSupport;
  }

  // As GlobalConfigService.seedHelpAndSupport: written only while nothing is saved.
  public override async writeIfNothingSaved(
    settings: JSONObject,
  ): Promise<boolean> {
    if (this.row.failNextWrite) {
      this.row.failNextWrite = false;
      throw new Error("connection refused");
    }

    if (!this.row.exists || this.row.helpAndSupport !== null) {
      return false;
    }

    this.writes.push(settings);
    this.row.helpAndSupport = settings;
    return true;
  }
}

// The page, saving to the same row.
class TestPage extends HelpAndSupportServerSettingsClass {
  public row: Row;

  public constructor(row: Row) {
    super();
    this.row = row;
  }

  public override async readStored(): Promise<unknown> {
    return this.row.helpAndSupport;
  }

  public override async writeStored(settings: JSONObject): Promise<void> {
    this.row.helpAndSupport = settings;
  }
}

const CONFIGURATION: Record<string, string> = {
  HELP_AND_SUPPORT_SUPPORT_EMAIL: "it-help@acme.example",
  HELP_AND_SUPPORT_CHAT: "https://acme.slack.com/archives/C024BE91L",
  HELP_AND_SUPPORT_GITHUB: "false",
};

let row: Row;
let seeding: TestSeeding;
let forget: ReturnType<typeof jest.spyOn>;

// A start of the server, with the configuration it was started with.
const start: (
  environment: Record<string, string | undefined>,
) => Promise<HelpAndSupportSeedOutcome> = async (
  environment: Record<string, string | undefined>,
): Promise<HelpAndSupportSeedOutcome> => {
  seeding = new TestSeeding(row);
  seeding.environment = environment;
  return await seeding.seed();
};

const held: () => HelpAndSupportSettings = (): HelpAndSupportSettings => {
  return readHelpAndSupportSettings(row.helpAndSupport);
};

const logged: (mock: LogMock) => string = (mock: LogMock): string => {
  return mock.mock.calls
    .map((call: Array<unknown>): string => {
      return String(call[0]);
    })
    .join("\n");
};

beforeEach(() => {
  row = { exists: true, helpAndSupport: null, failNextWrite: false };
  forget = jest.spyOn(HelpAndSupportServerSettings, "forget");
  for (const mock of Object.values(loggerMock)) {
    mock.mockClear();
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a server's first start", () => {
  test("seeds the settings from its configuration, checked as the page checks them", async () => {
    expect(await start(CONFIGURATION)).toBe(HelpAndSupportSeedOutcome.Seeded);

    expect(held()[HelpItem.SupportEmail]).toEqual({
      choice: HelpChoice.Email,
      value: "it-help@acme.example",
    });
    expect(held()[HelpItem.Chat]).toEqual({
      choice: HelpChoice.Link,
      value: "https://acme.slack.com/archives/C024BE91L",
    });
    expect(held()[HelpItem.GitHub]).toEqual({
      choice: HelpChoice.Hidden,
      value: null,
    });
    expect(held()[HelpItem.RequestDemo].choice).toBe(HelpChoice.Default);
  });

  test("records which settings came from the configuration, for the page", async () => {
    await start(CONFIGURATION);

    expect(readSeededItems(row.helpAndSupport)).toEqual([
      HelpItem.SupportEmail,
      HelpItem.Chat,
      HelpItem.GitHub,
    ]);
  });

  test("says in the log what it set, by variable, and that the page holds them from now on", async () => {
    await start(CONFIGURATION);

    expect(logged(loggerMock.info)).toContain(
      "HELP_AND_SUPPORT_SUPPORT_EMAIL, HELP_AND_SUPPORT_CHAT, HELP_AND_SUPPORT_GITHUB",
    );
    expect(logged(loggerMock.info)).toContain("a restart never sets them back");
  });

  test("drops this server's copy, so its pages show the seeded settings at once", async () => {
    await start(CONFIGURATION);

    expect(forget).toHaveBeenCalledTimes(1);
  });

  test("with nothing configured, writes nothing and says nothing", async () => {
    expect(await start({})).toBe(HelpAndSupportSeedOutcome.NothingConfigured);
    expect(row.helpAndSupport).toBeNull();
    expect(seeding.writes).toEqual([]);
    expect(loggerMock.info).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  test("before its settings row is made, waits for the start that makes it", async () => {
    row.exists = false;

    expect(await start(CONFIGURATION)).toBe(
      HelpAndSupportSeedOutcome.NotReadyYet,
    );
    expect(seeding.writes).toEqual([]);

    row.exists = true;

    expect(await start(CONFIGURATION)).toBe(HelpAndSupportSeedOutcome.Seeded);
  });
});

describe("a restart", () => {
  test("keeps the change an admin made on the page", async () => {
    await start(CONFIGURATION);

    const page: TestPage = new TestPage(row);

    await page.save({
      item: HelpItem.SupportEmail,
      setting: { choice: HelpChoice.Email, value: "desk@acme.example" },
    });

    expect(await start(CONFIGURATION)).toBe(
      HelpAndSupportSeedOutcome.AlreadySaved,
    );
    expect(held()[HelpItem.SupportEmail]).toEqual({
      choice: HelpChoice.Email,
      value: "desk@acme.example",
    });
    // The setting is the admin's own now; the others are still the seed's.
    expect(readSeededItems(row.helpAndSupport)).toEqual([
      HelpItem.Chat,
      HelpItem.GitHub,
    ]);
  });

  test("keeps a setting an admin put back on OneUptime's default", async () => {
    await start(CONFIGURATION);

    await new TestPage(row).save({
      item: HelpItem.GitHub,
      setting: { choice: HelpChoice.Default, value: null },
    });

    await start(CONFIGURATION);

    expect(held()[HelpItem.GitHub].choice).toBe(HelpChoice.Default);
  });

  test("keeps every setting an admin put back, though nothing is left off its default", async () => {
    await start(CONFIGURATION);

    const page: TestPage = new TestPage(row);

    for (const item of [
      HelpItem.SupportEmail,
      HelpItem.Chat,
      HelpItem.GitHub,
    ]) {
      await page.save({
        item: item,
        setting: { choice: HelpChoice.Default, value: null },
      });
    }

    expect(row.helpAndSupport).toEqual({});

    expect(await start(CONFIGURATION)).toBe(
      HelpAndSupportSeedOutcome.AlreadySaved,
    );
    expect(row.helpAndSupport).toEqual({});
  });

  test("with the same configuration, writes nothing and has nothing to say", async () => {
    await start(CONFIGURATION);
    loggerMock.info.mockClear();

    expect(await start(CONFIGURATION)).toBe(
      HelpAndSupportSeedOutcome.AlreadySaved,
    );
    expect(seeding.writes).toEqual([]);
    expect(loggerMock.info).not.toHaveBeenCalled();
  });

  test("with a value changed in the configuration later, applies nothing and says where it changes", async () => {
    await start(CONFIGURATION);
    loggerMock.info.mockClear();

    expect(
      await start({
        ...CONFIGURATION,
        HELP_AND_SUPPORT_SUPPORT_EMAIL: "new-desk@acme.example",
      }),
    ).toBe(HelpAndSupportSeedOutcome.AlreadySaved);

    expect(held()[HelpItem.SupportEmail].value).toBe("it-help@acme.example");
    expect(logged(loggerMock.info)).toContain(
      "HELP_AND_SUPPORT_SUPPORT_EMAIL in this server's configuration differ",
    );
    expect(logged(loggerMock.info)).toContain("Change them on that page.");
  });

  test("of a server whose page was saved before any value was set seeds nothing", async () => {
    row.helpAndSupport = { requestDemo: { choice: "hidden" } };

    expect(await start(CONFIGURATION)).toBe(
      HelpAndSupportSeedOutcome.AlreadySaved,
    );
    expect(row.helpAndSupport).toEqual({ requestDemo: { choice: "hidden" } });
  });

  test("of a server never saved, with a value set since, seeds it then", async () => {
    expect(await start({})).toBe(HelpAndSupportSeedOutcome.NothingConfigured);
    expect(await start(CONFIGURATION)).toBe(HelpAndSupportSeedOutcome.Seeded);
  });
});

describe("a value the page would refuse", () => {
  test("is left out, said in the log by its variable, and the rest are seeded", async () => {
    expect(
      await start({
        ...CONFIGURATION,
        HELP_AND_SUPPORT_HELP_LINK: "javascript:alert(document.cookie)",
        HELP_AND_SUPPORT_MOBILE_APP: "data:text/html,<script>alert(1)</script>",
      }),
    ).toBe(HelpAndSupportSeedOutcome.Seeded);

    expect(held()[HelpItem.HelpLink].choice).toBe(HelpChoice.Default);
    expect(held()[HelpItem.MobileApp].choice).toBe(HelpChoice.Default);
    expect(held()[HelpItem.SupportEmail].value).toBe("it-help@acme.example");
    expect(JSON.stringify(row.helpAndSupport)).not.toContain("javascript");
    expect(JSON.stringify(row.helpAndSupport)).not.toContain("data:");

    expect(logged(loggerMock.warn)).toContain(
      `HELP_AND_SUPPORT_HELP_LINK in this server's configuration was not used for Admin Dashboard > Settings > Help and Support: ${HelpAndSupportProblems.linkScheme}`,
    );
    expect(logged(loggerMock.warn)).toContain("HELP_AND_SUPPORT_MOBILE_APP");
  });

  test("alone, writes nothing, so the fixed value seeds at the next start", async () => {
    expect(await start({ HELP_AND_SUPPORT_CHAT: "javascript:alert(1)" })).toBe(
      HelpAndSupportSeedOutcome.NothingConfigured,
    );
    expect(row.helpAndSupport).toBeNull();

    expect(
      await start({
        HELP_AND_SUPPORT_CHAT: "https://acme.slack.com/archives/C1",
      }),
    ).toBe(HelpAndSupportSeedOutcome.Seeded);
    expect(held()[HelpItem.Chat].value).toBe(
      "https://acme.slack.com/archives/C1",
    );
  });

  test("markup in the sign-in message is refused, never stored", async () => {
    await start({
      HELP_AND_SUPPORT_INVITE_MESSAGE: '<img src=x onerror="alert(1)">',
      HELP_AND_SUPPORT_SUPPORT_EMAIL: "it-help@acme.example",
    });

    expect(held()[HelpItem.InviteMessage].choice).toBe(HelpChoice.Default);
    expect(JSON.stringify(row.helpAndSupport)).not.toContain("<img");
    expect(logged(loggerMock.warn)).toContain(HelpAndSupportProblems.textHtml);
  });

  test("is said at every start while it stays in the configuration", async () => {
    await start({ HELP_AND_SUPPORT_CHAT: "javascript:alert(1)" });
    await start({ HELP_AND_SUPPORT_CHAT: "javascript:alert(1)" });

    expect(loggerMock.warn).toHaveBeenCalledTimes(2);
  });
});

describe("several servers starting at once", () => {
  test("one seeds, and the others find it seeded and write nothing", async () => {
    const first: TestSeeding = new TestSeeding(row);
    const second: TestSeeding = new TestSeeding(row);

    first.environment = CONFIGURATION;
    second.environment = CONFIGURATION;

    const outcomes: Array<HelpAndSupportSeedOutcome> = await Promise.all([
      first.seed(),
      second.seed(),
    ]);

    expect(outcomes.sort()).toEqual(
      [
        HelpAndSupportSeedOutcome.AlreadySaved,
        HelpAndSupportSeedOutcome.Seeded,
      ].sort(),
    );
    expect(first.writes.length + second.writes.length).toBe(1);
  });

  test("an admin's save between the read and the write is never overwritten", async () => {
    const racing: TestSeeding = new TestSeeding(row);

    racing.environment = CONFIGURATION;
    jest
      .spyOn(racing, "readStored")
      .mockImplementationOnce(async (): Promise<unknown> => {
        // Read as nothing saved; the admin saves before the write lands.
        row.helpAndSupport = { chat: { choice: "hidden" } };
        return null;
      });

    expect(await racing.seed()).toBe(HelpAndSupportSeedOutcome.AlreadySaved);
    expect(row.helpAndSupport).toEqual({ chat: { choice: "hidden" } });
  });
});

describe("a start the database fails", () => {
  test("is never held up: it says so and tries again at the next start", async () => {
    row.failNextWrite = true;

    expect(await start(CONFIGURATION)).toBe(HelpAndSupportSeedOutcome.Failed);
    expect(logged(loggerMock.error)).toContain("it is tried again");
    expect(row.helpAndSupport).toBeNull();

    expect(await start(CONFIGURATION)).toBe(HelpAndSupportSeedOutcome.Seeded);
  });
});

describe("what the page is told was refused", () => {
  test("the configuration's refused values, by setting", () => {
    const told: HelpAndSupportSeedingClass = new TestSeeding(row);

    (told as TestSeeding).environment = {
      HELP_AND_SUPPORT_CHAT: "javascript:alert(1)",
      HELP_AND_SUPPORT_SUPPORT_EMAIL: "it-help@acme.example",
    };

    expect(told.getProblems()).toEqual([
      {
        item: HelpItem.Chat,
        variable: "HELP_AND_SUPPORT_CHAT",
        problem: HelpAndSupportProblems.linkScheme,
      },
    ]);
  });

  test("nothing for a configuration with nothing refused", () => {
    const told: TestSeeding = new TestSeeding(row);

    told.environment = CONFIGURATION;

    expect(told.getProblems()).toEqual([]);
  });

  test("the record of the seed is never a setting the page shows", async () => {
    await start(CONFIGURATION);

    expect(row.helpAndSupport).toHaveProperty(SEEDED_ITEMS_KEY);
    expect(Object.keys(held())).not.toContain(SEEDED_ITEMS_KEY);
  });
});
