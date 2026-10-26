import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import PageComponentProps from "../../../PageComponentProps";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Deleting an account takes its name, description and labels in OneUptime;
 * its resources and their history stay. A cloud connection that still
 * reaches the account adds it back at its next read, which the
 * confirmation says.
 */
const CloudAccountDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const translator: Translator = useTranslator();

  return (
    <Fragment>
      <ModelDelete
        modelType={CloudAccount}
        modelId={modelId}
        confirmationContent={
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "Its resources stay. A cloud connection that still reads this account adds it back at its next read: remove the account from the connection first.",
            )}
          </p>
        }
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNTS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default CloudAccountDelete;
