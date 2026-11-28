import {
  ANYONE_COULD_READ,
  BREACH_LAWS,
  CHECK_CLOSE,
  CHECK_REPORT,
  CHECK_ROTATE,
  CHECK_WHO_READ,
  CHECKLIST,
  COUNTED_FROM,
  DUE_FIRST,
  EARLIER_PERIODS,
  EXPOSURE_CARD_PLACE,
  EXPOSURE_TEST_IDS,
  HOW_LONG,
  IF_PEOPLE_LIVE_ELSEWHERE,
  INCLUDES_CHILDREN,
  LESS_THAN_AN_HOUR,
  MORE_SECRETS,
  NO_SECRETS,
  NO_TASK,
  NO_WINDOW,
  NOT_COVERED,
  NOT_LEGAL_ADVICE,
  NOTHING_DUE_DESCRIPTION,
  NOTHING_DUE_TITLE,
  NOTHING_FOUND_IN_IT,
  OPEN_DAYS,
  OPEN_HOURS,
  OPEN_TASKS,
  OPEN_UNTIL_NOW,
  OUTSIDE_ACCOUNTS,
  OUTSIDE_ACCOUNTS_USED,
  PEOPLE_ARE,
  SECRET_REMOVED,
  SECRET_STILL_THERE,
  SECRETS_TO_ROTATE,
  SHOW_FEWER_LAWS,
  SHOW_MORE_LAWS,
  SINCE_CHANGE,
  SINCE_FOUND,
  SPECIAL_CATEGORIES,
  STILL_OPEN,
  TASK_DONE,
  TASK_TO_DO,
  UNTIL_CHANGE,
  UNTIL_CLOSED_BY_CHANGE,
  UNTIL_RESPONSE,
  UNTIL_SCAN,
  WAS_IT_A_BREACH,
  WAS_IT_A_BREACH_DESCRIPTION,
  WHO_READ_FROM_OUTSIDE,
  WHOSE_DATA,
  LOGS_READ_TOAST,
  LOGS_UNREADABLE,
  READ_ACCESS_LOGS,
  READ_LOGS_AGAIN,
  HIDE_STATE_LAWS,
  SHOW_STATE_LAWS,
  STATES_NOT_APPLYING,
  US_STATE_LAWS,
  US_STATE_LAWS_MAY_APPLY,
  US_STATE_LAWS_SAY_WHICH,
} from "./ExposureAssessmentCopy";
import {
  ObligationGroups,
  StateObligations,
  answerChecklistItem,
  describeDeadline,
  describeDueDate,
  describeLaw,
  describeLogPrincipal,
  describeLogReads,
  describePlaces,
  describeRecords,
  getReadsLine,
  groupObligations,
  readDue,
  DueReading,
  DueState,
  LogReadsWords,
  say,
} from "./ExposureAssessmentModel";
import ExposureObligationRow, {
  ObligationStatusPill,
} from "./ExposureObligationRow";
import ExposurePeoplePlaces from "./ExposurePeoplePlaces";
import ExposureDataOwner from "./ExposureDataOwner";
import DataSecurityApi from "../../DataSecurity/DataSecurityApi";
import { getCountryName } from "../../DataSecurity/ComplianceFacts";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { ExposureLogPrincipal } from "Common/Types/DataSecurity/AccessLogReads";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import {
  BREACH_PLACE_CHOICES,
  BreachLawRule,
  BreachPlace,
  getBreachLawRule,
} from "Common/Types/DataSecurity/BreachLaws";
import { DataSecurityExposureAssessmentResponse } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  BreachObligation,
  ExposureAssessmentView,
  ExposureDataHeldFor,
  ExposureDataType,
  ExposureReadsLogged,
  ExposureSecret,
  ExposureWindow,
  ExposureWindowEndKind,
  ExposureWindowStartKind,
  UNCOVERED_LAW_WORDS,
  UncoveredLaw,
} from "Common/Types/DataSecurity/ExposureAssessment";
import {
  ExposureChecklistAnswer,
  ExposureChecklistItem,
} from "Common/Types/DataSecurity/ExposureChecklist";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  Translator,
  composedValue,
  formatList,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * WAS IT A BREACH? (#10377) What plain code worked out of a case's exposure,
 * in the order a person needs it:
 *
 *   1. that it is not legal advice, and nothing is sent from here;
 *   2. the law due first - what it asks, its deadline in its own units, when
 *      that is and how far off - or, while nobody knows where the people
 *      live, that question; or that no law of the table asks for a notice;
 *   3. whether reads were logged: "Reads were not logged. Treat the data as
 *      read." where that applies, and who could read it, counted;
 *   4. how long the store was open, whose data it was, the secrets to rotate;
 *   5. every law of the table: those that may apply, those that may if any
 *      of the people live elsewhere, and - folded - those not in force yet
 *      or not triggered, each with its details one click away; then what
 *      the table does not cover, in plain words;
 *   6. where the people live, as the data shows and as a person said;
 *   7. the case's checklist (the Close a Data Exposure playbook's tasks),
 *      each line answered, linked to the case's Tasks.
 */

