import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";

export const PROXMOX_PART_READ_ERROR_TEST_ID: string =
  "proxmox-part-read-error";

/*
 * What a Proxmox node's, guest's or storage's page says when the read of its
 * inventory failed: the server's answer, and Refresh to read it again.
 *
 * The pages swallowed the failure and drew their empty state instead -
 * "Node details not reported yet. Make sure the Proxmox agent is sending
 * metrics." - which sent an administrator to an agent that was working,
 * while OneUptime could not answer (#5524's follow-up). The cluster's own
 * Overview says the same as this when its inventory cannot be read.
 */
export interface ComponentProps {
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
      className="rounded-xl border border-gray-200 bg-white px-5 shadow-sm"
    >
      <ErrorMessage message={props.message} onRefreshClick={props.onRetry} />
    </div>
  );
};

export default ProxmoxPartReadError;
