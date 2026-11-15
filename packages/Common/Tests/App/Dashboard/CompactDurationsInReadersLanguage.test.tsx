import { describe, expect, test } from "@jest/globals";
import { formatLlmDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationFormat";
import { formatDiscoveryDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanProgressState";
import {
  formatDurationFromSeconds,
  formatShiftDuration,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import { getOpenStackCheckDurationText } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Checks/OpenStackChecksView";
import { getRangeLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileScopeBar";
import { describeReplayDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCard";
import {
  describeSessionReplayAuditSession,
  SessionReplayAuditSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayAuditSummary";
import { buildSessionReplayFilterChips } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayFilterFields";
import { EMPTY_ADVANCED_FILTERS } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";
import { formatSessionDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPlayability";
import { formatUserFlowDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowFormat";
import { formatAge as formatCephAge } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephResourceUtils";
import { formatSlaCountdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/SlaCountdown";
import { formatUptime as formatIoTUptime } from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/IoTDeviceUtils";
import KubernetesResourceUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils";
import { formatOpenStackDuration } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import { formatProxmoxDuration } from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxPartFacts";
import { formatUptime as formatProxmoxUptime } from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxResourceUtils";
import { describeSecondsWatched } from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplayAudit";
import {
  getWindowOptions,
  TelemetryRuleWindowOption,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleText";
import { formatRelativeTime as formatConditionAge } from "../../../UI/Components/ConditionsTable/ConditionsTable";
import { formatStepDuration as formatWorkflowStepDuration } from "../../../UI/Components/Workflow/StepTraceViewer";
import { getEnglishOf } from "../../../Types/DateLanguage";
import { Translator } from "../../../Types/Translator";
import { formatDurationCompactInLanguage } from "../../../Utils/Slo/SloDuration";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { EMPTY_VALUE_MARK } from "../../../UI/Components/Detail/EmptyValue";

/*
 * THE DASHBOARD'S COMPACT DURATIONS, IN THE READER'S LANGUAGE (#8455).
 *
 * The Dashboard and the shared UI wrote their short durations by hand: a
 * Kubernetes or Ceph object's age `${diffSec}s`, an uptime `${days}d
 * ${hours}h`, a Proxmox task `${minutes}m ${rest}s`, an SLA's countdown, a
 * discovery scan's run time, a journey's length, a call's `{minutes}m
 * {seconds}s` - English letters and Latin digits beside a Persian page's
 * Persian dates. Each is formatCompactDuration (or formatCompactDurationAgo)
 * now: the Dashboard's compact keys, worded by every language, each figure
 * as the reader's language writes it.
 *
 * Per place, in English (exactly as it was written by hand), German, Arabic
 * (Latin digits, Arabic units) and Persian (Persian digits and units, and no
 * Latin letter or digit at all).
 */

const NB: string = String.fromCharCode(0x00a0);

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const translators: Record<string, Translator> = Object.fromEntries(
  LANGUAGES.map((language: string): [string, Translator] => {
    return [language, dashboardTranslator(language)];
  }),
);

interface Said {
  en: string;
  de: string;
  ar: string;
  fa: string;
}

// What `write` says in each language, its isolating marks left out.
const inEachLanguage: (write: (translator: Translator) => string) => Said = (
  write: (translator: Translator) => string,
): Said => {
  const say: (language: string) => string = (language: string): string => {
    return withoutIsolateMarks(write(translators[language]!));
  };

  return { en: say("en"), de: say("de"), ar: say("ar"), fa: say("fa") };
};

const LATIN: RegExp = /[0-9A-Za-z]/;

const LATIN_LETTER: RegExp = /[A-Za-z]/;

// A Persian text holds no Latin digit and no Latin letter.
const expectNoLatinIn: (said: Said) => void = (said: Said): void => {
  expect({ fa: said.fa, latin: LATIN.test(said.fa) }).toEqual({
    fa: said.fa,
    latin: false,
  });
};

// An Arabic text keeps Latin digits (OneUptime writes Arabic so), never Latin letters.
const expectNoLatinLetterIn: (said: Said) => void = (said: Said): void => {
  expect({ ar: said.ar, latin: LATIN_LETTER.test(said.ar) }).toEqual({
    ar: said.ar,
    latin: false,
  });
};

// A moment `seconds` before now, as a timestamp.
const secondsAgo: (seconds: number) => string = (seconds: number): string => {
  return new Date(Date.now() - seconds * 1000).toISOString();
};

describe("ages: a Kubernetes object, a Ceph daemon, a Kubernetes condition", () => {
  test("a Kubernetes object's age, as the AGE column says it", () => {
    const said: (seconds: number) => Said = (seconds: number): Said => {
      return inEachLanguage((t: Translator): string => {
        return KubernetesResourceUtils.formatAge(secondsAgo(seconds), t);
      });
    };

    expect(said(12)).toEqual({
      en: "12s",
      de: `12${NB}Sek.`,
      ar: `12${NB}ث`,
      fa: `۱۲${NB}ثانیه`,
    });
    expect(said(5 * 60 + 3)).toEqual({
      en: "5m",
      de: `5${NB}Min.`,
      ar: `5${NB}د`,
      fa: `۵${NB}دقیقه`,
    });
    expect(said(3 * 3600 + 30)).toEqual({
      en: "3h",
      de: `3${NB}Std.`,
      ar: `3${NB}س`,
      fa: `۳${NB}ساعت`,
    });
    expect(said(2 * 86400 + 30)).toEqual({
      en: "2d",
      de: `2${NB}Tg.`,
      ar: `2${NB}ي`,
      fa: `۲${NB}روز`,
    });
    expect(said(95 * 86400)).toEqual({
      en: "3mo",
      de: `3${NB}Mon.`,
      ar: `3${NB}ش`,
      fa: `۳${NB}ماه`,
    });

    for (const seconds of [12, 5 * 60, 3 * 3600, 2 * 86400, 95 * 86400]) {
      expectNoLatinIn(said(seconds));
      expectNoLatinLetterIn(said(seconds));
    }

    // No timestamp is no age, in every language.
    expect(
      KubernetesResourceUtils.formatAge(undefined, translators["fa"]),
    ).toBe("N/A");
  });

  test("a Ceph daemon's age reads the same as a Kubernetes object's", () => {
    for (const seconds of [12, 5 * 60, 3 * 3600, 2 * 86400, 95 * 86400]) {
      for (const language of LANGUAGES) {
        const translator: Translator = translators[language]!;

        expect(
          formatCephAge(new Date(Date.now() - seconds * 1000), translator),
        ).toBe(
          KubernetesResourceUtils.formatAge(secondsAgo(seconds), translator),
        );
      }
    }

    expect(formatCephAge(null, translators["de"])).toBe("N/A");
  });

  test("a condition's last transition, as an age", () => {
    const now: Date = new Date("2026-11-15T12:00:00.000Z");
    const said: (seconds: number) => Said = (seconds: number): Said => {
      return inEachLanguage((t: Translator): string => {
        return formatConditionAge(
          new Date(now.getTime() - seconds * 1000).toISOString(),
          t,
          now,
        );
      });
    };

    expect(said(12)).toEqual({
      en: "12s ago",
      de: `vor 12${NB}Sek.`,
      ar: `قبل 12${NB}ث`,
      fa: `۱۲${NB}ثانیه پیش`,
    });
    expect(said(5 * 60)).toEqual({
      en: "5m ago",
      de: `vor 5${NB}Min.`,
      ar: `قبل 5${NB}د`,
      fa: `۵${NB}دقیقه پیش`,
    });
    expect(said(3 * 3600).en).toBe("3h ago");
    expect(said(2 * 86400).en).toBe("2d ago");
    expectNoLatinIn(said(3 * 3600));
    expectNoLatinIn(said(2 * 86400));

    // A time in the future is shown as the cluster wrote it; none is a dash.
    const later: string = new Date(now.getTime() + 60_000).toISOString();

    expect(formatConditionAge(later, translators["fa"], now)).toBe(later);
    expect(formatConditionAge("", translators["fa"], now)).toBe(
      EMPTY_VALUE_MARK,
    );
  });
});

describe("uptimes and task lengths: IoT, Proxmox", () => {
  test("a device's and a node's uptime", () => {
    for (const formatUptime of [formatIoTUptime, formatProxmoxUptime]) {
      const said: (seconds: number) => Said = (seconds: number): Said => {
        return inEachLanguage((t: Translator): string => {
          return formatUptime(seconds, t);
        });
      };

      expect(said(3 * 86400 + 4 * 3600 + 59)).toEqual({
        en: "3d 4h",
        de: `3${NB}T. 4${NB}Std.`,
        ar: `3${NB}ي 4${NB}س`,
        fa: `۳${NB}روز ۴${NB}ساعت`,
      });
      expect(said(4 * 3600 + 12 * 60)).toEqual({
        en: "4h 12m",
        de: `4${NB}Std. 12${NB}Min.`,
        ar: `4${NB}س 12${NB}د`,
        fa: `۴${NB}ساعت ۱۲${NB}دقیقه`,
      });
      expect(said(12 * 60 + 5)).toEqual({
        en: "12m",
        de: `12${NB}Min.`,
        ar: `12${NB}د`,
        fa: `۱۲${NB}دقیقه`,
      });
      expectNoLatinIn(said(3 * 86400));
      // No reading, and none yet, is nothing.
      expect(formatUptime(null, translators["fa"])).toBe("");
      expect(formatUptime(0, translators["fa"])).toBe("");
    }
  });

  test("a Proxmox task's length", () => {
    const said: (seconds: number) => Said = (seconds: number): Said => {
      return inEachLanguage((t: Translator): string => {
        return formatProxmoxDuration(seconds, t);
      });
    };

    expect(said(45)).toEqual({
      en: "45s",
      de: `45${NB}Sek.`,
      ar: `45${NB}ث`,
      fa: `۴۵${NB}ثانیه`,
    });
    expect(said(212)).toEqual({
      en: "3m 32s",
      de: `3${NB}Min. 32${NB}s`,
      ar: `3${NB}د 32${NB}ث`,
      fa: `۳${NB}دقیقه ۳۲${NB}ثانیه`,
    });
    expect(said(3900)).toEqual({
      en: "1h 5m",
      de: `1${NB}Std. 5${NB}Min.`,
      ar: `1${NB}س 5${NB}د`,
      fa: `۱${NB}ساعت ۵${NB}دقیقه`,
    });
    expect(formatProxmoxDuration(null, translators["fa"])).toBe("");
  });

  test("an OpenStack part's time in its state", () => {
    const said: (minutes: number) => Said = (minutes: number): Said => {
      return inEachLanguage((t: Translator): string => {
        return formatOpenStackDuration(minutes, t);
      });
    };

    expect(said(45)).toEqual({
      en: "45m",
      de: `45${NB}Min.`,
      ar: `45${NB}د`,
      fa: `۴۵${NB}دقیقه`,
    });
    expect(said(5 * 60)).toEqual({
      en: "5h",
      de: `5${NB}Std.`,
      ar: `5${NB}س`,
      fa: `۵${NB}ساعت`,
    });
    expect(said(3 * 24 * 60)).toEqual({
      en: "3d",
      de: `3${NB}Tg.`,
      ar: `3${NB}ي`,
      fa: `۳${NB}روز`,
    });
  });

  test("an OpenStack check's run from a minute up, and an LLM call's", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return getOpenStackCheckDurationText(4 * 60_000 + 12_000, t);
      }),
    ).toEqual({
      en: "4m 12s",
      de: `4${NB}Min. 12${NB}s`,
      ar: `4${NB}د 12${NB}ث`,
      fa: `۴${NB}دقیقه ۱۲${NB}ثانیه`,
    });
    // A field a clock writes in two digits: the reader's zero, then digit.
    expect(
      inEachLanguage((t: Translator): string => {
        return formatLlmDuration(245_000, t);
      }),
    ).toEqual({
      en: "4m 05s",
      de: `4${NB}Min. 05${NB}s`,
      ar: `4${NB}د 05${NB}ث`,
      fa: `۴${NB}دقیقه ۰۵${NB}ثانیه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return formatLlmDuration(3_720_000, t);
      }),
    ).toEqual({
      en: "1h 02m",
      de: `1${NB}Std. 02${NB}Min.`,
      ar: `1${NB}س 02${NB}د`,
      fa: `۱${NB}ساعت ۰۲${NB}دقیقه`,
    });
  });
});

describe("countdowns and run times: an SLA, a discovery scan, an on-call shift", () => {
  test("an SLA's countdown names every unit from the largest it reaches", () => {
    const ms: (d: number, h: number, m: number, s: number) => number = (
      d: number,
      h: number,
      m: number,
      s: number,
    ): number => {
      return (((d * 24 + h) * 60 + m) * 60 + s) * 1000;
    };

    const said: (milliseconds: number) => Said = (milliseconds: number) => {
      return inEachLanguage((t: Translator): string => {
        return formatSlaCountdown(milliseconds, {
          countsDays: true,
          translator: t,
        });
      });
    };

    expect(said(ms(2, 3, 4, 5))).toEqual({
      en: "2d 3h 4m 5s",
      de: `2${NB}Tg. 3${NB}Std. 4${NB}Min. 5${NB}Sek.`,
      ar: `2${NB}ي 3${NB}س 4${NB}د 5${NB}ث`,
      fa: `۲${NB}روز ۳${NB}ساعت ۴${NB}دقیقه ۵${NB}ثانیه`,
    });
    // A larger unit keeps the zero of the one below it, as the timer did.
    expect(said(ms(1, 0, 0, 9)).en).toBe("1d 0h 0m 9s");
    expect(said(ms(0, 0, 4, 5))).toEqual({
      en: "4m 5s",
      de: `4${NB}Min. 5${NB}s`,
      ar: `4${NB}د 5${NB}ث`,
      fa: `۴${NB}دقیقه ۵${NB}ثانیه`,
    });
    expect(said(ms(0, 0, 0, 5)).en).toBe("5s");
    expect(said(0).en).toBe("0s");
    // Overdue counts the same way: the sign is the sentence's, never the figure's.
    expect(said(-ms(0, 1, 2, 3)).en).toBe("1h 2m 3s");
    expectNoLatinIn(said(ms(2, 3, 4, 5)));
    expectNoLatinLetterIn(said(ms(2, 3, 4, 5)));
  });

  test("the note reminder's countdown runs its hours past a day", () => {
    expect(
      formatSlaCountdown(((26 * 60 + 4) * 60 + 5) * 1000, {
        translator: translators["en"],
      }),
    ).toBe("26h 4m 5s");
    expect(
      withoutIsolateMarks(
        formatSlaCountdown(((26 * 60 + 4) * 60 + 5) * 1000, {
          translator: translators["fa"],
        }),
      ),
    ).toBe(`۲۶${NB}ساعت ۴${NB}دقیقه ۵${NB}ثانیه`);
    // Without a translator: English, as a test reads it.
    expect(formatSlaCountdown(65_000)).toBe("1m 5s");
  });

  test("a discovery scan's run time", () => {
    const said: (milliseconds: number) => Said = (milliseconds: number) => {
      return inEachLanguage((t: Translator): string => {
        return formatDiscoveryDuration(milliseconds, t);
      });
    };

    expect(said(59_000)).toEqual({
      en: "59s",
      de: `59${NB}Sek.`,
      ar: `59${NB}ث`,
      fa: `۵۹${NB}ثانیه`,
    });
    expect(said(61_000)).toEqual({
      en: "1m 1s",
      de: `1${NB}Min. 1${NB}s`,
      ar: `1${NB}د 1${NB}ث`,
      fa: `۱${NB}دقیقه ۱${NB}ثانیه`,
    });
    expect(said(90_061_000)).toEqual({
      en: "25h 1m",
      de: `25${NB}Std. 1${NB}Min.`,
      ar: `25${NB}س 1${NB}د`,
      fa: `۲۵${NB}ساعت ۱${NB}دقیقه`,
    });
    // Without a translator: English, word for word as before.
    expect(formatDiscoveryDuration(7_200_000)).toBe("2h 0m");
  });

  test("a scan's run time in a sentence the reader's language has not worded reads English", () => {
    const persian: string = formatDiscoveryDuration(61_000, translators["fa"]);

    expect(getEnglishOf(persian)).toBe("1m 1s");
  });

  test("an on-call shift's length", () => {
    const said: (seconds: number) => Said = (seconds: number): Said => {
      return inEachLanguage((t: Translator): string => {
        return formatDurationFromSeconds(seconds, t);
      });
    };

    expect(said(5 * 86400 + 12 * 3600)).toEqual({
      en: "5d 12h",
      de: `5${NB}T. 12${NB}Std.`,
      ar: `5${NB}ي 12${NB}س`,
      fa: `۵${NB}روز ۱۲${NB}ساعت`,
    });
    expect(said(8 * 3600 + 30 * 60)).toEqual({
      en: "8h 30m",
      de: `8${NB}Std. 30${NB}Min.`,
      ar: `8${NB}س 30${NB}د`,
      fa: `۸${NB}ساعت ۳۰${NB}دقیقه`,
    });
    expect(said(24 * 3600).en).toBe("1d");
    expect(said(7 * 86400 - 1).en).toBe("7d");
    expect(said(45 * 60).fa).toBe(`۴۵${NB}دقیقه`);
    // Under a minute still reads a minute, never nothing.
    expect(said(20)).toEqual({
      en: "1m",
      de: `1${NB}Min.`,
      ar: `1${NB}د`,
      fa: `۱${NB}دقیقه`,
    });
    expect(said(0).en).toBe("0m");
    expect(said(0).fa).toBe(`۰${NB}دقیقه`);

    expect(
      withoutIsolateMarks(
        formatShiftDuration(
          new Date("2026-11-15T09:00:00.000Z"),
          new Date("2026-11-15T17:30:00.000Z"),
          translators["de"],
        ),
      ),
    ).toBe(`8${NB}Std. 30${NB}Min.`);
  });
});

describe("lengths and ranges: a journey, a profile's range, a telemetry window, a workflow step", () => {
  test("a journey's length", () => {
    const said: (milliseconds: number) => Said = (milliseconds: number) => {
      return inEachLanguage((t: Translator): string => {
        return formatUserFlowDuration(milliseconds, t);
      });
    };

    expect(said(42_000)).toEqual({
      en: "42s",
      de: `42${NB}Sek.`,
      ar: `42${NB}ث`,
      fa: `۴۲${NB}ثانیه`,
    });
    expect(said(125_000)).toEqual({
      en: "2m 5s",
      de: `2${NB}Min. 5${NB}s`,
      ar: `2${NB}د 5${NB}ث`,
      fa: `۲${NB}دقیقه ۵${NB}ثانیه`,
    });
    expect(said(120_000).en).toBe("2m");
    expect(said(5_400_000)).toEqual({
      en: "1h 30m",
      de: `1${NB}Std. 30${NB}Min.`,
      ar: `1${NB}س 30${NB}د`,
      fa: `۱${NB}ساعت ۳۰${NB}دقیقه`,
    });
    expect(said(3_600_000).en).toBe("1h");
    expect(formatUserFlowDuration(0, translators["fa"])).toBe("—");
  });

  test("a profile's range buttons", () => {
    const said: (minutes: number) => Said = (minutes: number): Said => {
      return inEachLanguage((t: Translator): string => {
        return getRangeLabel(minutes, t);
      });
    };

    expect(said(15)).toEqual({
      en: "15m",
      de: `15${NB}Min.`,
      ar: `15${NB}د`,
      fa: `۱۵${NB}دقیقه`,
    });
    expect(said(360)).toEqual({
      en: "6h",
      de: `6${NB}Std.`,
      ar: `6${NB}س`,
      fa: `۶${NB}ساعت`,
    });
    expect(said(7 * 24 * 60)).toEqual({
      en: "7d",
      de: `7${NB}Tg.`,
      ar: `7${NB}ي`,
      fa: `۷${NB}روز`,
    });
  });

  test("a telemetry rule's stored window no option has", () => {
    const labelOf: (translator: Translator, seconds: number) => string = (
      translator: Translator,
      seconds: number,
    ): string => {
      return withoutIsolateMarks(
        getWindowOptions(seconds, translator).find(
          (option: TelemetryRuleWindowOption): boolean => {
            return option.value === seconds;
          },
        )?.label || "",
      );
    };

    expect(labelOf(translators["en"]!, 90)).toBe("90s");
    expect(labelOf(translators["de"]!, 90)).toBe(`90${NB}Sek.`);
    expect(labelOf(translators["ar"]!, 90)).toBe(`90${NB}ث`);
    expect(labelOf(translators["fa"]!, 90)).toBe(`۹۰${NB}ثانیه`);
    expect(labelOf(translators["en"]!, 1.5)).toBe("1.5s");
  });

  test("a workflow step's length", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatWorkflowStepDuration(1500, t);
      }),
    ).toEqual({
      en: "1.5s",
      de: `1,5${NB}Sek.`,
      ar: `1.5${NB}ث`,
      fa: `۱٫۵${NB}ثانیه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return formatWorkflowStepDuration(90_000, t);
      }),
    ).toEqual({
      en: "1m 30s",
      de: `1${NB}Min. 30${NB}s`,
      ar: `1${NB}د 30${NB}ث`,
      fa: `۱${NB}دقیقه ۳۰${NB}ثانیه`,
    });

    // Under a second: the product's milliseconds, in the reader's words.
    const underASecond: Said = inEachLanguage((t: Translator): string => {
      return formatWorkflowStepDuration(412, t);
    });

    expect(underASecond.en).toBe(`412${NB}ms`);
    expectNoLatinIn(underASecond);
  });
});

describe("session replay: a session's length, a filter chip, watched time", () => {
  test("a session's length reads in a list's row as on the card it opens", () => {
    for (const milliseconds of [45_000, 12 * 60_000 + 5000, 90 * 60_000]) {
      for (const language of LANGUAGES) {
        const translator: Translator = translators[language]!;

        expect(formatSessionDuration(milliseconds, translator)).toBe(
          describeReplayDuration(milliseconds, translator),
        );
      }
    }
  });

  test("a session's length: English as the lists wrote it, every other language as the player does", () => {
    expect(formatSessionDuration(45_000, translators["en"])).toBe("45s");
    expect(formatSessionDuration(12 * 60_000 + 5000, translators["en"])).toBe(
      "12m 05s",
    );
    expect(formatSessionDuration(90 * 60_000, translators["en"])).toBe(
      "1h 30m",
    );
    expect(formatSessionDuration(2 * 3600_000 + 5 * 60_000)).toBe("2h 05m");

    for (const language of ["de", "ar", "fa"]) {
      expect(
        formatSessionDuration(12 * 60_000 + 5000, translators[language]),
      ).toBe(formatDurationCompactInLanguage(12 * 60 + 5, language));
    }

    const persian: string = formatSessionDuration(
      12 * 60_000 + 5000,
      translators["fa"],
    );

    expect(LATIN.test(persian)).toBe(false);
    // Nothing measured yet is a dash, in every language.
    expect(formatSessionDuration(0, translators["fa"])).toBe("—");
  });

  test("an audit row's session length is the reader's", () => {
    const summary: SessionReplayAuditSummary = {
      sessionId: "3f9a2c1b-session",
      startTime: "2026-11-15T09:00:00.000Z",
      durationMs: 12 * 60_000 + 5000,
      entryUrl: "https://shop.example.com/checkout",
      browserName: "Chrome",
      browserVersion: "128",
      osName: "macOS",
      deviceType: "Desktop",
    };

    expect(
      describeSessionReplayAuditSession({
        sessionId: "3f9a2c1b-session",
        summary: summary,
      }).durationLabel,
    ).toBe("12m 05s");
    expect(
      describeSessionReplayAuditSession({
        sessionId: "3f9a2c1b-session",
        summary: summary,
        translator: translators["fa"],
      }).durationLabel,
    ).toBe(formatDurationCompactInLanguage(12 * 60 + 5, "fa"));
  });

  test("the minimum duration's filter chip", () => {
    const chipOf: (seconds: string, translator?: Translator) => string = (
      seconds: string,
      translator?: Translator,
    ): string => {
      return withoutIsolateMarks(
        buildSessionReplayFilterChips(
          { ...EMPTY_ADVANCED_FILTERS, minDurationSeconds: seconds },
          { translator: translator },
        ).find((chip: { field: string }) => {
          return chip.field === "minDurationSeconds";
        })?.text || "",
      );
    };

    expect(chipOf("30")).toBe(">= 30s");
    expect(chipOf("2.5")).toBe(">= 2.5s");
    expect(chipOf("30", translators["en"])).toBe(">= 30s");
    expect(chipOf("30", translators["de"])).toBe(`>= 30${NB}Sek.`);
    expect(chipOf("30", translators["ar"])).toBe(`>= 30${NB}ث`);
    expect(chipOf("30", translators["fa"])).toBe(`>= ۳۰${NB}ثانیه`);
    expect(chipOf("2.5", translators["de"])).toBe(`>= 2,5${NB}Sek.`);
  });

  test("how long someone watched a session", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return describeSecondsWatched(45, t);
      }),
    ).toEqual({
      en: "45s",
      de: `45${NB}Sek.`,
      ar: `45${NB}ث`,
      fa: `۴۵${NB}ثانیه`,
    });
    // Under one heartbeat bucket: less than the bucket, never nothing.
    expect(
      inEachLanguage((t: Translator): string => {
        return describeSecondsWatched(0, t);
      }),
    ).toEqual({
      en: "< 15s",
      de: `< 15${NB}Sek.`,
      ar: `< 15${NB}ث`,
      fa: `< ۱۵${NB}ثانیه`,
    });
    expect(describeSecondsWatched(null, translators["en"])).toBe("< 15s");
  });
});
