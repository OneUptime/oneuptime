import {
  getRetentionFoldedItems,
  RETENTION_DAYS,
  TelemetryRetentionFoldState,
  TelemetryRetentionFoldStateHandler,
} from "./TelemetryRetentionFold";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { useState } from "react";

/*
 * What a page's folded More settings says of the retention cards in it
 * (TelemetryRetentionFold): the cards tell it what they hold
 * (onRetentionChange), and it names them, each with what it overrides.
 */
export interface RetentionFold {
  items: Array<FoldedSectionItem>;
  onRetentionChange: TelemetryRetentionFoldStateHandler;
}

const useRetentionFold: (options: {
  /*
   * Whether the Enterprise cards are drawn - the decision the Enterprise
   * door makes (EnterprisePluginPage): the project may set overrides, and
   * the build includes them.
   */
  isEnterpriseCardDrawn: boolean;
  // A resource has its own retention; the project only its retention by type.
  hasOwnRetention: boolean;
}) => RetentionFold = (options: {
  isEnterpriseCardDrawn: boolean;
  hasOwnRetention: boolean;
}): RetentionFold => {
  const translator: Translator = useTranslator();

  // What the retention cards hold, as each one says: nothing known yet.
  const [retention, setRetention] = useState<TelemetryRetentionFoldState>({});

  return {
    items: getRetentionFoldedItems({
      state: retention,
      isEnterpriseCardDrawn: options.isEnterpriseCardDrawn,
      hasOwnRetention: options.hasOwnRetention,
      formatDays: (days: number): string => {
        return translator.translatePlural(RETENTION_DAYS, days);
      },
    }),
    onRetentionChange: (state: TelemetryRetentionFoldState): void => {
      setRetention(
        (current: TelemetryRetentionFoldState): TelemetryRetentionFoldState => {
          return { ...current, ...state };
        },
      );
    },
  };
};

export default useRetentionFold;
