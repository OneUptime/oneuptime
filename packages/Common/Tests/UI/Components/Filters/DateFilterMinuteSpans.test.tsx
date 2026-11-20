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
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, useState } from "react";
import { I18nextProvider } from "react-i18next";
import DateFilter from "../../../../UI/Components/Filters/DateFilter";
import FilterViewer from "../../../../UI/Components/Filters/FilterViewer";
import Filter from "../../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import FieldType from "../../../../UI/Components/Types/FieldType";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import OneUptimeDate from "../../../../Types/Date";
import {
  ENGLISH_DATE_LANGUAGE,
  setDateDisplayLanguage,
} from "../../../../Types/DateLanguage";
import GenericObject from "../../../../Types/GenericObject";
import Timezone from "../../../../Types/Timezone";

/*
 * THE DATE AND TIME FILTER ASKS FOR THE MINUTE IT SHOWS (issue #7719).
 *
 * The filter row's field takes a minute (#7593). Picking "Is 11:15" asked
 * the list for the instant 11:15:00.000 and found nothing anybody did;
 * "Between 09:00 and 17:30" left out the whole of 17:30; "After 11:15" held
 * 11:15:30. Here the real filter row: what each operator hands the list
 * when a moment is picked, the operator and the minute it shows again for a
 * value it is given back (a reload, a link, an old saved view), and the
 * chip over the list, which reads each new value as the field does - in
 * English and in German.
 */

type Row = GenericObject & {
  startsAt?: Date;
  day?: Date;
};

const STARTS_AT: Filter<Row> = {
  key: "startsAt",
  title: "Starts At",
  type: FieldType.DateTime,
} as unknown as Filter<Row>;

const DAY: Filter<Row> = {
  key: "day",
  title: "Day",
  type: FieldType.Date,
} as unknown as Filter<Row>;

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of ["en", "de"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      resources: { [code]: { translation: readLocale(code) } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    languages[code] = instance;
  }
});

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(ENGLISH_DATE_LANGUAGE);
});

let changes: Array<FilterData<Row>> = [];

// The filter row as a list holds it: each change becomes the row's value.
function HeldFilter(props: {
  filter: Filter<Row>;
  initial?: FilterData<Row> | undefined;
}): ReactElement {
  const [filterData, setFilterData] = useState<FilterData<Row>>(
    props.initial || {},
  );

  return (
    <I18nextProvider i18n={languages["en"] as i18n}>
      <DateFilter<Row>
        filter={props.filter}
        filterData={filterData}
        onFilterChanged={(next: FilterData<Row>) => {
          changes.push(next);
          setFilterData(next);
        }}
      />
    </I18nextProvider>
  );
}

function renderFilter(filter: Filter<Row>, initial?: FilterData<Row>): void {
  changes = [];
  render(<HeldFilter filter={filter} initial={initial} />);
}

function inputs(): Array<HTMLInputElement> {
  return Array.from(
    document.querySelectorAll(
      'input[type="datetime-local"], input[type="date"]',
    ),
  ) as Array<HTMLInputElement>;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}

async function chooseOperator(label: string): Promise<void> {
  await act(async () => {
    fireEvent.click(
      document.querySelector('button[aria-haspopup="listbox"]') as HTMLElement,
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: label }));
  });
}

function operatorShown(): string {
  return (
    document.querySelector('button[aria-haspopup="listbox"]')?.textContent || ""
  ).trim();
}

function lastValue(key: "startsAt" | "day"): unknown {
  return changes[changes.length - 1]![key];
}

function bounds(value: unknown): Array<string> {
  if (value instanceof InBetween) {
    return [
      new Date(value.startValue as Date).toISOString(),
      new Date(value.endValue as Date).toISOString(),
    ];
  }

  if (value instanceof GreaterThan || value instanceof LessThan) {
    return [new Date(value.value as Date).toISOString()];
  }

  throw new Error("Not a date filter's value");
}

