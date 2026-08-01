import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Input from "Common/UI/Components/Input/Input";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { SESSION_REPLAY_MAX_USER_REF_LENGTH } from "Common/Types/Rum/SessionReplay";

/*
 * "Record this user's next session."
 *
 * The support workflow this serves: a named customer reports a problem you
 * cannot reproduce, so you arm a one-shot target for their user reference
 * and their next visit records from its first event - no waiting for an
 * error to fire the capture trigger.
 *
 * Two honesty constraints shape the UI. First, the server stores only an
 * HMAC of the reference, so there is no way to LIST pending targets - the
 * panel can only answer "is a target pending for THIS reference?", which
 * is why the status readout appears after you type a reference, not
 * before. Second, arming a target is not a guarantee: the user's page
 * must supply the same reference at load time (data-oneuptime-user-ref or
 * the init global - identify() called later is too late for this), and
 * consent gates still apply. The panel copy says so rather than letting
 * "armed" read as "will definitely record".
 */

const TARGET_ROUTE: string = "/telemetry/rum/session-replay/target";

type TargetAction = "set" | "clear" | "status";

const TargetedCapturePanel: FunctionComponent = (): ReactElement => {
  const [applications, setApplications] = useState<Array<RumApplication>>([]);
  const [selectedApplicationId, setSelectedApplicationId] =
    useState<string>("");
  const [userRef, setUserRef] = useState<string>("");
  const [isPending, setIsPending] = useState<boolean | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Same idiom as InstallationTestPanel: the reference input and the
   * application dropdown stay editable while an action is in flight, and
   * both reset isPending so the readout never describes a stale
   * reference. A response from BEFORE such an edit must not land - it
   * would print "Target armed" under a reference it was not armed for.
   */
  const actionGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const loadApplications: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const result: ListResult<RumApplication> =
        await ModelAPI.getList<RumApplication>({
          modelType: RumApplication,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            _id: true,
            name: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      setApplications(result.data);

      if (result.data.length > 0 && result.data[0]?._id) {
        setSelectedApplicationId(result.data[0]._id.toString());
      }
    }, []);

  useEffect(() => {
    loadApplications()
      .catch((err: unknown) => {
        setError(API.getFriendlyMessage(err as HTTPErrorResponse));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [loadApplications]);

  const runAction: (action: TargetAction) => Promise<void> = useCallback(
    async (action: TargetAction): Promise<void> => {
      if (!selectedApplicationId || !userRef.trim()) {
        return;
      }

      actionGenerationRef.current += 1;
      const generation: number = actionGenerationRef.current;

      try {
        setIsBusy(true);
        setError("");

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(TARGET_ROUTE),
            data: {
              rumApplicationId: selectedApplicationId,
              userRef: userRef,
              action: action,
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (generation !== actionGenerationRef.current) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setIsPending(response.data["isPending"] === true);
      } catch (err) {
        if (generation === actionGenerationRef.current) {
          setIsPending(null);
          setError(API.getFriendlyMessage(err as HTTPErrorResponse));
        }
      } finally {
        setIsBusy(false);
      }
    },
    [selectedApplicationId, userRef],
  );

  const dropdownOptions: Array<DropdownOption> = applications.map(
    (application: RumApplication): DropdownOption => {
      return {
        label: application.name || application._id?.toString() || "Unnamed",
        value: application._id?.toString() || "",
      };
    },
  );

  const canAct: boolean =
    !isBusy && Boolean(selectedApplicationId) && userRef.trim().length > 0;

  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-900">
          Record a specific user&apos;s next session
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          Arms a one-shot target for an end-user reference: that user&apos;s
          next visit records from its first event instead of waiting for an
          error. The target expires after 24 hours, and only the reference hash
          is stored. The user&apos;s page must supply the same reference at load
          time (<code>data-oneuptime-user-ref</code> or the init global), and
          consent still applies.
        </p>
      </div>

      <div className="px-5 py-4">
        {isLoading && <ComponentLoader />}

        {!isLoading && applications.length === 0 && !error && (
          <div className="text-sm text-gray-500">
            No RUM applications yet. Create one first, then target a user here.
          </div>
        )}

        {!isLoading && applications.length > 0 && (
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            {dropdownOptions.length > 1 && (
              <div className="w-full md:w-56">
                <div className="mb-1 text-xs font-medium text-gray-700">
                  Application
                </div>
                <Dropdown
                  options={dropdownOptions}
                  value={dropdownOptions.find((option: DropdownOption) => {
                    return option.value === selectedApplicationId;
                  })}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (typeof value === "string") {
                      actionGenerationRef.current += 1;
                      setSelectedApplicationId(value);
                      setIsPending(null);
                    }
                  }}
                />
              </div>
            )}

            <div className="w-full md:flex-1">
              <div className="mb-1 text-xs font-medium text-gray-700">
                End-user reference
              </div>
              <Input
                value={userRef}
                placeholder="user-1234 or jane@example.com"
                onChange={(value: string) => {
                  actionGenerationRef.current += 1;
                  setUserRef(
                    value.slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH),
                  );
                  setIsPending(null);
                }}
              />
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                title="Record next session"
                buttonStyle={ButtonStyleType.PRIMARY}
                disabled={!canAct}
                onClick={() => {
                  void runAction("set");
                }}
              />
              <Button
                title="Check"
                buttonStyle={ButtonStyleType.OUTLINE}
                disabled={!canAct}
                onClick={() => {
                  void runAction("status");
                }}
              />
              <Button
                title="Cancel target"
                buttonStyle={ButtonStyleType.OUTLINE}
                disabled={!canAct}
                onClick={() => {
                  void runAction("clear");
                }}
              />
            </div>
          </div>
        )}

        {error && <div className="mt-3 text-sm text-rose-600">{error}</div>}

        {!error && isPending === true && (
          <div className="mt-3 text-sm text-emerald-700">
            Target armed. The next session that identifies with this reference
            will be recorded (expires in 24 hours).
          </div>
        )}

        {!error && isPending === false && (
          <div className="mt-3 text-sm text-gray-600">
            No target is pending for this reference. Either none was set, it
            expired, or the user&apos;s session already consumed it.
          </div>
        )}
      </div>
    </div>
  );
};

export default TargetedCapturePanel;
