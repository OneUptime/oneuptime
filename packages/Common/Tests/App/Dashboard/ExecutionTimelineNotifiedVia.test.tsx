import NotifiedVia, {
  getNotifiedViaChannels,
  NOTIFIED_VIA_CHANNEL_ICONS,
  NOTIFIED_VIA_CHANNEL_LABELS,
  NOTIFIED_VIA_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/NotifiedVia";
import ExecutionLogTimelineTable from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";
import OnCallDutyPolicyExecutionLogTimeline from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import { isDashPlaceholder } from "Common/UI/Components/Table/TableEmptyValue";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  ON_CALL_PAGE_CHANNELS,
  OnCallPageChannel,
  OnCallPageChannelInfo,
} from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "NOTIFIED VIA" ON AN ON-CALL RUN'S EXECUTION TIMELINE (#6585).
 *
 * Each step of a run keeps the channels its page went out to its person by
 * (notificationChannels). The run's Execution Timeline shows them beside
 * "Notification Sent To", as small chips with the channel's icon, in the
 * Dashboard's language - and nothing for a step that reached nobody or
 * that was written before steps kept their channels.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

type Locale = Record<string, string>;

function locale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf-8"),
  ) as Locale;
}

// The language the stubbed translation hook reads, per test.
let language: Locale | null = null;

jest.mock("Common/UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value && language && language[value] ? language[value] : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

// The table's ModelTable, as the props it is drawn with.
let tableProps: Record<string, unknown> | null = null;

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      tableProps = props;
      return null;
    },
  };
});

beforeEach(() => {
  language = null;
  tableProps = null;
});

afterEach(() => {
  cleanup();
});

