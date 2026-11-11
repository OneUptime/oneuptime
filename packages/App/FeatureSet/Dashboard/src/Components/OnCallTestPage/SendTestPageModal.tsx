import OnCallTestPageApi, {
  OnCallTestPageSeverityChoice,
  OnCallTestPageTarget,
} from "./OnCallTestPageApi";
import {
  OnCallTestPageSeverityOption,
  fromSeverityOptionValue,
  loadSeverityOptions,
} from "./OnCallTestPageSeverities";
import { CHANNEL_NAMES } from "./OnCallTestPageWords";
import TestPageResult from "./TestPageResult";
import {
  ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
  ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES,
  OnCallTestPageCost,
  OnCallTestPagePreview,
  OnCallTestPagePreviewMethod,
  OnCallTestPagePreviewPerson,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * SEND A TEST PAGE: pick the severity, see what it will send - and, on
 * OneUptime Cloud, what it costs - then send it and watch what happens to
 * each message (OnCallTestPage). One dialog for every place a test is
 * offered: "Send me a test page", a member's test from On-Call > Readiness,
 * "Test this policy". It stays open with the result once the test is sent.
 */

export interface ComponentProps {
  target: OnCallTestPageTarget;
  onClose: () => void;
  // Told once the test is sent, and of each result read after.
  onSent?: ((executionLogId: string) => void) | undefined;
  onResult?: ((result: OnCallTestPageResult) => void) | undefined;
}

// The dialog's title, by who the test is for.
export function getTestPageDialogTitle(
  translator: Translator,
  target: OnCallTestPageTarget,
): string {
  if (target.kind === "policy") {
    return target.policyName
      ? translator.translateTemplate("Test {{policy}}", {
          policy: target.policyName,
        })
      : translator.translateText("Test this policy") || "";
  }

  if (target.kind === "member") {
    return target.userName
      ? translator.translateTemplate("Send a test page to {{name}}", {
          name: target.userName,
        })
      : translator.translateText("Send a test page") || "";
  }

  return translator.translateText("Send me a test page") || "";
}

// The line under the title: what a test does, and that nothing else happens.
export function getTestPageDialogDescription(
  translator: Translator,
  target: OnCallTestPageTarget,
): string {
  if (target.kind === "policy") {
    return (
      translator.translateText(
        "It pages this policy's first escalation level now, through each person's own on-call rules for the severity you pick - as a real page would, without the waits. Every message says TEST. No incident is created, nothing shows on a status page, and no subscriber or channel is told.",
      ) || ""
    );
  }

  if (target.kind === "member") {
    return (
      translator.translateText(
        "It goes through their own on-call rules for the severity you pick, as a real page would - without the waits. Every message says TEST. No incident is created, and nobody else is told.",
      ) || ""
    );
  }

  return (
    translator.translateText(
      "It goes through your own on-call rules for the severity you pick, as a real page would - without the waits. Every message says TEST. No incident is created, and nobody else is told.",
    ) || ""
  );
}

// "Email · ana@example.com", "SMS (after 5 minutes on a real page)".
export function describePreviewMethod(
  translator: Translator,
  method: OnCallTestPagePreviewMethod,
): string {
  const channel: string =
    translator.translateText(CHANNEL_NAMES[method.channel]) ||
    CHANNEL_NAMES[method.channel];

  const name: string = method.address
    ? `${channel} · ${method.address}`
    : channel;

  if (method.notifyAfterMinutes > 0) {
    return translator.translatePlural(
      {
        one: "{{name}} (after {{count}} minute on a real page)",
        other: "{{name}} (after {{count}} minutes on a real page)",
      },
      method.notifyAfterMinutes,
      { name: name },
    );
  }

  return name;
}

// What a test costs, in a sentence, or empty when it costs nothing.
export function describeTestPageCost(
  translator: Translator,
  cost: OnCallTestPageCost,
): string {
  if (!cost.isPaid) {
    return "";
  }

  const items: Array<string> = [];

  if (cost.smsCount > 0) {
    items.push(
      translator.translatePlural(
        { one: "{{count}} SMS", other: "{{count}} SMS" },
        cost.smsCount,
      ),
    );
  }

  if (cost.callCount > 0) {
    items.push(
      translator.translatePlural(
        { one: "{{count}} phone call", other: "{{count}} phone calls" },
        cost.callCount,
      ),
    );
  }

  if (cost.whatsAppCount > 0) {
    items.push(
      translator.translatePlural(
        { one: "{{count}} WhatsApp message", other: "{{count}} WhatsApp messages" },
        cost.whatsAppCount,
      ),
    );
  }

  if (cost.telegramCount > 0) {
    items.push(
      translator.translatePlural(
        { one: "{{count}} Telegram message", other: "{{count}} Telegram messages" },
        cost.telegramCount,
      ),
    );
  }

  const list: string = items.join(", ");

  if (typeof cost.estimatedCostInUSDCents === "number") {
    return translator.translateTemplate(
      "This test sends {{items}}, paid from this project's SMS and call balance: about {{amount}}.",
      {
        items: list,
        amount: `$${(cost.estimatedCostInUSDCents / 100).toFixed(2)}`,
      },
    );
  }

  return translator.translateTemplate(
    "This test sends {{items}}, paid from this project's SMS and call balance.",
    { items: list },
  );
}

const PreviewPerson: FunctionComponent<{
  person: OnCallTestPagePreviewPerson;
  showName: boolean;
}> = (props: {
  person: OnCallTestPagePreviewPerson;
  showName: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const person: OnCallTestPagePreviewPerson = props.person;

  return (
    <li className="py-2" data-testid="test-page-preview-person">
      {props.showName ? (
        <p className="text-sm font-medium text-gray-900">
          {person.userName}
          {person.reachedThrough ? (
            <span className="font-normal text-gray-500">
              {" · "}
              {person.reachedThrough}
            </span>
          ) : (
            <></>
          )}
        </p>
      ) : (
        <></>
      )}
      {person.methods.length > 0 ? (
        <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-sm text-gray-700">
          {person.methods.map(
            (method: OnCallTestPagePreviewMethod, index: number) => {
              return (
                <li
                  key={`${method.channel}-${index}`}
                  className={method.isVerified ? "" : "text-gray-400"}
                  data-testid="test-page-preview-method"
                >
                  {describePreviewMethod(translator, method)}
                </li>
              );
            },
          )}
        </ol>
      ) : (
        <></>
      )}
      {person.warnings.map((warning: string, index: number) => {
        return (
          <p
            key={`warning-${index}`}
            className="mt-1 text-sm text-amber-700"
            data-testid="test-page-preview-warning"
          >
            {warning}
          </p>
        );
      })}
    </li>
  );
};

const SendTestPageModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [severityOptions, setSeverityOptions] = useState<
    Array<OnCallTestPageSeverityOption>
  >([]);
  const [severity, setSeverity] = useState<OnCallTestPageSeverityChoice | null>(
    null,
  );
  const [walksEscalation, setWalksEscalation] = useState<boolean>(false);
  const [preview, setPreview] = useState<OnCallTestPagePreview | null>(null);
  const [isLoadingSeverities, setIsLoadingSeverities] = useState<boolean>(true);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [executionLogId, setExecutionLogId] = useState<string>("");

  useEffect(() => {
    let isActive: boolean = true;

    loadSeverityOptions()
      .then((options: Array<OnCallTestPageSeverityOption>) => {
        if (!isActive) {
          return;
        }

        setSeverityOptions(options);

        const first: OnCallTestPageSeverityOption | undefined = options[0];

        if (first) {
          setSeverity({
            recordKind: first.recordKind,
            severityId: first.severityId,
          });
        }
      })
      .catch((err: Error) => {
        if (isActive) {
          setError(err?.message || "");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingSeverities(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!severity) {
      return;
    }

    let isActive: boolean = true;

    setIsLoadingPreview(true);
    setError("");

    OnCallTestPageApi.preview({ target: props.target, severity: severity })
      .then((nextPreview: OnCallTestPagePreview) => {
        if (isActive) {
          setPreview(nextPreview);
        }
      })
      .catch((err: Error) => {
        if (isActive) {
          setPreview(null);
          setError(err?.message || "");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingPreview(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [severity?.recordKind, severity?.severityId]);

  const title: string = getTestPageDialogTitle(translator, props.target);

  // Sent: the dialog shows what becomes of the test.
  if (executionLogId) {
    return (
      <Modal
        title={title}
        description={
          translator.translateTemplate(
            "Sent. Each message is below as it goes out. The test ends when someone acknowledges it, or after {{minutes}} minutes.",
            { minutes: ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES },
          ) || ""
        }
        onClose={props.onClose}
        submitButtonText={translator.translateText("Done") || "Done"}
        onSubmit={props.onClose}
        modalWidth={ModalWidth.Medium}
      >
        <TestPageResult
          executionLogId={executionLogId}
          onResult={props.onResult}
        />
      </Modal>
    );
  }

  const groups: Array<DropdownOptionGroup> = [
    {
      label: translator.translateText("Incidents") || "Incidents",
      options: severityOptions
        .filter((option: OnCallTestPageSeverityOption): boolean => {
          return option.recordKind === OnCallTestPageRecordKind.Incident;
        })
        .map((option: OnCallTestPageSeverityOption): DropdownOption => {
          return {
            value: option.value,
            label: translator.translateTemplate("Incident: {{severity}}", {
              severity: option.severityName,
            }),
          };
        }),
    },
    {
      label: translator.translateText("Alerts") || "Alerts",
      options: severityOptions
        .filter((option: OnCallTestPageSeverityOption): boolean => {
          return option.recordKind === OnCallTestPageRecordKind.Alert;
        })
        .map((option: OnCallTestPageSeverityOption): DropdownOption => {
          return {
            value: option.value,
            label: translator.translateTemplate("Alert: {{severity}}", {
              severity: option.severityName,
            }),
          };
        }),
    },
  ].filter((group: DropdownOptionGroup): boolean => {
    return group.options.length > 0;
  });

  const selectedOption: DropdownOption | undefined = groups
    .flatMap((group: DropdownOptionGroup): Array<DropdownOption> => {
      return group.options;
    })
    .find((option: DropdownOption): boolean => {
      return (
        Boolean(severity) &&
        option.value === `${severity!.recordKind}:${severity!.severityId}`
      );
    });

  const costSentence: string = preview
    ? describeTestPageCost(translator, preview.cost)
    : "";

  const hasAnybodyToPage: boolean = Boolean(
    preview && preview.people.length > 0,
  );

  const send: () => Promise<void> = async (): Promise<void> => {
    if (!severity) {
      return;
    }

    setIsSending(true);
    setError("");

    try {
      const id: string = await OnCallTestPageApi.send({
        target: props.target,
        severity: severity,
        walksEscalation: walksEscalation,
      });

      setExecutionLogId(id);
      props.onSent?.(id);
    } catch (err) {
      setError((err as Error)?.message || "");
    }

    setIsSending(false);
  };

  return (
    <Modal
      title={title}
      description={getTestPageDialogDescription(translator, props.target)}
      onClose={props.onClose}
      submitButtonText={
        translator.translateText("Send test page") || "Send test page"
      }
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      onSubmit={() => {
        void send();
      }}
      isLoading={isSending}
      disableSubmitButton={
        !severity || isLoadingPreview || !hasAnybodyToPage || isSending
      }
      error={error}
      isBodyLoading={isLoadingSeverities}
      modalWidth={ModalWidth.Medium}
    >
      <div className="flex flex-col gap-4" data-testid="send-test-page-dialog">
        <div className="flex flex-col gap-1">
          <label
            className="text-sm font-medium text-gray-700"
            htmlFor="test-page-severity"
          >
            {translator.translateText("Severity")}
          </label>
          <Dropdown
            id="test-page-severity"
            dataTestId="test-page-severity"
            options={groups}
            value={selectedOption}
            isClearable={false}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              const choice: OnCallTestPageSeverityChoice | null =
                fromSeverityOptionValue(value);

              if (choice) {
                setSeverity(choice);
              }
            }}
          />
          {severityOptions.length === 0 && !isLoadingSeverities ? (
            <p className="text-sm text-gray-500">
              {translator.translateText(
                "This project has no severities to test yet.",
              )}
            </p>
          ) : (
            <></>
          )}
        </div>

        {props.target.kind === "policy" ? (
          <CheckboxElement
            title={
              translator.translateText("Walk every escalation level") || ""
            }
            description={translator.translateTemplate(
              "Pages each level in turn, {{minutes}} minutes apart, until someone acknowledges. Off, it pages the first level only.",
              { minutes: ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES },
            )}
            value={walksEscalation}
            onChange={(value: boolean) => {
              setWalksEscalation(value);
            }}
            dataTestId="test-page-walks-escalation"
          />
        ) : (
          <></>
        )}

        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-gray-700">
            {props.target.kind === "policy"
              ? translator.translateText("Who it pages, and how")
              : translator.translateText("What it sends, in this order")}
          </p>
          {isLoadingPreview ? (
            <InlineLoadingLine text="Reading what it will send..." />
          ) : preview ? (
            <>
              <ul
                className="divide-y divide-gray-100"
                data-testid="test-page-preview"
              >
                {preview.people.map((person: OnCallTestPagePreviewPerson) => {
                  return (
                    <PreviewPerson
                      key={person.userId}
                      person={person}
                      showName={props.target.kind === "policy"}
                    />
                  );
                })}
              </ul>
              {preview.notPaged.map((line: string, index: number) => {
                return (
                  <p
                    key={`not-paged-${index}`}
                    className="text-sm text-amber-700"
                    data-testid="test-page-preview-not-paged"
                  >
                    {line}
                  </p>
                );
              })}
            </>
          ) : (
            <></>
          )}
        </div>

        {costSentence ? (
          <Alert
            type={AlertType.WARNING}
            title={costSentence}
            dataTestId="test-page-cost"
          />
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default SendTestPageModal;
