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
import VMwareDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Documentation";
import VMwareDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/DocumentationCard";
import DatabaseDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Documentation";
import DatabaseDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DocumentationCard";
import HostDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Host/DocumentationCard";
import MessageQueueDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Documentation";
import MessageQueueDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueueDocumentationCard";
import DockerDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Docker/DocumentationCard";
import SetupGuideCard from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideCard";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { getConfiguredOneUptimeUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/ConfiguredOneUptimeUrl";
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
import {
  VMwareInstallMethod,
  getVMwareSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import { VMWARE_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationTranslations";
import {
  DatabaseDocumentationTarget,
  getDatabaseAgentEngine,
  getDatabaseAgentSetupGuide,
  getDatabaseHealthMonitorCreateUrl,
  getDatabaseOwnCollectorSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import { DATABASE_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationTranslations";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  HostInstallMethod,
  getHostSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import { HOST_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationTranslations";
import {
  MessageQueueDocumentationTarget,
  getMessageQueueSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown";
import { MESSAGE_QUEUE_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationTranslations";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ProjectUtil from "../../../UI/Utils/Project";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fr", "ar", "fa"];

/*
 * The URL the card puts in a guide: this server's own, from its HOST, or the
 * placeholder where none is set (getConfiguredOneUptimeUrl). CI sets HOST
 * from config.example.env, so the guides the tests build use the same.
 */
const READER_URL: string = getConfiguredOneUptimeUrl();

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
  VMware: {},
  Database: {},
  Host: {},
  MessageQueue: {},
};

/*
 * The guide the page opens on, before a key is picked: the first way of
 * running the agent, the placeholders in its commands.
 */
function dockerGuide(hostName?: string): SetupGuideContent {
  return getDockerSetupGuide({
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: "docker-cli",
    hostName: hostName,
  });
}

function dockerSwarmGuide(): SetupGuideContent {
  return getDockerSwarmSetupGuide({
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: "install-script",
  });
}

function storageArrayGuide(): SetupGuideContent {
  return getStorageArraySetupGuide({
    oneuptimeUrl: READER_URL,
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
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
    method: method,
  });
}

function kubernetesGuide(): SetupGuideContent {
  return getKubernetesSetupGuide({
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    platform: "standard",
  });
}

function iotGuide(): SetupGuideContent {
  return getIoTSetupGuide({
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: "opentelemetry-sdk",
  });
}

function cephGuide(): SetupGuideContent {
  return getCephSetupGuide({
    oneuptimeUrl: READER_URL,
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
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
    method: method,
    tool: tool,
  });
}

/*
 * The VMware guide a reader meets before a key is picked: the install script
 * unless another install method is picked, for the vCenter a vCenter's own
 * Documentation tab installs for.
 */
function vmwareGuide(
  method: VMwareInstallMethod = "install-script",
  vcenterName?: string,
): SetupGuideContent {
  return getVMwareSetupGuide({
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
    method: method,
    vcenterName: vcenterName,
  });
}

/*
 * The Database guide the product page draws before a key is picked, for
 * the engine picked (PostgreSQL until another is), its Database Health
 * monitor link in the current project as the card builds it.
 */
// The Host guide a reader meets before a key is picked: Docker unless another method is picked.
function hostGuide(method: HostInstallMethod = "docker"): SetupGuideContent {
  return getHostSetupGuide({
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: method,
  });
}

/*
 * The Queues guide a reader meets before a key is picked: Apache Kafka
 * until another system is picked, or a queue's own guide with `queue`.
 */
function messageQueueGuide(
  system: string = "kafka",
  queue?: MessageQueueDocumentationTarget,
): SetupGuideContent {
  return getMessageQueueSetupGuide({
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    system: system,
    queue: queue,
  });
}

function databaseGuide(system: string = "postgresql"): SetupGuideContent {
  return getDatabaseAgentSetupGuide({
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
    engine: getDatabaseAgentEngine(system)!,
    system: system,
    databaseHealthMonitorUrl: getDatabaseHealthMonitorCreateUrl(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_CREATE] as Route,
      ).toString(),
    ),
  });
}

/*
 * The guide a database's own Documentation tab draws for its row before a
 * key is picked, as DatabaseDocumentationCard builds it: the agent's guide
 * for an engine it has a config for, the own-collector guide otherwise.
 */
function databaseRowGuide(
  database: DatabaseDocumentationTarget,
): SetupGuideContent {
  const links: {
    databaseHealthMonitorUrl: string;
    recommendationsUrl: string;
  } = {
    databaseHealthMonitorUrl: getDatabaseHealthMonitorCreateUrl(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_CREATE] as Route,
      ).toString(),
    ),
    recommendationsUrl: RouteUtil.populateRouteParams(
      RouteMap[PageMap.DATABASE_SERVER_VIEW_RECOMMENDATIONS] as Route,
      { modelId: database.id },
    ).toString(),
  };
  const engine: ReturnType<typeof getDatabaseAgentEngine> =
    getDatabaseAgentEngine(database.dbSystem || "");

  if (!engine) {
    return getDatabaseOwnCollectorSetupGuide({
      oneuptimeUrl: READER_URL,
      apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      hasApiKey: false,
      database: database,
      ...links,
    });
  }

  return getDatabaseAgentSetupGuide({
    oneuptimeUrl: READER_URL,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
    engine: engine,
    system: database.dbSystem,
    database: database,
    ...links,
  });
}

function podmanGuide(): SetupGuideContent {
  return getPodmanSetupGuide({
    oneuptimeUrl: READER_URL,
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
    WORDS["VMware"]![language] = (
      await VMWARE_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["Database"]![language] = (
      await DATABASE_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["Host"]![language] = (
      await HOST_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
    WORDS["MessageQueue"]![language] = (
      await MESSAGE_QUEUE_DOCUMENTATION_TRANSLATIONS[language]!()
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

    expect(screen.queryByTestId("detail-skeleton")).toBeNull();

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

/*
 * A step's tabs (OpenStack's credential views, VMware's vSphere Client and
 * govc) draw one at a time: each is picked once, so every tab is drawn.
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
  product: string,
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
    inLanguage(product, guide, language),
  )) {
    expect({ piece, drawn: drawn.includes(piece) }).toEqual({
      piece,
      drawn: true,
    });
  }
}

describe("OpenStack > Help > Documentation", () => {
  test.each(["de", "ar"])(
    "in %s, the OpenStack guide, its questions and its topics in the reader's words, its commands as written",
    async (language: string) => {
      await drawIn(language, <OpenStackDocumentationPage {...PAGE_PROPS} />);
      await openEveryVariant();

      expectGuideInReadersWords("OpenStack", openStackGuide(), language);

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
        "OpenStack",
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

    expectGuideInReadersWords(
      "OpenStack",
      openStackGuide("openstack-helm"),
      "de",
    );

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

describe("VMware > Help > Documentation", () => {
  const KEY_STEP: string =
    "The agent sends your vCenter's metrics to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it.";

  // The page in `language`, an install method picked, every topic and tab open.
  async function drawWithMethod(
    language: string,
    method: VMwareInstallMethod,
  ): Promise<void> {
    await act(async () => {
      await i18next.changeLanguage(language);
    });
    await act(async () => {
      render(
        <MemoryRouter>
          <VMwareDocumentationPage {...PAGE_PROPS} />
        </MemoryRouter>,
      );
    });
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId(`setup-guide-option-${method}`));
    });
    await settle();
    await openEveryTopic();
    await openEveryVariant();
  }

  test.each(["de", "ar"])(
    "in %s, the VMware guide, its question and its key step in the reader's words, vSphere's menus and the commands as written",
    async (language: string) => {
      await drawIn(language, <VMwareDocumentationPage {...PAGE_PROPS} />);
      await openEveryVariant();

      expectGuideInReadersWords("VMware", vmwareGuide(), language);

      // The card's own words, its question and its key step come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["Connect a vCenter"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("Connect a vCenter")).toBeNull();
      expect(
        screen.getByText(locale["How do you want to install the agent?"]!),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale["Create a read-only vSphere user"]!),
      ).toBeInTheDocument();
      expect(locale[KEY_STEP]).not.toBe(KEY_STEP);
      expect(screen.getByText(locale[KEY_STEP]!)).toBeInTheDocument();
      expect(screen.queryByText(KEY_STEP)).toBeNull();

      // vSphere's own menus, the principal and the variables are the English's.
      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain(
        "*Menu → Administration → Single Sign On → Users and Groups*",
      );
      expect(drawn).toContain("**Propagate to children**");
      expect(drawn).toContain("`oneuptime@vsphere.local`");
      expect(drawn).toContain("`VMWARE_VCENTER_NAME`");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );

  test.each([
    ["de", "docker-compose"],
    ["ar", "docker-compose"],
    ["de", "linux-service"],
    ["ar", "linux-service"],
  ] as Array<[string, VMwareInstallMethod]>)(
    "in %s, picking %s draws that install method's steps and topics in the reader's words",
    async (language: string, method: VMwareInstallMethod) => {
      await drawWithMethod(language, method);

      expectGuideInReadersWords("VMware", vmwareGuide(method), language);

      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain(
        method === "linux-service"
          ? "`sudo systemctl restart oneuptime-vmware-agent`"
          : "`docker compose up -d`",
      );
    },
  );

  test("a vCenter's own tab: the guide for that vCenter, in German", async () => {
    await drawIn(
      "de",
      <VMwareDocumentationCard
        title="Connect a vCenter"
        description="A guide."
        vcenterName="vcenter-1"
      />,
    );
    await openEveryVariant();

    expectGuideInReadersWords(
      "VMware",
      vmwareGuide("install-script", "vcenter-1"),
      "de",
    );
    expect(drawnTexts().join("\n")).toContain(
      "Dieses vCenter ist **`vcenter-1`**.",
    );
  });
});

describe("Databases > Help > Documentation", () => {
  // The install step's tabs (install script, Docker Compose) draw one at a time.
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
    const translated: Array<string> = getSetupGuideWordPieces(
      inLanguage("Database", guide, language),
    );

    for (const piece of getSetupGuideWordPieces(guide)) {
      // A file's name alone is in its translation: "Die Datei **docker-compose.yml**".
      if (
        translated.some((words: string): boolean => {
          return words.includes(piece);
        })
      ) {
        continue;
      }
      expect({ piece, drawn: drawn.includes(piece) }).toEqual({
        piece,
        drawn: false,
      });
    }
    for (const piece of translated) {
      expect({ piece, drawn: drawn.includes(piece) }).toEqual({
        piece,
        drawn: true,
      });
    }
  }

  test.each(["de", "ar"])(
    "in %s, the PostgreSQL guide, its engine picker and its topics in the reader's words, its commands as written",
    async (language: string) => {
      await drawIn(language, <DatabaseDocumentationPage {...PAGE_PROPS} />);
      await openEveryVariant();

      expectGuideInReadersWords(databaseGuide(), language);

      // The card's own words, the picker's and the steps' titles come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["Connect Database Engine Metrics"]!),
      ).toBeInTheDocument();
      expect(screen.queryByText("Connect Database Engine Metrics")).toBeNull();
      expect(
        screen.getByText(locale["Which database engine?"]!),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale["Create a monitoring user"]!),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          locale[
            "The agent sends the database's engine metrics to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it."
          ]!,
        ),
      ).toBeInTheDocument();
      // Each pill is the engine's name, its hint the reader's words.
      expect(
        screen.getByTestId("setup-guide-option-mariadb"),
      ).toHaveTextContent("MariaDB");
      expect(
        screen
          .getByTestId("setup-guide-option-postgresql")
          .getAttribute("title"),
      ).toBe(locale["Runs the collector's postgresql receiver."]);
      expect(
        screen.getByTestId("setup-guide-option-valkey").getAttribute("title"),
      ).toBe(
        locale["Runs the redis receiver and reports the server as Valkey."],
      );

      // The grants, the variables and the image are the English's.
      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain("`pg_monitor`");
      expect(drawn).toContain("`DATABASE_SERVER_ADDRESS`");
      expect(drawn).toContain("`otel/opentelemetry-collector-contrib:0.165.0`");
      expect(drawn).toContain("GRANT pg_monitor TO oneuptime_monitor;");
      // The Database Health monitor link opens the monitor form in this project.
      expect(drawn).toContain(
        "](/dashboard/10000000-0000-4000-8000-000000000001/monitors/create?monitorType=Database)",
      );
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );

  test.each(["de", "ar"])(
    "in %s, picking SQL Server draws that engine's own steps in the reader's words",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });
      await act(async () => {
        render(
          <MemoryRouter>
            <DatabaseDocumentationPage {...PAGE_PROPS} />
          </MemoryRouter>,
        );
      });
      await settle();

      await act(async () => {
        fireEvent.click(
          screen.getByTestId("setup-guide-option-microsoft.sql_server"),
        );
      });
      await settle();
      await openEveryTopic();
      await openEveryVariant();

      expectGuideInReadersWords(
        databaseGuide("microsoft.sql_server"),
        language,
      );

      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain("`VIEW SERVER STATE`");
      expect(drawn).toContain("`configs/sqlserver.yaml`");
      expect(drawn).toContain("`Login failed for user`");
    },
  );

  /*
   * A database's own Documentation tab, and Add Database once its row
   * exists, install for that row (#8746): the agent's guide with the row's
   * identity and server id, its Kubernetes Deployment for a row found
   * there, and for an engine the agent has no config for the guide for the
   * reader's own collector. Each reads in the reader's words.
   */
  const DATABASE_ID: string = "4f7f2c9e-0000-4000-8000-000000000001";
  const ROWS: Array<[string, DatabaseDocumentationTarget, Array<string>]> = [
    [
      "a PostgreSQL row with an address",
      {
        id: DATABASE_ID,
        name: "orders-db",
        dbSystem: "postgresql",
        serverAddress: "db.prod.internal",
        serverPort: 5432,
      },
      ["`DATABASE_SERVER_ID`", "db.prod.internal", DATABASE_ID],
    ],
    [
      "a MySQL row found in Kubernetes",
      {
        id: DATABASE_ID,
        dbSystem: "mysql",
        endpoints: ["orders.data.svc.cluster.local:3306@prod"],
        kubernetesNamespace: "data",
        isKubernetes: true,
      },
      ["kubectl -n data", "`DATABASE_SERVER_ID`", "kind: Deployment"],
    ],
    [
      "a CockroachDB row, for your own collector",
      {
        id: DATABASE_ID,
        name: "ledger",
        dbSystem: "cockroachdb",
        serverAddress: "crdb.prod.internal",
        serverPort: 26257,
      },
      ["`/_status/vars`", "resource/database", "oneuptime.database.server.id"],
    ],
    [
      "an engine OneUptime does not know, named as reported (#8780)",
      {
        id: DATABASE_ID,
        name: "ledger",
        dbSystem: "Acme Ledger 2",
        serverAddress: "ledger.prod.internal",
      },
      ["`Acme Ledger 2`", "resource/database", "ledger.prod.internal"],
    ],
    [
      "a SQLite row, from its application's traces",
      { id: DATABASE_ID, name: "cache.db", dbSystem: "sqlite" },
      ["OTEL_EXPORTER_OTLP_ENDPOINT", DATABASE_ID],
    ],
  ];

  test.each(
    ["de", "ar"].flatMap(
      (
        language: string,
      ): Array<
        [string, string, DatabaseDocumentationTarget, Array<string>]
      > => {
        return ROWS.map(
          ([label, database, written]: [
            string,
            DatabaseDocumentationTarget,
            Array<string>,
          ]): [string, string, DatabaseDocumentationTarget, Array<string>] => {
            return [language, label, database, written];
          },
        );
      },
    ),
  )(
    "in %s, a database's own tab for %s reads in the reader's words, its code as written",
    async (
      language: string,
      _label: string,
      database: DatabaseDocumentationTarget,
      written: Array<string>,
    ) => {
      await drawIn(
        language,
        <DatabaseDocumentationCard
          title="Connect this database"
          description="The guide for this database."
          database={database}
        />,
      );
      await openEveryVariant();

      expectGuideInReadersWords(databaseRowGuide(database), language);

      const drawn: string = drawnTexts().join("\n");
      for (const text of written) {
        expect(drawn).toContain(text);
      }
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );
});

/*
 * Hosts > Help > Documentation folds the manual guide under the default
 * one-command install: the card it folds away is drawn here on its own.
 */
describe("Hosts > Help > Documentation, the collector you install yourself", () => {
  const KEY_STEP: string =
    "The collector sends this host's metrics to OneUptime with this key. Pick an existing key or create a new one — the config below updates to use it.";

  // The card in `language`, an install method picked, every topic and tab open.
  async function drawWithMethod(
    language: string,
    method: HostInstallMethod,
  ): Promise<void> {
    await act(async () => {
      await i18next.changeLanguage(language);
    });
    await act(async () => {
      render(
        <MemoryRouter>
          <HostDocumentationCard
            title="Install the collector yourself"
            description=""
            isBare={true}
          />
        </MemoryRouter>,
      );
    });
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId(`setup-guide-option-${method}`));
    });
    await settle();
    await openEveryTopic();
    await openEveryVariant();
  }

  test.each(["de", "ar"])(
    "in %s, the Docker guide, its question and its key step in the reader's words, its flags and paths as written",
    async (language: string) => {
      await drawWithMethod(language, "docker");

      expectGuideInReadersWords("Host", hostGuide(), language);

      // The card's question and its key step come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      expect(
        screen.getByText(locale["How do you want to install the collector?"]!),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale["Save the collector config"]!),
      ).toBeInTheDocument();
      expect(locale[KEY_STEP]).not.toBe(KEY_STEP);
      expect(screen.getByText(locale[KEY_STEP]!)).toBeInTheDocument();
      expect(screen.queryByText(KEY_STEP)).toBeNull();

      // The collector's flags and the attributes it sets are the English's.
      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain("`--network host`");
      expect(drawn).toContain("`host.name`");
      expect(drawn).toContain("`oneuptime.label.`");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );

  test.each([
    ["de", "linux-deb"],
    ["ar", "linux-tarball"],
    ["de", "macos"],
    ["ar", "windows"],
  ] as Array<[string, HostInstallMethod]>)(
    "in %s, picking %s draws that install method's steps and topics in the reader's words",
    async (language: string, method: HostInstallMethod) => {
      await drawWithMethod(language, method);

      expectGuideInReadersWords("Host", hostGuide(method), language);
    },
  );

  /*
   * Kubernetes nodes take the Kubernetes agent's steps, not a collector's:
   * the Kubernetes guide's own pieces, in the Host guide's words.
   */
  test.each(["de", "ar"])(
    "in %s, picking Kubernetes draws the Kubernetes agent's steps in the reader's words",
    async (language: string) => {
      await drawWithMethod(language, "kubernetes");

      expectGuideInReadersWords("Host", hostGuide("kubernetes"), language);
      expect(drawnTexts().join("\n")).toContain("aiAgent.enabled");
    },
  );
});

describe("Queues > Help > Documentation", () => {
  // The page in `language`, a messaging system picked, every topic and tab open.
  async function drawWithSystem(
    language: string,
    system?: string,
  ): Promise<void> {
    if (system) {
      await drawWithOption(
        language,
        <MessageQueueDocumentationPage {...PAGE_PROPS} />,
        system,
      );
    } else {
      await act(async () => {
        await i18next.changeLanguage(language);
      });
      await act(async () => {
        render(
          <MemoryRouter>
            <MessageQueueDocumentationPage {...PAGE_PROPS} />
          </MemoryRouter>,
        );
      });
      await settle();
    }
    await openEveryTopic();
    await openEveryVariant();
  }

  test.each(["de", "ar"])(
    "in %s, the Apache Kafka guide it opens on, its question and its pills in the reader's words, its config as written",
    async (language: string) => {
      await drawWithSystem(language);

      expectGuideInReadersWords("MessageQueue", messageQueueGuide(), language);

      // The card's title, question and key step come from the locale files.
      const locale: Record<string, string> = readDashboardLocale(language);
      for (const key of [
        "Queues Installation Guide",
        "Which messaging system?",
      ]) {
        expect(locale[key]).not.toBe(key);
        expect(screen.getByText(locale[key]!)).toBeInTheDocument();
        expect(screen.queryByText(key)).toBeNull();
      }
      // The pills name each system as it is written, in every language.
      expect(screen.getByTestId("setup-guide-option-kafka")).toHaveTextContent(
        "Apache Kafka",
      );

      // The receiver and its settings are the English's.
      const drawn: string = drawnTexts().join("\n");
      expect(drawn).toContain("kafka_metrics");
      expect(drawn).toContain("`messaging.destination.name`");
      for (const markdown of mockDrawnMarkdown) {
        expect(markdown.readingDirection).toBe(
          language === "ar" ? "rtl" : "ltr",
        );
      }
    },
  );

  /*
   * Each kind of broker step: a collector receiver (RabbitMQ), a cloud
   * monitoring API (Amazon SQS), the JMX Scraper (ActiveMQ), none at all
   * (Azure Event Grid's charted-nothing note), JMS's Advanced topic and
   * BullMQ's transform.
   */
  test.each([
    ["de", "rabbitmq"],
    ["ar", "aws_sqs"],
    ["de", "activemq"],
    ["ar", "eventgrid"],
    ["de", "jms"],
    ["ar", "bullmq"],
  ])(
    "in %s, picking %s draws that system's steps and topics in the reader's words",
    async (language: string, system: string) => {
      await drawWithSystem(language, system);

      expectGuideInReadersWords(
        "MessageQueue",
        messageQueueGuide(system),
        language,
      );
    },
  );

  /*
   * A queue's own Documentation tab (#8798): the queue's identity, the
   * broker address its telemetry reported, its Azure namespace, and a
   * system the catalog does not know, whose name the words hold as code.
   */
  test.each([
    ["de", { system: "kafka", brokerAddress: "broker-1.example.com:9092" }],
    ["ar", { system: "servicebus", brokerScope: "shop-prod" }],
    ["de", { system: "rabbitmq", brokerAddress: "rabbit.internal:15672" }],
    ["ar", { system: "ibmmq" }],
  ] as Array<[string, Partial<MessageQueueDocumentationTarget>]>)(
    "in %s, a queue's own tab reads in the reader's words: %j",
    async (language: string, row: Partial<MessageQueueDocumentationTarget>) => {
      const queue: MessageQueueDocumentationTarget = {
        system: row.system,
        destination: "orders.created",
        brokerScope: row.brokerScope || "",
        brokerAddress: row.brokerAddress,
      };

      await act(async () => {
        await i18next.changeLanguage(language);
      });
      await act(async () => {
        render(
          <MemoryRouter>
            <MessageQueueDocumentationCard
              title="Set up this queue"
              description=""
              queue={queue}
            />
          </MemoryRouter>,
        );
      });
      await settle();
      await openEveryTopic();
      await openEveryVariant();

      expectGuideInReadersWords(
        "MessageQueue",
        messageQueueGuide(queue.system as string, queue),
        language,
      );
      expect(drawnTexts().join("\n")).toContain("`orders.created`");
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

    expect(screen.getByTestId("detail-skeleton")).toBeInTheDocument();
    expect(mockDrawnMarkdown).toEqual([]);

    await act(async () => {
      release!();
      await Promise.resolve();
    });
    await settle();

    expect(screen.queryByTestId("detail-skeleton")).toBeNull();
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

    expect(screen.queryByTestId("detail-skeleton")).toBeNull();
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

    expect(screen.queryByTestId("detail-skeleton")).toBeNull();
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
