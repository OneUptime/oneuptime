import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import { createTranslator, Translator } from "../../../Types/Translator";
import { WorkspaceSummaryTestChannel } from "../../../Types/Workspace/NotificationSummary/WorkspaceSummaryTestChannel";
import { BulkItemGroup } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import WorkspaceSummaryTestFailure, {
  getChannelsNotPostedIn,
  getNotPostedGroups,
  getWorkspaceSummaryTestLead,
  getWorkspaceSummaryTestNextStep,
  isOneReasonForEveryChannel,
  WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID,
  WORKSPACE_SUMMARY_TEST_NEXT_STEP,
  WORKSPACE_SUMMARY_TEST_NOT_POSTED,
  WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTestFailure";

/*
 * #6920: Send Test Now's Test Failed, channel by channel. The test route
 * answers each channel of the summary and what became of the test there;
 * the dialog says how many channels did not get it, in the reader's
 * language, then lists each under the reason the workspace gave - in its
 * own words - and ends with what to do next. Channels that share a reason
 * are listed under it once; a reason every channel shares (a project not
 * connected) is said once, without the names the line above has counted.
 *
 * The dialog around it is WorkspaceSummarySendTestResult.test.tsx.
 */

const NOT_FOUND: (name: string) => string = (name: string): string => {
  return `The Slack channel ${name} was not found. If it is a private channel, invite OneUptime's bot to it in Slack.`;
};

const NOT_CONNECTED: string =
  "This project is not connected to Slack. Please ask a project admin to connect Slack in Project Settings > Workspace > Slack.";

function posted(channelName: string): WorkspaceSummaryTestChannel {
  return { channelName: channelName, isPosted: true };
}

function notPosted(
  channelName: string,
  reason?: string,
): WorkspaceSummaryTestChannel {
  return { channelName: channelName, isPosted: false, reason: reason };
}

// The English, as a front end without its locales reads it.
const ENGLISH: Translator = createTranslator(undefined, "en");

const DE: Record<string, string> = readDashboardLocale("de");
const AR: Record<string, string> = readDashboardLocale("ar");

// The texts the failure says, as the Dashboard looks them up.
const FAILURE_KEYS: Array<string> = [
  WORKSPACE_SUMMARY_TEST_NOT_POSTED.other,
  `${WORKSPACE_SUMMARY_TEST_NOT_POSTED.other}_one`,
  WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME.other,
  `${WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME.other}_one`,
  WORKSPACE_SUMMARY_TEST_NEXT_STEP.other,
  `${WORKSPACE_SUMMARY_TEST_NEXT_STEP.other}_one`,
  "and {{remaining}} more",
];

function texts(testId: string): Array<string> {
  return screen.queryAllByTestId(testId).map((element: HTMLElement): string => {
    return element.textContent || "";
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

describe("the channels a test was not posted in", () => {
  test("only those not posted in, in the summary's order", () => {
    expect(
      getChannelsNotPostedIn([
        notPosted("#b", "x"),
        posted("#ops"),
        notPosted("#a", "y"),
      ]).map((channel: WorkspaceSummaryTestChannel): string => {
        return channel.channelName;
      }),
    ).toEqual(["#b", "#a"]);
    expect(getChannelsNotPostedIn([posted("#ops")])).toEqual([]);
    expect(getChannelsNotPostedIn([])).toEqual([]);
  });

  test("grouped under their reasons, in the order each reason first came up; the channels posted in left out", () => {
    const groups: Array<BulkItemGroup> = getNotPostedGroups([
      notPosted("#sre", "ratelimited"),
      posted("#ops"),
      notPosted("#gone", NOT_FOUND("#gone")),
      notPosted("#dev", "ratelimited"),
    ]);

    expect(groups).toEqual([
      { names: ["#sre", "#dev"], message: "ratelimited" },
      { names: ["#gone"], message: NOT_FOUND("#gone") },
    ]);
  });

  test("reasons are compared as the workspace wrote them: two different words are two groups", () => {
    expect(
      getNotPostedGroups([
        notPosted("#a", "ratelimited"),
        notPosted("#b", "Ratelimited"),
      ]),
    ).toHaveLength(2);
  });

  test("a channel without a reason is a group of its own, with none to say", () => {
    expect(getNotPostedGroups([notPosted("#a")])).toEqual([
      { names: ["#a"], message: "" },
    ]);
  });
});

describe("whether the channels' names go unsaid: one reason, every channel", () => {
  test.each([
    [
      "two channels, neither posted in, for one reason",
      [notPosted("#a", NOT_CONNECTED), notPosted("#b", NOT_CONNECTED)],
      true,
    ],
    [
      "twelve channels, none posted in, for one reason",
      Array.from({ length: 12 }, (_value: unknown, index: number) => {
        return notPosted(`#team-${index + 1}`, NOT_CONNECTED);
      }),
      true,
    ],
    [
      "the one channel of a summary: its name is kept",
      [notPosted("#gone", NOT_FOUND("#gone"))],
      false,
    ],
    [
      "one reason, but a channel was posted in",
      [
        notPosted("#a", "ratelimited"),
        notPosted("#b", "ratelimited"),
        posted("#ops"),
      ],
      false,
    ],
    [
      "every channel, each for its own reason",
      [notPosted("#a", "ratelimited"), notPosted("#b", NOT_FOUND("#b"))],
      false,
    ],
    ["every channel posted in", [posted("#a"), posted("#b")], false],
    ["no channels", [], false],
  ])(
    "%s: %s",
    (
      _name: string,
      channels: Array<WorkspaceSummaryTestChannel>,
      isLeftOut: boolean,
    ) => {
      expect(isOneReasonForEveryChannel(channels)).toBe(isLeftOut);
    },
  );
});

describe("the red line: how many channels did not get the test", () => {
  test("none to say when every channel got it", () => {
    expect(
      getWorkspaceSummaryTestLead(ENGLISH, [posted("#a"), posted("#b")]),
    ).toBeUndefined();
    expect(getWorkspaceSummaryTestLead(ENGLISH, [])).toBeUndefined();
  });

  test("the one channel of a summary", () => {
    expect(
      getWorkspaceSummaryTestLead(ENGLISH, [
        notPosted("#gone", NOT_FOUND("#gone")),
      ]),
    ).toBe("The test summary was not posted.");
  });

  test("every channel of a summary of more", () => {
    expect(
      getWorkspaceSummaryTestLead(ENGLISH, [
        notPosted("#a", NOT_CONNECTED),
        notPosted("#b", NOT_CONNECTED),
        notPosted("#c", "ratelimited"),
      ]),
    ).toBe("The test summary was not posted in any of its 3 channels.");
  });

  test("some of its channels: how many of how many", () => {
    expect(
      getWorkspaceSummaryTestLead(ENGLISH, [
        posted("#ops"),
        notPosted("#gone", NOT_FOUND("#gone")),
      ]),
    ).toBe("The test summary was not posted in 1 of its 2 channels.");
    expect(
      getWorkspaceSummaryTestLead(ENGLISH, [
        notPosted("#a", "x"),
        posted("#ops"),
        notPosted("#b", "y"),
        notPosted("#c", "z"),
      ]),
    ).toBe("The test summary was not posted in 3 of its 4 channels.");
  });

  test("numbers as the reader writes them", () => {
    const channels: Array<WorkspaceSummaryTestChannel> = Array.from(
      { length: 1500 },
      (_value: unknown, index: number) => {
        return index < 1200
          ? notPosted(`#c-${index}`, "ratelimited")
          : posted(`#c-${index}`);
      },
    );

    expect(getWorkspaceSummaryTestLead(ENGLISH, channels)).toBe(
      "The test summary was not posted in 1,200 of its 1,500 channels.",
    );
    expect(
      getWorkspaceSummaryTestLead(dashboardTranslator("de"), channels),
    ).toBe(
      "Die Testzusammenfassung wurde in 1.200 von 1.500 Kanälen nicht gepostet.",
    );
  });

  test("German: its one form for the one channel, its general form for more", () => {
    const de: Translator = dashboardTranslator("de");

    expect(
      getWorkspaceSummaryTestLead(de, [notPosted("#gone", NOT_FOUND("#gone"))]),
    ).toBe("Die Testzusammenfassung wurde nicht gepostet.");
    expect(
      getWorkspaceSummaryTestLead(de, [
        notPosted("#a", NOT_CONNECTED),
        notPosted("#b", NOT_CONNECTED),
      ]),
    ).toBe("Die Testzusammenfassung wurde in keinem ihrer 2 Kanäle gepostet.");
    expect(
      getWorkspaceSummaryTestLead(de, [posted("#ops"), notPosted("#gone")]),
    ).toBe("Die Testzusammenfassung wurde in 1 von 2 Kanälen nicht gepostet.");
  });

  test("Russian: 21 channels read as Russian reads 21 - its one form where it names the count, never the sentence for exactly one", () => {
    const ru: Translator = dashboardTranslator("ru");
    const allOf21: Array<WorkspaceSummaryTestChannel> = Array.from(
      { length: 21 },
      (_value: unknown, index: number) => {
        return notPosted(`#c-${index}`, NOT_CONNECTED);
      },
    );
    const threeOf21: Array<WorkspaceSummaryTestChannel> = allOf21.map(
      (channel: WorkspaceSummaryTestChannel, index: number) => {
        return index < 3 ? channel : posted(channel.channelName);
      },
    );

    expect(getWorkspaceSummaryTestLead(ru, allOf21)).toBe(
      "Тестовая сводка не опубликована ни в одном из каналов (всего 21).",
    );
    expect(getWorkspaceSummaryTestLead(ru, threeOf21)).toBe(
      "Тестовая сводка не опубликована в 3 из 21 канала.",
    );
    expect(
      getWorkspaceSummaryTestLead(ru, [notPosted("#gone", NOT_FOUND("#gone"))]),
    ).toBe("Тестовая сводка не опубликована.");
  });

  /*
   * A language with no one form reads its general sentence for the one
   * channel of a summary too, so that sentence is worded for any count:
   * "not posted in any channel (1 in all)", never "in none of its 1
   * channels".
   */
  test.each([
    [
      "ja",
      "テストサマリーはどのチャネルにも投稿されませんでした（全 1 チャネル）。",
    ],
    ["ko", "테스트 요약이 어느 채널에도 게시되지 않았습니다(총 1개 채널)."],
    ["zh-CN", "测试摘要未发布到任何频道（共 1 个频道）。"],
    ["zh-TW", "測試摘要未發布到任何頻道（共 1 個頻道）。"],
  ])(
    "%s, which has no one form: the one channel reads its general sentence, worded for any count",
    (language: string, expected: string) => {
      expect(
        getWorkspaceSummaryTestLead(dashboardTranslator(language), [
          notPosted("#gone", NOT_FOUND("#gone")),
        ]),
      ).toBe(expected);
    },
  );

  test("Arabic: Latin digits, in the general form for two (Arabic's own form for two is the general one here)", () => {
    expect(
      getWorkspaceSummaryTestLead(dashboardTranslator("ar"), [
        posted("#ops"),
        notPosted("#gone", NOT_FOUND("#gone")),
      ]),
    ).toBe(
      AR[WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME.other]!.replace(
        "{{failed}}",
        "1",
      ).replace("{{count}}", "2"),
    );
  });
});

describe("what to do next", () => {
  test("one reason: the problem; more: the problems", () => {
    expect(getWorkspaceSummaryTestNextStep(ENGLISH, 1)).toBe(
      "Fix the problem above, then send the test again.",
    );
    expect(getWorkspaceSummaryTestNextStep(ENGLISH, 2)).toBe(
      "Fix the problems above, then send the test again.",
    );
    expect(getWorkspaceSummaryTestNextStep(ENGLISH, 7)).toBe(
      "Fix the problems above, then send the test again.",
    );
  });

  test("no reason counted is said as one: there is still a problem to fix", () => {
    expect(getWorkspaceSummaryTestNextStep(ENGLISH, 0)).toBe(
      "Fix the problem above, then send the test again.",
    );
  });

  test("in the reader's language", () => {
    expect(getWorkspaceSummaryTestNextStep(dashboardTranslator("de"), 1)).toBe(
      "Beheben Sie das oben genannte Problem und senden Sie den Test dann erneut.",
    );
    expect(getWorkspaceSummaryTestNextStep(dashboardTranslator("de"), 3)).toBe(
      "Beheben Sie die oben genannten Probleme und senden Sie den Test dann erneut.",
    );
  });
});

describe("the list", () => {
  test("each channel not posted in, its name over the workspace's reason; a channel posted in is not listed", () => {
    render(
      <WorkspaceSummaryTestFailure
        channels={[
          posted("#ops"),
          notPosted("#gone", NOT_FOUND("#gone")),
          notPosted("#ops-archive", "Error from Slack is_archived"),
        ]}
      />,
    );

    expect(
      screen.getAllByTestId(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-group`),
    ).toHaveLength(2);
    expect(texts(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-name`)).toEqual([
      "#gone",
      "#ops-archive",
    ]);
    expect(texts(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`)).toEqual([
      NOT_FOUND("#gone"),
      "Error from Slack is_archived",
    ]);
    expect(screen.queryByText("#ops")).toBeNull();
    expect(
      screen.getByTestId("workspace-summary-test-next-step"),
    ).toHaveTextContent("Fix the problems above, then send the test again.");
  });

  test("each name above its reason, and the next step after the list", () => {
    render(
      <WorkspaceSummaryTestFailure
        channels={[notPosted("#gone", NOT_FOUND("#gone"))]}
      />,
    );

    const name: HTMLElement = screen.getByTestId(
      `${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-name`,
    );
    const reason: HTMLElement = screen.getByTestId(
      `${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`,
    );
    const nextStep: HTMLElement = screen.getByTestId(
      "workspace-summary-test-next-step",
    );

    expect(
      name.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      reason.compareDocumentPosition(nextStep) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(nextStep).toHaveTextContent(
      "Fix the problem above, then send the test again.",
    );
  });

  test("channels that share a reason are listed under it once", () => {
    render(
      <WorkspaceSummaryTestFailure
        channels={[
          notPosted("#a", "ratelimited"),
          posted("#ops"),
          notPosted("#b", "ratelimited"),
          notPosted("#gone", NOT_FOUND("#gone")),
        ]}
      />,
    );

    const groups: Array<HTMLElement> = screen.getAllByTestId(
      `${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-group`,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveTextContent(/^#a#bratelimited$/);
    expect(texts(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`)).toEqual([
      "ratelimited",
      NOT_FOUND("#gone"),
    ]);
  });

  test("one reason for every channel: said once, without the names", () => {
    render(
      <WorkspaceSummaryTestFailure
        channels={Array.from(
          { length: 12 },
          (_value: unknown, index: number) => {
            return notPosted(`#team-${index + 1}`, NOT_CONNECTED);
          },
        )}
      />,
    );

    expect(
      screen.getAllByTestId(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-group`),
    ).toHaveLength(1);
    expect(
      screen.queryAllByTestId(
        `${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-name`,
      ),
    ).toHaveLength(0);
    expect(screen.queryByText(/more$/)).toBeNull();
    expect(texts(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`)).toEqual([
      NOT_CONNECTED,
    ]);
    expect(
      screen.getByTestId("workspace-summary-test-next-step"),
    ).toHaveTextContent("Fix the problem above, then send the test again.");
  });

  test("a long run of channels for one reason, with one posted in: the first eight, then how many more", () => {
    render(
      <WorkspaceSummaryTestFailure
        channels={[
          posted("#ops"),
          ...Array.from({ length: 12 }, (_value: unknown, index: number) => {
            return notPosted(`#team-${index + 1}`, "ratelimited");
          }),
        ]}
      />,
    );

    expect(texts(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-name`)).toEqual([
      "#team-1",
      "#team-2",
      "#team-3",
      "#team-4",
      "#team-5",
      "#team-6",
      "#team-7",
      "#team-8",
    ]);
    expect(screen.getByText("and 4 more")).toBeInTheDocument();
    expect(texts(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`)).toEqual([
      "ratelimited",
    ]);
  });

  test("nine channels for one reason are all named: and 1 more would take the line the name would", () => {
    render(
      <WorkspaceSummaryTestFailure
        channels={[
          posted("#ops"),
          ...Array.from({ length: 9 }, (_value: unknown, index: number) => {
            return notPosted(`#team-${index + 1}`, "ratelimited");
          }),
        ]}
      />,
    );

    expect(
      screen.getAllByTestId(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-name`),
    ).toHaveLength(9);
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  test("a channel without a reason is named, with no empty line under it", () => {
    render(<WorkspaceSummaryTestFailure channels={[notPosted("#a")]} />);

    expect(texts(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-name`)).toEqual([
      "#a",
    ]);
    expect(
      screen.queryAllByTestId(
        `${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`,
      ),
    ).toHaveLength(0);
  });

  test("a long name or reason wraps inside the dialog, never past its edge", () => {
    const long: string =
      "#incidents-eu-west-1-payments-and-billing-escalations-and-more";

    render(
      <WorkspaceSummaryTestFailure
        channels={[posted("#ops"), notPosted(long, NOT_FOUND(long))]}
      />,
    );

    for (const testId of [
      `${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-name`,
      `${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`,
    ]) {
      expect(screen.getByTestId(testId).className).toContain(
        "[overflow-wrap:anywhere]",
      );
    }
  });
});

describe("the list in the reader's language", () => {
  test("German: what to do next in German; the names and the workspace's reasons as they were written", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    render(
      <WorkspaceSummaryTestFailure
        channels={[
          posted("#ops"),
          ...Array.from({ length: 10 }, (_value: unknown, index: number) => {
            return notPosted(`#team-${index + 1}`, "ratelimited");
          }),
        ]}
      />,
    );

    expect(
      screen.getByTestId("workspace-summary-test-next-step"),
    ).toHaveTextContent(DE[`${WORKSPACE_SUMMARY_TEST_NEXT_STEP.other}_one`]!);
    expect(
      screen.getByText(
        DE["and {{remaining}} more"]!.replace("{{remaining}}", "2"),
      ),
    ).toBeInTheDocument();
    expect(texts(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`)).toEqual([
      "ratelimited",
    ]);
  });

  test("Arabic: the English names and reasons read left to right, each a line of its own; on an English page they take no direction", async () => {
    const channels: Array<WorkspaceSummaryTestChannel> = [
      posted("#ops"),
      notPosted("#gone", NOT_FOUND("#gone")),
    ];

    render(<WorkspaceSummaryTestFailure channels={channels} />);

    expect(
      screen
        .getByTestId(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`)
        .getAttribute("dir"),
    ).toBeNull();

    cleanup();

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ar");
    });

    render(<WorkspaceSummaryTestFailure channels={channels} />);

    expect(
      screen
        .getByTestId(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-name`)
        .getAttribute("dir"),
    ).toBe("ltr");
    expect(
      screen
        .getByTestId(`${WORKSPACE_SUMMARY_TEST_CHANNELS_TEST_ID}-reason`)
        .getAttribute("dir"),
    ).toBe("ltr");
    expect(
      screen.getByTestId("workspace-summary-test-next-step"),
    ).toHaveTextContent(AR[`${WORKSPACE_SUMMARY_TEST_NEXT_STEP.other}_one`]!);
  });
});

describe("every Dashboard language words the failure", () => {
  test.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
    expect(
      FAILURE_KEYS.filter((key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      }),
    ).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps each sentence's numbers",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words[WORKSPACE_SUMMARY_TEST_NOT_POSTED.other]).toContain(
        "{{count}}",
      );
      expect(words[WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME.other]).toContain(
        "{{count}}",
      );
      expect(words[WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME.other]).toContain(
        "{{failed}}",
      );
      expect(
        words[`${WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME.other}_one`],
      ).toContain("{{failed}}");
    },
  );

  test("the English the Dashboard looks up is the English the dialog says", () => {
    const en: Record<string, string> = readDashboardLocale("en");

    for (const template of [
      WORKSPACE_SUMMARY_TEST_NOT_POSTED,
      WORKSPACE_SUMMARY_TEST_NOT_POSTED_IN_SOME,
      WORKSPACE_SUMMARY_TEST_NEXT_STEP,
    ]) {
      expect(en[template.other]).toBe(template.other);
      expect(en[`${template.other}_one`]).toBe(template.one);
    }
  });
});
