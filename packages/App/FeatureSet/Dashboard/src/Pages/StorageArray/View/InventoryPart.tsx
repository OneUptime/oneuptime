import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import StorageArrayResourceDetail from "../../../Components/StorageArray/StorageArrayResourceDetail";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";

/*
 * One part of a kind only the array's platform has (#11001, on #11122's
 * StorageArrayPlatform.kindPages): a NetApp aggregate, SVM, LUN or
 * SnapMirror relationship, at .../inventory/<kind>/<externalId> under its
 * kind's list. What it says, lists and charts is its platform's
 * (StorageArrayKindPage.part); the page is every storage array part's
 * (StorageArrayResourceDetail).
 */
const StorageArrayInventoryPart: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const storageArrayId: ObjectID = Navigation.getLastParamAsObjectID(3);
  const kind: string = StorageArrayResourceUtils.externalIdFromRouteParam(
    Navigation.getLastParamAsString(2),
  );
  const externalId: string = StorageArrayResourceUtils.externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  return (
    <StorageArrayResourceDetail
      key={`${kind}/${externalId}`}
      kind={kind}
      storageArrayId={storageArrayId}
      externalId={externalId}
      emptyMessageTemplate={translationKey(
        "{{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts reading the array.",
      )}
      metricsTitleTemplate={translationKey("Metrics: {{name}}")}
      description={translationKey("Its latest performance and space, as the array reports them.")}
    />
  );
};

export default StorageArrayInventoryPart;
