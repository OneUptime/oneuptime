import { afterEach, describe, expect, jest, test } from "@jest/globals";
import logger from "Common/Server/Utils/Logger";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import MimeType from "Common/Types/File/MimeType";
import { WhiteLabelImageKind } from "../../../Server/WhiteLabel/WhiteLabelImages";
import {
  WhiteLabelProvider,
  WhiteLabelProviderDependencies,
} from "../../../Server/WhiteLabel/WhiteLabelProvider";
import {
  EMPTY_WHITE_LABEL_SETTINGS,
  WhiteLabelSettings,
} from "../../../Server/WhiteLabel/WhiteLabelSettings";
import { PNG_BYTES, SVG_TEXT } from "./WhiteLabelFixtures";

/*
 * The settings a process holds, and the branding it hands core.
 *
 * What these pin:
 *   - the license decides first, on every ask: while it does not allow
 *     white-labelling there is no branding at all, however much is stored -
 *     and when it allows it again the stored settings are back at once;
 *   - an installation that may white-label but has set nothing (or whose
 *     settings are not read yet) shows OneUptime's own ({});
 *   - settings are cached for the TTL, read again in the background once
 *     stale, at once after a write, and kept through a failed read.
 */

const UPDATED_AT: Date = new Date("2026-10-01T00:00:00.000Z");

const SETTINGS: WhiteLabelSettings = {
  productName: "Acme Monitoring",
  websiteUrl: "https://acme.example",
  logo: { type: MimeType.png, bytes: PNG_BYTES },
  darkLogo: { type: MimeType.svg, bytes: Buffer.from(SVG_TEXT) },
  favicon: null,
  updatedAt: UPDATED_AT,
};

interface Harness {
  provider: WhiteLabelProvider;
  clock: { now: Date };
  loads: { count: number };
  allowed: { value: boolean };
  setSettings: (settings: WhiteLabelSettings) => void;
  failLoadsWith: (error: Error | null) => void;
}

const createHarness: (
  initial: WhiteLabelSettings,
  overrides?: Partial<WhiteLabelProviderDependencies>,
) => Harness = (
  initial: WhiteLabelSettings,
  overrides?: Partial<WhiteLabelProviderDependencies>,
): Harness => {
  let current: WhiteLabelSettings = initial;
  let failure: Error | null = null;
  const clock: { now: Date } = { now: new Date("2026-10-08T12:00:00.000Z") };
  const loads: { count: number } = { count: 0 };
  const allowed: { value: boolean } = { value: true };

  const provider: WhiteLabelProvider = new WhiteLabelProvider({
    loadSettings: async (): Promise<WhiteLabelSettings> => {
      loads.count++;

      if (failure) {
        throw failure;
      }

      return current;
    },
    isAllowed: (): boolean => {
      return allowed.value;
    },
    now: (): Date => {
      return clock.now;
    },
    cacheTtlInMs: 30 * 1000,
    retryAfterFailureInMs: 5 * 1000,
    ...(overrides || {}),
  });

  return {
    provider,
    clock,
    loads,
    allowed,
    setSettings: (settings: WhiteLabelSettings): void => {
      current = settings;
    },
    failLoadsWith: (error: Error | null): void => {
      failure = error;
    },
  };
};

const advance: (harness: Harness, ms: number) => void = (
  harness: Harness,
  ms: number,
): void => {
  harness.clock.now = new Date(harness.clock.now.getTime() + ms);
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getProductBranding", () => {
  test("is the stored branding while the license allows it", async () => {
    const harness: Harness = createHarness(SETTINGS);

    await harness.provider.refresh();

    expect(harness.provider.getProductBranding()).toEqual({
      productName: "Acme Monitoring",
      websiteUrl: "https://acme.example",
      logoUrl: `/api/branding/logo?v=${UPDATED_AT.getTime()}`,
      darkLogoUrl: `/api/branding/dark-logo?v=${UPDATED_AT.getTime()}`,
      isLogoEmailSafe: true,
    });
  });

  test("is null while the license does not allow it, however much is stored", async () => {
    const harness: Harness = createHarness(SETTINGS);

    await harness.provider.refresh();
    harness.allowed.value = false;

    expect(harness.provider.getProductBranding()).toBeNull();
  });

  test("goes the moment the license loses the switch, and comes back with it - the settings are kept", async () => {
    const harness: Harness = createHarness(SETTINGS);

    await harness.provider.refresh();

    harness.allowed.value = false;
    expect(harness.provider.getProductBranding()).toBeNull();

    harness.allowed.value = true;
    expect(harness.provider.getProductBranding()?.productName).toBe(
      "Acme Monitoring",
    );
    // Nothing was read again to bring it back.
    expect(harness.loads.count).toBe(1);
  });

  test("is {} (OneUptime's own everywhere) when allowed and nothing is set", async () => {
    const harness: Harness = createHarness(EMPTY_WHITE_LABEL_SETTINGS);

    await harness.provider.refresh();

    expect(harness.provider.getProductBranding()).toEqual({});
  });

  test("is {} when allowed and the settings are not read yet, and starts reading them", async () => {
    const harness: Harness = createHarness(SETTINGS);

    expect(harness.provider.getProductBranding()).toEqual({});
    await settle();

    expect(harness.loads.count).toBe(1);
    expect(harness.provider.getProductBranding()?.productName).toBe(
      "Acme Monitoring",
    );
  });

  test("does not read the settings at all while the license does not allow it", () => {
    const harness: Harness = createHarness(SETTINGS);
    harness.allowed.value = false;

    expect(harness.provider.getProductBranding()).toBeNull();
    expect(harness.loads.count).toBe(0);
  });

  test("is null, never an error, when asking the license throws", () => {
    const harness: Harness = createHarness(SETTINGS, {
      isAllowed: (): boolean => {
        throw new Error("license unreadable");
      },
    });

    expect(harness.provider.getProductBranding()).toBeNull();
    expect(harness.provider.isAllowed()).toBe(false);
  });
});

