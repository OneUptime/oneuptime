import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import ProbeStatusElement from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeStatus";
import ProbeChecksElement, {
  PROBE_BEHIND_GUIDE_PATH,
  PROBE_CHECKS_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeChecks";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import { getTemplatePlaceholders } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CUSTOM PROBE THAT IS BEHIND, ON ITS PAGE AND IN THE LIST (OneUptime
 * issue #9488).
 *
 * A probe that cannot keep up checks what it can and the rest wait, while
 * every page showed its monitors up, checked as often as set. Now:
 *
 *   - the Custom Probes list's Status says Behind, in amber, for a probe that
 *     is connected but whose monitors are checked later than their interval
 *     (Types/Probe/ProbeBehind);
 *   - the probe's page keeps Connection Status for the connection, and says
 *     under Monitor Checks whether it keeps up: On Time, or Behind with since
 *     when, why it matters, what to do, and the guide;
 *   - in every language the Dashboard speaks.
 */

const DASHBOARD: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const MINUTE: number = 60 * 1000;

function connectedProbe(data: { lateFor?: number | null } = {}): Probe {
  const probe: Probe = new Probe();
  probe.connectionStatus = ProbeConnectionStatus.Connected;

  if (data.lateFor !== undefined && data.lateFor !== null) {
    probe.checksLastLateAt = new Date();
    probe.checksLateSince = new Date(Date.now() - data.lateFor);
  }

  return probe;
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

async function draw(element: React.ReactElement): Promise<void> {
  render(<MemoryRouter>{element}</MemoryRouter>);

  await act(async () => {
    await Promise.resolve();
  });
}

function dotColor(): string {
  const dot: HTMLElement = screen.getAllByTestId("status-bubble-dot")[0]!;
  return (dot.firstElementChild as HTMLElement).style.backgroundColor;
}

describe("the probe's status in the Custom Probes list", () => {
  test("a connected probe that keeps up is Connected", async () => {
    await draw(<ProbeStatusElement probe={connectedProbe()} />);

    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  test("a connected probe whose checks have been late for minutes is Behind, in amber", async () => {
    await draw(
      <ProbeStatusElement probe={connectedProbe({ lateFor: 3 * MINUTE })} />,
    );

    expect(screen.getByText("Behind")).toBeInTheDocument();
    expect(dotColor()).toBe("rgb(255, 191, 83)");
  });

  test("one late reading - a restart - is not yet behind", async () => {
    await draw(<ProbeStatusElement probe={connectedProbe({ lateFor: 0 })} />);

    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  test("a disconnected probe is Disconnected, whatever was kept about its checks", async () => {
    const probe: Probe = connectedProbe({ lateFor: 3 * MINUTE });
    probe.connectionStatus = ProbeConnectionStatus.Disconnected;

    await draw(<ProbeStatusElement probe={probe} />);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  test("read as the list hands it a row, as JSON", async () => {
    await draw(
      <ProbeStatusElement
        probe={{
          connectionStatus: ProbeConnectionStatus.Connected,
          checksLateSince: new Date(Date.now() - 3 * MINUTE).toISOString(),
          checksLastLateAt: new Date().toISOString(),
        }}
      />,
    );

    expect(screen.getByText("Behind")).toBeInTheDocument();
  });

  test("on the probe's page, Connection Status says only whether it is connected", async () => {
    await draw(
      <ProbeStatusElement
        probe={connectedProbe({ lateFor: 3 * MINUTE })}
        isConnectionOnly={true}
      />,
    );

    expect(screen.getByText("Connected")).toBeInTheDocument();
  });
});

describe("Monitor Checks, on the probe's page", () => {
  test("a probe that keeps up is On Time", async () => {
    await draw(<ProbeChecksElement probe={connectedProbe()} />);

    expect(screen.getByText("On Time")).toBeInTheDocument();
    expect(screen.queryByTestId("probe-checks-behind")).toBeNull();
  });

  test("a probe that is behind says since when, why it matters, what to do and where to read more", async () => {
    await draw(
      <ProbeChecksElement probe={connectedProbe({ lateFor: 5 * MINUTE })} />,
    );

    const behind: HTMLElement = screen.getByTestId("probe-checks-behind");
    const text: string = withoutIsolateMarks(behind.textContent || "");

    expect(text).toContain("Behind");
    expect(text).toMatch(
      /Since .+, its monitors have waited more than a minute past their check time, so they are checked less often than set\./,
    );
    expect(text).toContain(
      "Update the probe, or let it check more monitors at once: raise PROBE_MONITORING_WORKERS on the probe and restart it.",
    );

    const guide: HTMLElement = screen.getByRole("link", {
      name: "Read the guide",
    });
    expect(guide.getAttribute("href")).toBe(PROBE_BEHIND_GUIDE_PATH);
    expect(guide.getAttribute("target")).toBe("_blank");
  });

  test.each(["de", "fa", "ja"])("reads in %s", async (language: string) => {
    await act(async () => {
      await i18next.changeLanguage(language);
    });

    await draw(
      <ProbeChecksElement probe={connectedProbe({ lateFor: 5 * MINUTE })} />,
    );

    const locale: Record<string, string> = readDashboardLocale(language);
    const text: string = withoutIsolateMarks(
      screen.getByTestId("probe-checks-behind").textContent || "",
    );

    expect(text).toContain(locale[PROBE_CHECKS_COPY.behind]!);
    expect(text).toContain(locale[PROBE_CHECKS_COPY.behindFix]!);
    expect(text).toContain(locale[PROBE_CHECKS_COPY.readTheGuide]!);
    expect(text).not.toContain("monitors have waited");
  });
});

describe("in every language the Dashboard speaks", () => {
  const WORDS: Array<string> = [
    PROBE_CHECKS_COPY.title,
    PROBE_CHECKS_COPY.description,
    PROBE_CHECKS_COPY.onTime,
    PROBE_CHECKS_COPY.behind,
    PROBE_CHECKS_COPY.behindWords,
    PROBE_CHECKS_COPY.behindFix,
    PROBE_CHECKS_COPY.readTheGuide,
    // The model's column titles, which lists and filters show.
    "Checks Late Since",
    "Checks Last Late At",
  ];

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words them all, with their placeholders",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);
      const english: Record<string, string> = readDashboardLocale("en");

      for (const words of WORDS) {
        expect({ words, english: english[words] }).toEqual({
          words,
          english: words,
        });
        expect({ language, words, has: typeof locale[words] }).toEqual({
          language,
          words,
          has: "string",
        });
        expect(getTemplatePlaceholders(locale[words]!).sort()).toEqual(
          getTemplatePlaceholders(words).sort(),
        );
        expect({ language, words, same: locale[words] === words }).toEqual({
          language,
          words,
          same: false,
        });
      }

      expect(locale[PROBE_CHECKS_COPY.behindFix]).toContain(
        "PROBE_MONITORING_WORKERS",
      );
    },
  );
});

describe("the pages", () => {
  test("the probe's page asks for what says it is behind, and shows Monitor Checks only while it is connected", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD, "Pages/Monitor/Settings/MonitorProbeView.tsx"),
      "utf8",
    );

    expect(source).toContain("checksLastLateAt: true");
    expect(source).toContain("checksLateSince: true");
    expect(source).toContain("<ProbeChecksElement probe={item} />");
    expect(source).toMatch(
      /showIf: \(item: Probe\): boolean => \{\s*return \(\s*item\.connectionStatus === ProbeConnectionStatus\.Connected\s*\);/,
    );
    expect(source).toContain(
      "<ProbeStatusElement probe={item} isConnectionOnly={true} />",
    );
  });

  test("the Custom Probes list reads what says a probe is behind", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD, "Pages/Monitor/Settings/MonitorProbes.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /selectMoreFields=\{\{\s*key: true,\s*iconFileId: true,[^}]*checksLateSince: true,\s*checksLastLateAt: true,/,
    );
  });
});
