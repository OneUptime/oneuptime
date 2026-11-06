import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import ResourceOverview, {
  getResourceOverviewIdentifierWords,
  RESOURCE_OVERVIEW_DETAILS_DESCRIPTION,
  RESOURCE_OVERVIEW_IDENTIFIER_SENTENCE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import frenchLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fr.json";
import italianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/it.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import chineseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/zh-CN.json";
import { CLOUD_ACCOUNT_STATUS_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAccountStatus";
import { CLOUD_RESOURCE_STATUS_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/MonitoredResourceOverview";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { getTemplatePlaceholders, Translator } from "../../../Types/Translator";
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
    ["fr", frenchLocale],
    ["it", italianLocale],
    ["fa", persianLocale],
    ["zh-CN", chineseLocale],
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
    statusDescription?: string | undefined;
    identifier?: string | undefined;
    identifierLabel?: string | undefined;
  },
): void {
  setDateDisplayLanguage(language);

  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter initialEntries={["/dashboard/overview"]}>
        <ResourceOverview
          icon={IconProp.Database}
          title="orders-db"
          identifier={props.identifier ?? "orders-db:5432"}
          identifierLabel={props.identifierLabel ?? "endpoint"}
          status={props.status}
          statusLabel={props.statusLabel}
          statusDescription={props.statusDescription}
          lastSeenAt={props.lastSeenAt}
          chips={[]}
          tiles={[]}
          detailRows={[]}
          detailsDescription={RESOURCE_OVERVIEW_DETAILS_DESCRIPTION}
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

  test("its hover says what the pill means in the reader's language", () => {
    renderHero("de", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "connected",
      statusLabel: "Reading",
      statusDescription: CLOUD_ACCOUNT_STATUS_DESCRIPTIONS.reading,
    });

    expect(pill().getAttribute("title")).toBe(
      "Eine Cloud-Verbindung hat dieses Konto in der letzten Stunde gelesen.",
    );
    cleanup();

    renderHero("en", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "connected",
      statusDescription: CLOUD_ACCOUNT_STATUS_DESCRIPTIONS.reading,
    });

    expect(pill().getAttribute("title")).toBe(
      "A cloud connection read this account within the last hour.",
    );
  });

  test("a hover a page worded itself stays as given; none, no hover", () => {
    renderHero("de", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "connected",
      statusDescription: "Schon übersetzt.",
    });

    expect(pill().getAttribute("title")).toBe("Schon übersetzt.");
    cleanup();

    renderHero("de", { lastSeenAt: FIVE_HOURS_AGO(), status: "connected" });

    expect(pill().hasAttribute("title")).toBe(false);
  });

  test("every hover a cloud page gives reads in every language", () => {
    for (const description of [
      ...Object.values(CLOUD_ACCOUNT_STATUS_DESCRIPTIONS),
      ...Object.values(CLOUD_RESOURCE_STATUS_DESCRIPTIONS),
    ]) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          language,
          description,
          worded: isWordedInDashboardLocale(description, language),
        }).toEqual({ language, description, worded: true });
      }
    }
  });
});

