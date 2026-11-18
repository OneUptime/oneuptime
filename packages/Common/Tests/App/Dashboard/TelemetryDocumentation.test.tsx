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
import {
  getDrawnMark,
  preloadProviderLogoMarks,
} from "../../Helpers/ProviderLogoMarks";

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
  beforeAll(async (): Promise<void> => {
    await preloadProviderLogoMarks();
  });

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

      // The marks beside the other two titles fill 20px, as the icon does.
      for (const label of ["Grafana Alloy (eBPF)", "Kubernetes agent (eBPF)"]) {
        const logo: HTMLElement = screen
          .getByText(label, { selector: "div" })
          .querySelector("[data-provider-logo]") as HTMLElement;
        const mark: SVGElement | null = getDrawnMark(logo);

        expect(logo.style.minWidth).toBe("20px");
        expect(
          Math.max(
            Number(mark?.getAttribute("width")),
            Number(mark?.getAttribute("height")),
          ),
        ).toBe(20);
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

  /*
   * SEND A TEST LOG (#7760): one command under the endpoint and the key in
   * the logs guide's first step, to see them work before any app is set up.
   * Folded to one line - the guide's own steps are the way most people go -
   * and only where the step shows the OTLP endpoint and a Server key.
   */
  describe("a test log, in the logs guide's first step", () => {
    // The guide step an element is in.
    const firstStepOf: (element: HTMLElement) => HTMLElement = (
      element: HTMLElement,
    ): HTMLElement => {
      return element.closest("div.relative") as HTMLElement;
    };

    const keyShown: () => Promise<void> = async (): Promise<void> => {
      await waitFor(() => {
        expect(document.body.textContent).toContain("secret-production");
      });
    };

    /*
     * The fold, once the guide holds the key: the picker draws the key it
     * picked first and hands it to the guide after, in an effect, so the
     * fold under it comes a moment after the key is on screen.
     */
    const testLogShown: () => Promise<HTMLElement> =
      async (): Promise<HTMLElement> => {
        return screen.findByTestId("telemetry-test-log");
      };

    test("is folded under the endpoint and the key, to one line that says what it is for", async () => {
      renderGuide("logs");
      await keyShown();

      const fold: HTMLElement = await testLogShown();
      const toggle: HTMLElement = screen.getByTestId(
        "telemetry-test-log-toggle",
      );

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(fold).toHaveTextContent("Send a test log");
      expect(fold).toHaveTextContent(
        "Check the endpoint and the key before you set up your app.",
      );
      expect(screen.queryByTestId("telemetry-test-log-body")).toBeNull();
      // It sits in the first step, with the key it uses.
      const firstStep: HTMLElement = screen
        .getByText("Get Your Ingestion Credentials")
        .closest("div.relative") as HTMLElement;
      expect(within(firstStep).getByTestId("telemetry-test-log")).toBe(fold);
    });

    test("opened: the command, with the endpoint's logs address and the key the step shows, from oneuptime-test", async () => {
      renderGuide("logs");
      await keyShown();

      fireEvent.click(
        within(await testLogShown()).getByTestId("telemetry-test-log-toggle"),
      );

      const body: HTMLElement = screen.getByTestId("telemetry-test-log-body");

      expect(screen.getByTestId("telemetry-test-log-toggle")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByTestId("telemetry-test-log-toggle")).toHaveAttribute(
        "aria-controls",
        body.id,
      );
      expect(body).toHaveTextContent(
        "Run this in a terminal. It sends one log from the service oneuptime-test, which you can delete afterwards.",
      );
      expect(within(body).getByText("oneuptime-test").tagName).toBe("CODE");

      /*
       * The OTLP endpoint the step's card shows - here a placeholder, with
       * no server address known in a test - and its /v1/logs.
       */
      const command: string = body.textContent || "";
      const endpoint: string =
        within(firstStepOf(body)).getByText("OTLP Endpoint").nextElementSibling
          ?.textContent || "";
      expect(endpoint.length).toBeGreaterThan(0);
      expect(command).toContain("curl -sS ");
      expect(command).toContain(`"${endpoint}/v1/logs"`);
      expect(command).toContain('-H "Content-Type: application/json"');
      expect(command).toContain('-H "x-oneuptime-token: secret-production"');
      expect(command).toContain('"stringValue":"oneuptime-test"');

      // Folded again with one more press.
      fireEvent.click(screen.getByTestId("telemetry-test-log-toggle"));
      expect(screen.queryByTestId("telemetry-test-log-body")).toBeNull();
    });

    test.each(["FluentBit", "Fluentd"])(
      "%s offers it too: its step shows the same endpoint and key",
      async (method: string) => {
        renderGuide("logs");
        await keyShown();
        pickMethod(method);

        // The step's key picker reads the project's keys again.
        expect(
          await screen.findByTestId("telemetry-test-log"),
        ).toBeInTheDocument();
      },
    );

    test.each([
      "metrics",
      "traces",
      "exceptions",
      "profiles",
    ] as Array<TelemetryType>)(
      "the %s guide has none: the test sends a log",
      async (type: TelemetryType) => {
        renderGuide(type);
        await keyShown();

        expect(screen.queryByTestId("telemetry-test-log")).toBeNull();
      },
    );

    test("another tool's endpoint has none: its step shows that tool's address, not OTLP", async () => {
      renderGuide("logs");
      await keyShown();

      fireEvent.click(screen.getByTestId("compatible-ingest-loki"));

      expect(screen.queryByTestId("telemetry-test-log")).toBeNull();
    });

    test("a browser guide has none: its key is taken only from a page of its origins", async () => {
      renderGuide("logs");
      await keyShown();

      fireEvent.click(screen.getByRole("button", { name: "React" }));

      expect(screen.queryByTestId("telemetry-test-log")).toBeNull();
    });

    test("a guide for a whole service has none: its wait is for that service", async () => {
      render(
        <MemoryRouter>
          <TelemetryDocumentation telemetryType="logs" everySignal={true} />
        </MemoryRouter>,
      );
      await keyShown();

      expect(screen.queryByTestId("telemetry-test-log")).toBeNull();
    });

    test("with no key picked yet, there is nothing to send with", () => {
      renderGuide("logs");

      // Before the project's keys are read.
      expect(screen.queryByTestId("telemetry-test-log")).toBeNull();
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
      // The package's service, which runs as root and keeps its state (#8580).
      expect(container.textContent).toContain(
        "sudo cp fluent-bit.conf /etc/fluent-bit/fluent-bit.conf",
      );
      expect(container.textContent).toContain(
        "sudo systemctl restart fluent-bit",
      );
      expect(container.textContent).not.toContain(
        "fluent-bit -c fluent-bit.conf",
      );
      expect(container.textContent).not.toContain("image: fluent/fluent-bit");
      // The one file, with its place and its chunks kept, and its retries.
      expect(container.textContent).toContain(
        "DB           /var/lib/fluent-bit/tail.db",
      );
      expect(container.textContent).toContain("Retry_Limit  8640");

      fireEvent.click(tabs[1]!);

      expect(container.textContent).toContain("image: fluent/fluent-bit");
      expect(container.textContent).toContain("restart: unless-stopped");
      expect(container.textContent).toContain(
        "fluent-bit-state:/var/lib/fluent-bit",
      );
      expect(container.textContent).not.toContain("systemctl");
    });

    /*
     * The file differs between the host and Docker Compose - where the tail
     * keeps its place (#8007) - so the file's step and the run step each
     * offer both, and a pick in either switches both.
     */
    test("Fluentd: the file and the run step, on the host or in Docker Compose, switched together", () => {
      const container: HTMLElement = renderGuide("logs");
      pickMethod("Fluentd");

      expect(stepTitles()).toEqual([
        "Get Your Ingestion Credentials",
        "Create Fluentd Configuration",
        "Run Fluentd",
      ]);
      expect(
        screen.getAllByRole("tab").map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
      ).toEqual([
        "On the host",
        "Docker Compose",
        "On the host",
        "Docker Compose",
      ]);

      const onTheHost: () => void = (): void => {
        expect(container.textContent).toContain(
          "pos_file /var/log/fluent/fluentd.pos",
        );
        expect(container.textContent).toContain(
          "sudo cp fluentd.conf /etc/fluent/fluentd.conf",
        );
        expect(container.textContent).toContain(
          "sudo systemctl restart fluentd",
        );
        // This host alone sends to it, and its batches stay on disk (#8243, #8242).
        expect(container.textContent).toContain("bind 127.0.0.1");
        expect(container.textContent).toContain(
          "path /var/log/fluent/buffer/oneuptime",
        );
        expect(container.textContent).not.toContain("/fluentd/log/fluentd.pos");
        expect(container.textContent).not.toContain("image: fluent/fluentd");
      };
      const inDockerCompose: () => void = (): void => {
        expect(container.textContent).toContain(
          "pos_file /fluentd/log/fluentd.pos",
        );
        expect(container.textContent).toContain("image: fluent/fluentd");
        expect(container.textContent).toContain("user: root");
        // Published to this host alone, root with one capability, and the batches in the volume.
        expect(container.textContent).toContain('"127.0.0.1:24224:24224"');
        expect(container.textContent).toContain("- DAC_OVERRIDE");
        expect(container.textContent).toContain(
          "path /fluentd/log/buffer/oneuptime",
        );
        expect(container.textContent).toContain("fluentd-state:/fluentd/log");
        expect(container.textContent).toContain("restart: unless-stopped");
        expect(container.textContent).not.toContain("bind 127.0.0.1");
        expect(container.textContent).not.toContain(
          "/var/log/fluent/fluentd.pos",
        );
        expect(container.textContent).not.toContain("systemctl");
      };

      // The host first, in both steps; the old foreground run is gone.
      onTheHost();
      expect(container.textContent).not.toContain("fluentd -c fluentd.conf");

      // Docker Compose in the run step switches the file too,
      fireEvent.click(screen.getAllByRole("tab")[3]!);
      inDockerCompose();
      expect(
        screen.getAllByRole("tab").map((tab: HTMLElement): string | null => {
          return tab.getAttribute("aria-selected");
        }),
      ).toEqual(["false", "true", "false", "true"]);

      // and the host in the file's step switches the run step back.
      fireEvent.click(screen.getAllByRole("tab")[0]!);
      onTheHost();
      expect(
        screen.getAllByRole("tab").map((tab: HTMLElement): string | null => {
          return tab.getAttribute("aria-selected");
        }),
      ).toEqual(["true", "false", "true", "false"]);
    });

    test("Fluent Bit's run step is not switched by Fluentd's tabs", () => {
      renderGuide("logs");
      pickMethod("Fluentd");
      fireEvent.click(screen.getAllByRole("tab")[1]!);
      pickMethod("FluentBit");

      expect(
        screen.getAllByRole("tab").map((tab: HTMLElement): string | null => {
          return tab.getAttribute("aria-selected");
        }),
      ).toEqual(["true", "false"]);
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
        "Turn On Profiling in the Agent",
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
        "Configure the SDK",
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

    test("Go, Rust, PHP, Ruby and Elixir each open their own guide and their frameworks'", () => {
      renderGuide("traces");
      const url: (slug: string) => string = (slug: string): string => {
        return `https://oneuptime.com/integrations/opentelemetry/${slug}`;
      };
      const expected: Array<[string, Array<[string, string]>]> = [
        [
          "Go",
          [
            ["Go", url("go")],
            ["Gin", url("gin")],
            ["Echo", url("echo")],
            ["Fiber", url("fiber")],
            ["gRPC", url("grpc")],
          ],
        ],
        [
          "Rust",
          [
            ["Rust", url("rust")],
            ["Axum", url("axum")],
            ["Actix Web", url("actix-web")],
          ],
        ],
        [
          "PHP",
          [
            ["PHP", url("php")],
            ["Laravel", url("laravel")],
            ["Symfony", url("symfony")],
            ["Slim", url("slim")],
          ],
        ],
        [
          "Ruby",
          [
            ["Ruby", url("ruby")],
            ["Ruby on Rails", url("rails")],
            ["Sinatra", url("sinatra")],
            ["Sidekiq", url("sidekiq")],
          ],
        ],
        [
          "Elixir",
          [
            ["Elixir", url("elixir")],
            ["Phoenix", url("phoenix")],
          ],
        ],
      ];

      for (const [button, links] of expected) {
        fireEvent.click(screen.getByRole("button", { name: button }));
        expect([button, guideLinks()]).toEqual([button, links]);
      }
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

  /*
   * A step's title beside its number (the UI review of #6658 part 3): the
   * title was one 36px line (leading-9), the number circle's height, so a
   * title that wraps - "Ihre Ingestion-Zugangsdaten abrufen" in a phone's
   * column - put its second line 36px under the first, a gap that read as
   * two headings. One line is still as tall as the number; further lines
   * come at the text's own line height. SetupGuideSteps does the same.
   */
  describe("a step's title beside its number", () => {
    const SPACING_STEP: RegExp = /^\d+$/;

    // Tailwind's spacing scale: 1 unit is 4px; "h-9" -> 36.
    const pixelsOf: (classes: Array<string>, prefix: string) => number = (
      classes: Array<string>,
      prefix: string,
    ): number => {
      const found: string | undefined = classes.find(
        (name: string): boolean => {
          return (
            name.startsWith(prefix) &&
            SPACING_STEP.test(name.slice(prefix.length))
          );
        },
      );

      expect({ prefix, found: Boolean(found) }).toEqual({
        prefix,
        found: true,
      });

      return Number(found!.substring(prefix.length)) * 4;
    };

    test.each(["logs", "traces", "profiles"] as Array<TelemetryType>)(
      "%s: one line is as tall as the number; a wrapped line is not 36px down",
      (telemetryType: TelemetryType) => {
        renderGuide(telemetryType);

        const titles: Array<HTMLElement> = screen.getAllByRole("heading", {
          level: 4,
        });

        expect(titles.length).toBeGreaterThan(1);

        for (const title of titles) {
          const classes: Array<string> = (title.getAttribute("class") || "")
            .split(" ")
            .filter(Boolean);
          // The step's circle, in the column beside the title's.
          const number: HTMLElement = title.parentElement!
            .previousElementSibling!.firstElementChild as HTMLElement;
          const numberClasses: Array<string> = (
            number.getAttribute("class") || ""
          ).split(" ");

          expect(number.textContent).toMatch(/^\d+$/);
          expect(
            pixelsOf(classes, "py-") * 2 + pixelsOf(classes, "leading-"),
          ).toBe(pixelsOf(numberClasses, "h-"));
          expect(classes).not.toContain("leading-9");
        }
      },
    );
  });
});
