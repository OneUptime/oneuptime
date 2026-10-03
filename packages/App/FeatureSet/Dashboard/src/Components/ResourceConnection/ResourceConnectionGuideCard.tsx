import React, { FunctionComponent, ReactElement, useId } from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Link from "Common/UI/Components/Link/Link";
import {
  translatableTerm,
  TranslatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ResourceConnectionGuide,
  ResourceConnectionGuideStep,
} from "./ResourceConnectionGuides";
import {
  ResourceConnectionState,
  getResourceConnectionState,
  getResourceLastSeenDate,
} from "./ResourceConnectionState";

/*
 * The short "how do I connect this?" card on a resource's overview.
 *
 * A resource created by hand shows "Disconnected" straight away, and nothing
 * on its overview said what to do about it - the steps lived on a
 * Documentation tab you had to know to open. This card sits under the hero
 * while the resource is not connected and says, in three steps, how to get
 * it connected, with a link to the full guide. Once data arrives it renders
 * nothing.
 *
 * Two situations, two sets of steps (see ResourceConnectionState):
 * - never connected: install the agent;
 * - connected once, then stopped: check on the agent.
 */

export interface ComponentProps {
  status: string | null | undefined;
  lastSeenAt: Date | string | null | undefined;
  guide: ResourceConnectionGuide;
  // The resource's Documentation tab - the full, prefilled guide.
  documentationRoute: Route;
  className?: string | undefined;
}

interface StateCopy {
  icon: IconProp;
  title: string;
  description: string;
  steps: Array<ResourceConnectionGuideStep>;
  accent: {
    border: string;
    gradient: string;
    iconRing: string;
    iconText: string;
    stepBadge: string;
  };
}

const getStateCopy: (
  state: ResourceConnectionState,
  guide: ResourceConnectionGuide,
  lastSeenAt: Date | null,
  translator: Translator,
) => StateCopy = (
  state: ResourceConnectionState,
  guide: ResourceConnectionGuide,
  lastSeenAt: Date | null,
  translator: Translator,
): StateCopy => {
  // The resource and its agent as they read in the middle of a sentence.
  const resourceNoun: TranslatableTerm = translatableTerm(guide.resourceNoun, {
    inSentence: true,
  });
  const agentName: TranslatableTerm = translatableTerm(guide.agentName);

  if (state === ResourceConnectionState.Disconnected) {
    const lastHeard: string = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : translator.translateTemplate("a while ago");

    return {
      icon: IconProp.SignalSlash,
      title: translator.translateTemplate(
        "This {{resourceNoun}} stopped sending data",
        { resourceNoun: resourceNoun },
      ),
      description: translator.translateTemplate(
        "OneUptime last heard from this {{resourceNoun}} {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
        {
          resourceNoun: resourceNoun,
          lastHeard: lastHeard,
          agentName: agentName,
        },
      ),
      steps: guide.troubleshootingSteps,
      accent: {
        border: "border-amber-200",
        gradient: "from-amber-50",
        iconRing: "ring-amber-200",
        iconText: "text-amber-600",
        stepBadge: "bg-amber-50 text-amber-700 ring-amber-200",
      },
    };
  }

  return {
    icon: IconProp.RocketLaunch,
    title: translator.translateTemplate("Connect this {{resourceNoun}}", {
      resourceNoun: resourceNoun,
    }),
    description: translator.translateTemplate(
      "No data has arrived from this {{resourceNoun}} yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
      { resourceNoun: resourceNoun, agentName: agentName },
    ),
    steps: guide.setupSteps,
    accent: {
      border: "border-indigo-200",
      gradient: "from-indigo-50",
      iconRing: "ring-indigo-200",
      iconText: "text-indigo-600",
      stepBadge: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    },
  };
};

const ResourceConnectionGuideCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Before the early return: hooks run on every render.
  const titleId: string = useId();
  const translator: Translator = useTranslator();

  const state: ResourceConnectionState = getResourceConnectionState({
    status: props.status,
    lastSeenAt: props.lastSeenAt,
  });

  if (state === ResourceConnectionState.Connected) {
    return <></>;
  }

  const copy: StateCopy = getStateCopy(
    state,
    props.guide,
    getResourceLastSeenDate(props.lastSeenAt),
    translator,
  );

  return (
    <section
      data-testid="resource-connection-guide"
      data-state={state}
      aria-labelledby={titleId}
      className={`mb-6 overflow-hidden rounded-xl border bg-white shadow-sm ${copy.accent.border} ${props.className || ""}`}
    >
      <div
        className={`flex flex-col gap-4 border-b border-gray-100 bg-gradient-to-br ${copy.accent.gradient} via-white to-white px-6 py-5 sm:flex-row sm:items-start sm:justify-between`}
      >
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-inset ${copy.accent.iconRing}`}
          >
            <Icon
              icon={copy.icon}
              className={`h-5 w-5 ${copy.accent.iconText}`}
            />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-gray-900">
              {copy.title}
            </h2>
            <p className="mt-1 text-sm text-gray-600">{copy.description}</p>
          </div>
        </div>
        <Link
          to={props.documentationRoute}
          className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <Icon icon={IconProp.BookOpen} className="h-4 w-4" />
          <span>{translator.translateText("Open the setup guide")}</span>
        </Link>
      </div>

      <ol className="grid grid-cols-1 gap-px bg-gray-100 md:grid-cols-3">
        {copy.steps.map(
          (step: ResourceConnectionGuideStep, index: number): ReactElement => {
            return (
              <li
                key={`step-${index}`}
                data-testid="resource-connection-guide-step"
                className="min-w-0 bg-white px-6 py-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset ${copy.accent.stepBadge}`}
                  >
                    {index + 1}
                  </span>
                  <h3 className="text-sm font-medium text-gray-900">
                    {translator.translateText(step.title)}
                  </h3>
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  {translator.translateText(step.description)}
                </p>
                {step.code ? (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs text-gray-800">
                      {step.code}
                    </code>
                    <CopyTextButton
                      textToBeCopied={step.code}
                      iconOnly={true}
                      title="Copy to clipboard"
                      className="flex-shrink-0"
                    />
                  </div>
                ) : (
                  <></>
                )}
              </li>
            );
          },
        )}
      </ol>
    </section>
  );
};

export default ResourceConnectionGuideCard;
