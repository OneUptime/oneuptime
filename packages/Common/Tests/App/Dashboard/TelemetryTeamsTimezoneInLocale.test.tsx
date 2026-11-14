/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { AutoRefreshInterval } from "../../../Types/Dashboard/DashboardViewConfig";
import { createTranslator, Translator } from "../../../Types/Translator";
import MonitorSummaryProbeUtil from "../../../Utils/Monitor/MonitorSummaryProbeUtil";
import UserUtil from "../../../UI/Utils/User";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE TELEMETRY OVERVIEWS' REFRESH CONTROL, A TRACE PIPELINE'S PROCESSOR
 * FORM, A USER'S TEAMS, THE PROBE PICKER AND THE TIMEZONE PROMPT IN THE
 * READER'S LANGUAGE - from the Dashboard's shipped locale files (#6658,
 * part 3).
 *
 * A German or Arabic reader used to meet "Next refresh in 5 seconds",
 * "Every 30s", "Name is required.", "No teams.", "Checkout (disabled)",
 * "Design, Ops and 3 more" and "We have detected that your timezone is
 * different..." in English. Each is now looked up whole, its count written
 * and its plural chosen the reader's way.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

function translatorFor(
  locale: Record<string, string>,
  language: string,
): Translator {
  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

function shown(element: Element): string {
  return withoutIsolateMarks(element.textContent || "");
}

let mockUpdates: Array<JSONObject> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (request: { data: JSONObject }): Promise<unknown> => {
        mockUpdates.push(request.data);
        return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
      },
      create: (): Promise<unknown> => {
        return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import AutoRefreshControl from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl";
import TraceProcessorForm, {
  MAPPING_ARROW_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TracePipeline/TraceProcessorForm";
import TraceRecordingRuleDefinitionEditor from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/RecordingRule/TraceRecordingRuleDefinitionEditor";
import TracePipelineProcessor from "../../../Models/DatabaseModels/TracePipelineProcessor";
import TracePipelineProcessorType from "../../../Types/Trace/TracePipelineProcessorType";
import TeamsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamsElement";
import UserTimezoneInit from "../../../../App/FeatureSet/Dashboard/src/Components/UserTimezone/UserTimezoneInit";
import TeamMembershipRemoval from "../../../../App/FeatureSet/Dashboard/src/Utils/TeamMembershipRemoval";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
  mockUpdates = [];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function renderRefresh(interval: AutoRefreshInterval): void {
  render(
    <AutoRefreshControl
      autoRefreshInterval={interval}
      onAutoRefreshIntervalChange={(): void => {
        return;
      }}
      onManualRefresh={(): void => {
        return;
      }}
      isRefreshing={false}
      lastRefreshedAt={new Date()}
    />,
  );
}

describe("the telemetry overviews' refresh control in German and Arabic", () => {
  test("German: the countdown, the intervals and the buttons", () => {
    renderRefresh(AutoRefreshInterval.THIRTY_SECONDS);

    const countdown: HTMLElement = document.querySelector(
      "span[title]",
    ) as HTMLElement;

    expect(countdown.getAttribute("title")).toBe(
      worded(DE, "Next refresh in {{count}} seconds", { count: "30" }),
    );

    const select: HTMLElement = screen.getByLabelText(
      worded(DE, "Auto-refresh"),
    );
    const options: Array<string> = Array.from(
      select.querySelectorAll("option"),
    ).map((option: HTMLOptionElement): string => {
      return option.textContent || "";
    });

    expect(options[0]).toBe(worded(DE, "Off"));
    expect(options).toContain(
      worded(DE, "Every {{interval}}", { interval: "30s" }),
    );
    expect(options.join(" ")).not.toContain("Every");
    expect(screen.getByTitle(worded(DE, "Refresh now"))).toBeInTheDocument();
  });

  test("Arabic: the countdown's one-second form, in Arabic", async () => {
    await i18next.changeLanguage("ar");
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));

    render(
      <AutoRefreshControl
        autoRefreshInterval={AutoRefreshInterval.FIVE_SECONDS}
        onAutoRefreshIntervalChange={(): void => {
          return;
        }}
        onManualRefresh={(): void => {
          return;
        }}
        isRefreshing={false}
        lastRefreshedAt={new Date("2026-11-11T12:00:00.000Z")}
      />,
    );

    // Four and a bit seconds in, one second is left.
    act(() => {
      jest.advanceTimersByTime(4200);
    });

    const countdown: HTMLElement = document.querySelector(
      "span[title]",
    ) as HTMLElement;

    expect(withoutIsolateMarks(countdown.getAttribute("title") || "")).toBe(
      worded(AR, "Next refresh in {{count}} seconds_one", {
        count: translatorFor(AR, "ar").formatNumber(1),
      }),
    );
    expect(countdown.getAttribute("title")).not.toContain("Next refresh");
  });
});

describe("a trace pipeline's processor form in German and Arabic", () => {
  function renderForm(): void {
    render(
      <TraceProcessorForm
        pipelineId={new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90")}
        onProcessorSaved={(): void => {
          return;
        }}
        onCancel={(): void => {
          return;
        }}
      />,
    );
  }

  test("German: saving without a name says so in German", async () => {
    renderForm();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor((): void => {
      expect(
        screen.getByText(worded(DE, "Name is required.")),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Name is required.")).toBeNull();
  });

  test("Arabic: a name without a processor type says so in Arabic", async () => {
    await i18next.changeLanguage("ar");
    renderForm();

    const name: HTMLElement = document.querySelector(
      "input",
    ) as HTMLInputElement;

    fireEvent.change(name, { target: { value: "Rename spans" } });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor((): void => {
      expect(
        screen.getByText(worded(AR, "Please select a processor type.")),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Please select a processor type.")).toBeNull();
  });

  test("every message the form can show is translated in German and Arabic", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/TracePipeline/TraceProcessorForm.tsx",
      ),
      "utf8",
    );
    const validate: string = source.slice(
      source.indexOf("const validate:"),
      source.indexOf("const handleSave:"),
    );
    const messages: Array<string> = Array.from(
      new Set(
        Array.from(validate.matchAll(/translationKey\(\s*"([^"]+)"/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ),
    );

    // Every return of the validator is a key, none a bare English string.
    expect(validate).not.toMatch(/return "/);
    expect(messages).toHaveLength(8);

    for (const message of messages) {
      worded(DE, message);
      worded(AR, message);
    }
  });
});

describe("UI review: a processor's mapping arrow on a page read from the right", () => {
  function renderProcessor(type: TracePipelineProcessorType): void {
    const processor: TracePipelineProcessor = new TracePipelineProcessor();

    processor.name = "Map";
    processor.processorType = type;
    processor.configuration = {
      sourceKey: "http.status_code",
      mappings: [
        { matchValue: "500", newName: "error", statusCode: 2, kind: "server" },
      ],
    };

    render(
      <TraceProcessorForm
        pipelineId={new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90")}
        existingProcessor={processor}
        onProcessorSaved={(): void => {
          return;
        }}
        onCancel={(): void => {
          return;
        }}
      />,
    );
  }

  // The mapping row's arrows, as drawn: "→" or "←".
  function mappingArrows(): Array<Element> {
    return Array.from(document.querySelectorAll("span")).filter(
      (span: Element): boolean => {
        return ["→", "←"].includes(span.textContent?.trim() || "");
      },
    );
  }

  /*
   * The arrow is "←" on a page read from the right (DirectionArrow). A
   * class that mirrored it there as well would turn it back to point right.
   */
  test("the arrow is turned once, by the glyph the page's language draws", () => {
    expect(MAPPING_ARROW_CLASS_NAME).not.toMatch(/scale-x|rotate/);
  });

  test.each([
    TracePipelineProcessorType.SpanNameRemapper,
    TracePipelineProcessorType.StatusRemapper,
    TracePipelineProcessorType.SpanKindRemapper,
  ])(
    "Arabic: the %s's mapping row points from the match value, on the right, to what it becomes",
    async (type: string) => {
      await i18next.changeLanguage("ar");
      renderProcessor(type as TracePipelineProcessorType);

      const arrows: Array<Element> = mappingArrows();

      expect(
        arrows.map((arrow: Element): string => {
          return arrow.textContent || "";
        }),
      ).toEqual(["←"]);
      expect(arrows[0]!.className).toBe(MAPPING_ARROW_CLASS_NAME);
    },
  );

  test("English: the mapping row's arrow points right, as it did", async () => {
    await i18next.changeLanguage("en");
    renderProcessor(TracePipelineProcessorType.SpanNameRemapper);

    expect(
      mappingArrows().map((arrow: Element): string => {
        return arrow.textContent || "";
      }),
    ).toEqual(["→"]);
  });

  test("every mapping arrow in the form is the page's arrow, in the mapping arrow's class", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/TracePipeline/TraceProcessorForm.tsx",
      ),
      "utf8",
    );
    const arrows: Array<string> = Array.from(
      source.matchAll(/<DirectionArrow\s+className=\{([^}]*)\}\s*\/>/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(arrows).toEqual([
      "MAPPING_ARROW_CLASS_NAME",
      "MAPPING_ARROW_CLASS_NAME",
      "MAPPING_ARROW_CLASS_NAME",
    ]);
  });
});

describe("UI review: a recording rule's source count", () => {
  test("Arabic: '1 / 4' stays on one line beside the description, which wraps", async () => {
    await i18next.changeLanguage("ar");
    render(
      <TraceRecordingRuleDefinitionEditor
        value={undefined}
        onChange={(): void => {
          return;
        }}
      />,
    );

    const count: HTMLElement = screen.getByTestId(
      "trace-recording-rule-source-count",
    );

    expect(shown(count)).toMatch(/^1\s\/\s\d+$/);
    expect(count.className.split(" ")).toEqual(
      expect.arrayContaining(["shrink-0", "whitespace-nowrap"]),
    );
  });
});

describe("a user's teams and the team lists in German and Arabic", () => {
  test("German and Arabic: no teams", async () => {
    render(<TeamsElement teams={[]} />);

    expect(screen.getByText(worded(DE, "No teams."))).toBeInTheDocument();

    cleanup();
    await i18next.changeLanguage("ar");
    render(<TeamsElement teams={[]} />);

    expect(screen.getByText(worded(AR, "No teams."))).toBeInTheDocument();
    expect(screen.queryByText("No teams.")).toBeNull();
  });

  test("German: two teams joined by und, many with und N weitere", () => {
    const german: Translator = translatorFor(DE, "de");

    expect(
      TeamMembershipRemoval.formatNamesInLanguage(["Ops", "Design"], german),
    ).toBe(
      worded(DE, "{{first}} and {{second}}", {
        first: "Design",
        second: "Ops",
      }),
    );
    expect(
      TeamMembershipRemoval.formatNamesInLanguage(
        ["A", "B", "C", "D", "E", "F", "G"],
        german,
      ),
    ).toBe(
      worded(DE, "{{names}} and {{count}} more", {
        names: "A, B, C, D, E",
        count: "2",
      }),
    );
    expect(TeamMembershipRemoval.formatNamesInLanguage(["Ops"], german)).toBe(
      "Ops",
    );
    expect(TeamMembershipRemoval.formatNamesInLanguage([" ", ""], german)).toBe(
      "",
    );
  });

  test("Arabic: the same lists, joined the Arabic way", () => {
    const arabic: Translator = translatorFor(AR, "ar");

    expect(
      withoutIsolateMarks(
        TeamMembershipRemoval.formatNamesInLanguage(["Ops", "Design"], arabic),
      ),
    ).toBe(
      worded(AR, "{{first}} and {{second}}", {
        first: "Design",
        second: "Ops",
      }),
    );

    const many: string = withoutIsolateMarks(
      TeamMembershipRemoval.formatNamesInLanguage(
        ["A", "B", "C", "D", "E", "F", "G"],
        arabic,
      ),
    );

    expect(many).not.toContain(" and ");
    expect(many).not.toContain("more");
    expect(many).toContain("A، B");
  });
});

describe("the probe picker's options in German and Arabic", () => {
  const probes: Array<{ id: string; name: string; isEnabled: boolean }> = [
    { id: "p1", name: "Frankfurt", isEnabled: true },
    { id: "p2", name: "Checkout", isEnabled: false },
    { id: "p3", name: "", isEnabled: true },
  ];

  test("German: a disabled probe and an unnamed one", () => {
    expect(
      MonitorSummaryProbeUtil.getProbeDropdownOptions({
        probes: probes,
        translator: translatorFor(DE, "de"),
      }),
    ).toEqual([
      { label: "Frankfurt", value: "p1" },
      {
        label: worded(DE, "{{name}} (disabled)", { name: "Checkout" }),
        value: "p2",
      },
      { label: worded(DE, "Unknown"), value: "p3" },
    ]);
  });

  test("Arabic: the same options in Arabic, the probe's own name kept", () => {
    const options: Array<{ label: string; value: string }> =
      MonitorSummaryProbeUtil.getProbeDropdownOptions({
        probes: probes,
        translator: translatorFor(AR, "ar"),
      });

    expect(withoutIsolateMarks(options[1]!.label)).toBe(
      worded(AR, "{{name}} (disabled)", { name: "Checkout" }),
    );
    expect(options[2]!.label).toBe(worded(AR, "Unknown"));
  });

  test("without a translator the options stay English", () => {
    expect(
      MonitorSummaryProbeUtil.getProbeDropdownOptions({ probes: probes }),
    ).toEqual([
      { label: "Frankfurt", value: "p1" },
      { label: "Checkout (disabled)", value: "p2" },
      { label: "Unknown", value: "p3" },
    ]);
  });
});

describe("the timezone prompt in German and Arabic", () => {
  function promptFor(saved: string): void {
    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(true);
    jest
      .spyOn(UserUtil, "getSavedUserTimezone")
      .mockReturnValue(saved as Timezone);
    jest.spyOn(UserUtil, "getDismissedTimezonePrompt").mockReturnValue(null);
    jest
      .spyOn(UserUtil, "getUserId")
      .mockReturnValue(new ObjectID("33333333-3333-4333-8333-333333333333"));

    render(<UserTimezoneInit />);
  }

  test("German: the prompt asks in German, naming the timezone", async () => {
    promptFor("America/New_York");

    const modal: HTMLElement = await screen.findByTestId("modal");
    const sentence: string = shown(modal);
    const [before, after] = worded(
      DE,
      "We have detected that your timezone is different from the timezone you have saved in your profile. Would you like to update your timezone to {{timezone}}?",
    ).split("{{timezone}}");

    expect(sentence).toContain(before!);
    expect(sentence).toContain(after!);
    expect(sentence).not.toContain("We have detected");
  });

  test("Arabic: the prompt asks in Arabic", async () => {
    await i18next.changeLanguage("ar");
    promptFor("America/New_York");

    const modal: HTMLElement = await screen.findByTestId("modal");
    const [before] = worded(
      AR,
      "We have detected that your timezone is different from the timezone you have saved in your profile. Would you like to update your timezone to {{timezone}}?",
    ).split("{{timezone}}");

    expect(shown(modal)).toContain(before!);
    expect(shown(modal)).not.toContain("We have detected");
  });
});
