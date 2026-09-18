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
import ObjectID from "Common/Types/ObjectID";
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
import PermissionUtil from "Common/UI/Utils/Permission";
import User from "Common/UI/Utils/User";
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
 * must supply the same reference AT LOAD TIME (data-oneuptime-user-ref or
 * the init global); an identify() call later in the session is too late
 * for the one-shot, though it still makes the session searchable by user:.
 * Consent gates still apply. The panel copy says so rather than letting
 * "armed" read as "will definitely record".
 *
 * Given a rumApplicationId it targets that application and hides the
 * picker; the application's own Replay Policy page mounts it that way.
 */

const TARGET_ROUTE: string = "/telemetry/rum/session-replay/target";

type TargetAction = "set" | "clear" | "status";

/*
 * The route requires EDIT on the application (arming a recording of a
 * named person is a capture-policy write), so the form is only shown to
 * people who can use it. Everyone else gets the reason, not a form that
 * fails after they have typed.
 */
export function canArmTargetedCapture(): boolean {
  try {
    return (
      User.isMasterAdmin() ||
      new RumApplication().hasUpdatePermissions(
        PermissionUtil.getAllPermissions(),
      )
    );
  } catch {
    return false;
  }
}

/* The reference exactly as the recorder will compare it: trimmed, NFC. */
export function normalizeUserRef(value: string): string {
  const trimmed: string = value.trim();

  try {
    return trimmed
      .normalize("NFC")
      .slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH);
  } catch {
    return trimmed.slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH);
  }
}

export interface ComponentProps {
  rumApplicationId?: ObjectID | string | undefined;
}

const TargetedCapturePanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const pinnedApplicationId: string | null = props.rumApplicationId
    ? props.rumApplicationId.toString()
    : null;

  const [applications, setApplications] = useState<Array<RumApplication>>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string>(
    pinnedApplicationId ?? "",
  );
  const [userRef, setUserRef] = useState<string>("");
  const [isPending, setIsPending] = useState<boolean | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(
    pinnedApplicationId === null,
  );
  const [error, setError] = useState<string>("");

  const canArm: boolean = canArmTargetedCapture();

  /*
   * Same idiom as the health poller: the reference input and the
   * application dropdown stay editable while an action is in flight, and
   * both reset isPending so the readout never describes a stale
   * reference. A response from BEFORE such an edit must not land - it
   * would print "Target armed" under a reference it was not armed for -
   * and (settings-setup-13) neither may its `finally`, which used to
   * re-enable the buttons while a newer request was still in flight.
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

  useEffect((): void => {
    if (pinnedApplicationId !== null) {
      setSelectedApplicationId(pinnedApplicationId);
      setIsLoading(false);
      return;
    }

    loadApplications()
      .catch((err: unknown): void => {
        setError(API.getFriendlyMessage(err as HTTPErrorResponse));
      })
      .finally((): void => {
        setIsLoading(false);
      });
  }, [pinnedApplicationId, loadApplications]);

  const normalizedUserRef: string = normalizeUserRef(userRef);

  const runAction: (action: TargetAction) => Promise<void> = useCallback(
    async (action: TargetAction): Promise<void> => {
      if (!selectedApplicationId || normalizedUserRef.length === 0) {
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
              /*
               * settings-setup-13: the server HMACs the string as given and
               * the recorder compares data-oneuptime-user-ref verbatim, so
               * "jane@example.com " with a pasted trailing space armed a
               * target that could never match.
               */
              userRef: normalizedUserRef,
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
      } catch (err: unknown) {
        if (generation === actionGenerationRef.current) {
          setIsPending(null);
          setError(API.getFriendlyMessage(err as HTTPErrorResponse));
        }
      } finally {
        if (generation === actionGenerationRef.current) {
          setIsBusy(false);
        }
      }
    },
    [selectedApplicationId, normalizedUserRef],
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
    canArm &&
    !isBusy &&
    Boolean(selectedApplicationId) &&
    normalizedUserRef.length > 0;

  const hasApplication: boolean =
    pinnedApplicationId !== null || applications.length > 0;

  return (
    <div
      className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid="targeted-capture-panel"
    >
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
              reference here and their next page load that supplies it records
              from its first event, instead of waiting for an error to fire.
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        {isLoading && <ComponentLoader />}

        {!isLoading && !canArm && (
          <div
            className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
            data-testid="targeted-capture-no-permission"
          >
            <Icon
              icon={IconProp.Lock}
              className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
            />
            <div className="text-sm text-gray-600">
              Arming a recording of a named person is a capture-policy change,
              so it needs the Edit RUM Application permission (project owners,
              admins and telemetry admins have it). Ask a project admin to arm
              the target for you.
            </div>
          </div>
        )}

        {!isLoading && canArm && !hasApplication && !error && (
          <div className="text-sm text-gray-500">
            No RUM applications yet. Create one first, then target a user here.
          </div>
        )}

        {!isLoading && canArm && hasApplication && (
          <div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              {pinnedApplicationId === null && dropdownOptions.length > 1 && (
                <div className="w-full sm:w-64">
                  <label className="mb-1.5 block text-xs font-medium text-gray-700">
                    Application
                  </label>
                  <Dropdown
                    options={dropdownOptions}
                    value={dropdownOptions.find(
                      (option: DropdownOption): boolean => {
                        return option.value === selectedApplicationId;
                      },
                    )}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ): void => {
                      if (typeof value === "string") {
                        actionGenerationRef.current += 1;
                        setSelectedApplicationId(value);
                        setIsPending(null);
                        /* The in-flight request is stale now; nothing current is busy. */
                        setIsBusy(false);
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
                  dataTestId="targeted-capture-user-ref"
                  onChange={(value: string): void => {
                    actionGenerationRef.current += 1;
                    setUserRef(
                      value.slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH),
                    );
                    setIsPending(null);
                    /*
                     * The in-flight request is stale now and its guarded
                     * finally will not clear this, so clear it here: the
                     * person can act again straight away, and the stale
                     * response cannot free the buttons under a newer one.
                     */
                    setIsBusy(false);
                  }}
                  onEnterPress={(): void => {
                    if (canAct) {
                      void runAction("set");
                    }
                  }}
                />
              </div>

              <div className="shrink-0">
                <Button
                  title="Record next session"
                  icon={IconProp.Film}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  disabled={!canAct}
                  dataTestId="targeted-capture-arm"
                  onClick={(): void => {
                    void runAction("set");
                  }}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:cursor-not-allowed disabled:text-gray-400"
                disabled={!canAct}
                data-testid="targeted-capture-status"
                onClick={(): void => {
                  void runAction("status");
                }}
              >
                Check whether a target is pending
              </button>
              <button
                type="button"
                className="text-xs font-medium text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-300"
                disabled={!canAct}
                data-testid="targeted-capture-clear"
                onClick={(): void => {
                  void runAction("clear");
                }}
              >
                Cancel target
              </button>
            </div>
          </div>
        )}

        {error && (
          <div
            className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2"
            data-testid="targeted-capture-error"
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
            />
            <div className="text-sm text-rose-700">{error}</div>
          </div>
        )}

        {!error && isPending === true && (
          <div
            className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"
            data-testid="targeted-capture-armed"
          >
            <Icon
              icon={IconProp.CheckCircle}
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
            />
            <div className="text-sm text-emerald-800">
              Target armed for <code>{normalizedUserRef}</code>. The next page
              load that supplies this reference at load time will be recorded
              from its first event. It expires in 24 hours.
            </div>
          </div>
        )}

        {!error && isPending === false && (
          <div
            className="mt-4 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
            data-testid="targeted-capture-not-pending"
          >
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

      <div className="border-t border-gray-100 bg-gray-50 px-5 py-3">
        <ul className="space-y-1 text-xs text-gray-500">
          <li>
            The target expires after 24 hours and is consumed by the first
            session that matches it.
          </li>
          <li>
            Only an HMAC of the reference is stored, which is why there is no
            list of pending targets - you can only ask about a reference you
            already know. The reference is compared exactly, after trimming.
          </li>
          <li>
            The user&apos;s page must supply the same reference at load time (
            <code>data-oneuptime-user-ref</code> or the init global) for the
            one-shot to fire. An <code>identify()</code> call later in the
            session is too late for it, but still makes the session searchable
            by <code>user:</code> in the list, with any traits you pass.
          </li>
          <li>Consent gates still apply.</li>
        </ul>
      </div>
    </div>
  );
};

export default TargetedCapturePanel;
