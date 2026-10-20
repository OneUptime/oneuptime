import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProfileFunctionChange } from "Common/Utils/Profiles/ProfileComparison";
import { formatProfileShare } from "Common/Utils/Profiles/ProfileTypes";
import ProfileUtil from "../../Utils/ProfileUtil";
import {
  PROFILE_KIND_NOUNS,
  ProfileFunctionRow,
  ProfileHeadlineFacts,
  ProfileKindChoice,
} from "../../Utils/ProfilesView";
import {
  HEADLINE_LEADER,
  HEADLINE_LEADER_ALL,
  HEADLINE_NOTHING_CHANGED,
  HEADLINE_NOT_FOOTED,
  HEADLINE_NO_DATA,
  HEADLINE_SLOWER,
  HEADLINE_TOP_OWN,
  HEADLINE_TOP_THREE,
} from "./ProfileCopy";

/*
 * THE ANSWER FIRST.
 *
 * One or two sentences that say what the page found, before any chart:
 * where the service spent its time ("checkout spent 41% of its CPU time in
 * parseOrder"), and - when the busiest function is a runtime's or a
 * library's - which of the person's own functions takes the most. In
 * compare mode, what got slower ("parseOrder went from 10% to 45% of the
 * CPU time"), or that nothing changed. A function named here opens its
 * panel.
 */

export interface ProfileHeadlineComparison {
  notable: ProfileFunctionChange | null;
  isFooted: boolean;
  // "compared with the hour before", "after the deploy of 2.3.1".
  againstText: string;
}

export interface ComponentProps {
  // Null for every profiled service.
  serviceName: string | null;
  kind: ProfileKindChoice;
  windowText: string;
  isLoading: boolean;
  facts?: ProfileHeadlineFacts | null | undefined;
  comparison?: ProfileHeadlineComparison | null | undefined;
  onOpenFunction: (row: { functionName: string; fileName: string }) => void;
}

const ProfileHeadline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Translated along with the sentence it is in, never on its own.
  const kindNoun: TranslatableTerm = translatableTerm(
    PROFILE_KIND_NOUNS[props.kind.category],
    { inSentence: true },
  );

  const functionButton: (row: {
    functionName: string;
    fileName: string;
  }) => ReactNode = (row: {
    functionName: string;
    fileName: string;
  }): ReactNode => {
    return (
      <button
        type="button"
        className="rounded-sm font-mono font-semibold text-indigo-700 [overflow-wrap:anywhere] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        data-testid="profiles-headline-function"
        onClick={() => {
          props.onOpenFunction(row);
        }}
      >
        {row.functionName || translator.translateText("(anonymous)")}
      </button>
    );
  };

  const strong: (text: string) => ReactNode = (text: string): ReactNode => {
    return <span className="font-semibold text-gray-900">{text}</span>;
  };

  if (props.isLoading) {
    return (
      <div
        className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
        data-testid="profiles-headline-loading"
      >
        <div className="h-5 w-2/3 animate-pulse rounded bg-gray-100" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  let icon: IconProp = IconProp.Bolt;
  let tone: string = "bg-indigo-50 text-indigo-600";
  let body: ReactNode = null;

  if (props.comparison) {
    const comparison: ProfileHeadlineComparison = props.comparison;
    icon = IconProp.Clock;

    if (!comparison.isFooted) {
      tone = "bg-gray-100 text-gray-500";
      body = (
        <p
          className="text-sm text-gray-700"
          data-testid="profiles-headline-text"
        >
          {translator.translateText(HEADLINE_NOT_FOOTED)}
        </p>
      );
    } else if (comparison.notable) {
      const notable: ProfileFunctionChange = comparison.notable;
      tone = "bg-amber-50 text-amber-600";
      body = (
        <>
          <p
            className="text-base text-gray-800"
            data-testid="profiles-headline-text"
          >
            <TranslatedSentence
              template={HEADLINE_SLOWER}
              values={{ kind: kindNoun }}
              slots={{
                function: functionButton(notable),
                before: strong(
                  formatProfileShare(notable.before?.selfShare || 0),
                ),
                after: strong(
                  formatProfileShare(notable.after?.selfShare || 0),
                ),
              }}
            />{" "}
            <span className="text-gray-600">{comparison.againstText}</span>
          </p>
          {notable.fileName ? (
            <p className="mt-1 truncate font-mono text-xs text-gray-500">
              {ProfileUtil.formatFileName(notable.fileName, 96)}
            </p>
          ) : (
            <></>
          )}
        </>
      );
    } else {
      tone = "bg-green-50 text-green-600";
      icon = IconProp.CheckCircle;
      body = (
        <p
          className="text-sm text-gray-700"
          data-testid="profiles-headline-text"
        >
          {translator.translateText(HEADLINE_NOTHING_CHANGED)}{" "}
          <span className="text-gray-500">{comparison.againstText}</span>
        </p>
      );
    }
  } else {
    const facts: ProfileHeadlineFacts | null | undefined = props.facts;
    const leader: ProfileFunctionRow | null = facts?.leader || null;

    if (!facts || !leader) {
      tone = "bg-gray-100 text-gray-500";
      icon = IconProp.ChartBar;
      body = (
        <p
          className="text-sm text-gray-700"
          data-testid="profiles-headline-text"
        >
          {translator.translateTemplate(HEADLINE_NO_DATA, {
            kind: kindNoun,
          })}
        </p>
      );
    } else {
      body = (
        <>
          <p
            className="text-base text-gray-800"
            data-testid="profiles-headline-text"
          >
            <TranslatedSentence
              template={
                props.serviceName ? HEADLINE_LEADER : HEADLINE_LEADER_ALL
              }
              values={{ kind: kindNoun }}
              slots={{
                service: strong(props.serviceName || ""),
                share: strong(formatProfileShare(facts.leaderShare)),
                function: functionButton(leader),
              }}
            />{" "}
            {facts.topThreeCount >= 2 ? (
              <span className="text-gray-600">
                {translator.translateTemplate(HEADLINE_TOP_THREE, {
                  count: String(facts.topThreeCount),
                  share: formatProfileShare(facts.topThreeShare),
                })}
              </span>
            ) : (
              <></>
            )}
          </p>
          {facts.topOwn ? (
            <p
              className="mt-1.5 text-sm text-gray-700"
              data-testid="profiles-headline-own"
            >
              <TranslatedSentence
                template={HEADLINE_TOP_OWN}
                slots={{
                  function: functionButton(facts.topOwn),
                  share: strong(formatProfileShare(facts.topOwnShare)),
                }}
              />
            </p>
          ) : (
            <></>
          )}
          <p className="mt-1 text-xs text-gray-500">{props.windowText}</p>
        </>
      );
    }
  }

  return (
    <div
      className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      data-testid="profiles-headline"
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${tone}`}
        >
          <Icon icon={icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 leading-relaxed">{body}</div>
      </div>
    </div>
  );
};

export default ProfileHeadline;
