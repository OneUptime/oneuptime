import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import RumSessionPin from "Common/Models/DatabaseModels/RumSessionPin";

/*
 * Pin / Unpin for the recording on screen.
 *
 * The honesty rule this component exists to enforce: a pin protects
 * NOTHING until the materializer has copied the recording under pinned
 * retention and stamped materializedAt. Between click and stamp the
 * control says so explicitly — "pin pending" — because telling someone
 * their evidence is safe while the TTL is still live would be worse than
 * no pin feature at all.
 *
 * Three more rules, each the fix for a way the previous version lied by
 * omission:
 *
 *   - A create or delete failure is SHOWN, with the server's message and a
 *     Retry. Swallowing it left a viewer looking at the same "Pin
 *     recording" button after a 403 or a plan limit, with no idea why.
 *   - Only a permission denial hides the control. Any other load failure
 *     (a network blip on page load) keeps it, with a Retry, rather than
 *     removing the feature for the visit.
 *   - Unpin asks first. It drops retention protection from evidence, and a
 *     one-click delete next to a Copy-link button is an accident waiting
 *     to happen.
 *
 * The worker semantics the copy reflects: a pin on a still-recording
 * session is deferred until the recording is finalized (about ten minutes
 * after the last activity); a pin with nothing left to protect is deleted
 * by the worker; after an unpin the protected copies are removed by the
 * hourly reconcile.
 */

export interface ReplayPinControlProps {
  rumApplicationId: ObjectID;
  sessionId: string;
}

export type PinState =
  | { kind: "loading" }
  /* 401/403 on the initial load: the viewer cannot see pins at all. */
  | { kind: "unavailable" }
  /* Any other initial-load failure: retryable. */
  | { kind: "load-error"; message: string }
  | { kind: "not-pinned" }
  | { kind: "pending"; pinId: ObjectID }
  | { kind: "protected"; pinId: ObjectID; expiresAt: Date | null }
  /*
   * The viewer unpinned it here. Distinct from not-pinned so the control can
   * say what happens to the copies next.
   */
  | { kind: "unpinned" }
  /*
   * A reload found the pin gone without the viewer removing it: the worker
   * deleted a pin whose recording had already expired (nothing left to
   * protect). Said out loud rather than silently reverting to "Pin
   * recording", which would invite pinning the same nothing again.
   */
  | { kind: "removed-by-worker" };

/* While a pin is pending, poll for the materializer's stamp. */
export const PENDING_POLL_INTERVAL_MS: number = 15 * 1000;

export const PIN_PENDING_COPY: string =
  "Pin pending - protection starts when the recording ends (about 10 minutes after the last activity)";
export const PIN_REMOVED_COPY: string =
  "Pin removed: the recording had already expired, so there was nothing left to protect";
export const PIN_UNPINNED_COPY: string =
  "Unpinned - the protected copy is removed within an hour and ordinary retention applies again";

function isPermissionDenial(error: unknown): boolean {
  return (
    error instanceof HTTPErrorResponse &&
    (error.statusCode === 401 || error.statusCode === 403)
  );
}

type ActionErrorKind = "pin" | "unpin";

interface ActionError {
  kind: ActionErrorKind;
  message: string;
}

