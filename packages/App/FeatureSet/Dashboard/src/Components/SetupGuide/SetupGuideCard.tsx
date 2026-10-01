import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Protocol from "Common/Types/API/Protocol";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import useTranslateValue from "Common/UI/Utils/Translation";
import IngestionKeySelector from "../Telemetry/IngestionKeySelector";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideKeyStep,
  SetupGuideLink,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  SetupGuideVariables,
  getSetupGuideOneUptimeUrl,
  resolveSetupGuideOption,
} from "./SetupGuide";
import SetupGuideOptionPicker, {
  SetupGuideOptionLayout,
} from "./SetupGuideOptionPicker";
import SetupGuideSteps, {
  SetupGuideStepVariantView,
  SetupGuideStepVariants,
  SetupGuideStepView,
} from "./SetupGuideSteps";
import SetupGuideTopics, { SetupGuideTopicView } from "./SetupGuideTopics";
import SetupGuideMarkdown from "./SetupGuideMarkdown";

/*
 * Every in-app "connect this resource" guide: Kubernetes, Docker, Podman,
 * Docker Swarm, Ceph, Proxmox, VMware, hosts, IoT, databases, cloud
 * environments, serverless functions, RUM applications and message queues.
 *
 *   ┌ title and description
 *   ├ option picker — "Where is your cluster running?"
 *   ├ 1. Choose an ingestion key   (always first: every guide needs one)
 *   ├ 2..n. the chosen option's steps
 *   ├ ▸ Advanced          (folded)
 *   └ ▸ Troubleshooting   (folded)
 *
 * The guide itself is data (SetupGuide.ts), rebuilt on every render from
 * the picked option and the picked key, so every command on screen already
 * carries the reader's OneUptime URL and ingestion key.
 */

export interface SetupGuideRenderContext extends SetupGuideVariables {
  // The picked option's key; undefined when the guide offers no options.
  option: string | undefined;
  // False while no key is picked and `apiKey` is the placeholder.
  hasApiKey: boolean;
}

export interface ComponentProps {
  title: string;
  description: string;
  icon?: IconProp | undefined;

  // "Where is your cluster running?" — omit when there is only one way.
  optionsLabel?: string | undefined;
  options?: ReadonlyArray<SetupGuideOption> | undefined;
  optionsLayout?: SetupGuideOptionLayout | undefined;
  /*
   * The option to open on. A value the guide does not offer falls back to
   * the first option; a later valid value (a parent that learns the
   * resource's platform after mount) moves the picker to it.
   */
  initialOption?: string | null | undefined;
  onOptionChange?: ((option: string) => void) | undefined;

  /*
   * Narrow the key picker to one kind of key for an option — a browser
   * snippet must only ever be offered Browser keys.
   */
  getKeyTypeFilter?:
    | ((option: string | undefined) => TelemetryIngestionKeyType | undefined)
    | undefined;
  keyStepDescription?: string | undefined;

  getContent: (context: SetupGuideRenderContext) => SetupGuideContent;
}

const DEFAULT_KEY_STEP_DESCRIPTION: string =
  "The agent sends data to your project with this key. Pick an existing key or create a new one — the commands below update to use it.";

const summarizeTopics: (topics: Array<{ title: string }>) => string = (
  topics: Array<{ title: string }>,
): string => {
  const titles: Array<string> = topics.map((topic: { title: string }) => {
    return topic.title;
  });
  const shown: Array<string> = titles.slice(0, 3);
  const remaining: number = titles.length - shown.length;
  return remaining > 0
    ? `${shown.join(" · ")} · ${remaining} more`
    : shown.join(" · ");
};

const SetupGuideCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const options: ReadonlyArray<SetupGuideOption> = props.options || [];

  const [pickedOption, setPickedOption] = useState<string | undefined>(
    resolveSetupGuideOption(options, props.initialOption),
  );
  const [selectedKey, setSelectedKey] = useState<TelemetryIngestionKey | null>(
    null,
  );
  /*
   * Every tab label the reader has picked in any step, most recent first.
   * Steps that offer a tab with one of these labels show it too, so
   * "Docker Compose" or "Sidecar collector" is picked once for the whole
   * guide.
   */
  const [pickedVariants, setPickedVariants] = useState<Array<string>>([]);

  const onSelectVariant: (label: string) => void = (label: string): void => {
    setPickedVariants((current: Array<string>): Array<string> => {
      return [
        label,
        ...current.filter((item: string): boolean => {
          return item !== label;
        }),
      ];
    });
  };

  useEffect(() => {
    const isOffered: boolean = options.some(
      (option: SetupGuideOption): boolean => {
        return option.key === props.initialOption;
      },
    );
    if (isOffered) {
      setPickedOption(props.initialOption as string);
    }
  }, [props.initialOption]);

  // An option list that no longer has the pick falls back to its first.
  const option: string | undefined = resolveSetupGuideOption(
    options,
    pickedOption,
  );

  const onSelectOption: (key: string) => void = (key: string): void => {
    setPickedOption(key);
    if (props.onOptionChange) {
      props.onOptionChange(key);
    }
  };

  const oneuptimeUrl: string = getSetupGuideOneUptimeUrl({
    host: HOST,
    isHttps: HTTP_PROTOCOL === Protocol.HTTPS,
  });

  const secret: string = selectedKey?.secretKey?.toString() || "";
  const apiKey: string = secret || SETUP_GUIDE_API_KEY_PLACEHOLDER;

  const content: SetupGuideContent = props.getContent({
    oneuptimeUrl: oneuptimeUrl,
    apiKey: apiKey,
    option: option,
    hasApiKey: Boolean(secret),
  });

  const keyTypeFilter: TelemetryIngestionKeyType | undefined =
    props.getKeyTypeFilter ? props.getKeyTypeFilter(option) : undefined;

  const keyStep: SetupGuideKeyStep = content.keyStep || {};

  const steps: Array<SetupGuideStepView> = [
    {
      title: "Choose an ingestion key",
      description:
        keyStep.description ||
        props.keyStepDescription ||
        DEFAULT_KEY_STEP_DESCRIPTION,
      content: (
        <IngestionKeySelector
          endpointLabel={keyStep.endpointLabel || "OneUptime URL"}
          endpointValue={keyStep.endpointValue || oneuptimeUrl}
          endpointHint={keyStep.endpointHint}
          keyTypeFilter={keyTypeFilter}
          onSelectedKeyChange={setSelectedKey}
        />
      ),
    },
    ...content.steps.map((step: SetupGuideStep): SetupGuideStepView => {
      return {
        title: step.title,
        description: step.description,
        content: (
          <div className="space-y-3">
            {step.markdown && <SetupGuideMarkdown text={step.markdown} />}
            {step.variants && step.variants.length > 0 && (
              <SetupGuideStepVariants
                selectedLabels={pickedVariants}
                onSelectLabel={onSelectVariant}
                variants={step.variants.map(
                  (
                    variant: SetupGuideStepVariant,
                  ): SetupGuideStepVariantView => {
                    return {
                      label: variant.label,
                      content: <SetupGuideMarkdown text={variant.markdown} />,
                    };
                  },
                )}
              />
            )}
          </div>
        ),
      };
    }),
  ];

  const toTopicView: (topic: SetupGuideTopic) => SetupGuideTopicView = (
    topic: SetupGuideTopic,
  ): SetupGuideTopicView => {
    return {
      title: topic.title,
      summary: topic.summary,
      content: <SetupGuideMarkdown text={topic.markdown} />,
    };
  };

  const advanced: Array<SetupGuideTopicView> = (content.advanced || []).map(
    toTopicView,
  );
  const troubleshooting: Array<SetupGuideTopicView> = (
    content.troubleshooting || []
  ).map(toTopicView);
  const links: Array<SetupGuideLink> = content.links || [];
  const prerequisites: Array<string> = content.prerequisites || [];

  return (
    <div className="mb-5" data-testid="setup-guide">
      <div className="overflow-visible rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-5 sm:px-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50">
              <Icon
                icon={props.icon || IconProp.BookOpen}
                className="h-5 w-5 text-indigo-600"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {translateString(props.title)}
              </h2>
              <p className="mt-0.5 text-sm leading-relaxed text-gray-500">
                {translateString(props.description)}
              </p>
            </div>
          </div>
        </div>

        <div className="px-4 py-6 sm:px-6">
          {options.length > 1 && (
            <SetupGuideOptionPicker
              label={props.optionsLabel || "Choose an option"}
              options={options}
              selectedKey={option}
              onSelect={onSelectOption}
              layout={props.optionsLayout}
            />
          )}

          {content.intro && (
            <div className="mb-6">
              <SetupGuideMarkdown text={content.intro} />
            </div>
          )}

          {prerequisites.length > 0 && (
            <div
              className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
              data-testid="setup-guide-prerequisites"
            >
              <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                <Icon
                  icon={IconProp.ClipboardDocumentCheck}
                  className="h-4 w-4"
                />
                Before you start
              </div>
              <SetupGuideMarkdown
                text={prerequisites
                  .map((line: string): string => {
                    return `- ${line}`;
                  })
                  .join("\n")}
              />
            </div>
          )}

          <SetupGuideSteps steps={steps} />

          {(advanced.length > 0 || troubleshooting.length > 0) && (
            <div className="mt-8 space-y-3">
              <SetupGuideTopics
                title="Advanced"
                description={summarizeTopics(advanced)}
                icon={IconProp.AdjustmentHorizontal}
                topics={advanced}
                testId="setup-guide-advanced"
              />
              <SetupGuideTopics
                title="Troubleshooting"
                description={summarizeTopics(troubleshooting)}
                icon={IconProp.Lifebuoy}
                topics={troubleshooting}
                testId="setup-guide-troubleshooting"
              />
            </div>
          )}

          {links.length > 0 && (
            <div
              className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500"
              data-testid="setup-guide-links"
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon icon={IconProp.BookOpen} className="h-4 w-4" />
                Learn more:
              </span>
              {links.map((link: SetupGuideLink) => {
                return (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                  >
                    {link.title}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SetupGuideCard;
