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
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "Common/Models/DatabaseModels/MonitorProbe";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/UI/Utils/API/API";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import SummaryInfo from "../../Monitor/SummaryView/SummaryInfo";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import MonitorTestVerdict from "./MonitorTestVerdict";
import { WhoIsToldDraftInput } from "../../Monitor/Overview/WhoIsToldApi";
import { getDraftLabelIds } from "../../Monitor/Overview/MonitorDraftWhoIsTold";

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

/*
 * What the budget running out says (#6836). Most often no probe picked the
 * test up - the probe chosen is offline - so it says where to look, and
 * what else to try, rather than "try again later".
 */
export const MONITOR_TEST_TIMED_OUT_MESSAGE: string = translationKey(
  "The test did not finish in time. The probe may be offline: check it under Probes, or pick another probe, then test again.",
);

// The dialog's words, said where they are drawn.
export const MONITOR_TEST_WORDS: Readonly<{
  description: string;
  probeTitle: string;
  probeDescription: string;
  onlyProbe: string;
  resultDescription: string;
}> = {
  description: translationKey("Runs one check now, and shows what it finds."),
  probeTitle: translationKey("Probe"),
  probeDescription: translationKey("Where the check runs from."),
  onlyProbe: translationKey("The check runs from {{probe}}."),
  resultDescription: translationKey(
    "What one check found, and what would follow.",
  ),
};

export interface ComponentProps {
  monitorId?: ObjectID | undefined;
  monitorSteps: MonitorSteps;
  monitorType: MonitorType;
  probes: Array<Probe>;
  /*
   * The probes that check this monitor, the likeliest first (#7985): the
   * probes Create Monitor's form has picked, or the monitor's own, the one
   * its summary shows first. The test starts on the first of them it
   * offers; a project with one probe starts on that one, and asks nothing.
   */
  preferredProbeIds?: Array<string> | undefined;
  /*
   * For what would follow the result (#7074): a monitor not created yet is
   * read as the form holds it, by its name and labels. A saved monitor's
   * are read from it.
   */
  monitorName?: string | undefined;
  labels?: Array<unknown> | undefined;
  buttonSize: ButtonSize;
  /*
   * Classes for the wrapper around the trigger button. None by default: the
   * button has no margin of its own, and the row it sits in spaces it.
   */
  className?: string | undefined;
}

/*
 * The probe Test Monitor starts on (#7985): the first preferred probe it
 * offers, else the only probe there is, else none - the person picks. It
 * opened on an empty Select Probe in a project with one probe, and with
 * the form's two probes already picked.
 */
export function getStartingTestProbeId(data: {
  probes: ReadonlyArray<Probe>;
  preferredProbeIds?: ReadonlyArray<string> | undefined;
}): string | undefined {
  const offered: Array<string> = data.probes
    .map((probe: Probe): string => {
      return probe._id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });

  for (const id of data.preferredProbeIds || []) {
    if (offered.includes(id)) {
      return id;
    }
  }

  return offered.length === 1 ? offered[0] : undefined;
}

/*
 * The probes a form or a monitor holds, as ids: a picker's values, the
 * monitor's own probe rows (their probeId), or ids as they come.
 */
