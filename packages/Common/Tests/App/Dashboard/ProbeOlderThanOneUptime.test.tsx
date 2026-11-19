import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { UPDATE_A_PROBE_DOCS_PATH } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/OneTimeCodeProbes";
import ProbeVersionElement, {
  PROBE_MISSED_FEATURE_TEST_IDS,
  PROBE_OLDER_THAN_SERVER_TEST_ID,
  PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID,
  PROBE_UPDATE_AVAILABLE_TEST_ID,
  PROBE_UPDATE_DOCS_TEST_ID,
  PROBE_UPDATE_TEST_ID,
  PROBE_VERSION_TEST_ID,
  ProbeVersionVariant,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeVersion";
import {
  PROBE_MISSED_FEATURE_COPY,
  PROBE_UPDATE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeUpdateCopy";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import { ProbeFeature } from "../../../Types/Probe/ProbeReportedVersion";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CUSTOM PROBE OLDER THAN THE ONEUPTIME IT REPORTS TO, SAID ON ITS PAGE AND
 * IN CUSTOM PROBES (OneUptime issue #9815).
 *
 * Under the probe's version, on its page: that it is older than this
 * OneUptime, by OneUptime's release; what it cannot do until it is updated
 * (a probe older than 17.0.1 makes no one-time codes); and one link to the
 * docs that say how to update a probe. In a row of Custom Probes: "Update
 * available: 17.2.0", linked to the same docs.
 *
 * Releases are compared by their numbers alone: a test build of OneUptime's
 * own release is level, and main's 17.0.0-test build, which made one-time
 * codes before the 17.0.0 release did not (#9778), is never said to miss
 * them. Nothing is flagged while OneUptime runs a test build or knows no
 * release of its own, nor ever for a global probe.
 *
 * Drawn with the real component and every Dashboard locale.
 */

const SERVER: string = "17.2.0";
const CONNECTED_AT: Date = new Date("2026-11-19T10:00:00.000Z");

const OLDER_SENTENCE: string = `Older than OneUptime ${SERVER}, which it reports to. Update the probe to get the latest checks and fixes.`;
const ONE_TIME_CODES_SENTENCE: string =
  "Too old to make one-time codes. Monitors that use a one-time code secret fail their check on this probe until it is updated.";

function probe(data: {
  reportedVersion?: string | undefined;
  isConnected?: boolean | undefined;
  isGlobalProbe?: boolean | undefined;
}): Probe {
  const item: Probe = new Probe(
    new ObjectID("c0c0c0c0-0000-4000-8000-00000000000c"),
  );
  item.name = "Office probe";

  if (data.reportedVersion) {
    item.reportedVersion = data.reportedVersion;
  }

  if (data.isConnected !== false) {
    item.lastAlive = CONNECTED_AT;
  }

  if (data.isGlobalProbe) {
    item.isGlobalProbe = true;
  }

  return item;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function draw(
  item: Probe,
  serverVersion: string = SERVER,
  variant: ProbeVersionVariant = "detail",
): Promise<void> {
  const element: ReactElement = (
    <ProbeVersionElement
      probe={item}
      serverVersion={serverVersion}
      variant={variant}
    />
  );

  render(<MemoryRouter>{element}</MemoryRouter>);

  await act(async () => {
    await Promise.resolve();
  });
}

function textOf(testId: string): string {
  return withoutIsolateMarks(screen.getByTestId(testId).textContent || "");
}

describe("the probe's page", () => {
  test("a probe on an older release is older than OneUptime, by OneUptime's release, with how to update it", async () => {
    await draw(probe({ reportedVersion: "17.1.4" }));

    expect(textOf(PROBE_VERSION_TEST_ID)).toContain("17.1.4");
    expect(textOf(PROBE_OLDER_THAN_SERVER_TEST_ID)).toBe(OLDER_SENTENCE);
    // It makes one-time codes: it misses nothing it is told it misses.
    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).not.toBeInTheDocument();

    const docs: Array<HTMLElement> = screen.getAllByTestId(
      PROBE_UPDATE_DOCS_TEST_ID,
    );

    expect(docs).toHaveLength(1);
    expect(docs[0]!.getAttribute("href")).toContain(UPDATE_A_PROBE_DOCS_PATH);
    expect(docs[0]!.getAttribute("target")).toBe("_blank");
    expect(docs[0]).toHaveTextContent("How to update a custom probe");
  });

  test.each([
    ["says no release", undefined],
    ["runs a release older than 17.0.1", "16.0.0"],
  ])(
    "a probe that %s is older than OneUptime, and cannot make one-time codes, with one link for both",
    async (_label: string, reportedVersion: string | undefined) => {
      await draw(probe({ reportedVersion }));

      expect(textOf(PROBE_OLDER_THAN_SERVER_TEST_ID)).toBe(OLDER_SENTENCE);
      expect(textOf(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID)).toBe(
        ONE_TIME_CODES_SENTENCE,
      );
      expect(screen.getAllByTestId(PROBE_UPDATE_DOCS_TEST_ID)).toHaveLength(1);

      // OneUptime's release first, then what the probe misses.
      const update: string = textOf(PROBE_UPDATE_TEST_ID);
      expect(update.indexOf(OLDER_SENTENCE)).toBeLessThan(
        update.indexOf(ONE_TIME_CODES_SENTENCE),
      );
    },
  );

  test("main's 17.0.0-test build is older than OneUptime, and is not said to miss one-time codes, which it makes", async () => {
    await draw(probe({ reportedVersion: "17.0.0-test" }));

    expect(textOf(PROBE_VERSION_TEST_ID)).toContain("17.0.0-test");
    expect(textOf(PROBE_OLDER_THAN_SERVER_TEST_ID)).toBe(OLDER_SENTENCE);
    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test.each([
    ["OneUptime's own release", "17.2.0"],
    ["a test build of OneUptime's own release", "17.2.0-test"],
    ["a later release than OneUptime's", "18.0.0"],
    ["a build that is no release", "unknown"],
  ])(
    "a probe on %s gets no line under its version",
    async (_label: string, reportedVersion: string) => {
      await draw(probe({ reportedVersion }));

      expect(textOf(PROBE_VERSION_TEST_ID)).toContain(reportedVersion);
      expect(
        screen.queryByTestId(PROBE_UPDATE_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("a probe that never connected gets the quiet dash, and no line", async () => {
    await draw(probe({ isConnected: false }));

    expect(textOf(PROBE_VERSION_TEST_ID)).not.toContain("Older than");
    expect(screen.queryByTestId(PROBE_UPDATE_TEST_ID)).not.toBeInTheDocument();
  });

  test.each([
    ["a test build", "17.2.0-test"],
    ["no release of its own", ""],
  ])(
    "while OneUptime runs %s, a probe is not called older, and is still told what it misses",
    async (_label: string, serverVersion: string) => {
      await draw(probe({}), serverVersion);

      expect(
        screen.queryByTestId(PROBE_OLDER_THAN_SERVER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(textOf(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID)).toBe(
        ONE_TIME_CODES_SENTENCE,
      );
      expect(screen.getAllByTestId(PROBE_UPDATE_DOCS_TEST_ID)).toHaveLength(1);

      cleanup();

      await draw(probe({ reportedVersion: "9.0.0" }), serverVersion);
      expect(
        screen.queryByTestId(PROBE_OLDER_THAN_SERVER_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("a global probe is never flagged: OneUptime updates its own probes", async () => {
    for (const reportedVersion of [undefined, "9.0.0", "16.0.0"]) {
      await draw(probe({ reportedVersion, isGlobalProbe: true }));

      expect([
        reportedVersion,
        screen.queryByTestId(PROBE_UPDATE_TEST_ID),
      ]).toEqual([reportedVersion, null]);

      cleanup();
    }
  });
});

describe("a row of Custom Probes", () => {
  test("an older probe's version, with an update by OneUptime's release, linked to how to update it", async () => {
    await draw(probe({ reportedVersion: "17.1.4" }), SERVER, "cell");

    expect(textOf(PROBE_VERSION_TEST_ID)).toContain("17.1.4");
    expect(textOf(PROBE_UPDATE_AVAILABLE_TEST_ID)).toBe(
      `Update available: ${SERVER}`,
    );
    expect(
      screen.getByTestId(PROBE_UPDATE_AVAILABLE_TEST_ID).getAttribute("href"),
    ).toContain(UPDATE_A_PROBE_DOCS_PATH);
    // A row says it in a line; the sentences are the probe's page's.
    expect(
      screen.queryByTestId(PROBE_OLDER_THAN_SERVER_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("an up-to-date probe's version alone", async () => {
    for (const reportedVersion of ["17.2.0", "17.2.0-rc.1", "17.3.0"]) {
      await draw(probe({ reportedVersion }), SERVER, "cell");

      expect(textOf(PROBE_VERSION_TEST_ID)).toContain(reportedVersion);
      expect(
        screen.queryByTestId(PROBE_UPDATE_AVAILABLE_TEST_ID),
      ).not.toBeInTheDocument();

      cleanup();
    }
  });

  test("while OneUptime runs a test build, no row offers an update it might never reach", async () => {
    await draw(probe({}), "17.2.0-test", "cell");

    expect(textOf(PROBE_VERSION_TEST_ID)).toContain("Older than 17.0.1");
    expect(
      screen.queryByTestId(PROBE_UPDATE_AVAILABLE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("in every Dashboard language", () => {
  const keys: Array<string> = [
    ...Object.values(PROBE_UPDATE_COPY),
    ...Object.values(PROBE_MISSED_FEATURE_COPY),
  ];

  test("every feature a probe can miss has its sentence and its test id", () => {
    for (const feature of Object.values(ProbeFeature)) {
      expect([feature, Boolean(PROBE_MISSED_FEATURE_COPY[feature])]).toEqual([
        feature,
        true,
      ]);
      expect([
        feature,
        Boolean(PROBE_MISSED_FEATURE_TEST_IDS[feature]),
      ]).toEqual([feature, true]);
    }
  });

  test("each sentence is worded, with the release where the language puts it", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of keys) {
      expect([key, english[key]]).toEqual([key, key]);
    }

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of keys) {
        const worded: string = words[key] || "";

        expect({
          language,
          key,
          isWorded: Boolean(worded) && worded !== key,
          keepsTheRelease:
            !key.includes("{{version}}") || worded.includes("{{version}}"),
        }).toEqual({ language, key, isWorded: true, keepsTheRelease: true });
      }
    }
  });

  test("a German reader reads it in German", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    await draw(probe({ reportedVersion: "17.1.4" }));

    expect(textOf(PROBE_OLDER_THAN_SERVER_TEST_ID)).toBe(
      `Älter als OneUptime ${SERVER}, an das sie ihre Ergebnisse sendet. Aktualisieren Sie die Sonde, um die neuesten Prüfungen und Korrekturen zu erhalten.`,
    );

    cleanup();

    await draw(probe({ reportedVersion: "17.1.4" }), SERVER, "cell");

    expect(textOf(PROBE_UPDATE_AVAILABLE_TEST_ID)).toBe(
      `Aktualisierung verfügbar: ${SERVER}`,
    );
  });

  test("a Persian reader reads no English but the release", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    await draw(probe({}));

    const update: string = textOf(PROBE_UPDATE_TEST_ID);

    expect(update).toContain(SERVER);
    expect(update).not.toContain("Older than");
    expect(update).not.toContain("Update the probe");
    expect(update).not.toContain("Too old to make one-time codes");

    cleanup();

    await draw(probe({}), SERVER, "cell");

    expect(textOf(PROBE_UPDATE_AVAILABLE_TEST_ID)).not.toContain(
      "Update available",
    );
    expect(textOf(PROBE_UPDATE_AVAILABLE_TEST_ID)).toContain(SERVER);
  });
});
