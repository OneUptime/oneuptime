import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import {
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import {
  CLOUD_STREAM_TEMPLATE_FILE,
  getAwsCloudStreamCommand,
  getAwsCloudStreamTemplate,
  getCloudStreamNames,
} from "Common/Types/CloudConnection/CloudStreamTemplate";
import { getAwsOrganizationManagementAccountId } from "Common/Types/CloudConnection/CloudOrganizationAgents";
import {
  CLOUD_STREAM_ORGANIZATION_LOG_GROUPS_REFUSAL,
  CLOUD_STREAM_ORGANIZATION_WHAT_IT_MAKES,
  getAwsCloudStreamOrganizationCommand,
  isCloudStreamOrganizationPossible,
} from "Common/Types/CloudConnection/CloudStreamOrganization";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  FOLDED_SECTION_ON,
  FoldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
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
  CLOUD_STREAM_DOCS_PATH,
  CLOUD_STREAM_WHAT_OPTIONS,
  CloudStreamChoices,
  CloudStreamSetup,
  CloudStreamWhat,
  getCloudStreamSetup,
  getDefaultCloudStreamChoices,
  streamsLogs,
  streamsMetrics,
} from "./CloudStreamSetup";
import {
  CLOUD_STREAM_COMMAND_MAX_HEIGHT,
  CLOUD_STREAM_DIALOG_TEST_ID,
  CLOUD_STREAM_INPUT_CLASS_NAME,
  CLOUD_STREAM_STEP_BUTTON_CLASS_NAME,
  CloudStreamCheckRow,
  CloudStreamCopyRow,
  CloudStreamLiveStep,
  CloudStreamNotice,
  CloudStreamShellLink,
  CloudStreamWatch,
  CloudStreamWhatItMakes,
  useCloudStreamWatch,
} from "./CloudStreamParts";
import {
  CloudStreamStatusWords,
  getCloudStreamDefaultRegions,
  getCloudStreamSourceWords,
  getCloudStreamStatusWords,
} from "./CloudStreamWords";

/*
 * Stream metrics and logs, for an AWS connection - laid out as every
 * "connect this" guide in the product is (Let AI fix problems, Add Host):
 * the guide's one question on top - what to stream - then numbered steps:
 *
 *   1. a stream key: Firehose sends it with every delivery, and OneUptime
 *      keeps only its fingerprint, so it is shown once, here. A connection
 *      that already streams makes a new one to run the command again; the
 *      key it replaces keeps working for a day, so no stream stops while
 *      the stacks are updated;
 *   2. one command for AWS CloudShell: a CloudFormation stack in each
 *      Region (CloudStreamTemplate) - the template is also a download;
 *   3. the first delivery, asked for every few seconds: what arrived, from
 *      where, or why a delivery was refused.
 *
 * The rest has a sensible default and is folded under More fields: every
 * metric rather than the key ones (it costs more), the Regions (where the
 * connection found resources), and the values for setting the streams up
 * another way. Stopping is the connections list's own action. What the
 * three clouds' dialogs share is CloudStreamParts'.
 *
 * A connection that reads an AWS Organization can also stream every
 * account of it (More fields): the command, run in the management account,
 * makes the same stacks there and, through a StackSet, in every member
 * account and every account that joins later (CloudStreamOrganization).
 * Named log groups are one account's, so it streams every log group or
 * none.
 */

export { CLOUD_STREAM_DIALOG_TEST_ID };

export interface ComponentProps {
  connection: CloudConnection;
  onClose: () => void;
  // A key was made: the list reads its connections again.
  onChanged: () => void;
}

const FALLBACK_SHELL: { title: string; url: string } = {
  title: "AWS CloudShell",
  url: "https://console.aws.amazon.com/cloudshell/home",
};

