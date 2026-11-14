import OnCallTestPageApi, {
  OnCallTestPageSeverityChoice,
  OnCallTestPageTarget,
} from "./OnCallTestPageApi";
import {
  OnCallTestPageSeverityOption,
  fromSeverityOptionValue,
  loadSeverityOptions,
} from "./OnCallTestPageSeverities";
import {
  CHANNEL_NAMES,
  COST_SENTENCES,
  WALK_UNREACHED_LEVELS,
  getNotPagedLines,
  getPersonWarnings,
  getReachedThroughWords,
  getWalkLevelHeading,
} from "./OnCallTestPageWords";
import TestPageResult from "./TestPageResult";
import { getNumberLocale } from "Common/Types/DateLanguage";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
  ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES,
  OnCallTestPageCost,
  OnCallTestPagePreview,
  OnCallTestPagePreviewLevel,
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
import Icon from "Common/UI/Components/Icon/Icon";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  ComposedValue,
  composedValue,
  formatList,
  getInlineSeparator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
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

/*
 * The line under the title: what a test does, and that nothing else
 * happens. A policy's says nothing of which levels it pages: that is the
 * "Walk every escalation level" choice's, below it (#7016).
 */
export function getTestPageDialogDescription(
  translator: Translator,
  target: OnCallTestPageTarget,
): string {
  if (target.kind === "policy") {
    return (
      translator.translateText(
        "It goes through each person's How to Reach Me for the severity you pick, as a real page would - without the waits. Every message says TEST. No incident is created, nothing shows on a status page, and no subscriber or channel is told.",
      ) || ""
    );
  }

  if (target.kind === "member") {
    return (
      translator.translateText(
        "It goes through their How to Reach Me for the severity you pick, as a real page would - without the waits. Every message says TEST. No incident is created, and nobody else is told.",
      ) || ""
    );
  }

  return (
    translator.translateText(
      "It goes through your How to Reach Me for the severity you pick, as a real page would - without the waits. Every message says TEST. No incident is created, and nobody else is told.",
    ) || ""
  );
}

/*
 * "Email · ana@example.com", "SMS (after 5 minutes on a real page)". The
 * address is set apart from the channel's name, so a phone number keeps
 * its own direction beside Persian or Arabic words: "+1 415 555 0100",
 * never "0100 555 415 +1".
 */
