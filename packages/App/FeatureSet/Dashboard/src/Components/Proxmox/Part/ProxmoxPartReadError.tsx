import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import React, { FunctionComponent, ReactElement } from "react";
import { ProxmoxPartKind } from "../../../Pages/Proxmox/Utils/ProxmoxHealth";

export const PROXMOX_PART_READ_ERROR_TEST_ID: string =
  "proxmox-part-read-error";

/*
 * What a Proxmox node's, guest's or storage's page says when the read of its
 * inventory failed: that it could not be loaded, the server's answer, and
 * Try again - drawn as a list that could not be loaded is (TableEmptyState),
 * so the Overview tab and the node's Guests and Storage tabs say it alike.
 *
 * The pages swallowed the failure and drew their empty state instead -
 * "Node details not reported yet. Make sure the Proxmox agent is sending
 * metrics." - which sent an administrator to an agent that was working,
 * while OneUptime could not answer (#5524's follow-up). The cluster's own
 * Overview says when its inventory cannot be read too.
 */
export const PROXMOX_PART_READ_ERROR_TITLES: Readonly<
  Record<ProxmoxPartKind, string>
> = {
  Node: translationKey("Couldn't load this node"),
  Guest: translationKey("Couldn't load this guest"),
  Storage: translationKey("Couldn't load this storage"),
};

export interface ComponentProps {
  kind: ProxmoxPartKind;
  // The server's answer, as API.getFriendlyMessage words it.
  message: string;
  // Reads the part again.
  onRetry: () => void;
}

const ProxmoxPartReadError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      data-testid={PROXMOX_PART_READ_ERROR_TEST_ID}
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <TableEmptyState
        kind={TableEmptyStateKind.Error}
        title={PROXMOX_PART_READ_ERROR_TITLES[props.kind]}
        description={props.message}
        actions={[
          {
            title: "Try again",
            icon: IconProp.Refresh,
            dataTestId: "refresh-button",
            onClick: props.onRetry,
          },
        ]}
      />
    </div>
  );
};

export default ProxmoxPartReadError;
