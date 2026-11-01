import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import UpdateStatusUtil, {
  UpdateState,
  UpdateStatus,
} from "../../../Types/UpdateCheck/UpdateStatus";
import { getUpgradeGuideUrl } from "../../Utils/UpdateStatus";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The footers' word on upgrading, beside the edition pill (the Dashboard)
 * or the footer's links (the Admin Dashboard), for a master admin of a
 * self-hosted installation:
 *
 *   - "Update available": a newer release is out. Amber, quiet: most
 *     releases are routine.
 *   - "Security update": a published security advisory affects the version
 *     this installation runs, and a release fixes it. Red, with a shield:
 *     the one state worth interrupting someone for.
 *   - "Security advisory": the same, with no release that fixes it yet.
 *
 * Each opens this installation's upgrade guide in a new tab, and says on
 * hover what it is about. Up to date, unknown, or anybody but a master admin
 * (the server tells nobody else): nothing at all, so the footer reads as it
 * always did. The caller only adds the pill when UpdateStatusUtil.
 * isShownInFooter says so, so it never leaves an empty slot behind.
 */

export interface ComponentProps {
  status: UpdateStatus | null;
  className?: string | undefined;
}

export const UPDATE_STATUS_PILL_COPY: {
  updateAvailable: string;
  securityUpdate: string;
  securityAdvisory: string;
  updateDescription: string;
  securityUpdateDescription: PluralTemplate;
  securityAdvisoryDescription: PluralTemplate;
  opensGuide: string;
} = {
  updateAvailable: translationKey("Update available"),
  securityUpdate: translationKey("Security update"),
  securityAdvisory: translationKey("Security advisory"),
  updateDescription: translationKey(
    "Version {{latest}} is available. This installation runs {{current}}.",
  ),
  securityUpdateDescription: {
    one: "A published security advisory affects version {{current}}, which this installation runs. Upgrade to {{recommended}}.",
    other:
      "{{count}} published security advisories affect version {{current}}, which this installation runs. Upgrade to {{recommended}}.",
  },
  securityAdvisoryDescription: {
    one: "A published security advisory affects version {{current}}, which this installation runs. No release fixes it yet.",
    other:
      "{{count}} published security advisories affect version {{current}}, which this installation runs. No release fixes them all yet.",
  },
  opensGuide: translationKey("Opens the upgrade guide in a new tab."),
};

// What the pill says on hover, and to a screen reader before "opens the guide".
export const describeUpdateStatus: (
  status: UpdateStatus,
  translator: Translator,
) => string = (status: UpdateStatus, translator: Translator): string => {
  const count: number = status.advisories.length;

  if (status.state === UpdateState.SecurityUpdate) {
    return translator.translatePlural(
      UPDATE_STATUS_PILL_COPY.securityUpdateDescription,
      count,
      {
        current: status.currentVersion,
        recommended: status.recommendedVersion || "",
      },
    );
  }

  if (status.state === UpdateState.SecurityAdvisory) {
    return translator.translatePlural(
      UPDATE_STATUS_PILL_COPY.securityAdvisoryDescription,
      count,
      { current: status.currentVersion },
    );
  }

  return translator.translateTemplate(
    UPDATE_STATUS_PILL_COPY.updateDescription,
    {
      latest: status.latestVersion || "",
      current: status.currentVersion,
    },
  );
};

const UpdateStatusPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const status: UpdateStatus | null = props.status;

  if (!status || !UpdateStatusUtil.isShownInFooter(status)) {
    return <></>;
  }

  const isSecurity: boolean = UpdateStatusUtil.isSecurityState(status.state);

  const label: string =
    translator.translateText(
      status.state === UpdateState.SecurityUpdate
        ? UPDATE_STATUS_PILL_COPY.securityUpdate
        : status.state === UpdateState.SecurityAdvisory
          ? UPDATE_STATUS_PILL_COPY.securityAdvisory
          : UPDATE_STATUS_PILL_COPY.updateAvailable,
    ) || "";

  const description: string = describeUpdateStatus(status, translator);

  return (
    <Tooltip text={description} isTriggerAlreadyDescribed={true}>
      <a
        href={getUpgradeGuideUrl()}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="update-status-pill"
        data-state={status.state}
        aria-label={`${label}. ${description} ${
          translator.translateText(UPDATE_STATUS_PILL_COPY.opensGuide) || ""
        }`}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 ${
          isSecurity
            ? "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 focus-visible:ring-red-400"
            : "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100 focus-visible:ring-amber-400"
        } ${props.className || ""}`}
      >
        <Icon
          icon={
            isSecurity ? IconProp.ShieldExclamation : IconProp.ArrowCircleUp
          }
          className={`h-3.5 w-3.5 shrink-0 ${
            isSecurity ? "text-red-600" : "text-amber-600"
          }`}
        />
        <span>{label}</span>
      </a>
    </Tooltip>
  );
};

export default UpdateStatusPill;
