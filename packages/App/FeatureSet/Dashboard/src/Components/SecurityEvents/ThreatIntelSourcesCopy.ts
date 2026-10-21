import ThreatIntelFeedType, {
  RECOMMENDED_THREAT_INTEL_LISTS,
  RecommendedThreatIntelList,
  THREAT_INTEL_FEED_TYPE_DEFINITIONS,
  ThreatIntelFeedTypeDefinition,
  readThreatIntelFeedType,
} from "Common/Types/SecurityEvent/ThreatIntelFeedType";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words the Threat Intel page shows for things defined in Common/Types -
 * where a feed's indicators come from, and the free lists a project adds in
 * one click - marked here so the extractor puts them in the locale files (it
 * does not read Common/Types/SecurityEvent). The English is the same text the
 * definitions carry, word for word; a test holds the two together
 * (Common/Tests/App/Dashboard/ThreatIntelSourcesUi).
 */

export interface ThreatIntelSourceText {
  title: string;
  description: string;
}

export const THREAT_INTEL_FEED_TYPE_TEXTS: Record<
  ThreatIntelFeedType,
  ThreatIntelSourceText
> = {
  [ThreatIntelFeedType.List]: {
    title: translationKey("List of indicators"),
    description: translationKey(
      "A list at an https address, one IP address, domain, URL or file hash a line.",
    ),
  },
  [ThreatIntelFeedType.Taxii]: {
    title: translationKey("TAXII collection"),
    description: translationKey(
      "A TAXII 2.1 collection of STIX indicators, such as MISP, OpenCTI or an ISAC.",
    ),
  },
  [ThreatIntelFeedType.GoogleSecOps]: {
    title: translationKey("Google SecOps"),
    description: translationKey(
      "The indicators Google SecOps found in your events, read through a Google SecOps connection.",
    ),
  },
};

export const RECOMMENDED_THREAT_INTEL_LIST_TEXTS: Record<
  string,
  ThreatIntelSourceText
> = {
  "feodo-tracker": {
    title: translationKey("Feodo Tracker botnet C2 servers"),
    description: translationKey(
      "Command-and-control servers of active botnets (Dridex, Emotet, QakBot and others), checked by abuse.ch. Free for any use (CC0).",
    ),
  },
  "emerging-threats-compromised": {
    title: translationKey("Emerging Threats compromised hosts"),
    description: translationKey(
      "Hosts known to be compromised and attacking others, from Proofpoint's free ET OPEN blocklists. Updated daily.",
    ),
  },
  "tor-exit-nodes": {
    title: translationKey("Tor exit nodes"),
    description: translationKey(
      "Addresses traffic leaves the Tor network from. Not malicious in itself, but a sign-in through Tor is worth a look.",
    ),
  },
};

// The source a form's values say, or a TAXII collection for a feed saved before sources.
export function getThreatIntelFeedSource(
  values: FormValues<ThreatIntelFeed> | ThreatIntelFeed,
): ThreatIntelFeedType {
  return readThreatIntelFeedType(
    (values as { feedType?: unknown } | undefined)?.feedType,
  );
}

// The Source choice of a new feed, in the order the definitions give.
export function getThreatIntelSourceChoices(): Array<RadioButton> {
  return THREAT_INTEL_FEED_TYPE_DEFINITIONS.map(
    (definition: ThreatIntelFeedTypeDefinition): RadioButton => {
      return {
        value: definition.type,
        title: THREAT_INTEL_FEED_TYPE_TEXTS[definition.type].title,
        description: THREAT_INTEL_FEED_TYPE_TEXTS[definition.type].description,
      };
    },
  );
}

export function getRecommendedThreatIntelListText(
  list: RecommendedThreatIntelList,
): ThreatIntelSourceText {
  return (
    RECOMMENDED_THREAT_INTEL_LIST_TEXTS[list.id] || {
      title: list.title,
      description: list.description,
    }
  );
}

export { RECOMMENDED_THREAT_INTEL_LISTS };