export function toProbeIds(values: unknown): Array<string> {
  if (!Array.isArray(values)) {
    return [];
  }

  const ids: Array<string> = [];

  for (const value of values) {
    let id: string = "";

    if (typeof value === "string") {
      id = value;
    } else if (value instanceof ObjectID) {
      id = value.toString();
    } else if (value && typeof value === "object") {
      const item: { value?: unknown; _id?: unknown; probeId?: unknown } =
        value as { value?: unknown; _id?: unknown; probeId?: unknown };
      const raw: unknown = item.probeId ?? item.value ?? item._id;
      id = raw ? String(raw) : "";
    }

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * The probes that check a monitor, switched on, oldest first. None when
 * they cannot be read: Test Monitor then starts as it would with none.
 */
export async function getCheckingProbeIds(
  monitorId: ObjectID,
): Promise<Array<string>> {
  try {
    const result: ListResult<MonitorProbe> = await ModelAPI.getList({
      modelType: MonitorProbe,
      query: { monitorId: monitorId },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { probeId: true, isEnabled: true },
      sort: { createdAt: SortOrder.Ascending },
    });

    return toProbeIds(
      result.data.filter((row: MonitorProbe): boolean => {
        return row.isEnabled !== false;
      }),
    );
  } catch {
    return [];
  }
}

const MonitorTestForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [showResultModal, setShowResultModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [monitorStepProbeResponse, setMonitorStepProbeResponse] =
    useState<MonitorStepProbeResponse | null>(null);
  // The probe the test runs on, named in its result as on the overview.
  const [testedProbeName, setTestedProbeName] = useState<string | undefined>(
    undefined,
  );
  /*
   * The steps as the test ran them: what would follow the result is read
   * for them, not for whatever the form holds by the time it arrives.
   */
  const [testedSteps, setTestedSteps] = useState<MonitorSteps | null>(null);

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
      setTestedProbeName(
        props.probes
          .find((probe: Probe): boolean => {
            return probe._id?.toString() === probeId?.toString();
          })
          ?.name?.toString() || undefined,
      );
      setShowTestModal(false);
      setShowResultModal(true);
      setTestedSteps(props.monitorSteps);

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
            setError(API.getFriendlyMessage(err));
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
          setError(MONITOR_TEST_TIMED_OUT_MESSAGE);
        }
      }, MONITOR_TEST_POLL_INTERVAL_IN_MS); // 15 seconds.

      pollIntervalRef.current = interval;
    } catch (err) {
      stopPolling();
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  if (!isProbeable || !canRunTest) {
    return <></>;
  }

  const startingProbeId: string | undefined = getStartingTestProbeId({
    probes: props.probes,
    preferredProbeIds: props.preferredProbeIds,
  });

  // One probe in all: nothing to pick, so the dialog says which runs it.
  const onlyProbe: Probe | undefined =
    props.probes.length === 1 ? props.probes[0] : undefined;

  const resultResponses: Array<ProbeMonitorResponse> = monitorStepProbeResponse
    ? Object.values(monitorStepProbeResponse)
    : [];

  // The monitor the test ran, as who is told reads it (#7074).
  const testedDraft: WhoIsToldDraftInput | null = testedSteps
    ? {
        monitorId: props.monitorId,
        name: props.monitorName || "",
        monitorType: props.monitorType,
        monitorSteps: testedSteps,
        labelIds: getDraftLabelIds(props.labels),
      }
    : null;

  return (
    <div>
      <div className={props.className}>
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

      {/*
       * One probe in the project: no picker to open for the only entry in
       * it (#7985) - the dialog says which probe runs the check, and Run
       * Test runs it there.
       */}
      {showTestModal && onlyProbe ? (
        <Modal
          title={"Test Monitor"}
          description={MONITOR_TEST_WORDS.description}
          onClose={() => {
            return setShowTestModal(false);
          }}
          onSubmit={() => {
            void processResult(new ObjectID(onlyProbe._id!.toString()));
          }}
          submitButtonText="Run Test"
          submitButtonStyleType={ButtonStyleType.PRIMARY}
        >
          <p
            className="text-sm text-gray-700"
            data-testid="test-monitor-only-probe"
          >
            <TranslatedSentence
              template={MONITOR_TEST_WORDS.onlyProbe}
              slots={{
                // A probe's name is its owner's, drawn as written.
                probe: (
                  <span className="font-medium text-gray-900" dir="auto">
                    {onlyProbe.name?.toString() || ""}
                  </span>
                ),
              }}
            />
          </p>
        </Modal>
      ) : (
        <></>
      )}

      {showTestModal && !onlyProbe ? (
        <BasicFormModal
          title={"Test Monitor"}
          description={MONITOR_TEST_WORDS.description}
          onClose={() => {
            return setShowTestModal(false);
          }}
          onSubmit={async (data: JSONObject) => {
            await processResult(new ObjectID(String(data["probe"])));
          }}
          submitButtonText="Run Test"
          submitButtonStyleType={ButtonStyleType.PRIMARY}
          formProps={{
            /*
             * Starts on a probe that checks this monitor (#7985): the
             * first the form or the monitor has.
             */
            initialValues: startingProbeId ? { probe: startingProbeId } : {},
            fields: [
              {
                field: {
                  probe: true,
                },
                title: MONITOR_TEST_WORDS.probeTitle,
                description: MONITOR_TEST_WORDS.probeDescription,
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
      ) : (
        <></>
      )}

      {showResultModal && (
        <Modal
          title="Monitor Test Result"
          description={MONITOR_TEST_WORDS.resultDescription}
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
                  {translator.translateText(
                    "Running monitor test on a probe. This usually takes a minute or two to complete because we need to notify the probe to run the test.",
                  )}
                </div>
              </div>
            )}
            {monitorStepProbeResponse && (
              <div className="mt-3 space-y-6">
                {/*
                 * What the answer means first (#7074): the criteria it
                 * matched, and what would follow - then what the probe
                 * found, with how each criteria judged it.
                 */}
                {testedDraft ? (
                  <MonitorTestVerdict
                    probeMonitorResponses={resultResponses}
                    draft={testedDraft}
                  />
                ) : (
                  <></>
                )}
                <SummaryInfo
                  monitorType={props.monitorType}
                  probeMonitorResponses={resultResponses}
                  probeName={testedProbeName}
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
