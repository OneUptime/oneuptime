import React, { FunctionComponent, ReactElement } from "react";
import OneUptimeDate from "Common/Types/Date";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { composedValue, Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import {
  IoTDeviceStatusReading,
  getIoTDeviceStatus,
} from "../../Pages/IoT/Utils/IoTFleetConnection";

/*
 * AN IOT DEVICE'S STATE, AS THE DEVICES LIST AND ITS OWN PAGE DRAW IT.
 *
 * Online in green, Offline in red - while its fleet reports. While the
 * fleet is disconnected its last state is from before the fleet stopped,
 * so the chip says the fleet is disconnected, in grey, and under it what
 * the device last reported and when: "Last reported online 3 hours ago",
 * the moment itself under the pointer (#10014). A red "Offline" on every
 * row pointed at the devices when the fleet's collector was what went
 * away. Before its first heartbeat a device has no state: the quiet dash.
 */

export interface ComponentProps {
  isUp: boolean | null | undefined;
  isFleetConnected: boolean;
  lastSeenAt?: Date | string | null | undefined;
  // Prefix of its test ids: `${testId}-last-report`.
  testId?: string | undefined;
  // Now, for the relative time: the page's clock, a test's.
  now?: Date | undefined;
}

const IoTDeviceStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const reading: IoTDeviceStatusReading | null = getIoTDeviceStatus({
    isUp: props.isUp,
    isFleetConnected: props.isFleetConnected,
    lastSeenAt: props.lastSeenAt,
  });

  if (!reading) {
    return <TableEmptyValue />;
  }

  const testId: string = props.testId || "iot-device-status";
  const lastReport: { template: string; at: Date } | undefined =
    reading.lastReport;

  return (
    <div className="flex flex-col items-start gap-1" data-testid={testId}>
      <Pill
        text={reading.label}
        tone={reading.tone}
        tooltip={reading.tooltip}
      />
      {lastReport ? (
        <span
          className="text-xs text-gray-500"
          data-testid={`${testId}-last-report`}
          title={OneUptimeDate.getDateAsLocalFormattedString(lastReport.at)}
        >
          {translator.translateTemplate(lastReport.template, {
            // In the language the sentence is shown in.
            time: composedValue((sentence: Translator): string => {
              return formatRelativeTime({
                date: lastReport.at,
                now: props.now || new Date(),
                language: sentence.language,
              });
            }),
          })}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default IoTDeviceStatus;
