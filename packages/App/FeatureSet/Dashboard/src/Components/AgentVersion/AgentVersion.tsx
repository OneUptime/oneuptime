import React, {
  FunctionComponent,
  LazyExoticComponent,
  ReactElement,
  Suspense,
  lazy,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { AgentVersionStatus } from "Common/Utils/AgentVersionUtil";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { AppVersion } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  AGENT_KINDS,
  AgentKind,
  AgentKindDefinition,
  AgentVersionState,
  getAgentVersionState,
} from "./AgentKind";
import type { AgentUpgradeGuideContext } from "./AgentUpgradeGuides";
import type { ComponentProps as AgentUpgradeModalProps } from "./AgentUpgradeModal";

/*
 * An agent's self-reported version, as every resource shows it - and, when a
 * newer agent is available, a sign beside it that opens how to upgrade.
 *
 * "If the agent version is outdated, can you please show the sign beside the
 * agent version and also, when I click on it, show how to upgrade the agent?
 * Please do this for all the resources like Hosts / docker / etc etc."
 *
 * - Up to date, or impossible to tell: the version exactly as it was drawn
 *   before, a plain text node (or the hero's gray "Agent 14.0.14" chip), so
 *   nothing on the page moves.
 * - Outdated: the version and a warning sign become one button. Hovering or
 *   focusing it says "A newer agent is available: 14.0.14"; pressing it opens
 *   a dialog with this kind of agent's upgrade commands (AgentUpgradeModal),
 *   taken from the setup guide that installs it.
 * - No version: the placeholder the details card declares ("Not reported"),
 *   or nothing.
 *
 * Which agent the version belongs to - and so whether it can be outdated at
 * all - is the `kind` (AgentKind.ts). The newest version of a OneUptime
 * release is the version this OneUptime runs (APP_VERSION, published to the
 * browser in env.js): agents are released with OneUptime.
 *
 * The dialog, and the setup guides it reads its commands from, load only
 * when it is opened: this component is on every resource page, and the
 * guides are large.
 *
 * Every page that shows an agent version uses this component
 * (App/Tests/Dashboard/AgentVersionDisplayGuard.test.ts).
 */

const AgentUpgradeModal: LazyExoticComponent<
  FunctionComponent<AgentUpgradeModalProps>
> = lazy(() => {
  return import("./AgentUpgradeModal");
});

export type AgentVersionVariant = "text" | "chip";

export interface ComponentProps {
  kind: AgentKind;
  // The version as the agent reported it, exactly as stored.
  version: string | null | undefined;
  /*
   * "text" (the default): a details value, a table cell or a details row.
   * "chip": the "Agent 14.0.14" chip in a resource's hero.
   */
  variant?: AgentVersionVariant | undefined;
  // Drawn when there is no version, as a details card's placeholder.
  placeholder?: string | undefined;
  /*
   * The resource's setup guide (its Documentation tab). The dialog links to
   * it from a step that starts the agent again with a command only the guide
   * can fill in (a key picked there).
   */
  setupGuideRoute?: Route | undefined;
  // What the upgrade guide needs to know about the resource.
  upgradeGuideContext?: AgentUpgradeGuideContext | undefined;
}

// The gray chip every hero draws its facts in ("Docker 27.1.1", "Agent 1.2.3").
const HERO_CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700";

const AgentVersion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isUpgradeOpen, setIsUpgradeOpen] = useState<boolean>(false);

  const version: string = (props.version || "").trim();
  const isChip: boolean = props.variant === "chip";

  if (!version) {
    if (props.placeholder && !isChip) {
      return <PlaceholderText text={props.placeholder} />;
    }
    return <></>;
  }

  const definition: AgentKindDefinition = AGENT_KINDS[props.kind];
  const state: AgentVersionState = getAgentVersionState({
    kind: props.kind,
    agentVersion: version,
    serverVersion: AppVersion,
  });
  const chipLabel: string = translator.translateTemplate("Agent {{version}}", {
    version: version,
  });

  if (state.status !== AgentVersionStatus.Outdated || !state.latestVersion) {
    if (isChip) {
      return (
        <span className={HERO_CHIP_CLASS_NAME} data-testid="agent-version-chip">
          <Icon icon={IconProp.Terminal} className="h-3 w-3 text-gray-500" />
          <span className="font-medium">{chipLabel}</span>
        </span>
      );
    }
    // A bare text node: drawn exactly as the plain value always was.
    return <>{version}</>;
  }

  const latestVersion: string = state.latestVersion;

  const signText: string = definition.isRunner
    ? translator.translateTemplate("A newer Runner is available: {{version}}", {
        version: latestVersion,
      })
    : translator.translateTemplate("A newer agent is available: {{version}}", {
        version: latestVersion,
      });

  const accessibleName: string = definition.isRunner
    ? translator.translateTemplate(
        "Runner {{version}} is outdated. A newer Runner is available: {{latest}}. Show how to upgrade.",
        { version: version, latest: latestVersion },
      )
    : translator.translateTemplate(
        "Agent {{version}} is outdated. A newer agent is available: {{latest}}. Show how to upgrade.",
        { version: version, latest: latestVersion },
      );

  const openUpgrade: () => void = (): void => {
    setIsUpgradeOpen(true);
  };

  const trigger: ReactElement = isChip ? (
    <button
      type="button"
      onClick={openUpgrade}
      aria-haspopup="dialog"
      aria-label={accessibleName}
      data-testid="agent-version-outdated"
      data-agent-kind={props.kind}
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
    >
      <Icon icon={IconProp.Terminal} className="h-3 w-3 text-amber-600" />
      <span className="font-medium">{chipLabel}</span>
      <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 text-amber-600" />
    </button>
  ) : (
    <button
      type="button"
      onClick={openUpgrade}
      aria-haspopup="dialog"
      aria-label={accessibleName}
      data-testid="agent-version-outdated"
      data-agent-kind={props.kind}
      /*
       * The version keeps the font of what it sits in - a details row draws
       * versions in monospace - where every element would otherwise take the
       * page's `* { font-family }` rule.
       */
      className="inline-flex max-w-full items-center gap-1.5 rounded-md text-left [font-family:inherit] hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
    >
      <span className="break-all underline decoration-amber-500 decoration-dotted underline-offset-4 [font-family:inherit]">
        {version}
      </span>
      <Icon
        icon={IconProp.Alert}
        className="h-4 w-4 flex-shrink-0 text-amber-500"
      />
    </button>
  );

  return (
    <>
      <Tooltip text={signText} isTriggerAlreadyDescribed={true}>
        {trigger}
      </Tooltip>
      {isUpgradeOpen ? (
        <Suspense fallback={<></>}>
          <AgentUpgradeModal
            kind={props.kind}
            currentVersion={version}
            latestVersion={latestVersion}
            setupGuideRoute={props.setupGuideRoute}
            upgradeGuideContext={props.upgradeGuideContext}
            onClose={(): void => {
              setIsUpgradeOpen(false);
            }}
          />
        </Suspense>
      ) : (
        <></>
      )}
    </>
  );
};

export default AgentVersion;
