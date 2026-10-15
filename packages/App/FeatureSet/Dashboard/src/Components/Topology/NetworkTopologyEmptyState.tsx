import IconProp from "Common/Types/Icon/IconProp";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The way forward, such as "Add a device".
  footer?: ReactElement | undefined;
}

/*
 * What a device map says when there is nothing on it: the graph's own empty
 * state, and the whole of the map's card when the network has no device at
 * all (NetworkTopologyLiveView).
 *
 * Drawn the way every empty list in the product is (TableEmptyState): the
 * Devices, Discovery and Endpoints pages a new project opens next to this
 * one say "nothing yet" with the same illustration, heading and next step.
 */
const NetworkTopologyEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div data-testid="network-topology-empty-state">
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        icon={IconProp.Map}
        title="No network topology discovered yet."
        description="Add your devices and they appear here. Devices read over SNMP are linked to the neighbours they report."
        actionElement={props.footer}
        dataTestId="network-topology-empty"
      />
    </div>
  );
};

export default NetworkTopologyEmptyState;
