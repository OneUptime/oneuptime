import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * A folded section at the bottom of a guide — "Advanced" or
 * "Troubleshooting". Closed by default, so a first install only ever shows
 * the steps it needs. Opening it lists its topics by title; each topic opens
 * on its own, so finding "Filter namespaces" does not mean scrolling past
 * every other option.
 */

// A topic as rendered: SetupGuideCard renders markdown topics into these.
export interface SetupGuideTopicView {
  title: string;
  summary?: string | undefined;
  content: ReactElement;
}

export interface ComponentProps {
  title: string;
  description: string;
  icon: IconProp;
  topics: Array<SetupGuideTopicView>;
  testId: string;
}

const SetupGuideTopics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const baseId: string = `setup-guide-topics-${useId()}`;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [openTopics, setOpenTopics] = useState<Array<string>>([]);

  const topicTitles: string = props.topics
    .map((topic: SetupGuideTopicView): string => {
      return topic.title;
    })
    .join("\n");

  /*
   * A different set of topics (another option picked above) starts folded:
   * an open topic that no longer exists would otherwise leave a stale id.
   */
  useEffect(() => {
    setOpenTopics([]);
  }, [topicTitles]);

  if (props.topics.length === 0) {
    return <></>;
  }

  const toggleTopic: (title: string) => void = (title: string): void => {
    setOpenTopics((current: Array<string>): Array<string> => {
      return current.includes(title)
        ? current.filter((item: string): boolean => {
            return item !== title;
          })
        : [...current, title];
    });
  };

  const topicCountLabel: string =
    props.topics.length === 1 ? "1 topic" : `${props.topics.length} topics`;

  return (
    <div
      className="overflow-hidden rounded-lg border border-gray-200"
      data-testid={props.testId}
    >
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
        aria-controls={`${baseId}-body`}
        className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        data-testid={`${props.testId}-toggle`}
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gray-100">
          <Icon icon={props.icon} className="h-4 w-4 text-gray-600" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">
            {props.title}
          </span>
          <span className="block truncate text-xs text-gray-500">
            {props.description}
          </span>
        </span>
        <span className="hidden flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 sm:inline-flex">
          {topicCountLabel}
        </span>
        <Icon
          icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="h-4 w-4 flex-shrink-0 text-gray-400"
        />
      </button>

      {isOpen && (
        <div
          id={`${baseId}-body`}
          className="divide-y divide-gray-100 border-t border-gray-200"
        >
          {props.topics.map((topic: SetupGuideTopicView, index: number) => {
            const isTopicOpen: boolean = openTopics.includes(topic.title);
            const topicBodyId: string = `${baseId}-topic-${index}`;

            return (
              <div key={topic.title} data-testid="setup-guide-topic">
                <button
                  type="button"
                  onClick={() => {
                    toggleTopic(topic.title);
                  }}
                  aria-expanded={isTopicOpen}
                  aria-controls={topicBodyId}
                  className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  <Icon
                    icon={
                      isTopicOpen ? IconProp.ChevronDown : IconProp.ChevronRight
                    }
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900">
                      {topic.title}
                    </span>
                    {topic.summary && !isTopicOpen && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">
                        {topic.summary}
                      </span>
                    )}
                  </span>
                </button>
                {isTopicOpen && (
                  <div id={topicBodyId} className="px-4 pb-4 sm:pl-11">
                    {topic.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SetupGuideTopics;
