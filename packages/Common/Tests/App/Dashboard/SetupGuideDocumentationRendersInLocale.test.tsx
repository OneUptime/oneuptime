import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
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
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * HELP > DOCUMENTATION ON DOCKER AND PODMAN, AS A READER SEES IT (#8341).
 *
 * The page draws the product's setup guide, and the guide's markdown was
 * English in every language. Drawn here in English, German, French,
 * Arabic and Persian: the reader's words arrive in a chunk of their own (a
 * loader shows meanwhile, never a flash of English), every piece of the
 * guide is in them, its commands are as the English writes them with the
 * reader's key in them, Arabic and Persian read from the right, and French
 * keeps its marks with their words. A chunk that cannot be fetched leaves
 * the guide in English.
 */

interface DrawnMarkdown {
  text: string;
  readingDirection: string | undefined;
}

const mockDrawnMarkdown: Array<DrawnMarkdown> = [];

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      text: string;
      readingDirection?: string | undefined;
    }): React.ReactElement => {
      mockDrawnMarkdown.push({
        text: props.text,
        readingDirection: props.readingDirection,
      });
      return React.createElement("div", {}, props.text);
    },
  };
});

import DockerDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Documentation";
import PodmanDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Documentation";
import DockerSwarmDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Documentation";
import DockerDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Docker/DocumentationCard";
import SetupGuideCard from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideCard";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  SetupGuideTranslation,
  SetupGuideTranslations,
  getSetupGuideWordPieces,
  getSetupGuideWords,
  translateSetupGuideContent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideTranslation";
import { getDockerSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import { DOCKER_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationTranslations";
import { getPodmanSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import { PODMAN_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationTranslations";
import { getDockerSwarmSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import { DOCKER_SWARM_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationTranslations";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fr", "ar", "fa"];

// Each language's words for each guide, as its chunk holds them.
const WORDS: Record<string, Record<string, SetupGuideTranslation>> = {
  Docker: {},
  Podman: {},
  DockerSwarm: {},
};

/*
 * The guide the page opens on, before a key is picked: the first way of
 * running the agent, the placeholders in its commands.
 */
function dockerGuide(hostName?: string): SetupGuideContent {
  return getDockerSetupGuide({
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: "docker-cli",
    hostName: hostName,
  });
}

function dockerSwarmGuide(): SetupGuideContent {
  return getDockerSwarmSetupGuide({
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: "install-script",
  });
}

function podmanGuide(): SetupGuideContent {
  return getPodmanSetupGuide({
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: "podman-cli",
  });
}

// The guide's markdown in `language`, as the card should draw it.
function inLanguage(
  product: string,
  content: SetupGuideContent,
  language: string,
): SetupGuideContent {
  return translateSetupGuideContent(
    content,
    getSetupGuideWords({
      language: language,
      translation: WORDS[product]![language]!,
    }),
  );
}

// Every text the card hands the markdown viewer, last drawing first.
function drawnTexts(): Array<string> {
  return mockDrawnMarkdown.map((drawn: DrawnMarkdown): string => {
    return drawn.text;
  });
}

// Lets the chunk, the key list and the drawing that follows settle.
async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// Opens Advanced and Troubleshooting, and every topic in them.
async function openEveryTopic(): Promise<void> {
  for (const toggle of [
    "setup-guide-advanced-toggle",
    "setup-guide-troubleshooting-toggle",
  ]) {
    const button: HTMLElement | null = screen.queryByTestId(toggle);

    if (button) {
      await act(async () => {
        fireEvent.click(button);
      });
    }
  }

  for (const topic of screen.queryAllByTestId("setup-guide-topic")) {
    const button: HTMLButtonElement | null = topic.querySelector("button");

    if (button) {
      await act(async () => {
        fireEvent.click(button);
      });
    }
  }

  await settle();
}

async function drawIn(
  language: string,
  page: React.ReactElement,
): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  await act(async () => {
    render(<MemoryRouter>{page}</MemoryRouter>);
  });

  await settle();
  await openEveryTopic();
}

const PAGE_PROPS: {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route("/dashboard/docker/documentation"),
  currentProject: null,
  hasPaymentMethod: true,
};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    if (language === "en") {
      continue;
    }
    WORDS["Docker"]![language] = (
      await DOCKER_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["Podman"]![language] = (
      await PODMAN_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["DockerSwarm"]![language] = (
      await DOCKER_SWARM_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
  }

  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
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

beforeEach(() => {
  mockDrawnMarkdown.length = 0;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("10000000-0000-4000-8000-000000000001"));
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 50,
  } as never);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("Docker > Help > Documentation", () => {
  test("in English, the guide as it is written, at once, each block its own way", async () => {
    await drawIn("en", <DockerDocumentationPage {...PAGE_PROPS} />);

    expect(screen.queryByTestId("component-loader")).toBeNull();

    const english: Array<string> = getSetupGuideWordPieces(dockerGuide());
    const drawn: string = drawnTexts().join("\n");

    for (const piece of english) {
      expect({ piece, drawn: drawn.includes(piece) }).toEqual({
        piece,
        drawn: true,
      });
    }
    for (const markdown of mockDrawnMarkdown) {
      expect(markdown.readingDirection).toBeUndefined();
    }
  });

  test("in German, the German guide: no piece of the English, the commands as written, its titles in German", async () => {
    await drawIn("de", <DockerDocumentationPage {...PAGE_PROPS} />);

    const drawn: string = drawnTexts().join("\n");
    const english: Array<string> = getSetupGuideWordPieces(dockerGuide());
    const german: Array<string> = getSetupGuideWordPieces(
      inLanguage("Docker", dockerGuide(), "de"),
    );

    expect(english.length).toBeGreaterThan(10);
    for (const piece of english) {
      expect({ piece, drawn: drawn.includes(piece) }).toEqual({
        piece,
        drawn: false,
      });
    }
    for (const piece of german) {
      expect({ piece, drawn: drawn.includes(piece) }).toEqual({
        piece,
        drawn: true,
      });
    }

    expect(drawn).toContain(
      "Ersetzen Sie `my-docker-host` durch einen Namen für diesen Host",
    );
    // The command is the English's, with the placeholder key in it.
    expect(drawn).toContain("docker run");
    expect(drawn).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);

    for (const markdown of mockDrawnMarkdown) {
      expect(markdown.readingDirection).toBe("ltr");
    }

    // The card's own words come from the locale files.
    const locale: Record<string, string> = readDashboardLocale("de");
    expect(screen.getByText(locale["Run the agent"]!)).toBeInTheDocument();
    expect(
      screen.getByText(
        locale["Collect logs from every container (json-file log driver)"]!,
      ),
    ).toBeInTheDocument();
  });

  test.each(["ar", "fa"])(
    "in %s, its guide read from the right, every block of it",
    async (language: string) => {
      await drawIn(language, <DockerDocumentationPage {...PAGE_PROPS} />);

      const drawn: string = drawnTexts().join("\n");

      for (const piece of getSetupGuideWordPieces(
        inLanguage("Docker", dockerGuide(), language),
      )) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: true,
        });
      }

      expect(mockDrawnMarkdown.length).toBeGreaterThan(4);
      for (const markdown of mockDrawnMarkdown) {
        expect({ text: markdown.text, way: markdown.readingDirection }).toEqual(
          { text: markdown.text, way: "rtl" },
        );
      }
    },
  );

  test("in French, no mark is left where a line could start with it, and its code is as written", async () => {
    await drawIn("fr", <DockerDocumentationPage {...PAGE_PROPS} />);

    const drawn: string = drawnTexts().join("\n");
    const prose: string = drawn
      .replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```[ \t]*$/gm, "")
      .replace(/`[^`\n]*`/g, "`");

    expect(drawn).toContain("Remplacez `my-docker-host`");
    expect(prose).not.toMatch(/[\p{L}\p{N}»)*`] [:;?!]/u);
    expect(drawn).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
  });

  test("a host's own tab: the guide for that host, in German", async () => {
    await drawIn(
      "de",
      <DockerDocumentationCard
        title="Connect a Docker Host"
        description="Run the agent."
        hostName="web-1"
      />,
    );

    expect(drawnTexts().join("\n")).toContain(
      "Dies installiert den Agenten für **`web-1`**",
    );
  });
});

describe("Docker Swarm > Help > Documentation", () => {
  test.each(["de", "ar"])(
    "in %s, the Docker Swarm guide in the reader's words, the install script as written",
    async (language: string) => {
      await drawIn(language, <DockerSwarmDocumentationPage {...PAGE_PROPS} />);

      const drawn: string = drawnTexts().join("\n");

      for (const piece of getSetupGuideWordPieces(dockerSwarmGuide())) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: false,
        });
      }
      for (const piece of getSetupGuideWordPieces(
        inLanguage("DockerSwarm", dockerSwarmGuide(), language),
      )) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: true,
        });
      }

      // The install script is the English's, in every language.
      expect(drawn).toContain("install.sh");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );
});

describe("Podman > Help > Documentation", () => {
  test.each(["de", "fa"])(
    "in %s, the Podman guide in the reader's words",
    async (language: string) => {
      await drawIn(language, <PodmanDocumentationPage {...PAGE_PROPS} />);

      const drawn: string = drawnTexts().join("\n");
      const english: Array<string> = getSetupGuideWordPieces(podmanGuide());

      for (const piece of english) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: false,
        });
      }
      for (const piece of getSetupGuideWordPieces(
        inLanguage("Podman", podmanGuide(), language),
      )) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: true,
        });
      }
    },
  );
});

describe("the card while the reader's words are fetched", () => {
  const guide: () => SetupGuideContent = (): SetupGuideContent => {
    return {
      intro: "Install the agent.",
      steps: [{ title: "Run the agent", markdown: "Run the command." }],
    };
  };

  test("a loader, never a flash of English, then the reader's words", async () => {
    let release: (() => void) | undefined;
    const slow: SetupGuideTranslations = {
      de: () => {
        return new Promise<{ default: SetupGuideTranslation }>(
          (resolve: (value: { default: SetupGuideTranslation }) => void) => {
            release = () => {
              resolve({
                default: {
                  "Install the agent.": "Installieren Sie den Agenten.",
                  "Run the command.": "Führen Sie den Befehl aus.",
                },
              });
            };
          },
        );
      },
    };

    await act(async () => {
      await i18next.changeLanguage("de");
    });
    await act(async () => {
      render(
        <MemoryRouter>
          <SetupGuideCard
            title="Connect"
            description="A guide."
            newKeyName="Key"
            getContent={guide}
            translations={slow}
          />
        </MemoryRouter>,
      );
    });

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(mockDrawnMarkdown).toEqual([]);

    await act(async () => {
      release!();
      await Promise.resolve();
    });
    await settle();

    expect(screen.queryByTestId("component-loader")).toBeNull();
    expect(drawnTexts()).toContain("Installieren Sie den Agenten.");
    expect(drawnTexts()).toContain("Führen Sie den Befehl aus.");
    expect(drawnTexts()).not.toContain("Install the agent.");
  });

  test("a chunk that cannot be fetched leaves the guide in English", async () => {
    const broken: SetupGuideTranslations = {
      de: async () => {
        throw new Error("The chunk could not be fetched.");
      },
    };

    await act(async () => {
      await i18next.changeLanguage("de");
    });
    await act(async () => {
      render(
        <MemoryRouter>
          <SetupGuideCard
            title="Connect"
            description="A guide."
            newKeyName="Key"
            getContent={guide}
            translations={broken}
          />
        </MemoryRouter>,
      );
    });
    await settle();

    expect(screen.queryByTestId("component-loader")).toBeNull();
    expect(drawnTexts()).toContain("Install the agent.");
    expect(drawnTexts()).toContain("Run the command.");
    for (const markdown of mockDrawnMarkdown) {
      expect(markdown.readingDirection).toBeUndefined();
    }
  });

  test("a card without translations draws its guide as written, at once, in any language", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });
    await act(async () => {
      render(
        <MemoryRouter>
          <SetupGuideCard
            title="Connect"
            description="A guide."
            newKeyName="Key"
            getContent={guide}
          />
        </MemoryRouter>,
      );
    });

    expect(screen.queryByTestId("component-loader")).toBeNull();
    expect(drawnTexts()).toContain("Install the agent.");
  });

  test("switching language fetches the new language's words", async () => {
    await drawIn("de", <DockerDocumentationPage {...PAGE_PROPS} />);

    expect(drawnTexts().join("\n")).toContain("Ersetzen Sie `my-docker-host`");

    mockDrawnMarkdown.length = 0;
    await act(async () => {
      await i18next.changeLanguage("fa");
    });
    await settle();

    const persian: string = getSetupGuideWordPieces(
      inLanguage("Docker", dockerGuide(), "fa"),
    )[0]!;

    expect(drawnTexts().join("\n")).toContain(persian);
    expect(
      mockDrawnMarkdown[mockDrawnMarkdown.length - 1]!.readingDirection,
    ).toBe("rtl");
  });
});
