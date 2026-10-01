import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import ExportModelCard from "Common/UI/Components/ImportExport/ExportModelCard";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Duplicate and export: things done to the workflow as a whole.
 *
 * The webhook secret key used to be a card here too. It is the secret part of
 * the Webhook trigger's URL, so it now lives with that trigger: open the
 * Webhook step in the Builder to show, copy or reset the URL
 * (Common/UI/Components/Workflow/WebhookTriggerPanel.tsx).
 */
const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DuplicateModel
        modelId={modelId}
        modelType={Workflow}
        /*
         * isEnabled is deliberately not duplicated. The copy is created with
         * the graph already attached, so its trigger is live from the moment
         * it is enabled - duplicating an enabled workflow would immediately
         * start a second copy of the same automation. The duplicate lands
         * disabled and is turned on once it has been edited, which matches
         * both a new workflow and an imported one.
         */
        fieldsToDuplicate={{
          description: true,
          graph: true,
          labels: true,
        }}
        navigateToOnSuccess={RouteUtil.populateRouteParams(
          new Route(RouteMap[PageMap.WORKFLOWS]?.toString()),
        )}
        fieldsToChange={[
          {
            field: {
              name: true,
            },
            title: "New Workflow Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "New Workflow Name",
            validation: {
              minLength: 2,
            },
          },
        ]}
      />

      <div className="mt-5">
        <ExportModelCard modelId={modelId} modelType={Workflow} />
      </div>
    </Fragment>
  );
};

export default Settings;
