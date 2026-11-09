/**
 * @timezone UTC
 */
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000063");
      },
    },
  };
});

import {
  RUM_REFUSAL_KIND_OF_SURFACE,
  RumKindRefusal,
  RumRefusalApp,
  getRumKindRefusal,
  isIngestRefusalForRumApp,
  isIngestRefusalOwnedByRumApp,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumIngestRefusals";
import {
  RUM_SETUP_CHECK_RECENT_WINDOW_MS,
  RUM_SIGNAL_STAMP_TOLERANCE_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalDiagnosis";
import { getRumActionRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumRefusalRoutes";
import {
  IngestRefusalFact,
  toIngestRefusalFact,
  toIngestRefusalFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestRefusalFacts";
import { getIngestRefusalFixRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestRefusalRoutes";
import {
  INGEST_REFUSAL_FIXES,
  INGEST_REFUSAL_FIX_LABELS,
  INGEST_SURFACE_LABELS,
  REFUSAL_REASON_WORDS,
  getIngestRefusalCountText,
  getIngestRefusalReasonText,
  getIngestSurfaceLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestRefusalWords";
import TelemetryIngestionKeyRefusal from "../../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import ObjectID from "../../../Types/ObjectID";
import {
  ALL_TELEMETRY_INGEST_REFUSAL_REASONS,
  PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS,
  TelemetryIngestRefusalReason,
  UNNAMED_TELEMETRY_INGEST_SURFACE,
} from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * WHETHER A RUM APPLICATION'S TELEMETRY IS BEING REFUSED, AND HOW IT IS
 * SAID (issue #6378).
 *
 * A refusal belongs to a key, not an app - the guards refuse before the
 * payload is read - so the setup check decides which refusals speak for an
 * app, and whether they explain what it sends of a kind. The rule that
 * matters most in a busy project: a shared Browser key's refusals explain
 * only an app whose telemetry stopped, never one whose telemetry arrives -
 * else every healthy browser app would wear another app's warning.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-11-09T12:00:00.000Z");
const KEY_ID: string = "6c3d0000-0000-4000-8000-0000000000a1";

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function fact(overrides: Partial<IngestRefusalFact> = {}): IngestRefusalFact {
  return {
    keyId: KEY_ID,
    keyName: "Storefront browser key",
    keyType: TelemetryIngestionKeyType.Browser,
    pinnedServiceName: null,
    reason: TelemetryIngestRefusalReason.KeyDisabled,
    surface: TelemetryIngestSurface.OtelTraces,
    count: 12,
    firstRefusedAt: ago(3 * HOUR),
    lastRefusedAt: ago(30 * MINUTE),
    ...overrides,
  };
}

const BROWSER_APP: RumRefusalApp = {
  client: "browser",
  appIdentifier: "storefront-web",
};

const MOBILE_APP: RumRefusalApp = {
  client: "mobile",
  appIdentifier: "storefront-ios",
};

function refusalOf(data: {
  refusals: Array<IngestRefusalFact> | null;
  lastArrivalAt: Date | null;
  app?: RumRefusalApp;
  kind?: "traces" | "logs" | "metrics" | "sessionReplay";
}): RumKindRefusal | null {
  return getRumKindRefusal({
    refusals: data.refusals,
    kind: data.kind || "traces",
    lastArrivalAt: data.lastArrivalAt,
    app: data.app || BROWSER_APP,
    now: NOW,
  });
}

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function localeTranslator(language: string): Translator {
  const words: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

const ENGLISH: Translator = createTranslator(undefined, "en");

describe("which refusals speak for an application", () => {
  test.each(Array.from(PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS))(
    "%s holds for every key of the project: any app's, browser or mobile, and its own",
    (reason: TelemetryIngestRefusalReason) => {
      const projectWide: IngestRefusalFact = fact({
        reason,
        keyType: TelemetryIngestionKeyType.Server,
      });

      for (const app of [BROWSER_APP, MOBILE_APP]) {
        expect(isIngestRefusalForRumApp(projectWide, app)).toBe(true);
        expect(isIngestRefusalOwnedByRumApp(projectWide, app)).toBe(true);
      }
    },
  );

  test("a key pinned to the app speaks for it, and is its own; pinned to another app, for nobody else", () => {
    const pinned: IngestRefusalFact = fact({
      keyType: TelemetryIngestionKeyType.Server,
      pinnedServiceName: "storefront-ios",
    });

    expect(isIngestRefusalForRumApp(pinned, MOBILE_APP)).toBe(true);
    expect(isIngestRefusalOwnedByRumApp(pinned, MOBILE_APP)).toBe(true);
    expect(isIngestRefusalForRumApp(pinned, BROWSER_APP)).toBe(false);
    expect(isIngestRefusalOwnedByRumApp(pinned, BROWSER_APP)).toBe(false);

    // An app with no service.name is no key's.
    expect(
      isIngestRefusalForRumApp(pinned, {
        client: "mobile",
        appIdentifier: null,
      }),
    ).toBe(false);
  });

  test("an unpinned Browser key speaks for browser apps, and is none of theirs: pages share it", () => {
    const shared: IngestRefusalFact = fact();

    expect(isIngestRefusalForRumApp(shared, BROWSER_APP)).toBe(true);
    expect(isIngestRefusalOwnedByRumApp(shared, BROWSER_APP)).toBe(false);
    expect(isIngestRefusalForRumApp(shared, MOBILE_APP)).toBe(false);
  });

  test("an unpinned Server key, or one whose type could not be read, speaks for no app: backends send with it too", () => {
    for (const keyType of [TelemetryIngestionKeyType.Server, null]) {
      const unpinned: IngestRefusalFact = fact({ keyType });

      expect(isIngestRefusalForRumApp(unpinned, BROWSER_APP)).toBe(false);
      expect(isIngestRefusalForRumApp(unpinned, MOBILE_APP)).toBe(false);
    }
  });
});

describe("whether what an app sends of a kind is refused", () => {
  test("nothing ever arrived, and it was refused: refused", () => {
    expect(refusalOf({ refusals: [fact()], lastArrivalAt: null })).toEqual({
      state: "refused",
      refusal: fact(),
    });
  });

  test("it last arrived well before the latest refusal: refused", () => {
    expect(
      refusalOf({ refusals: [fact()], lastArrivalAt: ago(5 * HOUR) })?.state,
    ).toBe("refused");
  });

  test("it arrives around the refusals: partly refused, when the refusal is the app's own", () => {
    const ownLimit: IngestRefusalFact = fact({
      reason: TelemetryIngestRefusalReason.ProjectIngestionRate,
    });

    expect(
      refusalOf({ refusals: [ownLimit], lastArrivalAt: ago(25 * MINUTE) }),
    ).toEqual({ state: "partly-refused", refusal: ownLimit });

    // Stamps a little apart either way still read as around the same time.
    expect(
      refusalOf({
        refusals: [ownLimit],
        lastArrivalAt: new Date(
          ownLimit.lastRefusedAt.getTime() - RUM_SIGNAL_STAMP_TOLERANCE_MS + 1,
        ),
      })?.state,
    ).toBe("partly-refused");
  });

  test("a busy project: a shared Browser key's refusals say nothing beside an app whose telemetry arrives", () => {
    expect(
      refusalOf({ refusals: [fact()], lastArrivalAt: ago(2 * MINUTE) }),
    ).toBeNull();
  });

  test("partly refused explains the app's own refusal, not a newer shared one", () => {
    const shared: IngestRefusalFact = fact({ lastRefusedAt: ago(10 * MINUTE) });
    const own: IngestRefusalFact = fact({
      reason: TelemetryIngestRefusalReason.ProjectDailyBudget,
      lastRefusedAt: ago(20 * MINUTE),
    });

    expect(
      refusalOf({ refusals: [shared, own], lastArrivalAt: ago(15 * MINUTE) }),
    ).toEqual({ state: "partly-refused", refusal: own });
  });

  test("arriving well after the latest refusal: put right, nothing said", () => {
    const own: IngestRefusalFact = fact({
      reason: TelemetryIngestRefusalReason.PaymentRequired,
      lastRefusedAt: ago(3 * HOUR),
    });

    expect(
      refusalOf({ refusals: [own], lastArrivalAt: ago(MINUTE) }),
    ).toBeNull();
  });

  test("only the past day counts, the setup check's window", () => {
    const old: IngestRefusalFact = fact({
      lastRefusedAt: ago(RUM_SETUP_CHECK_RECENT_WINDOW_MS + MINUTE),
    });

    expect(refusalOf({ refusals: [old], lastArrivalAt: null })).toBeNull();
    expect(RUM_SETUP_CHECK_RECENT_WINDOW_MS).toBe(DAY);
  });

  test("a refusal on one kind speaks for that kind only", () => {
    const logs: IngestRefusalFact = fact({
      surface: TelemetryIngestSurface.OtelLogs,
    });

    expect(refusalOf({ refusals: [logs], lastArrivalAt: null })).toBeNull();
    expect(
      refusalOf({ refusals: [logs], lastArrivalAt: null, kind: "logs" })?.state,
    ).toBe("refused");

    expect(RUM_REFUSAL_KIND_OF_SURFACE).toEqual({
      [TelemetryIngestSurface.OtelTraces]: "traces",
      [TelemetryIngestSurface.OtelLogs]: "logs",
      [TelemetryIngestSurface.OtelMetrics]: "metrics",
      [TelemetryIngestSurface.SessionReplay]: "sessionReplay",
    });

    // Another endpoint's refusal is no RUM kind's.
    expect(
      refusalOf({
        refusals: [
          fact({
            surface: TelemetryIngestSurface.Syslog,
            reason: TelemetryIngestRefusalReason.PaymentRequired,
          }),
        ],
        lastArrivalAt: null,
      }),
    ).toBeNull();
  });

  test("the latest refusal is explained; on the same instant, the reason listed first", () => {
    const at: Date = ago(5 * MINUTE);
    const overLimit: IngestRefusalFact = fact({
      reason: TelemetryIngestRefusalReason.KeyRequestsPerMinute,
      lastRefusedAt: at,
    });
    const switchedOff: IngestRefusalFact = fact({ lastRefusedAt: at });
    const older: IngestRefusalFact = fact({
      reason: TelemetryIngestRefusalReason.KeyExpired,
      lastRefusedAt: ago(HOUR),
    });

    expect(
      refusalOf({
        refusals: [older, overLimit, switchedOff],
        lastArrivalAt: null,
      })?.refusal,
    ).toBe(switchedOff);
  });

  test("nothing read yet, a read that failed, nothing refused: nothing said", () => {
    expect(refusalOf({ refusals: null, lastArrivalAt: null })).toBeNull();
    expect(refusalOf({ refusals: [], lastArrivalAt: null })).toBeNull();
  });

  test("an arrival stamp that is no date is read as none", () => {
    expect(
      refusalOf({ refusals: [fact()], lastArrivalAt: new Date("nonsense") })
        ?.state,
    ).toBe("refused");
  });

  test("a mobile app is told of its pinned key, not of a shared Browser key", () => {
    const pinnedMobile: IngestRefusalFact = fact({
      keyType: TelemetryIngestionKeyType.Server,
      pinnedServiceName: "storefront-ios",
      reason: TelemetryIngestRefusalReason.KeyExpired,
    });

    expect(
      refusalOf({
        refusals: [fact(), pinnedMobile],
        lastArrivalAt: null,
        app: MOBILE_APP,
      })?.refusal,
    ).toBe(pinnedMobile);
    expect(
      refusalOf({ refusals: [fact()], lastArrivalAt: null, app: MOBILE_APP }),
    ).toBeNull();
  });
});

describe("a refusal row as the Dashboard reads it", () => {
  function row(values: Record<string, unknown>): TelemetryIngestionKeyRefusal {
    return values as unknown as TelemetryIngestionKeyRefusal;
  }

  const complete: Record<string, unknown> = {
    reason: "origin-not-allowed",
    surface: "otel-logs",
    refusedCount: 7,
    firstRefusedAt: "2026-11-09T09:00:00.000Z",
    lastRefusedAt: "2026-11-09T11:00:00.000Z",
    telemetryIngestionKeyId: new ObjectID(KEY_ID),
    telemetryIngestionKey: {
      name: "Storefront browser key",
      keyType: "Browser",
      pinnedServiceName: "storefront-web",
    },
  };

  test("its reason, surface, count, times and key", () => {
    expect(toIngestRefusalFact(row(complete))).toEqual({
      keyId: KEY_ID,
      keyName: "Storefront browser key",
      keyType: TelemetryIngestionKeyType.Browser,
      pinnedServiceName: "storefront-web",
      reason: TelemetryIngestRefusalReason.OriginNotAllowed,
      surface: "otel-logs",
      count: 7,
      firstRefusedAt: new Date("2026-11-09T09:00:00.000Z"),
      lastRefusedAt: new Date("2026-11-09T11:00:00.000Z"),
    });
  });

  test("a key that could not be read leaves its name and type unknown", () => {
    expect(
      toIngestRefusalFact(
        row({ ...complete, telemetryIngestionKey: undefined }),
      ),
    ).toEqual(
      expect.objectContaining({
        keyName: null,
        keyType: null,
        pinnedServiceName: null,
      }),
    );
  });

  test("a reason it does not know, no latest time or no key: the row is skipped", () => {
    expect(
      toIngestRefusalFacts([
        row({ ...complete, reason: "some-future-reason" }),
        row({ ...complete, lastRefusedAt: undefined }),
        row({ ...complete, lastRefusedAt: "not a date" }),
        row({ ...complete, telemetryIngestionKeyId: undefined }),
        row(complete),
      ]),
    ).toHaveLength(1);
  });

  test("a count it cannot read is one; a first time it cannot read is the latest", () => {
    expect(
      toIngestRefusalFact(
        row({ ...complete, refusedCount: "many", firstRefusedAt: undefined }),
      ),
    ).toEqual(
      expect.objectContaining({
        count: 1,
        firstRefusedAt: new Date("2026-11-09T11:00:00.000Z"),
      }),
    );
  });
});

describe("what a refusal says", () => {
  test("every reason has its sentence, a fix (or none) and every fix a label", () => {
    expect(Object.keys(REFUSAL_REASON_WORDS).sort()).toEqual(
      [...ALL_TELEMETRY_INGEST_REFUSAL_REASONS].sort(),
    );
    expect(Object.keys(INGEST_REFUSAL_FIXES).sort()).toEqual(
      [...ALL_TELEMETRY_INGEST_REFUSAL_REASONS].sort(),
    );
    expect(INGEST_REFUSAL_FIX_LABELS).toEqual({
      "pick-key": "Pick another key",
      "open-key": "Open the key",
      budgets: "See budgets",
      billing: "Add a payment method",
    });
  });

  test("the fix is the one thing that puts each reason right", () => {
    expect(INGEST_REFUSAL_FIXES).toEqual({
      [TelemetryIngestRefusalReason.KeyDisabled]: "pick-key",
      [TelemetryIngestRefusalReason.KeyExpired]: "pick-key",
      [TelemetryIngestRefusalReason.OriginNotAllowed]: "open-key",
      [TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere]: null,
      [TelemetryIngestRefusalReason.PinnedKeyNotAllowedHere]: null,
      [TelemetryIngestRefusalReason.KeyRequestsPerMinute]: "open-key",
      [TelemetryIngestRefusalReason.KeyDailyBudget]: "open-key",
      [TelemetryIngestRefusalReason.KeyIngestionRate]: "open-key",
      [TelemetryIngestRefusalReason.ProjectDailyBudget]: "budgets",
      [TelemetryIngestRefusalReason.ProjectIngestionRate]: "budgets",
      [TelemetryIngestRefusalReason.PaymentRequired]: "billing",
      [TelemetryIngestRefusalReason.ProjectBlocked]: null,
    });
  });

  test("the reason names the key, by its name or else its id", () => {
    expect(getIngestRefusalReasonText(fact(), ENGLISH)).toBe(
      'The key "Storefront browser key" is turned off, so everything sent with it is refused.',
    );
    expect(getIngestRefusalReasonText(fact({ keyName: null }), ENGLISH)).toBe(
      `The key "${KEY_ID}" is turned off, so everything sent with it is refused.`,
    );
    expect(
      getIngestRefusalReasonText(
        fact({ reason: TelemetryIngestRefusalReason.PaymentRequired }),
        ENGLISH,
      ),
    ).toBe("This project has no payment method, so its telemetry is refused.");
  });

  test("in German, from the Dashboard's own locale", () => {
    expect(getIngestRefusalReasonText(fact(), localeTranslator("de"))).toBe(
      "Der Schlüssel „Storefront browser key“ ist ausgeschaltet, daher wird alles abgelehnt, was damit gesendet wird.",
    );
    expect(
      getIngestRefusalReasonText(
        fact({ reason: TelemetryIngestRefusalReason.ProjectDailyBudget }),
        localeTranslator("de"),
      ),
    ).not.toBe("This project used up its daily ingestion budget.");
  });

  test("in Persian, the key's Latin name is set apart from the right-to-left sentence", () => {
    const persian: string = getIngestRefusalReasonText(
      fact(),
      localeTranslator("fa"),
    );

    expect(persian).toContain(
      `${FIRST_STRONG_ISOLATE}Storefront browser key${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(persian).not.toContain("turned off");
  });

  test("how many and when: one request, many, and the plural's other languages", () => {
    const one: IngestRefusalFact = fact({
      count: 1,
      firstRefusedAt: ago(10 * MINUTE),
      lastRefusedAt: ago(10 * MINUTE),
    });
    const many: IngestRefusalFact = fact({
      count: 1234,
      firstRefusedAt: new Date("2026-11-09T08:00:00.000Z"),
      lastRefusedAt: ago(10 * MINUTE),
    });

    expect(getIngestRefusalCountText(one, ENGLISH, NOW)).toBe(
      "One request refused 10 minutes ago.",
    );
    expect(getIngestRefusalCountText(many, ENGLISH, NOW)).toBe(
      "1,234 requests refused since Nov 09 2026, 08:00 AM GMT, the latest 10 minutes ago.",
    );

    // Two days or more back, the date alone.
    expect(
      getIngestRefusalCountText(
        fact({ count: 2, firstRefusedAt: ago(5 * DAY) }),
        ENGLISH,
        NOW,
      ),
    ).toBe(
      getIngestRefusalCountText(
        fact({ count: 2, firstRefusedAt: ago(5 * DAY - HOUR) }),
        ENGLISH,
        NOW,
      ),
    );

    // Russian's "one" form serves 21 too, and still says since when.
    const russian: string = getIngestRefusalCountText(
      fact({ count: 21 }),
      localeTranslator("ru"),
      NOW,
    );
    expect(russian).toMatch(/^21 запрос отклонён с .+, последний — .+\.$/);

    // ... and its "other" form 5.
    expect(
      getIngestRefusalCountText(
        fact({ count: 5 }),
        localeTranslator("ru"),
        NOW,
      ),
    ).toMatch(/^Отклонено запросов с .+: 5, последний — .+\.$/);
  });

  test("where: every ingest surface is named, and the legacy guard is other endpoints", () => {
    for (const surface of Object.values(TelemetryIngestSurface)) {
      expect({
        surface,
        named: Boolean(INGEST_SURFACE_LABELS[surface]),
      }).toEqual({ surface, named: true });
    }

    expect(getIngestSurfaceLabel(TelemetryIngestSurface.Grpc, ENGLISH)).toBe(
      "OTLP over gRPC",
    );
    expect(
      getIngestSurfaceLabel(UNNAMED_TELEMETRY_INGEST_SURFACE, ENGLISH),
    ).toBe("Other endpoints");
    expect(getIngestSurfaceLabel("a-surface-from-later", ENGLISH)).toBe(
      "Other endpoints",
    );
  });
});

describe("where a fix takes the reader", () => {
  test("the key's own page, the project's usage and budgets, Billing; a dialog is no page", () => {
    expect(
      getIngestRefusalFixRoute({ fix: "open-key", keyId: KEY_ID })?.toString(),
    ).toBe(
      `/dashboard/10000000-0000-4000-8000-000000000063/settings/telemetry-ingestion-keys/${KEY_ID}`,
    );
    expect(
      getIngestRefusalFixRoute({ fix: "budgets", keyId: null })?.toString(),
    ).toBe(
      "/dashboard/10000000-0000-4000-8000-000000000063/settings/usage-history",
    );
    expect(
      getIngestRefusalFixRoute({ fix: "billing", keyId: KEY_ID })?.toString(),
    ).toBe("/dashboard/10000000-0000-4000-8000-000000000063/settings/billing");
    expect(
      getIngestRefusalFixRoute({ fix: "pick-key", keyId: KEY_ID }),
    ).toBeNull();
    expect(
      getIngestRefusalFixRoute({ fix: "open-key", keyId: null }),
    ).toBeNull();
  });

  test("a RUM action links where its fix is, and nowhere for the rest", () => {
    expect(
      getRumActionRoute({
        kind: "open-key",
        label: "Open the key",
        keyId: KEY_ID,
      })?.toString(),
    ).toContain(`/settings/telemetry-ingestion-keys/${KEY_ID}`);
    expect(
      getRumActionRoute({
        kind: "billing",
        label: "Add a payment method",
      })?.toString(),
    ).toContain("/settings/billing");
    expect(
      getRumActionRoute({ kind: "pick-key", label: "Pick another key" }),
    ).toBeNull();
    expect(getRumActionRoute({ kind: "retry", label: "Try again" })).toBeNull();
  });
});
