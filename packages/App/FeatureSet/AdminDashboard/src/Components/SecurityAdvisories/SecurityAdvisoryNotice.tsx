import Icon from "Common/UI/Components/Icon/Icon";
import {
  getUpdateCheckDocsUrl,
  getUpgradeGuideUrl,
  useUpdateStatus,
} from "Common/UI/Utils/UpdateStatus";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityAdvisorySeverity } from "Common/Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure from "Common/Types/UpdateCheck/UpdateCheckFailure";
import UpdateStatusUtil, {
  AffectingAdvisory,
  UpdateState,
  UpdateStatus,
} from "Common/Types/UpdateCheck/UpdateStatus";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE SECURITY NOTICE ON THE ADMIN DASHBOARD'S FIRST PAGE.
 *
 * When a security advisory OneUptime published on GitHub affects the version
 * this self-hosted installation runs, its master admins are told here, above
 * everything else on the Users page (the page the Admin Dashboard opens on):
 * what is affected, each advisory with its severity, a link to it, the
 * versions it affects and the release that fixes it, the release to upgrade
 * to, and the upgrade guide. Under it, when the daily check last read the
 * advisories, and - when the latest check could not reach GitHub - that what
 * is shown is what the check before it found.
 *
 * It cannot be hidden: it goes away when the installation runs a version no
 * advisory affects, which the server works out from the version that runs,
 * so the moment an upgrade starts. The owners were emailed about each
 * advisory once (Workers/Jobs/InstanceUpdate); the footer's "Security
 * update" pill says the same on every page.
 *
 * Nothing is drawn for anything else: no advisory, the check off, OneUptime
 * Cloud, or a status that cannot be read.
 */

export const SECURITY_ADVISORY_NOTICE_COPY: {
  securityUpdateTitle: string;
  securityAdvisoryTitle: string;
  securityUpdateLead: PluralTemplate;
  securityAdvisoryLead: PluralTemplate;
  howToUpgrade: string;
  opensInNewTab: string;
  fixedIn: string;
  noFixYet: string;
  affects: string;
  checkedAt: string;
  whatTheCheckSends: string;
  severity: Record<SecurityAdvisorySeverity, string>;
  failures: Record<UpdateCheckFailure, string>;
} = {
  securityUpdateTitle: translationKey("Security update needed"),
  securityAdvisoryTitle: translationKey(
    "Security advisory: no fixed release yet",
  ),
  securityUpdateLead: {
    one: "A published security advisory affects version {{current}}, which this installation runs. Upgrade to {{recommended}} to fix it.",
    other:
      "{{count}} published security advisories affect version {{current}}, which this installation runs. Upgrade to {{recommended}} to fix them.",
  },
  securityAdvisoryLead: {
    one: "A published security advisory affects version {{current}}, which this installation runs. No release fixes it yet: read it for what to do until one does.",
    other:
      "{{count}} published security advisories affect version {{current}}, which this installation runs. No release fixes them all yet: read them for what to do until one does.",
  },
  howToUpgrade: translationKey("How to upgrade"),
  opensInNewTab: translationKey("Opens in a new tab"),
  fixedIn: translationKey("Fixed in {{version}}"),
  noFixYet: translationKey("No fixed release yet"),
  affects: translationKey("Affects {{versions}}"),
  checkedAt: translationKey("Checked for security advisories on {{date}}."),
  whatTheCheckSends: translationKey("What this check sends"),
  severity: {
    [SecurityAdvisorySeverity.Critical]: translationKey("Critical"),
    [SecurityAdvisorySeverity.High]: translationKey("High"),
    [SecurityAdvisorySeverity.Medium]: translationKey("Medium"),
    [SecurityAdvisorySeverity.Low]: translationKey("Low"),
    [SecurityAdvisorySeverity.Unknown]: translationKey("Unrated"),
  },
  failures: {
    [UpdateCheckFailure.RateLimited]: translationKey(
      "The check on {{date}} was turned away by GitHub's rate limit, so this is what an earlier check found.",
    ),
    [UpdateCheckFailure.Unreachable]: translationKey(
      "The check on {{date}} could not reach GitHub, so this is what an earlier check found.",
    ),
    [UpdateCheckFailure.TimedOut]: translationKey(
      "The check on {{date}} timed out waiting for GitHub, so this is what an earlier check found.",
    ),
    [UpdateCheckFailure.HttpError]: translationKey(
      "The check on {{date}} got an error from GitHub, so this is what an earlier check found.",
    ),
    [UpdateCheckFailure.MalformedResponse]: translationKey(
      "The check on {{date}} got an answer that is not GitHub's, so this is what an earlier check found.",
    ),
  },
};

