import "@testing-library/jest-dom";
import React, { ReactElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import {
  EpisodeHeaderRefreshError,
  EpisodeHeaderSkeleton,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeHeader";
import EventOverviewSkeleton from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventOverviewSkeleton";
import ExceptionSegmentedControl from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSegmentedControl";
import StackFrameViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/StackFrameViewer";
import BreadcrumbTimeline from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/BreadcrumbTimeline";
import KubernetesContainersTab from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesContainersTab";
import FilterQueryBuilderField from "../../../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryBuilderField";
import LogFilterConfig from "../../../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/LogFilterConfig";
import { buildFilterQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryParser";
import { InventoryLivenessBadge } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryBadges";
import { MonitorTemplateSyncFieldsSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTemplateSyncFields";
import ToolApprovalCard from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import { KubernetesContainerSpec } from "../../../Types/Kubernetes/KubernetesObjectParser";
import { MinifiedStackFrame } from "../../../Types/Telemetry/SourceMap";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import MonitorType from "../../../Types/Monitor/MonitorType";

/*
 * The Dashboard's components from AI to Logs put their copy on the screen in
 * the reader's language: fixed strings and the English keys they are handed
 * are looked up, sentences are filled after they are translated (a message,
 * a name or a count lands where the locale puts it), and counts pick the
 * language's plural form. A locale without a sentence shows it in English,
 * whole.
 *
 * The test locale is German, keyed by the English text exactly as
 * App/FeatureSet/Dashboard/src/Locales/de.json is ("_one" for the singular of
 * a plural). Each instance reaches the components through I18nextProvider
 * only, so nothing leaks into the global instance.
 */

const GERMAN: Record<string, string> = {
  // EpisodeView/EpisodeHeader
  "Couldn't refresh this episode: {{message}}":
    "Diese Episode konnte nicht aktualisiert werden: {{message}}",
  "Try again": "Erneut versuchen",
  "Loading episode": "Episode wird geladen",
  // EventView/EventOverviewSkeleton
  "Loading incident": "Vorfall wird geladen",
  Loading: "Wird geladen",
  // Exceptions/ExceptionSegmentedControl
  "Frame order": "Reihenfolge der Frames",
  "Newest first": "Neueste zuerst",
  "The crash point at the top": "Der Absturzpunkt oben",
  // Exceptions/StackFrameViewer
  "{{count}} frames": "{{count}} Frames",
  "{{count}} frames_one": "{{count}} Frame",
  "{{count}} in your code": "{{count}} in Ihrem Code",
  "{{count}} in your code_one": "{{count}} in Ihrem Code",
  "{{count}} source mapped": "{{count}} per Source Map aufgelöst",
  "{{count}} source mapped_one": "{{count}} per Source Map aufgelöst",
  "{{count}} source maps were too large to load, so some frames still show minified locations.":
    "{{count}} Source Maps waren zu groß zum Laden, daher zeigen einige Frames noch minifizierte Positionen.",
  "{{count}} source maps were too large to load, so some frames still show minified locations._one":
    "{{count}} Source Map war zu groß zum Laden, daher zeigen einige Frames noch minifizierte Positionen.",
  "Most likely crash point:": "Wahrscheinlichster Absturzpunkt:",
  "{{function}} in {{file}}": "{{function}} in {{file}}",
  // Exceptions/BreadcrumbTimeline
  "No breadcrumbs": "Keine Breadcrumbs",
  "The trace recorded no events leading up to this exception.":
    "Der Trace hat keine Ereignisse vor dieser Ausnahme aufgezeichnet.",
  "Filter breadcrumbs by category": "Breadcrumbs nach Kategorie filtern",
  All: "Alle",
  // Kubernetes/KubernetesContainersTab
  "Init Container: {{name}}": "Init-Container: {{name}}",
  "Container: {{name}}": "Container: {{name}}",
  "Environment Variables": "Umgebungsvariablen",
  "No container information available.":
    "Keine Container-Informationen verfügbar.",
  // FilterQueryBuilder
  log: "Log",
  "{{entity}} must match": "{{entity}} muss passen auf",
  "All conditions": "Alle Bedingungen",
  "Any condition": "Eine Bedingung",
  // Inventory/InventoryBadges
  Live: "Aktiv",
  "{{count}}m ago": "vor {{count}} Min.",
  // Form/Monitor/MonitorTemplateSyncFields
  "Template sync settings": "Einstellungen der Vorlagensynchronisierung",
  "Network device bindings are always preserved. Other step settings are copied from the template.":
    "Netzwerkgeräte-Zuordnungen bleiben immer erhalten. Andere Schritteinstellungen werden aus der Vorlage übernommen.",
  "New monitors still start with the template's values for every field.":
    "Neue Monitore starten weiterhin mit den Werten der Vorlage für jedes Feld.",
  // AIChat/ToolApprovalCard
  "The AI wants to perform {{count}} actions":
    "Die KI möchte {{count}} Aktionen ausführen",
  "The AI wants to perform {{count}} actions_one":
    "Die KI möchte {{count}} Aktion ausführen",
  "Run {{count}} actions": "{{count}} Aktionen ausführen",
  "Run {{count}} actions_one": "{{count}} Aktion ausführen",
  Executed: "Ausgeführt",
};

// German with the words, but none of the sentences.
const GERMAN_WORDS_ONLY: Record<string, string> = {
  "Try again": "Erneut versuchen",
  incident: "Vorfall",
};

const german: i18n = createInstance();
const germanWordsOnly: i18n = createInstance();

beforeAll(async () => {
  for (const [instance, translations] of [
    [german, GERMAN],
    [germanWordsOnly, GERMAN_WORDS_ONLY],
  ] as Array<[i18n, Record<string, string>]>) {
    await instance.init({
      lng: "de",
      resources: { de: { translation: translations } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  }
});

afterEach(() => {
  cleanup();
});

const inLocale: (instance: i18n, element: ReactElement) => void = (
  instance: i18n,
  element: ReactElement,
): void => {
  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);
};

describe("an episode's header says what failed in the reader's language", () => {
  test("the refresh error is one sentence with the message in it, and the retry is translated", () => {
    inLocale(
      german,
      <EpisodeHeaderRefreshError
        message="Gateway timeout"
        onRetry={() => {}}
      />,
    );

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Diese Episode konnte nicht aktualisiert werden: Gateway timeout",
    );
    expect(
      within(alert).getByRole("button", { name: "Erneut versuchen" }),
    ).toBeInTheDocument();
  });

  test("a locale without the sentence shows it in English, whole", () => {
    inLocale(
      germanWordsOnly,
      <EpisodeHeaderRefreshError
        message="Gateway timeout"
        onRetry={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't refresh this episode: Gateway timeout",
    );
  });

  test("the loading placeholders announce themselves in the reader's language", () => {
    inLocale(german, <EpisodeHeaderSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Episode wird geladen",
    );
    cleanup();

    inLocale(german, <EventOverviewSkeleton loadingText="Loading incident" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vorfall wird geladen",
    );
    cleanup();

    inLocale(german, <EventOverviewSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Wird geladen");
  });
});

describe("the exception pages", () => {
  test("the segmented control looks up the group's label and each option's label and title", () => {
    inLocale(
      german,
      <ExceptionSegmentedControl<"newest" | "oldest">
        label="Frame order"
        value="newest"
        onChange={() => {}}
        options={[
          {
            value: "newest",
            label: "Newest first",
            title: "The crash point at the top",
            hint: "12",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("radiogroup", { name: "Reihenfolge der Frames" }),
    ).toBeInTheDocument();
    const option: HTMLElement = screen.getByRole("radio");
    expect(option).toHaveTextContent("Neueste zuerst");
    // A hint is a count, shown as given.
    expect(option).toHaveTextContent("12");
    expect(option).toHaveAttribute("title", "Der Absturzpunkt oben");
  });

  const FRAMES: Array<MinifiedStackFrame> = [
    {
      functionName: "reserveInventory",
      fileName: "/app/dist/services/inventory.js",
      lineNumber: 212,
      columnNumber: 17,
      inApp: true,
    },
    {
      functionName: "Layer.handle",
      fileName: "/app/node_modules/express/lib/router/layer.js",
      lineNumber: 95,
      columnNumber: 5,
      inApp: false,
    },
  ];

  test("the stack trace counts its frames in the language's plural forms", () => {
    inLocale(
      german,
      <StackFrameViewer
        stackTrace={[
          "InventoryReservationError: Could not reserve stock",
          "    at reserveInventory (/app/dist/services/inventory.js:212:17)",
          "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
        ].join("\n")}
        parsedFrames={JSON.stringify(FRAMES)}
        skippedSourceMapCount={1}
      />,
    );

    expect(screen.getByText("2 Frames · 1 in Ihrem Code")).toBeInTheDocument();
    expect(
      screen.getByTestId("stack-trace-source-maps-skipped"),
    ).toHaveTextContent(
      "1 Source Map war zu groß zum Laden, daher zeigen einige Frames noch minifizierte Positionen.",
    );
    expect(screen.getByTestId("stack-trace-crash-point")).toHaveTextContent(
      "Wahrscheinlichster Absturzpunkt: reserveInventory in",
    );
  });

  test("the breadcrumbs' empty state and category filter are translated", () => {
    inLocale(german, <BreadcrumbTimeline events={[]} />);

    const empty: HTMLElement = screen.getByTestId("breadcrumbs-empty");
    expect(empty).toHaveTextContent("Keine Breadcrumbs");
    expect(empty).toHaveTextContent(
      "Der Trace hat keine Ereignisse vor dieser Ausnahme aufgezeichnet.",
    );
    cleanup();

    const time: Date = new Date(2026, 8, 14, 11, 56, 0, 0);
    inLocale(
      german,
      <BreadcrumbTimeline
        exceptionTime={time}
        events={[
          {
            name: "http.request",
            time: new Date(time.getTime() - 800),
            timeUnixNano: (time.getTime() - 800) * 1000000,
            attributes: { "http.method": "POST" },
          },
          {
            name: "db.query",
            time: new Date(time.getTime() - 400),
            timeUnixNano: (time.getTime() - 400) * 1000000,
            attributes: { "db.system": "postgresql" },
          },
        ]}
      />,
    );

    const filters: HTMLElement = screen.getByRole("group", {
      name: "Breadcrumbs nach Kategorie filtern",
    });
    expect(
      within(filters).getByTestId("breadcrumb-filter-all"),
    ).toHaveTextContent("Alle");
  });
});

describe("a pod's containers", () => {
  function container(name: string): KubernetesContainerSpec {
    return {
      name,
      image: "nginx:1.27",
      command: [],
      args: [],
      env: [
        { name: "MODE", value: "production" },
        { name: "PORT", value: "8080" },
      ],
      ports: [],
      resources: { requests: {}, limits: {} },
      volumeMounts: [],
    };
  }

  test("each card is titled in the reader's language, with the name in its place", () => {
    inLocale(
      german,
      <KubernetesContainersTab
        containers={[container("app")]}
        initContainers={[container("migrate")]}
      />,
    );

    expect(screen.getByText("Init-Container: migrate")).toBeInTheDocument();
    expect(screen.getByText("Container: app")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Umgebungsvariablen \(2\)/ }),
    ).toHaveLength(2);
  });

  test("a pod without containers says so", () => {
    inLocale(
      german,
      <KubernetesContainersTab containers={[]} initContainers={[]} />,
    );

    expect(
      screen.getByText("Keine Container-Informationen verfügbar."),
    ).toBeInTheDocument();
  });
});

describe("the filter builder", () => {
  test("the connector row names the entity as a term, starts with a capital and translates its choices", () => {
    inLocale(
      german,
      <FilterQueryBuilderField
        config={LogFilterConfig}
        value={buildFilterQuery(
          [
            { field: "severityText", operator: "=", value: "Error" },
            { field: "body", operator: "LIKE", value: "timeout" },
          ],
          "AND",
          LogFilterConfig,
        )}
      />,
    );

    expect(screen.getByText("Log muss passen auf")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Alle Bedingungen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Eine Bedingung" }),
    ).toBeInTheDocument();
  });
});

describe("inventory badges", () => {
  test("liveness is labelled and aged in the reader's language", () => {
    const now: Date = new Date("2026-09-30T12:00:00.000Z");

    inLocale(
      german,
      <InventoryLivenessBadge
        source={EntitySource.Discovered}
        lastSeenAt={new Date(now.getTime() - 4 * 60 * 1000)}
        now={now}
        showAge={true}
      />,
    );

    expect(screen.getByText("Aktiv")).toBeInTheDocument();
    expect(screen.getByText(/vor 4 Min\./)).toBeInTheDocument();
  });
});

describe("a monitor template's sync settings", () => {
  test("the summary is translated, including the sentence built for the monitor type", () => {
    inLocale(
      german,
      <MonitorTemplateSyncFieldsSummary
        monitorType={MonitorType.NetworkDevice}
        monitorSteps={undefined}
      />,
    );

    expect(
      screen.getByText("Einstellungen der Vorlagensynchronisierung"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Netzwerkgeräte-Zuordnungen bleiben immer erhalten. Andere Schritteinstellungen werden aus der Vorlage übernommen.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Neue Monitore starten weiterhin mit den Werten der Vorlage für jedes Feld.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the AI chat's tool approvals", () => {
  function action(
    id: string,
    status: AIChatToolActionStatus,
  ): AIChatToolAction {
    return {
      id,
      toolName: "createIncident",
      title: `Create incident ${id}`,
      arguments: { title: "Checkout is down" },
      isMutation: true,
      requiresApproval: true,
      status,
    };
  }

  test("the pending actions are counted in the German plural form, on the heading and the button", () => {
    inLocale(
      german,
      <ToolApprovalCard
        toolActions={[
          action("a", AIChatToolActionStatus.Pending),
          action("b", AIChatToolActionStatus.Pending),
        ]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(
      screen.getByText("Die KI möchte 2 Aktionen ausführen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "2 Aktionen ausführen" }),
    ).toBeInTheDocument();
  });

  test("one pending action takes the singular, and a finished one's status is translated", () => {
    inLocale(
      german,
      <ToolApprovalCard
        toolActions={[
          action("a", AIChatToolActionStatus.Pending),
          action("b", AIChatToolActionStatus.Executed),
        ]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(
      screen.getByText("Die KI möchte 1 Aktion ausführen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1 Aktion ausführen" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ausgeführt")).toBeInTheDocument();
  });
});
