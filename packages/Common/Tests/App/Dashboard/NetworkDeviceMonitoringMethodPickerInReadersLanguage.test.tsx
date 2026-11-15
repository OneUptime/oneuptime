import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import Dropdown from "../../../UI/Components/Dropdown/Dropdown";
import { readDashboardLocaleAsDrawn } from "../../Helpers/DashboardLocales";
import {
  MONITORING_METHOD_FIELD_DESCRIPTION,
  MONITORING_METHOD_OPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/MonitoringMethodFormFields";

/*
 * A NETWORK DEVICE'S MONITORING METHOD PICKER, DRAWN IN THE READER'S
 * LANGUAGE (#8308).
 *
 * The picker on a device's Settings page offers Probe and Bound monitor. In
 * twelve languages its options were drawn in English under a translated
 * form, so a Danish reader read "Probe — pinged by the assigned probe ...".
 * Drawn here through the shared Dropdown and the real i18next with the
 * Dashboard's locale files: each option reads in the language, starts with
 * the name the field's description uses for it, and a search in the
 * language's words finds it.
 */

const RENDERED: ReadonlyArray<string> = ["en", "de", "ar", "fa", "da", "zh-CN"];

// The name an option is known by: its words before the explanation.
function nameOf(text: string): string {
  return (text.split(/\s*[—–]\s*|:\s+/)[0] as string).trim();
}

function box(): HTMLElement {
  return screen.getByRole("combobox");
}

async function openMenu(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(box(), { key: "ArrowDown" });
  });
}

async function type(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(box(), { target: { value: text } });
  });
}

function listed(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__option"),
  ).map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

function picked(): string {
  return (
    document.querySelector<HTMLElement>(".ou-select__single-value")
      ?.textContent || ""
  );
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

// An option's label as the language words it.
function worded(language: string, label: string): string {
  return readDashboardLocaleAsDrawn(language)[label] || label;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of RENDERED) {
    resources[language] = {
      translation: readDashboardLocaleAsDrawn(language),
    };
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

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

const PROBE_LABEL: string = MONITORING_METHOD_OPTIONS[0]!.label as string;
const BOUND_LABEL: string = MONITORING_METHOD_OPTIONS[1]!.label as string;

describe("the monitoring method picker", () => {
  test("offers Probe and then Bound monitor in English", async () => {
    await inLanguage("en");
    render(
      <Dropdown
        ariaLabel="Monitoring method"
        options={MONITORING_METHOD_OPTIONS}
      />,
    );
    await openMenu();

    expect(listed()).toEqual([PROBE_LABEL, BOUND_LABEL]);
    expect(nameOf(listed()[0]!)).toBe("Probe");
    expect(nameOf(listed()[1]!)).toBe("Bound monitor");
  });

  test.each(
    RENDERED.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "draws both options in %s, named as the field's description names them",
    async (language: string) => {
      await inLanguage(language);
      render(
        <Dropdown
          ariaLabel="Monitoring method"
          options={MONITORING_METHOD_OPTIONS}
        />,
      );
      await openMenu();

      const options: Array<string> = listed();
      const description: string = worded(
        language,
        MONITORING_METHOD_FIELD_DESCRIPTION,
      );

      expect(options).toEqual([
        worded(language, PROBE_LABEL),
        worded(language, BOUND_LABEL),
      ]);
      expect(options.join(" ")).not.toMatch(/\bProbe\b|Bound monitor|pinged/);
      expect(nameOf(options[0]!)).toBe(worded(language, "Probe"));
      expect(description).toContain(nameOf(options[0]!));
      expect(description).toContain(nameOf(options[1]!));
    },
  );

  test.each(
    RENDERED.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "draws the method a device has in %s, and finds the other by its name there",
    async (language: string) => {
      await inLanguage(language);
      render(
        <Dropdown
          ariaLabel="Monitoring method"
          options={MONITORING_METHOD_OPTIONS}
          value={MONITORING_METHOD_OPTIONS[0]}
        />,
      );

      expect(picked()).toBe(worded(language, PROBE_LABEL));

      await openMenu();
      await type(nameOf(worded(language, BOUND_LABEL)));

      expect(listed()).toEqual([worded(language, BOUND_LABEL)]);
    },
  );

  test.each([
    ["de", "Sonde", "Gebundener Monitor"],
    ["ar", "المسبار", "مراقبة مرتبطة"],
    ["fa", "پراب", "مانیتور متصل"],
    ["da", "Sonde", "Bundet monitor"],
    ["zh-CN", "探测器", "绑定的监视器"],
  ])(
    "reads in %s as %p and %p",
    async (language: string, probe: string, bound: string) => {
      await inLanguage(language);
      render(
        <Dropdown
          ariaLabel="Monitoring method"
          options={MONITORING_METHOD_OPTIONS}
        />,
      );
      await openMenu();

      expect(listed().map(nameOf)).toEqual([probe, bound]);
    },
  );
});
