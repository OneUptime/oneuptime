import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import IconProp from "Common/Types/Icon/IconProp";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import ScanModeUtil, {
  DiscoveryScanMode,
  ScanMethodLabel,
} from "Common/Utils/NetworkDiscovery/ScanModeUtil";

/*
 * How a discovery scan looks for devices: the Start Scan form's two plain
 * choices, ICMP or SNMP.
 *
 * "Shouldnt this be two buttons - ICMP or SNMP ... ICMP selected by default.
 * If ICMP takes fewer options because it doesn't take SNMP credentials, we
 * should probably prefer that as the default. People can basically switch to
 * SNMP when they need it." (the maintainer)
 *
 * It used to be a switch, "Check SNMP on hosts that answer", on by default,
 * with five lines of help under it explaining what turning it off meant. Two
 * cards say the same thing in a line each, and the one most people need -
 * ICMP, which asks for nothing else - is picked for them:
 *
 *   - ICMP (ping): pings every address in the range and lists what answers.
 *     A new scan is three answers on one page: the range, the probe, ICMP.
 *   - SNMP: pings too, then asks each host that answers for its name and
 *     vendor over SNMP, with the credentials on a second step.
 *
 * Stored as the scan's `isSnmpEnabled` column (true for SNMP, false for
 * ICMP), read everywhere through ScanModeUtil. The COLUMN keeps its default
 * of true: it speaks for every scan created before this choice existed, for
 * API and Terraform callers who never send the column, and for a probe that
 * polls a server too old to select it - all of which mean the SNMP sweep the
 * product always did. ICMP is the default of the FORM, for a scan someone is
 * starting right now with the two choices in front of them: the same split
 * as the NetBIOS lookup on this form, whose form default and column default
 * differ for the same reason.
 *
 * React-free on purpose, like DiscoveryScanFormValidation.ts: App/Tests read
 * these words and rules, and App installs no React.
 */
export enum DiscoveryScanMethod {
  Icmp = "icmp",
  Snmp = "snmp",
}

// The choice a scan started from the form starts on.
export const NEW_DISCOVERY_SCAN_METHOD: DiscoveryScanMethod =
  DiscoveryScanMethod.Icmp;

/*
 * The create dialog's title, as one sentence a language words whole. Left to
 * the scans table, it is built from the verb and the noun ("{{action}} New
 * {{itemName}}"), which several languages can only fill in as "Starten: Scan".
 */
export const DISCOVERY_SCAN_CREATE_FORM_TITLE: string =
  translationKey("Start New Scan");

// The field's label, above the two cards.
export const DISCOVERY_SCAN_METHOD_FIELD_TITLE: string =
  translationKey("Scan method");

/*
 * The line under the label: what the cards do not say, that the choice is not
 * final. The words a monitor secret's access picker uses for the same thing.
 */
export const DISCOVERY_SCAN_METHOD_FIELD_DESCRIPTION: string = translationKey(
  "You can change this at any time.",
);

export const DISCOVERY_SCAN_ICMP_OPTION_TITLE: string =
  translationKey("ICMP (ping)");

export const DISCOVERY_SCAN_ICMP_OPTION_DESCRIPTION: string = translationKey(
  "Finds the devices that answer ping. No credentials needed.",
);

export const DISCOVERY_SCAN_SNMP_OPTION_TITLE: string = translationKey("SNMP");

/*
 * Name and vendor, NOT model or interfaces: the sweep reads the SNMP system
 * group (sysName / sysDescr / sysObjectId); a device's model and its
 * interfaces arrive later, from the device's own polls.
 */
export const DISCOVERY_SCAN_SNMP_OPTION_DESCRIPTION: string = translationKey(
  "Also reads each device's name and vendor. Needs SNMP credentials.",
);

/*
 * The two cards, ICMP first: the default, and the simpler of the two. The
 * words are English keys - CardSelect looks each one up in the reader's
 * language as it draws the card.
 */
export const DISCOVERY_SCAN_METHOD_OPTIONS: Array<CardSelectOption> = [
  {
    value: DiscoveryScanMethod.Icmp,
    title: DISCOVERY_SCAN_ICMP_OPTION_TITLE,
    description: DISCOVERY_SCAN_ICMP_OPTION_DESCRIPTION,
    icon: IconProp.Signal,
  },
  {
    value: DiscoveryScanMethod.Snmp,
    title: DISCOVERY_SCAN_SNMP_OPTION_TITLE,
    description: DISCOVERY_SCAN_SNMP_OPTION_DESCRIPTION,
    icon: IconProp.Key,
  },
];

/*
 * The word on a scan's badge in the scan list: the option's word, without
 * the "(ping)" the card adds for anyone who has not met ICMP before. Spelled
 * out as literals so the string extractor finds them; a test holds them to
 * Common's ScanMethodLabel (DISCOVERY_SCAN_METHOD_LABELS below), the same
 * words for every package.
 */
export const DISCOVERY_SCAN_METHOD_BADGE_TEXT: Record<
  DiscoveryScanMethod,
  string
> = {
  [DiscoveryScanMethod.Icmp]: translationKey("ICMP"),
  [DiscoveryScanMethod.Snmp]: translationKey("SNMP"),
};

