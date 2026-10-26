import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import ResourceOverview from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import italianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/it.json";
import IconProp from "../../../Types/Icon/IconProp";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";

/*
 * The hero every telemetry overview shares (services, databases, message
 * queues, serverless functions, RUM apps, cloud resources): its last-seen
 * line and its status pill, in the reader's language.
 *
 * The line used to be English words around the reader's time - "Last seen
 * vor 5 Minuten" in German - with an English "never" for a resource that
 * never reported. It is one whole sentence now, either way. The pill reads
 * the product's own word in the reader's language ("Connected", "Seen
 * recently", "Reporting"), and a word a page worded itself as given.
 */

const FIVE_HOURS_AGO: () => Date = (): Date => {
  return new Date(Date.now() - 5 * 3600 * 1000);
};

const instances: Record<string, i18n> = {};

// An Italian word, as the Dashboard's Italian locale writes it.
function italianWord(key: string): string {
  const value: unknown = (italianLocale as Record<string, unknown>)[key];

  return typeof value === "string" ? value : "";
}

beforeAll(async () => {
  for (const [language, locale] of [
    ["en", englishLocale],
    ["de", germanLocale],
    ["it", italianLocale],
  ] as Array<[string, Record<string, unknown>]>) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

function renderHero(
  language: string,
  props: {
    lastSeenAt?: Date | undefined;
    status?: string | undefined;
    statusLabel?: string | undefined;
  },
): void {
  setDateDisplayLanguage(language);

  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter initialEntries={["/dashboard/overview"]}>
        <ResourceOverview
          icon={IconProp.Database}
          title="orders-db"
          identifier="orders-db:5432"
          identifierLabel="endpoint"
          status={props.status}
          statusLabel={props.statusLabel}
          lastSeenAt={props.lastSeenAt}
          chips={[]}
          tiles={[]}
          detailRows={[]}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function pill(): HTMLElement {
  return screen.getByTestId("resource-overview-status");
}

function titleBlock(): HTMLElement {
  return screen.getByTestId("resource-overview-title-block");
}

describe("the hero's last-seen line", () => {
  test("reads one English sentence in English, either way", () => {
    renderHero("en", { lastSeenAt: FIVE_HOURS_AGO(), status: "connected" });

    expect(titleBlock()).toHaveTextContent("Last seen 5 hours ago");
    cleanup();

    renderHero("en", { lastSeenAt: undefined, status: "disconnected" });

    expect(titleBlock()).toHaveTextContent("Never seen");
    expect(titleBlock()).not.toHaveTextContent(/Last seen|never/);
  });

  test("reads one German sentence, its time in German too", () => {
    renderHero("de", { lastSeenAt: FIVE_HOURS_AGO(), status: "connected" });

    expect(titleBlock()).toHaveTextContent("Zuletzt gesehen vor 5 Stunden");
    expect(titleBlock()).not.toHaveTextContent("Last seen");
  });

  test("says Never seen in the reader's words, not an English never", () => {
    renderHero("de", { lastSeenAt: undefined, status: "disconnected" });

    expect(titleBlock()).toHaveTextContent("Nie gesehen");
    expect(titleBlock()).not.toHaveTextContent(/Last seen|never/);
    cleanup();

    renderHero("it", { lastSeenAt: undefined, status: "disconnected" });

    expect(italianWord("Never seen")).not.toBe("");
    expect(italianWord("Never seen")).not.toBe("Never seen");
    expect(titleBlock()).toHaveTextContent(italianWord("Never seen"));
  });
});

describe("the hero's status pill", () => {
  test("names Connected and Disconnected in the reader's language", () => {
    renderHero("de", { lastSeenAt: FIVE_HOURS_AGO(), status: "connected" });

    expect(pill()).toHaveTextContent(/^Verbunden$/);
    cleanup();

    renderHero("de", { lastSeenAt: FIVE_HOURS_AGO(), status: "disconnected" });

    expect(pill()).toHaveTextContent(/^Getrennt$/);
  });

  test("names a database's liveness in the reader's language", () => {
    renderHero("de", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "active",
      statusLabel: "Seen recently",
    });

    expect(pill()).toHaveTextContent(/^Kürzlich gesehen$/);
    cleanup();

    renderHero("it", {
      lastSeenAt: undefined,
      status: "inactive",
      statusLabel: "Not seen recently",
    });

    expect(italianWord("Not seen recently")).not.toBe("Not seen recently");
    expect((pill().textContent || "").trim()).toBe(
      italianWord("Not seen recently"),
    );
  });

  test("keeps a word a page worded itself as given", () => {
    renderHero("de", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "active",
      // A message queue's pill arrives in the reader's words already.
      statusLabel: "Kürzlich gesehen",
    });

    expect(pill()).toHaveTextContent(/^Kürzlich gesehen$/);
  });

  test("reads the English word in English", () => {
    renderHero("en", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "active",
      statusLabel: "Reporting",
    });

    expect(pill()).toHaveTextContent(/^Reporting$/);
  });
});
