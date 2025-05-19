import React, { FunctionComponent, ReactElement, useState } from "react";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import Probe from "Common/Models/DatabaseModels/Probe";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { JSONObject } from "Common/Types/JSON";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ObjectID from "Common/Types/ObjectID";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/UI/Utils/API/API";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
import SummaryInfo from "../../Monitor/SummaryView/SummaryInfo";

export interface ComponentProps {
  monitorId?: ObjectID | undefined;
  monitorSteps: MonitorSteps;
  monitorType: MonitorType;
  probes: Array<Probe>;
  buttonSize: ButtonSize;
}

const MonitorTestForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // only show this monitor if this monitor is probeable.

  const isProbeable: boolean = MonitorTypeHelper.isProbableMonitor(
    props.monitorType,
  );

  if (!isProbeable) {
    return <></>;
  }

  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [showResultModal, setShowResultModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [monitorStepProbeResponse, setMonitorStepProbeResponse] =
    useState<MonitorStepProbeResponse | null>(null);

  type ProcessResultFunction = (probeId: ObjectID) => Promise<void>;
  const processResult: ProcessResultFunction = async (
    probeId: ObjectID,
  ): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);
      setShowTestModal(false);
      setShowResultModal(true);

      // now we need to run the probe and get the result.

      // save the monitor step to the database.
      const monitorTestObj: MonitorTest = new MonitorTest();
      monitorTestObj.monitorSteps = props.monitorSteps;
      monitorTestObj.probeId = probeId;
      monitorTestObj.monitorType = props.monitorType;
      monitorTestObj.isInQueue = true;
      if (props.monitorId) {
        monitorTestObj.monitorId = props.monitorId;
      }

      // save the monitor test to the database.

      const monitorTest: HTTPResponse<MonitorTest> = (await ModelAPI.create({
        model: monitorTestObj,
        modelType: MonitorTest,
      })) as HTTPResponse<MonitorTest>;

      // now we need to fetch the result of this result every 15 seconds.

      const monitorTestId: ObjectID = monitorTest.data.id!;

      let attempts: number = 0;

      const interval: NodeJS.Timer = setInterval(async () => {
        const result: MonitorTest | null = (await ModelAPI.getItem({
          modelType: MonitorTest,
          id: monitorTestId,
          select: {
            monitorStepProbeResponse: true,
          },
        })) as MonitorTest | null;

        if (result?.monitorStepProbeResponse) {
          //set the response and clear the interval.

          setMonitorStepProbeResponse(result.monitorStepProbeResponse);
          clearInterval(interval);
          setIsLoading(false);
          setError(null);
        }

        // if we have tried 10 times, then we should stop trying.

        attempts++;

        if (attempts > 10 && !result?.monitorStepProbeResponse) {
          clearInterval(interval);
          setIsLoading(false);
          setError(
            "Monitor Test took too long to complete. Please try again later.",
          );
        }
      }, 15000); // 15 seconds.
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div className="-ml-3 mr-2">
        <Button
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={props.buttonSize}
          title="Test Monitor"
          icon={IconProp.Play}
          onClick={() => {
            // flush all the previous results.
            setMonitorStepProbeResponse(null);
            setError(null);
            setIsLoading(false);
            setShowTestModal(true);
          }}
        />
      </div>

      {showTestModal && (
        <BasicFormModal
          title={"Test Monitor"}
          description="Run a test on this monitor to see if it is working correctly."
          onClose={() => {
            return setShowTestModal(false);
          }}
          onSubmit={async (data: JSONObject) => {
            await processResult(data["probe"] as ObjectID);
          }}
          submitButtonText="Run Test"
          submitButtonStyleType={ButtonStyleType.PRIMARY}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  probe: true,
                },
                title: "Select Probe",
                description: "Select the probe you want to run the test on.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: props.probes,
                    labelField: "name",
                    valueField: "_id",
                  },
                ),
                required: true,
                placeholder: "",
              },
            ],
          }}
        />
      )}

      {showResultModal && (
        <Modal
          title="Monitor Test Result"
          description="The result of the monitor test will be shown below."
          submitButtonText="Close"
          submitButtonType={ButtonType.Button}
          submitButtonStyleType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setShowResultModal(false);
          }}
          modalWidth={ModalWidth.Large}
        >
          <div>
            {error && <ErrorMessage message={error} />}
            {isLoading && (
              <div className="w-full text-center mt-10 mb-10">
                <Loader
                  className="m-auto"
                  loaderType={LoaderType.Bar}
                  size={200}
                />

                <div className="text-xs text-gray-500 text-center mt-3">
                  Running monitor test on a probe. This usually takes a minute
                  or two to complete because we need to notify the probe to run
                  the test.
                </div>
              </div>
            )}
            {monitorStepProbeResponse && (
              <div className="mt-3">
                <SummaryInfo
                  monitorType={props.monitorType}
                  probeMonitorResponses={Object.values(
                    monitorStepProbeResponse,
                  )}
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default MonitorTestForm;
