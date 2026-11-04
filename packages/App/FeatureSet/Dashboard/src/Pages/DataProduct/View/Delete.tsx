import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { useParams } from "react-router-dom";

/*
 * Deleting a data product deletes its monitor and its SLO with it, so it
 * leaves every status page it was on, and its badge stops answering. Its
 * tables are untouched.
 */
const DataProductDeletePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const dataProductId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);

  return (
    <ModelDelete
      modelType={DataProduct}
      modelId={dataProductId}
      onDeleteSuccess={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.DATA_OBSERVABILITY_DATA_PRODUCTS] as Route,
          ),
        );
      }}
    />
  );
};

export default DataProductDeletePage;
