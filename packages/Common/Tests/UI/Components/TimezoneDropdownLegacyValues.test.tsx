import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "../../../UI/Components/Dropdown/Dropdown";
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias, {
  LEGACY_TIMEZONE_NAMES,
} from "../../../Types/TimezoneAlias";
import TimezoneUtil from "../../../UI/Utils/Timezone";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * End to end through the real picker options: TimezoneUtil offers only current
 * names and lists each one's legacy spellings as aliases, and Dropdown resolves
 * a stored legacy spelling to the option it means. Profiles, on-call layers
 * and status pages saved before a spelling was retired still hold it — stored
 * values are never rewritten — so every one of them has to show its current
 * option rather than an empty picker.
 *
 * Labels carry the zone's GMT offset today, which moves with daylight saving,
 * so expectations are read from the same option list rather than hard-coded.
 *
 * Note: jest-dom matchers (toBeInTheDocument etc.) fail typecheck repo-wide,
 * so assertions here stay on plain DOM text and emitted values.
 */

const TIMEZONE_OPTIONS: Array<DropdownOption> =
  TimezoneUtil.getTimezoneDropdownOptions();

afterEach(() => {
  cleanup();
});

function getOptionFor(timezone: Timezone): DropdownOption {
  const option: DropdownOption | undefined = TIMEZONE_OPTIONS.find(
    (candidate: DropdownOption): boolean => {
      return candidate.value === timezone;
    },
  );

  if (!option) {
    throw new Error(`The timezone picker does not offer ${timezone}`);
  }

  return option;
}

function getLabelFor(timezone: Timezone): string {
  return getOptionFor(timezone).label;
}

/*
 * FormField hands Dropdown the raw stored value through an `any`, although
 * `value` is typed as options. Cast the same way so these tests take the path
 * a form takes.
 */
function asStoredValue(
  value: DropdownValue | Array<DropdownValue>,
): DropdownOption | Array<DropdownOption> {
  return value as unknown as DropdownOption | Array<DropdownOption>;
}

function getSelectedLabel(): string | null {
  const singleValue: HTMLElement | null = document.querySelector<HTMLElement>(
    ".ou-select__single-value",
  );

  return singleValue ? singleValue.textContent : null;
}

function getChipLabels(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__multi-value__label"),
  ).map((chip: HTMLElement): string => {
    return chip.textContent || "";
  });
}

function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

function getMenuOptionLabels(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__option"),
  ).map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

// With the menu open the selected label is on screen twice: click the menu's.
function chooseMenuOption(label: string): void {
  openMenu();

  const option: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__option"),
  ).find((element: HTMLElement): boolean => {
    return element.textContent === label;
  });

  expect(option).toBeDefined();
  fireEvent.click(option as HTMLElement);
}

interface LegacyValueCase {
  stored: string;
  current: Timezone;
  why: string;
}

const LEGACY_VALUE_CASES: Array<LegacyValueCase> = [
  {
    stored: "Singapore",
    current: Timezone.AsiaSingapore,
    why: "the pre-1993 country name that was offered beside Asia/Singapore",
  },
  {
    stored: "US/Pacific",
    current: Timezone.AmericaLos_Angeles,
    why: "a US/* region name",
  },
  {
    stored: "Asia/Calcutta",
    current: Timezone.AsiaKolkata,
    why: "the old city spelling Chromium still reports as its guess",
  },
  {
    stored: "Europe/Kiev",
    current: Timezone.EuropeKyiv,
    why: "an old spelling whose current name was missing from the enum",
  },
  {
    stored: "Etc/UTC",
    current: Timezone.UTC,
    why: "one of the many spellings of UTC",
  },
  {
    stored: "US/Pacific-New",
    current: Timezone.AmericaLos_Angeles,
    why: "removed from tzdata in 2020b, so moment cannot resolve it at all",
  },
];

