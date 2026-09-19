import {
  EnterpriseLicenseMode,
  fetchEnterpriseLicenseMode,
} from "./EnterpriseLicenseMode";
import { useEffect, useState } from "react";

/*
 * The Enterprise license mode for the identity screens, read once when the
 * screen mounts. Starts as Unknown (nothing hidden) until the answer arrives.
 */
const useEnterpriseLicenseMode: () => EnterpriseLicenseMode =
  (): EnterpriseLicenseMode => {
    const [mode, setMode] = useState<EnterpriseLicenseMode>(
      EnterpriseLicenseMode.Unknown,
    );

    useEffect(() => {
      let isMounted: boolean = true;

      fetchEnterpriseLicenseMode()
        .then((nextMode: EnterpriseLicenseMode) => {
          if (isMounted) {
            setMode(nextMode);
          }
        })
        .catch(() => {
          // fetchEnterpriseLicenseMode never rejects; Unknown is already set.
        });

      return () => {
        isMounted = false;
      };
    }, []);

    return mode;
  };

export default useEnterpriseLicenseMode;