const ReplayPinControl: FunctionComponent<ReplayPinControlProps> = (
  props: ReplayPinControlProps,
): ReactElement => {
  const [state, setState] = useState<PinState>({ kind: "loading" });
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [isConfirmingUnpin, setIsConfirmingUnpin] = useState<boolean>(false);

  const generationRef: React.MutableRefObject<number> = useRef<number>(0);
  /*
   * Set while an unpin this viewer asked for is in flight, so the reload
   * that follows it reports "unpinned" rather than "removed by the worker".
   */
  const isOwnUnpinRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const rumApplicationIdString: string = props.rumApplicationId.toString();

  const load: (generation: number) => Promise<void> = useCallback(
    async (generation: number): Promise<void> => {
      try {
        const result: ListResult<RumSessionPin> =
          await ModelAPI.getList<RumSessionPin>({
            modelType: RumSessionPin,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              rumApplicationId: new ObjectID(rumApplicationIdString),
              sessionId: props.sessionId,
            },
            select: {
              _id: true,
              materializedAt: true,
              expiresAt: true,
            },
            limit: 1,
            skip: 0,
            sort: {},
          });

        if (generation !== generationRef.current) {
          return;
        }

        const pin: RumSessionPin | undefined = result.data[0];
        const wasOwnUnpin: boolean = isOwnUnpinRef.current;
        isOwnUnpinRef.current = false;

        setState((existing: PinState): PinState => {
          if (!pin || !pin.id) {
            if (wasOwnUnpin) {
              return { kind: "unpinned" };
            }

            /*
             * Pending or protected a moment ago, gone now, and not by this
             * viewer's hand: the worker removed it.
             */
            if (existing.kind === "pending" || existing.kind === "protected") {
              return { kind: "removed-by-worker" };
            }

            /* A terminal message stays until the viewer acts. */
            if (
              existing.kind === "unpinned" ||
              existing.kind === "removed-by-worker"
            ) {
              return existing;
            }

            return { kind: "not-pinned" };
          }

          if (pin.materializedAt) {
            return {
              kind: "protected",
              pinId: pin.id,
              expiresAt: pin.expiresAt ? new Date(pin.expiresAt) : null,
            };
          }

          return { kind: "pending", pinId: pin.id };
        });
      } catch (error) {
        if (generation !== generationRef.current) {
          return;
        }

        isOwnUnpinRef.current = false;

        setState((existing: PinState): PinState => {
          /*
           * Only the INITIAL load can downgrade. A permission denial means
           * the viewer cannot see pins at all, and a missing control
           * communicates that better than one that errors on click; any
           * other failure keeps the control with a Retry. A refresh or poll
           * failure keeps the previous state so a pending pin is never
           * stranded without its badge and poll.
           */
          if (existing.kind !== "loading" && existing.kind !== "load-error") {
            return existing;
          }

          if (isPermissionDenial(error)) {
            return { kind: "unavailable" };
          }

          return {
            kind: "load-error",
            message: API.getFriendlyMessage(error),
          };
        });
      }
    },
    [rumApplicationIdString, props.sessionId],
  );

  useEffect(() => {
    generationRef.current += 1;
    void load(generationRef.current);

    return () => {
      generationRef.current += 1;
    };
  }, [load]);

  /* Poll while pending, so "protected" appears without a page refresh. */
  useEffect(() => {
    if (state.kind !== "pending") {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      void load(generationRef.current);
    }, PENDING_POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [state.kind, load]);

  const pin: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsWorking(true);
    setActionError(null);

    try {
      const model: RumSessionPin = new RumSessionPin();
      model.projectId = ProjectUtil.getCurrentProjectId()!;
      model.rumApplicationId = new ObjectID(rumApplicationIdString);
      model.sessionId = props.sessionId;

      await ModelAPI.create<RumSessionPin>({
        model: model,
        modelType: RumSessionPin,
      });

      /*
       * The service treats a duplicate pin as idempotent success, so the
       * reload shows the truth either way.
       */
      await load(generationRef.current);
    } catch (error) {
      setActionError({ kind: "pin", message: API.getFriendlyMessage(error) });
    } finally {
      setIsWorking(false);
    }
  }, [rumApplicationIdString, props.sessionId, load]);

  const unpin: (pinId: ObjectID) => Promise<void> = useCallback(
    async (pinId: ObjectID): Promise<void> => {
      setIsWorking(true);
      setActionError(null);

      try {
        isOwnUnpinRef.current = true;

        await ModelAPI.deleteItem<RumSessionPin>({
          modelType: RumSessionPin,
          id: pinId,
        });

        setIsConfirmingUnpin(false);
        await load(generationRef.current);
      } catch (error) {
        isOwnUnpinRef.current = false;
        setActionError({
          kind: "unpin",
          message: API.getFriendlyMessage(error),
        });
      } finally {
        setIsWorking(false);
      }
    },
    [load],
  );

  const retryLoad: () => void = useCallback((): void => {
    setState({ kind: "loading" });
    generationRef.current += 1;
    void load(generationRef.current);
  }, [load]);

  if (state.kind === "loading" || state.kind === "unavailable") {
    return <></>;
  }

  if (state.kind === "load-error") {
    return (
      <div
        className="inline-flex items-center gap-2"
        data-testid="replay-pin-control"
      >
        <span
          className="text-xs text-red-700"
          data-testid="replay-pin-error"
          title={state.message}
        >
          Could not check whether this recording is pinned: {state.message}
        </span>
        <Button
          title="Retry"
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          dataTestId="replay-pin-retry"
          onClick={retryLoad}
        />
      </div>
    );
  }

  const pinError: ReactElement | null =
    actionError && actionError.kind === "pin" ? (
      <span
        className="text-xs text-red-700"
        data-testid="replay-pin-error"
        title={actionError.message}
      >
        Could not pin: {actionError.message}
      </span>
    ) : null;

  if (
    state.kind === "not-pinned" ||
    state.kind === "unpinned" ||
    state.kind === "removed-by-worker"
  ) {
    return (
      <div
        className="inline-flex items-center gap-2"
        data-testid="replay-pin-control"
      >
        {state.kind === "unpinned" && (
          <span
            className="text-xs text-gray-600"
            data-testid="replay-pin-status"
          >
            {PIN_UNPINNED_COPY}
          </span>
        )}
        {state.kind === "removed-by-worker" && (
          <span
            className="text-xs text-amber-700"
            data-testid="replay-pin-status"
          >
            {PIN_REMOVED_COPY}
          </span>
        )}
        {pinError}
        <Button
          title={pinError ? "Retry pin" : "Pin recording"}
          icon={IconProp.Flag}
          buttonStyle={ButtonStyleType.OUTLINE}
          isLoading={isWorking}
          dataTestId="replay-pin-button"
          tooltip="Keep a copy of this recording past its retention window"
          onClick={(): void => {
            void pin();
          }}
        />
      </div>
    );
  }

  const isProtected: boolean = state.kind === "protected";
  const expiresAt: Date | null =
    state.kind === "protected" ? state.expiresAt : null;

  const badgeTitle: string = isProtected
    ? expiresAt
      ? `A copy of this recording is stored under pinned retention until ${OneUptimeDate.getDateAsFormattedString(expiresAt)}.`
      : "A copy of this recording is stored under pinned retention."
    : "The pin is queued. Until the recording is finalized and the copy is written, this recording is NOT yet protected from retention.";

  return (
    <div
      className="inline-flex items-center gap-2"
      data-testid="replay-pin-control"
    >
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          isProtected
            ? "bg-emerald-50 text-emerald-700"
            : "bg-amber-50 text-amber-700"
        }`}
        title={badgeTitle}
        data-testid="replay-pin-status"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            isProtected ? "bg-emerald-500" : "animate-pulse bg-amber-500"
          }`}
        />
        {isProtected ? "Pinned" : PIN_PENDING_COPY}
      </span>

      {actionError && actionError.kind === "unpin" && !isConfirmingUnpin && (
        <span
          className="text-xs text-red-700"
          data-testid="replay-pin-error"
          title={actionError.message}
        >
          Could not unpin: {actionError.message}
        </span>
      )}

      <Button
        title={
          actionError && actionError.kind === "unpin" ? "Retry unpin" : "Unpin"
        }
        buttonStyle={ButtonStyleType.OUTLINE}
        isLoading={isWorking}
        dataTestId="replay-unpin-button"
        onClick={(): void => {
          setIsConfirmingUnpin(true);
        }}
      />

      {isConfirmingUnpin && (
        <ConfirmModal
          title="Unpin this recording?"
          description={
            isProtected
              ? "The protected copy is removed within an hour and the recording returns to the application's ordinary retention. If that retention has already passed, the recording will be gone."
              : "The pin has not protected anything yet; removing it just cancels the request."
          }
          submitButtonText="Unpin"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isWorking}
          error={
            actionError && actionError.kind === "unpin"
              ? actionError.message
              : undefined
          }
          onClose={(): void => {
            if (!isWorking) {
              setIsConfirmingUnpin(false);
            }
          }}
          onSubmit={(): void => {
            void unpin(state.pinId);
          }}
        />
      )}
    </div>
  );
};

export default ReplayPinControl;
