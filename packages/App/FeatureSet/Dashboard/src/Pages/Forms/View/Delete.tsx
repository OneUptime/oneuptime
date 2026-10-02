import FormsCopy from "../../../Components/FormBuilder/FormsCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Form from "Common/Models/DatabaseModels/Form";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useParams } from "react-router-dom";

const FormDelete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { id } = useParams();
  const { translateString } = useTranslateValue();

  return (
    <Fragment>
      <ModelDelete
        modelType={Form}
        modelId={new ObjectID(id || "")}
        confirmationContent={
          <p className="text-sm text-gray-600">
            {translateString(FormsCopy.deleteFormNote) ||
              FormsCopy.deleteFormNote}
          </p>
        }
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
