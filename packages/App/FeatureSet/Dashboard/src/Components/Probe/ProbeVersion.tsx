import Probe from "Common/Models/DatabaseModels/Probe";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ProbeReportedVersionUtil, {
  FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
  ProbeFeature,
  ProbeOneTimeCodes,
  ProbeReleaseComparison,
  ProbeReleaseRead,
  ProbeReleaseStatus,
} from "Common/Types/Probe/ProbeReportedVersion";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { AppVersion, DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  ONE_TIME_CODE_PROBES_COPY,
  UPDATE_A_PROBE_DOCS_PATH,
} from "../Monitor/OneTimeCodeProbes";
import {
  PROBE_MISSED_FEATURE_COPY,
  PROBE_UPDATE_COPY,
} from "./ProbeUpdateCopy";

export type ProbeVersionVariant = "detail" | "cell";

export interface ComponentProps {
  probe: Probe | JSONObject;
  /*
   * "detail" (the default): the probe's page, under Probe Status - the
   * release, and why and how to update a probe that needs it.
   * "cell": a row of Custom Probes - the release, and a line that says an
   * update is available, linked to how to update a probe.
   */
  variant?: ProbeVersionVariant | undefined;
  /*
   * The release this OneUptime runs: APP_VERSION, as env.js hands it to
   * the page ("" in development). Tests hand their own.
   */
  serverVersion?: string | undefined;
}

export const PROBE_VERSION_TEST_ID: string = "probe-version";
export const PROBE_UPDATE_TEST_ID: string = "probe-update";
export const PROBE_OLDER_THAN_SERVER_TEST_ID: string =
  "probe-older-than-server";
export const PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID: string =
  "probe-too-old-for-one-time-codes";
export const PROBE_UPDATE_DOCS_TEST_ID: string = "probe-update-docs";
export const PROBE_UPDATE_AVAILABLE_TEST_ID: string = "probe-update-available";

// Each missed feature's sentence, by the test id it is drawn with.
export const PROBE_MISSED_FEATURE_TEST_IDS: Readonly<
  Record<ProbeFeature, string>
> = {
  [ProbeFeature.OneTimeCodes]: PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID,
};

/*
 * The release a probe says it runs (OneUptime issue #9759), and - for a
 * custom probe that needs an update - why, with how to update it one click
 * away (#9815).
 *
 *   - It says a release: the release.
 *   - It has connected and says none: it is older than the first release
 *     that says one, FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE.
 *   - It says a build that is no release ("unknown"): that, as written.
 *   - It never connected: the quiet dash.
 *
 * On the probe's page, under that, when the probe needs an update: that it
 * is older than the OneUptime it reports to, by that OneUptime's release
 * (ProbeReportedVersionUtil.getReleaseStatus), what it cannot do until it
 * is updated - a monitor that uses a one-time code secret fails its check
 * on it (getMissedFeatures) - and the docs that say how to update it. A
 * probe that is up to date, or whose release cannot be told, gets no line:
 * nothing is said that is not known.
 *
 * In Custom Probes, the release and, for a probe older than this
 * OneUptime, "Update available: 17.2.0", linked to the same docs.
 *
 * Global probes are never flagged: OneUptime updates them.
 */
const ProbeVersionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const record: JSONObject = props.probe as JSONObject;

  const reportedVersion: string | null =
    typeof record["reportedVersion"] === "string" &&
    (record["reportedVersion"] as string).trim()
      ? (record["reportedVersion"] as string).trim()
      : null;

  const read: ProbeReleaseRead = {
    isGlobalProbe: Boolean(record["isGlobalProbe"]),
    reportedVersion: reportedVersion,
    lastAlive: (record["lastAlive"] as Date | string | undefined) || null,
    serverVersion:
      props.serverVersion === undefined ? AppVersion : props.serverVersion,
  };

  const oneTimeCodes: ProbeOneTimeCodes =
    ProbeReportedVersionUtil.getOneTimeCodes(read);
  const release: ProbeReleaseComparison =
    ProbeReportedVersionUtil.getReleaseStatus(read);
  const serverRelease: string | null =
    release.status === ProbeReleaseStatus.Outdated
      ? release.serverRelease
      : null;
  const missedFeatures: Array<ProbeFeature> =
    ProbeReportedVersionUtil.getMissedFeatures(read);

  const updateDocs: URL = URL.fromString(
    `${DOCS_URL.toString()}${UPDATE_A_PROBE_DOCS_PATH}`,
  );

  let version: ReactElement;

  if (reportedVersion) {
    // A release, or what a build that is none says: the probe's words.
    version = (
      <span dir="ltr" className="font-mono text-sm text-gray-900">
        {ProbeReportedVersionUtil.getRelease(reportedVersion) ||
          reportedVersion}
      </span>
    );
  } else if (oneTimeCodes === ProbeOneTimeCodes.TooOld) {
    version = (
      <span className="text-sm text-gray-900">
        {translator.translateTemplate(ONE_TIME_CODE_PROBES_COPY.olderThan, {
          version: FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
        })}
      </span>
    );
  } else {
    version = <EmptyValue />;
  }

  if (props.variant === "cell") {
    return (
      <div
        className="flex flex-col items-start gap-0.5"
        data-testid={PROBE_VERSION_TEST_ID}
      >
        {version}
        {serverRelease ? (
          <Link
            to={updateDocs}
            openInNewTab={true}
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-800 hover:underline"
            dataTestId={PROBE_UPDATE_AVAILABLE_TEST_ID}
          >
            <Icon
              icon={IconProp.Alert}
              className="h-3.5 w-3.5 flex-none text-amber-600"
            />
            <span>
              {translator.translateTemplate(PROBE_UPDATE_COPY.updateAvailable, {
                version: serverRelease,
              })}
            </span>
          </Link>
        ) : (
          <></>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid={PROBE_VERSION_TEST_ID}>
      {version}
      {serverRelease || missedFeatures.length > 0 ? (
        <div
          className="flex items-start gap-2 text-sm text-gray-700"
          data-testid={PROBE_UPDATE_TEST_ID}
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 flex-none text-yellow-600"
          />
          <div className="min-w-0 space-y-1">
            {serverRelease ? (
              <p data-testid={PROBE_OLDER_THAN_SERVER_TEST_ID}>
                {translator.translateTemplate(
                  PROBE_UPDATE_COPY.olderThanServer,
                  { version: serverRelease },
                )}
              </p>
            ) : (
              <></>
            )}
            {missedFeatures.map((feature: ProbeFeature): ReactElement => {
              return (
                <p
                  key={feature}
                  data-testid={PROBE_MISSED_FEATURE_TEST_IDS[feature]}
                >
                  {translator.translateText(PROBE_MISSED_FEATURE_COPY[feature])}
                </p>
              );
            })}
            <Link
              to={updateDocs}
              openInNewTab={true}
              className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
              dataTestId={PROBE_UPDATE_DOCS_TEST_ID}
            >
              {translator.translateText(ONE_TIME_CODE_PROBES_COPY.updateLink)}
              <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ProbeVersionElement;
