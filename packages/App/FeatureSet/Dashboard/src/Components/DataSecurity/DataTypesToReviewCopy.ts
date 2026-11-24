import { formatReaderFigure } from "Common/Types/DateLanguage";
import {
  DataTypeProof,
  getElsewhereMatchShare,
  getGroupMatchShare,
  getSharePercent,
  SharePercent,
} from "Common/Utils/DataSecurity/DataTypeProposal";
import {
  ComposedValue,
  composedValue,
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF DATA TYPES TO REVIEW AND OF DESCRIBE IT (#10371), each an
 * English key the page translates, and the sentences built from a
 * proposal's numbers - in the reader's language, each figure in the
 * sentence's own. React-free, so a plain test pins every word.
 */

export const DataTypesToReviewCopy: {
  cardTitle: string;
  cardDescription: string;
  found: string;
  fields: PluralTemplate;
  stores: PluralTemplate;
  proof: PluralTemplate;
  proofNothingElsewhere: PluralTemplate;
  partlyCounted: string;
  narrowed: string;
  alsoIn: PluralTemplate;
  showFields: string;
  hideFields: string;
  fieldShare: string;
  notScanned: string;
  pattern: string;
  add: string;
  notADataType: string;
  notADataTypeTitle: string;
  notADataTypeDescription: string;
  notADataTypeReason: string;
  notProposedAgain: string;
  addedButNotClosed: string;
  proving: PluralTemplate;
  lessThan: string;
} = {
  cardTitle: translationKey("Data Types to Review"),
  cardDescription: translationKey(
    "OneUptime AI found these in fields no detector could place, and counted each on your stores' next scans before asking you.",
  ),
  found: translationKey(
    "OneUptime AI found a data type your stores keep: {{name}}, in {{fields}} of {{stores}}.",
  ),
  fields: {
    one: translationKey("{{count}} field"),
    other: translationKey("{{count}} fields"),
  },
  stores: {
    one: translationKey("{{count}} store"),
    other: translationKey("{{count}} stores"),
  },
  proof: {
    one: translationKey(
      "Matches {{share}} of the values in this field, and {{elsewhere}} of values elsewhere in the same stores.",
    ),
    other: translationKey(
      "Matches {{share}} of the values in these {{count}} fields, and {{elsewhere}} of values elsewhere in the same stores.",
    ),
  },
  proofNothingElsewhere: {
    one: translationKey("Matches {{share}} of the values in this field."),
    other: translationKey(
      "Matches {{share}} of the values in these {{count}} fields.",
    ),
  },
  partlyCounted: translationKey(
    "Counted on the scans of {{counted}} of its {{total}} stores: the others were not scanned in time.",
  ),
  narrowed: translationKey(
    "As first drafted it matched too much elsewhere, so outside these fields it counts a value only beside one of its keywords.",
  ),
  alsoIn: {
    one: translationKey(
      "It also matches nearly every value of {{count}} more field, which may hold the same data under another name.",
    ),
    other: translationKey(
      "It also matches nearly every value of {{count}} more fields, which may hold the same data under another name.",
    ),
  },
  showFields: translationKey("Show the fields"),
  hideFields: translationKey("Hide the fields"),
  fieldShare: translationKey("{{share}} of its values"),
  notScanned: translationKey("Not scanned in time"),
  pattern: translationKey("Pattern"),
  add: translationKey("Add Data Type"),
  notADataType: translationKey("Not a Data Type"),
  notADataTypeTitle: translationKey("Not a Data Type"),
  notADataTypeDescription: translationKey(
    "OneUptime AI will not propose {{name}} for these fields again. Nothing else changes.",
  ),
  // Kept with the proposal, in the project's record of what was decided.
  notADataTypeReason: translationKey("Not a data type."),
  notProposedAgain: translationKey("{{name}} will not be proposed again."),
  addedButNotClosed: translationKey(
    "The data type was added, but OneUptime AI's proposal could not be closed: {{error}}",
  ),
  proving: {
    one: translationKey(
      "OneUptime AI is checking {{count}} more data type on your stores' next scans.",
    ),
    other: translationKey(
      "OneUptime AI is checking {{count}} more data types on your stores' next scans.",
    ),
  },
  lessThan: translationKey("less than {{share}}"),
};

export const DescribeDataTypeCopy: {
  title: string;
  description: string;
  sentenceLabel: string;
  sentencePlaceholder: string;
  examplesLabel: string;
  examplesHelp: string;
  examplesPlaceholder: string;
  fill: string;
  filled: string;
  filledFinds: PluralTemplate;
  filledNoExamples: string;
} = {
  title: translationKey("Describe It"),
  description: translationKey(
    "Say what the data looks like, and OneUptime AI fills in the form for you to test and save.",
  ),
  sentenceLabel: translationKey("What does this data look like?"),
  sentencePlaceholder: translationKey(
    "Our employee IDs look like EMP-123456, sometimes without the dash.",
  ),
  examplesLabel: translationKey("Examples (Optional)"),
  examplesHelp: translationKey(
    "One per line. They stay in your browser: only their shapes, such as AAA-999999, are sent.",
  ),
  examplesPlaceholder: translationKey("EMP-482913"),
  fill: translationKey("Fill In the Form"),
  filled: translationKey(
    "OneUptime AI filled in the form. Read it, and test it before you save.",
  ),
  filledFinds: {
    one: translationKey(
      "OneUptime AI filled in the form. Its pattern finds {{found}} of your {{count}} example: see Test It.",
    ),
    other: translationKey(
      "OneUptime AI filled in the form. Its pattern finds {{found}} of your {{count}} examples: see Test It.",
    ),
  },
  filledNoExamples: translationKey(
    "OneUptime AI filled in the form. Paste some text into Test It to see what it finds.",
  ),
};

/*
 * A share as a sentence says it, in the sentence's language: "98%",
 * "0.1%", "less than 0.1%" - "98 %" and "0,1 %" in German.
 */
export function shareInSentence(value: number): ComposedValue {
  return composedValue((sentence: Translator): string => {
    const share: SharePercent = getSharePercent(value);
    const figure: string = formatReaderFigure(share.percent, {
      decimals: share.percent < 10 && share.percent % 1 !== 0 ? 1 : 0,
      isPercent: true,
      dropTrailingZeros: true,
      language: sentence.language,
    });

    return share.isLessThan
      ? sentence.translateTemplate(DataTypesToReviewCopy.lessThan, {
          share: figure,
        })
      : figure;
  });
}

// A count of fields or stores, as a sentence says it.
export function countInSentence(
  template: PluralTemplate,
  count: number,
): ComposedValue {
  return composedValue((sentence: Translator): string => {
    return sentence.translatePlural(template, count);
  });
}

// What a proof's numbers say, in the reader's language.
export function getProofSentence(
  translator: Translator,
  proof: DataTypeProof,
): string {
  const count: number = Math.max(1, proof.fieldsCounted);

  if (proof.elsewhereValues === 0) {
    return translator.translatePlural(
      DataTypesToReviewCopy.proofNothingElsewhere,
      count,
      { share: shareInSentence(getGroupMatchShare(proof)) },
    );
  }

  return translator.translatePlural(DataTypesToReviewCopy.proof, count, {
    share: shareInSentence(getGroupMatchShare(proof)),
    elsewhere: shareInSentence(getElsewhereMatchShare(proof)),
  });
}

// Said only when some of its stores were not scanned in time.
export function getPartlyCountedSentence(
  translator: Translator,
  proof: DataTypeProof,
): string {
  if (proof.storesCounted >= proof.storesInGroup) {
    return "";
  }

  return translator.translateTemplate(DataTypesToReviewCopy.partlyCounted, {
    counted: translator.formatNumber(proof.storesCounted),
    total: translator.formatNumber(proof.storesInGroup),
  });
}