export interface ComponentProps {
  caseId: ObjectID;
  answer: DataSecurityExposureAssessmentResponse;
  onChanged: (answer: DataSecurityExposureAssessmentResponse) => void;
}

const HEADING_CLASS_NAME: string = "text-sm font-semibold text-gray-900";
const SECTION_CLASS_NAME: string = "space-y-3 border-t border-gray-100 pt-5";

const DOT: ReactElement = (
  <span aria-hidden="true" className="text-gray-400">
    <InlineSeparator markOnly />
  </span>
);

function describeWindowLength(
  window: ExposureWindow,
  translator: Translator,
): string {
  if (window.days >= 1) {
    return translator.translatePlural(OPEN_DAYS, window.days);
  }

  if (window.hours >= 1) {
    return translator.translatePlural(OPEN_HOURS, window.hours);
  }

  return say(translator, LESS_THAN_AN_HOUR);
}

function when(value: string | undefined): string {
  return value
    ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(value)
    : "";
}

// The operation a cloud's log recorded, drawn as code inside its sentence.
function OperationLine(props: {
  template: string;
  date: string;
  operation: string;
}): ReactElement {
  return (
    <TranslatedSentence
      template={props.template}
      values={{ date: props.date }}
      slots={{
        operation: (
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]">
            {props.operation}
          </code>
        ),
      }}
    />
  );
}

const WindowSection: FunctionComponent<{
  window: ExposureWindow | null;
}> = (props: { window: ExposureWindow | null }): ReactElement => {
  const translator: Translator = useTranslator();
  const window: ExposureWindow | null = props.window;

  return (
    <section className="space-y-2" data-testid={EXPOSURE_TEST_IDS.window}>
      <h3 className={HEADING_CLASS_NAME}>{say(translator, HOW_LONG)}</h3>
      {window ? (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-2xl font-semibold text-gray-900">
              {describeWindowLength(window, translator)}
            </span>
            {window.isStillOpen ? (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                {say(translator, STILL_OPEN)}
              </span>
            ) : (
              <></>
            )}
          </p>
          <ul className="space-y-1 text-sm text-gray-700">
            <li>
              {window.startKind === ExposureWindowStartKind.Change &&
              window.startOperation ? (
                <OperationLine
                  template={SINCE_CHANGE}
                  date={when(window.start)}
                  operation={window.startOperation}
                />
              ) : (
                translator.translateTemplate(SINCE_FOUND, {
                  date: when(window.start),
                })
              )}
            </li>
            <li>
              {window.endKind === ExposureWindowEndKind.StillOpen ? (
                say(translator, OPEN_UNTIL_NOW)
              ) : window.endKind === ExposureWindowEndKind.Change &&
                window.endOperation ? (
                <OperationLine
                  template={UNTIL_CHANGE}
                  date={when(window.end)}
                  operation={window.endOperation}
                />
              ) : (
                translator.translateTemplate(
                  window.endKind === ExposureWindowEndKind.ResponseAction
                    ? UNTIL_RESPONSE
                    : window.endKind === ExposureWindowEndKind.Change
                      ? UNTIL_CLOSED_BY_CHANGE
                      : UNTIL_SCAN,
                  { date: when(window.end) },
                )
              )}
            </li>
            {window.earlierPeriods.length > 0 ? (
              <li className="text-gray-600">
                {translator.translatePlural(
                  EARLIER_PERIODS,
                  window.earlierPeriods.length,
                )}
              </li>
            ) : (
              <></>
            )}
          </ul>
        </>
      ) : (
        <p className="text-sm text-gray-600">{say(translator, NO_WINDOW)}</p>
      )}
    </section>
  );
};

