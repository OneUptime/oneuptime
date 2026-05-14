import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { RUNBOOK_URL } from "Common/UI/Config";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import { JSONObject } from "Common/Types/JSON";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Red500 } from "Common/Types/BrandColors";

const Overview: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const runNow: () => Promise<void> = async (): Promise<void> => {
    setIsRunning(true);
    setError("");
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(RUNBOOK_URL.toString()).addRoute(
            "/run/" + modelId.toString(),
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders({}),
        });

      if (result instanceof HTTPErrorResponse) {
        throw result;
      }

      const runbookExecutionId: string | undefined = (
        result.data as JSONObject
      )?.["runbookExecutionId"] as string | undefined;

      if (runbookExecutionId) {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
            {
              modelId,
              subModelId: runbookExecutionId,
            },
          ),
        );
      } else {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUNBOOK_VIEW_EXECUTIONS] as Route,
            { modelId },
          ),
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Fragment>
      <CardModelDetail<Runbook>
        name="Runbook > Overview"
        cardProps={{
          title: "Runbook",
          description: "Overview of this runbook.",
          buttons: [
            {
              title: isRunning ? "Starting..." : "Run Now",
              buttonStyle: ButtonStyleType.PRIMARY,
              icon: IconProp.Play,
              onClick: () => {
                void runNow();
              },
              disabled: isRunning,
            },
          ],
        }}
        isEditable={false}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: Runbook,
          id: "model-detail-runbook-overview",
          fields: [
            { field: { name: true }, title: "Name" },
            { field: { description: true }, title: "Description" },
            {
              field: { isEnabled: true },
              title: "Enabled",
              fieldType: FieldType.Element,
              getElement: (item: Runbook): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill text="Enabled" color={Green500} isMinimal={true} />
                  );
                }
                return <Pill text="Disabled" color={Red500} isMinimal={true} />;
              },
            },
          ],
          modelId,
        }}
      />

      {error && (
        <ConfirmModal
          title="Could not start runbook"
          description={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setError("");
          }}
        />
      )}
    </Fragment>
  );
};

export default Overview;