function chips(): Array<string> {
  return screen
    .queryAllByTestId("on-call-timeline-notified-via-channel")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

describe("a step's channels, as the Execution Timeline draws them", () => {
  test("a chip a channel, in the order the run's message lists them, each by its name", () => {
    render(
      <NotifiedVia
        channels={[
          OnCallPageChannel.Email,
          OnCallPageChannel.Push,
          OnCallPageChannel.Call,
          OnCallPageChannel.SMS,
        ]}
      />,
    );

    expect(chips()).toEqual([
      "Phone call",
      "SMS",
      "Push notification",
      "Email",
    ]);
    expect(screen.getByTestId("on-call-timeline-notified-via")).toBeTruthy();
  });

  test("each chip carries its channel's icon", () => {
    const view: RenderResult = render(
      <NotifiedVia
        channels={[OnCallPageChannel.Call, OnCallPageChannel.SMS]}
      />,
    );

    expect(
      view.container.querySelectorAll(
        '[data-testid="on-call-timeline-notified-via-channel"] svg',
      ),
    ).toHaveLength(2);
  });

  test("in the Dashboard's language", () => {
    language = locale("de");

    render(
      <NotifiedVia
        channels={[
          OnCallPageChannel.Call,
          OnCallPageChannel.Email,
          OnCallPageChannel.Push,
        ]}
      />,
    );

    expect(chips()).toEqual([
      "Telefonanruf",
      "Push-Benachrichtigung",
      "E-Mail",
    ]);
  });

  test.each([
    ["a step written before steps kept their channels", null],
    ["a step the API hands over without the column", undefined],
    ["a page that reached nobody", []],
    ["a list of nothing this build knows", ["Carrier Pigeon"]],
  ])(
    "%s shows a dash, as the table's other empty cells",
    (_name: string, value: unknown) => {
      const view: RenderResult = render(<NotifiedVia channels={value} />);

      expect(chips()).toEqual([]);
      expect(view.container.textContent).toBe("-");
    },
  );

  test("a channel this build does not know is left out; the ones it knows are drawn", () => {
    render(
      <NotifiedVia
        channels={["Carrier Pigeon", OnCallPageChannel.WhatsApp, 42]}
      />,
    );

    expect(chips()).toEqual(["WhatsApp"]);
  });

  test("the channels a step kept, read as the chips read them", () => {
    expect(
      getNotifiedViaChannels([
        OnCallPageChannel.Email,
        "Carrier Pigeon",
        OnCallPageChannel.Call,
      ]),
    ).toEqual([OnCallPageChannel.Call, OnCallPageChannel.Email]);
    expect(getNotifiedViaChannels(null)).toEqual([]);
    expect(getNotifiedViaChannels(undefined)).toEqual([]);
    expect(getNotifiedViaChannels("Call")).toEqual([]);
    expect(getNotifiedViaChannels([])).toEqual([]);
  });

  /*
   * Seen in a browser (#6585): one long row of seven chips took 344px of a
   * table that already scrolls beside the side menu, and in a squeezed
   * column "Push notification" broke inside its chip. The list wraps at
   * 16rem - two or three chips a line - and each chip keeps its name whole.
   */
  test("the chips wrap two or three to a line, each keeping its name on one line", () => {
    render(
      <NotifiedVia
        channels={[
          OnCallPageChannel.Call,
          OnCallPageChannel.SMS,
          OnCallPageChannel.Push,
          OnCallPageChannel.Email,
        ]}
      />,
    );

    const list: HTMLElement = screen.getByTestId(
      "on-call-timeline-notified-via",
    );
    expect(list.className.split(" ")).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "max-w-[16rem]"]),
    );

    for (const chip of screen.getAllByTestId(
      "on-call-timeline-notified-via-channel",
    )) {
      expect(chip.className.split(" ")).toContain("whitespace-nowrap");
      expect(chip.className).not.toMatch(/break-words|whitespace-normal/);
    }
  });

  test("every channel there is has a label and an icon of its own", () => {
    for (const info of ON_CALL_PAGE_CHANNELS) {
      expect(NOTIFIED_VIA_CHANNEL_LABELS[info.channel]).toBeTruthy();
      expect(Object.values(IconProp)).toContain(
        NOTIFIED_VIA_CHANNEL_ICONS[info.channel],
      );
    }

    const icons: Array<IconProp> = ON_CALL_PAGE_CHANNELS.map(
      (info: OnCallPageChannelInfo) => {
        return NOTIFIED_VIA_CHANNEL_ICONS[info.channel];
      },
    );
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("the Execution Timeline's column", () => {
  function columns(): Array<Record<string, unknown>> {
    render(
      <ExecutionLogTimelineTable
        onCallPolicyExecutionLogId={
          new ObjectID("0f850000-0000-4000-8000-0000000000c1")
        }
      />,
    );

    return tableProps!["columns"] as Array<Record<string, unknown>>;
  }

  test('is "Notified Via", right after "Notification Sent To", reading the step\'s notificationChannels', () => {
    const drawn: Array<Record<string, unknown>> = columns();
    const titles: Array<string> = drawn.map(
      (column: Record<string, unknown>) => {
        return String(column["title"]);
      },
    );
    const index: number = titles.indexOf(NOTIFIED_VIA_TITLE);

    expect(NOTIFIED_VIA_TITLE).toBe("Notified Via");
    expect(index).toBeGreaterThan(-1);
    expect(titles[index - 1]).toBe("Notification Sent To");
    expect(drawn[index]!["field"]).toEqual({ notificationChannels: true });
    // A list has no order to sort the run's steps by.
    expect(drawn[index]!["disableSort"]).toBe(true);
  });

  test("draws a step's channels, and a dash for a step that kept none", () => {
    const column: Record<string, unknown> = columns().find(
      (item: Record<string, unknown>) => {
        return item["title"] === NOTIFIED_VIA_TITLE;
      },
    )!;
    const getElement: (
      item: OnCallDutyPolicyExecutionLogTimeline,
    ) => ReactElement = column["getElement"] as (
      item: OnCallDutyPolicyExecutionLogTimeline,
    ) => ReactElement;

    const step: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    step.notificationChannels = [
      OnCallPageChannel.SMS,
      OnCallPageChannel.Email,
    ];

    cleanup();
    render(getElement(step));
    expect(chips()).toEqual(["SMS", "Email"]);

    cleanup();
    const older: RenderResult = render(
      getElement(new OnCallDutyPolicyExecutionLogTimeline()),
    );
    expect(chips()).toEqual([]);
    expect(older.container.textContent).toBe("-");
  });

  test("a step that kept no channels is the bare dash the table draws as its quiet one", () => {
    const column: Record<string, unknown> = columns().find(
      (item: Record<string, unknown>) => {
        return item["title"] === NOTIFIED_VIA_TITLE;
      },
    )!;
    const getElement: (
      item: OnCallDutyPolicyExecutionLogTimeline,
    ) => ReactElement = column["getElement"] as (
      item: OnCallDutyPolicyExecutionLogTimeline,
    ) => ReactElement;

    function step(channels: unknown): OnCallDutyPolicyExecutionLogTimeline {
      const item: OnCallDutyPolicyExecutionLogTimeline =
        new OnCallDutyPolicyExecutionLogTimeline();
      (item as unknown as Record<string, unknown>)["notificationChannels"] =
        channels;
      return item;
    }

    // Older steps, a page that reached nobody, a list of nothing known.
    for (const channels of [undefined, null, [], ["Carrier Pigeon"]]) {
      expect({
        channels,
        quiet: isDashPlaceholder(getElement(step(channels))),
      }).toEqual({ channels, quiet: true });
    }

    expect(isDashPlaceholder(getElement(step([OnCallPageChannel.Email])))).toBe(
      false,
    );
  });
});

describe("its words, in every language the Dashboard speaks", () => {
  const codes: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json") && name !== "SameAsEnglish.json";
    })
    .map((name: string): string => {
      return name.replace(/\.json$/, "");
    });

  test("every locale file is checked", () => {
    expect(codes.length).toBeGreaterThanOrEqual(18);
    expect(codes).toContain("en");
  });

  test.each(codes)(
    "%s has the column's title and every channel's label",
    (code: string) => {
      const strings: Locale = locale(code);

      for (const key of [
        NOTIFIED_VIA_TITLE,
        ...Object.values(NOTIFIED_VIA_CHANNEL_LABELS),
      ]) {
        expect({ key, has: key in strings }).toEqual({ key, has: true });
      }
    },
  );

  test.each(
    codes.filter((code: string) => {
      return code !== "en";
    }),
  )(
    "%s translates the title, and names a phone call and a push notification in its own words",
    (code: string) => {
      const strings: Locale = locale(code);

      expect(strings[NOTIFIED_VIA_TITLE]).not.toBe(NOTIFIED_VIA_TITLE);
      expect(strings["Phone call"]).not.toBe("Phone call");
      expect(strings["Push notification"]).not.toBe("Push notification");
    },
  );
});