const WhoseSection: FunctionComponent<{
  view: ExposureAssessmentView;
}> = (props: { view: ExposureAssessmentView }): ReactElement => {
  const translator: Translator = useTranslator();
  const whose: ExposureAssessmentView["whose"] = props.view.whose;
  const records: string = describeRecords(whose.records, translator);

  return (
    <section className="space-y-2" data-testid={EXPOSURE_TEST_IDS.whose}>
      <h3 className={HEADING_CLASS_NAME}>{say(translator, WHOSE_DATA)}</h3>
      {whose.dataTypes.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {whose.dataTypes.map((type: ExposureDataType): ReactElement => {
            return (
              <li
                key={type.id}
                className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800"
              >
                {type.id.startsWith("custom:") ? (
                  <IsolatedText text={type.name} />
                ) : (
                  say(translator, type.name)
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">
          {say(translator, NOTHING_FOUND_IN_IT)}
        </p>
      )}
      <ul className="space-y-1 text-sm text-gray-700">
        {records ? <li>{records}</li> : <></>}
        {whose.people.length > 0 ? (
          <li>
            {translator.translateTemplate(PEOPLE_ARE, {
              people: composedValue((sentence: Translator): string => {
                return formatList(
                  whose.people.map((people: string): string => {
                    return say(sentence, people);
                  }),
                  sentence,
                );
              }),
            })}
          </li>
        ) : (
          <></>
        )}
        {whose.specialCategories.length > 0 ? (
          <li className="font-medium text-gray-900">
            {translator.translateTemplate(SPECIAL_CATEGORIES, {
              categories: composedValue((sentence: Translator): string => {
                return formatList(
                  whose.specialCategories.map((category: string): string => {
                    return say(sentence, category);
                  }),
                  sentence,
                );
              }),
            })}
          </li>
        ) : (
          <></>
        )}
        {whose.includesChildren ? (
          <li className="font-medium text-gray-900">
            {say(translator, INCLUDES_CHILDREN)}
          </li>
        ) : (
          <></>
        )}
      </ul>
    </section>
  );
};

const SecretsSection: FunctionComponent<{
  view: ExposureAssessmentView;
}> = (props: { view: ExposureAssessmentView }): ReactElement => {
  const translator: Translator = useTranslator();
  const secrets: Array<ExposureSecret> = props.view.secretsToRotate;

  return (
    <section className="space-y-2" data-testid={EXPOSURE_TEST_IDS.secrets}>
      <h3 className={HEADING_CLASS_NAME}>
        {say(translator, SECRETS_TO_ROTATE)}
      </h3>
      {secrets.length > 0 ? (
        <ul className="space-y-2">
          {secrets.map((secret: ExposureSecret): ReactElement => {
            return (
              <li
                key={`${secret.dataTypeId}:${secret.location}`}
                className="space-y-0.5 text-sm"
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium text-gray-900">
                    {secret.dataTypeId.startsWith("custom:") ? (
                      <IsolatedText text={secret.dataTypeName} />
                    ) : (
                      say(translator, secret.dataTypeName)
                    )}
                  </span>
                  <span
                    className={
                      secret.isStillThere
                        ? "text-xs font-medium text-red-700"
                        : "text-xs text-gray-500"
                    }
                  >
                    {say(
                      translator,
                      secret.isStillThere ? SECRET_STILL_THERE : SECRET_REMOVED,
                    )}
                  </span>
                </p>
                {secret.location ? (
                  <code className="block rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]">
                    {secret.location}
                  </code>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
          {props.view.hasMoreSecrets ? (
            <li className="text-sm text-gray-600">
              {say(translator, MORE_SECRETS)}
            </li>
          ) : (
            <></>
          )}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">{say(translator, NO_SECRETS)}</p>
      )}
    </section>
  );
};

// The law due first, and its clock.
const DueFirst: FunctionComponent<{
  obligation: BreachObligation;
  rule: BreachLawRule;
  now: Date;
}> = (props: {
  obligation: BreachObligation;
  rule: BreachLawRule;
  now: Date;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const due: DueReading | null = readDue(props.obligation.dueAt, props.now);
  const ground: string =
    due?.state === DueState.Overdue
      ? "bg-red-50"
      : due?.state === DueState.DueSoon
        ? "bg-amber-50"
        : "bg-gray-50";

  return (
    <div
      className={`space-y-2 rounded-lg p-4 ${ground}`}
      data-testid={EXPOSURE_TEST_IDS.headline}
      data-rule={props.obligation.ruleId}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            {say(translator, DUE_FIRST)}
          </p>
          <h3 className="text-lg font-semibold text-gray-900">
            {say(translator, props.rule.action)}
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-gray-700">
            <span className="font-medium">
              {describeLaw(props.rule, translator)}
            </span>
            {DOT}
            <span>{describeDeadline(props.rule, translator)}</span>
          </p>
        </div>
        <ObligationStatusPill obligation={props.obligation} now={props.now} />
      </div>
      {props.obligation.dueAt ? (
        <p className="text-sm font-medium text-gray-900">
          {describeDueDate(props.obligation, translator)}
        </p>
      ) : (
        <></>
      )}
      <p className="text-sm text-gray-700">
        {translator.translateTemplate(COUNTED_FROM, {
          date: when(props.obligation.foundAt),
        })}
      </p>
    </div>
  );
};

const ReadsLine: FunctionComponent<{
  caseId: ObjectID;
  answer: DataSecurityExposureAssessmentResponse;
  onChanged: (answer: DataSecurityExposureAssessmentResponse) => void;
}> = (props: {
  caseId: ObjectID;
  answer: DataSecurityExposureAssessmentResponse;
  onChanged: (answer: DataSecurityExposureAssessmentResponse) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const view: ExposureAssessmentView = props.answer.view!;
  const reads: ExposureAssessmentView["reads"] = view.reads;
  const isTreatedAsRead: boolean = reads.isTreatedAsRead;
  const [isReadingLogs, setIsReadingLogs] = useState<boolean>(false);
  const [logsError, setLogsError] = useState<string>("");
  // What the store's own access logs say, once OneUptime read them (#10951).
  const fromLogs: LogReadsWords | null = describeLogReads(reads, translator);
  const isReadFromLogs: boolean = Boolean(
    fromLogs && !fromLogs.isUnread && !fromLogs.isOlderWindow,
  );
  /*
   * Its logs can be read: an S3 bucket whose reads are logged, by someone
   * who may change the assessment.
   */
  const canReadLogs: boolean =
    props.answer.canChange &&
    reads.logged === ExposureReadsLogged.Logged &&
    view.store.kind === DataStoreKind.AwsS3Bucket;
  const principals: Array<ExposureLogPrincipal> =
    isReadFromLogs && reads.fromLogs ? reads.fromLogs.outsidePrincipals : [];

  const readLogs: () => Promise<void> = async (): Promise<void> => {
    setIsReadingLogs(true);
    setLogsError("");

    try {
      props.onChanged(await DataSecurityApi.readExposureLogs(props.caseId));
      Toast.success(say(translator, LOGS_READ_TOAST));
    } catch (err) {
      setLogsError(API.getFriendlyMessage(err));
    } finally {
      setIsReadingLogs(false);
    }
  };

  return (
    <div
      className={
        isTreatedAsRead
          ? "flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
          : "flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2.5 text-sm text-gray-800"
      }
      data-testid={EXPOSURE_TEST_IDS.reads}
      data-logged={reads.logged}
      data-from-logs={isReadFromLogs ? "true" : "false"}
    >
      <Icon
        icon={
          reads.logged === ExposureReadsLogged.Logged
            ? IconProp.Eye
            : IconProp.ExclaimationCircle
        }
        className="mt-0.5 h-4 w-4 flex-none"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium">
          {isReadFromLogs && fromLogs
            ? fromLogs.headline
            : say(translator, getReadsLine(reads.logged))}
        </p>
        {isReadFromLogs && fromLogs ? (
          fromLogs.details.map((line: string): ReactElement => {
            return <p key={line}>{line}</p>;
          })
        ) : (
          <></>
        )}
        {fromLogs && !isReadFromLogs ? (
          <p data-testid={`${EXPOSURE_TEST_IDS.reads}-logs-note`}>
            {fromLogs.unreadableLocation ? (
              <TranslatedSentence
                template={LOGS_UNREADABLE}
                slots={{
                  location: (
                    <code className="rounded bg-white/60 px-1 py-0.5 font-mono text-xs [overflow-wrap:anywhere]">
                      {fromLogs.unreadableLocation}
                    </code>
                  ),
                }}
              />
            ) : (
              fromLogs.headline
            )}
          </p>
        ) : (
          <></>
        )}
        {reads.isPublic ? <p>{say(translator, ANYONE_COULD_READ)}</p> : <></>}
        {reads.outsideAccounts > 0 ? (
          <p>
            {translator.translatePlural(
              OUTSIDE_ACCOUNTS,
              reads.outsideAccounts,
            )}
          </p>
        ) : (
          <></>
        )}
        {reads.outsideAccountsUsedInWindow > 0 ? (
          <p>
            {translator.translatePlural(
              OUTSIDE_ACCOUNTS_USED,
              reads.outsideAccountsUsedInWindow,
            )}
          </p>
        ) : (
          <></>
        )}
        {/*
         * Who read it from outside, by name: only drawn for a reader the
         * server lets see who can reach the store - everyone else's answer
         * holds the counts alone.
         */}
        {principals.length > 0 ? (
          <div
            className="space-y-1 pt-2"
            data-testid={`${EXPOSURE_TEST_IDS.reads}-principals`}
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide">
              {say(translator, WHO_READ_FROM_OUTSIDE)}
            </h4>
            <ul className="space-y-1">
              {principals.map(
                (principal: ExposureLogPrincipal): ReactElement => {
                  return (
                    <li
                      key={principal.principal}
                      className="flex min-w-0 flex-col gap-x-2 sm:flex-row sm:flex-wrap sm:items-baseline"
                    >
                      <code className="min-w-0 rounded bg-white/60 px-1 py-0.5 font-mono text-xs [overflow-wrap:anywhere]">
                        {principal.principal}
                      </code>
                      <span className="text-xs">
                        {describeLogPrincipal(principal, translator)}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          </div>
        ) : (
          <></>
        )}
        {logsError ? <ErrorLine message={logsError} /> : <></>}
        {canReadLogs ? (
          <div className="pt-2">
            <Button
              title={reads.fromLogs ? READ_LOGS_AGAIN : READ_ACCESS_LOGS}
              icon={IconProp.Search}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              isLoading={isReadingLogs}
              dataTestId={EXPOSURE_TEST_IDS.readLogs}
              onClick={() => {
                void readLogs();
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

const CHECKLIST_LABELS: Readonly<Record<ExposureChecklistItem, string>> = {
  [ExposureChecklistItem.WhoReadIt]: CHECK_WHO_READ,
  [ExposureChecklistItem.MustReport]: CHECK_REPORT,
  [ExposureChecklistItem.RotateSecrets]: CHECK_ROTATE,
  [ExposureChecklistItem.CloseTheCase]: CHECK_CLOSE,
};

/*
 * THE US STATES' LAWS, WHILE NOBODY SAID WHICH STATES (#10952). Every state
 * has a breach law, so fifty states' rows would bury every other law on the
 * card: they are one block saying how many states' laws may apply and how
 * to narrow them, and each state's rows unfold under its name, in the
 * reader's alphabetical order.
 */
const StateLaws: FunctionComponent<{
  states: Array<StateObligations>;
  now: Date;
}> = (props: { states: Array<StateObligations>; now: Date }): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const listId: string = `${EXPOSURE_TEST_IDS.stateLaws}-list`;
  const states: Array<StateObligations> = [...props.states].sort(
    (a: StateObligations, b: StateObligations): number => {
      return say(translator, BREACH_PLACE_CHOICES[a.place]).localeCompare(
        say(translator, BREACH_PLACE_CHOICES[b.place]),
      );
    },
  );

  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid={EXPOSURE_TEST_IDS.stateLaws}
    >
      <div className="flex items-start gap-3">
        <Icon
          icon={IconProp.Scale}
          className="mt-0.5 h-5 w-5 flex-none text-gray-400"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <h5 className="text-sm font-semibold text-gray-900">
            {say(translator, US_STATE_LAWS)}
          </h5>
          <p className="text-sm text-gray-700">
            {translator.translatePlural(US_STATE_LAWS_MAY_APPLY, states.length)}{" "}
            {say(translator, US_STATE_LAWS_SAY_WHICH)}
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-expanded={isOpen}
            aria-controls={listId}
            data-testid={`${EXPOSURE_TEST_IDS.stateLaws}-toggle`}
            onClick={() => {
              setIsOpen(!isOpen);
            }}
          >
            <Icon
              icon={isOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
              className="h-4 w-4"
            />
            <span>
              {say(translator, isOpen ? HIDE_STATE_LAWS : SHOW_STATE_LAWS)}
            </span>
          </button>
        </div>
      </div>
      {isOpen ? (
        <div id={listId} className="mt-3 space-y-4 ps-8">
          {states.map((state: StateObligations): ReactElement => {
            return (
              <section
                key={state.place}
                aria-labelledby={`${listId}-${state.place}`}
                data-testid={`${EXPOSURE_TEST_IDS.stateLaws}-${state.place}`}
              >
                <h6
                  id={`${listId}-${state.place}`}
                  className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  {say(translator, BREACH_PLACE_CHOICES[state.place])}
                </h6>
                <ul className="divide-y divide-gray-100">
                  {state.obligations.map(
                    (obligation: BreachObligation): ReactElement => {
                      return (
                        <ExposureObligationRow
                          key={obligation.ruleId}
                          obligation={obligation}
                          now={props.now}
                        />
                      );
                    },
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const ExposureAssessmentCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showsAllLaws, setShowsAllLaws] = useState<boolean>(false);
  const view: ExposureAssessmentView = props.answer.view!;
  const now: Date = new Date(view.now);
  const groups: ObligationGroups = groupObligations(view);
  const dueFirstRule: BreachLawRule | undefined = groups.dueFirst
    ? getBreachLawRule(groups.dueFirst.ruleId)
    : undefined;
  const isPlaceAskedFirst: boolean = !groups.dueFirst && view.isPlaceUnknown;
  const isNothingDue: boolean =
    !groups.dueFirst &&
    !view.isPlaceUnknown &&
    groups.mayApply.length === 0 &&
    groups.ifPeopleLiveElsewhere.length === 0 &&
    groups.stateLawsIfPeopleLiveThere.length === 0;
  // The folded laws: each row not applying, and the states counted as one line each.
  const foldedCount: number = groups.folded.length + groups.statesNotApplying;
  const saidBy: string | undefined = props.answer.assessment?.peopleLiveIn
    ?.saidByUserId
    ? props.answer.editors[props.answer.assessment.peopleLiveIn.saidByUserId]
    : undefined;
  const tasksRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_CASE_VIEW_TASKS] as Route,
    { modelId: props.caseId },
  );

  const savePlaces: (places: Array<BreachPlace>) => Promise<void> = async (
    places: Array<BreachPlace>,
  ): Promise<void> => {
    props.onChanged(
      await DataSecurityApi.setExposurePeoplePlaces({
        securityCaseId: props.caseId,
        places,
      }),
    );
  };

  const places: ReactElement = (
    <ExposurePeoplePlaces
      key={props.answer.assessment?.peopleLiveIn?.saidAt || "none"}
      whose={view.whose}
      said={props.answer.assessment?.peopleLiveIn}
      saidByName={saidBy}
      canChange={props.answer.canChange}
      isAskedFirst={isPlaceAskedFirst}
      onSave={savePlaces}
    />
  );
  // Whether the organization holds the data for another (#11427), and who said it.
  const dataHeldFor: ExposureDataHeldFor | undefined =
    props.answer.assessment?.dataHeldFor;
  const heldForSaidBy: string | undefined = dataHeldFor?.saidByUserId
    ? props.answer.editors[dataHeldFor.saidByUserId]
    : undefined;
  const saveDataHeldFor: (forAnother: boolean) => Promise<void> = async (
    forAnother: boolean,
  ): Promise<void> => {
    props.onChanged(
      await DataSecurityApi.setExposureDataHeldFor({
        securityCaseId: props.caseId,
        forAnother,
      }),
    );
  };

  return (
    <Card
      id={EXPOSURE_CARD_PLACE}
      title={WAS_IT_A_BREACH}
      description={WAS_IT_A_BREACH_DESCRIPTION}
    >
      <div className="space-y-5" data-testid={EXPOSURE_TEST_IDS.card}>
        <p
          className="text-xs text-gray-600"
          data-testid={EXPOSURE_TEST_IDS.notLegalAdvice}
        >
          {say(translator, NOT_LEGAL_ADVICE)}
        </p>

        {groups.dueFirst && dueFirstRule ? (
          <DueFirst
            obligation={groups.dueFirst}
            rule={dueFirstRule}
            now={now}
          />
        ) : isPlaceAskedFirst ? (
          <div className="rounded-lg bg-amber-50 p-4">{places}</div>
        ) : isNothingDue ? (
          <div
            className="flex items-start gap-3 rounded-lg bg-emerald-50 p-4"
            data-testid={EXPOSURE_TEST_IDS.headline}
          >
            <Icon
              icon={IconProp.CheckCircle}
              className="mt-0.5 h-5 w-5 flex-none text-emerald-600"
            />
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-gray-900">
                {say(translator, NOTHING_DUE_TITLE)}
              </h3>
              <p className="text-sm text-gray-700">
                {say(translator, NOTHING_DUE_DESCRIPTION)}
              </p>
            </div>
          </div>
        ) : (
          <></>
        )}

        <ReadsLine
          caseId={props.caseId}
          answer={props.answer}
          onChanged={props.onChanged}
        />

        <div className="grid gap-6 border-t border-gray-100 pt-5 [container-type:inline-size] md:grid-cols-3">
          <WindowSection window={view.window} />
          <WhoseSection view={view} />
          <SecretsSection view={view} />
        </div>

        <section
          className={SECTION_CLASS_NAME}
          data-testid={EXPOSURE_TEST_IDS.laws}
        >
          <h3 className={HEADING_CLASS_NAME}>{say(translator, BREACH_LAWS)}</h3>
          {groups.mayApply.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {groups.mayApply.map(
                (obligation: BreachObligation): ReactElement => {
                  return (
                    <ExposureObligationRow
                      key={obligation.ruleId}
                      obligation={obligation}
                      now={now}
                    />
                  );
                },
              )}
            </ul>
          ) : (
            <></>
          )}
          {groups.ifPeopleLiveElsewhere.length > 0 ||
          groups.stateLawsIfPeopleLiveThere.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {say(translator, IF_PEOPLE_LIVE_ELSEWHERE)}
              </h4>
              {groups.ifPeopleLiveElsewhere.length > 0 ? (
                <ul className="divide-y divide-gray-100">
                  {groups.ifPeopleLiveElsewhere.map(
                    (obligation: BreachObligation): ReactElement => {
                      return (
                        <ExposureObligationRow
                          key={obligation.ruleId}
                          obligation={obligation}
                          now={now}
                        />
                      );
                    },
                  )}
                </ul>
              ) : (
                <></>
              )}
              {groups.stateLawsIfPeopleLiveThere.length > 0 ? (
                <StateLaws
                  states={groups.stateLawsIfPeopleLiveThere}
                  now={now}
                />
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
          {showsAllLaws && foldedCount > 0 ? (
            <div id={`${EXPOSURE_TEST_IDS.moreLaws}-list`}>
              {groups.folded.length > 0 ? (
                <ul className="divide-y divide-gray-100">
                  {groups.folded.map(
                    (obligation: BreachObligation): ReactElement => {
                      return (
                        <ExposureObligationRow
                          key={obligation.ruleId}
                          obligation={obligation}
                          now={now}
                        />
                      );
                    },
                  )}
                </ul>
              ) : (
                <></>
              )}
              {groups.statesNotApplying > 0 ? (
                <p
                  className="py-3 text-sm text-gray-600"
                  data-testid={EXPOSURE_TEST_IDS.statesNotApplying}
                >
                  {translator.translatePlural(
                    STATES_NOT_APPLYING,
                    groups.statesNotApplying,
                  )}
                </p>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
          {foldedCount > 0 ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-expanded={showsAllLaws}
              aria-controls={`${EXPOSURE_TEST_IDS.moreLaws}-list`}
              data-testid={EXPOSURE_TEST_IDS.moreLaws}
              onClick={() => {
                setShowsAllLaws(!showsAllLaws);
              }}
            >
              <Icon
                icon={showsAllLaws ? IconProp.ChevronUp : IconProp.ChevronDown}
                className="h-4 w-4"
              />
              <span>
                {showsAllLaws
                  ? say(translator, SHOW_FEWER_LAWS)
                  : translator.translatePlural(SHOW_MORE_LAWS, foldedCount)}
              </span>
            </button>
          ) : (
            <></>
          )}
          {view.uncovered.length > 0 ? (
            <div
              className="space-y-1"
              data-testid={EXPOSURE_TEST_IDS.uncovered}
            >
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {say(translator, NOT_COVERED)}
              </h4>
              <ul className="list-disc space-y-1 ps-5 text-sm text-gray-700">
                {view.uncovered.map((law: UncoveredLaw): ReactElement => {
                  return (
                    <li key={law.kind}>
                      {translator.translateTemplate(
                        UNCOVERED_LAW_WORDS[law.kind],
                        {
                          countries: composedValue(
                            (sentence: Translator): string => {
                              return formatList(
                                (law.countries || []).map(
                                  (country: string): string => {
                                    return getCountryName(country, sentence);
                                  },
                                ),
                                sentence,
                              );
                            },
                          ),
                          states: composedValue(
                            (sentence: Translator): string => {
                              return describePlaces(law.states || [], sentence);
                            },
                          ),
                        },
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <></>
          )}
        </section>

        {isPlaceAskedFirst ? (
          <></>
        ) : (
          <div className={SECTION_CLASS_NAME}>{places}</div>
        )}

        <div className={SECTION_CLASS_NAME}>
          <ExposureDataOwner
            said={dataHeldFor}
            saidByName={heldForSaidBy}
            canChange={props.answer.canChange}
            onSave={saveDataHeldFor}
          />
        </div>

        <section
          className={SECTION_CLASS_NAME}
          data-testid={EXPOSURE_TEST_IDS.checklist}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className={HEADING_CLASS_NAME}>{say(translator, CHECKLIST)}</h3>
            <Link
              to={tasksRoute}
              className="text-sm font-medium text-indigo-600 hover:underline"
              dataTestId={`${EXPOSURE_TEST_IDS.checklist}-tasks`}
            >
              {say(translator, OPEN_TASKS)}
            </Link>
          </div>
          <ul className="divide-y divide-gray-100">
            {props.answer.checklist.map(
              (line: ExposureChecklistAnswer): ReactElement => {
                const state: string = !line.taskId
                  ? NO_TASK
                  : line.isDone
                    ? TASK_DONE
                    : TASK_TO_DO;

                return (
                  <li
                    key={line.item}
                    className="flex items-start gap-3 py-2.5"
                    data-testid={`${EXPOSURE_TEST_IDS.checklist}-${line.item}`}
                    data-done={line.isDone ? "true" : "false"}
                  >
                    <Icon
                      icon={
                        line.isDone ? IconProp.CheckCircle : IconProp.Circle
                      }
                      className={
                        line.isDone
                          ? "mt-0.5 h-5 w-5 flex-none text-emerald-600"
                          : "mt-0.5 h-5 w-5 flex-none text-gray-400"
                      }
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                        <span className="font-medium text-gray-900">
                          {say(translator, CHECKLIST_LABELS[line.item])}
                        </span>
                        <span className="text-xs text-gray-500">
                          {say(translator, state)}
                        </span>
                      </p>
                      <p className="text-sm text-gray-700">
                        {answerChecklistItem({
                          item: line.item,
                          view,
                          assessment: props.answer.assessment,
                          translator,
                        })}
                      </p>
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        </section>
      </div>
    </Card>
  );
};

export default ExposureAssessmentCard;
