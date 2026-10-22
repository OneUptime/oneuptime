import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import DetailFieldLabel from "Common/UI/Components/Detail/DetailFieldLabel";
import React, { FunctionComponent, ReactElement } from "react";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import PostmortemOwners, {
  POSTMORTEM_ADD_OWNERS,
  POSTMORTEM_CHANGE_OWNERS,
} from "./PostmortemOwners";
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
  // The incident's Owners page, where its owners are added and removed.
  ownersRoute: Route;
  /*
   * Whether the reader may add an owner to the incident. Without it there is
   * no Change owners link: it would promise a change the Owners page then
   * refuses them.
   */
  canChangeOwners: boolean;
}

/*
 * The top of an incident's postmortem: where it stands and who owns it, side
 * by side (one under the other on a phone), each named the way every detail
 * card names a field. The status is a pill that moves the postmortem; the
 * owners are the incident's, changed on its Owners page - the link beside
 * their name, for those who may change them.
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
        <DetailFieldLabel
          title="Owners"
          sideLink={
            props.canChangeOwners
              ? {
                  text:
                    props.hasLoadedOwners && props.owners.length === 0
                      ? POSTMORTEM_ADD_OWNERS
                      : POSTMORTEM_CHANGE_OWNERS,
                  url: props.ownersRoute,
                }
              : undefined
          }
        />
        <PostmortemOwners
          owners={props.owners}
          hasLoaded={props.hasLoadedOwners}
        />
      </div>
    </div>
  );
};

export default PostmortemSummary;
