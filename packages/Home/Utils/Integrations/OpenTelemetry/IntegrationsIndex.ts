import {
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  OPEN_TELEMETRY_GUIDE_LANGUAGE_GROUPS,
  OpenTelemetryGuideLanguageGroup,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import { JSONObject } from "Common/Types/JSON";
import {
  ProviderLogoImage,
  getProviderLogoImage,
} from "../../ProviderLogoFiles";
import { GuideCard, guideCard } from "./GuidePage";
import { OpenTelemetryGuide } from "./GuideTypes";
import { getPublishedGuides } from "./OpenTelemetryGuides";

/*
 * The index of integrations (/integrations): every published guide, grouped
 * by language in the catalog's order, each card with the words the page's
 * search box finds it by. A language with no guide yet is named in one line
 * under the groups, pointing at the docs' setup for it, so a reader of any
 * language has somewhere to go.
 */

export interface IndexCard extends GuideCard {
  // Lower-case words the search box matches: name, language, search terms.
  search: string;
}

export interface IndexGroup {
  id: string;
  title: string;
  description: string;
  logo?: ProviderLogoImage | undefined;
  cards: Array<IndexCard>;
}

export interface IntegrationsIndexContent {
  guideCount: number;
  groups: Array<IndexGroup>;
  // Languages with no guide yet: ["Python", "Java", ".NET"]...
  languagesToCome: Array<string>;
  // ...as a sentence writes them: "Python, Java and .NET".
  languagesToComeText: string;
  structuredData: Array<JSONObject>;
}

function searchWordsOf(guide: OpenTelemetryGuide, card: GuideCard): string {
  return [card.name, card.languageTitle, ...guide.searchTerms]
    .join(" ")
    .toLowerCase();
}

export function getIntegrationsIndexContent(
  homeUrl: string,
): IntegrationsIndexContent {
  const published: Array<{
    entry: { slug: string; language: string };
    guide: OpenTelemetryGuide;
  }> = getPublishedGuides();
  const baseUrl: string = homeUrl.replace(/\/$/, "");

  const groups: Array<IndexGroup> = [];
  const languagesToCome: Array<string> = [];

  for (const group of OPEN_TELEMETRY_GUIDE_LANGUAGE_GROUPS) {
    const cards: Array<IndexCard> = published
      .filter(({ entry }: { entry: { language: string } }): boolean => {
        return entry.language === group.language;
      })
      .map(({ guide }: { guide: OpenTelemetryGuide }): IndexCard => {
        const card: GuideCard = guideCard(guide.slug);

        return { ...card, search: searchWordsOf(guide, card) };
      });

    if (cards.length === 0) {
      languagesToCome.push(group.title);
      continue;
    }

    groups.push(indexGroup(group, cards));
  }

  const itemList: JSONObject = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "OpenTelemetry integrations",
    numberOfItems: published.length,
    itemListElement: published.map(
      ({ guide }: { guide: OpenTelemetryGuide }, index: number): JSONObject => {
        return {
          "@type": "ListItem",
          position: index + 1,
          name: guide.h1,
          url: `${baseUrl}${getOpenTelemetryGuidePath(guide.slug)}`,
        };
      },
    ),
  };

  const collection: JSONObject = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "OpenTelemetry integrations",
    url: `${baseUrl}${OPEN_TELEMETRY_GUIDES_INDEX_PATH}`,
    inLanguage: "en",
  };

  return {
    guideCount: published.length,
    groups: groups,
    languagesToCome: languagesToCome,
    languagesToComeText: listInWords(languagesToCome),
    structuredData: [collection, itemList],
  };
}

// "A", "A and B", "A, B and C".
export function listInWords(items: Array<string>): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function indexGroup(
  group: OpenTelemetryGuideLanguageGroup,
  cards: Array<IndexCard>,
): IndexGroup {
  return {
    id: group.language,
    title: group.title,
    description: group.description,
    logo: group.logo ? getProviderLogoImage(group.logo) : undefined,
    cards: cards,
  };
}
