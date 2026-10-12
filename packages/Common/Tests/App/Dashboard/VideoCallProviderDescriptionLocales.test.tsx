import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import VideoCallConnectionFormModal from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallConnectionFormModal";
import VideoCallOAuthConnectModal from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallOAuthConnectModal";
import VideoCallProviderGallery from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallProviderGallery";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "../../../Types/Dashboard/DashboardLanguage";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  OAuthVideoCallProviders,
  getVideoCallProviderDefinition,
} from "../../../Types/VideoCall/VideoCallProviderCatalog";
import {
  getRuntimeLocale,
  RuntimeLocaleTree,
} from "../../../UI/esbuild-locales";

/*
 * Zoom's, Google Meet's and Microsoft Teams' one-line descriptions as a
 * reader sees them, from the Dashboard's shipped locale files: on each
 * provider's tile in Project Settings > Workspace > Video Calls, and under
 * the title of both connect dialogs - the one-click sign-in and the form for
 * the project's own app. The catalog that holds them is in Common, outside
 * what npm run i18n:extract reads, so this proves the lookups reach the
 * translations kept for them by hand (App's VideoCallProviderDescriptionsI18n
 * pins those in every locale).
 *
 * i18next is set up as DashboardRuntimeLocales sets it up, and reaches the
 * components through I18nextProvider only.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const ENGLISH: string = DEFAULT_DASHBOARD_LANGUAGE;

const TRANSLATED_CODES: Array<string> =
  SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
    return code !== ENGLISH;
  });

const readLocale: (code: string) => RuntimeLocaleTree = (
  code: string,
): RuntimeLocaleTree => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as RuntimeLocaleTree;
};

const fullEnglish: RuntimeLocaleTree = readLocale(ENGLISH);

// What a language's chunk carries: its file less what English already reads.
const shippedLocale: (code: string) => RuntimeLocaleTree = (
  code: string,
): RuntimeLocaleTree => {
  return getRuntimeLocale({
    language: code,
    fallbackLanguage: ENGLISH,
    locale: code === ENGLISH ? fullEnglish : readLocale(code),
    fallback: fullEnglish,
  });
};

// The Dashboard's i18next options (Utils/i18n.ts), its resources given here.
const createDashboardInstance: (language: string) => Promise<i18n> = async (
  language: string,
): Promise<i18n> => {
  const instance: i18n = createInstance();
  const resources: Record<string, { translation: RuntimeLocaleTree }> = {
    [ENGLISH]: { translation: shippedLocale(ENGLISH) },
  };

  if (language !== ENGLISH) {
    resources[language] = { translation: shippedLocale(language) };
  }

  await instance.init({
    lng: language,
    resources: resources,
    partialBundledLanguages: true,
    fallbackLng: ENGLISH,
    supportedLngs: SUPPORTED_DASHBOARD_LANGUAGE_CODES,
    load: "currentOnly",
    interpolation: { escapeValue: false },
  });

  return instance;
};

// Settles inside act, so the setup guide's lazily loaded Markdown does too.
const renderIn: (
  instance: i18n,
  element: ReactElement,
) => Promise<void> = async (
  instance: i18n,
  element: ReactElement,
): Promise<void> => {
  await act(async () => {
    render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);
  });
};

const descriptionOf: (provider: VideoCallProvider) => string = (
  provider: VideoCallProvider,
): string => {
  return getVideoCallProviderDefinition(provider)!.description;
};

// The description as the full locale file words it.
const descriptionIn: (code: string, provider: VideoCallProvider) => string = (
  code: string,
  provider: VideoCallProvider,
): string => {
  return readLocale(code)[descriptionOf(provider)] as string;
};

const gallery: () => ReactElement = (): ReactElement => {
  return (
    <VideoCallProviderGallery
      connectionCounts={{}}
      canConnect={true}
      onConnect={() => {}}
    />
  );
};

afterEach(() => {
  cleanup();
});

describe("a one-click provider's tile", () => {
  test("reads its description in English", async () => {
    await renderIn(await createDashboardInstance(ENGLISH), gallery());

    for (const provider of OAuthVideoCallProviders) {
      expect(
        within(screen.getByTestId(`video-call-provider-${provider}`)).getByText(
          descriptionOf(provider),
        ),
      ).toBeInTheDocument();
    }
  });

  test.each(TRANSLATED_CODES)(
    "reads its description in %s",
    async (code: string) => {
      await renderIn(await createDashboardInstance(code), gallery());

      for (const provider of OAuthVideoCallProviders) {
        const tile: HTMLElement = screen.getByTestId(
          `video-call-provider-${provider}`,
        );

        expect(
          within(tile).getByText(descriptionIn(code, provider)),
        ).toBeInTheDocument();
        expect(within(tile).queryByText(descriptionOf(provider))).toBeNull();
      }
    },
  );
});

describe("a one-click provider's connect dialogs, in German", () => {
  test.each(OAuthVideoCallProviders)(
    "%s's sign-in dialog reads its description",
    async (provider: VideoCallProvider) => {
      await renderIn(
        await createDashboardInstance("de"),
        <VideoCallOAuthConnectModal
          provider={provider}
          onClose={() => {}}
          onUseOwnApp={() => {}}
        />,
      );

      expect(screen.getByTestId("modal-description").textContent).toBe(
        descriptionIn("de", provider),
      );
    },
  );

  test.each(OAuthVideoCallProviders)(
    "%s's form for the project's own app reads its description",
    async (provider: VideoCallProvider) => {
      await renderIn(
        await createDashboardInstance("de"),
        <VideoCallConnectionFormModal
          provider={provider}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      );

      expect(screen.getByTestId("modal-description").textContent).toBe(
        descriptionIn("de", provider),
      );
    },
  );
});
