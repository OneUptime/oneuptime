/*
 * Fibre Channel ports: what a SAN switch (Brocade Fabric OS, Cisco MDS 9000)
 * reports about each of its ports beyond IF-MIB.
 *
 * A Fibre Channel port rarely goes down outright. It degrades first - CRC
 * errors, link resets, loss of sync, an optic losing light, frames dropped
 * for lack of credit - and those counters live in the vendors' own MIBs,
 * not in IF-MIB, whose ifInErrors a Brocade leaves empty on its Fibre
 * Channel ports. So the probe reads them in the same poll as the
 * interfaces, joins them to the IF-MIB port they belong to, and the server
 * rates them like any other interface counter (SnmpInterfaceRateUtil).
 *
 * Three shapes, one per stage:
 *
 *   counters        - what the probe read: cumulative since the switch last
 *                     cleared them (a reboot, or statsclear / clear counters).
 *   ratesPerSecond  - their growth per second since the device's previous
 *                     poll, filled in by the server on ingest. Absent on a
 *                     first poll and for a counter that went backwards.
 *   errorsPerSecond - on the interface itself: the error counters' rates
 *                     summed into the same number ifInErrors and ifOutErrors
 *                     feed on every other port, so "SNMP Interface Errors
 *                     (per second)" works on a Fibre Channel port too.
 */

import { translationKey } from "../../Translator";

// IANAifType fibreChannel(56): how IF-MIB marks a Fibre Channel port.
export const FIBRE_CHANNEL_IF_TYPE: number = 56;

/*
 * The counters OneUptime reads from each port, by meaning, whichever MIB
 * they came from. Stored as strings in criteria and metrics: never rename
 * a value.
 */
export enum FibreChannelCounter {
  // Frames received with a bad CRC: a dirty connector, a bad cable or optic.
  CrcErrors = "crcErrors",
  // Invalid transmission words (encoding errors): signal integrity.
  InvalidTransmissionWords = "invalidTransmissionWords",
  // The link failed and was brought back up.
  LinkFailures = "linkFailures",
  // The receiver lost synchronization with the signal.
  LossOfSync = "lossOfSync",
  // The receiver lost the light altogether.
  LossOfSignal = "lossOfSignal",
  // Frames the port dropped (class 3 discards on Brocade).
  Discards = "discards",
  // Frames dropped because they waited too long for credit (Cisco).
  TimeoutDiscards = "timeoutDiscards",
  // Link resets because the attached port stopped returning credit (Cisco).
  CreditLoss = "creditLoss",
  // Times the port's transmit credit ran out: congestion, a slow drain.
  BbCreditZero = "bbCreditZero",
}

// The order counters are shown and charted in: errors first.
export const FIBRE_CHANNEL_COUNTERS: Array<FibreChannelCounter> = [
  FibreChannelCounter.CrcErrors,
  FibreChannelCounter.InvalidTransmissionWords,
  FibreChannelCounter.LinkFailures,
  FibreChannelCounter.LossOfSync,
  FibreChannelCounter.LossOfSignal,
  FibreChannelCounter.Discards,
  FibreChannelCounter.TimeoutDiscards,
  FibreChannelCounter.CreditLoss,
  FibreChannelCounter.BbCreditZero,
];

/*
 * The counters that are errors, and so count in the interface's
 * errorsPerSecond. Discards and credit counters are not: BB credit zero
 * counts every time a busy, healthy link waits for credit (millions of
 * times), and IF-MIB counts discards apart from errors too. They are charted
 * per port and alerted on with "SNMP Fibre Channel Counter (per second)".
 */
export const FIBRE_CHANNEL_ERROR_COUNTERS: Array<FibreChannelCounter> = [
  FibreChannelCounter.CrcErrors,
  FibreChannelCounter.InvalidTransmissionWords,
  FibreChannelCounter.LinkFailures,
  FibreChannelCounter.LossOfSync,
  FibreChannelCounter.LossOfSignal,
];

export const FIBRE_CHANNEL_COUNTER_TITLES: Record<FibreChannelCounter, string> =
  {
    [FibreChannelCounter.CrcErrors]: translationKey("CRC Errors"),
    [FibreChannelCounter.InvalidTransmissionWords]: translationKey(
      "Invalid Transmission Words",
    ),
    [FibreChannelCounter.LinkFailures]: translationKey("Link Failures"),
    [FibreChannelCounter.LossOfSync]: translationKey("Loss of Sync"),
    [FibreChannelCounter.LossOfSignal]: translationKey("Loss of Signal"),
    [FibreChannelCounter.Discards]: translationKey("Discards"),
    [FibreChannelCounter.TimeoutDiscards]: translationKey("Timeout Discards"),
    [FibreChannelCounter.CreditLoss]: translationKey("Credit Loss"),
    [FibreChannelCounter.BbCreditZero]: translationKey("BB Credit Zero"),
  };

export const FIBRE_CHANNEL_COUNTER_DESCRIPTIONS: Record<
  FibreChannelCounter,
  string
> = {
  [FibreChannelCounter.CrcErrors]: translationKey(
    "Frames received with a bad CRC: usually a dirty connector, a damaged cable or a failing optic.",
  ),
  [FibreChannelCounter.InvalidTransmissionWords]: translationKey(
    "Encoding errors on the link: poor signal quality, often from the optic or the cable.",
  ),
  [FibreChannelCounter.LinkFailures]: translationKey(
    "Times the link failed and was brought back up.",
  ),
  [FibreChannelCounter.LossOfSync]: translationKey(
    "Times the receiver lost synchronization with the signal.",
  ),
  [FibreChannelCounter.LossOfSignal]: translationKey(
    "Times the receiver lost the light altogether.",
  ),
  [FibreChannelCounter.Discards]: translationKey(
    "Frames the port dropped, for example class 3 frames that could not be delivered.",
  ),
  [FibreChannelCounter.TimeoutDiscards]: translationKey(
    "Frames dropped because they waited too long for credit: a sign of a slow-draining device.",
  ),
  [FibreChannelCounter.CreditLoss]: translationKey(
    "Link resets because the attached port stopped returning buffer credit: a slow-draining device.",
  ),
  [FibreChannelCounter.BbCreditZero]: translationKey(
    "Times the port's transmit credit ran out. Normal in small numbers; a steep rise means congestion.",
  ),
};

