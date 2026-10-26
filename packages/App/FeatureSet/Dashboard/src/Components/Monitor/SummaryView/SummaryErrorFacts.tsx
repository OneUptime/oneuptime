import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import React, { FunctionComponent, ReactElement } from "react";
import { SummaryFact, SummaryFacts } from "./SummaryFacts";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
}

export const SUMMARY_ERROR_FACTS_TEST_ID: string =
  "monitor-summary-error-facts";

/*
 * Why a probe's check failed, right under what the check found: the error,
 * and where the request broke when the probe could tell (the phase, the
 * error code and the details). Nothing when the check passed. The same
 * block every probe check's summary drew in a row of its own.
 */
const SummaryErrorFacts: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const failureCause: string | undefined =
    props.probeMonitorResponse.failureCause?.toString() || undefined;
  const details: ProbeMonitorResponse["requestFailedDetails"] =
    props.probeMonitorResponse.requestFailedDetails;

  if (!failureCause && !details) {
    return <></>;
  }

  return (
    <SummaryFacts dataTestId={SUMMARY_ERROR_FACTS_TEST_ID}>
      {failureCause ? (
        <SummaryFact isWide={true} title="Error" value={failureCause} />
      ) : (
        <></>
      )}
      {details ? (
        <>
          <SummaryFact title="Failed At" value={details.failedPhase || "-"} />
          <SummaryFact title="Error Code" value={details.errorCode || "-"} />
          <SummaryFact
            isWide={true}
            title="Error Details"
            value={details.errorDescription || "-"}
          />
        </>
      ) : (
        <></>
      )}
    </SummaryFacts>
  );
};

export default SummaryErrorFacts;
