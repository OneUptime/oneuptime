import {
  NetworkTrafficUsageListKind,
  NetworkTrafficUsageListSort,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import {
  LINKABLE_APPLIANCE_DAYS,
  NetworkControllerLinkableAppliance,
} from "Common/Types/NetworkController/NetworkControllerApplianceLink";
import { NameLikenessReason } from "Common/Utils/NetworkDevice/DeviceNameLikeness";
import {
  PluralTemplate,
  TemplateValues,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Traffic pages say about issue #5762's three parts - every row of
 * a top list, and a device's link to the Meraki appliance it is - in the
 * dashboard's own words. React-free (App's tests read it): every string is
 * an English translation key or a template with its values, translated
 * where it is drawn.
 */

export interface MerakiLinkTemplate {
  template: string;
  values: TemplateValues;
}

// ---- Every row of a top list ------------------------------------------------

/*
 * Under a top list cut at its ten: how many there are, and the way to all of
 * them. Shown only when there are more than the list shows, so the "one"
 * form is the plural's own (a language that has one form for 21 reads it).
 */
export const VIEW_ALL_LABELS: Record<
  NetworkTrafficUsageListKind,
  PluralTemplate
> = {
  [NetworkTrafficUsageListKind.Networks]: {
    one: "View {{count}} network",
    other: "View all {{count}} networks",
  },
  [NetworkTrafficUsageListKind.Applications]: {
    one: "View {{count}} application",
    other: "View all {{count}} applications",
  },
  [NetworkTrafficUsageListKind.Clients]: {
    one: "View {{count}} client",
    other: "View all {{count}} clients",
  },
};

export interface MerakiListWords {
  title: string;
  description: string;
  searchPlaceholder: string;
  // No row in the window at all.
  empty: string;
  // No row matches the search.
  noMatch: string;
  singular: string;
  plural: string;
}

export const MERAKI_LIST_WORDS: Record<
  NetworkTrafficUsageListKind,
  MerakiListWords
> = {
  [NetworkTrafficUsageListKind.Networks]: {
    title: translationKey("All networks"),
    description: translationKey(
      "Every network that carried traffic in this time range. Click one to see only its traffic.",
    ),
    searchPlaceholder: translationKey("Search networks"),
    empty: translationKey("No networks in this time range."),
    noMatch: translationKey("No network matches “{{search}}”."),
    singular: translationKey("Network"),
    plural: translationKey("Networks"),
  },
  [NetworkTrafficUsageListKind.Applications]: {
    title: translationKey("All applications"),
    description: translationKey(
      "Every application Meraki named in this time range.",
    ),
    searchPlaceholder: translationKey("Search applications"),
    empty: translationKey("No applications in this time range."),
    noMatch: translationKey("No application matches “{{search}}”."),
    singular: translationKey("Application"),
    plural: translationKey("Applications"),
  },
  [NetworkTrafficUsageListKind.Clients]: {
    title: translationKey("All clients"),
    description: translationKey(
      "Every client that sent or received traffic in this time range.",
    ),
    // The dialog's title says what is searched: "All clients".
    searchPlaceholder: translationKey("Search by name, IP or MAC address"),
    empty: translationKey("No clients in this time range."),
    noMatch: translationKey("No client matches “{{search}}”."),
    singular: translationKey("Client"),
    plural: translationKey("Clients"),
  },
};

// Said beside the sort switch, so Total | In | Out reads as an order, never a filter.
export const LIST_SORT_LABEL: string = translationKey("Sort by");

/*
 * The sort switch, as every row says it: "In 8 GB · out 96 GB". Sorted by
 * In or Out, each row's own figure for it stands out (MerakiListRows), so
 * the order is plain to see.
 */
export const LIST_SORT_WORDS: Record<NetworkTrafficUsageListSort, string> = {
  [NetworkTrafficUsageListSort.Total]: translationKey("Total"),
  [NetworkTrafficUsageListSort.In]: translationKey("In"),
  [NetworkTrafficUsageListSort.Out]: translationKey("Out"),
};

// ---- A device's link to its Meraki appliance --------------------------------

export const LINK_APPLIANCE_ACTION: string = translationKey(
  "Link to a Meraki appliance",
);

export const UNLINKED_DEVICE_TITLE: string = translationKey(
  "This device is not linked to a Meraki appliance.",
);

/*
 * Said to every device of a project that reads Meraki and is tied to no
 * appliance - a router added by hand, and a device that is no Meraki box at
 * all - so it says when the link is for.
 */
export const UNLINKED_DEVICE_BODY: string = translationKey(
  "If this device is a Meraki MX or Z appliance, link it to see its uplinks, applications and clients here.",
);

// The Meraki side's card, before a device is linked: no "appliance" yet.
export const UNLINKED_DEVICE_DESCRIPTION: string = translationKey(
  "Where this device's traffic goes, as the Meraki dashboard reports it.",
);

export const LINKED_TO_APPLIANCE: string = translationKey(
  "Linked to the Meraki appliance {{appliance}}",
);

export const LINKED_WAITING_BODY: string = translationKey(
  "Its traffic shows here within a few minutes.",
);

export const UNLINK_ACTION: string = translationKey("Unlink device");

export const UNLINK_TITLE: string = translationKey("Unlink this device?");

/*
 * What Unlink does: the serial number comes off the device, and the
 * appliance's traffic leaves its page - never the network's, which shows
 * every appliance's traffic, linked or not.
 */
export const UNLINK_DESCRIPTION: string = translationKey(
  "The serial number of {{appliance}} is removed from this device, and its traffic stops showing here. It still shows on the network's Traffic page.",
);

// The link dialog.
export const LINK_DIALOG_DESCRIPTION: string = translationKey(
  "Pick this device's Meraki appliance. Its serial number is saved on the device, and its traffic shows here, past traffic included.",
);

export const LINK_SEARCH_PLACEHOLDER: string = translationKey(
  "Search by name, serial number or network",
);

export const LIKELY_APPLIANCES_HEADING: string =
  translationKey("Likely matches");

export const ALL_APPLIANCES_HEADING: string = translationKey("All appliances");

export const LINK_SUBMIT: string = translationKey("Link device");

export const NO_LINKABLE_APPLIANCES: MerakiLinkTemplate = {
  template: translationKey(
    "No Meraki appliance reported traffic in the last {{days}} days. Meraki reports the traffic of its MX and Z appliances.",
  ),
  values: { days: LINKABLE_APPLIANCE_DAYS },
};

export const NO_APPLIANCE_MATCHES: string = translationKey(
  "No appliance matches “{{search}}”.",
);

export const MORE_APPLIANCES: string = translationKey(
  "Showing {{shown}} of {{matching}}. Search to find the rest.",
);

// Why a row cannot be picked: one appliance is one device.
export const APPLIANCE_LINKED_TO_DEVICE: string = translationKey(
  "Already linked to {{device}}",
);

export const APPLIANCE_LINKED_TO_ANOTHER_DEVICE: string = translationKey(
  "Already linked to another device",
);

/*
 * Why an appliance is offered first: the rule of DeviceNameLikeness it met,
 * in words a person checks at a glance.
 */
export function getLikenessWords(
  appliance: NetworkControllerLinkableAppliance,
): MerakiLinkTemplate | null {
  switch (appliance.likenessReason) {
    case NameLikenessReason.SerialNumber:
      return {
        template: translationKey("Same serial number"),
        values: {},
      };
    case NameLikenessReason.Name:
      return { template: translationKey("Same name"), values: {} };
    case NameLikenessReason.NameWithin:
      return { template: translationKey("Similar name"), values: {} };
    case NameLikenessReason.Number:
    case NameLikenessReason.Word:
      return appliance.likenessShared
        ? {
            template: translationKey("Both names have {{shared}}"),
            values: { shared: appliance.likenessShared },
          }
        : null;
    default:
      return null;
  }
}

/*
 * Whether an appliance can be picked: one another device is already says
 * so instead - one appliance is one device.
 */
export function isApplianceLinkable(
  appliance: NetworkControllerLinkableAppliance,
  networkDeviceId: string,
): boolean {
  return (
    !appliance.linkedDeviceId ||
    appliance.linkedDeviceId.toLowerCase() === networkDeviceId.toLowerCase()
  );
}
