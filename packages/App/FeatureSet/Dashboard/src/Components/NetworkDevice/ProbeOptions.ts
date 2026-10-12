import Probe from "Common/Models/DatabaseModels/Probe";
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * The probe pickers on the Add Device form and the new-scan form: which
 * probes they list, and which one they start on. Both ask the same question
 * - "which probe can reach this address?" - so they answer it the same way.
 *
 * Plain logic, free of React and of the routes, so App/Tests can read it.
 */

export interface ProbeDropdownOption {
  label: string;
  value: string;
}

/**
 * The probes as dropdown options.
 *
 * A probe with no id cannot be picked, so it is left out. A probe with no
 * name can be, so it is listed by its id. The Devices page used to throw for
 * either while it rendered, so one unnamed probe row blanked the whole page.
 */
export function getProbeDropdownOptions(
  probes: Array<Probe>,
): Array<ProbeDropdownOption> {
  return probes
    .filter((probe: Probe): boolean => {
      return Boolean(probe._id);
    })
    .map((probe: Probe): ProbeDropdownOption => {
      const id: string = String(probe._id);

      return {
        label: probe.name || translateTemplate("Probe {{id}}", { id: id }),
        value: id,
      };
    });
}

/**
 * The probe a form starts on: the project's one custom probe, when it has
 * exactly one. Global probes are never the default - they sit on the public
 * internet and cannot reach a private address, so a device (or a scan) left
 * on one finds nothing for no reason the person can see. With two custom
 * probes there is no "the" probe, and with none the person picks.
 */
export function getDefaultProbeId(probes: Array<Probe>): string {
  const customProbes: Array<Probe> = probes.filter((probe: Probe): boolean => {
    return probe.isGlobalProbe !== true && Boolean(probe._id);
  });

  if (customProbes.length !== 1) {
    return "";
  }

  return customProbes[0]?._id?.toString() || "";
}
