import OneUptimeDate from "Common/Types/Date";
import {
  DataObservabilityCollector,
  DataObservabilityStoreSummary,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a database's collection says under its status pill. While a
 * collection someone asked for with Collect Now runs: that it runs, and
 * that the page shows how it went (a probe's, at its next check). Then
 * what the last collection said - why it failed, in the engine's own
 * words, or what it had to leave out - and, for one that failed, when it
 * last tried and that it tries again by itself, so a person who pressed
 * Collect Now after a failure sees it was tried (#9506).
 */

export interface ComponentProps {
  store: DataObservabilityStoreSummary;
  isCollecting: boolean;
  hasWaitedLong: boolean;
  // The size of its words: the store's own page, or a row of the Databases list.
  size: "normal" | "small";
}

const StoreCollectionMessage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { store } = props;
  const textSize: string = props.size === "small" ? "text-xs" : "text-sm";

  if (props.isCollecting) {
    return (
      <p className={`${textSize} text-gray-600`}>
        {store.collector === DataObservabilityCollector.Probe
          ? translator.translateTemplate(
              "Probe {{probe}} collects it at its next check, within five minutes. This page shows how it went.",
              { probe: store.probeName || "" },
            )
          : translator.translateText(
              "Collecting now. This page shows how it went when it ends.",
            )}
      </p>
    );
  }

  return (
    <>
      {store.message ? (
        <p
          className={`whitespace-pre-line ${textSize} ${
            store.status === "Failed" ? "text-red-600" : "text-amber-700"
          }`}
        >
          {store.message}
        </p>
      ) : (
        <></>
      )}
      {store.status === "Failed" && store.attemptedAt ? (
        <p className={`${textSize} text-gray-500`}>
          {/* Fifteen minutes is the server's FAILED_COLLECTION_RETRY_IN_MINUTES. */}
          {translator.translateTemplate(
            "Last tried {{time}}. OneUptime tries again every 15 minutes until it collects.",
            {
              time: OneUptimeDate.fromNow(
                OneUptimeDate.fromString(store.attemptedAt),
              ),
            },
          )}
        </p>
      ) : (
        <></>
      )}
      {props.hasWaitedLong ? (
        <p className={`${textSize} text-gray-600`}>
          {translator.translateText(
            "The collection is taking longer than usual. Come back in a few minutes to see how it went.",
          )}
        </p>
      ) : (
        <></>
      )}
    </>
  );
};

export default StoreCollectionMessage;
