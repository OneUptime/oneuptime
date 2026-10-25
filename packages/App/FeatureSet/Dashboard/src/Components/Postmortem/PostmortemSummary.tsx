import ObjectID from "Common/Types/ObjectID";
import DetailFieldLabel from "Common/UI/Components/Detail/DetailFieldLabel";
import React, { FunctionComponent, ReactElement } from "react";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import PostmortemOwners, { PostmortemAddOwners } from "./PostmortemOwners";
import { PostmortemStatusChoice } from "./PostmortemStatusChoices";
import PostmortemStatusPicker from "./PostmortemStatusPicker";

export interface ComponentProps {
  incidentId: ObjectID;
  statusId: string | null;
  choices: Array<PostmortemStatusChoice>;
  // Whether the reader may move the postmortem: they may edit the incident.
  canChangeStatus: boolean;
  onStatusChanged: () => void;
  owners: Array<ResourceOwnerEntry>;
  hasLoadedOwners: boolean;
  /*
   * Offered to a reader who may add an owner to the incident: owners are
   * added right here (PostmortemOwners). Left out, nothing offers to add
   * one - a promise the server would refuse.
   */
  addOwners?: PostmortemAddOwners | undefined;
}

/*
 * The top of an incident's postmortem: where it stands and who owns it, side
 * by side (one under the other on a phone), each named the way every detail
 * card names a field. The status is a pill that moves the postmortem; the
 * owners are the incident's, and a reader who may add one adds them right
 * there, from the Add owners list.
 */
const PostmortemSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    /*
     * Two halves with a gutter on the first, as the card's own two-column
     * rows have, so Owners lines up with the field under it.
     */
    <div
      className="grid grid-cols-1 gap-y-4 sm:grid-cols-2"
      data-testid="postmortem-summary"
    >
      <div className="min-w-0 space-y-1.5 sm:pr-6">
        <DetailFieldLabel title="Status" />
        <PostmortemStatusPicker
          incidentId={props.incidentId}
          statusId={props.statusId}
          choices={props.choices}
          isEditable={props.canChangeStatus}
          onChanged={() => {
            props.onStatusChanged();
          }}
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <DetailFieldLabel title="Owners" />
        <PostmortemOwners
          owners={props.owners}
          hasLoaded={props.hasLoadedOwners}
          addOwners={props.addOwners}
        />
      </div>
    </div>
  );
};

export default PostmortemSummary;
