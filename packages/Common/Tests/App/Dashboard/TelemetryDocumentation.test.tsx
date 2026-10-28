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
import { TELEMETRY_GUIDE_LANGUAGE_KEYS } from "../../../Types/Telemetry/OpenTelemetryGuides";
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

    /*
     * UI review: a row of three methods where two titles stood behind a logo
     * and the third did not started its titles on two lines. The SDKs show
     * a code icon in the logo's place, the size a logo is (20px), grey -
     * indigo while picked, as the picked title is - and never read out.
     */
    test("the SDK method shows a code icon in the logo's place, so the three titles line up", () => {
      renderGuide("profiles");

      const sdkTitle: HTMLElement = screen.getByText("Language SDK", {
        selector: "div",
      });
      const icon: Element | null = sdkTitle.querySelector(
        '[data-testid="provider-icon-tile"]',
      );

      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(icon).toHaveClass("h-5", "w-5", "flex-shrink-0", "text-gray-500");
      // First on the line, where the other titles have their logos.
      expect(sdkTitle.firstElementChild).toContainElement(icon as HTMLElement);

      // The logos beside the other two titles are 20px, as the icon is.
      for (const label of ["Grafana Alloy (eBPF)", "Kubernetes agent (eBPF)"]) {
        const mark: Element | null = screen
          .getByText(label, { selector: "div" })
          .querySelector("[data-provider-logo] > span");

        expect(mark).toHaveClass("h-5", "w-5");
      }

      fireEvent.click(sdkTitle);

      expect(
        screen
          .getByText("Language SDK", { selector: "div" })
          .querySelector('[data-testid="provider-icon-tile"]'),
      ).toHaveClass("text-indigo-600");
    });

    test("each method says whether it is the one picked", () => {
      renderGuide("logs");

      const methodButton: (label: string) => HTMLElement = (
        label: string,
      ): HTMLElement => {
        return screen
          .getByText(label, { selector: "div" })
          .closest("button") as HTMLElement;
      };

      expect(methodButton("OpenTelemetry")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(methodButton("FluentBit")).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      fireEvent.click(methodButton("FluentBit"));

      expect(methodButton("FluentBit")).toHaveAttribute("aria-pressed", "true");
      expect(methodButton("OpenTelemetry")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
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

  /*
   * The website's step-by-step guide for the language picked, and one per
   * framework of that language (Common/Types/Telemetry/OpenTelemetryGuides):
   * each language button opens its own guides, and a language with no guide
   * yet shows none. One label, then the guides as a list of links with a
   * dot between them, each opening in a new tab.
   */
  describe("the step-by-step guides on the website", () => {
    // The dots between the guides, which only the eye reads.
    const separatorsIn: (line: HTMLElement) => Array<Element> = (
      line: HTMLElement,
    ): Array<Element> => {
      return Array.from(line.querySelectorAll('[aria-hidden="true"]')).filter(
        (element: Element): boolean => {
          return element.textContent === "\u00b7";
        },
      );
    };

    const guideLinks: () => Array<[string, string | null]> = (): Array<
      [string, string | null]
    > => {
      return within(screen.getByTestId("telemetry-framework-guides"))
        .getAllByRole("link")
        .map((link: HTMLElement): [string, string | null] => {
          return [link.textContent || "", link.getAttribute("href")];
        });
    };

    test("Node.js opens its own guide and every framework's, in the catalog's order", () => {
      renderGuide("traces");

      expect(guideLinks()).toEqual([
        ["Node.js", "https://oneuptime.com/integrations/opentelemetry/nodejs"],
        ["Express", "https://oneuptime.com/integrations/opentelemetry/express"],
        ["NestJS", "https://oneuptime.com/integrations/opentelemetry/nestjs"],
        ["Next.js", "https://oneuptime.com/integrations/opentelemetry/nextjs"],
        ["Fastify", "https://oneuptime.com/integrations/opentelemetry/fastify"],
        ["Koa", "https://oneuptime.com/integrations/opentelemetry/koa"],
        ["hapi", "https://oneuptime.com/integrations/opentelemetry/hapi"],
        ["Bun", "https://oneuptime.com/integrations/opentelemetry/bun"],
        ["Deno", "https://oneuptime.com/integrations/opentelemetry/deno"],
      ]);
      // Several guides: the label is plural.
      expect(
        within(screen.getByTestId("telemetry-framework-guides")).getByText(
          "Step-by-step guides",
        ),
      ).toBeInTheDocument();
      for (const link of within(
        screen.getByTestId("telemetry-framework-guides"),
      ).getAllByRole("link")) {
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      }
    });

    test("lists the guides as one list, a dot between two and none after the last", () => {
      renderGuide("traces");
      const line: HTMLElement = screen.getByTestId(
        "telemetry-framework-guides",
      );

      // A screen reader hears one list of nine guides, not nine loose links.
      const items: Array<HTMLElement> = within(
        within(line).getByRole("list"),
      ).getAllByRole("listitem");
      expect(items.length).toBe(9);

      // The dots are for the eye only, and the last guide has none.
      expect(separatorsIn(line).length).toBe(8);
      expect(items[items.length - 1]!.textContent).toBe("Deno");

      // The words read as a list: no label for the frameworks of their own.
      expect(line).not.toHaveTextContent("For your framework");
    });

    test("tells a screen reader that every guide opens in a new tab", () => {
      renderGuide("traces");
      const line: HTMLElement = screen.getByTestId(
        "telemetry-framework-guides",
      );
      const links: Array<HTMLElement> = within(line).getAllByRole("link");

      for (const link of links) {
        expect(link).toHaveAccessibleDescription("(opens in a new tab)");
      }
      // One note, read with each link, not repeated on screen.
      const noteId: string | null = links[0]!.getAttribute("aria-describedby");
      expect(noteId).toBeTruthy();
      expect(document.getElementById(noteId!)?.className).toContain("sr-only");
    });

    test("React and Angular each open their own guide, with no framework list", () => {
      renderGuide("logs");

      fireEvent.click(screen.getByRole("button", { name: "React" }));
      expect(guideLinks()).toEqual([
        ["React", "https://oneuptime.com/integrations/opentelemetry/react"],
      ]);
      // One guide: the label is singular, and no dot follows it.
      const line: HTMLElement = screen.getByTestId(
        "telemetry-framework-guides",
      );
      expect(within(line).getByText("Step-by-step guide")).toBeInTheDocument();
      expect(
        within(line).queryByText("Step-by-step guides"),
      ).not.toBeInTheDocument();
      expect(separatorsIn(line)).toEqual([]);

      fireEvent.click(screen.getByRole("button", { name: "Angular" }));
      expect(guideLinks()).toEqual([
        ["Angular", "https://oneuptime.com/integrations/opentelemetry/angular"],
      ]);
    });

    test("offers a button for every language the guides' catalog knows, in its order", () => {
      expect(
        TELEMETRY_LANGUAGES.map((language: { key: string }): string => {
          return language.key;
        }),
      ).toEqual([...TELEMETRY_GUIDE_LANGUAGE_KEYS]);
    });

    test("a language with no guide shows none", () => {
      renderGuide("metrics");

      // Swift has no guide on the website, nor one planned with the others.
      fireEvent.click(screen.getByRole("button", { name: "Swift" }));

      expect(
        screen.queryByTestId("telemetry-framework-guides"),
      ).not.toBeInTheDocument();
    });

    test("an installation that goes by a name of its own sends nobody to OneUptime's website", () => {
      const browserWindow: { process?: { env?: Record<string, unknown> } } =
        window as unknown as { process?: { env?: Record<string, unknown> } };
      browserWindow.process = browserWindow.process || {};
      browserWindow.process.env = browserWindow.process.env || {};
      browserWindow.process.env["PRODUCT_BRANDING"] = JSON.stringify({
        productName: "Acme Observability",
      });

      try {
        renderGuide("traces");

        expect(
          screen.queryByTestId("telemetry-framework-guides"),
        ).not.toBeInTheDocument();
        // The guide itself is all there: only the website's links are left out.
        expect(
          screen.getByRole("button", { name: "Node.js" }),
        ).toBeInTheDocument();
      } finally {
        delete browserWindow.process.env["PRODUCT_BRANDING"];
      }
    });

    test("the profiles guide, which is not OpenTelemetry, shows none", () => {
      renderGuide("profiles");
      pickMethod("Language SDK");

      expect(
        screen.queryByTestId("telemetry-framework-guides"),
      ).not.toBeInTheDocument();
    });
  });
});