describe("a date and time filter hands the list the whole minute", () => {
  test("Is 11:15: from 11:15:00.000 to 11:15:59.999, not the instant at :00", async () => {
    renderFilter(STARTS_AT);

    expect(operatorShown()).toBe("is");
    await type(inputs()[0]!, "2026-11-13T11:15");

    const value: unknown = lastValue("startsAt");

    expect(value).toBeInstanceOf(InBetween);
    expect(value).not.toBeInstanceOf(EqualTo);
    expect(bounds(value)).toEqual([
      "2026-11-13T11:15:00.000Z",
      "2026-11-13T11:15:59.999Z",
    ]);
  });

  test("Between 09:00 and 17:30: the whole of 17:30", async () => {
    renderFilter(STARTS_AT);

    await chooseOperator("is between");
    await type(inputs()[0]!, "2026-11-13T09:00");
    await type(inputs()[1]!, "2026-11-13T17:30");

    expect(bounds(lastValue("startsAt"))).toEqual([
      "2026-11-13T09:00:00.000Z",
      "2026-11-13T17:30:59.999Z",
    ]);
  });

  test("Between, its end picked first: the start completes it", async () => {
    renderFilter(STARTS_AT);

    await chooseOperator("is between");
    await type(inputs()[1]!, "2026-11-13T17:30");
    await type(inputs()[0]!, "2026-11-13T09:00");

    expect(bounds(lastValue("startsAt"))).toEqual([
      "2026-11-13T09:00:00.000Z",
      "2026-11-13T17:30:59.999Z",
    ]);
  });

  test("Between with one end picked asks the list for nothing yet, and keeps that end", async () => {
    renderFilter(STARTS_AT);

    await chooseOperator("is between");
    await type(inputs()[0]!, "2026-11-13T09:00");

    expect(lastValue("startsAt")).toBeUndefined();
    expect(operatorShown()).toBe("is between");
    expect(inputs()[0]!.value).toBe("2026-11-13T09:00");
  });

  test("Is 11:15 turned into Between keeps 11:15 as its start", async () => {
    renderFilter(STARTS_AT);

    await type(inputs()[0]!, "2026-11-13T11:15");
    await chooseOperator("is between");
    await type(inputs()[1]!, "2026-11-13T12:00");

    expect(bounds(lastValue("startsAt"))).toEqual([
      "2026-11-13T11:15:00.000Z",
      "2026-11-13T12:00:59.999Z",
    ]);
  });

  test("After 11:15: from 11:16, once 11:15 is over", async () => {
    renderFilter(STARTS_AT);

    await chooseOperator("is after");
    await type(inputs()[0]!, "2026-11-13T11:15");

    const value: unknown = lastValue("startsAt");

    expect(value).toBeInstanceOf(GreaterThan);
    expect(bounds(value)).toEqual(["2026-11-13T11:15:59.999Z"]);
  });

  test("Before 11:15: until 11:15 starts", async () => {
    renderFilter(STARTS_AT);

    await chooseOperator("is before");
    await type(inputs()[0]!, "2026-11-13T11:15");

    const value: unknown = lastValue("startsAt");

    expect(value).toBeInstanceOf(LessThan);
    expect(bounds(value)).toEqual(["2026-11-13T11:15:00.000Z"]);
  });

  test("in the reader's zone: Is 11:15 in New York is 16:15 UTC's minute", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
    renderFilter(STARTS_AT);

    await type(inputs()[0]!, "2026-11-13T11:15");

    expect(bounds(lastValue("startsAt"))).toEqual([
      "2026-11-13T16:15:00.000Z",
      "2026-11-13T16:15:59.999Z",
    ]);
  });

  test("changing the operator keeps the minute: Is 11:15, then After, then Between", async () => {
    renderFilter(STARTS_AT);

    await type(inputs()[0]!, "2026-11-13T11:15");
    await chooseOperator("is after");

    expect(bounds(lastValue("startsAt"))).toEqual(["2026-11-13T11:15:59.999Z"]);

    await chooseOperator("is");

    expect(bounds(lastValue("startsAt"))).toEqual([
      "2026-11-13T11:15:00.000Z",
      "2026-11-13T11:15:59.999Z",
    ]);
  });
});

