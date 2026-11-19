import ServiceKnowledgeApi from "./ServiceKnowledgeApi";
import {
  ALERT_REFERENCE,
  CAUSE_NOT_RECORDED,
  CONFIRMED_ANALYSIS,
  COULD_NOT_LOAD_KNOWLEDGE_WITH_ERROR,
  FIXED_BY_COMMANDS,
  FIXED_BY_RUNBOOK,
  INCIDENT_REFERENCE,
  KNOWLEDGE_CARD_DESCRIPTION,
  KNOWLEDGE_CARD_TITLE,
  LAST_SEEN,
  LOADING_KNOWLEDGE,
  NOTHING_LEARNED_DESCRIPTION,
  NOTHING_LEARNED_TITLE,
  SEEN_TIMES,
  SERVICE_AI_MEMORY_TEST_IDS,
  TRY_AGAIN,
} from "./ServiceAiMemoryCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  ServiceKnowledgeFailure,
  ServiceKnowledgeFix,
  ServiceKnowledgeRecord,
  ServiceKnowledgeSummary,
} from "Common/Types/AI/ServiceKnowledgeSummary";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * WHAT ONEUPTIME AI LEARNED ABOUT A SERVICE, on its overview (#7672).
 *
 * OneUptime AI learns the failures a service keeps having from its resolved
 * incidents and alerts whose cause the team recorded or confirmed, and every
 * investigation of the service reads them. This card shows the same to the
 * people on its page: each failure's cause, how often and when it was last
 * seen, the fix that worked, and the incidents and alerts it was learned
 * from, as links. Read with the viewer's own permissions
 * (ServiceKnowledgeApi), so what they may not read is never named or counted.
 */

export interface ComponentProps {
  serviceId: ObjectID;
  // Read again when it changes (the page's refresh).
  refreshToken?: number | string | undefined;
}

type KnowledgeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; summary: ServiceKnowledgeSummary };

export function getRecordRoute(record: ServiceKnowledgeRecord): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[
      record.kind === "incident" ? PageMap.INCIDENT_VIEW : PageMap.ALERT_VIEW
    ] as Route,
    { modelId: new ObjectID(record.id) },
  );
}

// A record a failure was learned from, as a link: "Incident #42", "Alert #7".
export const KnowledgeRecordLink: FunctionComponent<{
  record: ServiceKnowledgeRecord;
}> = (props: { record: ServiceKnowledgeRecord }): ReactElement => {
  const translator: Translator = useTranslator();
  const number: string =
    props.record.number === null ? "" : `#${props.record.number}`;
  const words: string =
    props.record.kind === "incident"
      ? translator.translateTemplate(INCIDENT_REFERENCE, { incident: number })
      : translator.translateTemplate(ALERT_REFERENCE, { alert: number });

  return (
    <Link
      to={getRecordRoute(props.record)}
      className="whitespace-nowrap font-medium text-indigo-700 hover:underline"
      title={props.record.title}
      isTitleTranslated={true}
    >
      {words}
    </Link>
  );
};

// The fix that worked: the runbook OneUptime AI started, or the commands it ran.
export const KnowledgeFix: FunctionComponent<{
  fix: ServiceKnowledgeFix;
}> = (props: { fix: ServiceKnowledgeFix }): ReactElement => {
  if (props.fix.runbookName) {
    return (
      <TranslatedSentence
        template={FIXED_BY_RUNBOOK}
        slots={{
          name: (
            <span className="font-medium text-gray-900">
              <IsolatedText text={props.fix.runbookName} />
            </span>
          ),
        }}
      />
    );
  }

  return (
    <TranslatedSentence
      template={FIXED_BY_COMMANDS}
      slots={{
        commands: (
          <>
            {props.fix.commands.map(
              (command: string, index: number): ReactElement => {
                return (
                  <Fragment key={index}>
                    {index > 0 ? <InlineSeparator /> : <></>}
                    <code
                      dir="ltr"
                      className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-900 [overflow-wrap:anywhere]"
                    >
                      {command}
                    </code>
                  </Fragment>
                );
              },
            )}
          </>
        ),
      }}
    />
  );
};

