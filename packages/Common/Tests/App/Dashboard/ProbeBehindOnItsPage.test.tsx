import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import ProbeStatusElement, {
  PROBE_BEHIND_BY,
  PROBE_FELL_BEHIND,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeStatus";
import ProbeChecksElement, {
  PROBE_BEHIND_GUIDE_PATH,
  PROBE_CHECKS_COPY,
  PROBE_DEVICE_POLL_CONCURRENCY_SETTING,
  PROBE_DEVICE_POLLS_COPY,
  PROBE_WORKERS_SETTING,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeChecks";
import { ProbeBehindWork } from "../../../Types/Probe/ProbeBehind";
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
 *     under Monitor Checks whether it keeps up: On Time, or Behind - by how
 *     far, once a due time is kept - with since when, why it matters, what
 *     to do, and the guide;
 *   - in every language the Dashboard speaks.
 *
 * And the same of the network devices it polls (#9499): the list says
 * Behind when they wait past their poll time, and the probe's page shows
 * Network Device Polls while it is behind on them, with the setting that
 * lets it poll more at once.
 *
 * On 27 November 2026 every probe was handed nothing to check for twelve
 * hours, and a monitor's Probes and Settings > Global Probes said
 * Connected throughout: neither asked whether a probe was behind. They do
 * now, and Behind says when the probe fell behind, the exact time on
 * hover - and how far behind it is ("Behind by 11 hours"): how long its
 * longest-waiting check had waited at the latest reading.
 */

const DASHBOARD: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const MINUTE: number = 60 * 1000;

function connectedProbe(
  data: {
    lateFor?: number | null;
    devicesLateFor?: number | null;
    // How long the longest-waiting check had waited at the latest reading.
    behindBy?: number | null;
    devicesBehindBy?: number | null;
  } = {},
): Probe {
  const probe: Probe = new Probe();
  probe.connectionStatus = ProbeConnectionStatus.Connected;

  if (data.lateFor !== undefined && data.lateFor !== null) {
    probe.checksLastLateAt = new Date();
    probe.checksLateSince = new Date(Date.now() - data.lateFor);

    if (data.behindBy !== undefined && data.behindBy !== null) {
      probe.checksLastLateDueAt = new Date(
        probe.checksLastLateAt.getTime() - data.behindBy,
      );
    }
  }

  if (data.devicesLateFor !== undefined && data.devicesLateFor !== null) {
    probe.devicePollsLastLateAt = new Date();
    probe.devicePollsLateSince = new Date(Date.now() - data.devicesLateFor);

    if (data.devicesBehindBy !== undefined && data.devicesBehindBy !== null) {
      probe.devicePollsLastLateDueAt = new Date(
        probe.devicePollsLastLateAt.getTime() - data.devicesBehindBy,
      );
    }
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

  test("Behind says when the probe fell behind, the exact time on hover", async () => {
    const probe: Probe = connectedProbe({ lateFor: 3 * MINUTE });

    await draw(<ProbeStatusElement probe={probe} />);

    const line: HTMLElement = screen.getByTestId("probe-status-behind-since");
    // The figure is held to its word by a no-break space.
    expect(withoutIsolateMarks(line.textContent || "")).toMatch(
      /^Fell behind 3\sminutes ago$/,
    );

    const time: HTMLElement = line.querySelector("time") as HTMLElement;
    expect(time.getAttribute("dateTime")).toBe(
      probe.checksLateSince!.toISOString(),
    );
    expect(time.getAttribute("title")).toBeTruthy();
  });

  test("behind on both, it fell behind when the first of the two did", async () => {
    const probe: Probe = connectedProbe({
      lateFor: 3 * MINUTE,
      devicesLateFor: 2 * 60 * MINUTE,
    });

    await draw(<ProbeStatusElement probe={probe} />);

    expect(
      screen
        .getByTestId("probe-status-behind-since")
        .querySelector("time")
        ?.getAttribute("dateTime"),
    ).toBe(probe.devicePollsLateSince!.toISOString());
  });

  test("a probe that keeps up, or is disconnected, or is drawn for its connection only, says nothing of falling behind", async () => {
    await draw(<ProbeStatusElement probe={connectedProbe()} />);
    expect(screen.queryByTestId("probe-status-behind-since")).toBeNull();
    cleanup();

    const disconnected: Probe = connectedProbe({ lateFor: 3 * MINUTE });
    disconnected.connectionStatus = ProbeConnectionStatus.Disconnected;
    await draw(<ProbeStatusElement probe={disconnected} />);
    expect(screen.queryByTestId("probe-status-behind-since")).toBeNull();
    cleanup();

    await draw(
      <ProbeStatusElement
        probe={connectedProbe({ lateFor: 3 * MINUTE })}
        isConnectionOnly={true}
      />,
    );
    expect(screen.queryByTestId("probe-status-behind-since")).toBeNull();
  });

  test.each(["de", "fa", "ja"])(
    "when it fell behind reads in %s",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      await draw(
        <ProbeStatusElement probe={connectedProbe({ lateFor: 3 * MINUTE })} />,
      );

      const locale: Record<string, string> = readDashboardLocale(language);
      const text: string = withoutIsolateMarks(
        screen.getByTestId("probe-status-behind-since").textContent || "",
      );

      for (const words of locale[PROBE_FELL_BEHIND]!.split("{{time}}")) {
        expect(text).toContain(words.trim());
      }
      expect(text).not.toContain("Fell behind");
    },
  );

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

  test("a connected probe whose network devices have waited for minutes is Behind too (#9499)", async () => {
    await draw(
      <ProbeStatusElement
        probe={connectedProbe({ devicesLateFor: 3 * MINUTE })}
      />,
    );

    expect(screen.getByText("Behind")).toBeInTheDocument();
    expect(dotColor()).toBe("rgb(255, 191, 83)");
  });

  test("a row read as JSON whose network devices are late is Behind", async () => {
    await draw(
      <ProbeStatusElement
        probe={{
          connectionStatus: ProbeConnectionStatus.Connected,
          devicePollsLateSince: new Date(Date.now() - 3 * MINUTE).toISOString(),
          devicePollsLastLateAt: new Date().toISOString(),
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

describe("how far behind a probe is, in its status", () => {
  // The status bubble's words, without the marks that isolate a value.
  function statusText(): string {
    return withoutIsolateMarks(screen.getByRole("status").textContent || "");
  }

  test("a probe whose longest-waiting check had waited 15 minutes is Behind by 15 minutes, in amber, since when under it", async () => {
    await draw(
      <ProbeStatusElement
        probe={connectedProbe({ lateFor: 3 * MINUTE, behindBy: 15 * MINUTE })}
      />,
    );

    // The figure is held to its word by a no-break space.
    expect(statusText()).toMatch(/^Behind by 15\sminutes$/);
    expect(dotColor()).toBe("rgb(255, 191, 83)");
    expect(
      withoutIsolateMarks(
        screen.getByTestId("probe-status-behind-since").textContent || "",
      ),
    ).toMatch(/^Fell behind 3\sminutes ago$/);
  });

  test.each([
    [61 * 1000, /^Behind by 1\sminute$/],
    [60 * MINUTE, /^Behind by 1\shour$/],
    // 2026-11-27: handed nothing from 04:09:46, read at 16:00.
    [11 * 60 * MINUTE + 50 * MINUTE, /^Behind by 11\shours$/],
    [3 * 24 * 60 * MINUTE, /^Behind by 3\sdays$/],
  ])("late by %d ms, it reads %s", async (behindBy: number, reads: RegExp) => {
    await draw(
      <ProbeStatusElement
        probe={connectedProbe({ lateFor: 3 * MINUTE, behindBy })}
      />,
    );

    expect(statusText()).toMatch(reads);
  });

  test("behind on both, it is as far behind as the further of the two", async () => {
    await draw(
      <ProbeStatusElement
        probe={connectedProbe({
          lateFor: 3 * MINUTE,
          behindBy: 15 * MINUTE,
          devicesLateFor: 2 * 60 * MINUTE,
          devicesBehindBy: 3 * 60 * MINUTE,
        })}
      />,
    );

    expect(statusText()).toMatch(/^Behind by 3\shours$/);
  });

  test("read as the list hands it a row, as JSON", async () => {
    const lastLateAt: number = Date.now();

    await draw(
      <ProbeStatusElement
        probe={{
          connectionStatus: ProbeConnectionStatus.Connected,
          checksLateSince: new Date(lastLateAt - 3 * MINUTE).toISOString(),
          checksLastLateAt: new Date(lastLateAt).toISOString(),
          checksLastLateDueAt: new Date(lastLateAt - 15 * MINUTE).toISOString(),
        }}
      />,
    );

    expect(statusText()).toMatch(/^Behind by 15\sminutes$/);
  });

  test("plain Behind while no due time is kept yet - the probe's first reading after an upgrade", async () => {
    await draw(
      <ProbeStatusElement probe={connectedProbe({ lateFor: 3 * MINUTE })} />,
    );

    expect(statusText()).toBe("Behind");
  });

  test("a probe that keeps up, or is drawn for its connection only, says nothing of how far behind", async () => {
    await draw(<ProbeStatusElement probe={connectedProbe()} />);
    expect(statusText()).toBe("Connected");
    cleanup();

    await draw(
      <ProbeStatusElement
        probe={connectedProbe({ lateFor: 3 * MINUTE, behindBy: 15 * MINUTE })}
        isConnectionOnly={true}
      />,
    );
    expect(statusText()).toBe("Connected");
  });

  test.each(["de", "fa", "ja"])(
    "how far behind reads in %s",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      await draw(
        <ProbeStatusElement
          probe={connectedProbe({ lateFor: 3 * MINUTE, behindBy: 15 * MINUTE })}
        />,
      );

      const locale: Record<string, string> = readDashboardLocale(language);
      const text: string = statusText();

      for (const words of locale[PROBE_BEHIND_BY.minute.other]!.split(
        "{{count}}",
      )) {
        expect(text).toContain(words.trim());
      }
      expect(text).not.toContain("Behind by");
    },
  );
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

    // The setting reads as one, to copy as it is.
    const setting: HTMLElement | null = behind.querySelector("code");
    expect(setting?.textContent).toBe("PROBE_MONITORING_WORKERS");
    expect(PROBE_WORKERS_SETTING).toBe("PROBE_MONITORING_WORKERS");

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
    expect(text).toContain(
      locale[PROBE_CHECKS_COPY.behindFix]!.replace(
        "{{setting}}",
        PROBE_WORKERS_SETTING,
      ),
    );
    expect(text).toContain(locale[PROBE_CHECKS_COPY.readTheGuide]!);
    expect(text).not.toContain("monitors have waited");
    expect(
      screen.getByTestId("probe-checks-behind").querySelector("code")
        ?.textContent,
    ).toBe(PROBE_WORKERS_SETTING);
  });
});

describe("Network Device Polls, on the probe's page (#9499)", () => {
  test("says nothing of the monitors, and On Time while the devices keep up", async () => {
    await draw(
      <ProbeChecksElement
        probe={connectedProbe({ lateFor: 5 * MINUTE })}
        work={ProbeBehindWork.DevicePolls}
      />,
    );

    expect(screen.getByText("On Time")).toBeInTheDocument();
    expect(screen.queryByTestId("probe-device-polls-behind")).toBeNull();
  });

  test("a probe behind on its devices says since when, why it matters, what to do and where to read more", async () => {
    await draw(
      <ProbeChecksElement
        probe={connectedProbe({ devicesLateFor: 5 * MINUTE })}
        work={ProbeBehindWork.DevicePolls}
      />,
    );

    const behind: HTMLElement = screen.getByTestId("probe-device-polls-behind");
    const text: string = withoutIsolateMarks(behind.textContent || "");

    expect(text).toContain("Behind");
    expect(text).toMatch(
      /Since .+, its network devices have waited more than a minute past their poll time, so they are polled less often than set\./,
    );
    expect(text).toContain(
      "Update the probe, or let it poll more devices at once: raise PROBE_NETWORK_DEVICE_POLL_CONCURRENCY on the probe and restart it.",
    );
    expect(text).not.toContain("monitors have waited");

    const setting: HTMLElement | null = behind.querySelector("code");
    expect(setting?.textContent).toBe("PROBE_NETWORK_DEVICE_POLL_CONCURRENCY");
    expect(PROBE_DEVICE_POLL_CONCURRENCY_SETTING).toBe(
      "PROBE_NETWORK_DEVICE_POLL_CONCURRENCY",
    );

    /*
     * On a phone it breaks after its underscores, never at the letter
     * that filled the line ("PR" / "OBE_NETWORK_..." in German).
     */
    expect(setting?.className).not.toContain("break-all");
    expect(setting?.className).toContain("[overflow-wrap:anywhere]");
    expect(setting?.innerHTML).toBe(
      "PROBE_<wbr>NETWORK_<wbr>DEVICE_<wbr>POLL_<wbr>CONCURRENCY",
    );

    const guide: HTMLElement = screen.getByRole("link", {
      name: "Read the guide",
    });
    expect(guide.getAttribute("href")).toBe(PROBE_BEHIND_GUIDE_PATH);
  });

  test("Monitor Checks stays On Time for a probe behind only on its devices", async () => {
    await draw(
      <ProbeChecksElement
        probe={connectedProbe({ devicesLateFor: 5 * MINUTE })}
      />,
    );

    expect(screen.getByText("On Time")).toBeInTheDocument();
  });

  test.each(["de", "fa", "ja"])("reads in %s", async (language: string) => {
    await act(async () => {
      await i18next.changeLanguage(language);
    });

    await draw(
      <ProbeChecksElement
        probe={connectedProbe({ devicesLateFor: 5 * MINUTE })}
        work={ProbeBehindWork.DevicePolls}
      />,
    );

    const locale: Record<string, string> = readDashboardLocale(language);
    const text: string = withoutIsolateMarks(
      screen.getByTestId("probe-device-polls-behind").textContent || "",
    );

    expect(text).toContain(locale[PROBE_DEVICE_POLLS_COPY.behind]!);
    expect(text).toContain(
      locale[PROBE_DEVICE_POLLS_COPY.behindFix]!.replace(
        "{{setting}}",
        PROBE_DEVICE_POLL_CONCURRENCY_SETTING,
      ),
    );
    expect(text).not.toContain("network devices have waited");
  });
});

describe("how far behind, on the probe's page", () => {
  // Each field draws one status bubble: its words, without isolate marks.
  function statusText(): string {
    return withoutIsolateMarks(screen.getByRole("status").textContent || "");
  }

  test("Monitor Checks says how far behind the monitors run, in amber, with since when under it", async () => {
    await draw(
      <ProbeChecksElement
        probe={connectedProbe({ lateFor: 5 * MINUTE, behindBy: 15 * MINUTE })}
      />,
    );

    // The figure is held to its word by a no-break space.
    expect(statusText()).toMatch(/^Behind by 15\sminutes$/);
    expect(dotColor()).toBe("rgb(255, 191, 83)");
    expect(
      withoutIsolateMarks(
        screen.getByTestId("probe-checks-behind").textContent || "",
      ),
    ).toMatch(
      /Since .+, its monitors have waited more than a minute past their check time/,
    );
  });

  test("each field says how far behind its own work runs, not the further of the two", async () => {
    const probe: Probe = connectedProbe({
      lateFor: 5 * MINUTE,
      behindBy: 15 * MINUTE,
      devicesLateFor: 4 * 60 * MINUTE,
      // 2026-11-27: handed nothing from 04:09:46, read at 16:00.
      devicesBehindBy: 11 * 60 * MINUTE + 50 * MINUTE,
    });

    await draw(<ProbeChecksElement probe={probe} />);
    expect(statusText()).toMatch(/^Behind by 15\sminutes$/);
    cleanup();

    await draw(
      <ProbeChecksElement probe={probe} work={ProbeBehindWork.DevicePolls} />,
    );
    expect(statusText()).toMatch(/^Behind by 11\shours$/);
  });

  test.each([
    [61 * 1000, /^Behind by 1\sminute$/],
    [60 * MINUTE, /^Behind by 1\shour$/],
    [3 * 24 * 60 * MINUTE, /^Behind by 3\sdays$/],
  ])(
    "Network Device Polls late by %d ms reads %s",
    async (devicesBehindBy: number, reads: RegExp) => {
      await draw(
        <ProbeChecksElement
          probe={connectedProbe({
            devicesLateFor: 5 * MINUTE,
            devicesBehindBy,
          })}
          work={ProbeBehindWork.DevicePolls}
        />,
      );

      expect(statusText()).toMatch(reads);
    },
  );

  test("plain Behind while no due time is kept yet - the probe's first reading after an upgrade", async () => {
    await draw(
      <ProbeChecksElement probe={connectedProbe({ lateFor: 5 * MINUTE })} />,
    );
    expect(statusText()).toBe("Behind");
    cleanup();

    await draw(
      <ProbeChecksElement
        probe={connectedProbe({ devicesLateFor: 5 * MINUTE })}
        work={ProbeBehindWork.DevicePolls}
      />,
    );
    expect(statusText()).toBe("Behind");
  });

  test("a due time kept from a late reading says nothing while the probe keeps up", async () => {
    const probe: Probe = connectedProbe({ lateFor: 0, behindBy: 15 * MINUTE });

    await draw(<ProbeChecksElement probe={probe} />);

    expect(statusText()).toBe("On Time");
  });

  test.each(["de", "fa", "ja"])(
    "how far behind reads in %s",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      await draw(
        <ProbeChecksElement
          probe={connectedProbe({
            devicesLateFor: 5 * MINUTE,
            devicesBehindBy: 3 * 60 * MINUTE,
          })}
          work={ProbeBehindWork.DevicePolls}
        />,
      );

      const locale: Record<string, string> = readDashboardLocale(language);
      const text: string = statusText();

      for (const words of locale[PROBE_BEHIND_BY.hour.other]!.split(
        "{{count}}",
      )) {
        expect(text).toContain(words.trim());
      }
      // The count in the language's own digits ("۳" in Persian).
      expect(text).toContain(new Intl.NumberFormat(language).format(3));
      expect(text).not.toContain("Behind by");
    },
  );
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
    // When it fell behind, under Behind in the lists.
    PROBE_FELL_BEHIND,
    // How far behind, as its status in the lists: each unit's sentence.
    PROBE_BEHIND_BY.minute.other,
    PROBE_BEHIND_BY.hour.other,
    PROBE_BEHIND_BY.day.other,
    // The model's column titles, which lists and filters show.
    "Checks Late Since",
    "Checks Last Late At",
    "Checks Last Late Due At",
    // The same of the network devices it polls (#9499).
    PROBE_DEVICE_POLLS_COPY.title,
    PROBE_DEVICE_POLLS_COPY.description,
    PROBE_DEVICE_POLLS_COPY.behindWords,
    PROBE_DEVICE_POLLS_COPY.behindFix,
    "Device Polls Late Since",
    "Device Polls Last Late At",
    "Device Polls Last Late Due At",
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

      // Each unit's one form too, under its key plus "_one", with its count.
      for (const template of Object.values(PROBE_BEHIND_BY)) {
        const key: string = `${template.other}_one`;

        expect(english[key]).toBe(template.one);
        expect({ language, key, has: typeof locale[key] }).toEqual({
          language,
          key,
          has: "string",
        });
        expect(getTemplatePlaceholders(locale[key]!)).toEqual(["count"]);
      }

      // The setting is drawn in the slot, never translated or retyped.
      expect(locale[PROBE_CHECKS_COPY.behindFix]).not.toContain(
        PROBE_WORKERS_SETTING,
      );
      expect(locale[PROBE_DEVICE_POLLS_COPY.behindFix]).not.toContain(
        PROBE_DEVICE_POLL_CONCURRENCY_SETTING,
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
    // And how far behind it is.
    expect(source).toMatch(
      /selectMoreFields: \{\s*checksLastLateAt: true,\s*checksLastLateDueAt: true,/,
    );
    expect(source).toContain("<ProbeChecksElement probe={item} />");
    expect(source).toMatch(
      /showIf: \(item: Probe\): boolean => \{\s*return \(\s*item\.connectionStatus === ProbeConnectionStatus\.Connected\s*\);/,
    );
    /*
     * Connection Status says the connection alone - and, the probe being
     * the project's own, what to check once it is disconnected (#7273).
     */
    expect(source).toMatch(
      /<ProbeStatusElement\s+probe=\{item\}\s+isConnectionOnly=\{true\}\s+isProjectProbe=\{true\}\s*\/>/,
    );
  });

  test("the probe's page asks for its device polls too, and shows Network Device Polls only while it is connected and behind on them", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD, "Pages/Monitor/Settings/MonitorProbeView.tsx"),
      "utf8",
    );

    expect(source).toContain("devicePollsLastLateAt: true");
    expect(source).toContain("devicePollsLateSince: true");
    expect(source).toMatch(
      /selectMoreFields: \{[^}]*devicePollsLastLateAt: true,\s*devicePollsLastLateDueAt: true,\s*\}/,
    );
    expect(source).toMatch(
      /item\.connectionStatus === ProbeConnectionStatus\.Connected &&\s*ProbeBehindUtil\.isDevicePollsBehind\(item\)/,
    );
    expect(source).toMatch(
      /<ProbeChecksElement\s+probe=\{item\}\s+work=\{ProbeBehindWork\.DevicePolls\}\s*\/>/,
    );
  });

  test("a monitor's Probes ask whether each probe is behind on its monitor checks, since when and by how much - not on its device polls", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD, "Pages/Monitor/View/Probes.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /probe: \{\s*connectionStatus: true,[\s\S]*?checksLateSince: true,\s*checksLastLateAt: true,\s*checksLastLateDueAt: true,\s*\},/,
    );
    expect(source).not.toContain("devicePollsLateSince");
    expect(source).toContain('<ProbeStatusElement probe={item["probe"]!} />');
  });

  test("Settings > Global Probes reads what says a global probe is behind", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD, "Pages/Monitor/Settings/MonitorProbes.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /"\/probe\/global-probes",[\s\S]*?selectMoreFields=\{\{[^}]*lastAlive: true,[^}]*checksLateSince: true,\s*checksLastLateAt: true,\s*checksLastLateDueAt: true,\s*devicePollsLateSince: true,\s*devicePollsLastLateAt: true,\s*devicePollsLastLateDueAt: true,\s*\}\}/,
    );
  });

  test("the Custom Probes list reads what says a probe is behind", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD, "Pages/Monitor/Settings/MonitorProbes.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /selectMoreFields=\{\{\s*key: true,\s*iconFileId: true,[^}]*checksLateSince: true,\s*checksLastLateAt: true,\s*checksLastLateDueAt: true,\s*devicePollsLateSince: true,\s*devicePollsLastLateAt: true,\s*devicePollsLastLateDueAt: true,/,
    );
  });
});
