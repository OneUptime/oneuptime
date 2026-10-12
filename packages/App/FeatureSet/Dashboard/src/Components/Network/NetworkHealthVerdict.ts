/*
 * The one sentence the Network Overview opens with: is my network healthy,
 * and if not, what is wrong?
 *
 * "Think from first principles ... it should basically wow users." (the
 * maintainer) Someone opening Network wants that answer before anything
 * else, and the page used to make them work it out from four tiles and two
 * lists. Now the first thing on the page says it, worst news first:
 *
 *   1. devices are down - nothing answers at their address;
 *   2. sites are unhealthy - a site's rollup is not operational;
 *   3. interfaces are down - every device answers, but ports are dark;
 *   4. SNMP is failing - a device answers ping, but its details are not
 *      being read, so its interfaces and health are going stale;
 *   5. waiting - devices were added and no probe has checked them yet;
 *   6. healthy - every device answers.
 *
 * Plain logic over the overview's counts, free of React, so App/Tests can
 * pin it. The words are plural pairs ({ one, other }) of English keys,
 * written as plain literals so the string extractor files each "one"
 * sentence under its "other" key; the hero looks them up where it draws
 * them.
 */

export enum NetworkHealthTone {
  // Something is down: red.
  Critical = "critical",
  // Everything answers, but something needs a look: amber.
  Warning = "warning",
  // Nothing has been checked yet: grey, and no alarm.
  Waiting = "waiting",
  // Everything answers: green.
  Healthy = "healthy",
}

export enum NetworkHealthVerdictKind {
  DevicesDown = "devices-down",
  SitesUnhealthy = "sites-unhealthy",
  InterfacesDown = "interfaces-down",
  SnmpFailing = "snmp-failing",
  Waiting = "waiting",
  Healthy = "healthy",
}

export interface NetworkHealthPlural {
  one: string;
  other: string;
}

export interface NetworkHealthVerdictInput {
  totalDevices: number;
  devicesUp: number;
  devicesDown: number;
  devicesPending: number;
  interfacesDown: number;
  unhealthySites: number;
  // Devices that answer ping while their SNMP walk fails.
  snmpFailingDevices: number;
}

export interface NetworkHealthVerdict {
  kind: NetworkHealthVerdictKind;
  tone: NetworkHealthTone;
  // The headline, worded for `headlineCount`.
  headline: NetworkHealthPlural;
  headlineCount: number;
  // The line under it, worded for `detailCount` when it has a count.
  detail: NetworkHealthPlural;
  detailCount: number;
}

/*
 * Every headline and line, as keys. A sentence that does not depend on a
 * count still comes as a pair with both forms equal, so the hero draws every
 * verdict one way.
 */
export const NETWORK_HEALTH_COPY: Record<
  NetworkHealthVerdictKind,
  { headline: NetworkHealthPlural; detail: NetworkHealthPlural }
> = {
  [NetworkHealthVerdictKind.DevicesDown]: {
    headline: {
      one: "{{count}} device is down",
      other: "{{count}} devices are down",
    },
    detail: {
      one: "Its probe or monitor cannot reach it. It is listed first under Devices needing attention.",
      other:
        "Their probes or monitors cannot reach them. They are listed first under Devices needing attention.",
    },
  },
  [NetworkHealthVerdictKind.SitesUnhealthy]: {
    headline: {
      one: "{{count}} site needs attention",
      other: "{{count}} sites need attention",
    },
    detail: {
      one: "Every device answers, but a site's health is not operational. See Sites needing attention.",
      other:
        "Every device answers, but a site's health is not operational. See Sites needing attention.",
    },
  },
  [NetworkHealthVerdictKind.InterfacesDown]: {
    headline: {
      one: "{{count}} interface is down",
      other: "{{count}} interfaces are down",
    },
    detail: {
      one: "Every device answers, but a port is dark. The device is listed under Devices needing attention.",
      other:
        "Every device answers, but ports are dark. The devices are listed under Devices needing attention.",
    },
  },
  [NetworkHealthVerdictKind.SnmpFailing]: {
    headline: {
      one: "{{count}} device is not reporting its details",
      other: "{{count}} devices are not reporting their details",
    },
    detail: {
      one: "It answers ping, but its SNMP walk is failing, so its interfaces and health are not being refreshed. Check its SNMP credentials.",
      other:
        "They answer ping, but their SNMP walks are failing, so their interfaces and health are not being refreshed. Check their SNMP credentials.",
    },
  },
  [NetworkHealthVerdictKind.Waiting]: {
    headline: {
      one: "Waiting for the first check",
      other: "Waiting for the first check",
    },
    detail: {
      one: "{{count}} device was added. Its probe checks it within a few minutes.",
      other:
        "{{count}} devices were added. Their probe checks them within a few minutes.",
    },
  },
  [NetworkHealthVerdictKind.Healthy]: {
    headline: {
      one: "Your device is up",
      other: "All {{count}} devices are up",
    },
    detail: {
      one: "Every device answers, no interface is down and every site is healthy.",
      other:
        "Every device answers, no interface is down and every site is healthy.",
    },
  },
};

