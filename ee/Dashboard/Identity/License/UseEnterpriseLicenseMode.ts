import {
  EnterpriseLicenseMode,
  LicensedFeature,
  fetchEnterpriseLicenseMode,
} from "./EnterpriseLicenseMode";
import { useEffect, useState } from "react";

/*
 * The Enterprise license mode for a screen, read once when the screen mounts.
 * A screen about one feature names it, so a license that leaves the feature
 * out reads as NotIncluded. Starts as Unknown (nothing hidden) until the
 * answer arrives.
 */
const useEnterpriseLicenseMode: (
  feature?: LicensedFeature | undefined,
) => EnterpriseLicenseMode = (
  feature?: LicensedFeature | undefined,
): EnterpriseLicenseMode => {
  const [mode, setMode] = useState<EnterpriseLicenseMode>(
    EnterpriseLicenseMode.Unknown,
  );

  useEffect(() => {
    let isMounted: boolean = true;

    fetchEnterpriseLicenseMode(feature)
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
  }, [feature]);

  return mode;
};

export default useEnterpriseLicenseMode;
