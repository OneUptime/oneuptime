import { JSONObject, JSONValue } from "../JSON";
import { OpenStackServiceType } from "./OpenStackResourceKind";

/*
 * THE SERVICES A CLOUD MAY NOT RUN.
 *
 * Every cloud runs Keystone, Nova, Placement, Neutron, Cinder and Glance. The rest are up to whoever
 * runs it, so a cloud has to be able to go without any of them and show no trace of it, and one that
 * does run a service has to get all of it. What holds for each one here:
 *
 *   A row only from what the exporter says about the service. The agent asks for each on every
 *   cloud, and for one the catalog does not name it answers 200 with nothing: `up` reads 1 and
 *   scrape_samples_scraped 0, recorded on a real cloud. So those two can never make a row
 *   (OPENSTACK_SERVICES_EVERY_CLOUD_RUNS). `_up` can, and whatever the service lists can.
 *
 *   A row goes when the service does. A row has nothing to age it out but its own API, which has gone
 *   silent along with it, so an empty answer is written down when it starts, on the row, and the
 *   service's rows are removed once the rest of the cloud has gone on answering for long enough
 *   (OpenStackResourceService.forgetOptionalServicesThatLeft). A failed scrape, or a Keystone
 *   nobody can log in to, leaves everything where it is: a service failing is not a service gone.
 *
 *   A page and an alert only where it runs. A cloud's menu gets a service's section from what its
 *   rows say, and Recommendations offers a template that names a service only to a cloud running it
 *   (OpenStackAlertTemplate.forService).
 *
 *   An honest word about what can't be seen. The exporter says less about these than about the
 *   core services, and a credential can be refused them whole, so each page says what this cloud's
 *   collector can't see rather than reading as though there were nothing there.
 *
 * To add a service: an entry here, its kinds in OPENSTACK_KINDS_BY_SERVICE, then follow the compiler
 * through what OpenStackServiceType keys (titles, catalog types, windows, templates).
 *
 * One thing to check on its recordings first. A stopped Heat or Magnum reads `_up 0`. A stopped Ironic
 * or Designate does not: the exporter reads their versions before anything else, so it answers an
 * empty 200, which is what it says of a service the cloud has never run. Such a service says
 * isEmptyWhenStopped: an empty answer takes nothing, it reads as quiet (isOpenStackServiceQuiet), and
 * its rows go after much longer (OpenStackResourceService.forgetQuietServices).
 *
 * Pure, so the scan, the server, the pages and the probe all draw the same line.
 */
export interface OpenStackOptionalService {
  service: OpenStackServiceType;
  // What says whether its API answered, and the only thing that can start its rows.
  upMetricName: string;
  /*
   * A stopped API reads as an empty answer rather than as `_up 0`, recorded. So an empty answer can't
   * say this service left: it goes quiet instead, and its rows go much later
   * (OPENSTACK_QUIET_SERVICE_FORGOTTEN_DAYS).
   */
  isEmptyWhenStopped?: boolean | undefined;
  /*
   * A probe reads it too, which takes a collector of its own (Probe/Utils/OpenStack/Collectors). Until
   * then a probe's cloud says nothing of this service.
   */
  isReadByProbe?: boolean | undefined;
}

export const OPENSTACK_OPTIONAL_SERVICES: ReadonlyArray<OpenStackOptionalService> =
  [
    {
      service: OpenStackServiceType.BareMetal,
      upMetricName: "openstack_ironic_up",
      isEmptyWhenStopped: true,
    },
    {
      service: OpenStackServiceType.Orchestration,
      upMetricName: "openstack_heat_up",
      isReadByProbe: true,
    },
    {
      service: OpenStackServiceType.ContainerInfra,
      upMetricName: "openstack_container_infra_up",
      isReadByProbe: true,
    },
    {
      service: OpenStackServiceType.SharedFileSystems,
      upMetricName: "openstack_sharev2_up",
      isReadByProbe: true,
    },
  ];

export function getOpenStackOptionalService(
  service: string | null | undefined,
): OpenStackOptionalService | null {
  return (
    OPENSTACK_OPTIONAL_SERVICES.find(
      (entry: OpenStackOptionalService): boolean => {
        return entry.service === service;
      },
    ) || null
  );
}

export function isOpenStackOptionalService(
  service: string | null | undefined,
): boolean {
  return getOpenStackOptionalService(service) !== null;
}

/*
 * When an API's row started reading as nothing. On the row's facts, so the wait survives a restart
 * and is shared by every ingest and worker process.
 */
export const OPENSTACK_EMPTY_ANSWER_SINCE_FACT: string = "emptyAnswerSince";

/*
 * How long a service's scrape has to go on answering with nothing, while the cloud's other services
 * are answering, before its rows go: three of its collections, however short the stale window
 * someone set. Longer than a rolling restart of Keystone, which empties a scrape too.
 */
export const OPENSTACK_OPTIONAL_SERVICE_LEFT_MINUTES: number = 15;

export function getOpenStackEmptyAnswerSince(
  facts: JSONObject | null | undefined,
): Date | null {
  const value: JSONValue | undefined =
    facts?.[OPENSTACK_EMPTY_ANSWER_SINCE_FACT];
  if (typeof value !== "string") {
    return null;
  }
  const since: Date = new Date(value);
  return isNaN(since.getTime()) ? null : since;
}

/*
 * Whether a service has left the cloud: it has answered with nothing since `emptySince`, and something
 * this cloud always runs has answered since then by the wait. Without that second clause a Keystone
 * outage would empty every service's scrape at once, and remove the very rows people need then.
 */
export function hasOpenStackOptionalServiceLeft(data: {
  emptySince: Date | null;
  // The latest time any core service of this region answered: null when none ever has.
  coreAnsweredAt: Date | null;
  windowInMinutes: number;
}): boolean {
  if (!data.emptySince || !data.coreAnsweredAt) {
    return false;
  }
  const wait: number =
    Math.max(data.windowInMinutes, OPENSTACK_OPTIONAL_SERVICE_LEFT_MINUTES) *
    60 *
    1000;
  return data.coreAnsweredAt.getTime() - data.emptySince.getTime() >= wait;
}

/*
 * What a cloud runs, from its API rows' names: what a page and Recommendations ask. Never from a
 * setting: a row is what says a service is there, and it goes when the service does.
 */
export function getOpenStackOptionalServicesOf(
  apiNames: ReadonlyArray<string | null | undefined>,
): Array<OpenStackServiceType> {
  return OPENSTACK_OPTIONAL_SERVICES.filter(
    (entry: OpenStackOptionalService): boolean => {
      return apiNames.includes(entry.service);
    },
  ).map((entry: OpenStackOptionalService): OpenStackServiceType => {
    return entry.service;
  });
}
