import FindingOccurrences from "./FindingOccurrences";
import { DataTypeNamer, useDataTypeNamer } from "./IssueDataTypes";
import {
  FindingSummary,
  getMaskedSamples,
  getTelemetryStoreOwnerName,
  MaskedSamples,
  ScrubUnavailableNote,
  TelemetryStoreOfFindings,
  TelemetryStoreOwnerLine,
} from "./IssueTelemetryFindings";
import { SCRUB_IT, ScrubItState } from "./TelemetryScrubIt";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import SideOver from "Common/UI/Components/SideOver/SideOver";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * ONE TELEMETRY FINDING'S RECORDS, BESIDE THE LIST (issue #9605).
 *
 * In Your Telemetry lists what was found across every service - "an email
 * address in body of checkout's logs" - and Show Records opens this panel
 * over it, so the list keeps its place: what was found and where (its data
 * type, the service and signal, the location, how many sampled values
 * matched), then the records it was found in (FindingOccurrences, as an
 * issue's Where It Was Found reads them): each log line, span, exception,
 * AI call, session or metric data point, its data marked and every
 * sensitive value masked, opening in Logs, Traces or Metrics under the
 * reader's own permissions. With no record to show, the masked samples.
 *
 * Scrub It is the panel's action, for a finding no rule hides yet, made
 * under the reader's permission to create that rule; where no rule
 * reaches the place - a metric's name, a session's own details - the panel
 * says why instead. Only a reader who may read the masked samples opens it
 * (the page offers Show Records to them alone), and the records route
 * checks again that they may read the store's telemetry itself.
 */

export const FINDING_RECORDS_PANEL_TEST_ID: string =
  "data-security-finding-records-panel";

export interface ComponentProps {
  finding: DataStoreFinding;
  // The telemetry store the finding is in: its kind, name, service and key.
  store: TelemetryStoreOfFindings | undefined;
  // Scrub It on this finding, for this reader (getScrubItState).
  scrubIt: ScrubItState;
  isScrubbing: boolean;
  // Why the last Scrub It failed, in the reader's words, if it did.
  scrubError?: string | undefined;
  onScrub: () => void;
  onClose: () => void;
}

const FindingRecordsPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const namer: DataTypeNamer = useDataTypeNamer();
  const finding: DataStoreFinding = props.finding;
  const findingId: string = finding._id?.toString() || "";
  const samples: Array<string> = getMaskedSamples(finding);
  const canScrub: boolean =
    !finding.isScrubbed && props.scrubIt.isShown && props.scrubIt.isAllowed;
  const lockedReason: string =
    !finding.isScrubbed && props.scrubIt.isShown && !props.scrubIt.isAllowed
      ? props.scrubIt.disabledReason || ""
      : "";

  return (
    <SideOver
      title="Where It Was Found"
      description="The records this finding was seen in, its data highlighted and every sensitive value masked."
      onClose={props.onClose}
      {...(canScrub
        ? {
            onSubmit: props.onScrub,
            submitButtonText: SCRUB_IT,
            submitButtonIsLoading: props.isScrubbing,
          }
        : {})}
    >
      <div className="space-y-4" data-testid={FINDING_RECORDS_PANEL_TEST_ID}>
        <div className="space-y-2">
          <FindingSummary finding={finding} namer={namer} />
          <TelemetryStoreOwnerLine store={props.store} />
          {!finding.isScrubbed && props.scrubIt.unavailableReason ? (
            <ScrubUnavailableNote scrubIt={props.scrubIt} />
          ) : (
            <></>
          )}
          {/* The gate's reason is in the reader's words already. */}
          {lockedReason ? (
            <p
              className="text-xs text-gray-600"
              data-testid="data-security-finding-records-scrub-locked"
            >
              {lockedReason}
            </p>
          ) : (
            <></>
          )}
        </div>

        {props.scrubError ? (
          <Alert
            type={AlertType.DANGER}
            title={props.scrubError}
            dataTestId="data-security-finding-records-scrub-error"
          />
        ) : (
          <></>
        )}

        {findingId ? (
          <FindingOccurrences
            findingId={new ObjectID(findingId)}
            ownerName={getTelemetryStoreOwnerName(props.store)}
            fallback={
              samples.length > 0 ? (
                <MaskedSamples samples={samples} />
              ) : undefined
            }
          />
        ) : (
          <></>
        )}
      </div>
    </SideOver>
  );
};

export default FindingRecordsPanel;
