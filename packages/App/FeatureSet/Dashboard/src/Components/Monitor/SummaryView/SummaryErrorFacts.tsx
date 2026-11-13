import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import { getRequestFailedPhaseText } from "Common/Utils/Monitor/ProbeFailureReading";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import ProbeMessageLine from "./ProbeMessageLine";
import { SummaryFact, SummaryFacts } from "./SummaryFacts";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
}

export const SUMMARY_ERROR_FACTS_TEST_ID: string =
  "monitor-summary-error-facts";

export const SUMMARY_ERROR_TEST_ID: string = "monitor-summary-error";

export const SUMMARY_ERROR_DETAILS_TEST_ID: string =
  "monitor-summary-error-details";

/*
 * Why a probe's check failed, right under what the check found: the error,
 * and where the request broke when the probe could tell (the phase, the
 * error code and the details). Nothing when the check passed. The same
 * block every probe check's summary drew in a row of its own.
 *
 * The phase is named Failed Phase, as the incident's root cause names it.
 * It was Failed At, which most languages read as a time ("Fehlgeschlagen
 * am", "失败时间") above a phase.
 *
 * The probe stores all of it in English, which criteria compare. Drawn
 * here: the phase in the reader's word (DNS-Auflösung, not DNS Resolution),
 * the probe's timeout sentence in the reader's language, and the rest -
 * the network's own message, the details - as written, each on a line of
 * its own direction (ProbeMessageLine), so an English message on an Arabic
 * or Persian page keeps its full stop and its brackets at its end. The
 * error code is a code (ECONNREFUSED, HTTP_503), the same in every
 * language.
 */
const SummaryErrorFacts: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const failureCause: string | undefined =
    props.probeMonitorResponse.failureCause?.toString().trim() || undefined;
  const details: ProbeMonitorResponse["requestFailedDetails"] =
    props.probeMonitorResponse.requestFailedDetails;

  if (!failureCause && !details) {
    return <></>;
  }

  const failedPhase: string = details
    ? getRequestFailedPhaseText({
        translator: translator,
        failedPhase: details.failedPhase,
      })
    : "";
  const errorDescription: string = details?.errorDescription?.trim() || "";

  return (
    <SummaryFacts dataTestId={SUMMARY_ERROR_FACTS_TEST_ID}>
      {failureCause ? (
        <SummaryFact
          isWide={true}
          title="Error"
          value={
            <ProbeMessageLine
              message={failureCause}
              dataTestId={SUMMARY_ERROR_TEST_ID}
            />
          }
        />
      ) : (
        <></>
      )}
      {details ? (
        <>
          <SummaryFact title="Failed Phase" value={failedPhase || "-"} />
          <SummaryFact title="Error Code" value={details.errorCode || "-"} />
          <SummaryFact
            isWide={true}
            title="Error Details"
            value={
              errorDescription ? (
                <ProbeMessageLine
                  message={errorDescription}
                  dataTestId={SUMMARY_ERROR_DETAILS_TEST_ID}
                />
              ) : (
                "-"
              )
            }
          />
        </>
      ) : (
        <></>
      )}
    </SummaryFacts>
  );
};

export default SummaryErrorFacts;
