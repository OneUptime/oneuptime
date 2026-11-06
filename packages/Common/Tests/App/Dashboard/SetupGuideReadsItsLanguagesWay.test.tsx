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
import { act, cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import CloudDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudDocumentationCard";
import { getCloudSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudSetupGuide";
import SetupGuideCard from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideCard";
import {
  SetupGuideContent,
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../Helpers/DashboardLocales";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatformDescriptor,
} from "../../../Types/Cloud/CloudPlatform";

/*
 * A setup guide worded in the reader's language reads that language's way
 * - the UI review of #6149.
 *
 * The environment guide is the reader's language, every sentence of it.
 * In Persian, a step that walks the AWS console names more English labels
 * than it has Persian words, and the markdown viewer - which lays a note
 * out the way most of its letters read - laid that step out left to right
 * on a page read from the right: its list's numbers on the left, its
 * sentences in the wrong order. The guide now says which language its
 * words are (SetupGuideContent.language), and the card hands that way to
 * every piece of markdown and every step's description. A guide written
 * in English (every other setup guide today) says nothing, and each of its
 * blocks reads its own way, as before.
 *
 * The viewer is a lazy boundary: it is replaced by one that records what
 * it is handed.
 */

interface MarkdownViewerProps {
  text: string;
  readingDirection?: string | undefined;
}

const mockDrawnMarkdown: Array<MarkdownViewerProps> = [];

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      mockDrawnMarkdown.push({
        text: props.text,
        readingDirection: props.readingDirection,
      });
      return React.createElement("div", {}, props.text);
    },
  };
});

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, locale] of [
    ["en", englishLocale],
    ["de", germanLocale],
    ["fa", persianLocale],
  ] as Array<[string, Record<string, unknown>]>) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
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

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function drawCloudGuide(language: string): Promise<void> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <MemoryRouter>
          <CloudDocumentationCard
            title="Connect a cloud environment"
            description="Where the settings go."
            initialPlatform="aws_ecs"
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
  });
}

// Every step's description, as the card draws it.
function stepDescriptions(): Array<HTMLElement> {
  return screen
    .getAllByTestId(/^setup-guide-step-\d+$/)
    .map((step: HTMLElement): HTMLElement | null => {
      return step.querySelector("h3 + p");
    })
    .filter((description: HTMLElement | null): boolean => {
      return description !== null;
    }) as Array<HTMLElement>;
}

describe("the environment guide", () => {
  test("says which language its words are: the translator's, English without one", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      const platform: ManagedCloudPlatformDescriptor = descriptor;

      expect(
        getCloudSetupGuide({
          oneuptimeUrl: "https://oneuptime.example",
          apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
          platform: platform.platform,
        }).language,
      ).toBe("en");

      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          platform: platform.platform,
          language: getCloudSetupGuide({
            oneuptimeUrl: "https://oneuptime.example",
            apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
            platform: platform.platform,
            translator: dashboardTranslator(language),
          }).language,
        }).toEqual({ platform: platform.platform, language });
      }
    }
  });

  test("in Persian, every piece of it reads right to left: its markdown and its steps' descriptions", async () => {
    await drawCloudGuide("fa");

    // The intro, the before-you-start list, each step's body and tabs.
    expect(mockDrawnMarkdown.length).toBeGreaterThan(4);
    for (const piece of mockDrawnMarkdown) {
      expect({ text: piece.text, way: piece.readingDirection }).toEqual({
        text: piece.text,
        way: "rtl",
      });
    }

    const descriptions: Array<HTMLElement> = stepDescriptions();

    expect(descriptions.length).toBeGreaterThan(2);
    for (const description of descriptions) {
      expect(description).toHaveAttribute("dir", "rtl");
    }
  });

  test("in German and in English, left to right", async () => {
    for (const language of ["de", "en"]) {
      await drawCloudGuide(language);

      expect(mockDrawnMarkdown.length).toBeGreaterThan(4);
      for (const piece of mockDrawnMarkdown) {
        expect(piece.readingDirection).toBe("ltr");
      }
      for (const description of stepDescriptions()) {
        expect(description).toHaveAttribute("dir", "ltr");
      }

      cleanup();
      mockDrawnMarkdown.length = 0;
    }
  });
});

describe("a guide written in English", () => {
  test("says nothing of its language: each block reads its own way, as before", async () => {
    const content: SetupGuideContent = {
      intro: "Install the agent on the host.",
      steps: [
        {
          title: "Install",
          description: "Run the script.",
          markdown: "Run `install.sh`.",
        },
      ],
    };

    await act(async () => {
      render(
        <I18nextProvider i18n={instances["fa"]!}>
          <MemoryRouter>
            <SetupGuideCard
              title="Install the agent"
              description="On the host."
              newKeyName="Host key"
              getContent={(): SetupGuideContent => {
                return content;
              }}
            />
          </MemoryRouter>
        </I18nextProvider>,
      );
    });

    expect(mockDrawnMarkdown.length).toBeGreaterThan(0);
    for (const piece of mockDrawnMarkdown) {
      expect(piece.readingDirection).toBeUndefined();
    }
    // Its English description, read by its letters: left to right.
    expect(
      screen.getByTestId("setup-guide-step-2").querySelector("h3 + p"),
    ).toHaveAttribute("dir", "ltr");
  });
});
