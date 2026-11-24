import FixProductionVerdict from "../AI/FixProductionVerdict";
import { DeclaredCodeChangeMark } from "../AutoRemediation/DeclaredCodeChangeLine";
import {
  DECLARED_CODE_ANSWER,
  DECLARED_CODE_CHANGE_POLL_MS,
  DECLARED_CODE_UNNAMED_REPOSITORY,
  DECLARED_CODE_VIEW_PROGRESS,
  DECLARED_CODE_VIEW_PULL_REQUEST,
  DECLARED_CODE_VIEW_PULL_REQUEST_NUMBER,
  DECLARED_CODE_VIEW_TASK,
} from "../AutoRemediation/DeclaredCodeChangeWords";
import DataSecurityApi from "./DataSecurityApi";
import {
  CODE_FIX_ISSUES,
  CODE_FIX_ISSUES_OF_SERVICE,
  ISSUE_CODE_FIX_TEST_ID,
  IssueCodeFixWords,
  LEAK_HEADING,
  SECRET_LAST_SEEN,
  SECRET_SIGHTINGS_SENTENCE,
  SECRET_SIGHTINGS_TITLE,
  getIssueCodeFixWords,
} from "./TelemetryFixCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import FixProductionReport, {
  parseFixProductionReport,
} from "Common/Types/AI/FixProductionReport";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import {
  DataSecurityIssueCodeFixJSON,
  DataSecurityIssueCodeFixResult,
  DataSecuritySecretSighting,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { DeclaredCodeChangeState } from "Common/Utils/AiRemediation/DeclaredCodeChange";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  Translator,
  getInlineSeparator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHERE THE ISSUE'S FIX IN CODE STANDS (#10367): THE ISSUE KEEPS ITS FIX.
 *
 * On the issue's How to Fix card, once a fix in code was asked for - by Fix
 * with AI, by the one pull request that stops its service writing all of
 * its telemetry leaks, or for its group's cause - where it stands, read
 * for the reader (DataSecurityIssueCodeFix): a mark in the colours of a
 * fix in code beside a remediation step, a sentence - being written, open,
 * merged, closed, waiting for their answer, ended or failed - and what to
 * do: View progress while it is written (read again every few seconds),
 * View pull request once it is open, Answer in Code while it waits, View
 * task after. Once merged, what production showed (FixProductionVerdict,
 * #10368). A task the reader may not open is said to be there, behind a
 * lock, and nothing more.
 *
 * For a secret's issue, where the secret was seen: a code fix stops new
 * copies only, and a person rotates it.
 *
 * Nothing is drawn for an issue with neither.
 */

export interface ComponentProps {
  issueId: ObjectID;
  refreshToggle?: boolean | string | number | undefined;
}

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// The task's link, in the words of what is to do with it now.
function getTaskLinkWords(state: string): string {
  if (state === DeclaredCodeChangeState.Writing) {
    return DECLARED_CODE_VIEW_PROGRESS;
  }

  if (state === DeclaredCodeChangeState.WaitingForYou) {
    return DECLARED_CODE_ANSWER;
  }

  return DECLARED_CODE_VIEW_TASK;
}

// When, in the reader's zone and language.
function timeOf(at: string | undefined): string {
  if (!at) {
    return "";
  }

  const date: Date = new Date(at);

  return Number.isNaN(date.getTime())
    ? ""
    : OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
}

// The fix's line: its mark, its sentence, its links and, once merged, production.
const FixLine: FunctionComponent<{
  fix: DataSecurityIssueCodeFixJSON;
}> = (props: { fix: DataSecurityIssueCodeFixJSON }): ReactElement => {
  const translator: Translator = useTranslator();
  const fix: DataSecurityIssueCodeFixJSON = props.fix;
  const words: IssueCodeFixWords = getIssueCodeFixWords(fix);
  const isHidden: boolean = fix.state === DeclaredCodeChangeState.Hidden;
  const repository: string =
    fix.repositoryName ||
    translator.translateText(DECLARED_CODE_UNNAMED_REPOSITORY) ||
    DECLARED_CODE_UNNAMED_REPOSITORY;
  const production: FixProductionReport | undefined =
    fix.pullRequest?.state === "merged"
      ? parseFixProductionReport(fix.pullRequest.production)
      : undefined;

  return (
    <div
      className="flex items-start gap-2"
      data-testid={`${ISSUE_CODE_FIX_TEST_ID}-line`}
      data-state={fix.state}
      data-pull-request-state={fix.pullRequest?.state || ""}
    >
      {isHidden ? (
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-gray-100 text-gray-500"
        >
          <Icon icon={IconProp.Lock} className="h-2.5 w-2.5" />
        </span>
      ) : (
        <DeclaredCodeChangeMark tone={words.tone} />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p
          className="break-words text-sm text-gray-700"
          data-testid={`${ISSUE_CODE_FIX_TEST_ID}-text`}
        >
          {isHidden
            ? translator.translateText(words.sentence)
            : translator.translateTemplate(
                words.sentence,
                { repository },
                // A repository's Latin name keeps its place in a Persian sentence.
                { setsValuesApart: true },
              )}
        </p>
        {!isHidden && fix.issueCount > 1 ? (
          <p className="text-xs text-gray-500">
            {fix.serviceName
              ? translator.translatePlural(
                  CODE_FIX_ISSUES_OF_SERVICE,
                  fix.issueCount,
                  { service: fix.serviceName },
                  { setsValuesApart: true },
                )
              : translator.translatePlural(CODE_FIX_ISSUES, fix.issueCount)}
          </p>
        ) : (
          <></>
        )}
        {!isHidden ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {fix.pullRequest?.url ? (
              <a
                href={fix.pullRequest.url}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS_NAME}
                data-testid={`${ISSUE_CODE_FIX_TEST_ID}-pull-request`}
              >
                <span>
                  {fix.pullRequest.number ? (
                    <TranslatedSentence
                      template={DECLARED_CODE_VIEW_PULL_REQUEST_NUMBER}
                      slots={{
                        number: (
                          <span dir="ltr">#{fix.pullRequest.number}</span>
                        ),
                      }}
                    />
                  ) : (
                    translator.translateText(DECLARED_CODE_VIEW_PULL_REQUEST)
                  )}
                </span>
                <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
              </a>
            ) : (
              <></>
            )}
            {fix.taskId ? (
              <Link
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CODE_TASK_VIEW] as Route,
                  { modelId: new ObjectID(fix.taskId) },
                )}
                className={LINK_CLASS_NAME}
                dataTestId={`${ISSUE_CODE_FIX_TEST_ID}-task`}
              >
                <>{translator.translateText(getTaskLinkWords(fix.state))}</>
              </Link>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
        {production ? (
          <FixProductionVerdict
            production={production}
            testId={`${ISSUE_CODE_FIX_TEST_ID}-production`}
            className="mt-2"
          />
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

// A secret's issue: where the secret was seen, to rotate it.
const SecretSightings: FunctionComponent<{
  sightings: Array<DataSecuritySecretSighting>;
}> = (props: {
  sightings: Array<DataSecuritySecretSighting>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900"
      data-testid={`${ISSUE_CODE_FIX_TEST_ID}-rotate`}
    >
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <Icon icon={IconProp.Key} className="h-4 w-4 flex-none" />
        <span>{translator.translateText(SECRET_SIGHTINGS_TITLE)}</span>
      </h4>
      <p className="mt-1 text-sm">
        {translator.translateText(SECRET_SIGHTINGS_SENTENCE)}
      </p>
      <ul className="mt-2 space-y-1.5">
        {props.sightings.map(
          (
            sighting: DataSecuritySecretSighting,
            index: number,
          ): ReactElement => {
            const lastSeen: string = timeOf(sighting.lastSeenAt);

            return (
              <li
                key={`${sighting.location}-${index}`}
                className="text-sm [overflow-wrap:anywhere]"
              >
                <TranslatedSentence
                  template={LEAK_HEADING}
                  slots={{
                    dataType: (
                      <span className="font-medium">
                        <IsolatedText text={sighting.dataTypeName} />
                      </span>
                    ),
                    location: (
                      <code
                        dir="ltr"
                        className="rounded bg-white/70 px-1 font-mono text-xs"
                      >
                        {sighting.location}
                      </code>
                    ),
                  }}
                />
                <span className="block text-xs">
                  <IsolatedText text={sighting.storeName} />
                  {lastSeen ? (
                    <>
                      {getInlineSeparator(translator.language)}
                      {translator.translateTemplate(
                        SECRET_LAST_SEEN,
                        { time: lastSeen },
                        { setsValuesApart: true },
                      )}
                    </>
                  ) : (
                    <></>
                  )}
                </span>
              </li>
            );
          },
        )}
      </ul>
    </section>
  );
};

const IssueCodeFix: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [read, setRead] = useState<DataSecurityIssueCodeFixResult | null>(null);
  const [readToken, setReadToken] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const answer: DataSecurityIssueCodeFixResult =
          await DataSecurityApi.getIssueCodeFix(props.issueId);

        if (isCurrent) {
          setRead(answer);
        }
      } catch {
        // The section keeps what it knew; it asks again at the next read.
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [props.issueId.toString(), props.refreshToggle, readToken]);

  // Read again while the pull request is being written.
  useEffect(() => {
    if (read?.fix?.state !== DeclaredCodeChangeState.Writing) {
      return undefined;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setReadToken((token: number) => {
        return token + 1;
      });
    }, DECLARED_CODE_CHANGE_POLL_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [read]);

  const sightings: Array<DataSecuritySecretSighting> =
    read?.secretSightings || [];

  if (!read || (!read.fix && sightings.length === 0)) {
    return <></>;
  }

  return (
    <div className="space-y-3" data-testid={ISSUE_CODE_FIX_TEST_ID}>
      {read.fix ? <FixLine fix={read.fix} /> : <></>}
      {sightings.length > 0 ? <SecretSightings sightings={sightings} /> : <></>}
    </div>
  );
};

export default IssueCodeFix;