describe("Timezone dropdown with a stored legacy name", () => {
  for (const legacyValueCase of LEGACY_VALUE_CASES) {
    test(`"${legacyValueCase.stored}" (${legacyValueCase.why}) shows ${legacyValueCase.current}`, () => {
      render(
        <Dropdown
          onChange={() => {}}
          options={TIMEZONE_OPTIONS}
          placeholder="Select a timezone"
          value={asStoredValue(legacyValueCase.stored)}
        />,
      );

      expect(getSelectedLabel()).toBe(getLabelFor(legacyValueCase.current));
    });
  }

  test("every legacy name in the tz map shows its current option", () => {
    /*
     * One multi-select holding every legacy name at once: each must resolve
     * to a chip, and names that share a current zone (US/Pacific,
     * US/Pacific-New and PST8PDT) must share one chip.
     */
    const legacyNames: Array<Timezone> = Object.keys(
      LEGACY_TIMEZONE_NAMES,
    ) as Array<Timezone>;

    expect(legacyNames.length).toBeGreaterThan(100);

    render(
      <Dropdown
        isMultiSelect={true}
        onChange={() => {}}
        options={TIMEZONE_OPTIONS}
        value={asStoredValue(legacyNames)}
      />,
    );

    expect(getChipLabels()).toEqual(
      TimezoneAlias.getCanonicalTimezones(legacyNames).map(getLabelFor),
    );
  });

  test("a current name still shows its own option", () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={TIMEZONE_OPTIONS}
        value={asStoredValue(Timezone.AsiaTokyo)}
      />,
    );

    expect(getSelectedLabel()).toBe(getLabelFor(Timezone.AsiaTokyo));
  });

  test("a name that is not a timezone still shows the placeholder", () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={TIMEZONE_OPTIONS}
        placeholder="Select a timezone"
        value={asStoredValue("Mars/Olympus_Mons")}
      />,
    );

    expect(getSelectedLabel()).toBeNull();
    expect(
      document.querySelector<HTMLElement>(".ou-select__placeholder")
        ?.textContent,
    ).toBe("Select a timezone");
  });

  test("the menu lists Singapore's clock once, under its current name", () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={TIMEZONE_OPTIONS}
        value={asStoredValue("Singapore")}
      />,
    );

    openMenu();

    const SINGAPORE_LABEL: RegExp = /Singapore$/;

    expect(
      getMenuOptionLabels().filter((label: string): boolean => {
        return SINGAPORE_LABEL.test(label);
      }),
    ).toEqual([getLabelFor(Timezone.AsiaSingapore)]);
  });

  test("re-choosing the shown option emits the current name", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={TIMEZONE_OPTIONS}
        value={asStoredValue("US/Pacific")}
      />,
    );

    chooseMenuOption(getLabelFor(Timezone.AmericaLos_Angeles));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(Timezone.AmericaLos_Angeles);
  });

  test("subscriber timezones: legacy spellings of one clock share a chip, and an edit keeps it", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        isMultiSelect={true}
        onChange={onChange}
        options={TIMEZONE_OPTIONS}
        value={asStoredValue([
          "Singapore",
          "Asia/Singapore",
          "US/Pacific",
          "PST8PDT",
        ])}
      />,
    );

    expect(getChipLabels()).toEqual([
      getLabelFor(Timezone.AsiaSingapore),
      getLabelFor(Timezone.AmericaLos_Angeles),
    ]);

    fireEvent.click(
      screen.getByRole("button", {
        name: `Remove ${getLabelFor(Timezone.AmericaLos_Angeles)}`,
      }),
    );

    expect(onChange).toHaveBeenCalledWith([Timezone.AsiaSingapore]);
  });
});