// The template as a file, for a stack made in the console instead.
function downloadTemplate(template: JSONObject): void {
  const blob: Blob = new Blob([JSON.stringify(template, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  const url: string = window.URL.createObjectURL(blob);
  const anchor: HTMLAnchorElement = document.createElement("a");
  anchor.href = url;
  anchor.download = CLOUD_STREAM_TEMPLATE_FILE;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

const CloudStreamDialog: FunctionComponent<ComponentProps> = (
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

  const [choices, setChoices] = useState<CloudStreamChoices>(() => {
    return getDefaultCloudStreamChoices(
      getCloudStreamDefaultRegions(props.connection.lastPullResult),
    );
  });
  const [madeKey, setMadeKey] = useState<CloudStreamKeyMade | null>(null);
  const [isMakingKey, setIsMakingKey] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");
  // While the dialog is open, what arrived is asked for every few seconds.
  const watch: CloudStreamWatch = useCloudStreamWatch(props.connection);
  const status: CloudStreamStatus = watch.status;
  const setStatus: CloudStreamWatch["setStatus"] = watch.setStatus;
  const now: Date = watch.now;
  /*
   * A connection that reads an AWS Organization: every account of it, from
   * its management account, when More fields says so.
   */
  const managementAccountId: string | null =
    getAwsOrganizationManagementAccountId(props.connection.config);
  const [everyAccount, setEveryAccount] = useState<boolean>(false);
  const isEveryAccount: boolean = everyAccount && Boolean(managementAccountId);

  const update: (changes: Partial<CloudStreamChoices>) => void = (
    changes: Partial<CloudStreamChoices>,
  ): void => {
    setChoices((current: CloudStreamChoices) => {
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
      setStatus((current: CloudStreamStatus) => {
        return { ...current, streamKeyCreatedAt: made.createdAt };
      });
      props.onChanged();
    } catch (error) {
      setKeyError(API.getFriendlyMessage(error));
    }

    setIsMakingKey(false);
  };

  const setup: CloudStreamSetup = getCloudStreamSetup({
    choices,
    connectionId,
    oneuptimeUrl: getConfiguredOneUptimeUrl(),
  });
  // Named log groups are one account's: no organization streams them.
  const isOrganizationRefused: boolean =
    isEveryAccount &&
    !setup.problem &&
    !isCloudStreamOrganizationPossible(setup.options);
  let command: string = "";

  if (!setup.problem && !isOrganizationRefused) {
    command = isEveryAccount
      ? getAwsCloudStreamOrganizationCommand({
          options: setup.options,
          regions: setup.regions,
          streamKey: madeKey?.streamKey || null,
          managementAccountId: managementAccountId || "",
        })
      : getAwsCloudStreamCommand({
          options: setup.options,
          regions: setup.regions,
          streamKey: madeKey?.streamKey || null,
        });
  }
  const stackName: string = getCloudStreamNames(connectionId).stackName;
  const hasKey: boolean = Boolean(madeKey || status.streamKeyCreatedAt);
  const live: CloudStreamStatusWords | null = getCloudStreamStatusWords({
    streamKeyCreatedAt: status.streamKeyCreatedAt,
    streamSummary: status.streamSummary,
    now,
  });
  const sources: Array<string> = getCloudStreamSourceWords(
    status.streamSummary,
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
        data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-key-made`}
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
              data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-previous-key`}
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
      <div
        className="space-y-3"
        data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-key`}
      >
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
                  "Firehose sends this key with every delivery. OneUptime keeps only its fingerprint, so it is shown once, here.",
                ),
              )}
        </p>
        <Button
          title={
            status.streamKeyCreatedAt ? "Make a new key" : "Make a stream key"
          }
          icon={IconProp.Key}
          buttonStyle={ButtonStyleType.PRIMARY}
          className={CLOUD_STREAM_STEP_BUTTON_CLASS_NAME}
          isLoading={isMakingKey}
          dataTestId={`${CLOUD_STREAM_DIALOG_TEST_ID}-make-key`}
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
            data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-key-error`}
          >
            {keyError}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  }

  // Step 3: what arrived, or what to wait for.
  const liveStep: ReactElement = (
    <CloudStreamLiveStep
      live={live}
      isOn={hasKey}
      sources={sources}
      offSentence={say(
        translationKey(
          "Make a key and run the command: this step says when the first delivery arrives.",
        ),
      )}
    />
  );

  const steps: Array<SetupGuideStepView> = [
    {
      title: say(translationKey("Make a stream key")),
      content: keyStep,
    },
    {
      title: translator.translateTemplate("Run this in {{shell}}", {
        shell: shell.title,
      }),
      description: isEveryAccount
        ? translator.translateTemplate(
            "Run it in the management account {{account}}, as someone who may create StackSets, CloudFormation stacks and IAM roles there.",
            { account: managementAccountId || "" },
            { setsValuesApart: true },
          )
        : say(
            translationKey(
              "Run it as someone who may create CloudFormation stacks and IAM roles in this account.",
            ),
          ),
      content: (
        <div className="space-y-3">
          {setup.problem ? (
            <p
              className="text-sm text-amber-700"
              role="alert"
              data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-problem`}
            >
              {translator.translateTemplate(
                setup.problem.text,
                setup.problem.values,
              )}
            </p>
          ) : isOrganizationRefused ? (
            <p
              className="text-sm text-amber-700"
              role="alert"
              data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-organization-problem`}
            >
              {say(CLOUD_STREAM_ORGANIZATION_LOG_GROUPS_REFUSAL)}
            </p>
          ) : (
            <div data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-command`}>
              <CodeBlock
                code={command}
                language="bash"
                wrapLongLines={true}
                maxHeight={CLOUD_STREAM_COMMAND_MAX_HEIGHT}
              />
            </div>
          )}
          {!setup.problem && !isOrganizationRefused && !madeKey ? (
            <p
              className="text-xs text-amber-700"
              data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-needs-key`}
            >
              {translator.translateTemplate(
                "Make a key in the first step: the command holds it in place of {{placeholder}}.",
                { placeholder: "<YOUR_STREAM_KEY>" },
              )}
            </p>
          ) : (
            <></>
          )}
          {/*
           * The shell's button keeps its name on one line; the download
           * moves under it when both do not fit (CloudSetupCommand).
           */}
          <div className="flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center">
            <CloudStreamShellLink shell={shell} />
            {setup.problem ? (
              <></>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
                data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-download`}
                onClick={() => {
                  downloadTemplate(getAwsCloudStreamTemplate(setup.options));
                }}
              >
                <Icon icon={IconProp.Download} className="h-4 w-4" />
                <span>{say(translationKey("Download the template"))}</span>
              </button>
            )}
          </div>
          <CloudStreamWhatItMakes
            text={
              isEveryAccount
                ? translator.translateTemplate(
                    CLOUD_STREAM_ORGANIZATION_WHAT_IT_MAKES,
                    { stack: stackName },
                  )
                : translator.translateTemplate(
                    "It makes a CloudFormation stack, {{stack}}, in each Region: the metric stream and log subscriptions, two Firehose streams that deliver to OneUptime only, and a bucket for what they could not deliver. Nothing in it can read your account. AWS bills the metric stream for each metric update it sends, and Firehose for what it delivers.",
                    { stack: stackName },
                  )
            }
          />
        </div>
      ),
    },
    {
      title: say(translationKey("Wait for the first delivery")),
      content: liveStep,
    },
  ];

  /*
   * What More fields holds, as its folded line lists it - and what of it is
   * in force: every metric, and how many Regions the command deploys in.
   */
  const moreFieldsItems: Array<FoldedSectionItem> = [
    ...(streamsMetrics(choices.what)
      ? [
          {
            key: "every-metric",
            title: "Every metric",
            isSet: choices.everyMetric,
            value: FOLDED_SECTION_ON,
            translateValue: true,
          },
        ]
      : []),
    // Named where the fold draws it: after Every metric, before Regions.
    ...(managementAccountId
      ? [
          {
            key: "organization",
            title: "Every account of the organization",
            isSet: isEveryAccount,
            value: FOLDED_SECTION_ON,
            translateValue: true,
          },
        ]
      : []),
    {
      key: "regions",
      title: "Regions",
      isSet: setup.regions.length > 0,
      value: translator.formatNumber(setup.regions.length),
    },
    {
      key: "elsewhere",
      title: "Set it up another way",
      isSet: false,
    },
  ];

  return (
    <Modal
      title="Stream metrics and logs"
      /* The dialog translates its description: both are its keys. */
      description={
        isEveryAccount
          ? translationKey(
              "Run one command, and Amazon Data Firehose delivers the CloudWatch metrics and logs of every account of the organization to OneUptime within minutes, between reads.",
            )
          : "Run one command, and Amazon Data Firehose delivers this account's CloudWatch metrics and logs to OneUptime within minutes, between reads."
      }
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText={live?.state === "receiving" ? "Done" : "Close"}
    >
      <div className="space-y-6" data-testid={CLOUD_STREAM_DIALOG_TEST_ID}>
        {props.connection.isEnabled === false ? (
          <CloudStreamNotice
            text={say(
              translationKey(
                "This connection is turned off, so its streams' deliveries are refused. Turn it on to take them.",
              ),
            )}
            dataTestId={`${CLOUD_STREAM_DIALOG_TEST_ID}-turned-off`}
          />
        ) : (
          <></>
        )}

        {/*
         * The guide's one question, above its steps: the command is
         * written from the answer.
         */}
        <div data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-question`}>
          <SetupGuideOptionPicker
            label={say(translationKey("What should it stream?"))}
            options={CLOUD_STREAM_WHAT_OPTIONS.map(
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

        {streamsLogs(choices.what) ? (
          <div
            className="space-y-3 rounded-lg border border-gray-200 px-4 py-3"
            data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-logs`}
          >
            <CloudStreamCheckRow
              label={say(
                translationKey("Every log group of the account, new ones too"),
              )}
              description={`${say(
                translationKey(
                  "In each Region, every log group but Firehose's own. A busy account's logs can cost far more than its metrics.",
                ),
              )} ${say(
                translationKey(
                  "AWS allows one account-wide log subscription per Region: if another tool, such as a SIEM, already holds it, the command says so and sets nothing up.",
                ),
              )}`}
              isChecked={choices.everyLogGroup}
              dataTestId={`${CLOUD_STREAM_DIALOG_TEST_ID}-every-log-group`}
              onChange={(value: boolean) => {
                update({ everyLogGroup: value });
              }}
            />
            {choices.everyLogGroup ? (
              <></>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1 sm:col-span-2">
                  <label
                    className="block text-sm font-medium text-gray-900"
                    htmlFor={`${fieldId}-log-groups`}
                  >
                    {say(translationKey("Log groups"))}
                  </label>
                  <textarea
                    id={`${fieldId}-log-groups`}
                    rows={3}
                    dir="ltr"
                    className={CLOUD_STREAM_INPUT_CLASS_NAME}
                    placeholder="/aws/lambda/checkout"
                    spellCheck={false}
                    aria-describedby={`${fieldId}-log-groups-help`}
                    value={choices.logGroupsText}
                    data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-log-groups`}
                    onChange={(
                      event: React.ChangeEvent<HTMLTextAreaElement>,
                    ) => {
                      update({ logGroupsText: event.target.value });
                    }}
                  />
                  <p
                    id={`${fieldId}-log-groups-help`}
                    className="text-xs text-gray-500"
                  >
                    {say(
                      translationKey(
                        "One a line: a log group's name, in the Region beside, or its ARN, in its own Region.",
                      ),
                    )}{" "}
                    {say(
                      translationKey(
                        "The command checks each group first and sets nothing up if one is not there or already has two subscription filters, the most AWS allows.",
                      ),
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <label
                    className="block text-sm font-medium text-gray-900"
                    htmlFor={`${fieldId}-log-groups-region`}
                  >
                    {say(translationKey("Region"))}
                  </label>
                  <input
                    id={`${fieldId}-log-groups-region`}
                    type="text"
                    dir="ltr"
                    spellCheck={false}
                    className={CLOUD_STREAM_INPUT_CLASS_NAME}
                    value={choices.logGroupsRegion}
                    data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-log-groups-region`}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      update({ logGroupsRegion: event.target.value });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <></>
        )}

        <SetupGuideSteps steps={steps} />

        <FoldedSection
          title={MORE_FIELDS_SECTION_TITLE}
          items={moreFieldsItems}
          dataTestId={`${CLOUD_STREAM_DIALOG_TEST_ID}-more-fields`}
        >
          <div className="space-y-5">
            {streamsMetrics(choices.what) ? (
              <CloudStreamCheckRow
                label={say(
                  translationKey("Every metric, not only the key ones"),
                )}
                description={say(
                  translationKey(
                    "Every metric CloudWatch has for the account, your own included. AWS bills each metric update a stream sends, so this can cost many times more.",
                  ),
                )}
                isChecked={choices.everyMetric}
                dataTestId={`${CLOUD_STREAM_DIALOG_TEST_ID}-every-metric`}
                onChange={(value: boolean) => {
                  update({ everyMetric: value });
                }}
              />
            ) : (
              <></>
            )}

            {managementAccountId ? (
              <CloudStreamCheckRow
                label={say(translationKey("Every account of the organization"))}
                description={translator.translateTemplate(
                  "From the management account {{account}}, a StackSet makes the same stacks in every member account, and in accounts that join later. It streams every log group or no logs, since a named log group belongs to one account.",
                  { account: managementAccountId },
                  { setsValuesApart: true },
                )}
                isChecked={isEveryAccount}
                dataTestId={`${CLOUD_STREAM_DIALOG_TEST_ID}-every-account`}
                onChange={(value: boolean) => {
                  setEveryAccount(value);
                }}
              />
            ) : (
              <></>
            )}

            <div className="space-y-1">
              <label
                className="block text-sm font-medium text-gray-900"
                htmlFor={`${fieldId}-regions`}
              >
                {say(translationKey("Regions"))}
              </label>
              <input
                id={`${fieldId}-regions`}
                type="text"
                dir="ltr"
                spellCheck={false}
                className={CLOUD_STREAM_INPUT_CLASS_NAME}
                placeholder="us-east-1, eu-west-1"
                aria-describedby={`${fieldId}-regions-help`}
                value={choices.regionsText}
                data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-regions`}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  update({ regionsText: event.target.value });
                }}
              />
              <p
                id={`${fieldId}-regions-help`}
                className="text-xs text-gray-500"
              >
                {say(
                  translationKey(
                    "Where to stream from, separated by commas: at first, the Regions this connection found resources in. Left empty, the command streams from AWS CloudShell's own Region.",
                  ),
                )}
              </p>
            </div>

            <div
              className="space-y-3"
              data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-elsewhere`}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900">
                  {say(translationKey("Set it up another way"))}
                </p>
                <p className="text-xs text-gray-600">
                  {say(
                    translationKey(
                      "With Terraform or the console: give each Firehose stream an HTTP endpoint destination with these values, GZIP content encoding and a 1 MiB buffer, and the metric stream the OpenTelemetry 1.0 output format.",
                    ),
                  )}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <CloudStreamCopyRow
                  label={say(translationKey("Metrics endpoint"))}
                  value={setup.metricsUrl}
                  dataTestId={`${CLOUD_STREAM_DIALOG_TEST_ID}-metrics-url`}
                />
                <CloudStreamCopyRow
                  label={say(translationKey("Logs endpoint"))}
                  value={setup.logsUrl}
                  dataTestId={`${CLOUD_STREAM_DIALOG_TEST_ID}-logs-url`}
                />
                {madeKey ? (
                  <CloudStreamCopyRow
                    label={say(translationKey("Access key"))}
                    value={madeKey.streamKey}
                    dataTestId={`${CLOUD_STREAM_DIALOG_TEST_ID}-access-key`}
                  />
                ) : (
                  <></>
                )}
              </div>
              <a
                href={cloudConnectionDocsUrl(CLOUD_STREAM_DOCS_PATH).toString()}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`${CLOUD_STREAM_DIALOG_TEST_ID}-guide`}
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

export default CloudStreamDialog;
