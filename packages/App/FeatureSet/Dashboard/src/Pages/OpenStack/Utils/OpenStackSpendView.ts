import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackProjectUsage from "Common/Models/DatabaseModels/OpenStackProjectUsage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCollectionMethod from "Common/Types/OpenStack/OpenStackCollectionMethod";
import {
  OPENSTACK_COST_LINE_TITLES,
  OPENSTACK_COST_LINE_UNITS,
  OpenStackCostLine,
  OpenStackPriceList,
  OpenStackUsageCost,
  getOpenStackUsageCost,
  readOpenStackPriceList,
} from "Common/Types/OpenStack/OpenStackPriceList";
import { readOpenStackUsageQuantities } from "Common/Types/OpenStack/OpenStackProjectUsage";
import {
  OpenStackSpendSnapshot,
  OpenStackSpendSource,
  readOpenStackSpendSnapshot,
} from "Common/Types/OpenStack/OpenStackSpendSnapshot";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT THE SPEND PAGE SAYS, APART FROM HOW IT LOOKS.
 *
 * The page reads one row of the cloud, however many projects it has, and the list of projects a page
 * at a time. Where money is said it's an estimate, in the operator's currency or none at all, because
 * CloudKitty doesn't say one and a dollar sign nobody chose would be a guess. Nothing here may read
 * as an invoice: no amount due, no bill, no tenant being asked for anything.
 */

export interface OpenStackSpendRead {
  snapshot: OpenStackSpendSnapshot | null;
  priceList: OpenStackPriceList | null;
  // As it's stored, zeros and all, so a form opens with what was typed.
  storedPriceList: JSONObject | null;
  collectionMethod: OpenStackCollectionMethod | null;
}

export async function fetchOpenStackSpend(
  openStackCloudId: ObjectID,
): Promise<OpenStackSpendRead> {
  const cloud: OpenStackCloud | null = await ModelAPI.getItem<OpenStackCloud>({
    modelType: OpenStackCloud,
    id: openStackCloudId,
    select: { spendSnapshot: true, priceList: true, collectionMethod: true },
  });

  return {
    snapshot: readOpenStackSpendSnapshot(cloud?.spendSnapshot),
    priceList: readOpenStackPriceList(cloud?.priceList),
    storedPriceList: (cloud?.priceList as JSONObject | undefined) || null,
    collectionMethod:
      (cloud?.collectionMethod as OpenStackCollectionMethod | undefined) ||
      null,
  };
}

export const OPENSTACK_SPEND_SOURCE_TEXT: Readonly<
  Record<OpenStackSpendSource, string>
> = {
  cloudkitty: translationKey(
    "Costs are CloudKitty's own rated figures. Usage is worked out from this cloud's inventory.",
  ),
  "cloudkitty-and-price-list": translationKey(
    "Costs are CloudKitty's rated figures where it rated a project, and your prices where it didn't. Each project says which. Usage is worked out from this cloud's inventory.",
  ),
  "price-list": translationKey(
    "Costs are estimates: your prices applied to what this cloud's inventory shows was used.",
  ),
  "usage-only": translationKey(
    "No prices are set, so this page shows usage only. Set prices to see what it would come to. A price of zero means no price, not that something is free.",
  ),
};

export const OPENSTACK_SPEND_NOT_BILLING_TEXT: string = translationKey(
  "Usage and estimates to plan with. OneUptime doesn't invoice anyone.",
);

export const OPENSTACK_SPEND_AGENT_CLOUDKITTY_TEXT: string = translationKey(
  "If this cloud runs CloudKitty, connecting it without an agent reads its rated figures. An agent can't.",
);

export const OPENSTACK_SPEND_NO_SNAPSHOTS_TEXT: string = translationKey(
  "The OpenStack agent's exporter doesn't report snapshots one by one, so snapshot storage isn't counted on this cloud. Connecting it without an agent counts them.",
);

// An estimate as a page says it. With no currency, a number alone.
export function formatOpenStackSpendMoney(data: {
  amount: number | null | undefined;
  currency: string | null | undefined;
  translator: Translator;
}): string {
  if (data.amount === null || data.amount === undefined) {
    return "–";
  }

  const rounded: number = Math.round(data.amount * 100) / 100;

  if (!data.currency) {
    return rounded.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: data.currency,
    }).format(rounded);
  } catch {
    return `${data.currency} ${rounded.toFixed(2)}`;
  }
}

