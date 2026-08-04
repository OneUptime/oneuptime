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
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
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
    <div className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 ring-1 ring-inset ring-indigo-100">
            <Icon icon={IconProp.User} className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              Record a specific user&apos;s next session
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              A named customer reports something you cannot reproduce. Arm their
              reference here and their next visit records from its first event,
              instead of waiting for an error to fire.
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        {isLoading && <ComponentLoader />}

        {!isLoading && applications.length === 0 && !error && (
          <div className="text-sm text-gray-500">
            No RUM applications yet. Create one first, then target a user here.
          </div>
        )}

        {!isLoading && applications.length > 0 && (
          <div>
            {/*
             * Constrained width and stacked rather than one long row. The
             * previous layout stretched the reference input across the full
             * card and pushed three same-weight buttons into the far right
             * corner, which read as a toolbar rather than as one primary
             * action with two lookups beside it.
             */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              {dropdownOptions.length > 1 && (
                <div className="w-full sm:w-64">
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">
                    Application
                  </label>
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

              <div className="w-full sm:max-w-sm">
                <label className="mb-1.5 block text-xs font-medium text-gray-700">
                  End-user reference
                </label>
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

              <div className="shrink-0">
                <Button
                  title="Record next session"
                  icon={IconProp.Film}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  disabled={!canAct}
                  onClick={() => {
                    void runAction("set");
                  }}
                />
              </div>
            </div>

            {/*
             * The two lookups are deliberately quieter than the primary
             * action and sit on their own line: they are what you reach for
             * after arming a target, not alternatives to arming one.
             */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:cursor-not-allowed disabled:text-gray-400"
                disabled={!canAct}
                onClick={() => {
                  void runAction("status");
                }}
              >
                Check whether a target is pending
              </button>
              <button
                type="button"
                className="text-xs font-medium text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-300"
                disabled={!canAct}
                onClick={() => {
                  void runAction("clear");
                }}
              >
                Cancel target
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
            />
            <div className="text-sm text-rose-700">{error}</div>
          </div>
        )}

        {!error && isPending === true && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
            <Icon
              icon={IconProp.CheckCircle}
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
            />
            <div className="text-sm text-emerald-800">
              Target armed. The next session that identifies with this reference
              will be recorded. It expires in 24 hours.
            </div>
          </div>
        )}

        {!error && isPending === false && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
            />
            <div className="text-sm text-gray-600">
              No target is pending for this reference. Either none was set, it
              expired, or the user&apos;s session already consumed it.
            </div>
          </div>
        )}
      </div>

      {/*
       * The caveats, moved out of the header. Arming a target is not a
       * guarantee and the copy has to keep saying so - but as a footnote
       * somebody reads once, not as a paragraph between them and the
       * input.
       */}
      <div className="border-t border-gray-100 bg-gray-50 px-5 py-3">
        <ul className="space-y-1 text-xs text-gray-500">
          <li>
            The target expires after 24 hours and is consumed by the first
            session that matches it.
          </li>
          <li>
            Only an HMAC of the reference is stored, which is why there is no
            list of pending targets — you can only ask about a reference you
            already know.
          </li>
          <li>
            The user&apos;s page must supply the same reference at load time (
            <code>data-oneuptime-user-ref</code> or the init global). Calling{" "}
            <code>identify()</code> later is too late for this.
          </li>
          <li>Consent gates still apply.</li>
        </ul>
      </div>
    </div>
  );
};

export default TargetedCapturePanel;
