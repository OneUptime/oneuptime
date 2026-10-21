import PageComponentProps from "../PageComponentProps";
import InventoryTable from "../../Components/Inventory/InventoryTable";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The items someone has put out of sight.
 *
 * This list exists because archiving, not deleting, is the disposal route
 * that works for an estate catalog: a discovered row deleted here is
 * re-created by the next reconcile, and a mirrored one by the next poll.
 * Archiving is a user annotation nothing else writes, so it sticks — but that
 * also means an archived row is still live, still collecting telemetry, and
 * still reachable. "Archived" reading as "decommissioned" is the one way this
 * list misleads, so the card's description says it, the way every other
 * Archived page does ("hidden from the main list but keep collecting
 * telemetry"). It used to be a blue banner above the list, shown on every
 * visit; banners are for exceptions someone has to act on
 * (App/Tests/Dashboard/NoAlwaysOnInfoBannersGuard.test.ts).
 */
export const INVENTORY_ARCHIVED_DESCRIPTION: string = translationKey(
  "Items you have archived. They are hidden from the main list, but nothing is stopped or deleted: they keep their identity and keep collecting telemetry. Select items to unarchive them.",
);

// The card's title; the table's own prop is not one the extractor reads.
export const INVENTORY_ARCHIVED_TITLE: string =
  translationKey("Archived Items");

const InventoryArchived: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <InventoryTable
      tableKey="inventory-archived-table"
      archivedOnly={true}
      cardTitle={INVENTORY_ARCHIVED_TITLE}
      cardDescription={INVENTORY_ARCHIVED_DESCRIPTION}
    />
  );
};

export default InventoryArchived;
