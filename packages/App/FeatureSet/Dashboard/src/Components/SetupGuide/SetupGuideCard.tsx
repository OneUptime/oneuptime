import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
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
  resolveSetupGuideOption,
} from "./SetupGuide";
import { getConfiguredOneUptimeUrl } from "./ConfiguredOneUptimeUrl";
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
 *   ├ inputs — "Cluster name", on an Add guide
 *   ├ 1. Choose an ingestion key   (always first: every guide needs one)
 *   ├ 2..n. the chosen option's steps
 *   ├ ▸ Advanced          (folded)
 *   └ ▸ Troubleshooting   (folded)
 *
 * The guide itself is data (SetupGuide.ts), rebuilt on every render from
 * the picked option and the picked key, so every command on screen already
 * carries the reader's OneUptime URL and ingestion key.
 */

/*
 * What a resource's guide card hands on to its SetupGuideCard, so an Add
 * guide (Components/ResourceOnboarding) can frame it: bare in a dialog,
 * with the name field above the steps and a live last step.
 */
export interface SetupGuideFrameProps {
  isBare?: boolean | undefined;
  inputs?: ReactNode | undefined;
  lastStep?: SetupGuideStepView | undefined;
}

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
   * A line under the options for a case none of them covers, drawn as
   * given (AddHostGuide: a Kubernetes cluster's nodes, and where to go).
   */
  optionsNote?: ReactNode | undefined;
  /*
   * The option to open on. A value the guide does not offer falls back to
   * the first option; a later valid value (a parent that learns the
   * resource's platform after mount) moves the picker to it.
   */
  initialOption?: string | null | undefined;
  onOptionChange?: ((option: string) => void) | undefined;

  /*
   * The kind of key an option's snippet works with: the key picker lists
   * only those, and makes them without asking. Server when left out, or
   * undefined for an option: an agent or a collector sends no Origin
   * header, so a Browser key is refused on every export. A browser snippet
   * must only ever be offered Browser keys.
   */
  getKeyTypeFilter?:
    | ((option: string | undefined) => TelemetryIngestionKeyType | undefined)
    | undefined;
  /*
   * What a key created from this guide is called until the reader renames
   * it: what the guide is for, translationKey("Kubernetes key"). Numbered
   * when the project already has a key of that name.
   */
  newKeyName: string;
  keyStepDescription?: string | undefined;

  getContent: (context: SetupGuideRenderContext) => SetupGuideContent;

  /*
   * What the reader types that the commands are written with, under the
   * option picker and above the steps (an Add guide's name field,
   * Components/ResourceOnboarding). Not a step of its own: the guides'
   * notes count the steps ("Pick an ingestion key in step 1").
   */
  inputs?: ReactNode | undefined;

  /*
   * A live step after the guide's own: what the reader waits for once the
   * commands have run (AddHostGuide: the host connecting). Drawn like every
   * step; its content is a component, not markdown.
   */
  lastStep?: SetupGuideStepView | undefined;

  /*
   * Only the guide, without its card and header: for a dialog whose own
   * title and description already say what the guide is for (Add Host).
   */
  isBare?: boolean | undefined;
}

/*
 * The first step of every guide, in the reader's language. The docs'
 * Ingestion Keys page names it (TelemetryAdminDocsFacts reads it here).
 */
export const SETUP_GUIDE_KEY_STEP_TITLE: string = translationKey(
  "Choose an ingestion key",
);

const DEFAULT_KEY_STEP_DESCRIPTION: string = translationKey(
  "The agent sends data to your project with this key. Pick an existing key or create a new one — the commands below update to use it.",
);

// The first topics' titles, already in the reader's language, and how many more.
const summarizeTopics: (
  topics: Array<{ title: string }>,
  translator: Translator,
) => string = (
  topics: Array<{ title: string }>,
  translator: Translator,
): string => {
  const titles: Array<string> = topics.map((topic: { title: string }) => {
    return topic.title;
  });
  const shown: Array<string> = titles.slice(0, 3);
  const remaining: number = titles.length - shown.length;
  return remaining > 0
    ? `${shown.join(" · ")} · ${translator.translateTemplate("{{count}} more", {
        count: translator.formatNumber(remaining),
      })}`
    : shown.join(" · ");
};

const SetupGuideCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Everything a guide says is English, as written in its data; what the
   * card draws is looked up in the reader's language. Commands and the
   * markdown of steps and topics stay as written.
   */
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
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

  // The OneUptime the reader uses: what ONEUPTIME_URL and every download name.
  const oneuptimeUrl: string = getConfiguredOneUptimeUrl();

  const secret: string = selectedKey?.secretKey?.toString() || "";
  const apiKey: string = secret || SETUP_GUIDE_API_KEY_PLACEHOLDER;

  const content: SetupGuideContent = props.getContent({
    oneuptimeUrl: oneuptimeUrl,
    apiKey: apiKey,
    option: option,
    hasApiKey: Boolean(secret),
  });

  const keyTypeFilter: TelemetryIngestionKeyType =
    props.getKeyTypeFilter?.(option) || TelemetryIngestionKeyType.Server;

  const keyStep: SetupGuideKeyStep = content.keyStep || {};
  const wrapLongLines: boolean = Boolean(content.wrapLongLines);

  const steps: Array<SetupGuideStepView> = [
    {
      title: translate(SETUP_GUIDE_KEY_STEP_TITLE),
      description: translate(
        keyStep.description ||
          props.keyStepDescription ||
          DEFAULT_KEY_STEP_DESCRIPTION,
      ),
      content: (
        <IngestionKeySelector
          endpointLabel={
            keyStep.endpointLabel || translationKey("OneUptime URL")
          }
          endpointValue={keyStep.endpointValue || oneuptimeUrl}
          endpointHint={keyStep.endpointHint}
          keyTypeFilter={keyTypeFilter}
          newKeyName={props.newKeyName}
          onSelectedKeyChange={setSelectedKey}
          hideValues={keyStep.hideValues}
        />
      ),
    },
    ...content.steps.map((step: SetupGuideStep): SetupGuideStepView => {
      return {
        title: translate(step.title),
        description: step.description ? translate(step.description) : undefined,
        content: (
          <div className="space-y-3">
            {step.markdown && (
              <SetupGuideMarkdown
                text={step.markdown}
                wrapLongLines={wrapLongLines}
              />
            )}
            {step.variants && step.variants.length > 0 && (
              <SetupGuideStepVariants
                selectedLabels={pickedVariants}
                onSelectLabel={onSelectVariant}
                variants={step.variants.map(
                  (
                    variant: SetupGuideStepVariant,
                  ): SetupGuideStepVariantView => {
                    return {
                      label: translate(variant.label),
                      content: (
                        <SetupGuideMarkdown
                          text={variant.markdown}
                          wrapLongLines={wrapLongLines}
                        />
                      ),
                    };
                  },
                )}
              />
            )}
            {step.note && (
              <div data-testid="setup-guide-step-note">
                <SetupGuideMarkdown text={translate(step.note)} />
              </div>
            )}
            {/*
             * The rest of a step whose note is about its command: the note
             * stays right under the command it is about.
             */}
            {step.details && (
              <div data-testid="setup-guide-step-details">
                <SetupGuideMarkdown
                  text={step.details}
                  wrapLongLines={wrapLongLines}
                />
              </div>
            )}
          </div>
        ),
      };
    }),
    ...(props.lastStep ? [props.lastStep] : []),
  ];

  const toTopicView: (topic: SetupGuideTopic) => SetupGuideTopicView = (
    topic: SetupGuideTopic,
  ): SetupGuideTopicView => {
    return {
      title: translate(topic.title),
      summary: topic.summary ? translate(topic.summary) : undefined,
      content: (
        <SetupGuideMarkdown
          text={topic.markdown}
          wrapLongLines={wrapLongLines}
        />
      ),
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

  // The picker's choices as the reader reads them; their keys stay.
  const shownOptions: Array<SetupGuideOption> = options.map(
    (item: SetupGuideOption): SetupGuideOption => {
      return {
        ...item,
        label: translate(item.label),
        description: item.description ? translate(item.description) : undefined,
        badge: item.badge ? translate(item.badge) : undefined,
        group: item.group ? translate(item.group) : undefined,
      };
    },
  );

  const body: ReactElement = (
    <>
      {options.length > 1 && (
        <SetupGuideOptionPicker
          label={translate(props.optionsLabel || "Choose an option")}
          options={shownOptions}
          selectedKey={option}
          onSelect={onSelectOption}
          layout={props.optionsLayout}
          note={props.optionsNote}
        />
      )}

      {props.inputs}

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
            <Icon icon={IconProp.ClipboardDocumentCheck} className="h-4 w-4" />
            {translator.translateText("Before you start")}
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
            title={translator.translateText("Advanced") || "Advanced"}
            description={summarizeTopics(advanced, translator)}
            icon={IconProp.AdjustmentHorizontal}
            topics={advanced}
            testId="setup-guide-advanced"
          />
          <SetupGuideTopics
            title={
              translator.translateText("Troubleshooting") || "Troubleshooting"
            }
            description={summarizeTopics(troubleshooting, translator)}
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
            {translator.translateText("Learn more:")}
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
                {translate(link.title)}
              </a>
            );
          })}
        </div>
      )}
    </>
  );

  if (props.isBare) {
    return <div data-testid="setup-guide">{body}</div>;
  }

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
                {translate(props.title)}
              </h2>
              <p className="mt-0.5 text-sm leading-relaxed text-gray-500">
                {translate(props.description)}
              </p>
            </div>
          </div>
        </div>

        <div className="px-4 py-6 sm:px-6">{body}</div>
      </div>
    </div>
  );
};

export default SetupGuideCard;