export function describePreviewMethod(
  translator: Translator,
  method: OnCallTestPagePreviewMethod,
): string {
  const channel: string =
    translator.translateText(CHANNEL_NAMES[method.channel]) ||
    CHANNEL_NAMES[method.channel];

  const name: string = method.address
    ? translator.translateTemplate(
        "{{channel}} · {{address}}",
        { channel: channel, address: method.address },
        { setsValuesApart: true },
      )
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

/*
 * The marks Intl writes into an amount in a language read from the right -
 * a left-to-right mark (U+200E) before Persian's "$", a right-to-left one
 * (U+200F) before Arabic's figure, an Arabic letter mark (U+061C) - taken
 * out: the cost sentence sets the amount apart itself, so it reads as one
 * figure wherever the sentence puts it.
 */
const AMOUNT_DIRECTION_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x200e, 0x200f, 0x061c)}]`,
  "g",
);

/*
 * An amount in US cents, in dollars as the reader writes money: "$0.35",
 * "0,35 $" in German, Persian's own digits ("$۰٫۳۵").
 */
export function formatTestPageAmount(
  translator: Translator,
  cents: number,
): string {
  const dollars: number = cents / 100;

  try {
    return new Intl.NumberFormat(getNumberLocale(translator.language), {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(dollars)
      .replace(AMOUNT_DIRECTION_MARKS, "");
  } catch {
    return `$${dollars.toFixed(2)}`;
  }
}

/*
 * How many of what a test sends the project's balance pays for, by channel
 * (#7263): an SMS or a call the project's own Twilio account sends is not.
 * A server from before #7263 says only what it sends, all read as paid.
 */
export function getTestPagePaidCounts(cost: OnCallTestPageCost): {
  sms: number;
  calls: number;
  whatsApp: number;
  telegram: number;
} {
  const paid: (count: number | undefined, sent: number) => number = (
    count: number | undefined,
    sent: number,
  ): number => {
    return typeof count === "number" ? count : sent;
  };

  return {
    sms: paid(cost.paidSmsCount, cost.smsCount),
    calls: paid(cost.paidCallCount, cost.callCount),
    whatsApp: paid(cost.paidWhatsAppCount, cost.whatsAppCount),
    telegram: paid(cost.paidTelegramCount, cost.telegramCount),
  };
}

/*
 * What a test sends that the project's balance pays for, as a sentence
 * lists it: "1 SMS", "3 SMS, 3 phone calls and 1 WhatsApp message" - the
 * last two joined as the reader's language joins them. Never what the
 * project's own Twilio account sends (#7263). Empty when it sends nothing
 * paid.
 */
export function getTestPageCostItems(
  translator: Translator,
  cost: OnCallTestPageCost,
): string {
  const paid: ReturnType<typeof getTestPagePaidCounts> =
    getTestPagePaidCounts(cost);
  const items: Array<string> = [];

  if (paid.sms > 0) {
    items.push(
      translator.translatePlural(
        { one: "{{count}} SMS", other: "{{count}} SMS" },
        paid.sms,
      ),
    );
  }

  if (paid.calls > 0) {
    items.push(
      translator.translatePlural(
        { one: "{{count}} phone call", other: "{{count}} phone calls" },
        paid.calls,
      ),
    );
  }

  if (paid.whatsApp > 0) {
    items.push(
      translator.translatePlural(
        {
          one: "{{count}} WhatsApp message",
          other: "{{count}} WhatsApp messages",
        },
        paid.whatsApp,
      ),
    );
  }

  if (paid.telegram > 0) {
    items.push(
      translator.translatePlural(
        {
          one: "{{count}} Telegram message",
          other: "{{count}} Telegram messages",
        },
        paid.telegram,
      ),
    );
  }

  if (items.length <= 1) {
    return items[0] || "";
  }

  return translator.translateTemplate("{{items}} and {{last}}", {
    items: formatList(items.slice(0, -1), translator),
    last: items[items.length - 1]!,
  });
}

/*
 * What a test costs, in a sentence, or empty when it costs nothing: the
 * first level's, or - for a test that walks every level - the most the
 * walk costs, nobody acknowledging it (#7016). It lists only what the
 * project's balance pays for (#7263), as it says. The list and the amount
 * are written in the sentence's language: the reader's, or English's while
 * the reader's has no wording of the sentence.
 */
export function describeTestPageCost(
  translator: Translator,
  cost: OnCallTestPageCost,
  options?: { isWalk?: boolean | undefined } | undefined,
): string {
  if (!cost.isPaid || !getTestPageCostItems(translator, cost)) {
    return "";
  }

  const sentences: { withAmount: string; withoutAmount: string } =
    options?.isWalk ? COST_SENTENCES.walk : COST_SENTENCES.firstLevel;

  const items: ComposedValue = composedValue((sentence: Translator): string => {
    return getTestPageCostItems(sentence, cost);
  });

  const cents: number | undefined = cost.estimatedCostInUSDCents;

  if (typeof cents === "number") {
    return translator.translateTemplate(
      sentences.withAmount,
      {
        items: items,
        amount: composedValue((sentence: Translator): string => {
          return formatTestPageAmount(sentence, cents);
        }),
      },
      { setsValuesApart: true },
    );
  }

  return translator.translateTemplate(
    sentences.withoutAmount,
    { items: items },
    { setsValuesApart: true },
  );
}

/*
 * Whether the test pages anybody: its first level - or, walking every
 * level, any level it reaches (a run moves past a level that pages nobody
 * at once).
 */
export function doesTestPageAnybody(
  preview: OnCallTestPagePreview | null,
  walksEscalation: boolean,
): boolean {
  if (!preview) {
    return false;
  }

  if (preview.people.length > 0) {
    return true;
  }

  return (
    walksEscalation &&
    (preview.walkLevels || []).some(
      (level: OnCallTestPagePreviewLevel): boolean => {
        return level.people.length > 0;
      },
    )
  );
}

/*
 * Whether "Walk every escalation level" is offered: for a policy with a
 * level after its first - or one whose server does not say how many it has.
 * Nothing is offered before the preview is read.
 */
export function isWalkOffered(
  target: OnCallTestPageTarget,
  preview: OnCallTestPagePreview | null,
): boolean {
  if (target.kind !== "policy" || !preview) {
    return false;
  }

  return !(typeof preview.levelCount === "number" && preview.levelCount <= 1);
}

// A level as the preview draws it: its people, and who it can't reach.
interface PreviewLevelWords {
  people: Array<OnCallTestPagePreviewPerson>;
  notPaged: Array<string>;
  notPagedCodes?: OnCallTestPagePreview["notPagedCodes"];
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
  const reachedThrough: string = getReachedThroughWords(translator, person);

  return (
    <li className="py-2" data-testid="test-page-preview-person">
      {props.showName ? (
        <p className="text-sm font-medium text-gray-900 break-words">
          {person.userName}
          {reachedThrough ? (
            <span
              className="font-normal text-gray-500"
              data-testid="test-page-preview-reached-through"
            >
              {getInlineSeparator(translator.language)}
              {reachedThrough}
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
      {getPersonWarnings(translator, person).map(
        (warning: string, index: number) => {
          return (
            <p
              key={`warning-${index}`}
              className="mt-1 text-sm text-amber-700"
              data-testid="test-page-preview-warning"
            >
              {warning}
            </p>
          );
        },
      )}
    </li>
  );
};

/*
 * One level: each person it pages, with how the test reaches them - and,
 * as a row of its own under them, each target of it that reaches nobody,
 * and why, so it is never read as one more line about the person above.
 */
const PreviewLevel: FunctionComponent<{
  level: PreviewLevelWords;
  showNames: boolean;
  dataTestId?: string | undefined;
}> = (props: {
  level: PreviewLevelWords;
  showNames: boolean;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const notPaged: Array<string> = getNotPagedLines(translator, props.level);

  return (
    <ul className="divide-y divide-gray-100" data-testid={props.dataTestId}>
      {props.level.people.map((person: OnCallTestPagePreviewPerson) => {
        return (
          <PreviewPerson
            key={person.userId}
            person={person}
            showName={props.showNames}
          />
        );
      })}
      {notPaged.length > 0 ? (
        <li className="flex flex-col gap-1 py-2">
          {notPaged.map((line: string, index: number) => {
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
        </li>
      ) : (
        <></>
      )}
    </ul>
  );
};

/*
 * A test that walks every level (#7016), drawn as the policy's escalation
 * is (EscalationSummary): a line down a numbered marker for each level it
 * reaches before it ends, under when it is paged - and, where the test
 * ends with levels left, how many it never reaches.
 */
const WalkPreview: FunctionComponent<{
  preview: OnCallTestPagePreview;
}> = (props: { preview: OnCallTestPagePreview }): ReactElement => {
  const translator: Translator = useTranslator();
  const preview: OnCallTestPagePreview = props.preview;
  const levels: Array<
    PreviewLevelWords & { order: number; startsAfterMinutes: number }
  > = [
    {
      order: 1,
      startsAfterMinutes: 0,
      people: preview.people,
      notPaged: preview.notPaged,
      notPagedCodes: preview.notPagedCodes,
    },
    ...(preview.walkLevels || []),
  ];
  const unreached: number = preview.walkUnreachedLevelCount || 0;

  return (
    <ol className="flex flex-col" data-testid="test-page-walk">
      {levels.map((level: (typeof levels)[number], index: number) => {
        // A line runs on to the next level, or to where the test ends.
        const hasNext: boolean = index < levels.length - 1 || unreached > 0;

        return (
          <li
            key={level.order}
            className="relative flex gap-3"
            data-testid="test-page-walk-level"
          >
            {hasNext ? (
              <span
                aria-hidden="true"
                className="absolute start-[11.5px] top-7 bottom-1 w-px bg-gray-200"
                data-testid="test-page-walk-line"
              />
            ) : (
              <></>
            )}
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white"
              data-testid="test-page-walk-marker"
            >
              {translator.formatNumber(level.order)}
            </span>
            <div className={`min-w-0 flex-1 ${hasNext ? "pb-4" : ""}`}>
              <h4
                className="pt-0.5 text-sm font-semibold text-gray-900"
                data-testid="test-page-walk-level-heading"
              >
                {getWalkLevelHeading(translator, level)}
              </h4>
              <PreviewLevel
                level={level}
                showNames={true}
                dataTestId={level.order === 1 ? "test-page-preview" : undefined}
              />
            </div>
          </li>
        );
      })}
      {unreached > 0 ? (
        <li className="flex gap-3" data-testid="test-page-walk-unreached">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 ring-1 ring-inset ring-gray-200"
          >
            <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 text-gray-500" />
          </span>
          <p className="min-w-0 flex-1 pt-0.5 text-sm text-gray-600">
            {translator.translatePlural(WALK_UNREACHED_LEVELS, unreached, {
              minutes: translator.formatNumber(
                ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
              ),
            })}
          </p>
        </li>
      ) : (
        <></>
      )}
    </ol>
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
            {
              minutes: translator.formatNumber(
                ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
              ),
            },
          ) || ""
        }
        onClose={props.onClose}
        /*
         * One button, Done: a Cancel beside it would read as cancelling the
         * test, which closing the dialog does not do. Drawn plain, as every
         * way out of a dialog is (DialogPrimaryActionGuard): it only closes.
         */
        closeButtonText="Done"
        closeButtonStyleType={ButtonStyleType.NORMAL}
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

  /*
   * A policy's test walks every level only where that is offered (a policy
   * of one level has nothing to walk) and asked for. Shown level by level,
   * and priced as the walk, once the server says what the walk reaches.
   */
  const offersWalk: boolean = isWalkOffered(props.target, preview);
  const isWalking: boolean = offersWalk && walksEscalation;

  const showsWalk: boolean = Boolean(
    isWalking && preview && Array.isArray(preview.walkLevels),
  );

  const costSentence: string = preview
    ? showsWalk && preview.walkCost
      ? describeTestPageCost(translator, preview.walkCost, { isWalk: true })
      : describeTestPageCost(translator, preview.cost)
    : "";

  const hasAnybodyToPage: boolean = doesTestPageAnybody(preview, isWalking);

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
        walksEscalation: isWalking,
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

        {offersWalk ? (
          <CheckboxElement
            title={
              translator.translateText("Walk every escalation level") || ""
            }
            description={translator.translateTemplate(
              "Pages each level in turn, up to {{minutes}} minutes apart, until someone acknowledges. Off, it pages the first level only.",
              {
                minutes: translator.formatNumber(
                  ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES,
                ),
              },
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
          ) : preview && showsWalk ? (
            <WalkPreview preview={preview} />
          ) : preview ? (
            <PreviewLevel
              level={preview}
              showNames={props.target.kind === "policy"}
              dataTestId="test-page-preview"
            />
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
