import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import IpAddressList from "../../../UI/Components/IpAddressList/IpAddressList";

/*
 * A host's IP addresses, as its Overview's Host Details card lists them
 * (IpAddressList): grouped by kind, each kind with its name, what it means
 * and how many of the host's addresses are of it - drawn here with the
 * Dashboard's own locale files, in every language it ships.
 *
 * The UI review of #5553 found those words English in twelve of the sixteen
 * languages - "Private LAN", "Local network — RFC1918." on a Persian page,
 * its full stop first - and "2 addresses" English in German and French
 * too, in a card whose every label was translated. A kind's name may read
 * as the English does only where the language keeps that technical word
 * ("Loopback" in German, "Link-local" in Danish), as that language's own
 * same-as-English list records.
 */

const DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
);
const LOCALES_DIR: string = path.join(DASHBOARD_DIR, "src", "Locales");
const PROGRESS_DIR: string = path.join(DASHBOARD_DIR, "i18n", "Progress");

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// An address of every kind the list tells apart, two of them private.
const ADDRESSES: string = [
  "8.8.8.8",
  "10.24.118.201",
  "172.17.0.1",
  "fd00:ec2::23",
  "100.64.0.1",
  "fe80::4c2:1aff:fe3b:9d1e",
  "127.0.0.1",
].join(", ");

interface Kind {
  title: string;
  description: string;
  count: number;
}

const KINDS: Array<Kind> = [
  { title: "Public", description: "Reachable from the internet.", count: 1 },
  { title: "Private LAN", description: "Local network — RFC1918.", count: 2 },
  {
    title: "Mesh / VPN",
    description: "Private overlay network — ULA (fc00::/7).",
    count: 1,
  },
  {
    title: "Carrier NAT",
    description: "Shared with the ISP — 100.64.0.0/10 (CGNAT).",
    count: 1,
  },
  {
    title: "Link-local",
    description: "Auto-assigned per interface — only valid on the local link.",
    count: 1,
  },
  { title: "Loopback", description: "Local machine only.", count: 1 },
];

const COUNT_KEY: string = "{{count}} addresses";

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function readLocale(code: string): Record<string, string> {
  return readJson(path.join(LOCALES_DIR, `${code}.json`)) as Record<
    string,
    string
  >;
}

// What a language records as reading the same as the English.
function sameAsEnglish(code: string): Array<string> {
  const progress: Record<string, unknown> = readJson(
    path.join(PROGRESS_DIR, `${code}.json`),
  );
  return (progress["sameAsEnglish"] as Array<string> | undefined) || [];
}

const DIGITS: RegExp = /\p{Nd}/gu;
const COUNT_PLACEHOLDER: string = "{{count}}";

// A count's words, its number left out: "2 Adressen" and "{{count}} Adressen" are "Adressen".
function countWords(text: string): string {
  return text.split(COUNT_PLACEHOLDER).join("").replace(DIGITS, "").trim();
}

async function renderIn(
  code: string,
  translation: Record<string, string>,
): Promise<void> {
  const instance: i18n = createInstance();
  await instance.init({
    lng: code,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [code]: { translation: translation },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
  render(
    <I18nextProvider i18n={instance}>
      <IpAddressList text={ADDRESSES} />
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("a host's IP addresses, in every language the Dashboard ships", () => {
  test.each(LANGUAGES)(
    "%s: every kind's name, meaning and count in the reader's language",
    async (code: string) => {
      const translation: Record<string, string> = readLocale(code);
      const keptAsEnglish: Array<string> = sameAsEnglish(code);
      const plural: Intl.PluralRules = new Intl.PluralRules(code);

      await renderIn(code, translation);

      for (const kind of KINDS) {
        const title: string = translation[kind.title] as string;
        const description: string = translation[kind.description] as string;

        // The locale has its own words for the kind, or keeps the English on purpose.
        if (title === kind.title) {
          expect(keptAsEnglish).toContain(kind.title);
        }
        expect(description).not.toBe(kind.description);

        const titleElement: HTMLElement = screen.getByText(title, {
          exact: true,
        });
        expect(
          titleElement.parentElement?.nextElementSibling,
        ).toHaveTextContent(description);

        // "2 Adressen", "Адресов: 2", "۲ نشانی" - never "2 addresses".
        const countKey: string =
          plural.select(kind.count) === "one" &&
          !["ja", "ko", "zh-CN", "zh-TW"].includes(code)
            ? `${COUNT_KEY}_one`
            : COUNT_KEY;
        const countTemplate: string = translation[countKey] as string;
        const countElement: Element | null = titleElement.nextElementSibling;

        expect(countWords(countElement?.textContent || "")).toBe(
          countWords(countTemplate),
        );
        expect(countWords(countTemplate)).not.toBe(
          countWords(kind.count === 1 ? "{{count}} address" : COUNT_KEY),
        );
      }
    },
  );

  test("German: the words, and the count in its two forms", async () => {
    await renderIn("de", readLocale("de"));

    expect(screen.getByText("Privates LAN")).toBeInTheDocument();
    expect(screen.getByText("2 Adressen")).toBeInTheDocument();
    expect(screen.getAllByText("1 Adresse").length).toBeGreaterThan(0);
    expect(screen.getByText("Lokales Netzwerk — RFC1918.")).toBeInTheDocument();
    expect(screen.queryByText(/addresses?$/u)).toBeNull();
  });

  test("Persian: the words, so no English sentence puts its full stop first", async () => {
    await renderIn("fa", readLocale("fa"));

    expect(screen.getByText("LAN خصوصی")).toBeInTheDocument();
    expect(screen.getByText("از اینترنت در دسترس است.")).toBeInTheDocument();
    expect(screen.getByText("شبکهٔ محلی — RFC1918.")).toBeInTheDocument();
    expect(screen.queryByText("Local network — RFC1918.")).toBeNull();
    expect(screen.queryByText("Reachable from the internet.")).toBeNull();
  });
});
