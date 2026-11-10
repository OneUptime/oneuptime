import { Context, createContext, useContext, useEffect } from "react";

/*
 * Between a telemetry product's explanation (ProductOnboarding's
 * TelemetryFirstRunShowcase) and the explorer drawn under it.
 *
 * The explanation asks whether any service has reported, which cannot see
 * telemetry that names no service: a host's syslog, a Proxmox or VMware
 * host's logs. Such a project has data and no service. So the explanation
 * also waits for the explorer itself to be empty: the explorer's first
 * steps (TelemetryFirstStepsEmptyState) say when they are drawn, and an
 * explorer that draws data says so, and the explanation gives way.
 *
 * While the explanation offers the setup guide as its button, the first
 * steps leave their own setup button out: one way in, not two.
 *
 * An explorer drawn anywhere else (a service's Logs tab) has no host, and
 * none of this applies.
 */
export interface TelemetryFirstRunHost {
  // The explorer drew its first steps: an empty list nothing narrows.
  onFirstStepsShown: () => void;
  // The explorer drew data: the project sends this telemetry.
  onDataShown: () => void;
  // The explanation above the explorer offers the setup guide as its button.
  offersSetup: boolean;
}

export const TelemetryFirstRunHostContext: Context<TelemetryFirstRunHost | null> =
  createContext<TelemetryFirstRunHost | null>(null);

export function useTelemetryFirstRunHost(): TelemetryFirstRunHost | null {
  return useContext(TelemetryFirstRunHostContext);
}

// An explorer under an explanation: says so once it draws data.
export function useReportTelemetryDataShown(isDataShown: boolean): void {
  const host: TelemetryFirstRunHost | null = useContext(
    TelemetryFirstRunHostContext,
  );
  const onDataShown: (() => void) | undefined = host?.onDataShown;

  useEffect(() => {
    if (isDataShown && onDataShown) {
      onDataShown();
    }
  }, [isDataShown, onDataShown]);
}
