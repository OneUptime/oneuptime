import IconProp from "Common/Types/Icon/IconProp";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a part's page says when the read of its inventory failed - a Proxmox
 * node, guest or storage, an ESXi host, a VM, a datastore or a cluster:
 * that it could not be loaded, the server's answer, and Try again, drawn as
 * a list that could not be loaded is (TableEmptyState), so a part's Overview
 * tab and its lists say it alike.
 *
 * A page that swallowed the failure drew its empty state instead ("No data
 * yet", "Not in inventory"), which sent an administrator to an agent that
 * was working while OneUptime could not answer. Shared by every resource
 * product (#5553 built it for Proxmox).
 */

// The card it is drawn in, with a card's gutter on a phone.
export const RESOURCE_PART_READ_ERROR_CLASS_NAME: string =
  "rounded-xl border border-gray-200 bg-white px-5 shadow-sm sm:px-0";

export interface ComponentProps {
  testId: string;
  // "Couldn't load this node" - English, looked up in the reader's language.
  title: string;
  // The server's answer, as API.getFriendlyMessage words it.
  message: string;
  // Reads the part again.
  onRetry: () => void;
}

const ResourcePartReadError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    /*
     * A card's own gutter on a phone (px-5, as Card's), where the empty
     * state has none and its Try again button takes the line's whole
     * width: without it the button ran into the card's borders. From sm up
     * the empty state pads itself.
     */
    <div
      data-testid={props.testId}
      className={RESOURCE_PART_READ_ERROR_CLASS_NAME}
    >
      <TableEmptyState
        kind={TableEmptyStateKind.Error}
        title={props.title}
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

export default ResourcePartReadError;
