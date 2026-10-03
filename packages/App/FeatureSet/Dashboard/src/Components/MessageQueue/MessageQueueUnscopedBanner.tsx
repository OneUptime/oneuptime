import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  Translator,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * What a queue's Overview, Traces and Metrics tabs show instead of their
 * data when the queue has no telemetry scope: its identifier does not parse
 * (or there is no project to hash the key with), so there is no queue key.
 * No viewer is mounted and no query is sent — an unscoped viewer would show
 * the whole project's telemetry as this queue's. Every row discovery or the
 * create form writes has a valid identifier, so this is a defensive state.
 */

export interface ComponentProps {
  // "traces", "metrics"; the telemetry the page would have shown.
  signal?: string | undefined;
}

export const MESSAGE_QUEUE_UNSCOPED_TITLE: string = "No telemetry scope";

// Whole sentences per signal, so a locale words each one its own way.
const UNSCOPED_DESCRIPTIONS: Record<string, string> = {
  telemetry: translationKey(
    "This queue's identifier could not be read, so no telemetry can be matched to it.",
  ),
  traces: translationKey(
    "This queue's identifier could not be read, so no traces can be matched to it.",
  ),
  metrics: translationKey(
    "This queue's identifier could not be read, so no metrics can be matched to it.",
  ),
};

/**
 * The card's description for a signal ("traces", "metrics"): an English
 * translation key the card translates, or, for any other signal, the
 * sentence already in the reader's language.
 */
export function getMessageQueueUnscopedDescription(
  signal?: string | undefined,
): string {
  const what: string = signal || "telemetry";
  return (
    UNSCOPED_DESCRIPTIONS[what] ||
    translateTemplate(
      "This queue's identifier could not be read, so no {{signal}} can be matched to it.",
      { signal: what },
    )
  );
}

const MessageQueueUnscopedBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Card
      title={MESSAGE_QUEUE_UNSCOPED_TITLE}
      description={getMessageQueueUnscopedDescription(props.signal)}
    >
      <div
        data-testid="message-queue-unscoped-banner"
        className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50 ring-1 ring-inset ring-indigo-200">
            <Icon
              icon={IconProp.QueueList}
              className="h-4 w-4 text-indigo-600"
            />
          </div>
          <p className="min-w-0 text-sm text-gray-700">
            {translator.translateText(
              "A queue's spans and broker metrics are matched by its messaging system and destination, which ingest turns into one key per queue. Delete this queue and let discovery find it again, or create it again with its system and destination.",
            )}
          </p>
        </div>
      </div>
    </Card>
  );
};

export default MessageQueueUnscopedBanner;
