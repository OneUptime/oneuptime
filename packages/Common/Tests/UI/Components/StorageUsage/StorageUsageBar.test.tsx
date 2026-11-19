import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import StorageUsageBar, {
  STORAGE_USAGE_BAR_COLOR_CLASS_NAMES,
  STORAGE_USAGE_LEVEL_PILLS,
  StorageUsageBarSize,
} from "../../../../UI/Components/StorageUsage/StorageUsageBar";
import {
  StorageUsage,
  StorageUsageLevel,
  getStorageUsage,
} from "../../../../Utils/Storage/StorageUsage";

/*
 * HOW FULL A STORE IS, DRAWN ONE WAY (#9539).
 *
 * StorageUsageBar draws the reading StorageUsage worked out: in a list's
 * cell the bar, the percent and the amount used; on a page the percent
 * large, the bar, Used, Free and Capacity, a pill once it is nearly full,
 * and when it was measured. Calm, then amber, then red, at the reading's
 * lines. A store that reported nothing says so in words, never as an empty
 * bar or a 0% nobody measured.
 */

const GIB: number = 1024 * 1024 * 1024;

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: {
          translation:
            language === "de"
              ? {
                  "{{percent}} used": "{{percent}} belegt",
                  "Free (storage space)": "Frei",
                  "Nearly full": "Fast voll",
                }
              : {},
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function draw(element: ReactElement, language: string = "en"): void {
  render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
}

function usageOf(usedGiB: number, capacityGiB: number = 50): StorageUsage {
  return getStorageUsage({
    capacity: capacityGiB * GIB,
    available: (capacityGiB - usedGiB) * GIB,
  })!;
}

function fill(): HTMLElement {
  return screen.getByTestId("storage-usage-fill");
}

describe("StorageUsageBar in a list's cell", () => {
  test("draws the bar as wide as what is used, the percent and the amount used", () => {
    draw(<StorageUsageBar usage={usageOf(36)} />);

    expect(fill()).toHaveStyle({ width: "72%" });
    expect(screen.getByText("72%")).toBeInTheDocument();
    // Held to its unit by a no-break space, so a narrow cell never splits it.
    expect(screen.getByTestId("storage-usage").textContent).toBe(
      "72%36\u00A0GiB",
    );
  });

  test("names the bar for a screen reader as a meter of what is used", () => {
    draw(<StorageUsageBar usage={usageOf(36)} />);

    const meter: HTMLElement = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "72");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAccessibleName("72% used");
  });

  test.each([
    [10, StorageUsageLevel.Normal],
    [39.9, StorageUsageLevel.Normal],
    [40, StorageUsageLevel.Warning],
    [44.9, StorageUsageLevel.Warning],
    [45, StorageUsageLevel.Critical],
    [50, StorageUsageLevel.Critical],
  ])(
    "%s GiB used of 50 is %s, and coloured so",
    (usedGiB: number, level: StorageUsageLevel) => {
      draw(<StorageUsageBar usage={usageOf(usedGiB)} />);

      expect(fill()).toHaveAttribute("data-level", level);
      expect(fill().className).toContain(
        STORAGE_USAGE_BAR_COLOR_CLASS_NAMES[level],
      );
    },
  );

  test("leaves the amount out when the page shows it elsewhere", () => {
    draw(<StorageUsageBar usage={usageOf(36)} showAmount={false} />);

    expect(screen.getByTestId("storage-usage").textContent).toBe("72%");
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  test("writes amounts the page's way, a count of objects say", () => {
    draw(
      <StorageUsageBar
        usage={getStorageUsage({ capacity: 200, used: 150 })}
        formatAmount={(amount: number): string => {
          return `${amount} objects`;
        }}
      />,
    );

    expect(screen.getByText("150 objects")).toBeInTheDocument();
  });

  test("says why there is no usage in words, never with an empty bar", () => {
    draw(<StorageUsageBar usage={null} noUsageText="Not reported" />);

    expect(screen.getByText("Not reported")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  test("draws the quiet dash when the page has no words for it", () => {
    draw(<StorageUsageBar usage={null} />);

    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("writes the percent and the amount in the reader's digits", () => {
    draw(<StorageUsageBar usage={usageOf(36.2)} />, "fa");

    expect(screen.getByTestId("storage-usage").textContent).toBe(
      "۷۲٪۳۶٫۲\u00A0GiB",
    );
  });
});

describe("StorageUsageBar on a page", () => {
  test("says how much is used, free and the capacity", () => {
    draw(
      <StorageUsageBar usage={usageOf(36)} size={StorageUsageBarSize.Detail} />,
    );

    expect(screen.getByTestId("storage-usage-used").textContent).toBe(
      "36\u00A0GiB",
    );
    expect(screen.getByTestId("storage-usage-free").textContent).toBe(
      "14\u00A0GiB",
    );
    expect(screen.getByTestId("storage-usage-capacity").textContent).toBe(
      "50\u00A0GiB",
    );
    expect(screen.getByText("Used")).toBeInTheDocument();
    // The meaning key reads as its word in English.
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Capacity")).toBeInTheDocument();
    expect(fill()).toHaveStyle({ width: "72%" });
  });

  test("shows no pill while there is plenty of room", () => {
    draw(
      <StorageUsageBar usage={usageOf(20)} size={StorageUsageBarSize.Detail} />,
    );

    expect(screen.queryByTestId("storage-usage-level")).not.toBeInTheDocument();
  });

  test.each([
    [41, StorageUsageLevel.Warning],
    [48, StorageUsageLevel.Critical],
  ])(
    "%s GiB used of 50 says so in a pill",
    (usedGiB: number, level: StorageUsageLevel) => {
      draw(
        <StorageUsageBar
          usage={usageOf(usedGiB)}
          size={StorageUsageBarSize.Detail}
        />,
      );

      expect(screen.getByTestId("storage-usage-level")).toHaveTextContent(
        STORAGE_USAGE_LEVEL_PILLS[level]!.text,
      );
    },
  );

  test("says when it was measured", () => {
    draw(
      <StorageUsageBar
        usage={usageOf(36)}
        size={StorageUsageBarSize.Detail}
        measuredAt={new Date(Date.now() - 3 * 60 * 1000)}
      />,
    );

    expect(screen.getByTestId("storage-usage-measured").textContent).toMatch(
      /^Reported /,
    );
  });

  test("says why there is no usage in a sentence", () => {
    draw(
      <StorageUsageBar
        usage={null}
        size={StorageUsageBarSize.Detail}
        noUsageText="This claim is a raw block device."
      />,
    );

    expect(
      screen.getByText("This claim is a raw block device."),
    ).toBeInTheDocument();
  });

  test("says no usage was reported when the page has nothing more to say", () => {
    draw(<StorageUsageBar usage={null} size={StorageUsageBarSize.Detail} />);

    expect(screen.getByText("No usage reported.")).toBeInTheDocument();
  });

  test("reads in the reader's language, the percent and amounts in their digits", () => {
    draw(
      <StorageUsageBar usage={usageOf(41)} size={StorageUsageBarSize.Detail} />,
      "de",
    );

    const used: HTMLElement = screen.getByTestId("storage-usage");
    expect(within(used).getByText("Frei")).toBeInTheDocument();
    expect(within(used).getByText("Fast voll")).toBeInTheDocument();
    expect(used.textContent).toContain("82\u00A0%");
    expect(used.textContent).toContain("belegt");
    expect(screen.getByTestId("storage-usage-free").textContent).toBe(
      "9\u00A0GiB",
    );
  });
});

/*
 * A dashboard widget's narrow cell (#9646): the Ceph OSD and pool widgets
 * drew bars of their own, at 70% and 85% where Ceph's lines are 85% and
 * 95%, with English-digit percents.
 */
describe("StorageUsageBar in a dashboard widget's cell", () => {
  test("draws a short bar and the percent on one line, with no amount and no width of its own", () => {
    draw(
      <StorageUsageBar usage={usageOf(36)} size={StorageUsageBarSize.Inline} />,
    );

    const cell: HTMLElement = screen.getByTestId("storage-usage");
    expect(cell.textContent).toBe("72%");
    expect(fill()).toHaveStyle({ width: "72%" });
    expect(cell.className).not.toContain("min-w-[8rem]");
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "72");
  });

  test("colours at the reading's lines, as a list's cell does", () => {
    draw(
      <StorageUsageBar
        usage={getStorageUsage(
          { capacity: 100, used: 96 },
          { warningPercent: 85, criticalPercent: 95, isPastLineOnly: true },
        )}
        size={StorageUsageBarSize.Inline}
      />,
    );

    expect(fill()).toHaveClass(
      STORAGE_USAGE_BAR_COLOR_CLASS_NAMES[StorageUsageLevel.Critical],
    );
  });

  test("draws the small quiet dash when there is no reading, or the page's words", () => {
    draw(<StorageUsageBar usage={null} size={StorageUsageBarSize.Inline} />);
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByTestId("storage-usage-none")).toBeNull();
    cleanup();

    draw(
      <StorageUsageBar
        usage={null}
        size={StorageUsageBarSize.Inline}
        noUsageText="Not reported"
      />,
    );
    expect(screen.getByTestId("storage-usage-none")).toHaveTextContent(
      "Not reported",
    );
  });

  test("writes the percent in the reader's digits", () => {
    draw(
      <StorageUsageBar usage={usageOf(36)} size={StorageUsageBarSize.Inline} />,
      "fa",
    );

    expect(screen.getByTestId("storage-usage").textContent).toBe(
      "\u06F7\u06F2\u066A",
    );
  });
});