describe("Timezone option aliases resolve unambiguously", () => {
  /*
   * Dropdown matches an option's own value first and aliases only after, so
   * an alias that was also some option's value, or that two options both
   * claimed, would make a stored name show a different zone than the one it
   * maps to. With the real list neither may happen.
   */
  test("no alias is also an offered value", () => {
    const offeredValues: Set<DropdownValue> = new Set<DropdownValue>(
      TIMEZONE_OPTIONS.map((option: DropdownOption): DropdownValue => {
        return option.value;
      }),
    );
    const shadowedAliases: Array<DropdownValue> = TIMEZONE_OPTIONS.flatMap(
      (option: DropdownOption): Array<DropdownValue> => {
        return option.aliases || [];
      },
    ).filter((alias: DropdownValue): boolean => {
      return offeredValues.has(alias);
    });

    expect(shadowedAliases).toEqual([]);
  });

  test("each legacy name is the alias of exactly the option it maps to", () => {
    const optionValuesByAlias: Map<
      DropdownValue,
      Array<DropdownValue>
    > = new Map<DropdownValue, Array<DropdownValue>>();

    for (const option of TIMEZONE_OPTIONS) {
      for (const alias of option.aliases || []) {
        optionValuesByAlias.set(alias, [
          ...(optionValuesByAlias.get(alias) || []),
          option.value,
        ]);
      }
    }

    for (const legacyName of Object.keys(
      LEGACY_TIMEZONE_NAMES,
    ) as Array<Timezone>) {
      expect({
        legacyName: legacyName,
        options: optionValuesByAlias.get(legacyName),
      }).toEqual({
        legacyName: legacyName,
        options: [LEGACY_TIMEZONE_NAMES[legacyName]],
      });
    }

    expect(optionValuesByAlias.size).toBe(
      Object.keys(LEGACY_TIMEZONE_NAMES).length,
    );
  });
});

describe("Timezone form field with a stored legacy name", () => {
  interface RenderedForm {
    onSubmit: MockFunction;
    user: ReturnType<typeof userEvent.setup>;
  }

  function renderForm(
    initialValues: FormValues<any>,
    fields: Fields<FormValues<any>>,
  ): RenderedForm {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        fields={fields}
        id="timezone-legacy-values"
        initialValues={initialValues}
        onSubmit={onSubmit}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    return { onSubmit, user: userEvent.setup({ delay: null }) };
  }

  async function save(form: RenderedForm): Promise<FormValues<any>> {
    await form.user.click(screen.getByTestId("Save"));

    expect(form.onSubmit).toHaveBeenCalledTimes(1);

    return form.onSubmit.mock.calls[0]?.[0] as FormValues<any>;
  }

  const TIMEZONE_FIELD: Fields<FormValues<any>> = [
    {
      field: { timezone: true },
      title: "Timezone",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: TIMEZONE_OPTIONS,
      required: false,
    },
  ];

  const SUBSCRIBER_TIMEZONES_FIELD: Fields<FormValues<any>> = [
    {
      field: { subscriberTimezones: true },
      title: "Subscriber Timezones",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownOptions: TIMEZONE_OPTIONS,
      required: false,
    },
  ];

  test("shows the current option and, untouched, saves the stored name back as it was", async () => {
    /*
     * An API or Terraform client that wrote "US/Pacific" must read back
     * "US/Pacific" after someone merely opens and saves the form.
     */
    const form: RenderedForm = renderForm(
      { timezone: "US/Pacific" } as FormValues<any>,
      TIMEZONE_FIELD,
    );

    await screen.findByText(getLabelFor(Timezone.AmericaLos_Angeles));

    expect(getSelectedLabel()).toBe(getLabelFor(Timezone.AmericaLos_Angeles));
    expect(await save(form)).toEqual({ timezone: "US/Pacific" });
  });

  test("choosing a zone saves its current name", async () => {
    const form: RenderedForm = renderForm(
      { timezone: "Asia/Calcutta" } as FormValues<any>,
      TIMEZONE_FIELD,
    );

    await screen.findByText(getLabelFor(Timezone.AsiaKolkata));
    chooseMenuOption(getLabelFor(Timezone.EuropeKyiv));

    expect(await save(form)).toEqual({ timezone: Timezone.EuropeKyiv });
  });

  test("subscriber timezones: untouched legacy names are saved back as they were", async () => {
    const form: RenderedForm = renderForm(
      {
        subscriberTimezones: ["Singapore", "Europe/Kiev"],
      } as FormValues<any>,
      SUBSCRIBER_TIMEZONES_FIELD,
    );

    await screen.findByText(getLabelFor(Timezone.EuropeKyiv));

    expect(getChipLabels()).toEqual([
      getLabelFor(Timezone.AsiaSingapore),
      getLabelFor(Timezone.EuropeKyiv),
    ]);
    expect(await save(form)).toEqual({
      subscriberTimezones: ["Singapore", "Europe/Kiev"],
    });
  });

  test("subscriber timezones: removing one legacy entry keeps the other, in its current name", async () => {
    const form: RenderedForm = renderForm(
      {
        subscriberTimezones: ["Singapore", "Europe/Kiev"],
      } as FormValues<any>,
      SUBSCRIBER_TIMEZONES_FIELD,
    );

    await screen.findByText(getLabelFor(Timezone.EuropeKyiv));
    await form.user.click(
      screen.getByRole("button", {
        name: `Remove ${getLabelFor(Timezone.EuropeKyiv)}`,
      }),
    );

    expect(await save(form)).toEqual({
      subscriberTimezones: [Timezone.AsiaSingapore],
    });
  });
});