describe("a date filter hands the list the whole day", () => {
  test("Is Nov 13: the whole of Nov 13", async () => {
    renderFilter(DAY);

    await type(inputs()[0]!, "2026-11-13");

    expect(bounds(lastValue("day"))).toEqual([
      "2026-11-13T00:00:00.000Z",
      "2026-11-13T23:59:59.999Z",
    ]);
  });

  test("After Nov 13: from Nov 14", async () => {
    renderFilter(DAY);

    await chooseOperator("is after");
    await type(inputs()[0]!, "2026-11-13");

    expect(bounds(lastValue("day"))).toEqual(["2026-11-13T23:59:59.999Z"]);
  });

  test("Is Nov 13 in Tokyo is Tokyo's Nov 13", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaTokyo);
    renderFilter(DAY);

    await type(inputs()[0]!, "2026-11-13");

    expect(bounds(lastValue("day"))).toEqual([
      "2026-11-12T15:00:00.000Z",
      "2026-11-13T14:59:59.999Z",
    ]);
  });
});

describe("a value the list is given from elsewhere", () => {
  // The filter row with its value set from outside, as a saved view or the chip's remove does.
  function Controlled(props: { filterData: FilterData<Row> }): ReactElement {
    return (
      <I18nextProvider i18n={languages["en"] as i18n}>
        <DateFilter<Row>
          filter={STARTS_AT}
          filterData={props.filterData}
          onFilterChanged={(next: FilterData<Row>) => {
            changes.push(next);
          }}
        />
      </I18nextProvider>
    );
  }

  test("a saved view's value is shown; taken away, the moments go and the operator stays", () => {
    changes = [];
    const view: ReturnType<typeof render> = render(
      <Controlled filterData={{}} />,
    );

    view.rerender(
      <Controlled
        filterData={
          {
            startsAt: new GreaterThan<Date>(
              new Date("2026-11-13T11:15:59.999Z"),
            ),
          } as FilterData<Row>
        }
      />,
    );

    expect(operatorShown()).toBe("is after");
    expect(inputs()[0]!.value).toBe("2026-11-13T11:15");

    view.rerender(<Controlled filterData={{}} />);

    expect(operatorShown()).toBe("is after");
    expect(inputs()[0]!.value).toBe("");
  });
});

describe("a value given back shows its operator and its minute again", () => {
  test("a one-minute span shows as Is, at that minute", () => {
    renderFilter(STARTS_AT, {
      startsAt: new InBetween<Date>(
        new Date("2026-11-13T11:15:00.000Z"),
        new Date("2026-11-13T11:15:59.999Z"),
      ),
    } as FilterData<Row>);

    expect(operatorShown()).toBe("is");
    expect(
      inputs().map((input: HTMLInputElement) => {
        return input.value;
      }),
    ).toEqual(["2026-11-13T11:15"]);
  });

  test("an old saved view's EqualTo still shows as Is, at its minute", () => {
    renderFilter(STARTS_AT, {
      startsAt: new EqualTo<Date>(new Date("2026-11-13T11:15:00.000Z")),
    } as FilterData<Row>);

    expect(operatorShown()).toBe("is");
    expect(inputs()[0]!.value).toBe("2026-11-13T11:15");
  });

  test("After shows the minute it follows, not the one it starts", () => {
    renderFilter(STARTS_AT, {
      startsAt: new GreaterThan<Date>(new Date("2026-11-13T11:15:59.999Z")),
    } as FilterData<Row>);

    expect(operatorShown()).toBe("is after");
    expect(inputs()[0]!.value).toBe("2026-11-13T11:15");
  });

  test("Between shows both of its minutes", () => {
    renderFilter(STARTS_AT, {
      startsAt: new InBetween<Date>(
        new Date("2026-11-13T09:00:00.000Z"),
        new Date("2026-11-13T17:30:59.999Z"),
      ),
    } as FilterData<Row>);

    expect(operatorShown()).toBe("is between");
    expect(
      inputs().map((input: HTMLInputElement) => {
        return input.value;
      }),
    ).toEqual(["2026-11-13T09:00", "2026-11-13T17:30"]);
  });

  test("a whole day on a date and time filter shows as Between, from 00:00 to 23:59", () => {
    renderFilter(STARTS_AT, {
      startsAt: new InBetween<Date>(
        new Date("2026-11-13T00:00:00.000Z"),
        new Date("2026-11-13T23:59:59.999Z"),
      ),
    } as FilterData<Row>);

    expect(operatorShown()).toBe("is between");
    expect(
      inputs().map((input: HTMLInputElement) => {
        return input.value;
      }),
    ).toEqual(["2026-11-13T00:00", "2026-11-13T23:59"]);
  });

  test("a date filter's day shows as Is, at that day", () => {
    renderFilter(DAY, {
      day: new InBetween<Date>(
        new Date("2026-11-13T00:00:00.000Z"),
        new Date("2026-11-13T23:59:59.999Z"),
      ),
    } as FilterData<Row>);

    expect(operatorShown()).toBe("is");
    expect(inputs()[0]!.value).toBe("2026-11-13");
  });
});