/*
 * The badge's tooltip: what the word on it is. A bare "ICMP" or "SNMP" beside
 * a scan's name is plain to whoever picked it; the tooltip names it the way
 * the form does, the card's title included, for everyone else. Not the card's
 * line: on a scan that has its credentials, "Needs SNMP credentials" would
 * read as something missing.
 */
export const DISCOVERY_SCAN_METHOD_BADGE_TOOLTIP: Record<
  DiscoveryScanMethod,
  string
> = {
  [DiscoveryScanMethod.Icmp]: translationKey("Scan method: ICMP (ping)"),
  [DiscoveryScanMethod.Snmp]: translationKey("Scan method: SNMP"),
};

type GetDiscoveryScanMethodFunction = (
  scan: DiscoveryScanMode | null | undefined,
) => DiscoveryScanMethod;

/*
 * The method a scan (or the form's values) stands for. Through ScanModeUtil,
 * so an ABSENT value reads as SNMP - what every scan created before the
 * column was, and what the form's step list and the probe both read it as.
 * A new scan never reaches the form without a value: it starts on
 * NEW_DISCOVERY_SCAN_FORM_VALUES.
 */
export const getDiscoveryScanMethod: GetDiscoveryScanMethodFunction = (
  scan: DiscoveryScanMode | null | undefined,
): DiscoveryScanMethod => {
  return ScanModeUtil.isSnmpEnabled(scan)
    ? DiscoveryScanMethod.Snmp
    : DiscoveryScanMethod.Icmp;
};

type IsSnmpEnabledForMethodFunction = (method: DiscoveryScanMethod) => boolean;

// What a pick stores in the scan's isSnmpEnabled column.
export const isSnmpEnabledForMethod: IsSnmpEnabledForMethodFunction = (
  method: DiscoveryScanMethod,
): boolean => {
  return method === DiscoveryScanMethod.Snmp;
};

type ReadDiscoveryScanMethodFunction = (
  value: unknown,
) => DiscoveryScanMethod | null;

/*
 * A card's value back as a method, or null for anything that is not one of
 * the two - so a stray value can never be stored as a method.
 */
export const readDiscoveryScanMethod: ReadDiscoveryScanMethodFunction = (
  value: unknown,
): DiscoveryScanMethod | null => {
  if (
    value === DiscoveryScanMethod.Icmp ||
    value === DiscoveryScanMethod.Snmp
  ) {
    return value;
  }

  return null;
};

/*
 * What Start New Scan opens with: ICMP picked. Handed to the scans table as
 * its create form's initial values, so the form holds ICMP from its very
 * first render (a field default is filled in by an effect, and until it ran
 * the SNMP card and the SNMP Credentials step would show for a frame) - and
 * so it reaches the create form only: a field default would fill the Edit
 * dialog as well, wherever a scan arrived without the column, and saving
 * would turn that scan into a ping sweep.
 */
export const NEW_DISCOVERY_SCAN_FORM_VALUES: FormValues<NetworkDeviceDiscoveryScan> =
  {
    isSnmpEnabled: isSnmpEnabledForMethod(NEW_DISCOVERY_SCAN_METHOD),
  };

type GetDiscoveryScanMethodOptionFunction = (
  method: DiscoveryScanMethod,
) => CardSelectOption;

// The card of a method: its title, its line and its icon.
export const getDiscoveryScanMethodOption: GetDiscoveryScanMethodOptionFunction =
  (method: DiscoveryScanMethod): CardSelectOption => {
    return DISCOVERY_SCAN_METHOD_OPTIONS.find(
      (option: CardSelectOption): boolean => {
        return option.value === method;
      },
    )!;
  };

export interface DiscoveryScanMethodBadge {
  // "ICMP" or "SNMP": an English key, looked up as it is drawn.
  text: string;
  // "Scan method: ICMP (ping)": an English key too, for the badge's tooltip.
  tooltip: string;
}

type GetDiscoveryScanMethodBadgeFunction = (
  scan: DiscoveryScanMode | null | undefined,
) => DiscoveryScanMethodBadge;

/*
 * A scan's badge in the scan list: the method's word, and the method named
 * the way the form names it as its tooltip.
 */
export const getDiscoveryScanMethodBadge: GetDiscoveryScanMethodBadgeFunction =
  (scan: DiscoveryScanMode | null | undefined): DiscoveryScanMethodBadge => {
    const method: DiscoveryScanMethod = getDiscoveryScanMethod(scan);

    return {
      text: DISCOVERY_SCAN_METHOD_BADGE_TEXT[method],
      tooltip: DISCOVERY_SCAN_METHOD_BADGE_TOOLTIP[method],
    };
  };

// Common's words for the two methods, which the badge words must equal.
export const DISCOVERY_SCAN_METHOD_LABELS: Record<
  DiscoveryScanMethod,
  ScanMethodLabel
> = {
  [DiscoveryScanMethod.Icmp]: ScanMethodLabel.Icmp,
  [DiscoveryScanMethod.Snmp]: ScanMethodLabel.Snmp,
};
