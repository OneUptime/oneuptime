import {
  DataObservabilityStoreRefusal,
  DataObservabilityStoreSettings,
  DataObservabilityStoreUses,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT REMOVING OR DELETING A DATABASE TAKES WITH IT, SAID BEFORE IT HAPPENS
 * (#11147). A database is one row two products share, so each confirmation
 * lists what goes, a sentence a line, from what the server counted
 * (DataObservabilityStoreUses): Remove takes Data Observability's part,
 * Delete takes Data Security's too. Monitors are the Monitors product's:
 * they are kept, and the list says they stop getting data.
 */

// Why a change is refused, in the reader's words.
export const STORE_REFUSAL_SENTENCES: Readonly<
  Record<DataObservabilityStoreRefusal, string>
> = {
  [DataObservabilityStoreRefusal.NotPermitted]: translationKey(
    "Only someone who may connect databases to Data Observability can change or delete one.",
  ),
  [DataObservabilityStoreRefusal.DataSecuritySamplesIt]: translationKey(
    "Data Security samples this database's content with its connection, so only someone who may edit Data Security's data stores can change it. A Database Agent leaves that connection as it is.",
  ),
  [DataObservabilityStoreRefusal.DataSecurityReliesOnIt]: translationKey(
    "Data Security relies on this database, so only someone who may delete Data Security's data stores can delete it. You can remove it from Data Observability instead.",
  ),
};

/*
 * How Data Security came to list the database, when it found it itself: it
 * is found again at its next discovery while it still exists there.
 */
const FOUND_AGAIN_SENTENCES: Readonly<Record<string, string>> = {
  "Database product": translationKey(
    "Database Monitoring found it, so Data Security lists it again at its next discovery while it still exists.",
  ),
  "Cloud inventory": translationKey(
    "Your cloud account holds it, so Data Security lists it again at its next discovery while it still exists.",
  ),
  "Cloud read": translationKey(
    "Your cloud account holds it, so Data Security lists it again at its next discovery while it still exists.",
  ),
  "Service map": translationKey(
    "Your traces call it, so Data Security lists it again at its next discovery while your services still use it.",
  ),
};

// What Data Observability keeps of the database: Remove and Delete both take it.
function getDataObservabilitySentences(
  uses: DataObservabilityStoreUses,
  translator: Translator,
): Array<string> {
  const sentences: Array<string> = [];

  if (uses.tableCount > 0) {
    sentences.push(
      translator.translatePlural(
        {
          one: "{{count}} table, with its history and schema changes",
          other: "{{count}} tables, with their history and schema changes",
        },
        uses.tableCount,
      ),
    );
  }

  if (uses.checkCount > 0) {
    sentences.push(
      translator.translatePlural(
        {
          one: "{{count}} data check, with its history",
          other: "{{count}} data checks, with their history",
        },
        uses.checkCount,
      ),
    );
  }

  if (uses.monitorCount > 0) {
    sentences.push(
      translator.translatePlural(
        {
          one: "{{count}} monitor watches it: it is kept, and stops getting data. Delete it in Monitors.",
          other:
            "{{count}} monitors watch it: they are kept, and stop getting data. Delete them in Monitors.",
        },
        uses.monitorCount,
      ),
    );
  }

  return sentences;
}

// What Remove from Data Observability takes, and what Data Security keeps.
export function getRemoveImpactSentences(
  settings: DataObservabilityStoreSettings,
  translator: Translator,
): Array<string> {
  return [
    ...getDataObservabilitySentences(settings.uses, translator),
    translator.translateText(
      "Data Security keeps the database, its connection and what its scans found.",
    ) || "",
  ];
}

// What Delete Database takes from both products.
export function getDeleteImpactSentences(
  settings: DataObservabilityStoreSettings,
  translator: Translator,
): Array<string> {
  const uses: DataObservabilityStoreUses = settings.uses;
  const sentences: Array<string> = [
    ...getDataObservabilitySentences(uses, translator),
  ];

  if (uses.findingCount > 0) {
    sentences.push(
      translator.translatePlural(
        {
          one: "{{count}} sensitive data finding of Data Security",
          other: "{{count}} sensitive data findings of Data Security",
        },
        uses.findingCount,
      ),
    );
  }

  if (uses.issueCount > 0) {
    sentences.push(
      translator.translatePlural(
        {
          one: "{{count}} Data Security issue, with its history",
          other: "{{count}} Data Security issues, with their history",
        },
        uses.issueCount,
      ),
    );
  }

  if (uses.scanCount > 0) {
    sentences.push(
      translator.translatePlural(
        {
          one: "{{count}} Data Security scan",
          other: "{{count}} Data Security scans",
        },
        uses.scanCount,
      ),
    );
  }

  if (uses.ownerCount > 0) {
    sentences.push(
      translator.translatePlural(
        {
          one: "{{count}} owner named in Data Security",
          other: "{{count}} owners named in Data Security",
        },
        uses.ownerCount,
      ),
    );
  }

  if (uses.hasRecordOfProcessing) {
    sentences.push(
      translator.translateText("Its record of processing in Data Security") ||
        "",
    );
  }

  if (uses.isContentScanned) {
    sentences.push(
      translator.translateText(
        "Its connection, which Data Security samples its content with",
      ) || "",
    );
  } else {
    sentences.push(translator.translateText("Its saved connection") || "");
  }

  const foundAgain: string | undefined = uses.foundFrom
    ? FOUND_AGAIN_SENTENCES[uses.foundFrom]
    : undefined;

  if (foundAgain) {
    sentences.push(translator.translateText(foundAgain) || "");
  }

  return sentences;
}