/*
 * A line said under any verdict but the waiting one, when some devices have
 * not been checked yet - so "All 40 devices are up" never hides the two that
 * were just added and are still Pending.
 */
export const NETWORK_HEALTH_PENDING_NOTE: NetworkHealthPlural = {
  one: "{{count}} more is waiting for its first check.",
  other: "{{count}} more are waiting for their first check.",
};

// Counts are never negative and never fractional, whatever the API sent.
function count(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

function verdictOf(
  kind: NetworkHealthVerdictKind,
  tone: NetworkHealthTone,
  headlineCount: number,
  detailCount: number,
): NetworkHealthVerdict {
  return {
    kind: kind,
    tone: tone,
    headline: NETWORK_HEALTH_COPY[kind].headline,
    headlineCount: headlineCount,
    detail: NETWORK_HEALTH_COPY[kind].detail,
    detailCount: detailCount,
  };
}

/**
 * The verdict for the overview's counts, worst news first. Null when there
 * is nothing to judge: no devices at all (the first-run page says what to
 * do instead).
 */
export function getNetworkHealthVerdict(
  input: NetworkHealthVerdictInput,
): NetworkHealthVerdict | null {
  const total: number = count(input.totalDevices);
  const down: number = count(input.devicesDown);
  const pending: number = count(input.devicesPending);
  const interfacesDown: number = count(input.interfacesDown);
  const unhealthySites: number = count(input.unhealthySites);
  const snmpFailing: number = count(input.snmpFailingDevices);

  if (total === 0) {
    return null;
  }

  if (down > 0) {
    return verdictOf(
      NetworkHealthVerdictKind.DevicesDown,
      NetworkHealthTone.Critical,
      down,
      down,
    );
  }

  if (unhealthySites > 0) {
    return verdictOf(
      NetworkHealthVerdictKind.SitesUnhealthy,
      NetworkHealthTone.Warning,
      unhealthySites,
      unhealthySites,
    );
  }

  if (interfacesDown > 0) {
    return verdictOf(
      NetworkHealthVerdictKind.InterfacesDown,
      NetworkHealthTone.Warning,
      interfacesDown,
      interfacesDown,
    );
  }

  if (snmpFailing > 0) {
    return verdictOf(
      NetworkHealthVerdictKind.SnmpFailing,
      NetworkHealthTone.Warning,
      snmpFailing,
      snmpFailing,
    );
  }

  // Nothing checked yet: every device is still Pending.
  if (pending >= total) {
    return verdictOf(
      NetworkHealthVerdictKind.Waiting,
      NetworkHealthTone.Waiting,
      total,
      total,
    );
  }

  /*
   * Every device that has been checked answers. "All N devices are up"
   * counts those that are; the pending note says how many are still to be
   * checked.
   */
  const up: number = Math.max(count(input.devicesUp), total - pending);

  return verdictOf(
    NetworkHealthVerdictKind.Healthy,
    NetworkHealthTone.Healthy,
    up,
    up,
  );
}

/**
 * How many devices the pending note under the verdict counts: the devices
 * still waiting for their first check, unless the verdict is about waiting
 * already (it says so itself) or there is no verdict.
 */
export function getPendingNoteCount(
  verdict: NetworkHealthVerdict | null,
  devicesPending: number,
): number {
  if (!verdict || verdict.kind === NetworkHealthVerdictKind.Waiting) {
    return 0;
  }

  return count(devicesPending);
}
