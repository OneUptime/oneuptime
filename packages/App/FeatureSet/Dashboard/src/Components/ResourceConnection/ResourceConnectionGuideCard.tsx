import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Link from "Common/UI/Components/Link/Link";
import {
  isTranslatableTerm,
  translatableTerm,
  TranslatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ResourceConnectionCopy,
  ResourceConnectionGuide,
  ResourceConnectionGuideStep,
} from "./ResourceConnectionGuides";
import {
  ResourceConnectionState,
  getResourceConnectionState,
  getResourceLastSeenDate,
} from "./ResourceConnectionState";
import { splitCommandAtAddressSlashes } from "../SetupGuide/CommandDisplay";

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
 *
 * A resource that sends data only while it is used (its guide's idleCopy:
 * a RUM application, a serverless function) is idle, not broken, when
 * nothing has arrived for a while. Its card then says so in grey, with
 * when data last arrived, and folds the checks away behind one line for
 * when it should be busy (issues #6191, #6269): an amber "stopped sending
 * data" card every night a site has no visitors, or between a nightly
 * job's runs, sent people looking for a fault that was not there.
 */

export interface ComponentProps {
  status: string | null | undefined;
  lastSeenAt: Date | string | null | undefined;
  /*
   * When the resource's agent last sent anything, read or not - for a
   * resource whose agent reads it from an API (a Proxmox cluster). While it
   * is recent and the resource is not connected, the card says the agent
   * cannot read the resource (guide.unreadableCopy) instead of "stopped
   * sending data" (issue #7439).
   */
  agentLastSeenAt?: Date | string | null | undefined;
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
  /*
   * The steps start folded behind this line, which shows them (an idle
   * resource's checks: most of the time nothing needs checking).
   */
  foldedStepsLabel?: string | undefined;
  // The link drawn as the quieter, outlined button.
  isLinkSecondary?: boolean | undefined;
  // What the card is saying, for its data-variant (and its tests).
  variant:
    | "setup"
    | "starting"
    | "stopped"
    | "idle"
    | "unreadable"
    | "waiting-for-read";
  accent: {
    border: string;
    gradient: string;
    iconRing: string;
    iconText: string;
    stepBadge: string;
  };
}

const PRIMARY_LINK_CLASS_NAME: string =
  "inline-flex flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

const SECONDARY_LINK_CLASS_NAME: string =
  "inline-flex flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

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
  /*
   * What sends the resource's data, as it reads in a sentence: a product's
   * name as written, or words cased where the sentence puts them
   * (ResourceConnectionGuide's agentName). The sentences about the resource
   * itself are the guide's own, one set for each kind of resource
   * (ResourceConnectionGuide's setupCopy).
   */
  const agentName: TranslatableTerm = isTranslatableTerm(guide.agentName)
    ? guide.agentName
    : translatableTerm(guide.agentName);

  /*
   * The agent is running but the resource is not read (issue #7439): the
   * API needs looking at, not the agent - amber once a read stopped, the
   * calmer indigo of a first read on its way while none has come yet.
   */
  if (
    guide.unreadableCopy &&
    (state === ResourceConnectionState.ReadingStopped ||
      state === ResourceConnectionState.NotReadYet)
  ) {
    const isStopped: boolean = state === ResourceConnectionState.ReadingStopped;
    const copy: ResourceConnectionCopy = isStopped
      ? guide.unreadableCopy.stopped
      : guide.unreadableCopy.notYet;
    // Translated with the sentence it goes into, as a date is.
    const lastRead: string | TranslatableTerm = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : translatableTerm("a while ago");

    return {
      variant: isStopped ? "unreadable" : "waiting-for-read",
      icon: isStopped ? IconProp.Alert : IconProp.Clock,
      title: translator.translateTemplate(copy.title),
      description: translator.translateTemplate(copy.description, {
        lastRead: lastRead,
        agentName: agentName,
      }),
      steps: guide.unreadableCopy.steps,
      accent: isStopped
        ? {
            border: "border-amber-200",
            gradient: "from-amber-50",
            iconRing: "ring-amber-200",
            iconText: "text-amber-600",
            stepBadge: "bg-amber-50 text-amber-700 ring-amber-200",
          }
        : {
            border: "border-indigo-200",
            gradient: "from-indigo-50",
            iconRing: "ring-indigo-200",
            iconText: "text-indigo-600",
            stepBadge: "bg-indigo-50 text-indigo-700 ring-indigo-200",
          },
    };
  }

  if (state === ResourceConnectionState.Disconnected) {
    // Translated with the sentence it goes into, as a date is.
    const lastHeard: string | TranslatableTerm = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : translatableTerm("a while ago");

    // Idle, not broken: said in grey, the checks folded away.
    if (guide.idleCopy) {
      return {
        icon: IconProp.Clock,
        title:
          translator.translateText(guide.idleCopy.title) ||
          guide.idleCopy.title,
        description: translator.translateTemplate(guide.idleCopy.description, {
          lastHeard: lastHeard,
        }),
        steps: guide.troubleshootingSteps,
        foldedStepsLabel: translator.translateText(guide.idleCopy.checksLabel),
        isLinkSecondary: true,
        variant: "idle",
        accent: {
          border: "border-gray-200",
          gradient: "from-gray-50",
          iconRing: "ring-gray-200",
          iconText: "text-gray-500",
          stepBadge: "bg-gray-50 text-gray-700 ring-gray-200",
        },
      };
    }

    return {
      variant: "stopped",
      icon: IconProp.SignalSlash,
      title: translator.translateTemplate(guide.stoppedCopy.title),
      description: translator.translateTemplate(guide.stoppedCopy.description, {
        lastHeard: lastHeard,
        agentName: agentName,
      }),
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

  if (guide.startingCopy) {
    return {
      variant: "starting",
      icon: IconProp.RocketLaunch,
      title: translator.translateTemplate(guide.startingCopy.title),
      description: translator.translateTemplate(guide.startingCopy.description),
      steps: guide.setupSteps,
      accent: {
        border: "border-indigo-200",
        gradient: "from-indigo-50",
        iconRing: "ring-indigo-200",
        iconText: "text-indigo-600",
        stepBadge: "bg-indigo-50 text-indigo-700 ring-indigo-200",
      },
    };
  }

  return {
    variant: "setup",
    icon: IconProp.RocketLaunch,
    title: translator.translateTemplate(guide.setupCopy.title),
    /*
     * A resource that is idle when unused never shows "Disconnected": its
     * pill says it is waiting for data, so its sentence does not name it.
     */
    description: guide.idleCopy
      ? translator.translateText(guide.idleCopy.waitingDescription) ||
        guide.idleCopy.waitingDescription
      : translator.translateTemplate(guide.setupCopy.description, {
          agentName: agentName,
        }),
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
  const stepsId: string = useId();
  const translator: Translator = useTranslator();
  // An idle resource's checks, shown once the line that names them is used.
  const [areFoldedStepsShown, setAreFoldedStepsShown] =
    useState<boolean>(false);

  const readState: ResourceConnectionState = getResourceConnectionState({
    status: props.status,
    lastSeenAt: props.lastSeenAt,
    agentLastSeenAt: props.agentLastSeenAt,
  });

  /*
   * A guide with nothing to say about an agent that cannot read its
   * resource reads it as before: stopped, or never connected.
   */
  const state: ResourceConnectionState = props.guide.unreadableCopy
    ? readState
    : readState === ResourceConnectionState.ReadingStopped
      ? ResourceConnectionState.Disconnected
      : readState === ResourceConnectionState.NotReadYet
        ? ResourceConnectionState.NeverConnected
        : readState;

  if (state === ResourceConnectionState.Connected) {
    return <></>;
  }

  const copy: StateCopy = getStateCopy(
    state,
    props.guide,
    getResourceLastSeenDate(props.lastSeenAt),
    translator,
  );

  const hasFoldedSteps: boolean =
    Boolean(copy.foldedStepsLabel) && copy.steps.length > 0;
  const areStepsShown: boolean =
    copy.steps.length > 0 && (!hasFoldedSteps || areFoldedStepsShown);

  return (
    <section
      data-testid="resource-connection-guide"
      data-state={state}
      data-variant={copy.variant}
      aria-labelledby={titleId}
      className={`mb-6 overflow-hidden rounded-xl border bg-white shadow-sm ${copy.accent.border} ${props.className || ""}`}
    >
      <div
        className={`flex flex-col gap-4 bg-gradient-to-br ${copy.accent.gradient} via-white to-white px-6 py-5 sm:flex-row sm:items-start sm:justify-between ${
          areStepsShown ? "border-b border-gray-100" : ""
        }`}
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
            {hasFoldedSteps ? (
              <button
                type="button"
                data-testid="resource-connection-guide-steps-toggle"
                aria-expanded={areFoldedStepsShown}
                aria-controls={stepsId}
                onClick={(): void => {
                  setAreFoldedStepsShown(!areFoldedStepsShown);
                }}
                /*
                 * Left-aligned, its chevron on the first line: on a phone
                 * the words wrap, and a button centres them by default.
                 */
                className="mt-2 inline-flex items-start gap-1 rounded text-left text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                <Icon
                  icon={
                    areFoldedStepsShown
                      ? IconProp.ChevronDown
                      : IconProp.ChevronRight
                  }
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                />
                <span>{copy.foldedStepsLabel}</span>
              </button>
            ) : (
              <></>
            )}
          </div>
        </div>
        <Link
          to={props.documentationRoute}
          className={
            copy.isLinkSecondary
              ? SECONDARY_LINK_CLASS_NAME
              : PRIMARY_LINK_CLASS_NAME
          }
        >
          <Icon icon={IconProp.BookOpen} className="h-4 w-4" />
          <span>
            {translator.translateText(
              props.guide.linkText || "Open the setup guide",
            )}
          </span>
        </Link>
      </div>

      {/*
       * A resource that is only starting has no steps to take yet. Folded
       * steps stay in the page, hidden, for the line that shows them to
       * point at.
       */}
      {copy.steps.length > 0 ? (
        <ol
          id={stepsId}
          hidden={!areStepsShown}
          className={
            areStepsShown
              ? "grid grid-cols-1 gap-px bg-gray-100 md:grid-cols-3"
              : "hidden"
          }
        >
          {copy.steps.map(
            (
              step: ResourceConnectionGuideStep,
              index: number,
            ): ReactElement => {
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
                      {/*
                       * Wrapped at a space where it can ("sudo systemctl
                       * status" / "oneuptime-collector"), and inside a word
                       * only one too long for the column: break-all split
                       * every command mid-word ("oneuptim" / "e-collector").
                       * An address too long for the column breaks after a
                       * slash of its path (CommandDisplay), not mid-word.
                       */}
                      <code className="min-w-0 flex-1 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]">
                        {splitCommandAtAddressSlashes(step.code).map(
                          (piece: string, index: number): ReactElement => {
                            return (
                              <React.Fragment key={index}>
                                {index > 0 ? <wbr /> : <></>}
                                {piece}
                              </React.Fragment>
                            );
                          },
                        )}
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
      ) : (
        <></>
      )}
    </section>
  );
};

export default ResourceConnectionGuideCard;
