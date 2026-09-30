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
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideCard";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";

/*
 * SetupGuideCard as it reaches the screen: the option picker at the top,
 * the ingestion key as step 1, the chosen option's steps, and Advanced /
 * Troubleshooting folded away until asked for.
 *
 * The markdown viewer is a lazy boundary; it is rendered as plain text here
 * (as in CloudDocumentationCard.test.tsx) because these tests are about
 * which content is on screen, not how markdown is styled.
 */

interface MarkdownViewerProps {
  text: string;
}

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");

const makeKey: (
  id: string,
  name: string,
  secret: string,
) => TelemetryIngestionKey = (
  id: string,
  name: string,
  secret: string,
): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID(id);
  key.name = name;
  key.secretKey = new ObjectID(secret);
  key.keyType = TelemetryIngestionKeyType.Server;
  return key;
};

const OPTIONS: Array<SetupGuideOption> = [
  { key: "alpha", label: "Alpha", description: "The first way." },
  { key: "beta", label: "Beta", description: "The second way.", badge: "New" },
  { key: "gamma", label: "Gamma" },
];

type GetList = typeof ModelAPI.getList;

const mockKeys: (keys: Array<TelemetryIngestionKey>) => jest.Mock<GetList> = (
  keys: Array<TelemetryIngestionKey>,
): jest.Mock<GetList> => {
  return jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: keys,
    count: keys.length,
    skip: 0,
    limit: 50,
  } as never) as unknown as jest.Mock<GetList>;
};

// A guide whose every piece names the option and key it was built with.
const buildContent: (context: SetupGuideRenderContext) => SetupGuideContent = (
  context: SetupGuideRenderContext,
): SetupGuideContent => {
  return {
    prerequisites: [`Prerequisite for ${context.option}`],
    steps: [
      {
        title: `Install on ${context.option}`,
        description: "Run this.",
        markdown: `install --url ${context.oneuptimeUrl} --key ${context.apiKey} --has-key ${context.hasApiKey}`,
      },
      {
        title: "Pick a method",
        variants: [
          { label: "Script", markdown: "SCRIPT BODY" },
          { label: "Compose", markdown: "COMPOSE BODY" },
        ],
      },
    ],
    advanced: [
      {
        title: `Tune ${context.option}`,
        summary: "Knobs and dials.",
        markdown: "ADVANCED BODY",
      },
      { title: "Second knob", markdown: "SECOND BODY" },
    ],
    troubleshooting: [{ title: "It broke", markdown: "TROUBLE BODY" }],
    links: [{ title: "Full docs", url: "/docs/example" }],
  };
};

interface RenderOptions {
  options?: Array<SetupGuideOption> | undefined;
  initialOption?: string | undefined;
  onOptionChange?: ((option: string) => void) | undefined;
  getKeyTypeFilter?:
    | ((option: string | undefined) => TelemetryIngestionKeyType | undefined)
    | undefined;
  getContent?:
    | ((context: SetupGuideRenderContext) => SetupGuideContent)
    | undefined;
}

const renderCard: (options?: RenderOptions) => {
  container: HTMLElement;
  rerender: (options: RenderOptions) => void;
} = (
  options?: RenderOptions,
): {
  container: HTMLElement;
  rerender: (options: RenderOptions) => void;
} => {
  const element: (renderOptions: RenderOptions) => React.ReactElement = (
    renderOptions: RenderOptions,
  ): React.ReactElement => {
    return (
      <MemoryRouter>
        <SetupGuideCard
          title="Connect the thing"
          description="A guide for the thing."
          optionsLabel="Where does it run?"
          options={"options" in renderOptions ? renderOptions.options : OPTIONS}
          initialOption={renderOptions.initialOption}
          onOptionChange={renderOptions.onOptionChange}
          getKeyTypeFilter={renderOptions.getKeyTypeFilter}
          getContent={renderOptions.getContent || buildContent}
        />
      </MemoryRouter>
    );
  };

  const result: ReturnType<typeof render> = render(element(options || {}));

  return {
    container: result.container,
    rerender: (next: RenderOptions): void => {
      result.rerender(element(next));
    },
  };
};

