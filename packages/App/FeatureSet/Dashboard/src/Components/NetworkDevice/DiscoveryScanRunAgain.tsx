import {
  getDiscoveryScanLastRunAt,
  getDiscoveryScanRunRequester,
  isDiscoveryScanReadyToRunAgain,
  requestDiscoveryScanRun,
} from "./DiscoveryScanRunAgainState";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import { getErrorInSentenceText } from "Common/UI/Utils/ErrorInSentence";
import { writeReaderMoment } from "Common/UI/Utils/ReaderMoments";
import Toast from "Common/UI/Utils/Toast";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * RUN AGAIN, ON A DISCOVERY SCAN'S ROW (OneUptime issue #10334).
 *
 * A scan that does not repeat used to end its row at "Completed", with no
 * way to sweep the same range again but to create the same scan once more.
 * Under the scan's progress, in the Status column, this says when the scan
 * last ran - how fresh the results beside it are - and who asked for the
 * run on the row when someone did, and, once the run has ended, offers Run
 * Again to whoever may edit scans. Pressed, the same scan is queued again
 * (NetworkDeviceDiscoveryScanService.runAgain): the row turns Queued, then
 * Scanning, and the new results replace the old.
 *
 * Here rather than in the row's ⋯ menu: Review Results is the row's one
 * button whenever a scan has results, and a Run Again folded behind it
 * would leave a finished scan looking as finished as before. Beside the
 * time of the last run is where the question "run it again?" comes up.
 * While a run is queued or sweeping there is no button - the progress
 * above it is the run - and the server refuses a second run in any case.
 */

// What the toast says of a scan with neither a name nor a target to name it by.
const QUEUED_WITHOUT_A_NAME: string = translationKey(
  "The scan is queued to run again.",
);

export interface DiscoveryScanRunAgainProps {
  scan: NetworkDeviceDiscoveryScan;
  // Whether the reader may edit discovery scans, which running one takes.
  canRun: boolean;
  // Called once the run is queued, to read the list again.
  onRunQueued: () => void;
}

const DiscoveryScanRunAgain: FunctionComponent<DiscoveryScanRunAgainProps> = (
  props: DiscoveryScanRunAgainProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isRequesting, setIsRequesting] = useState<boolean>(false);

  const scan: NetworkDeviceDiscoveryScan = props.scan;
  const scanId: string = scan._id?.toString() || "";
  const scanLabel: string = ScanNameUtil.getScanLabel(scan) || "";
  const lastRunAt: Date | null = getDiscoveryScanLastRunAt(scan);
  const requester: string | null = getDiscoveryScanRunRequester(scan);
  const canRunAgain: boolean =
    props.canRun && Boolean(scanId) && isDiscoveryScanReadyToRunAgain(scan);

  const runAgain: () => Promise<void> = async (): Promise<void> => {
    setIsRequesting(true);

    try {
      await requestDiscoveryScanRun(scanId);

      Toast.success(
        scanLabel
          ? translator.translateTemplate("{{scan}} is queued to run again.", {
              scan: scanLabel,
            })
          : translator.translateText(QUEUED_WITHOUT_A_NAME) ||
              QUEUED_WITHOUT_A_NAME,
      );

      props.onRunQueued();
    } catch (err) {
      /*
       * Why it did not run - already running, its probe not connected -
       * in the reader's words: each refusal is a key of the locales
       * (DiscoveryScanRun), and an error nobody explained is said with
       * what to do next.
       */
      Toast.error(
        getErrorInSentenceText({
          message: API.getFriendlyMessage(err),
          translator: translator,
        }),
      );
    }

    setIsRequesting(false);
  };

  if (!lastRunAt && !requester && !canRunAgain) {
    return <></>;
  }

  return (
    <div
      className="space-y-2"
      data-testid={`discovery-scan-run-again-${scanId}`}
    >
      {lastRunAt ? (
        <p
          className="text-xs text-gray-500"
          title={writeReaderMoment(lastRunAt)}
          data-testid="discovery-scan-last-run"
        >
          {requester
            ? translator.translateTemplate(
                "Last run {{time}}, requested by {{name}}",
                {
                  time: OneUptimeDate.fromNow(lastRunAt),
                  name: requester,
                },
              )
            : translator.translateTemplate("Last run {{time}}", {
                time: OneUptimeDate.fromNow(lastRunAt),
              })}
        </p>
      ) : (
        requester && (
          <p
            className="text-xs text-gray-500"
            data-testid="discovery-scan-run-requester"
          >
            {translator.translateTemplate("Requested by {{name}}", {
              name: requester,
            })}
          </p>
        )
      )}
      {canRunAgain && (
        <Button
          title="Run Again"
          icon={IconProp.Play}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          isLoading={isRequesting}
          /*
           * Every finished row has one: the scan's own name tells a screen
           * reader which, as the row's first column does the eye.
           */
          ariaLabel={
            scanLabel
              ? translator.translateTemplate("Run {{scan}} again", {
                  scan: scanLabel,
                })
              : undefined
          }
          // Worded above with the scan's name; looked up again, it is no key.
          isAriaLabelTranslated={true}
          dataTestId={`discovery-scan-run-again-button-${scanId}`}
          onClick={() => {
            void runAgain();
          }}
        />
      )}
    </div>
  );
};

export default DiscoveryScanRunAgain;
