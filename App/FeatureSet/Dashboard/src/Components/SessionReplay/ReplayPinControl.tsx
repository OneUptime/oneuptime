import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
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
 */

export interface ReplayPinControlProps {
  rumApplicationId: ObjectID;
  sessionId: string;
}

type PinState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "not-pinned" }
  | { kind: "pending"; pinId: ObjectID }
  | { kind: "protected"; pinId: ObjectID };

/* While a pin is pending, poll for the materializer's stamp. */
const PENDING_POLL_INTERVAL_MS: number = 15 * 1000;

const ReplayPinControl: FunctionComponent<ReplayPinControlProps> = (
  props: ReplayPinControlProps,
): ReactElement => {
  const [state, setState] = useState<PinState>({ kind: "loading" });
  const [isWorking, setIsWorking] = useState<boolean>(false);

  const generationRef: React.MutableRefObject<number> = useRef<number>(0);
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
            },
            limit: 1,
            skip: 0,
            sort: {},
          });

        if (generation !== generationRef.current) {
          return;
        }

        const pin: RumSessionPin | undefined = result.data[0];

        if (!pin || !pin.id) {
          setState({ kind: "not-pinned" });
        } else if (pin.materializedAt) {
          setState({ kind: "protected", pinId: pin.id });
        } else {
          setState({ kind: "pending", pinId: pin.id });
        }
      } catch {
        if (generation === generationRef.current) {
          /*
           * Only the INITIAL load downgrades to unavailable — that failure
           * is most likely a permissions denial, and a missing control
           * communicates it better than a control that errors on click.
           * A refresh or poll failure is just as likely a transient blip,
           * and collapsing to unavailable then would strand a pending pin
           * with no badge and no poll; keeping the previous state lets the
           * next poll tick recover.
           */
          setState((existing: PinState): PinState => {
            return existing.kind === "loading"
              ? { kind: "unavailable" }
              : existing;
          });
        }
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

    try {
      const model: RumSessionPin = new RumSessionPin();
      model.projectId = ProjectUtil.getCurrentProjectId()!;
      model.rumApplicationId = new ObjectID(rumApplicationIdString);
      model.sessionId = props.sessionId;

      await ModelAPI.create<RumSessionPin>({
        model: model,
        modelType: RumSessionPin,
      });
    } catch {
      /*
       * The service treats a duplicate pin as idempotent success, so the
       * reload below shows the truth either way.
       */
    } finally {
      setIsWorking(false);
      void load(generationRef.current);
    }
  }, [rumApplicationIdString, props.sessionId, load]);

  const unpin: (pinId: ObjectID) => Promise<void> = useCallback(
    async (pinId: ObjectID): Promise<void> => {
      setIsWorking(true);

      try {
        await ModelAPI.deleteItem<RumSessionPin>({
          modelType: RumSessionPin,
          id: pinId,
        });
      } catch {
        /* Surfaced by the reload showing the pin still present. */
      } finally {
        setIsWorking(false);
        void load(generationRef.current);
      }
    },
    [load],
  );

  if (state.kind === "loading" || state.kind === "unavailable") {
    return <></>;
  }

  if (state.kind === "not-pinned") {
    return (
      <Button
        title="Pin recording"
        icon={IconProp.Flag}
        buttonStyle={ButtonStyleType.OUTLINE}
        isLoading={isWorking}
        tooltip="Keep this recording past its retention window"
        onClick={(): void => {
          void pin();
        }}
      />
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          state.kind === "protected"
            ? "bg-emerald-50 text-emerald-700"
            : "bg-amber-50 text-amber-700"
        }`}
        title={
          state.kind === "protected"
            ? "A copy of this recording is stored under pinned retention."
            : "The pin is queued. Until the copy is written, this recording is NOT yet protected from retention."
        }
      >
        <span
          className={`h-2 w-2 rounded-full ${
            state.kind === "protected"
              ? "bg-emerald-500"
              : "animate-pulse bg-amber-500"
          }`}
        />
        {state.kind === "protected"
          ? "Pinned"
          : "Pin pending — not yet protected"}
      </span>

      <Button
        title="Unpin"
        buttonStyle={ButtonStyleType.OUTLINE}
        isLoading={isWorking}
        onClick={(): void => {
          void unpin(state.pinId);
        }}
      />
    </div>
  );
};

export default ReplayPinControl;
