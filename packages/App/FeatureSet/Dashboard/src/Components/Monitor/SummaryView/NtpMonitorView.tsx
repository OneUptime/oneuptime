import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import NtpLeapIndicator from "Common/Types/Monitor/NtpMonitor/NtpLeapIndicator";
import NtpMonitorResponse from "Common/Types/Monitor/NtpMonitor/NtpMonitorResponse";
import NtpMonitorUtil, {
  DEFAULT_NTP_PORT,
  NTP_MAX_SYNCHRONIZED_STRATUM,
} from "Common/Types/Monitor/NtpMonitor/NtpMonitorUtil";
import HostAddressUtil from "Common/Utils/HostAddressUtil";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import NetworkPathView from "./NetworkPathView";
import ProbeAttemptsView from "./ProbeAttemptsView";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

/*
 * The latest NTP check: the server, whether it answered and is synchronized,
 * and - for a server that answered - its clock offset, stratum, reference
 * and the rest of its reply's header, with what each one means a hover away.
 *
 * Cards go two to a row, and four once the summary itself is wide enough
 * (SummaryFacts): by the summary's width, not the screen's, which put four
 * to a row in the overview's two-thirds card.
 */
const NtpMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const response: ProbeMonitorResponse = props.probeMonitorResponse;
  const ntpResponse: NtpMonitorResponse | undefined = response.ntpResponse;
  const isAnswered: boolean = Boolean(ntpResponse?.isOnline);

  const probeAttempts: Array<ProbeAttempt> = response.probeAttempts || [];
  const totalAttempts: number = response.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  const port: number = ntpResponse?.port || DEFAULT_NTP_PORT;
  const host: string = response.monitorDestination?.toString() || "";
  const server: string = host
    ? HostAddressUtil.formatHostAndPort({ host: host, port: port })
    : "-";
  // The address a name resolved to, when it is not what was typed.
  const serverAddress: string | undefined =
    ntpResponse?.serverAddress && ntpResponse.serverAddress !== host
      ? ntpResponse.serverAddress
      : undefined;

  const formatMs: (value: number | undefined) => string = (
    value: number | undefined,
  ): string => {
    return value === undefined || value === null
      ? "-"
      : NtpMonitorUtil.formatMilliseconds(value);
  };

  const getOffsetText: () => string = (): string => {
    const offset: number | undefined = ntpResponse?.clockOffsetInMs;

    if (offset === undefined || offset === null) {
      return "-";
    }

    if (offset === 0) {
      return translator.translateTemplate("In step with the probe");
    }

    const formatted: string = NtpMonitorUtil.formatMilliseconds(
      Math.abs(offset),
    );

    return offset > 0
      ? translator.translateTemplate("{{offset}} ahead of the probe", {
          offset: formatted,
        })
      : translator.translateTemplate("{{offset}} behind the probe", {
          offset: formatted,
        });
  };

  const getStratumText: () => string = (): string => {
    const stratum: number | undefined = ntpResponse?.stratum;

    if (stratum === undefined || stratum === null) {
      return "-";
    }

    if (stratum === 0) {
      return ntpResponse?.kissCode
        ? translator.translateTemplate("0 (kiss-o'-death {{kissCode}})", {
            kissCode: ntpResponse.kissCode,
          })
        : translator.translateTemplate("0 (not synchronized)");
    }

    if (stratum === 1) {
      return translator.translateTemplate("1 (primary server)");
    }

    if (stratum <= NTP_MAX_SYNCHRONIZED_STRATUM) {
      return translator.translateTemplate("{{stratum}} (secondary server)", {
        stratum: String(stratum),
      });
    }

    return translator.translateTemplate("{{stratum}} (not synchronized)", {
      stratum: String(stratum),
    });
  };

  const getLeapText: () => string = (): string => {
    switch (ntpResponse?.leapIndicator) {
      case NtpLeapIndicator.NoWarning:
        return translator.translateTemplate("No warning");
      case NtpLeapIndicator.LastMinuteHas61Seconds:
        return translator.translateTemplate("Leap second today (+1 s)");
      case NtpLeapIndicator.LastMinuteHas59Seconds:
        return translator.translateTemplate("Leap second today (-1 s)");
      case NtpLeapIndicator.Unsynchronized:
        return translator.translateTemplate("Alarm: not synchronized");
      default:
        return "-";
    }
  };

  const formatDate: (iso: string | undefined) => string = (
    iso: string | undefined,
  ): string => {
    if (!iso) {
      return "-";
    }

    const date: Date = new Date(iso);

    return isNaN(date.getTime())
      ? "-"
      : OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
  };

  return (
    <SummaryView dataTestId="ntp-monitor-summary">
      <SummaryFacts>
        <SummaryFact
          isWide={true}
          title="NTP Server"
          value={serverAddress ? `${server} (${serverAddress})` : server}
        />
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        <SummaryFact
          title="Status"
          value={translator.translateTemplate(
            response.isOnline ? "Online" : "Offline",
          )}
        />
        <SummaryFact
          title="Synchronized"
          tooltip="Answered at stratum 1 to 15, without the leap indicator's alarm."
          value={
            isAnswered
              ? translator.translateTemplate(
                  ntpResponse?.isSynchronized ? "Yes" : "No",
                )
              : "-"
          }
        />
        <SummaryFact
          title="Monitored At"
          value={
            response.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  response.monitoredAt,
                )
              : "-"
          }
        />
        {response.failureCause ? (
          <SummaryFact
            isWide={true}
            title={isAnswered ? "Not Synchronized" : "Error"}
            value={response.failureCause.toString()}
          />
        ) : (
          <></>
        )}
      </SummaryFacts>

      {isAnswered && ntpResponse && (
        <SummaryFacts dataTestId="ntp-monitor-reply-facts">
          <SummaryFact
            title="Clock Offset"
            tooltip="How far the server's clock is from this probe's clock, measured from the four timestamps of the exchange. It is measured against the probe's clock: if every server shows a similar offset from one probe, check that probe's time."
            value={getOffsetText()}
          />
          <SummaryFact
            title="Stratum"
            tooltip="Hops from a reference clock: 1 is a server with its own GPS or atomic source, 2 syncs to a stratum 1 server, and so on. 16 means not synchronized."
            value={getStratumText()}
          />
          <SummaryFact
            title="Reference"
            tooltip="What the server synchronizes to: a source such as GPS at stratum 1, or its upstream server's address."
            value={ntpResponse.referenceId || "-"}
          />
          <SummaryFact
            title="Response Time"
            value={formatMs(ntpResponse.responseTimeInMs)}
          />
          <SummaryFact
            title="Leap Indicator"
            tooltip="Warns of a leap second at the end of the day. 3 is an alarm: the server says its clock is not synchronized."
            value={getLeapText()}
          />
          <SummaryFact
            title="Root Dispersion"
            tooltip="The server's own estimate of how far its time could be from the true time. Clients stop trusting a server once it passes about a second."
            value={formatMs(ntpResponse.rootDispersionInMs)}
          />
          <SummaryFact
            title="Root Delay"
            tooltip="Round trip from the server to its reference clock."
            value={formatMs(ntpResponse.rootDelayInMs)}
          />
          <SummaryFact
            title="Server Time"
            value={formatDate(ntpResponse.serverTime)}
          />
        </SummaryFacts>
      )}

      {response.networkPathTrace && (
        <NetworkPathView networkPathTrace={response.networkPathTrace} />
      )}

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}
    </SummaryView>
  );
};

export default NtpMonitorView;
