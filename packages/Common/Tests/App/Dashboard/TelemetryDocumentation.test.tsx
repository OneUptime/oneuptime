import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import TelemetryDocumentation, {
  TELEMETRY_LANGUAGES,
  TelemetryType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation";
import ProviderLogo, {
  isProviderLogo,
} from "../../../Types/ProviderLogo/ProviderLogo";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import API from "../../../UI/Utils/API/API";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";

/*
 * The telemetry ingestion guides (logs, metrics, traces, exceptions,
 * profiles) — the ones the resource setup guides were modelled on — follow
 * the same shape: a method picker, then only the steps a first setup needs.
 *
 * The OpenTelemetry path's optional extras (configuring through environment
 * variables, tagging the service with labels) are folded under Advanced,
 * and each log shipper's two ways of running it (on the host, or in Docker
 * Compose) are tabs of one step rather than two steps, one marked optional.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");

const KEY: TelemetryIngestionKey = new TelemetryIngestionKey();
KEY.id = new ObjectID("key-1");
KEY.name = "Production Key";
KEY.secretKey = new ObjectID("secret-production");
KEY.keyType = TelemetryIngestionKeyType.Server;

const renderGuide: (telemetryType: TelemetryType) => HTMLElement = (
  telemetryType: TelemetryType,
): HTMLElement => {
  const { container } = render(
    <MemoryRouter>
      <TelemetryDocumentation telemetryType={telemetryType} />
    </MemoryRouter>,
  );
  return container;
};

// The step headings on screen, in order.
const stepTitles: () => Array<string> = (): Array<string> => {
  return screen
    .getAllByRole("heading", { level: 4 })
    .map((heading: HTMLElement): string => {
      return heading.textContent || "";
    });
};

const pickMethod: (label: string) => void = (label: string): void => {
  fireEvent.click(screen.getByText(label, { selector: "div" }));
};

// Opens the folded topic with this title.
const openTopic: (title: string) => void = (title: string): void => {
  const topic: HTMLElement | undefined = screen
    .getAllByTestId("setup-guide-topic")
    .find((element: HTMLElement): boolean => {
      return (element.textContent || "").startsWith(title);
    });
  if (!topic) {
    throw new Error(`No topic titled "${title}" is on screen`);
  }
  fireEvent.click(within(topic).getByRole("button"));
};

describe("TelemetryDocumentation", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [KEY],
      count: 1,
      skip: 0,
      limit: 50,
    } as never);
    // The profiles guide polls for its first profile; nothing has arrived.
    jest.spyOn(API, "post").mockResolvedValue({
      data: { activity: [] },
    } as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  /*
   * Official logos audit: each language beside its own logo, and each
   * method beside the logo of the project it uses (OpenTelemetry, Fluent
   * Bit, Fluentd, Grafana Alloy, Kubernetes).
   */
  describe("the official logos", () => {
    const languageButton: (label: string) => HTMLElement = (
      label: string,
    ): HTMLElement => {
      return screen.getByRole("button", { name: label });
    };

    test("every language has a logo of its own", () => {
      const logos: Array<ProviderLogo> = TELEMETRY_LANGUAGES.map(
        (language: { logo: ProviderLogo }): ProviderLogo => {
          return language.logo;
        },
      );

      for (const logo of logos) {
        expect(isProviderLogo(logo)).toBe(true);
      }

      expect(new Set(logos).size).toBe(logos.length);
    });

    test("each language's button shows its logo, decorative, beside its name", () => {
      renderGuide("traces");

      for (const language of TELEMETRY_LANGUAGES) {
        const button: HTMLElement = languageButton(language.shortLabel);
        const logo: Element | null = button.querySelector(
          "[data-provider-logo]",
        );

        expect(logo).toHaveAttribute("data-provider-logo", language.logo);
        expect(logo).toHaveAttribute("aria-hidden", "true");
      }
    });

    test("the picked language is pressed, tinted rather than filled, so its logo stays readable", () => {
      renderGuide("traces");

      const node: HTMLElement = languageButton("Node.js");
      const python: HTMLElement = languageButton("Python");

      expect(node).toHaveAttribute("aria-pressed", "true");
      expect(python).toHaveAttribute("aria-pressed", "false");
      expect(node).toHaveClass("bg-indigo-50", "text-indigo-700");
      expect(node).not.toHaveClass("bg-indigo-600");

      fireEvent.click(python);

      expect(languageButton("Python")).toHaveAttribute("aria-pressed", "true");
      expect(languageButton("Node.js")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    test("the log guide's methods show OpenTelemetry's, Fluent Bit's and Fluentd's logos", () => {
      renderGuide("logs");

      for (const [label, logo] of [
        ["OpenTelemetry", ProviderLogo.OpenTelemetry],
        ["FluentBit", ProviderLogo.FluentBit],
        ["Fluentd", ProviderLogo.Fluentd],
      ] as Array<[string, ProviderLogo]>) {
        const method: HTMLElement = screen.getByText(label, {
          selector: "div",
        });

        expect(method.querySelector("[data-provider-logo]")).toHaveAttribute(
          "data-provider-logo",
          logo,
        );
      }
    });

    test("the profiles guide's eBPF methods show Grafana's and Kubernetes' logos; the SDKs, being several, none", () => {
      renderGuide("profiles");

      expect(
        screen
          .getByText("Grafana Alloy (eBPF)", { selector: "div" })
          .querySelector("[data-provider-logo]"),
      ).toHaveAttribute("data-provider-logo", ProviderLogo.Grafana);
      expect(
        screen
          .getByText("Kubernetes agent (eBPF)", { selector: "div" })
          .querySelector("[data-provider-logo]"),
      ).toHaveAttribute("data-provider-logo", ProviderLogo.Kubernetes);
      expect(
        screen
          .getByText("Language SDK", { selector: "div" })
          .querySelector("[data-provider-logo]"),
      ).toBeNull();
    });
  });

  describe("the OpenTelemetry path", () => {
    test.each([
      "logs",
      "metrics",
      "traces",
      "exceptions",
    ] as Array<TelemetryType>)(
      "%s: three steps, with the extras folded under Advanced",
      (telemetryType: TelemetryType) => {
        renderGuide(telemetryType);

        expect(stepTitles()).toEqual([
          "Get Your Ingestion Credentials",
          "Install Dependencies",
          "Configure the SDK",
        ]);

        const advanced: HTMLElement = screen.getByTestId(
          "telemetry-guide-advanced",
        );
        const toggle: HTMLElement = within(advanced).getAllByRole("button")[0]!;
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(toggle.textContent).toContain("2 topics");
        expect(
          screen.queryByText("Configure with environment variables instead"),
        ).not.toBeInTheDocument();
      },
    );

    test("the Advanced topics carry the selected key", async () => {
      const container: HTMLElement = renderGuide("logs");

      await waitFor(() => {
        expect(container.textContent).toContain("secret-production");
      });

      fireEvent.click(
        within(screen.getByTestId("telemetry-guide-advanced")).getAllByRole(
          "button",
        )[0]!,
      );
      openTopic("Configure with environment variables instead");

      expect(container.textContent).toContain(
        'OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=secret-production"',
      );

      openTopic("Tag this service with project labels");
      expect(container.textContent).toContain("oneuptime.label.team=payments");
    });

    test("no step is marked optional or alternative any more", () => {
      renderGuide("traces");
      for (const title of stepTitles()) {
        expect(title).not.toMatch(/Optional|Alternative/);
      }
    });
  });

  describe("the log shippers", () => {
    test("FluentBit: one run step, on the host or in Docker Compose", () => {
      const container: HTMLElement = renderGuide("logs");
      pickMethod("FluentBit");

      expect(stepTitles()).toEqual([
        "Get Your Ingestion Credentials",
        "Create FluentBit Configuration",
        "Run FluentBit",
      ]);

      const tabs: Array<HTMLElement> = screen.getAllByRole("tab");
      expect(
        tabs.map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
      ).toEqual(["On the host", "Docker Compose"]);
      expect(container.textContent).toContain("fluent-bit -c fluent-bit.conf");
      expect(container.textContent).not.toContain("image: fluent/fluent-bit");

      fireEvent.click(tabs[1]!);

      expect(container.textContent).toContain("image: fluent/fluent-bit");
      expect(container.textContent).not.toContain(
        "fluent-bit -c fluent-bit.conf",
      );
    });

    test("Fluentd: one run step, on the host or in Docker Compose", () => {
      const container: HTMLElement = renderGuide("logs");
      pickMethod("Fluentd");

      expect(stepTitles()).toEqual([
        "Get Your Ingestion Credentials",
        "Create Fluentd Configuration",
        "Run Fluentd",
      ]);
      expect(container.textContent).toContain("fluentd -c fluentd.conf");

      fireEvent.click(screen.getByRole("tab", { name: "Docker Compose" }));
      expect(container.textContent).not.toContain("fluentd -c fluentd.conf");
    });

    test("the log shippers have no Advanced section", () => {
      renderGuide("logs");
      pickMethod("FluentBit");
      expect(
        screen.queryByTestId("telemetry-guide-advanced"),
      ).not.toBeInTheDocument();
    });
  });

  describe("profiles", () => {
    test("Alloy: config, one run step with Docker Compose first, then verify", () => {
      const container: HTMLElement = renderGuide("profiles");

      expect(stepTitles()).toEqual([
        "Get Your Ingestion Credentials",
        "Create Alloy Configuration",
        "Run Alloy",
        "Verify It Is Working",
      ]);
      expect(
        screen.getAllByRole("tab").map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
      ).toEqual(["Docker Compose", "On the host"]);
      expect(container.textContent).toContain("image: grafana/alloy");

      fireEvent.click(screen.getByRole("tab", { name: "On the host" }));
      expect(container.textContent).toContain("alloy run alloy-config.alloy");
    });

    test("the Kubernetes agent: turn its profiler on, then verify; a cluster without the agent is pointed at its guide under the command", () => {
      const container: HTMLElement = renderGuide("profiles");
      pickMethod("Kubernetes agent (eBPF)");

      // Two real steps: installing the agent is not a numbered step of its own.
      expect(stepTitles()).toEqual([
        "Turn On the Agent's Profiler",
        "Verify It Is Working",
      ]);
      expect(container.textContent).toContain("--set profiling.enabled=true");

      const install: HTMLElement = screen.getByTestId(
        "profiles-setup-kubernetes-agent-install",
      );
      expect(install).toHaveTextContent(
        "No agent in the cluster yet? Install it with the Kubernetes setup guide",
      );
      expect(
        within(install)
          .getByRole("link", {
            name: "Install it with the Kubernetes setup guide",
          })
          .getAttribute("href"),
      ).toContain("/kubernetes/documentation");
      expect(container.textContent).not.toContain("No Agent Yet?");
    });

    test("the guide names all three ways in", () => {
      const container: HTMLElement = renderGuide("profiles");

      expect(container.textContent).toContain(
        "Send continuous profiling data to OneUptime using Grafana Alloy (eBPF), the OneUptime Kubernetes agent or Pyroscope language SDKs.",
      );
    });

    test("the SDK path keeps its verify step and has no Advanced section", () => {
      renderGuide("profiles");
      pickMethod("Language SDK");

      expect(stepTitles()).toEqual([
        "Get Your Ingestion Credentials",
        "Install Dependencies",
        "Configure the Profiler",
        "Verify It Is Working",
      ]);
      expect(
        screen.queryByTestId("telemetry-guide-advanced"),
      ).not.toBeInTheDocument();
    });
  });
});
