import MonitorType from "Common/Types/Monitor/MonitorType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  isDeviceAddressMonitorType,
  isDeviceUrlMonitorType,
} from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import { DiscoveryImportTemplateChoice } from "./DiscoveryImportOutcome";

/*
 * What the import's Monitoring step calls its monitor templates (OneUptime
 * issue #5145), in a React-free module: the step draws these, and the
 * network device guide is held to them in every docs language
 * (Tests/FeatureSet/Docs/DiscoveryImportTemplatesDocs), so the two cannot
 * drift apart.
 */

/*
 * The one line under "Monitor template" that says which templates are
 * listed, so nobody wonders where theirs went - the kinds a device's monitor
 * can be made from (DEVICE_MONITOR_TEMPLATE_TYPES), named the way the
 * monitor type picker names them - and how a web template's URL is made
 * into each device's (issue #9546): its host becomes the device's address,
 * and the rest of it stays as written.
 */
export const LISTED_TEMPLATE_KINDS_RULE: string = translationKey(
  "Network Device, Ping, IP, Port, NTP, Website, API and SSL Certificate templates are listed. A web one's URL takes each device's address as its host.",
);

// The link beside it, to Monitors > Settings > Templates, in a new tab.
export const MANAGE_TEMPLATES_LINK_TITLE: string =
  translationKey("Manage templates");

/*
 * The list's two groups, when a project has templates of both kinds: the
 * ones whose monitors read each device's polls, then the ones whose
 * monitors check each device's address.
 */
export const POLL_TEMPLATES_GROUP_TITLE: string = translationKey(
  "Network Device templates",
);

export const ADDRESS_TEMPLATES_GROUP_TITLE: string = translationKey(
  "Ping, IP, Port and NTP templates",
);

/*
 * The third group (issue #9546): Website, API and SSL Certificate
 * templates, whose monitors check a URL on each device - its web UI, a
 * status page, the certificate it serves.
 */
export const WEB_TEMPLATES_GROUP_TITLE: string =
  translationKey("Web templates");

// A template saved with no name (the API allows one).
export const UNNAMED_TEMPLATE_NAME: string = translationKey("Unnamed template");

/*
 * Why no template can be picked, when the project has none a device's
 * monitor can be made from and the reader may not create the recommended
 * one: who can, and where.
 */
export const NO_DEVICE_MONITOR_TEMPLATE_REASON: string = translationKey(
  "This project has no Network Device, Ping, IP, Port, NTP, Website, API or SSL Certificate monitor template, and you may not create one. Ask a Project Owner or Project Admin to create the recommended one under Network > Settings > Alert Policies, or another under Monitors > Settings > Templates.",
);

/*
 * What a Website, API or SSL Certificate template's monitor checks on each
 * device (issue #9546), in the words its option in a list carries under its
 * name: the template's URL as written, and that each device's address takes
 * its host's place. A certificate must name the address it is reached at to
 * count as valid, and a device's rarely names its IP address, so the SSL
 * Certificate line says so where the template is picked.
 */
export function describeWebTemplate(
  translator: Translator,
  choice: Pick<DiscoveryImportTemplateChoice, "monitorType" | "templateUrl">,
): string {
  const url: string = choice.templateUrl || "";

  if (choice.monitorType === MonitorType.SSLCertificate) {
    return url
      ? translator.translateTemplate(
          "Checks the certificate at {{url}}, with each device's address as the host. It must name that address.",
          { url: url },
        )
      : (translator.translateText(
          "Checks the certificate each device serves. It must name the device's address.",
        ) as string);
  }

  if (choice.monitorType === MonitorType.API) {
    return url
      ? translator.translateTemplate(
          "Calls {{url}}, with each device's address as the host",
          { url: url },
        )
      : (translator.translateText("Calls an API on each device") as string);
  }

  return url
    ? translator.translateTemplate(
        "Checks {{url}}, with each device's address as the host",
        { url: url },
      )
    : (translator.translateText("Checks a page on each device") as string);
}

/*
 * What a template's monitor checks on each device, for the line under its
 * option - a Ping, IP, Port or NTP template's, or a web one's - or nothing
 * for a Network Device template, whose name says it.
 */
export function describeDeviceTemplate(
  translator: Translator,
  choice: Pick<
    DiscoveryImportTemplateChoice,
    "monitorType" | "ports" | "templateUrl"
  >,
): string | undefined {
  if (isDeviceUrlMonitorType(choice.monitorType)) {
    return describeWebTemplate(translator, choice);
  }

  if (isDeviceAddressMonitorType(choice.monitorType)) {
    return describeAddressTemplate(translator, choice);
  }

  return undefined;
}

/*
 * What a Ping, IP, Port or NTP template's monitor does, in the words its
 * option in a list carries under its name: the import's Monitoring step's,
 * and an auto import rule's Monitor Template (issue #9510).
 */
export function describeAddressTemplate(
  translator: Translator,
  choice: Pick<DiscoveryImportTemplateChoice, "monitorType" | "ports">,
): string {
  if (choice.monitorType === MonitorType.IP) {
    return translator.translateText("Pings each device's IP address") as string;
  }

  if (choice.monitorType === MonitorType.Port) {
    const ports: Array<number> = choice.ports || [];

    if (ports.length === 1) {
      return translator.translateTemplate(
        "Checks port {{port}} on each device",
        { port: String(ports[0]) },
      );
    }

    if (ports.length > 1) {
      return translator.translateTemplate(
        "Checks ports {{ports}} on each device",
        { ports: ports.join(", ") },
      );
    }

    return translator.translateText("Checks a port on each device") as string;
  }

  if (choice.monitorType === MonitorType.NTP) {
    return translator.translateText("Asks each device for the time") as string;
  }

  return translator.translateText("Pings each device") as string;
}