// One failure the service keeps having.
export const KnowledgeFailure: FunctionComponent<{
  failure: ServiceKnowledgeFailure;
}> = (props: { failure: ServiceKnowledgeFailure }): ReactElement => {
  const translator: Translator = useTranslator();
  const failure: ServiceKnowledgeFailure = props.failure;
  const newest: ServiceKnowledgeRecord | undefined = failure.records[0];

  return (
    <li
      className="py-3 first:pt-0 last:pb-0"
      data-testid={SERVICE_AI_MEMORY_TEST_IDS.failure}
    >
      <p className="whitespace-pre-line break-words text-sm font-medium text-gray-900">
        <IsolatedText text={failure.cause || newest?.title || ""} />
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        <span>{translator.translatePlural(SEEN_TIMES, failure.count)}</span>
        <InlineSeparator markOnly={true} />
        <span>
          <TranslatedSentence
            template={LAST_SEEN}
            slots={{
              time: (
                <span
                  className="whitespace-nowrap"
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    OneUptimeDate.fromString(failure.lastSeenAt),
                  )}
                >
                  {OneUptimeDate.fromNow(
                    OneUptimeDate.fromString(failure.lastSeenAt),
                  )}
                </span>
              ),
            }}
          />
        </span>
        {failure.cause && failure.isConfirmedAnalysis ? (
          <Pill text={CONFIRMED_ANALYSIS} tone={PillTone.Info} />
        ) : (
          <></>
        )}
        {!failure.cause ? (
          <>
            <InlineSeparator markOnly={true} />
            <span>{translator.translateText(CAUSE_NOT_RECORDED)}</span>
          </>
        ) : (
          <></>
        )}
      </div>

      {failure.fix ? (
        <p className="mt-1.5 break-words text-sm text-gray-700">
          <KnowledgeFix fix={failure.fix} />
        </p>
      ) : (
        <></>
      )}

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {failure.records.map((record: ServiceKnowledgeRecord): ReactElement => {
          return <KnowledgeRecordLink key={record.id} record={record} />;
        })}
      </div>
    </li>
  );
};

const ServiceKnowledgeCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<KnowledgeState>({ status: "loading" });
  const [attempt, setAttempt] = useState<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const summary: ServiceKnowledgeSummary =
        await ServiceKnowledgeApi.getSummary(props.serviceId);
      setState({ status: "loaded", summary });
    } catch (error) {
      setState({
        status: "error",
        message: (error as Error).message || "",
      });
    }
  }, [props.serviceId.toString()]);

  useEffect(() => {
    void load();
  }, [load, props.refreshToken, attempt]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (state.status === "loading") {
      return (
        <div
          role="status"
          aria-label={translator.translateText(LOADING_KNOWLEDGE)}
          data-testid={SERVICE_AI_MEMORY_TEST_IDS.loading}
        >
          <CardListSkeleton count={2} lines={2} />
        </div>
      );
    }

    if (state.status === "error") {
      return (
        <div data-testid={SERVICE_AI_MEMORY_TEST_IDS.error}>
          <p className="text-sm text-gray-600">
            <ErrorSentence
              template={COULD_NOT_LOAD_KNOWLEDGE_WITH_ERROR}
              error={state.message}
            />
          </p>
          <div className="mt-2">
            <Button
              title={TRY_AGAIN}
              buttonStyle={ButtonStyleType.LINK}
              dataTestId={SERVICE_AI_MEMORY_TEST_IDS.tryAgain}
              onClick={() => {
                setState({ status: "loading" });
                setAttempt(attempt + 1);
              }}
            />
          </div>
        </div>
      );
    }

    if (state.summary.failures.length === 0) {
      return (
        <EmptyState
          id={SERVICE_AI_MEMORY_TEST_IDS.empty}
          size={EmptyStateSize.Inline}
          icon={IconProp.Sparkles}
          title={NOTHING_LEARNED_TITLE}
          description={NOTHING_LEARNED_DESCRIPTION}
        />
      );
    }

    return (
      <ul className="divide-y divide-gray-100">
        {state.summary.failures.map(
          (failure: ServiceKnowledgeFailure, index: number): ReactElement => {
            return <KnowledgeFailure key={index} failure={failure} />;
          },
        )}
      </ul>
    );
  };

  return (
    <Card
      title={KNOWLEDGE_CARD_TITLE}
      description={KNOWLEDGE_CARD_DESCRIPTION}
      id="what-oneuptime-ai-learned"
    >
      <div data-testid={SERVICE_AI_MEMORY_TEST_IDS.knowledgeCard}>
        {getBody()}
      </div>
    </Card>
  );
};

export default ServiceKnowledgeCard;
