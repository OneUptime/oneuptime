import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ResourceDocumentationCard from "../../../Components/TelemetryResource/ResourceDocumentationCard";
import { DocVars } from "../../../Components/TelemetryResource/documentationMarkdown";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  MessagingSystemDescriptor,
  getMessagingSystemDescriptor,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  getMessageQueueGuideSystems,
  getMessageQueueSystemGuideMarkdown,
} from "./DocumentationMarkdown";

/*
 * The "Connect a messaging system" guide, with a system picker.
 *
 * Contract used by Pages/MessageQueue/Documentation.tsx (the product's
 * install guide) and Pages/MessageQueue/MessageQueues.tsx (the empty list):
 *
 *   - `initialSystem` pre-selects the picker; an unknown or missing value
 *     (a long-tail broker, a typo) falls back to Apache Kafka.
 *   - The rendered guide is per system: what traces its clients, where the
 *     broker's health metrics come from and the collector (or scraper)
 *     configuration that sends them, and what a queue page charts — with the
 *     viewer's OneUptime URL and the ingestion key picked in the card.
 *
 * The options come from the messaging-system catalog, so the picker can only
 * offer a system OneUptime knows, and a system added to the catalog is
 * offered here without touching this file. A queue's own Documentation tab
 * does not use it: a queue's system is fixed, so that tab renders the
 * queue's guide directly.
 */
export interface ComponentProps {
  title: string;
  description: string;
  initialSystem?: string | undefined;
}

export const DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM: string = "kafka";

const SYSTEM_OPTIONS: Array<DropdownOption> = getMessageQueueGuideSystems().map(
  (descriptor: MessagingSystemDescriptor): DropdownOption => {
    return {
      value: descriptor.system,
      label: descriptor.displayName,
      description: `messaging.system: ${descriptor.system}`,
    };
  },
);

/*
 * The canonical system for a candidate (aliases accepted), or the default
 * one — never a value the catalog does not know, which would render a guide
 * with nothing system-specific in it.
 */
export function resolveMessageQueueGuideSystem(
  candidate: string | null | undefined,
): string {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(candidate);
  return descriptor ? descriptor.system : DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM;
}

const MessageQueueDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [system, setSystem] = useState<string>(
    resolveMessageQueueGuideSystem(props.initialSystem),
  );

  /*
   * A parent that learns the system later moves the picker with it, but a
   * choice the reader already made is never overridden by an unknown value.
   */
  useEffect(() => {
    if (getMessagingSystemDescriptor(props.initialSystem)) {
      setSystem(resolveMessageQueueGuideSystem(props.initialSystem));
    }
  }, [props.initialSystem]);

  const selectedOption: DropdownOption | undefined = SYSTEM_OPTIONS.find(
    (option: DropdownOption): boolean => {
      return option.value === system;
    },
  );

  const buildMarkdown: (vars: DocVars) => string = (vars: DocVars): string => {
    return getMessageQueueSystemGuideMarkdown(vars, system);
  };

  return (
    <div>
      <div className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Messaging system
        </label>
        <Dropdown
          options={SYSTEM_OPTIONS}
          value={selectedOption}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (
              typeof value === "string" &&
              getMessagingSystemDescriptor(value)
            ) {
              setSystem(resolveMessageQueueGuideSystem(value));
            }
          }}
          placeholder="Select a messaging system"
          ariaLabel="Select messaging system"
          dataTestId="message-queue-system-picker"
        />
        <p className="mt-2 text-xs text-gray-500">
          The guide below is specific to the selected system: what traces its
          clients, where its broker health metrics come from, and the collector
          configuration that sends them to OneUptime.
        </p>
      </div>
      <ResourceDocumentationCard
        title={props.title}
        description={props.description}
        buildMarkdown={buildMarkdown}
      />
    </div>
  );
};

export default MessageQueueDocumentationCard;
