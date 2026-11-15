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
import CephDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Documentation";
import IoTDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Documentation";
import OpenStackDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Documentation";
import KubernetesDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Documentation";
import StorageArrayDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Documentation";
import ProxmoxDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Documentation";
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
import { getCephSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import { CEPH_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationTranslations";
import { getIoTSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationMarkdown";
import { IOT_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationTranslations";
import {
  OpenStackConnectMethod,
  getOpenStackSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/DocumentationMarkdown";
import { OpenStackDeploymentTool } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackDeploymentGuides";
import { OPENSTACK_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/DocumentationTranslations";
import { getKubernetesSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { KUBERNETES_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationTranslations";
import { getStorageArraySetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import { STORAGE_ARRAY_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationTranslations";
import {
  ProxmoxConnectMethod,
  getProxmoxSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import { PROXMOX_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationTranslations";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ProjectUtil from "../../../UI/Utils/Project";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fr", "ar", "fa"];

// Each language's words for each guide, as its chunk holds them.
const WORDS: Record<string, Record<string, SetupGuideTranslation>> = {
  Docker: {},
  Podman: {},
  DockerSwarm: {},
  Ceph: {},
  IoT: {},
  OpenStack: {},
  Kubernetes: {},
  StorageArray: {},
  Proxmox: {},
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

function storageArrayGuide(): SetupGuideContent {
  return getStorageArraySetupGuide({
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
    platform: "flasharray",
  });
}

// The Proxmox guide before a key is picked: the install script unless another way is.
function proxmoxGuide(
  method: ProxmoxConnectMethod = "install-script",
): SetupGuideContent {
  return getProxmoxSetupGuide({
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
    method: method,
  });
}

function kubernetesGuide(): SetupGuideContent {
  return getKubernetesSetupGuide({
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    platform: "standard",
  });
}

function iotGuide(): SetupGuideContent {
  return getIoTSetupGuide({
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: "opentelemetry-sdk",
  });
}

function cephGuide(): SetupGuideContent {
  return getCephSetupGuide({
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
    method: "install-script",
  });
}

/*
 * The OpenStack guide a reader meets before a key is picked: for "Not sure,
 * or something else" and the install script unless a tool and an install
 * method are picked.
 */
function openStackGuide(
  tool: OpenStackDeploymentTool = "not-sure",
  method: OpenStackConnectMethod = "install-script",
): SetupGuideContent {
  return getOpenStackSetupGuide({
    oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
    method: method,
    tool: tool,
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

/*
 * The project has an ingestion key, so the key step picks it and shows the
 * address it is sent to, under its label (IngestionKeySelector).
 */
function withAKey(): void {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("10000000-0000-4000-8000-000000000002");
  key.name = "Production Key";
  key.secretKey = new ObjectID("10000000-0000-4000-8000-000000000003");

  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [key],
    count: 1,
    skip: 0,
    limit: 50,
  } as never);
}

// Draws `page` in `language`, and picks the guide's option `option`.
async function drawWithOption(
  language: string,
  page: React.ReactElement,
  option: string,
): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
  await act(async () => {
    render(<MemoryRouter>{page}</MemoryRouter>);
  });
  await settle();

  await act(async () => {
    fireEvent.click(screen.getByTestId(`setup-guide-option-${option}`));
  });
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
    WORDS["Ceph"]![language] = (
      await CEPH_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["IoT"]![language] = (
      await IOT_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["Kubernetes"]![language] = (
      await KUBERNETES_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["StorageArray"]![language] = (
      await STORAGE_ARRAY_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["Proxmox"]![language] = (
      await PROXMOX_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["OpenStack"]![language] = (
      await OPENSTACK_DOCUMENTATION_TRANSLATIONS[language]!()
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

describe("Storage Array > Help > Documentation", () => {
  test.each(["de", "ar"])(
    "in %s, the Storage Array guide, its title, its platforms and both ways through each step in the reader's words, the Purity commands as written",
    async (language: string) => {
      await drawIn(language, <StorageArrayDocumentationPage {...PAGE_PROPS} />);

      /*
       * Two steps offer two ways each (Purity CLI or the FlashArray GUI,
       * the install script or Docker Compose), one drawn at a time: draw
       * every one.
       */
      for (const tab of screen.queryAllByTestId("setup-guide-step-variant")) {
        await act(async () => {
          fireEvent.click(tab);
        });
      }
      await settle();

      const drawn: string = drawnTexts().join("\n");

      for (const piece of getSetupGuideWordPieces(storageArrayGuide())) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: false,
        });
      }
      for (const piece of getSetupGuideWordPieces(
        inLanguage("StorageArray", storageArrayGuide(), language),
      )) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: true,
        });
      }

      // The card's own words, its platforms and its tabs come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["Connect a Storage Array"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("Connect a Storage Array")).toBeNull();
      expect(
        screen.getByText(locale["FlashArray, older Purity"]!),
      ).toBeInTheDocument();
      expect(screen.getByText(locale["FlashArray GUI"]!)).toBeInTheDocument();
      // The Purity commands, and the array's own menus, are the English's.
      expect(drawn).toContain("pureadmin create --role readonly oneuptime");
      expect(drawn).toContain("Settings → Users and Policies");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );
});

describe("Proxmox > Help > Documentation", () => {
  // Every piece of `guide` is drawn in the reader's words, and none in English.
  function expectGuideInReadersWords(
    guide: SetupGuideContent,
    language: string,
  ): void {
    const drawn: string = drawnTexts().join("\n");

    for (const piece of getSetupGuideWordPieces(guide)) {
      expect({ piece, drawn: drawn.includes(piece) }).toEqual({
        piece,
        drawn: false,
      });
    }
    for (const piece of getSetupGuideWordPieces(
      inLanguage("Proxmox", guide, language),
    )) {
      expect({ piece, drawn: drawn.includes(piece) }).toEqual({
        piece,
        drawn: true,
      });
    }
  }

  test.each(["de", "ar"])(
    "in %s, the Proxmox guide, its title, its ways to connect and both ways to create the token in the reader's words, the pveum commands and Proxmox's own menus as written",
    async (language: string) => {
      await drawIn(language, <ProxmoxDocumentationPage {...PAGE_PROPS} />);

      // The token step offers a shell and the Proxmox web UI, one drawn at a time: draw both.
      for (const tab of screen.queryAllByTestId("setup-guide-step-variant")) {
        await act(async () => {
          fireEvent.click(tab);
        });
      }
      await settle();

      expectGuideInReadersWords(proxmoxGuide(), language);

      // The card's own words, its ways to connect and its tabs come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["Connect a Proxmox Cluster"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("Connect a Proxmox Cluster")).toBeNull();
      expect(
        screen.getByText(locale["How do you want to connect your cluster?"]!),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale["Native push (Proxmox VE 9+)"]!),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale["Create a read-only API token"]!),
      ).toBeInTheDocument();
      expect(screen.getByText(locale["Proxmox web UI"]!)).toBeInTheDocument();

      // The commands, and Proxmox's own menus and buttons, are the English's.
      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain("pveum user token add");
      expect(drawn).toContain("*Datacenter → Permissions → API Tokens*");
      expect(drawn).toContain("**Privilege Separation**");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );

  test.each(["de", "ar"])(
    "in %s, picking the native push draws the metric server's steps in the reader's words, its fields as Proxmox VE names them",
    async (language: string) => {
      await drawWithOption(
        language,
        <ProxmoxDocumentationPage {...PAGE_PROPS} />,
        "native-push",
      );
      await openEveryTopic();

      expectGuideInReadersWords(proxmoxGuide("native-push"), language);

      // The key step's words, and the metric server step's, from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(
          locale[
            "Proxmox VE sends its metrics with this key, in the x-oneuptime-token header. Pick an existing key or create a new one — the settings below update to use it."
          ]!,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale["Add OneUptime as a metric server"]!),
      ).toBeInTheDocument();

      // The metric server's fields are named as Proxmox VE's dialog names them.
      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain("*Datacenter → Metric Server*");
      expect(drawn).toContain("**Server**");
      expect(drawn).toContain("`/otlp/v1/metrics`");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );

  test.each(["de", "ar"])(
    "in %s, with a key picked, the native push labels the endpoint it is sent to in the reader's words",
    async (language: string) => {
      withAKey();
      await drawWithOption(
        language,
        <ProxmoxDocumentationPage {...PAGE_PROPS} />,
        "native-push",
      );

      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["OTLP metrics endpoint"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("OTLP metrics endpoint")).toBeNull();
    },
  );
});

describe("Kubernetes > Help > Documentation", () => {
  test.each(["de", "fa"])(
    "in %s, the Kubernetes guide, its title and its platforms in the reader's words, the Helm values as written",
    async (language: string) => {
      await drawIn(language, <KubernetesDocumentationPage {...PAGE_PROPS} />);

      const drawn: string = drawnTexts().join("\n");

      for (const piece of getSetupGuideWordPieces(kubernetesGuide())) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: false,
        });
      }
      for (const piece of getSetupGuideWordPieces(
        inLanguage("Kubernetes", kubernetesGuide(), language),
      )) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: true,
        });
      }

      // The card's own words, and its platform picker's, come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["Connect a Kubernetes Cluster"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("Connect a Kubernetes Cluster")).toBeNull();
      expect(
        screen.getByText(locale["Standard Kubernetes"]!),
      ).toBeInTheDocument();
      // The Helm values the reader sets are the English's.
      expect(drawn).toContain("aiAgent.enabled");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "fa" ? "rtl" : "ltr",
        );
      }
    },
  );
});

describe("IoT > Help > Documentation", () => {
  test.each(["de", "ar"])(
    "in %s, the IoT guide and its title in the reader's words, the OpenTelemetry names as written",
    async (language: string) => {
      await drawIn(language, <IoTDocumentationPage {...PAGE_PROPS} />);

      const drawn: string = drawnTexts().join("\n");

      for (const piece of getSetupGuideWordPieces(iotGuide())) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: false,
        });
      }
      for (const piece of getSetupGuideWordPieces(
        inLanguage("IoT", iotGuide(), language),
      )) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: true,
        });
      }

      // The card's own words, and the model topic's, come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["Connect Your IoT Fleet"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("Connect Your IoT Fleet")).toBeNull();
      expect(
        screen.getByText(locale["Point the SDK at OneUptime"]!),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale["How OneUptime models IoT"]!),
      ).toBeInTheDocument();
      // The attributes and variables the device sets are the English's.
      expect(drawn).toContain("iot.fleet.name");
      expect(drawn).toContain("OTEL_RESOURCE_ATTRIBUTES");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );

  test.each(["de", "ar"])(
    "in %s, with a key picked, MQTT labels the address the devices connect to, and says what the key is for, in the reader's words",
    async (language: string) => {
      withAKey();
      await drawWithOption(
        language,
        <IoTDocumentationPage {...PAGE_PROPS} />,
        "mqtt",
      );

      const locale: Record<string, string> = readDashboardLocale(language);
      const hint: string =
        "Send the ingestion token below as the MQTT password — the username is ignored.";

      expect(
        screen.getByText(locale["MQTT WebSocket URL"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("MQTT WebSocket URL")).toBeNull();
      expect(screen.getByText(locale[hint]!)).toBeInTheDocument();
      expect(screen.queryByText(hint)).toBeNull();
    },
  );
});

