import PageComponentProps from "../PageComponentProps";
import InventoryTable from "../../Components/Inventory/InventoryTable";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The items someone has put out of sight.
 *
 * This list exists because archiving, not deleting, is the disposal route
 * that works for an estate catalog: a discovered row deleted here is
 * re-created by the next reconcile, and a mirrored one by the next poll.
 * Archiving is a user annotation nothing else writes, so it sticks — but that
 * also means an archived row is still live, still collecting telemetry, and
 * still reachable. The banner says so, because "archived" reading as
 * "decommissioned" is the one way this list misleads.
 */
const InventoryArchived: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <Alert
        dataTestId="inventory-archived-banner"
        type={AlertType.INFO}
        strongTitle="These are hidden, not gone"
        title="Archived items keep their identity and keep collecting telemetry. Archiving only takes them out of the main list — it does not stop anything or delete anything."
      />

      <InventoryTable
        tableKey="inventory-archived-table"
        archivedOnly={true}
        cardTitle="Archived Items"
        cardDescription="Items you have taken out of the main list. Restore one to put it back."
      />
    </Fragment>
  );
};

export default InventoryArchived;
