import DatabaseService from "./DatabaseService";
import QueryHelper from "../Types/Database/QueryHelper";
import OpenSourceDeployment from "../../Models/DatabaseModels/OpenSourceDeployment";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import PartialEntity from "../../Types/Database/PartialEntity";
import OneUptimeDate from "../../Types/Date";
import Domain from "../../Types/Domain";
import { URL as NodeURL } from "url";

// Addresses only the machine an install runs on can reach.
const LOOPBACK_HOSTNAMES: Array<string> = ["127.0.0.1", "[::1]", "0.0.0.0"];

/*
 * An install sends its URL as "https://host/". The same URL without the
 * trailing slash names the same instance, so a record kept in either
 * spelling is found.
 */
function spellingsOf(instanceUrl: string): Array<string> {
  return instanceUrl.endsWith("/")
    ? [instanceUrl, instanceUrl.slice(0, -1)]
    : [instanceUrl, `${instanceUrl}/`];
}

export class Service extends DatabaseService<OpenSourceDeployment> {
  public constructor() {
    super(OpenSourceDeployment);
  }

  /*
   * Whether an instance URL can be an install that someone runs: http or
   * https, and not on localhost, a loopback address or a name reserved for
   * testing - an install left at its defaults, a developer's machine, a CI
   * run. Reads any value and never throws.
   */
  public isInstallUrl(instanceUrl: string | undefined): boolean {
    if (typeof instanceUrl !== "string" || !instanceUrl) {
      return false;
    }

    let url: NodeURL;

    try {
      url = new NodeURL(instanceUrl);
    } catch {
      return false;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    return (
      !LOOPBACK_HOSTNAMES.includes(url.hostname) &&
      !Domain.isReservedName(url.hostname)
    );
  }

  /*
   * One record per instance. A sign-up or a daily check-in from an instance
   * URL already on record updates that record - the newest, where sign-ups
   * from before this rule left several - and only a new URL adds one.
   * Contact details are replaced, never cleared: a check-in carries none,
   * and a sign-up that leaves the company or phone empty keeps the ones on
   * record.
   */
  public async recordInstance(deployment: OpenSourceDeployment): Promise<void> {
    deployment.lastSeenAt = OneUptimeDate.getCurrentDate();

    const existing: OpenSourceDeployment | null = await this.findOneBy({
      query: {
        instanceUrl: QueryHelper.any(spellingsOf(deployment.instanceUrl!)),
      },
      select: {
        _id: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    if (!existing) {
      await this.create({
        data: deployment,
        props: {
          isRoot: true,
        },
      });
      return;
    }

    const data: PartialEntity<OpenSourceDeployment> = {
      oneuptimeVersion: deployment.oneuptimeVersion!,
      lastSeenAt: deployment.lastSeenAt,
    };

    if (deployment.email) {
      data.email = deployment.email;
    }

    if (deployment.name) {
      data.name = deployment.name;
    }

    if (deployment.companyName) {
      data.companyName = deployment.companyName;
    }

    if (deployment.companyPhoneNumber) {
      data.companyPhoneNumber = deployment.companyPhoneNumber;
    }

    await this.updateOneById({
      id: existing.id!,
      data: data,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