export function formatOpenStackUsageNumber(
  value: number | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "–";
  }

  return (Math.round(value * 100) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

/*
 * How much of a month was counted, when any of it wasn't. A month that started before anyone was
 * reading isn't a cheap month, and neither is one with a long gap in it.
 */
export function getOpenStackCoverageNote(data: {
  snapshot: OpenStackSpendSnapshot;
  translator: Translator;
}): string | null {
  const { coverage } = data.snapshot;

  if (coverage.notCountedHours >= 1) {
    return data.translator.translateTemplate(
      "OneUptime wasn't reading this cloud for {{hours}} hours this month, so what those hours used isn't counted.",
      { hours: Math.round(coverage.notCountedHours).toString() },
    );
  }

  return null;
}

function csvRow(values: ReadonlyArray<string | number | null>): string {
  return values
    .map((value: string | number | null): string => {
      return TableColumnsToCsv.escapeCsvValue(
        TableColumnsToCsv.sanitizeForCsvInjection(
          value === null ? "" : String(value),
        ),
      );
    })
    .join(",");
}

/*
 * One line per project and thing used, so a spreadsheet can add it up either way: by project or by
 * flavor. It says estimated in its own header, and which month it covers. A project CloudKitty rated
 * has its usage lines and one line of CloudKitty's figure, whose lines have no amount of their own.
 */
export function getOpenStackSpendCsv(data: {
  rows: ReadonlyArray<OpenStackProjectUsage>;
  month: string;
  priceList: OpenStackPriceList | null;
  currency: string | null;
}): string {
  const lines: Array<string> = [
    csvRow([
      "Month",
      "Project",
      "Project ID",
      "Domain",
      "What",
      "Name",
      "Region",
      "Quantity",
      "Unit",
      "Price per unit",
      `Estimated cost${data.currency ? ` (${data.currency})` : ""}`,
      "Source",
    ]),
  ];

  for (const row of data.rows) {
    const isRated: boolean = row.costSource === "cloudkitty";
    const cost: OpenStackUsageCost = getOpenStackUsageCost({
      quantities: readOpenStackUsageQuantities(row.quantities),
      priceList: isRated ? null : data.priceList,
    });
    const common: Array<string | null> = [
      data.month,
      row.name || null,
      row.openStackProjectId || null,
      row.domainName || null,
    ];

    for (const line of cost.lines as Array<OpenStackCostLine>) {
      lines.push(
        csvRow([
          ...common,
          OPENSTACK_COST_LINE_TITLES[line.kind],
          line.name,
          line.regionName,
          line.quantity,
          OPENSTACK_COST_LINE_UNITS[line.kind],
          line.unitPrice,
          line.amount === null ? null : Math.round(line.amount * 10000) / 10000,
          line.amount === null ? null : "Your prices",
        ]),
      );
    }

    if (isRated) {
      lines.push(
        csvRow([
          ...common,
          "CloudKitty rating",
          null,
          null,
          null,
          null,
          null,
          row.estimatedCost ?? null,
          "CloudKitty",
        ]),
      );
    }
  }

  return lines.join("\n");
}

// Every project's row of a month, a page at a time, for the one thing that needs them all at once.
export async function fetchOpenStackSpendRows(data: {
  openStackCloudId: ObjectID;
  month: string;
}): Promise<Array<OpenStackProjectUsage>> {
  const rows: Array<OpenStackProjectUsage> = [];
  const limit: number = 1000;

  for (;;) {
    const page: ListResult<OpenStackProjectUsage> =
      await ModelAPI.getList<OpenStackProjectUsage>({
        modelType: OpenStackProjectUsage,
        query: {
          openStackCloudId: data.openStackCloudId,
          period: data.month,
        },
        select: {
          openStackProjectId: true,
          name: true,
          domainName: true,
          quantities: true,
          estimatedCost: true,
          costSource: true,
        },
        sort: { openStackProjectId: SortOrder.Ascending },
        skip: rows.length,
        limit,
      });

    rows.push(...page.data);

    if (page.data.length < limit || rows.length >= page.count) {
      return rows;
    }
  }
}
