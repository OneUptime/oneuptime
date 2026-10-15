import ProbeUtil from "../../Utils/Probe";
import Probe from "Common/Models/DatabaseModels/Probe";
import { useEffect } from "react";

/*
 * The probe fields of Add Device and the scan form link to the Network
 * Overview's "Add a probe" dialog in a new tab, so the form being filled in
 * is not lost. When the person comes back to this tab, the probes are read
 * again and handed to `onProbes`, so the probe they just added is in the list
 * at once - without a reload, which would close the open form.
 *
 * Quietly: a failed read keeps the list the page already has.
 */
export default function useRefreshProbesOnFocus(
  onProbes: (probes: Array<Probe>) => void,
): void {
  useEffect(() => {
    let isMounted: boolean = true;

    const onWindowFocus: () => void = (): void => {
      ProbeUtil.getAllProbes()
        .then((probes: Array<Probe>) => {
          if (isMounted) {
            onProbes(probes);
          }
        })
        .catch(() => {
          // The list the page already has stands.
        });
    };

    window.addEventListener("focus", onWindowFocus);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);
}
