import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import {
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import { GcpCloudStreamLogs } from "Common/Types/CloudConnection/CloudStreamGcp";
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
import { getConfiguredOneUptimeUrl } from "../../SetupGuide/ConfiguredOneUptimeUrl";
import SetupGuideOptionPicker from "../../SetupGuide/SetupGuideOptionPicker";
import SetupGuideSteps, {
  SetupGuideStepView,
} from "../../SetupGuide/SetupGuideSteps";
import {
  CloudStreamKeyMade,
  CloudStreamStatus,
  cloudConnectionDocsUrl,
  makeCloudStreamKey,
} from "./CloudConnectApi";
import { CloudTemplate, drawCloudTemplate } from "./CloudConnectionWords";
import {
  GCP_STREAM_DOCS_PATH,
  GCP_STREAM_LOGS_OPTIONS,
  GcpStreamChoices,
  GcpStreamSetup,
  getDefaultGcpStreamChoices,
  getGcpStreamCommand,
  getGcpStreamDefaultProjects,
  getGcpStreamHostProject,
  getGcpStreamSetup,
} from "./CloudStreamGcpSetup";
import {
  CLOUD_STREAM_DIALOG_TEST_ID,
  CLOUD_STREAM_INPUT_CLASS_NAME,
  CloudStreamCopyRow,
  CloudStreamLiveStep,
  CloudStreamNotice,
  CloudStreamShellLink,
  CloudStreamWatch,
  CloudStreamWhatItMakes,
  cloudStreamPart,
  useCloudStreamWatch,
} from "./CloudStreamParts";
import {
  CloudStreamStatusWords,
  getCloudStreamSourceWords,
  getCloudStreamStatusWords,
} from "./CloudStreamWords";

/*
 * Stream logs, for a Google Cloud connection - laid out as AWS's dialog
 * is: the one question on top - which logs - then numbered steps:
 *
 *   1. a stream key: Pub/Sub sends it with every push, as the audience of
 *      the token it signs, and OneUptime keeps only its fingerprint, so it
 *      is shown once, here. A connection that already streams makes a new
 *      one to run the command again; the key it replaces works a day more;
 *   2. one command for Google Cloud Shell (CloudStreamGcp): a push service
 *      account that holds no role, a topic and its push subscription in
 *      the project of the connection's own service account, and a log sink
 *      in each project;
 *   3. the first push, asked for every few seconds: what arrived, from
 *      where, or why a push was refused.
 *
 * Cloud Monitoring has no export that pushes metrics, so only logs
 * stream; the connection keeps reading metrics on its schedule. The
 * projects, and the values for setting it up another way, are folded
 * under More fields. Stopping is the connections list's own action.
 */

export interface ComponentProps {
  connection: CloudConnection;
  onClose: () => void;
  // A key was made: the list reads its connections again.
  onChanged: () => void;
}

const FALLBACK_SHELL: { title: string; url: string } = {
  title: "Google Cloud Shell",
  url: "https://shell.cloud.google.com/?show=terminal",
};

const CloudStreamGcpDialog: FunctionComponent<ComponentProps> = (
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

  const [choices, setChoices] = useState<GcpStreamChoices>(() => {
    return getDefaultGcpStreamChoices(
      getGcpStreamDefaultProjects(props.connection),
    );
  });
  const [madeKey, setMadeKey] = useState<CloudStreamKeyMade | null>(null);
  const [isMakingKey, setIsMakingKey] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");
  // While the dialog is open, what arrived is asked for every few seconds.
  const watch: CloudStreamWatch = useCloudStreamWatch(props.connection);
  const status: CloudStreamStatus = watch.status;

  const update: (changes: Partial<GcpStreamChoices>) => void = (
    changes: Partial<GcpStreamChoices>,
  ): void => {
    setChoices((current: GcpStreamChoices) => {
      return { ...current, ...changes };
    });
  };

  const makeKey: () => Promise<void> = async (): Promise<void> => {
    if (!props.connection.id) {
      return;
    }

    setIsMakingKey(true);
    setKeyError("");

    try {
      const made: CloudStreamKeyMade = await makeCloudStreamKey(
        props.connection.id,
      );
      setMadeKey(made);
      watch.setStatus((current: CloudStreamStatus) => {
        return { ...current, streamKeyCreatedAt: made.createdAt };
      });
      props.onChanged();
    } catch (error) {
      setKeyError(API.getFriendlyMessage(error));
    }

    setIsMakingKey(false);
  };

  const setup: GcpStreamSetup = getGcpStreamSetup({
    choices,
    connectionId,
    hostProjectId: getGcpStreamHostProject(props.connection),
    oneuptimeUrl: getConfiguredOneUptimeUrl(),
  });
  const command: string = getGcpStreamCommand({
    setup,
    connectionId,
    streamKey: madeKey?.streamKey || null,
  });
  // The service account the server signs the key's pushes off against.
  const pushServiceAccount: string =
    madeKey?.pushServiceAccount || setup.pushServiceAccount;
  const hasKey: boolean = Boolean(madeKey || status.streamKeyCreatedAt);
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
   * Step 1: the key. Made here it is in the command, and shown once; one
   * made before cannot be shown again, so running the command again takes
   * a new one.
   */
  let keyStep: ReactElement;

  if (madeKey) {
    keyStep = (
      <div
        className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
        data-testid={cloudStreamPart("key-made")}
      >
        <Icon
          icon={IconProp.CheckCircle}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
        />
        <div className="min-w-0 space-y-1 text-sm text-emerald-900">
          <p>
            {say(
              translationKey(
                "Key made. The command below holds it, and it is shown only here: run the command before you close this dialog.",
              ),
            )}
          </p>
          {madeKey.previousKeyWorksUntil ? (
            <p
              className="text-xs"
              data-testid={cloudStreamPart("previous-key")}
            >
              {translator.translateTemplate(
                "The key it replaces keeps working until {{time}}.",
                {
                  time: OneUptimeDate.getDateAsLocalShortDateTimeString(
                    madeKey.previousKeyWorksUntil,
                  ),
                },
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  } else {
    keyStep = (
      <div className="space-y-3" data-testid={cloudStreamPart("key")}>
        <p className="text-sm text-gray-700">
          {status.streamKeyCreatedAt
            ? translator.translateTemplate(
                "This connection has a stream key, made {{time}}. It cannot be shown again: to run the command again, make a new key. The current one keeps working for a day after.",
                {
                  time: OneUptimeDate.getDateAsLocalShortDateTimeString(
                    status.streamKeyCreatedAt,
                  ),
                },
              )
            : say(
                translationKey(
                  "Pub/Sub sends this key with every push, as the audience of the token it signs. OneUptime keeps only its fingerprint, so it is shown once, here.",
                ),
              )}
        </p>
        <Button
          title={
            status.streamKeyCreatedAt ? "Make a new key" : "Make a stream key"
          }
          icon={IconProp.Key}
          buttonStyle={ButtonStyleType.PRIMARY}
          isLoading={isMakingKey}
          dataTestId={cloudStreamPart("make-key")}
          onClick={() => {
            makeKey().catch(() => {
              // handled inside makeKey
            });
          }}
        />
        {keyError ? (
          <p
            className="text-sm text-rose-600"
            role="alert"
            data-testid={cloudStreamPart("key-error")}
          >
            {keyError}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  }

  const steps: Array<SetupGuideStepView> = [
    {
      title: say(translationKey("Make a stream key")),
      content: keyStep,
    },
    {
      title: translator.translateTemplate("Run this in {{shell}}", {
        shell: shell.title,
      }),
      description: say(
        translationKey(
          "Run it as a project Owner, or as someone who may make service accounts, Pub/Sub topics and log sinks in these projects.",
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
                code={command}
                language="bash"
                wrapLongLines={true}
                maxHeight="240px"
              />
            </div>
          )}
          {!setup.problem && !madeKey ? (
            <p
              className="text-xs text-amber-700"
              data-testid={cloudStreamPart("needs-key")}
            >
              {translator.translateTemplate(
                "Make a key in the first step: the command holds it in place of {{placeholder}}.",
                { placeholder: "<YOUR_STREAM_KEY>" },
              )}
            </p>
          ) : (
            <></>
          )}
          <div className="flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center">
            <CloudStreamShellLink shell={shell} />
          </div>
          <CloudStreamWhatItMakes
            text={translator.translateTemplate(
              "In {{project}} it makes a service account that holds no role, for Pub/Sub to sign its pushes as, and a Pub/Sub topic with its push subscription, {{topic}}; in each project, a log sink whose writer may publish to that topic alone. Nothing it makes can read your projects. Google bills Pub/Sub for the logs it delivers.",
              {
                project: setup.hostProjectId || "?",
                topic: setup.names.topic,
              },
            )}
          />
        </div>
      ),
    },
    {
      title: say(translationKey("Wait for the first push")),
      content: (
        <CloudStreamLiveStep
          live={live}
          isOn={hasKey}
          sources={sources}
          offSentence={say(
            translationKey(
              "Make a key and run the command: this step says when the first push arrives.",
            ),
          )}
        />
      ),
    },
  ];

  const moreFieldsItems: Array<FoldedSectionItem> = [
    {
      key: "projects",
      title: "Projects",
      isSet: setup.projects.length > 0,
      value: translator.formatNumber(setup.projects.length),
    },
    {
      key: "elsewhere",
      title: "Set it up another way",
      isSet: false,
    },
  ];

  return (
    <Modal
      title="Stream logs"
      description="Run one command, and Pub/Sub pushes these projects' logs to OneUptime within a minute. Metrics are still read on the connection's schedule."
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText={live?.state === "receiving" ? "Done" : "Close"}
    >
      <div
        className="space-y-6"
        data-testid={CLOUD_STREAM_DIALOG_TEST_ID}
        data-provider="gcp"
      >
        {props.connection.isEnabled === false ? (
          <CloudStreamNotice
            text={say(
              translationKey(
                "This connection is turned off, so what Pub/Sub pushes is refused. Turn it on to take it.",
              ),
            )}
            dataTestId={cloudStreamPart("turned-off")}
          />
        ) : (
          <></>
        )}

        <div data-testid={cloudStreamPart("question")}>
          <SetupGuideOptionPicker
            label={say(translationKey("Which logs should it stream?"))}
            options={GCP_STREAM_LOGS_OPTIONS.map(
              (option: {
                key: GcpCloudStreamLogs;
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
            selectedKey={choices.logs}
            onSelect={(key: string) => {
              update({ logs: key as GcpCloudStreamLogs });
            }}
          />
        </div>

        {choices.logs === GcpCloudStreamLogs.Custom ? (
          <div
            className="space-y-1 rounded-lg border border-gray-200 px-4 py-3"
            data-testid={cloudStreamPart("filter-field")}
          >
            <label
              className="block text-sm font-medium text-gray-900"
              htmlFor={`${fieldId}-filter`}
            >
              {say(translationKey("Filter"))}
            </label>
            <textarea
              id={`${fieldId}-filter`}
              rows={3}
              dir="ltr"
              className={CLOUD_STREAM_INPUT_CLASS_NAME}
              placeholder='resource.type="cloud_run_revision" AND severity>=ERROR'
              spellCheck={false}
              aria-describedby={`${fieldId}-filter-help`}
              value={choices.customFilter}
              data-testid={cloudStreamPart("filter")}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                update({ customFilter: event.target.value });
              }}
            />
            <p id={`${fieldId}-filter-help`} className="text-xs text-gray-500">
              {say(
                translationKey(
                  "In the Cloud Logging query language, as the Logs Explorer writes it. Each project's sink routes the entries it matches.",
                ),
              )}
            </p>
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
            <div className="space-y-1">
              <label
                className="block text-sm font-medium text-gray-900"
                htmlFor={`${fieldId}-projects`}
              >
                {say(translationKey("Projects"))}
              </label>
              <input
                id={`${fieldId}-projects`}
                type="text"
                dir="ltr"
                spellCheck={false}
                className={CLOUD_STREAM_INPUT_CLASS_NAME}
                placeholder="my-project-123456"
                aria-describedby={`${fieldId}-projects-help`}
                value={choices.projectsText}
                data-testid={cloudStreamPart("projects")}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  update({ projectsText: event.target.value });
                }}
              />
              <p
                id={`${fieldId}-projects-help`}
                className="text-xs text-gray-500"
              >
                {say(
                  translationKey(
                    "Project IDs, separated by commas: at first, the ones this connection reads. The topic is made in the project of the connection's service account.",
                  ),
                )}
              </p>
            </div>

            <div
              className="space-y-3"
              data-testid={cloudStreamPart("elsewhere")}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900">
                  {say(translationKey("Set it up another way"))}
                </p>
                <p className="text-xs text-gray-600">
                  {say(
                    translationKey(
                      "With Terraform or the console: give a Pub/Sub topic a push subscription with these values, its payload wrapped, and let the Pub/Sub service agent make tokens for the push service account; then route each project's logs to the topic with a log sink.",
                    ),
                  )}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <CloudStreamCopyRow
                  label={say(translationKey("Push endpoint"))}
                  value={setup.endpoint}
                  dataTestId={cloudStreamPart("push-endpoint")}
                />
                {pushServiceAccount ? (
                  <CloudStreamCopyRow
                    label={say(translationKey("Push service account"))}
                    value={pushServiceAccount}
                    dataTestId={cloudStreamPart("push-service-account")}
                  />
                ) : (
                  <></>
                )}
                {madeKey ? (
                  <CloudStreamCopyRow
                    label={say(translationKey("Audience"))}
                    value={madeKey.streamKey}
                    dataTestId={cloudStreamPart("audience")}
                  />
                ) : (
                  <></>
                )}
              </div>
              <a
                href={cloudConnectionDocsUrl(GCP_STREAM_DOCS_PATH).toString()}
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

export default CloudStreamGcpDialog;