const radio: (name: string) => HTMLElement = (name: string): HTMLElement => {
  return screen.getByRole("radio", { name: new RegExp(`^${name}`) });
};

// The toggle of the folded topic with this title.
const topicButton: (title: string) => HTMLElement = (
  title: string,
): HTMLElement => {
  const topic: HTMLElement | undefined = screen
    .getAllByTestId("setup-guide-topic")
    .find((element: HTMLElement): boolean => {
      return (element.textContent || "").startsWith(title);
    });
  if (!topic) {
    throw new Error(`No topic titled "${title}" is on screen`);
  }
  return within(topic).getByRole("button");
};

describe("SetupGuideCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("the option picker", () => {
    beforeEach(() => {
      mockKeys([makeKey("key-1", "Production Key", "secret-production")]);
    });

    test("shows the title, the description and the picker's question", () => {
      renderCard();
      expect(
        screen.getByRole("heading", { name: "Connect the thing" }),
      ).toBeInTheDocument();
      expect(screen.getByText("A guide for the thing.")).toBeInTheDocument();
      expect(
        screen.getByRole("radiogroup", { name: "Where does it run?" }),
      ).toBeInTheDocument();
    });

    test("offers every option, with its description and badge", () => {
      renderCard();
      expect(screen.getAllByRole("radio")).toHaveLength(3);
      expect(screen.getByText("The first way.")).toBeInTheDocument();
      expect(screen.getByText("The second way.")).toBeInTheDocument();
      expect(screen.getByText("New")).toBeInTheDocument();
    });

    test("opens on the first option and shows only its instructions", () => {
      renderCard();
      expect(radio("Alpha")).toHaveAttribute("aria-checked", "true");
      expect(radio("Beta")).toHaveAttribute("aria-checked", "false");
      expect(screen.getByText("Install on alpha")).toBeInTheDocument();
      expect(screen.queryByText("Install on beta")).not.toBeInTheDocument();
    });

    test("opens on the requested option", () => {
      renderCard({ initialOption: "gamma" });
      expect(radio("Gamma")).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText("Install on gamma")).toBeInTheDocument();
    });

    test("falls back to the first option for one it does not offer", () => {
      renderCard({ initialOption: "delta" });
      expect(radio("Alpha")).toHaveAttribute("aria-checked", "true");
    });

    test("picking an option swaps the instructions and reports the pick", () => {
      const onOptionChange: jest.Mock<(option: string) => void> = jest.fn();
      renderCard({ onOptionChange: onOptionChange });

      fireEvent.click(radio("Beta"));

      expect(radio("Beta")).toHaveAttribute("aria-checked", "true");
      expect(radio("Alpha")).toHaveAttribute("aria-checked", "false");
      expect(screen.getByText("Install on beta")).toBeInTheDocument();
      expect(screen.queryByText("Install on alpha")).not.toBeInTheDocument();
      expect(
        screen.getByTestId("setup-guide-prerequisites").textContent,
      ).toContain("Prerequisite for beta");
      expect(onOptionChange).toHaveBeenCalledWith("beta");
    });

    test("only the selected option is in the tab order", () => {
      renderCard({ initialOption: "beta" });
      expect(radio("Alpha")).toHaveAttribute("tabindex", "-1");
      expect(radio("Beta")).toHaveAttribute("tabindex", "0");
      expect(radio("Gamma")).toHaveAttribute("tabindex", "-1");
    });

    test("arrow keys, Home and End move the selection, wrapping at the ends", () => {
      renderCard();

      fireEvent.keyDown(radio("Alpha"), { key: "ArrowRight" });
      expect(radio("Beta")).toHaveAttribute("aria-checked", "true");
      expect(radio("Beta")).toHaveFocus();

      fireEvent.keyDown(radio("Beta"), { key: "ArrowDown" });
      expect(radio("Gamma")).toHaveAttribute("aria-checked", "true");

      fireEvent.keyDown(radio("Gamma"), { key: "ArrowRight" });
      expect(radio("Alpha")).toHaveAttribute("aria-checked", "true");

      fireEvent.keyDown(radio("Alpha"), { key: "ArrowLeft" });
      expect(radio("Gamma")).toHaveAttribute("aria-checked", "true");

      fireEvent.keyDown(radio("Gamma"), { key: "Home" });
      expect(radio("Alpha")).toHaveAttribute("aria-checked", "true");

      fireEvent.keyDown(radio("Alpha"), { key: "End" });
      expect(radio("Gamma")).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText("Install on gamma")).toBeInTheDocument();
    });

    test("other keys leave the selection alone", () => {
      renderCard();
      fireEvent.keyDown(radio("Alpha"), { key: "a" });
      expect(radio("Alpha")).toHaveAttribute("aria-checked", "true");
    });

    test("follows an initial option the parent learns after mount", () => {
      const { rerender } = renderCard({ initialOption: undefined });
      expect(radio("Alpha")).toHaveAttribute("aria-checked", "true");

      rerender({ initialOption: "gamma" });
      expect(radio("Gamma")).toHaveAttribute("aria-checked", "true");

      // An unknown value later never overrides what is on screen.
      rerender({ initialOption: "delta" });
      expect(radio("Gamma")).toHaveAttribute("aria-checked", "true");
    });

    test("shows no picker when there is only one way", () => {
      renderCard({ options: [{ key: "only", label: "Only" }] });
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(screen.getByText("Install on only")).toBeInTheDocument();
    });

    test("shows no picker, and passes no option, when there are no options", () => {
      renderCard({ options: undefined });
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(screen.getByText("Install on undefined")).toBeInTheDocument();
    });
  });

  describe("the steps", () => {
    test("step 1 is the ingestion key, and the guide's steps follow it", async () => {
      mockKeys([makeKey("key-1", "Production Key", "secret-production")]);
      renderCard();

      const first: HTMLElement = screen.getByTestId("setup-guide-step-1");
      expect(
        within(first).getByText("Choose an ingestion key"),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(
          within(first).getByText("secret-production"),
        ).toBeInTheDocument();
      });

      expect(
        within(screen.getByTestId("setup-guide-step-2")).getByText(
          "Install on alpha",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("setup-guide-step-3")).getByText(
          "Pick a method",
        ),
      ).toBeInTheDocument();
    });

    test("the commands carry the selected key's secret", async () => {
      mockKeys([makeKey("key-1", "Production Key", "secret-production")]);
      const { container } = renderCard();

      await waitFor(() => {
        expect(container.textContent).toContain(
          "--key secret-production --has-key true",
        );
      });
      expect(container.textContent).not.toContain(
        SETUP_GUIDE_API_KEY_PLACEHOLDER,
      );
    });

    test("the commands carry the placeholder while the project has no key", async () => {
      mockKeys([]);
      const { container } = renderCard();

      await waitFor(() => {
        expect(screen.getByText("No ingestion keys yet")).toBeInTheDocument();
      });
      expect(container.textContent).toContain(
        `--key ${SETUP_GUIDE_API_KEY_PLACEHOLDER} --has-key false`,
      );
      expect(
        screen.getByRole("button", { name: "Create Ingestion Key" }),
      ).toBeInTheDocument();
    });

    test("the key follows the guide across an option switch", async () => {
      mockKeys([makeKey("key-1", "Production Key", "secret-production")]);
      const { container } = renderCard();
      await waitFor(() => {
        expect(container.textContent).toContain("--key secret-production");
      });

      fireEvent.click(radio("Gamma"));

      expect(screen.getByText("Install on gamma")).toBeInTheDocument();
      expect(container.textContent).toContain("--key secret-production");
    });

    test("lists the prerequisites under Before you start", () => {
      mockKeys([]);
      renderCard();
      const box: HTMLElement = screen.getByTestId("setup-guide-prerequisites");
      expect(within(box).getByText("Before you start")).toBeInTheDocument();
      expect(box.textContent).toContain("- Prerequisite for alpha");
    });

    test("a step's variants are tabs, and only the selected one is shown", () => {
      mockKeys([]);
      renderCard();

      const tabs: Array<HTMLElement> = screen.getAllByRole("tab");
      expect(
        tabs.map((tab: HTMLElement) => {
          return tab.textContent;
        }),
      ).toEqual(["Script", "Compose"]);
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("SCRIPT BODY")).toBeInTheDocument();
      expect(screen.queryByText("COMPOSE BODY")).not.toBeInTheDocument();

      fireEvent.click(tabs[1]!);

      expect(screen.getAllByRole("tab")[1]).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByText("COMPOSE BODY")).toBeInTheDocument();
      expect(screen.queryByText("SCRIPT BODY")).not.toBeInTheDocument();
    });

    test("arrow keys move between a step's tabs", () => {
      mockKeys([]);
      renderCard();

      fireEvent.keyDown(screen.getAllByRole("tab")[0]!, { key: "ArrowRight" });
      expect(screen.getByText("COMPOSE BODY")).toBeInTheDocument();
      expect(screen.getAllByRole("tab")[1]).toHaveFocus();

      fireEvent.keyDown(screen.getAllByRole("tab")[1]!, { key: "ArrowRight" });
      expect(screen.getByText("SCRIPT BODY")).toBeInTheDocument();
    });
  });

  describe("tabs shared by several steps", () => {
    const linkedContent: () => SetupGuideContent = (): SetupGuideContent => {
      return {
        steps: [
          {
            title: "Store the token",
            variants: [
              { label: "SDK direct", markdown: "STORE HEADER" },
              { label: "Sidecar collector", markdown: "STORE TOKEN" },
            ],
          },
          {
            title: "Configure the service",
            variants: [
              { label: "SDK direct", markdown: "CONFIGURE SDK" },
              { label: "Sidecar collector", markdown: "CONFIGURE SIDECAR" },
            ],
          },
          {
            title: "Run it",
            variants: [
              { label: "On the host", markdown: "RUN ON HOST" },
              { label: "In Docker", markdown: "RUN IN DOCKER" },
            ],
          },
        ],
      };
    };

    test("picking a tab in one step switches every step with that tab", () => {
      mockKeys([]);
      renderCard({ getContent: linkedContent });

      expect(screen.getByText("STORE HEADER")).toBeInTheDocument();
      expect(screen.getByText("CONFIGURE SDK")).toBeInTheDocument();

      const sidecarTabs: Array<HTMLElement> = screen.getAllByRole("tab", {
        name: "Sidecar collector",
      });
      expect(sidecarTabs).toHaveLength(2);
      fireEvent.click(sidecarTabs[0]!);

      expect(screen.getByText("STORE TOKEN")).toBeInTheDocument();
      expect(screen.getByText("CONFIGURE SIDECAR")).toBeInTheDocument();
      expect(screen.queryByText("CONFIGURE SDK")).not.toBeInTheDocument();
      for (const tab of screen.getAllByRole("tab", {
        name: "Sidecar collector",
      })) {
        expect(tab).toHaveAttribute("aria-selected", "true");
      }

      // A step without that tab keeps its own selection.
      expect(screen.getByText("RUN ON HOST")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: "In Docker" }));
      expect(screen.getByText("RUN IN DOCKER")).toBeInTheDocument();
      expect(screen.getByText("CONFIGURE SIDECAR")).toBeInTheDocument();
    });

    test("the arrow keys switch the linked steps too", () => {
      mockKeys([]);
      renderCard({ getContent: linkedContent });

      fireEvent.keyDown(
        screen.getAllByRole("tab", { name: "SDK direct" })[1]!,
        { key: "ArrowRight" },
      );

      expect(screen.getByText("STORE TOKEN")).toBeInTheDocument();
      expect(screen.getByText("CONFIGURE SIDECAR")).toBeInTheDocument();
    });
  });

  describe("Advanced and Troubleshooting", () => {
    beforeEach(() => {
      mockKeys([]);
    });

    test("are folded until opened", () => {
      renderCard();

      const advanced: HTMLElement = screen.getByTestId(
        "setup-guide-advanced-toggle",
      );
      expect(advanced).toHaveAttribute("aria-expanded", "false");
      expect(advanced.textContent).toContain("Advanced");
      expect(advanced.textContent).toContain("Tune alpha · Second knob");
      expect(advanced.textContent).toContain("2 topics");
      expect(screen.queryByText("Tune alpha")).not.toBeInTheDocument();
      expect(screen.queryByText("ADVANCED BODY")).not.toBeInTheDocument();

      const troubleshooting: HTMLElement = screen.getByTestId(
        "setup-guide-troubleshooting-toggle",
      );
      expect(troubleshooting).toHaveAttribute("aria-expanded", "false");
      expect(troubleshooting.textContent).toContain("1 topic");
      expect(screen.queryByText("TROUBLE BODY")).not.toBeInTheDocument();
    });

    test("opening a section lists its topics, each opening on its own", () => {
      renderCard();

      fireEvent.click(screen.getByTestId("setup-guide-advanced-toggle"));

      expect(screen.getByTestId("setup-guide-advanced-toggle")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByText("Tune alpha")).toBeInTheDocument();
      expect(screen.getByText("Knobs and dials.")).toBeInTheDocument();
      expect(screen.queryByText("ADVANCED BODY")).not.toBeInTheDocument();

      fireEvent.click(topicButton("Tune alpha"));

      expect(screen.getByText("ADVANCED BODY")).toBeInTheDocument();
      expect(screen.queryByText("SECOND BODY")).not.toBeInTheDocument();
      // The summary gives way to the topic itself.
      expect(screen.queryByText("Knobs and dials.")).not.toBeInTheDocument();

      fireEvent.click(topicButton("Tune alpha"));
      expect(screen.queryByText("ADVANCED BODY")).not.toBeInTheDocument();
    });

    test("Troubleshooting opens independently of Advanced", () => {
      renderCard();

      fireEvent.click(screen.getByTestId("setup-guide-troubleshooting-toggle"));
      fireEvent.click(topicButton("It broke"));

      expect(screen.getByText("TROUBLE BODY")).toBeInTheDocument();
      expect(screen.queryByText("Tune alpha")).not.toBeInTheDocument();
    });

    test("topics of the newly picked option start folded", () => {
      renderCard();
      fireEvent.click(screen.getByTestId("setup-guide-advanced-toggle"));
      fireEvent.click(topicButton("Tune alpha"));
      expect(screen.getByText("ADVANCED BODY")).toBeInTheDocument();

      fireEvent.click(radio("Beta"));

      expect(screen.getByText("Tune beta")).toBeInTheDocument();
      expect(screen.queryByText("ADVANCED BODY")).not.toBeInTheDocument();
    });

    test("a guide without topics shows neither section", () => {
      renderCard({
        getContent: (): SetupGuideContent => {
          return { steps: [{ title: "Just this", markdown: "Do it." }] };
        },
      });
      expect(
        screen.queryByTestId("setup-guide-advanced"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("setup-guide-troubleshooting"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("setup-guide-links")).not.toBeInTheDocument();
    });

    test("links to the full documentation open in a new tab", () => {
      renderCard();
      const link: HTMLElement = screen.getByRole("link", { name: "Full docs" });
      expect(link).toHaveAttribute("href", "/docs/example");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  describe("the key step", () => {
    test("shows the OneUptime URL next to the key by default", async () => {
      mockKeys([makeKey("key-1", "Production Key", "secret-production")]);
      renderCard();

      const first: HTMLElement = screen.getByTestId("setup-guide-step-1");
      await waitFor(() => {
        expect(within(first).getByText("OneUptime URL")).toBeInTheDocument();
      });
      expect(
        within(first).getByText(
          "The agent sends data to your project with this key. Pick an existing key or create a new one — the commands below update to use it.",
        ),
      ).toBeInTheDocument();
    });

    test("a guide can point step 1 at its own endpoint and wording", async () => {
      mockKeys([makeKey("key-1", "Production Key", "secret-production")]);
      renderCard({
        getContent: (context: SetupGuideRenderContext): SetupGuideContent => {
          return {
            keyStep: {
              description: `Pick a key for ${context.option}.`,
              endpointLabel: "OTLP Endpoint",
              endpointValue: "https://otlp.example.com/otlp",
              endpointHint: "Append /v1/traces for traces.",
            },
            steps: [{ title: "Send data", markdown: "Send it." }],
          };
        },
      });

      const first: HTMLElement = screen.getByTestId("setup-guide-step-1");
      expect(
        within(first).getByText("Pick a key for alpha."),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(within(first).getByText("OTLP Endpoint")).toBeInTheDocument();
      });
      expect(
        within(first).getByText("https://otlp.example.com/otlp"),
      ).toBeInTheDocument();
      expect(
        within(first).getByText("Append /v1/traces for traces."),
      ).toBeInTheDocument();
      expect(
        within(first).queryByText("OneUptime URL"),
      ).not.toBeInTheDocument();
    });
  });

  describe("the key type filter", () => {
    test("switching to an option that needs another key type selects that type's first key", async () => {
      const browserKey: TelemetryIngestionKey = makeKey(
        "key-browser",
        "Storefront Browser Key",
        "secret-browser",
      );
      browserKey.keyType = TelemetryIngestionKeyType.Browser;
      const serverKey: TelemetryIngestionKey = makeKey(
        "key-server",
        "Backend Server Key",
        "secret-server",
      );

      jest.spyOn(ModelAPI, "getList").mockImplementation(((data: {
        query: Record<string, unknown>;
      }): Promise<unknown> => {
        const keys: Array<TelemetryIngestionKey> =
          data.query["keyType"] === TelemetryIngestionKeyType.Browser
            ? [browserKey]
            : [serverKey];
        return Promise.resolve({
          data: keys,
          count: keys.length,
          skip: 0,
          limit: 50,
        });
      }) as never);

      const { container } = renderCard({
        getKeyTypeFilter: (option: string | undefined) => {
          return option === "beta"
            ? TelemetryIngestionKeyType.Browser
            : undefined;
        },
      });

      await waitFor(() => {
        expect(container.textContent).toContain("--key secret-server");
      });

      fireEvent.click(radio("Beta"));
      await waitFor(() => {
        expect(container.textContent).toContain("--key secret-browser");
      });

      // Back again: the server key, not the placeholder.
      fireEvent.click(radio("Alpha"));
      await waitFor(() => {
        expect(container.textContent).toContain("--key secret-server");
      });
      expect(container.textContent).not.toContain(
        SETUP_GUIDE_API_KEY_PLACEHOLDER,
      );
    });

    test("asks only for the key type the picked option needs", async () => {
      const getList: jest.Mock<GetList> = mockKeys([]);
      renderCard({
        getKeyTypeFilter: (option: string | undefined) => {
          return option === "beta"
            ? TelemetryIngestionKeyType.Browser
            : undefined;
        },
      });

      await waitFor(() => {
        expect(getList).toHaveBeenCalled();
      });
      const firstQuery: Record<string, unknown> = (
        getList.mock.calls[0]![0] as unknown as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(firstQuery["keyType"]).toBeUndefined();

      fireEvent.click(radio("Beta"));

      await waitFor(() => {
        const lastQuery: Record<string, unknown> = (
          getList.mock.calls[getList.mock.calls.length - 1]![0] as unknown as {
            query: Record<string, unknown>;
          }
        ).query;
        expect(lastQuery["keyType"]).toBe(TelemetryIngestionKeyType.Browser);
      });
      await waitFor(() => {
        expect(
          screen.getByText("No browser ingestion keys yet"),
        ).toBeInTheDocument();
      });
    });
  });
});
