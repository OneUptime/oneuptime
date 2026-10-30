import { expect } from "@jest/globals";
import * as React from "react";
import type {
  AiCardFold,
  RemediationFoldState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiOffSummaryData";
import type { ComponentProps as RemediationStepProps } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";

/*
 * The AI card's Remediation step (block 43), as a stand-in for the suites
 * of the card around it (InvestigationPanel): the step reads and polls on
 * its own, and its own suites cover that. Here it records what the card
 * hands it, and says what fixing did - what a test sets with
 * setRemediationStepReads - the way the step does once it has read it.
 * Until a test sets something, it has not read anything yet.
 *
 *   jest.mock(
 *     "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep",
 *     () => {
 *       return jest.requireActual("./RemediationStepStub");
 *     },
 *   );
 */

interface StubState {
  reads: RemediationFoldState | null;
  props: Array<RemediationStepProps>;
}

const stub: StubState = { reads: null, props: [] };

export function setRemediationStepReads(
  reads: RemediationFoldState | null,
): void {
  stub.reads = reads;
}

export function resetRemediationStepStub(): void {
  stub.reads = null;
  stub.props = [];
}

export function remediationStepRenders(): Array<RemediationStepProps> {
  return stub.props;
}

export function lastRemediationStepProps(): RemediationStepProps {
  expect(stub.props.length).toBeGreaterThan(0);
  return stub.props[stub.props.length - 1]!;
}

// How the card is drawn, as the card last told its step.
export function lastAiCardFold(): AiCardFold | undefined {
  return lastRemediationStepProps().aiCardFold;
}

const RemediationStepStub: React.FunctionComponent<RemediationStepProps> = (
  props: RemediationStepProps,
): React.ReactElement => {
  stub.props.push(props);

  const reads: RemediationFoldState | null = stub.reads;
  const readsKey: string = reads ? JSON.stringify(reads) : "";
  const subjectId: string =
    props.incidentId?.toString() || props.alertId?.toString() || "";
  const onFoldStateChangeRef: React.MutableRefObject<
    ((state: RemediationFoldState) => void) | undefined
  > = React.useRef<((state: RemediationFoldState) => void) | undefined>(
    props.onFoldStateChange,
  );
  onFoldStateChangeRef.current = props.onFoldStateChange;

  // Said afresh for every record, and whenever a test changes what it read.
  React.useEffect(() => {
    if (readsKey) {
      onFoldStateChangeRef.current?.(
        JSON.parse(readsKey) as RemediationFoldState,
      );
    }
  }, [readsKey, subjectId]);

  // Drawn on a whole card only, as the step itself is.
  return props.aiCardFold === "full" ? (
    <div
      data-testid="remediation-step"
      data-stage={props.investigationStage}
      data-subject={subjectId}
    />
  ) : (
    <></>
  );
};

export default RemediationStepStub;
