import ObjectID from "Common/Types/ObjectID";
import { ResourceOwnerEntry } from "./OwnerEntry";

/*
 * Whether the person signed in is one of a record's owners, as a list read
 * them (useResourceOwners): true or false once they are read, undefined
 * while they are not - so Assign to Me is offered until the list knows.
 * Being in a team that owns it is not owning it: Assign to Me makes them
 * an owner themselves.
 */
export const isOwnedByViewer: (data: {
  owners: Array<ResourceOwnerEntry> | undefined;
  viewerId: ObjectID | string | null | undefined;
}) => boolean | undefined = (data: {
  owners: Array<ResourceOwnerEntry> | undefined;
  viewerId: ObjectID | string | null | undefined;
}): boolean | undefined => {
  if (!data.owners) {
    return undefined;
  }

  const viewerId: string = data.viewerId?.toString().toLowerCase() || "";

  if (!viewerId) {
    return undefined;
  }

  return data.owners.some((owner: ResourceOwnerEntry): boolean => {
    return (
      owner.kind === "user" &&
      (owner.user.id?.toString() || owner.user._id?.toString() || "")
        .toLowerCase()
        .trim() === viewerId
    );
  });
};