describe("Ceph > Help > Documentation", () => {
  test.each(["de", "fa"])(
    "in %s, the Ceph guide and its title in the reader's words, the mgr endpoints as written",
    async (language: string) => {
      await drawIn(language, <CephDocumentationPage {...PAGE_PROPS} />);

      const drawn: string = drawnTexts().join("\n");

      for (const piece of getSetupGuideWordPieces(cephGuide())) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: false,
        });
      }
      for (const piece of getSetupGuideWordPieces(
        inLanguage("Ceph", cephGuide(), language),
      )) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: true,
        });
      }

      // The card's own words come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["Connect a Ceph Cluster"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("Connect a Ceph Cluster")).toBeNull();
      expect(
        screen.getByText(locale["Enable the mgr prometheus module"]!),
      ).toBeInTheDocument();
      // The mgr list and the module command are the English's in every language.
      expect(drawn).toContain(
        "ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283",
      );
      expect(drawn).toContain("ceph mgr module enable prometheus");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "fa" ? "rtl" : "ltr",
        );
      }
    },
  );
});

describe("OpenStack > Help > Documentation", () => {
  /*
   * The credential step's tabs (Full view, Infrastructure only, Project
   * view) draw one at a time: each is picked once, so every tab is drawn.
   */
  async function openEveryVariant(): Promise<void> {
    for (const tab of screen.queryAllByTestId("setup-guide-step-variant")) {
      await act(async () => {
        fireEvent.click(tab);
      });
    }
    await settle();
  }

  // Every piece of `guide` is drawn in the reader's words, and none in English.
  function expectGuideInReadersWords(
    guide: SetupGuideContent,
    language: string,
  ): void {
    const drawn: string = drawnTexts().join("\n");

    for (const piece of getSetupGuideWordPieces(guide)) {
      expect({ piece, drawn: drawn.includes(piece) }).toEqual({
        piece,
        drawn: false,
      });
    }
    for (const piece of getSetupGuideWordPieces(
      inLanguage("OpenStack", guide, language),
    )) {
      expect({ piece, drawn: drawn.includes(piece) }).toEqual({
        piece,
        drawn: true,
      });
    }
  }

  test.each(["de", "ar"])(
    "in %s, the OpenStack guide, its questions and its topics in the reader's words, its commands as written",
    async (language: string) => {
      await drawIn(language, <OpenStackDocumentationPage {...PAGE_PROPS} />);
      await openEveryVariant();

      expectGuideInReadersWords(openStackGuide(), language);

      // The card's own words, both questions and the topics' summaries come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["Connect an OpenStack Cloud"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("Connect an OpenStack Cloud")).toBeNull();
      expect(
        screen.getByText(locale["Create the agent's credential"]!),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale["How do you deploy OpenStack?"]!),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale["How do you want to install the agent?"]!),
      ).toBeInTheDocument();

      // The role, the variables and the access table's services are the English's.
      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain("`oneuptime_monitoring`");
      expect(drawn).toContain("`OPENSTACK_CLOUD_NAME`");
      expect(drawn).toContain("`OPENSTACK_EXPORTER_CLOUDS`");
      expect(drawn).toContain("Keystone");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );

  test.each(["de", "ar"])(
    "in %s, picking Kolla-Ansible and Docker Compose draws that tool's own steps in the reader's words",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });
      await act(async () => {
        render(
          <MemoryRouter>
            <OpenStackDocumentationPage {...PAGE_PROPS} />
          </MemoryRouter>,
        );
      });
      await settle();

      await act(async () => {
        fireEvent.click(screen.getByTestId("setup-guide-option-kolla-ansible"));
      });
      await act(async () => {
        fireEvent.click(
          screen.getByTestId("setup-guide-option-docker-compose"),
        );
      });
      await settle();
      await openEveryTopic();
      await openEveryVariant();

      expectGuideInReadersWords(
        openStackGuide("kolla-ansible", "docker-compose"),
        language,
      );

      // Kolla-Ansible's own step and its exporter table, with the ports and settings as written.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["Watch what the cloud stands on"]!),
      ).toBeInTheDocument();
      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain("`OPENSTACK_RABBITMQ_TARGETS`");
      expect(drawn).toContain("`15692`");
      expect(drawn).toContain("`/etc/kolla/globals.yml`");
    },
  );

  /*
   * A closed topic shows its summary under its title. Who did what's was
   * written in a const the i18n extractor never saw, so it read in English
   * in every language (#8341).
   */
  test.each(["de", "ar"])(
    "in %s, the Who did what topic's summary is in the reader's words",
    async (language: string) => {
      const summary: string =
        "Keystone's audit trail and the audit filter on each API, into Security Events.";

      await act(async () => {
        await i18next.changeLanguage(language);
      });
      await act(async () => {
        render(
          <MemoryRouter>
            <OpenStackDocumentationPage {...PAGE_PROPS} />
          </MemoryRouter>,
        );
      });
      await settle();
      await act(async () => {
        fireEvent.click(screen.getByTestId("setup-guide-advanced-toggle"));
      });

      const locale: Record<string, string> = readDashboardLocale(language);
      expect(locale[summary]).toBeDefined();
      expect(locale[summary]).not.toBe(summary);
      expect(screen.getByText(locale[summary]!)).toBeInTheDocument();
      expect(screen.queryByText(summary)).toBeNull();
      expect(screen.getByText(locale["Who did what"]!)).toBeInTheDocument();
    },
  );

  test("a tool without an agent draws a probe's steps in the reader's words, and no install question", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });
    await act(async () => {
      render(
        <MemoryRouter>
          <OpenStackDocumentationPage {...PAGE_PROPS} />
        </MemoryRouter>,
      );
    });
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTestId("setup-guide-option-openstack-helm"));
    });
    await settle();
    await openEveryTopic();

    expectGuideInReadersWords(openStackGuide("openstack-helm"), "de");

    const locale: Record<string, string> = readDashboardLocale("de");
    expect(
      screen.queryByText(locale["How do you want to install the agent?"]!),
    ).toBeNull();
    expect(drawnTexts().join("\n")).toContain("**OpenStack → Alle Clouds**");
  });

  /*
   * The key the guide's first step creates is named "OpenStack key". Chinese
   * named it 键 (a keyboard's key) where every other product's is 密钥 and
   * 金鑰: in every language it is worded as Docker's and Ceph's are.
   */
  test.each(["de", "fr", "ja", "ko", "zh-CN", "zh-TW", "hi", "fa", "ar"])(
    "in %s, the OpenStack key is named as the other products' keys are",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      expect(locale["OpenStack key"]).toBe(
        locale["Docker key"]!.replace("Docker", "OpenStack"),
      );
      expect(locale["OpenStack key"]).toBe(
        locale["Ceph key"]!.replace("Ceph", "OpenStack"),
      );
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