describe("the hero's identifier line", () => {
  function identifierLine(): HTMLElement {
    return screen.getByTestId("resource-overview-identifier");
  }

  test("names what the identifier is in the reader's language", () => {
    renderHero("de", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "connected",
      identifierLabel: "type",
      identifier: "RDS DB Instance",
    });

    expect(identifierLine()).toHaveTextContent(/^Typ: RDS DB Instance$/);
    cleanup();

    renderHero("de", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "connected",
      identifierLabel: "account",
      identifier: "123456789012",
    });

    expect(identifierLine()).toHaveTextContent(/^Konto: 123456789012$/);
  });

  test("reads as it always did in English", () => {
    for (const [label, identifier] of [
      ["type", "RDS DB Instance"],
      ["account", "123456789012"],
      ["endpoint", "orders-db:5432"],
      ["destination", "orders"],
      ["platform", "AWS ECS / Fargate"],
      ["workload", "Container/postgres"],
    ]) {
      renderHero("en", {
        lastSeenAt: FIVE_HOURS_AGO(),
        status: "connected",
        identifierLabel: label,
        identifier,
      });

      expect(identifierLine().textContent).toBe(`${label}: ${identifier}`);
      cleanup();
    }
  });

  test("an attribute's own name is drawn as written", () => {
    renderHero("de", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "connected",
      identifierLabel: "service.name",
      identifier: "checkout",
    });

    expect(identifierLine()).toHaveTextContent(/^service\.name: checkout$/);
  });

  test("the identifier is set apart, so a Latin type keeps its brackets on a Persian page", () => {
    renderHero("fa", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "connected",
      identifierLabel: "type",
      identifier: "Elastic Load Balancer (ALB, NLB, GWLB)",
    });

    const isolated: HTMLElement | null = identifierLine().querySelector("bdi");

    expect(isolated?.textContent).toBe(
      "Elastic Load Balancer (ALB, NLB, GWLB)",
    );
    expect(identifierLine().textContent).toBe(
      "نوع: Elastic Load Balancer (ALB, NLB, GWLB)",
    );
  });

  /*
   * Cut with its line, a Latin identifier on a Persian phone lost its
   * start ("…d Balancer (ALB, NLB, GWLB)"): the label keeps its room and
   * the identifier alone is cut, at its own end, in its own direction.
   */
  test("too long for the line, the identifier alone is cut, at its own end", () => {
    renderHero("fa", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "connected",
      identifierLabel: "type",
      identifier: "Elastic Load Balancer (ALB, NLB, GWLB)",
    });

    const line: HTMLElement = identifierLine();
    const value: HTMLElement = screen.getByTestId(
      "resource-overview-identifier-value",
    );

    expect(line).toHaveClass("flex", "min-w-0");
    expect(line).not.toHaveClass("truncate");
    expect(line.firstElementChild).toHaveClass("flex-none");
    expect(line.firstElementChild?.textContent).toBe("نوع: ");
    expect(value.tagName).toBe("BDI");
    expect(value).toHaveClass("min-w-0", "truncate");
    // Its direction is its own text's: left to right for a Latin type.
    expect(value).toHaveAttribute("dir", "auto");
  });

  /*
   * #5702's review: the line was one run of monospace text. Set apart in
   * two elements, each took the page's universal Inter rule (index.ejs's
   * `*` rule reaches every element, so a child does not inherit the line's
   * font): every hero's identifier lost its monospace. Each piece says it.
   */
  test("the label and the identifier are each set in monospace, as the line always was", () => {
    renderHero("de", {
      lastSeenAt: FIVE_HOURS_AGO(),
      status: "connected",
      identifierLabel: "service.name",
      identifier: "checkout",
    });

    const line: HTMLElement = identifierLine();

    expect(line.children).toHaveLength(2);
    for (const piece of Array.from(line.children)) {
      expect(piece).toHaveClass("font-mono");
    }
    /*
     * A monospace space between them, as the one line had: the sentence's
     * own, kept as written - no gap of the row's besides.
     */
    expect(line.firstElementChild?.textContent).toBe("service.name: ");
    expect(line.firstElementChild).toHaveClass("whitespace-pre");
    expect(line.className).not.toMatch(/(^| )gap-/);
  });

  /*
   * #5702's follow-up: the line put a fixed ": " after its label. It is one
   * sentence now, "{{label}}: {{identifier}}", so each language writes the
   * colon its own way.
   */
  describe("its label's colon, as each language writes it", () => {
    function linePieces(): { label: string; value: string } {
      return {
        label:
          screen.getByTestId("resource-overview-identifier-label")
            .textContent || "",
        value:
          screen.getByTestId("resource-overview-identifier-value")
            .textContent || "",
      };
    }

    const IDENTIFIER: string = "Elastic Load Balancer (ALB, NLB, GWLB)";

    test("English: a colon after the label, then a space", () => {
      renderHero("en", {
        status: "connected",
        identifierLabel: "type",
        identifier: IDENTIFIER,
      });

      expect(linePieces()).toEqual({ label: "type: ", value: IDENTIFIER });
    });

    test("French spaces the colon", () => {
      renderHero("fr", {
        status: "connected",
        identifierLabel: "type",
        identifier: IDENTIFIER,
      });

      expect(linePieces()).toEqual({ label: "type : ", value: IDENTIFIER });
      expect(identifierLine().textContent).toBe(`type : ${IDENTIFIER}`);
    });

    test("German writes it as English does, after its own word", () => {
      renderHero("de", {
        status: "connected",
        identifierLabel: "account",
        identifier: "123456789012",
      });

      expect(linePieces()).toEqual({
        label: "Konto: ",
        value: "123456789012",
      });
    });

    test("Persian puts the colon after its word, read right to left, and sets a Latin label apart", () => {
      renderHero("fa", {
        status: "connected",
        identifierLabel: "type",
        identifier: IDENTIFIER,
      });

      expect(linePieces()).toEqual({ label: "نوع: ", value: IDENTIFIER });
      cleanup();

      renderHero("fa", {
        status: "connected",
        identifierLabel: "service.name",
        identifier: "checkout",
      });

      const label: string = linePieces().label;

      expect(withoutIsolateMarks(label)).toBe("service.name: ");
      // Set apart, so its dot never moves the colon in a sentence read right to left.
      expect(label).not.toBe(withoutIsolateMarks(label));
    });

    test("Chinese writes a full-width colon with no space after it", () => {
      renderHero("zh-CN", {
        status: "connected",
        identifierLabel: "type",
        identifier: IDENTIFIER,
      });

      expect(linePieces()).toEqual({ label: "类型：", value: IDENTIFIER });
    });

    test("a translation that lost the identifier reads the English sentence, never a line without it", () => {
      const german: Translator = dashboardTranslator("de");
      const lost: Translator = {
        ...german,
        translateTemplate: (): string => {
          return "Typ:";
        },
      };

      expect(getResourceOverviewIdentifierWords(lost, "Typ")).toEqual({
        before: "Typ: ",
        after: "",
      });
    });

    test("every language writes the sentence with both its values, the label before the identifier", () => {
      for (const language of DASHBOARD_LANGUAGES) {
        const worded: string =
          readDashboardLocale(language)[
            RESOURCE_OVERVIEW_IDENTIFIER_SENTENCE
          ] || "";

        expect({
          language,
          values: getTemplatePlaceholders(worded).sort(),
          labelFirst:
            worded.indexOf("{{label}}") < worded.indexOf("{{identifier}}"),
        }).toEqual({
          language,
          values: ["identifier", "label"],
          labelFirst: true,
        });

        const words: { before: string; after: string } =
          getResourceOverviewIdentifierWords(
            dashboardTranslator(language),
            "x",
          );

        expect({
          language,
          starts: withoutIsolateMarks(words.before).startsWith("x"),
        }).toEqual({
          language,
          starts: true,
        });
        expect({ language, after: words.after }).toEqual({
          language,
          after: "",
        });
      }
    });
  });

  test("each word a page names its identifier by reads in every language", () => {
    for (const label of [
      "type",
      "account",
      "endpoint",
      "destination",
      "platform",
      "workload",
    ]) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          language,
          label,
          worded: isWordedInDashboardLocale(label, language),
        }).toEqual({ language, label, worded: true });
      }
    }
  });
});
