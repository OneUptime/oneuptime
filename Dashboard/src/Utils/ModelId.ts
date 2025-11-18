import ObjectID from "Common/Types/ObjectID";

export interface ModelIdentifier {
  id?: ObjectID | string | null | undefined;
  _id?: ObjectID | string | null | undefined;
}

export function getModelIdString(item: ModelIdentifier): string | null {
  const identifier: ObjectID | string | null | undefined = item.id || item._id;

  if (!identifier) {
    return null;
  }

  return identifier.toString();
}
