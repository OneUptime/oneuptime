import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import {
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import { AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE } from "Common/Types/CloudConnection/CloudStreamAzure";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import SetupGuideOptionPicker from "../../SetupGuide/SetupGuideOptionPicker";
import SetupGuideSteps, {
  SetupGuideStepView,
} from "../../SetupGuide/SetupGuideSteps";
import {
  CloudStreamStatus,
  cloudConnectionDocsUrl,
  startCloudStreaming,
} from "./CloudConnectApi";
import { CloudTemplate, drawCloudTemplate } from "./CloudConnectionWords";
import {
  AZURE_STREAM_DOCS_PATH,
  AZURE_STREAM_WHAT_OPTIONS,
  AzureStreamChoices,
  AzureStreamSetup,
  getAzureStreamSetup,
  getAzureStreamStartSubscriptions,
  getDefaultAzureStreamChoices,
} from "./CloudStreamAzureSetup";
import {
  CLOUD_STREAM_COMMAND_MAX_HEIGHT,
  CLOUD_STREAM_DIALOG_TEST_ID,
  CLOUD_STREAM_FIELD_BOX_CLASS_NAME,
  CLOUD_STREAM_INPUT_CLASS_NAME,
  CLOUD_STREAM_STEP_BUTTON_CLASS_NAME,
  CloudStreamCopyRow,
  CloudStreamLiveStep,
  CloudStreamNotice,
  CloudStreamShellLink,
  CloudStreamWatch,
  CloudStreamWhatItMakes,
  cloudStreamPart,
  getCloudStreamStatusOf,
  useCloudStreamWatch,
} from "./CloudStreamParts";
import { CloudStreamWhat } from "./CloudStreamSetup";
import {
  CloudStreamStatusWords,
  getCloudStreamSourceWords,
  getCloudStreamStatusWords,
} from "./CloudStreamWords";

/*
 * Stream metrics and logs, for an Azure connection - laid out as AWS's
 * is: the one question on top - what to stream - then numbered steps:
 *
 *   1. turn reading on: OneUptime reads the event hubs the command makes
 *      every minute, as the connection's app - and waits for them until
 *      they are there. Reading is for the event hubs of one subscription,
 *      the first the command lists, so a dialog opened while reading is on
 *      starts on that one: when the first changes, the step says so and
 *      reads them there instead;
 *   2. one command for Azure Cloud Shell (CloudStreamAzure): an Event Hubs
 *      namespace in each region, in a resource group of its own, the
 *      app's read role on that group alone, and a diagnostic setting on
 *      each resource;
 *   3. the first events, asked for every few seconds: what arrived, from
 *      where, or why the event hubs could not be read.
 *
 * Azure Monitor sends only to an event hub, a storage account or a Log
 * Analytics workspace: an event hub OneUptime reads is the way that needs
 * nothing of yours to run. The subscriptions, and the names for setting it
 * up another way, are folded under More fields - unless the connection has
 * read no subscription yet: then nothing can be turned on or run without
 * them, and the dialog asks for them under its question instead. Stopping
 * is the connections list's own action.
 */

export interface ComponentProps {
  connection: CloudConnection;
  onClose: () => void;
  // Reading was turned on: the list reads its connections again.
  onChanged: () => void;
}

const FALLBACK_SHELL: { title: string; url: string } = {
  title: "Azure Cloud Shell",
  url: "https://shell.azure.com",
};

const CloudStreamAzureDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // An English sentence of the dialog, in the reader's language.
  const say: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const fieldId: string = useId();
  const connectionId: string = props.connection.id?.toString() || "";
  const definition: CloudConnectionDefinition | undefined =
    getCloudConnectionDefinition(props.connection.provider);
  const shell: { title: string; url: string } = definition
    ? { title: definition.shellTitle, url: definition.shellUrl }
    : FALLBACK_SHELL;
  const appId: string =
    typeof props.connection.config?.["clientId"] === "string"
      ? (props.connection.config["clientId"] as string)
      : "";

  const [choices, setChoices] = useState<AzureStreamChoices>(() => {
    const current: CloudStreamStatus = getCloudStreamStatusOf(props.connection);

    return getDefaultAzureStreamChoices(
      getAzureStreamStartSubscriptions({
        readSubscriptionId: current.streamKeyCreatedAt
          ? current.hostSubscriptionId
          : null,
        config: props.connection.config,
        lastPullResult: props.connection.lastPullResult,
      }),
    );
  });
  /*
   * A connection that has read no subscription yet - just connected, or
   * its reads fail - gives the dialog none to start on, and nothing can be
   * turned on or run without one: the field is asked for under the
   * question, not folded away under More fields. Decided as the dialog
   * opens, so the field stays where it is while it is typed in.
   */
  const [isSubscriptionsAsked] = useState<boolean>(() => {
    return choices.subscriptionsText.trim() === "";
  });
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [startError, setStartError] = useState<string>("");
  // While the dialog is open, what arrived is asked for every few seconds.
  const watch: CloudStreamWatch = useCloudStreamWatch(props.connection);
  const status: CloudStreamStatus = watch.status;

  const update: (changes: Partial<AzureStreamChoices>) => void = (
    changes: Partial<AzureStreamChoices>,
  ): void => {
    setChoices((current: AzureStreamChoices) => {
      return { ...current, ...changes };
    });
  };

  const setup: AzureStreamSetup = getAzureStreamSetup({
    choices,
    connectionId,
    appId,
  });
  const isOn: boolean = Boolean(status.streamKeyCreatedAt);
  const readHost: string = isOn ? status.hostSubscriptionId || "" : "";
  /*
   * Reading is on where the command makes the event hubs - or the listed
   * subscriptions name no first one yet (one that is no ID, say), and there
   * is nowhere else to read them: the step says where it reads.
   */
  const isReadingHere: boolean =
    Boolean(readHost) &&
    (!setup.hostSubscriptionId || readHost === setup.hostSubscriptionId);
  // Why reading cannot be turned on, in the reader's language: the command's problem.
  const startLockedReason: string | undefined =
    !setup.hostSubscriptionId && setup.problem
      ? translator.translateTemplate(setup.problem.text, setup.problem.values)
      : undefined;

  const startReading: () => Promise<void> = async (): Promise<void> => {
    if (!props.connection.id || !setup.hostSubscriptionId) {
      return;
    }

    const hostSubscriptionId: string = setup.hostSubscriptionId;

    setIsStarting(true);
    setStartError("");

    try {
      const started: { startedAt: Date } = await startCloudStreaming({
        connectionId: props.connection.id,
        hostSubscriptionId,
      });
      watch.setStatus((current: CloudStreamStatus) => {
        return {
          ...current,
          streamKeyCreatedAt: started.startedAt,
          hostSubscriptionId,
        };
      });
      props.onChanged();
    } catch (error) {
      setStartError(API.getFriendlyMessage(error));
    }

    setIsStarting(false);
  };

  const live: CloudStreamStatusWords | null = getCloudStreamStatusWords({
    provider: props.connection.provider,
    streamKeyCreatedAt: status.streamKeyCreatedAt,
    streamSummary: status.streamSummary,
    now: watch.now,
  });
  const sources: Array<string> = getCloudStreamSourceWords(
    status.streamSummary,
    props.connection.provider,
  ).map((source: CloudTemplate): string => {
    return drawCloudTemplate(translator, source);
  });

  /*
   * Step 1: reading. On for the subscription the command makes the event
   * hubs in, it says since when; on for another one, it reads them in the
   * first listed instead.
   */
  let readStep: ReactElement;

  if (isReadingHere && status.streamKeyCreatedAt) {
    readStep = (
      <div
        className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
        data-testid={cloudStreamPart("reading")}
      >
        <Icon
          icon={IconProp.CheckCircle}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
        />
        <p className="min-w-0 text-sm text-emerald-900">
          {translator.translateTemplate(
            "Reading is on, since {{time}}: OneUptime reads the event hubs in subscription {{subscription}} every minute.",
            {
              time: OneUptimeDate.getDateAsLocalShortDateTimeString(
                status.streamKeyCreatedAt,
              ),
              subscription: readHost,
            },
          )}
        </p>
      </div>
    );
  } else {
    readStep = (
      <div className="space-y-3" data-testid={cloudStreamPart("start")}>
        <p className="text-sm text-gray-700">
          {readHost
            ? translator.translateTemplate(
                "OneUptime reads the event hubs in subscription {{current}}, and this command makes them in {{next}}, the first listed. Read them there before you run it.",
                {
                  current: readHost,
                  next: setup.hostSubscriptionId,
                },
              )
            : say(
                translationKey(
                  "Every minute, OneUptime reads the event hubs the command makes, signed in as the connection's app. Turn reading on first: until they are there, it waits for them.",
                ),
              )}
        </p>
        <Button
          title={readHost ? "Read them there" : "Turn on reading"}
          icon={IconProp.Play}
          buttonStyle={ButtonStyleType.PRIMARY}
          className={CLOUD_STREAM_STEP_BUTTON_CLASS_NAME}
          isLoading={isStarting}
          disabled={!setup.hostSubscriptionId}
          tooltip={startLockedReason}
          dataTestId={cloudStreamPart("start-reading")}
          onClick={() => {
            startReading().catch(() => {
              // handled inside startReading
            });
          }}
        />
        {startError ? (
          <p
            className="text-sm text-rose-600"
            role="alert"
            data-testid={cloudStreamPart("start-error")}
          >
            {startError}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  }

  const steps: Array<SetupGuideStepView> = [
    {
      title: say(translationKey("Turn on reading")),
      content: readStep,
    },
    {
      title: translator.translateTemplate("Run this in {{shell}}", {
        shell: shell.title,
      }),
      description: say(
        translationKey(
          "Run it as someone who may make resource groups and role assignments, and change diagnostic settings, in these subscriptions: an Owner, or a Contributor who is also a User Access Administrator.",
        ),
      ),
      content: (
        <div className="space-y-3">
          {setup.problem ? (
            <p
              className="text-sm text-amber-700"
              role="alert"
              data-testid={cloudStreamPart("problem")}
            >
              {translator.translateTemplate(
                setup.problem.text,
                setup.problem.values,
              )}
            </p>
          ) : (
            <div data-testid={cloudStreamPart("command")}>
              <CodeBlock
                code={setup.command}
                language="bash"
                wrapLongLines={true}
                maxHeight={CLOUD_STREAM_COMMAND_MAX_HEIGHT}
              />
            </div>
          )}
          <div className="flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center">
            <CloudStreamShellLink shell={shell} />
          </div>
          <CloudStreamWhatItMakes
            text={translator.translateTemplate(
              "It makes a resource group, {{group}}, in the first subscription, with an Event Hubs namespace in each region your resources are in, and gives the connection's app one role on that group alone, {{role}}. Then it gives each resource a diagnostic setting that sends to its region's event hub. Azure bills each namespace's throughput unit, and the events the settings send.",
              {
                group: setup.names.resourceGroup,
                role: AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE,
              },
            )}
          />
        </div>
      ),
    },
    {
      title: say(translationKey("Wait for the first events")),
      content: (
        <CloudStreamLiveStep
          live={live}
          isOn={isOn}
          sources={sources}
          offSentence={say(
            translationKey(
              "Turn reading on and run the command: this step says when the first events arrive.",
            ),
          )}
        />
      ),
    },
  ];

  // The subscriptions: under the question when asked for there, else folded.
  const subscriptionsField: ReactElement = (
    <div className="space-y-1">
      <label
        className="block text-sm font-medium text-gray-900"
        htmlFor={`${fieldId}-subscriptions`}
      >
        {say(translationKey("Subscriptions"))}
      </label>
      <input
        id={`${fieldId}-subscriptions`}
        type="text"
        dir="ltr"
        spellCheck={false}
        className={CLOUD_STREAM_INPUT_CLASS_NAME}
        placeholder="00000000-0000-0000-0000-000000000000"
        aria-describedby={`${fieldId}-subscriptions-help`}
        value={choices.subscriptionsText}
        data-testid={cloudStreamPart("subscriptions")}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          update({ subscriptionsText: event.target.value });
        }}
      />
      <p id={`${fieldId}-subscriptions-help`} className="text-xs text-gray-500">
        {isSubscriptionsAsked
          ? say(
              translationKey(
                "Subscription IDs, separated by commas: this connection has read none yet. The first holds the event hubs, and OneUptime reads them there.",
              ),
            )
          : say(
              translationKey(
                "Subscription IDs, separated by commas: at first, the ones this connection reads. The first holds the event hubs, and OneUptime reads them there.",
              ),
            )}
      </p>
    </div>
  );

  const moreFieldsItems: Array<FoldedSectionItem> = [
    ...(isSubscriptionsAsked
      ? []
      : [
          {
            key: "subscriptions",
            title: "Subscriptions",
            isSet: setup.subscriptions.length > 0,
            value: translator.formatNumber(setup.subscriptions.length),
          },
        ]),
    {
      key: "elsewhere",
      title: "Set it up another way",
      isSet: false,
    },
  ];

  return (
    <Modal
      title="Stream metrics and logs"
      description="Run one command, and Azure Monitor sends these subscriptions' metrics and resource logs to event hubs that OneUptime reads every minute."
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText={live?.state === "receiving" ? "Done" : "Close"}
    >
      <div
        className="space-y-6"
        data-testid={CLOUD_STREAM_DIALOG_TEST_ID}
        data-provider="azure"
      >
        {props.connection.isEnabled === false ? (
          <CloudStreamNotice
            text={say(
              translationKey(
                "This connection is turned off, so its event hubs are not read. Turn it on to read them.",
              ),
            )}
            dataTestId={cloudStreamPart("turned-off")}
          />
        ) : (
          <></>
        )}

        <div data-testid={cloudStreamPart("question")}>
          <SetupGuideOptionPicker
            label={say(translationKey("What should it stream?"))}
            options={AZURE_STREAM_WHAT_OPTIONS.map(
              (option: {
                key: CloudStreamWhat;
                label: string;
                description: string;
              }) => {
                return {
                  key: option.key,
                  label: say(option.label),
                  description: say(option.description),
                };
              },
            )}
            selectedKey={choices.what}
            onSelect={(key: string) => {
              update({ what: key as CloudStreamWhat });
            }}
          />
        </div>

        {isSubscriptionsAsked ? (
          <div
            className={CLOUD_STREAM_FIELD_BOX_CLASS_NAME}
            data-testid={cloudStreamPart("subscriptions-asked")}
          >
            {subscriptionsField}
          </div>
        ) : (
          <></>
        )}

        <SetupGuideSteps steps={steps} />

        <FoldedSection
          title={MORE_FIELDS_SECTION_TITLE}
          items={moreFieldsItems}
          dataTestId={cloudStreamPart("more-fields")}
        >
          <div className="space-y-5">
            {isSubscriptionsAsked ? <></> : subscriptionsField}

            <div
              className="space-y-3"
              data-testid={cloudStreamPart("elsewhere")}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900">
                  {say(translationKey("Set it up another way"))}
                </p>
                <p className="text-xs text-gray-600">
                  {translator.translateTemplate(
                    "With Terraform or the portal: in a resource group of the first subscription, make an Event Hubs namespace in each region, named after the prefix and the region, each with the event hub below; give the connection's app {{role}} on the group; and give each resource a diagnostic setting of this name that sends to its region's event hub. Then turn reading on.",
                    { role: AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE },
                  )}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <CloudStreamCopyRow
                  label={say(translationKey("Resource group name"))}
                  value={setup.names.resourceGroup}
                  dataTestId={cloudStreamPart("resource-group")}
                />
                <CloudStreamCopyRow
                  label={say(translationKey("Namespace prefix"))}
                  value={setup.names.namespacePrefix}
                  dataTestId={cloudStreamPart("namespace-prefix")}
                />
                <CloudStreamCopyRow
                  label={say(translationKey("Event hub"))}
                  value={setup.names.eventHub}
                  dataTestId={cloudStreamPart("event-hub")}
                />
                <CloudStreamCopyRow
                  label={say(translationKey("Diagnostic setting"))}
                  value={setup.names.diagnosticSetting}
                  dataTestId={cloudStreamPart("diagnostic-setting")}
                />
              </div>
              <a
                href={cloudConnectionDocsUrl(AZURE_STREAM_DOCS_PATH).toString()}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={cloudStreamPart("guide")}
                className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                <Icon icon={IconProp.Book} className="h-4 w-4" />
                <span>{say(translationKey("Step-by-step guide"))}</span>
              </a>
            </div>
          </div>
        </FoldedSection>
      </div>
    </Modal>
  );
};

export default CloudStreamAzureDialog;