const SEVERITY_CLASS_NAMES: Record<SecurityAdvisorySeverity, string> = {
  [SecurityAdvisorySeverity.Critical]: "bg-red-100 text-red-800 ring-red-200",
  [SecurityAdvisorySeverity.High]:
    "bg-orange-100 text-orange-800 ring-orange-200",
  [SecurityAdvisorySeverity.Medium]:
    "bg-amber-100 text-amber-800 ring-amber-200",
  [SecurityAdvisorySeverity.Low]: "bg-gray-100 text-gray-700 ring-gray-200",
  [SecurityAdvisorySeverity.Unknown]: "bg-gray-100 text-gray-700 ring-gray-200",
};

// A date as the reader's language writes it, or null for one that is not.
const formatDate: (value: string | null) => string | null = (
  value: string | null,
): string | null => {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return OneUptimeDate.getDateAsLocalFormattedString(date);
};

/*
 * Whether the latest check failed after the advisories shown were read: the
 * notice then says what is shown is an earlier check's.
 */
export const isShowingEarlierCheck: (status: UpdateStatus) => boolean = (
  status: UpdateStatus,
): boolean => {
  if (!status.lastCheckFailure || !status.lastCheckAttemptedAt) {
    return false;
  }

  if (!status.advisoriesCheckedAt) {
    return true;
  }

  return (
    new Date(status.lastCheckAttemptedAt).getTime() >
    new Date(status.advisoriesCheckedAt).getTime()
  );
};

export interface ComponentProps {
  /*
   * For tests and previews: the status to draw. Left out, the notice reads
   * the server's (GET /global-config/update-status).
   */
  status?: UpdateStatus | null | undefined;
}

