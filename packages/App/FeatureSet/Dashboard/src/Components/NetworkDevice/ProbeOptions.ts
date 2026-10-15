import Probe from "Common/Models/DatabaseModels/Probe";
import {
  translateTemplate,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

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

export interface ProbeDropdownOptionGroup {
  label: string;
  options: Array<ProbeDropdownOption>;
}

export const OWN_PROBES_GROUP_LABEL: string = translationKey("Your probes");

// OneUptime Cloud: the global probes are on the internet.
export const CLOUD_PROBES_GROUP_LABEL: string = translationKey(
  "OneUptime probes, on the internet",
);

// A self-hosted server: its global probes run beside it.
export const SERVER_PROBES_GROUP_LABEL: string = translationKey(
  "This server's probes",
);

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
 * The probes as dropdown options, the project's own first and OneUptime's
 * after them, each under a heading - so "which of these is on my network?"
 * is answered by the list itself. A list of only one kind has no headings:
 * one heading over everything says nothing.
 *
 * `isOneUptimeCloud` names OneUptime's probes for where they run: on the
 * internet on OneUptime Cloud (billing on), beside the server on a
 * self-hosted one.
 */
export function getGroupedProbeDropdownOptions(
  probes: Array<Probe>,
  options: { isOneUptimeCloud: boolean },
): Array<ProbeDropdownOption | ProbeDropdownOptionGroup> {
  const own: Array<ProbeDropdownOption> = getProbeDropdownOptions(
    probes.filter((probe: Probe): boolean => {
      return probe.isGlobalProbe !== true;
    }),
  );
  const oneUptimes: Array<ProbeDropdownOption> = getProbeDropdownOptions(
    probes.filter((probe: Probe): boolean => {
      return probe.isGlobalProbe === true;
    }),
  );

  if (own.length === 0 || oneUptimes.length === 0) {
    return [...own, ...oneUptimes];
  }

  return [
    {
      label: translateText(OWN_PROBES_GROUP_LABEL) || OWN_PROBES_GROUP_LABEL,
      options: own,
    },
    {
      label:
        (options.isOneUptimeCloud
          ? translateText(CLOUD_PROBES_GROUP_LABEL)
          : translateText(SERVER_PROBES_GROUP_LABEL)) ||
        (options.isOneUptimeCloud
          ? CLOUD_PROBES_GROUP_LABEL
          : SERVER_PROBES_GROUP_LABEL),
      options: oneUptimes,
    },
  ];
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

/**
 * Whether the project has a probe of its own - one that runs on its network.
 * Global probes do not count: on OneUptime Cloud they are on the internet,
 * where a private address cannot be reached.
 */
export function hasProjectProbe(probes: Array<Probe>): boolean {
  return probes.some((probe: Probe): boolean => {
    return probe.isGlobalProbe !== true && Boolean(probe._id);
  });
}

/*
 * What the probe fields say to a project with no probe of its own: the field
 * is required, and its list holds nothing that can reach the network (or
 * nothing at all). It says why and what to do, and its link opens the
 * Network Overview's "Add a probe" dialog in a new tab, so the form being
 * filled in is not lost.
 */
export const ADD_PROBE_LINK_TEXT: string = translationKey("Add a probe");

export const ADD_DEVICE_NO_PROBE_DESCRIPTION: string = translationKey(
  "You have no probe on your network yet. Add one first: it checks this device from inside your network, which a probe on the internet cannot reach. Then pick it here.",
);

export const SCAN_NO_PROBE_DESCRIPTION: string = translationKey(
  "You have no probe on your network yet. Add one first: it sweeps the range from inside your network, which a probe on the internet cannot reach. Then pick it here.",
);