describe("Timezone dropdown search finds a clock by its legacy spelling", () => {
  /*
   * The legacy names are no longer entries of their own, so someone who knows
   * their zone as "Calcutta" or "US/Eastern" types that. The search must land
   * on the one entry the spelling now lives under — only that entry, so the
   * list never looks like it still holds two of the same clock — and picking
   * it must emit the current name, never the spelling that was typed.
   */
  function typeSearch(text: string): void {
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: text },
    });
  }

  function pressEnter(): void {
    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "Enter",
      code: "Enter",
    });
  }

  interface LegacySearchCase {
    typed: string;
    current: Timezone;
  }

  const LEGACY_SEARCH_CASES: Array<LegacySearchCase> = [
    { typed: "Calcutta", current: Timezone.AsiaKolkata },
    { typed: "US/Eastern", current: Timezone.AmericaNew_York },
    { typed: "Kiev", current: Timezone.EuropeKyiv },
    { typed: "Montreal", current: Timezone.AmericaToronto },
    { typed: "Japan", current: Timezone.AsiaTokyo },
    { typed: "Zulu", current: Timezone.UTC },
    // Three legacy names share this one entry: US/Pacific, US/Pacific-New, PST8PDT.
    { typed: "US/Pacific", current: Timezone.AmericaLos_Angeles },
    { typed: "Saigon", current: Timezone.AsiaHo_Chi_Minh },
    { typed: "Godthab", current: Timezone.AmericaNuuk },
    { typed: "Enderbury", current: Timezone.PacificKanton },
  ];

  for (const searchCase of LEGACY_SEARCH_CASES) {
    test(`typing "${searchCase.typed}" lists only ${searchCase.current}, and picking it emits the current name`, () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Dropdown
          onChange={onChange}
          options={TIMEZONE_OPTIONS}
          placeholder="Select a timezone"
        />,
      );

      typeSearch(searchCase.typed);

      expect(getMenuOptionLabels()).toEqual([getLabelFor(searchCase.current)]);

      pressEnter();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(searchCase.current);
      expect(onChange).not.toHaveBeenCalledWith(searchCase.typed);
      expect(getSelectedLabel()).toBe(getLabelFor(searchCase.current));
    });
  }

  test("the legacy-spelling search ignores case, accents and padding", () => {
    const variants: Array<[string, Timezone]> = [
      ["calcutta", Timezone.AsiaKolkata],
      ["CALCUTTA", Timezone.AsiaKolkata],
      ["asia/CALCUTTA", Timezone.AsiaKolkata],
      ["us/eastern", Timezone.AmericaNew_York],
      ["US/EASTERN", Timezone.AmericaNew_York],
      ["kIeV", Timezone.EuropeKyiv],
      ["  japan  ", Timezone.AsiaTokyo],
      ["zULU", Timezone.UTC],
      // tzdata spells it without the accent; the search strips it from input.
      ["Montréal", Timezone.AmericaToronto],
    ];

    render(<Dropdown onChange={() => {}} options={TIMEZONE_OPTIONS} />);

    for (const [typed, current] of variants) {
      typeSearch(typed);

      expect({ typed: typed, labels: getMenuOptionLabels() }).toEqual({
        typed: typed,
        labels: [getLabelFor(current)],
      });
    }
  });

  test('typing "singa" still lists only Asia/Singapore', () => {
    render(<Dropdown onChange={() => {}} options={TIMEZONE_OPTIONS} />);

    typeSearch("singa");

    expect(getMenuOptionLabels()).toEqual([
      getLabelFor(Timezone.AsiaSingapore),
    ]);
  });

  test("current names are found exactly as before", () => {
    render(<Dropdown onChange={() => {}} options={TIMEZONE_OPTIONS} />);

    typeSearch("Asia/Kolkata");
    expect(getMenuOptionLabels()).toEqual([getLabelFor(Timezone.AsiaKolkata)]);

    typeSearch("kyiv");
    expect(getMenuOptionLabels()).toEqual([getLabelFor(Timezone.EuropeKyiv)]);

    typeSearch("Toronto");
    expect(getMenuOptionLabels()).toEqual([
      getLabelFor(Timezone.AmericaToronto),
    ]);
  });

  /*
   * Every legacy name, typed in full. Each keystroke re-renders the whole
   * menu, so the ~150 names are split into batches that each stay well
   * inside the per-test timeout on a slow runner.
   */
  const LEGACY_NAME_BATCH_SIZE: number = 40;
  const ALL_LEGACY_NAMES: Array<Timezone> = Object.keys(
    LEGACY_TIMEZONE_NAMES,
  ) as Array<Timezone>;
  const LEGACY_NAME_BATCHES: Array<Array<Timezone>> = [];

  for (
    let start: number = 0;
    start < ALL_LEGACY_NAMES.length;
    start += LEGACY_NAME_BATCH_SIZE
  ) {
    LEGACY_NAME_BATCHES.push(
      ALL_LEGACY_NAMES.slice(start, start + LEGACY_NAME_BATCH_SIZE),
    );
  }

  test("the batches cover every legacy name", () => {
    expect(LEGACY_NAME_BATCHES.flat()).toEqual(ALL_LEGACY_NAMES);
    expect(ALL_LEGACY_NAMES.length).toBeGreaterThan(100);
  });

  for (const batch of LEGACY_NAME_BATCHES) {
    test(`every legacy name, typed in full, finds the option it maps to — once (${batch[0]} .. ${batch[batch.length - 1]})`, () => {
      /*
       * A short name such as "EST" or "GMT+0" also matches other entries by
       * substring, so this asks only that the right entry is among the
       * results, and that it is there once.
       */
      render(<Dropdown onChange={() => {}} options={TIMEZONE_OPTIONS} />);

      const misses: Array<string> = [];

      for (const legacyName of batch) {
        typeSearch(legacyName);

        const expectedLabel: string = getLabelFor(
          LEGACY_TIMEZONE_NAMES[legacyName]!,
        );
        const hits: number = getMenuOptionLabels().filter(
          (label: string): boolean => {
            return label === expectedLabel;
          },
        ).length;

        if (hits !== 1) {
          misses.push(`${legacyName} -> ${expectedLabel} (${hits} hits)`);
        }
      }

      expect(misses).toEqual([]);
    });
  }

  test("no search lists a legacy name as an entry of its own", () => {
    render(<Dropdown onChange={() => {}} options={TIMEZONE_OPTIONS} />);

    const legacyNames: Set<string> = new Set<string>(
      Object.keys(LEGACY_TIMEZONE_NAMES),
    );

    for (const typed of ["us/", "etc/", "calcutta", "zulu", "singapore"]) {
      typeSearch(typed);

      const listedLegacyNames: Array<string> = getMenuOptionLabels().filter(
        (label: string): boolean => {
          // A label is "<GMT offset> <zone name>".
          const zoneName: string = label.slice(label.indexOf(" ") + 1);

          return legacyNames.has(zoneName);
        },
      );

      expect({ typed: typed, listedLegacyNames: listedLegacyNames }).toEqual({
        typed: typed,
        listedLegacyNames: [],
      });
    }
  });

  test("subscriber timezones: a clock already chosen under its old name is not offered again by that name", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        isMultiSelect={true}
        onChange={onChange}
        options={TIMEZONE_OPTIONS}
        value={asStoredValue(["Singapore"])}
      />,
    );

    typeSearch("Singapore");
    expect(getMenuOptionLabels()).toEqual([]);

    typeSearch("Calcutta");
    expect(getMenuOptionLabels()).toEqual([getLabelFor(Timezone.AsiaKolkata)]);

    pressEnter();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      Timezone.AsiaSingapore,
      Timezone.AsiaKolkata,
    ]);
    expect(getChipLabels()).toEqual([
      getLabelFor(Timezone.AsiaSingapore),
      getLabelFor(Timezone.AsiaKolkata),
    ]);
  });
});