const LoadedSecurityAdvisoryNotice: FunctionComponent<{
  status: UpdateStatus | null;
}> = (props: { status: UpdateStatus | null }): ReactElement => {
  const translator: Translator = useTranslator();
  const status: UpdateStatus | null = props.status;

  if (
    !status ||
    !UpdateStatusUtil.isSecurityState(status.state) ||
    status.advisories.length === 0
  ) {
    return <></>;
  }

  const count: number = status.advisories.length;
  const isFixed: boolean =
    status.state === UpdateState.SecurityUpdate &&
    Boolean(status.recommendedVersion);

  const title: string =
    translator.translateText(
      isFixed
        ? SECURITY_ADVISORY_NOTICE_COPY.securityUpdateTitle
        : SECURITY_ADVISORY_NOTICE_COPY.securityAdvisoryTitle,
    ) || "";

  const lead: string = isFixed
    ? translator.translatePlural(
        SECURITY_ADVISORY_NOTICE_COPY.securityUpdateLead,
        count,
        {
          current: status.currentVersion,
          recommended: status.recommendedVersion || "",
        },
      )
    : translator.translatePlural(
        SECURITY_ADVISORY_NOTICE_COPY.securityAdvisoryLead,
        count,
        { current: status.currentVersion },
      );

  const checkedAt: string | null = formatDate(status.advisoriesCheckedAt);
  const attemptedAt: string | null = formatDate(status.lastCheckAttemptedAt);

  const checkedSentence: string = checkedAt
    ? translator.translateTemplate(SECURITY_ADVISORY_NOTICE_COPY.checkedAt, {
        date: checkedAt,
      })
    : "";

  const failureSentence: string =
    status.lastCheckFailure && attemptedAt && isShowingEarlierCheck(status)
      ? translator.translateTemplate(
          SECURITY_ADVISORY_NOTICE_COPY.failures[status.lastCheckFailure],
          { date: attemptedAt },
        )
      : "";

  const opensInNewTab: string =
    translator.translateText(SECURITY_ADVISORY_NOTICE_COPY.opensInNewTab) || "";

  return (
    <section
      data-testid="security-advisory-notice"
      data-state={status.state}
      aria-labelledby="security-advisory-notice-title"
      className="mb-6 overflow-hidden rounded-lg border border-red-200 bg-white shadow-sm"
    >
      <div className="flex flex-col gap-4 border-b border-red-100 bg-red-50 px-5 py-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-red-100">
            <Icon
              icon={IconProp.ShieldExclamation}
              className="h-5 w-5 text-red-600"
            />
          </span>
          <div className="min-w-0">
            <h2
              id="security-advisory-notice-title"
              className="text-sm font-semibold text-red-900"
            >
              {title}
            </h2>
            <p
              className="mt-1 text-sm text-red-800 text-pretty"
              data-testid="security-advisory-notice-lead"
            >
              {lead}
            </p>
          </div>
        </div>
        <a
          href={getUpgradeGuideUrl()}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="security-advisory-notice-upgrade"
          className="ml-12 inline-flex flex-none items-center gap-1.5 self-start rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 sm:ml-0"
        >
          {translator.translateText(SECURITY_ADVISORY_NOTICE_COPY.howToUpgrade)}
          <Icon
            icon={IconProp.ExternalLink}
            className="h-3.5 w-3.5 text-white"
          />
          <span className="sr-only">{` (${opensInNewTab})`}</span>
        </a>
      </div>

      <ul className="divide-y divide-gray-100">
        {status.advisories.map((advisory: AffectingAdvisory): ReactElement => {
          const details: Array<string> = [advisory.ghsaId];

          if (advisory.cveId) {
            details.push(advisory.cveId);
          }

          if (advisory.affectedVersions) {
            details.push(
              translator.translateTemplate(
                SECURITY_ADVISORY_NOTICE_COPY.affects,
                { versions: advisory.affectedVersions },
              ),
            );
          }

          return (
            <li
              key={advisory.ghsaId}
              data-testid={`security-advisory-${advisory.ghsaId}`}
              data-severity={advisory.severity}
              className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      SEVERITY_CLASS_NAMES[advisory.severity]
                    }`}
                  >
                    {translator.translateText(
                      SECURITY_ADVISORY_NOTICE_COPY.severity[advisory.severity],
                    )}
                  </span>
                  {advisory.url ? (
                    <a
                      href={advisory.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500"
                    >
                      {advisory.summary}
                      <span className="sr-only">{` (${opensInNewTab})`}</span>
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-gray-900">
                      {advisory.summary}
                    </span>
                  )}
                </div>
                <p className="mt-1 break-words text-xs text-gray-500">
                  {details.join(" · ")}
                </p>
              </div>
              <p
                className={`flex-none text-xs font-medium sm:pt-0.5 sm:text-right ${
                  advisory.fixedIn ? "text-gray-700" : "text-red-700"
                }`}
              >
                {advisory.fixedIn
                  ? translator.translateTemplate(
                      SECURITY_ADVISORY_NOTICE_COPY.fixedIn,
                      { version: advisory.fixedIn },
                    )
                  : translator.translateText(
                      SECURITY_ADVISORY_NOTICE_COPY.noFixYet,
                    )}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-1 border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
        <p data-testid="security-advisory-notice-checked">
          <span>{checkedSentence}</span>
          {failureSentence ? (
            <span
              className="block text-amber-700 sm:ml-1 sm:inline"
              data-testid="security-advisory-notice-failure"
            >
              {failureSentence}
            </span>
          ) : (
            <></>
          )}
        </p>
        <a
          href={getUpdateCheckDocsUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-none text-xs font-medium text-gray-600 underline decoration-gray-300 underline-offset-2 hover:text-gray-800"
        >
          {translator.translateText(
            SECURITY_ADVISORY_NOTICE_COPY.whatTheCheckSends,
          )}
          <span className="sr-only">{` (${opensInNewTab})`}</span>
        </a>
      </div>
    </section>
  );
};

const LiveSecurityAdvisoryNotice: FunctionComponent = (): ReactElement => {
  const status: UpdateStatus | null = useUpdateStatus();

  return <LoadedSecurityAdvisoryNotice status={status} />;
};

const SecurityAdvisoryNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.status !== undefined) {
    return <LoadedSecurityAdvisoryNotice status={props.status} />;
  }

  return <LiveSecurityAdvisoryNotice />;
};

export default SecurityAdvisoryNotice;