describe("caching", () => {
  test("reads once within the TTL", async () => {
    const harness: Harness = createHarness(SETTINGS);

    await harness.provider.refresh();

    for (let index: number = 0; index < 20; index++) {
      harness.provider.getProductBranding();
      await harness.provider.getSettings();
    }

    advance(harness, 29 * 1000);
    harness.provider.getProductBranding();
    await settle();

    expect(harness.loads.count).toBe(1);
  });

  test("reads again in the background once stale, and serves the old settings meanwhile", async () => {
    const harness: Harness = createHarness(SETTINGS);

    await harness.provider.refresh();
    harness.setSettings({ ...SETTINGS, productName: "Acme Cloud" });
    advance(harness, 31 * 1000);

    expect(harness.provider.getProductBranding()?.productName).toBe(
      "Acme Monitoring",
    );

    await settle();

    expect(harness.loads.count).toBe(2);
    expect(harness.provider.getProductBranding()?.productName).toBe(
      "Acme Cloud",
    );
  });

  test("refresh() reads at once (a write in this process)", async () => {
    const harness: Harness = createHarness(SETTINGS);

    await harness.provider.refresh();
    harness.setSettings({ ...SETTINGS, productName: "Acme Cloud" });

    const refreshed: WhiteLabelSettings | null =
      await harness.provider.refresh();

    expect(refreshed?.productName).toBe("Acme Cloud");
    expect(harness.provider.getProductBranding()?.productName).toBe(
      "Acme Cloud",
    );
  });

  test("keeps the settings read earlier when a read fails, and waits before trying again", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    const harness: Harness = createHarness(SETTINGS);

    await harness.provider.refresh();
    harness.failLoadsWith(new Error("database is down"));
    advance(harness, 31 * 1000);

    expect(harness.provider.getProductBranding()?.productName).toBe(
      "Acme Monitoring",
    );
    await settle();
    expect(harness.loads.count).toBe(2);

    // Inside the back-off: no new read.
    advance(harness, 1000);
    harness.provider.getProductBranding();
    await settle();
    expect(harness.loads.count).toBe(2);

    // After it: read again, and recover.
    harness.failLoadsWith(null);
    advance(harness, 5 * 1000);
    harness.provider.getProductBranding();
    await settle();

    expect(harness.loads.count).toBe(3);
    expect(harness.provider.getProductBranding()?.productName).toBe(
      "Acme Monitoring",
    );
  });

  test("refresh() never throws; with nothing ever read, the settings stay unread", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    const harness: Harness = createHarness(SETTINGS);
    harness.failLoadsWith(new Error("database is down"));

    await expect(harness.provider.refresh()).resolves.toBeNull();
    expect(harness.provider.getCachedSettings()).toBeNull();
    expect(harness.provider.getProductBranding()).toEqual({});
  });

  test("an older read finishing after a newer one never overwrites it", async () => {
    let releaseFirst: (() => void) | null = null;
    let call: number = 0;
    const harness: Harness = createHarness(SETTINGS, {
      loadSettings: async (): Promise<WhiteLabelSettings> => {
        call++;

        if (call === 1) {
          await new Promise<void>((resolve: () => void) => {
            releaseFirst = resolve;
          });

          return { ...SETTINGS, productName: "Stale Name" };
        }

        return { ...SETTINGS, productName: "Fresh Name" };
      },
    });

    const first: Promise<WhiteLabelSettings | null> =
      harness.provider.refresh();
    await harness.provider.refresh();

    (releaseFirst as unknown as () => void)();
    await first;

    expect(harness.provider.getProductBranding()?.productName).toBe(
      "Fresh Name",
    );
  });
});

describe("getImage", () => {
  test("hands out the image that is set, and null for one that is not", async () => {
    const harness: Harness = createHarness(SETTINGS);

    expect(
      (await harness.provider.getImage(WhiteLabelImageKind.Logo))?.type,
    ).toBe(MimeType.png);
    expect(
      (await harness.provider.getImage(WhiteLabelImageKind.DarkLogo))?.type,
    ).toBe(MimeType.svg);
    expect(
      await harness.provider.getImage(WhiteLabelImageKind.Favicon),
    ).toBeNull();
  });
});

describe("the branding core is handed", () => {
  test("is plain data core can sanitize: only the documented fields", async () => {
    const harness: Harness = createHarness(SETTINGS);

    await harness.provider.refresh();

    const branding: ProductBranding | null =
      harness.provider.getProductBranding();

    expect(Object.keys(branding || {}).sort()).toEqual(
      [
        "darkLogoUrl",
        "isLogoEmailSafe",
        "logoUrl",
        "productName",
        "websiteUrl",
      ].sort(),
    );
  });
});
