import React, { FunctionComponent, ReactElement, useState } from "react";
import Modal, { ModalWidth } from "../Modal/Modal";
import FeedEventTypeChecklist from "./FeedEventTypeChecklist";
import {
  FEED_OPTIONS_TEXT,
  FeedEventTypeOption,
  FeedOptions,
} from "./FeedOptions";

export interface ComponentProps {
  value: FeedOptions;
  eventTypeOptions: Array<FeedEventTypeOption>;
  // Called with the ticked event types when the reader applies them.
  onApply: (eventTypes: Array<string>) => void;
  onClose: () => void;
}

/*
 * A feed's event type filter: the dialog its ⋯ menu's "Filter by event type"
 * and its filter box's "Edit Filters" open, as a table's Filter opens its
 * filter dialog. The reader ticks any number of event types and applies them
 * together with Apply Filters - one read of the feed, not one per box - and
 * Cancel leaves the feed as it was. Nothing ticked shows every event type.
 */
const FeedFilterModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // The ticks, held here until they are applied.
  const [selectedEventTypes, setSelectedEventTypes] = useState<Array<string>>(
    () => {
      return [...props.value.eventTypes];
    },
  );

  return (
    <Modal
      title={FEED_OPTIONS_TEXT.filter}
      modalWidth={ModalWidth.Normal}
      submitButtonText={FEED_OPTIONS_TEXT.applyFilters}
      onClose={props.onClose}
      onSubmit={() => {
        props.onApply(selectedEventTypes);
      }}
    >
      <FeedEventTypeChecklist
        eventTypeOptions={props.eventTypeOptions}
        selectedEventTypes={selectedEventTypes}
        onChange={setSelectedEventTypes}
      />
    </Modal>
  );
};

export default FeedFilterModal;
