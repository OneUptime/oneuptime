import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Form from "Common/Models/DatabaseModels/Form";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useParams } from "react-router-dom";

const FormDelete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { id } = useParams();

  return (
    <Fragment>
      {/*
       * What goes with a form - its submissions, not what they created - is
       * said by ModelDelete (DeleteConsequences), in the words the Forms
       * list's Delete says it too.
       */}
      <ModelDelete
        modelType={Form}
        modelId={new ObjectID(id || "")}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(RouteMap[PageMap.FORMS] as Route),
          );
        }}
      />
    </Fragment>
  );
};

export default FormDelete;
