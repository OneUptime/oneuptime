import { JSONObject } from "Common/Types/JSON";
import {
  OPENSTACK_CLOUDKITTY_MOST_PAGES,
  OPENSTACK_CLOUDKITTY_PAGE_SIZE,
  OPENSTACK_CLOUDKITTY_READ_EVERY_MINUTES,
  OpenStackCloudKittyPage,
  OpenStackCloudKittyPeriod,
  OpenStackCloudKittyRow,
  addOpenStackCloudKittyRows,
  getOpenStackCloudKittyPeriods,
  readOpenStackCloudKittyReport,
  readOpenStackCloudKittySummary,
} from "Common/Types/OpenStack/OpenStackCloudKitty";
import { OpenStackRatingInventory } from "../OpenStackInventory";
import { OpenStackJsonAnswer } from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * CloudKitty, which most clouds don't run. A real one has answered this on stable/2026.1
 * (Fixtures/OpenStack/services-cloudkitty), and its tests replay what it said.
 *
 * Its version document says whether it's there and answering, every time this service is read. What it
 * rated is asked once an hour, this month and last, a page at a time and no more than
 * OPENSTACK_CLOUDKITTY_MOST_PAGES of them. A rated figure moves slowly, and a summary makes CloudKitty
 * go through a period's rated data. So at most two reads per thousand projects, an hour.
 *
 * v2 first. A CloudKitty too old for it has v1. Anything refused is no news: its own policy shows most
 * credentials only their own project, or nothing, and then those projects go on being worked out from
 * inventory and prices. Nothing's sent between reads, because the figures stay on the projects' rows.
 *
 * A CloudKitty per region rates its own region's use, and a project's regions add up. So one that the
 * catalog lists for two regions has to be asked once, which is why the hour is kept by its address.
 */

const READ_EVERY_IN_MS: number =
  OPENSTACK_CLOUDKITTY_READ_EVERY_MINUTES * 60_000;

export default async function collectRating(
  context: OpenStackCollectorContext<OpenStackRatingInventory>,
): Promise<void> {
  const { run, inventory, memory, memoryKey } = context;

  const version: OpenStackJsonAnswer | undefined = await run.read({
    name: "versions",
    isInventory: false,
    run: () => {
      return run.client.get({
        read: "versions",
        path: "/",
        acceptsMultipleChoices: true,
      });
    },
  });

  if (!version) {
    return;
  }

  const now: number = run.client.now();
  const readKey: string = `${memoryKey}/${run.client.baseUrl}/rating-read`;

  if (memory.recall<boolean>(readKey, READ_EVERY_IN_MS, now) === true) {
    return;
  }

  memory.remember(readKey, true, now);

  const rated: NonNullable<OpenStackRatingInventory["rated"]> = [];

  for (const period of getOpenStackCloudKittyPeriods(new Date(now))) {
    const rows: Array<OpenStackCloudKittyRow> | null =
      (await readSummary(context, period)) ??
      (await readReport(context, period));

    if (!rows) {
      // Refused or absent both ways: the other period would be the same.
      return;
    }

    for (const [projectId, rate] of addOpenStackCloudKittyRows(rows)) {
      rated.push({ projectId, period: period.month, rate });
    }
  }

  inventory.rated = rated;
}

async function readSummary(
  context: OpenStackCollectorContext<OpenStackRatingInventory>,
  period: OpenStackCloudKittyPeriod,
): Promise<Array<OpenStackCloudKittyRow> | null> {
  const { run } = context;
  const rows: Array<OpenStackCloudKittyRow> = [];

  for (let page: number = 0; page < OPENSTACK_CLOUDKITTY_MOST_PAGES; page++) {
    const answer: OpenStackJsonAnswer | undefined = await run.read({
      name: "summary",
      isInventory: false,
      isQuietWhenRefused: true,
      run: () => {
        return run.client.get({
          read: "summary",
          path: "/v2/summary",
          query: {
            begin: period.begin,
            end: period.end,
            groupby: "project_id",
            limit: OPENSTACK_CLOUDKITTY_PAGE_SIZE,
            offset: page * OPENSTACK_CLOUDKITTY_PAGE_SIZE,
          },
        });
      },
    });

    if (!answer) {
      // Nothing yet says v2 isn't there. Something already read has been read.
      return page === 0 ? null : rows;
    }

    const read: OpenStackCloudKittyPage = readOpenStackCloudKittySummary(
      answer.body as JSONObject,
    );

    rows.push(...read.rows);

    if (
      read.total === null ||
      (page + 1) * OPENSTACK_CLOUDKITTY_PAGE_SIZE >= read.total
    ) {
      break;
    }
  }

  return rows;
}

async function readReport(
  context: OpenStackCollectorContext<OpenStackRatingInventory>,
  period: OpenStackCloudKittyPeriod,
): Promise<Array<OpenStackCloudKittyRow> | null> {
  const { run } = context;

  const answer: OpenStackJsonAnswer | undefined = await run.read({
    name: "report",
    isInventory: false,
    isQuietWhenRefused: true,
    run: () => {
      return run.client.get({
        read: "report",
        path: "/v1/report/summary",
        query: {
          begin: period.begin,
          end: period.end,
          groupby: "tenant_id",
          all_tenants: "true",
        },
      });
    },
  });

  return answer
    ? readOpenStackCloudKittyReport(answer.body as JSONObject).rows
    : null;
}