/*
 * What a port is to the fabric, as the switch reports it: F (a host or an
 * array logs in), E (another switch: an inter-switch link) and the rest.
 * Stored as the short code.
 */
export enum FibreChannelPortType {
  E = "E",
  TE = "TE",
  EX = "EX",
  F = "F",
  TF = "TF",
  FL = "FL",
  N = "N",
  NP = "NP",
  TNP = "TNP",
  NL = "NL",
  G = "G",
  D = "D",
  SD = "SD",
  Auto = "Auto",
  Other = "Other",
}

export const FIBRE_CHANNEL_PORT_TYPE_TITLES: Record<
  FibreChannelPortType,
  string
> = {
  [FibreChannelPortType.E]: translationKey("E-Port"),
  [FibreChannelPortType.TE]: translationKey("TE-Port"),
  [FibreChannelPortType.EX]: translationKey("EX-Port"),
  [FibreChannelPortType.F]: translationKey("F-Port"),
  [FibreChannelPortType.TF]: translationKey("TF-Port"),
  [FibreChannelPortType.FL]: translationKey("FL-Port"),
  [FibreChannelPortType.N]: translationKey("N-Port"),
  [FibreChannelPortType.NP]: translationKey("NP-Port"),
  [FibreChannelPortType.TNP]: translationKey("TNP-Port"),
  [FibreChannelPortType.NL]: translationKey("NL-Port"),
  [FibreChannelPortType.G]: translationKey("G-Port"),
  [FibreChannelPortType.D]: translationKey("D-Port"),
  [FibreChannelPortType.SD]: translationKey("SD-Port"),
  [FibreChannelPortType.Auto]: translationKey("Auto"),
  [FibreChannelPortType.Other]: translationKey("Other"),
};

/*
 * Port types that link this switch to another switch: an E-port going
 * down is an inter-switch link down, which splits or narrows the fabric.
 */
export const INTER_SWITCH_LINK_PORT_TYPES: Array<FibreChannelPortType> = [
  FibreChannelPortType.E,
  FibreChannelPortType.TE,
  FibreChannelPortType.EX,
];

export type FibreChannelCounterValues = Partial<
  Record<FibreChannelCounter, number>
>;

// One port's Fibre Channel side, as the probe read it.
export interface SnmpFibreChannelPort {
  portType?: FibreChannelPortType | undefined;
  /*
   * Why the port is down, in the switch's words: "Link failure or
   * not-connected" (Cisco), "No light" (Brocade's physical state). Only
   * set while the port is down.
   */
  downReason?: string | undefined;
  counters?: FibreChannelCounterValues | undefined;
  // Computed server-side from the previous poll. See the note above.
  ratesPerSecond?: FibreChannelCounterValues | undefined;
}

export default class SnmpFibreChannelUtil {
  public static isFibreChannelInterfaceType(
    interfaceType: number | null | undefined,
  ): boolean {
    return interfaceType === FIBRE_CHANNEL_IF_TYPE;
  }

  public static isErrorCounter(counter: FibreChannelCounter): boolean {
    return FIBRE_CHANNEL_ERROR_COUNTERS.includes(counter);
  }

  public static parseCounter(
    value: string | null | undefined,
  ): FibreChannelCounter | undefined {
    const text: string = (value || "").trim();

    return FIBRE_CHANNEL_COUNTERS.find((counter: FibreChannelCounter) => {
      return counter === text;
    });
  }

  public static parsePortType(
    value: string | null | undefined,
  ): FibreChannelPortType | undefined {
    const text: string = (value || "").trim();

    return Object.values(FibreChannelPortType).find(
      (portType: FibreChannelPortType) => {
        return portType === text;
      },
    );
  }

  public static getCounterTitle(counter: FibreChannelCounter): string {
    return FIBRE_CHANNEL_COUNTER_TITLES[counter];
  }

  // "E-Port"; undefined for a port that reports no type.
  public static getPortTypeTitle(
    portType: string | null | undefined,
  ): string | undefined {
    const parsed: FibreChannelPortType | undefined =
      SnmpFibreChannelUtil.parsePortType(portType);

    return parsed ? FIBRE_CHANNEL_PORT_TYPE_TITLES[parsed] : undefined;
  }

  public static isInterSwitchLink(
    portType: string | null | undefined,
  ): boolean {
    const parsed: FibreChannelPortType | undefined =
      SnmpFibreChannelUtil.parsePortType(portType);

    return Boolean(parsed && INTER_SWITCH_LINK_PORT_TYPES.includes(parsed));
  }

  /*
   * The error counters' rates summed: what a Fibre Channel port adds to its
   * interface's errorsPerSecond. Undefined when none of them has a rate.
   */
  public static sumErrorRates(
    ratesPerSecond: FibreChannelCounterValues | undefined,
  ): number | undefined {
    let total: number | undefined = undefined;

    for (const counter of FIBRE_CHANNEL_ERROR_COUNTERS) {
      const rate: number | undefined = ratesPerSecond?.[counter];

      if (typeof rate === "number" && Number.isFinite(rate)) {
        total = (total ?? 0) + rate;
      }
    }

    return total;
  }
}
