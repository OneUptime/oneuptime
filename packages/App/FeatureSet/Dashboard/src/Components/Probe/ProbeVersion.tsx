import Probe from "Common/Models/DatabaseModels/Probe";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { FIRST_PROBE_VERSION_WITH_TOTP_CODES } from "Common/Types/Probe/ProbeCapability";
import ProbeReportedVersionUtil, {
  ProbeOneTimeCodes,
} from "Common/Types/Probe/ProbeReportedVersion";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  ONE_TIME_CODE_PROBES_COPY,
  UPDATE_A_PROBE_DOCS_PATH,
} from "../Monitor/OneTimeCodeProbes";

export interface ComponentProps {
  probe: Probe | JSONObject;
}

export const PROBE_VERSION_TEST_ID: string = "probe-version";
export const PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID: string =
  "probe-too-old-for-one-time-codes";

/*
 * The release a probe says it runs, on its page (OneUptime issue #9759),
 * and - for a custom probe too old to make one-time codes - that it cannot
 * run the monitors that use a one-time code secret, with how to update it
 * one click away.
 *
 *   - It says a release: the release.
 *   - It has connected and says none: it is older than the first release
 *     that says one, FIRST_PROBE_VERSION_WITH_TOTP_CODES.
 *   - It says a build that is no release ("unknown"): that, as written.
 *   - It never connected: the quiet dash.
 *
 * The line under it is drawn only for a probe that is too old: a probe
 * that runs no such monitor loses nothing but the line, and one that does
 * is told why its checks fail.
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

  const oneTimeCodes: ProbeOneTimeCodes =
    ProbeReportedVersionUtil.getOneTimeCodes({
      isGlobalProbe: Boolean(record["isGlobalProbe"]),
      reportedVersion: reportedVersion,
      lastAlive: (record["lastAlive"] as Date | string | undefined) || null,
    });

  const isTooOld: boolean = oneTimeCodes === ProbeOneTimeCodes.TooOld;

  let version: ReactElement;

  if (reportedVersion) {
    // A release, or what a build that is none says: the probe's words.
    version = (
      <span dir="ltr" className="font-mono text-sm text-gray-900">
        {ProbeReportedVersionUtil.getRelease(reportedVersion) ||
          reportedVersion}
      </span>
    );
  } else if (isTooOld) {
    version = (
      <span className="text-sm text-gray-900">
        {translator.translateTemplate(ONE_TIME_CODE_PROBES_COPY.olderThan, {
          version: FIRST_PROBE_VERSION_WITH_TOTP_CODES,
        })}
      </span>
    );
  } else {
    version = <EmptyValue />;
  }

  return (
    <div className="space-y-1" data-testid={PROBE_VERSION_TEST_ID}>
      {version}
      {isTooOld && (
        <div
          className="flex items-start gap-2 text-sm text-gray-700"
          data-testid={PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID}
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 flex-none text-yellow-600"
          />
          <div className="min-w-0 space-y-1">
            <p>
              {translator.translateText(ONE_TIME_CODE_PROBES_COPY.probeTooOld)}
            </p>
            <Link
              to={URL.fromString(
                `${DOCS_URL.toString()}${UPDATE_A_PROBE_DOCS_PATH}`,
              )}
              openInNewTab={true}
              className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
              dataTestId={`${PROBE_TOO_OLD_FOR_ONE_TIME_CODES_TEST_ID}-docs`}
            >
              {translator.translateText(ONE_TIME_CODE_PROBES_COPY.updateLink)}
              <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProbeVersionElement;
