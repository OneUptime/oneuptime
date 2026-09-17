import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
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
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/UI/Utils/API/API";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
import SummaryInfo from "../../Monitor/SummaryView/SummaryInfo";

/*
 * How often the dashboard asks whether the probe has reported back, and how
 * many times it is willing to ask. Exported so a test can advance timers by a
 * named value instead of re-stating the magic numbers - the same reason
 * DeviceDiagnostics exports its own poll constants.
 *
 * The floor on the answer is not this interval: a probe pulls its queue every
 * ten seconds (Probe/Jobs/Monitor/FetchMonitorTest.ts) and then has to run the
 * steps, so the budget below - two and a half minutes - is what makes "slow
 * probe" and "no probe is listening" look different to a waiting user.
 */
export const MONITOR_TEST_POLL_INTERVAL_IN_MS: number = 15000;
export const MONITOR_TEST_MAX_POLL_ATTEMPTS: number = 10;

export interface ComponentProps {
  monitorId?: ObjectID | undefined;
  monitorSteps: MonitorSteps;
  monitorType: MonitorType;
  probes: Array<Probe>;
  buttonSize: ButtonSize;
  /*
   * Classes for the wrapper around the trigger button. The default cancels the
   * `md:ml-3` that ButtonStyleType.NORMAL carries for a modal footer, which is
   * what a card's right-hand slot wants. A caller that places the button in a
   * row which already spaces its children passes its own.
   */
  className?: string | undefined;
}

const MonitorTestForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [showResultModal, setShowResultModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [monitorStepProbeResponse, setMonitorStepProbeResponse] =
    useState<MonitorStepProbeResponse | null>(null);

  /*
   * The poll that is currently in flight, so it can be stopped. Without this,
   * closing the result modal, starting a second test, or navigating away left
   * the interval running for its full budget - still fetching every fifteen
   * seconds and still calling setState, on a component that may no longer be
   * mounted. Two overlapping runs also raced: whichever finished second
   * overwrote the other's result, so a good result could be replaced by the
   * loser's "took too long" message.
   */
  const pollIntervalRef: React.MutableRefObject<NodeJS.Timeout | null> =
    useRef<NodeJS.Timeout | null>(null);

  /*
   * The create round trip happens before there is an interval to cancel, so
   * unmounting during it would otherwise start a poll that nothing owns.
   */
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);

  type StopPollingFunction = () => void;
  const stopPolling: StopPollingFunction = (): void => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, []);

  // only show this monitor if this monitor is probeable.

  const isProbeable: boolean = MonitorTypeHelper.isProbableMonitor(
    props.monitorType,
  );

  /*
   * Running a test creates a MonitorTest row, and that is a create permission
   * the read audience of a monitor does not necessarily hold - a Viewer can
   * open every page this button appears on. Hidden rather than disabled, which
   * is the rule the rest of the dashboard follows for an on-demand run (see
   * the diagnostics buttons on the network device page): the permission
   * snapshot arrives on a response header, so a gate that has not loaded yet
   * answers "not allowed" with nothing honest to say, and a disabled button
   * would accuse a permitted user of lacking a permission they hold.
   */
  const canRunTest: boolean = PermissionGate.check(
    new MonitorTest(),
    ModelAction.Create,
  ).isAllowed;

  type ProcessResultFunction = (probeId: ObjectID) => Promise<void>;
  const processResult: ProcessResultFunction = async (
    probeId: ObjectID,
  ): Promise<void> => {
    try {
      // A previous run must not keep writing over this one's state.
      stopPolling();

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

      if (!isMountedRef.current) {
        // The user left while the row was being created. Nothing to poll for.
        return;
      }

      let attempts: number = 0;

      const interval: NodeJS.Timeout = setInterval(async () => {
        /*
         * A poll that throws - a network blip, or a row this user may not read
         * back - used to become an unhandled rejection every fifteen seconds,
         * because the try/catch below has long since returned by the time the
         * first tick fires. Count the failure as an attempt and let the budget
         * decide, so one bad response does not end a test that is still coming.
         */
        let result: MonitorTest | null = null;

        try {
          result = (await ModelAPI.getItem({
            modelType: MonitorTest,
            id: monitorTestId,
            select: {
              monitorStepProbeResponse: true,
            },
          })) as MonitorTest | null;
        } catch (err) {
          result = null;

          if (attempts + 1 > MONITOR_TEST_MAX_POLL_ATTEMPTS) {
            stopPolling();
            setIsLoading(false);
            setError(API.getFriendlyErrorMessage(err as Error));
            return;
          }
        }

        if (result?.monitorStepProbeResponse) {
          //set the response and clear the interval.

          setMonitorStepProbeResponse(result.monitorStepProbeResponse);
          stopPolling();
          setIsLoading(false);
          setError(null);
        }

        // if we have tried 10 times, then we should stop trying.

        attempts++;

        if (
          attempts > MONITOR_TEST_MAX_POLL_ATTEMPTS &&
          !result?.monitorStepProbeResponse
        ) {
          stopPolling();
          setIsLoading(false);
          setError(
            "Monitor Test took too long to complete. Please try again later.",
          );
        }
      }, MONITOR_TEST_POLL_INTERVAL_IN_MS); // 15 seconds.

      pollIntervalRef.current = interval;
    } catch (err) {
      stopPolling();
      setError(API.getFriendlyErrorMessage(err as Error));
      setIsLoading(false);
    }
  };

  if (!isProbeable || !canRunTest) {
    return <></>;
  }

  return (
    <div>
      <div className={props.className ?? "-ml-3 mr-2"}>
        <Button
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={props.buttonSize}
          title="Test Monitor"
          dataTestId="test-monitor-button"
          icon={IconProp.Play}
          onClick={() => {
            // flush all the previous results.
            stopPolling();
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
            /*
             * Closing the result is the user saying they are done waiting, so
             * the poll goes with it rather than running on in the background.
             */
            stopPolling();
            setIsLoading(false);
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