describe("the chip over the list reads each value as the field does", () => {
  function chipText(code: string, filterData: FilterData<Row>): string {
    setDateDisplayLanguage(code);

    render(
      <I18nextProvider i18n={languages[code] as i18n}>
        <FilterViewer<Row>
          id="state-timeline"
          filters={[STARTS_AT, DAY]}
          filterData={filterData}
          showFilterModal={false}
          pluralLabel="State Timeline"
        />
      </I18nextProvider>,
    );

    // The chip its filter's title is in, as the language words the title.
    const titles: Array<string> = ["Starts At", "Day"].map(
      (title: string): string => {
        return readLocale(code)[title] || title;
      },
    );
    const chip: HTMLElement | null = screen
      .getByText((text: string): boolean => {
        return titles.includes(text.trim());
      })
      .closest('[data-testid="applied-filter-chip"]');

    return ((chip as HTMLElement).textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const IS: InBetween<Date> = new InBetween<Date>(
    new Date("2026-11-13T11:15:00.000Z"),
    new Date("2026-11-13T11:15:59.999Z"),
  );
  const AFTER: GreaterThan<Date> = new GreaterThan<Date>(
    new Date("2026-11-13T11:15:59.999Z"),
  );
  const BEFORE: LessThan<Date> = new LessThan<Date>(
    new Date("2026-11-13T11:15:00.000Z"),
  );
  const BETWEEN: InBetween<Date> = new InBetween<Date>(
    new Date("2026-11-13T09:00:00.000Z"),
    new Date("2026-11-13T17:30:59.999Z"),
  );

  test.each([
    ["Is", IS, "Starts At is Nov 13, 2026, 11:15 UTC"],
    ["After", AFTER, "Starts At is after Nov 13, 2026, 11:15 UTC"],
    ["Before", BEFORE, "Starts At is before Nov 13, 2026, 11:15 UTC"],
    [
      "Between",
      BETWEEN,
      "Starts At is between Nov 13, 2026, 09:00 and 17:30 UTC",
    ],
  ])("%s, in English", (_operator: string, value: unknown, text: string) => {
    expect(chipText("en", { startsAt: value } as FilterData<Row>)).toBe(text);
  });

  test.each([
    ["Is", IS, "ist", ["11:15"]],
    ["After", AFTER, "liegt nach", ["11:15"]],
    ["Before", BEFORE, "liegt vor", ["11:15"]],
    ["Between", BETWEEN, "liegt zwischen", ["09:00", "17:30"]],
  ])(
    "%s, in German",
    (
      _operator: string,
      value: unknown,
      words: string,
      clocks: Array<string>,
    ) => {
      const text: string = chipText("de", {
        startsAt: value,
      } as FilterData<Row>);

      expect(text).toContain(words);
      expect(text).toContain("Nov.");
      for (const clock of clocks) {
        expect(text).toContain(clock);
      }
      // No seconds: the end of a minute never reads 11:15:59.
      expect(text).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    },
  );

  test("a date filter's day, and the day after which After starts, read as that day", () => {
    expect(
      chipText("en", {
        day: new InBetween<Date>(
          new Date("2026-11-13T00:00:00.000Z"),
          new Date("2026-11-13T23:59:59.999Z"),
        ),
      } as FilterData<Row>),
    ).toBe("Day is Nov 13, 2026");

    cleanup();

    expect(
      chipText("en", {
        day: new GreaterThan<Date>(new Date("2026-11-13T23:59:59.999Z")),
      } as FilterData<Row>),
    ).toBe("Day is after Nov 13, 2026");
  });
});
