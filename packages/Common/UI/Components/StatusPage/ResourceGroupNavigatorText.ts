import {
  createTranslator,
  getInlineSeparator,
  Translator,
} from "../../../Types/Translator";
import {
  StatusPageResourceCountIndex,
  StatusPageResourceNavigatorRow,
} from "../../../Utils/StatusPage/ResourceExplorer";

const ENGLISH: Translator = createTranslator(undefined);

/*
 * Under the pointer on a navigator row's count badge: "3 resources in this
 * group", and "· 100 including sub groups" when the group's sub groups hold
 * more than it does (the badge then shows "+100" or its own count). Nothing
 * while the counts are still being read. In the reader's language; English
 * without a translator.
 */
export const getNavigatorCountTooltip: (
  data: {
    row: Pick<
      StatusPageResourceNavigatorRow,
      "ownResourceCount" | "subtreeResourceCount"
    >;
    countIndex: Pick<StatusPageResourceCountIndex, "isComplete">;
  },
  translator?: Translator,
) => string | undefined = (
  data: {
    row: Pick<
      StatusPageResourceNavigatorRow,
      "ownResourceCount" | "subtreeResourceCount"
    >;
    countIndex: Pick<StatusPageResourceCountIndex, "isComplete">;
  },
  translator: Translator = ENGLISH,
): string | undefined => {
  if (!data.countIndex.isComplete) {
    return undefined;
  }

  const own: string = translator.translatePlural(
    {
      one: "{{count}} resource in this group",
      other: "{{count}} resources in this group",
    },
    data.row.ownResourceCount,
  );

  if (data.row.subtreeResourceCount === data.row.ownResourceCount) {
    return own;
  }

  return `${own}${getInlineSeparator(translator.language)}${translator.translatePlural(
    {
      one: "{{count}} including sub groups",
      other: "{{count}} including sub groups",
    },
    data.row.subtreeResourceCount,
  )}`;
};
