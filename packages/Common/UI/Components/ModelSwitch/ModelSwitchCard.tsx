import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../../Types/BaseDatabase/Select";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Card from "../Card/Card";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import { subscribeToModelSwitchSaved } from "./ModelSwitchEvents";
import ModelSwitchRow, { ModelSwitchConfirmation } from "./ModelSwitchRow";
import {
  getColumnBooleanDefault,
  isModelSwitchOn,
  ModelSwitchColumn,
} from "./ModelSwitchUtil";
import React, {
  MutableRefObject,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A card that is one switch: the card's title and the line under it, then
 * the switch, which saves its column the moment it is flipped
 * (ModelSwitchRow). It is what a card with an Edit button whose dialog held
 * a single switch becomes.
 *
 * It reads the record once, for the switch's column (and any `select` the
 * page wants alongside it, handed to onLoaded). While it reads it shows a
 * loader; a failed read shows why, with a way to try again; a column the
 * record never had set reads as its model's default.
 *
 * Read-only lines can sit under the switch (getDetails): what the switch
 * decides and the server works out from it, such as when an incident's next
 * reminder goes out. They are drawn from the record and from where the
 * switch is now, so they move with it, and the record is read again -
 * quietly, without the loader - each time the column is saved, here or
 * anywhere else on the screen, so what the server worked out shows without
 * a reload.
 */

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  column: ModelSwitchColumn<TBaseModel>;
  // The card's title and the line under it, in English.
  cardTitle: string;
  cardDescription?: string | ReactElement | undefined;
  // The switch's own name and its sentence, as on ModelSwitchRow.
  title: string;
  getDescription?: ((isOn: boolean) => string | undefined) | undefined;
  note?: string | undefined;
  isInverted?: boolean | undefined;
  getConfirmation?:
    | ((isTurningOn: boolean) => ModelSwitchConfirmation | undefined)
    | undefined;
  modelAPI?: typeof ModelAPI | undefined;
  // More columns to read along with the switch's, for onLoaded and getDetails.
  select?: Select<TBaseModel> | undefined;
  // Told what was read, each time the record is read.
  onLoaded?: ((item: TBaseModel) => void) | undefined;
  /*
   * Told whether the switch is on: once the record is read, whenever the
   * switch moves, and again if a change is refused and it moves back.
   */
  onChange?: ((isOn: boolean) => void) | undefined;
  onSaved?: ((isOn: boolean) => void) | undefined;
  /*
   * Read-only lines under the switch, inside the card, from the record as
   * last read (with `select` for their columns) and whether the switch is on
   * now. With it, the record is read again after every save of the column.
   */
  getDetails?: ((item: TBaseModel, isOn: boolean) => ReactNode) | undefined;
  /*
   * The switch's data-testid (see ModelSwitchRow). The card's body is
   * `${dataTestId}-card`, and the lines under the switch
   * `${dataTestId}-details`.
   */
  dataTestId: string;
  /*
   * The record, already read by the page with the switch's column (and any
   * `select`): the card starts from it instead of reading it again. Used
   * only while it is the card's record.
   */
  initialItem?: TBaseModel | undefined;
  // See ModelSwitchRow.
  locksWhenPlanNeeded?: boolean | undefined;
  lockedReason?: string | undefined;
}

interface ReadOptions {
  /*
   * A read after a save: the switch and its lines stay on screen while it
   * runs, and a failure leaves them as they were rather than replacing the
   * card with an error - the switch itself already said whether the save
   * went through.
   */
  isQuiet?: boolean | undefined;
}

const ModelSwitchCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isOn, setIsOn] = useState<boolean | null>(null);
  const [item, setItem] = useState<TBaseModel | null>(null);
  /*
   * Where the switch is now, for the lines under it: it moves the moment it
   * is pressed, before its save is back.
   */
  const [isSwitchOn, setIsSwitchOn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Bumped by every read: an answer for a read the card has moved on from
   * (another record, a retry, a newer save) is dropped.
   */
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const modelIdString: string = props.modelId.toString();

  // Shows a record read here, or handed in by the page (initialItem).
  const showItem: (readItem: TBaseModel) => void = (
    readItem: TBaseModel,
  ): void => {
    const value: boolean = isModelSwitchOn({
      stored: (readItem as unknown as Record<string, unknown>)[props.column],
      defaultValue: getColumnBooleanDefault(
        new props.modelType(),
        props.column,
      ),
      isInverted: props.isInverted,
    });

    setIsOn(value);
    setIsSwitchOn(value);
    setItem(readItem);
    props.onLoaded?.(readItem);
    props.onChange?.(value);
  };

  const fetchItem: (options?: ReadOptions) => Promise<void> = async (
    options?: ReadOptions,
  ): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    const isQuiet: boolean = Boolean(options?.isQuiet);

    if (!isQuiet) {
      setIsLoading(true);
      setError("");
    }

    const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

    try {
      const readItem: TBaseModel | null = await modelAPI.getItem<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: {
          ...(props.select || {}),
          [props.column]: true,
        } as Select<TBaseModel>,
      });

      if (read !== readRef.current) {
        return;
      }

      if (isQuiet) {
        // The switch has the last word on where it is; the lines follow it.
        if (readItem) {
          setItem(readItem);
          props.onLoaded?.(readItem);
        }

        return;
      }

      if (!readItem) {
        setIsOn(null);
        setItem(null);
        setError("Item not found");
      } else {
        showItem(readItem);
      }
    } catch (err) {
      if (read !== readRef.current || isQuiet) {
        return;
      }

      setIsOn(null);
      setItem(null);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  // The latest render's read, for the subscription below.
  const fetchItemRef: MutableRefObject<
    (options?: ReadOptions) => Promise<void>
  > = useRef<(options?: ReadOptions) => Promise<void>>(fetchItem);
  fetchItemRef.current = fetchItem;

  useEffect(() => {
    // A record the page already read for this card needs no second read.
    if (
      props.initialItem &&
      props.initialItem.id?.toString() === modelIdString
    ) {
      showItem(props.initialItem);
      setError("");
      setIsLoading(false);
    } else {
      void fetchItem();
    }

    return () => {
      readRef.current += 1;
    };
  }, [modelIdString, props.column]);

  const hasDetails: boolean = Boolean(props.getDetails);

  useEffect(() => {
    if (!hasDetails) {
      return;
    }

    /*
     * Every save of the column, the switch's own included (it announces
     * them), changes what the lines under it say once the server has worked
     * it out: read the record again.
     */
    return subscribeToModelSwitchSaved({
      modelType: props.modelType,
      modelId: props.modelId,
      column: props.column,
      onSaved: (): void => {
        void fetchItemRef.current({ isQuiet: true });
      },
    });
  }, [props.modelType, modelIdString, props.column, hasDetails]);

  const getDetails: () => ReactElement = (): ReactElement => {
    if (!props.getDetails || !item) {
      return <></>;
    }

    return (
      <div
        className="border-t border-gray-200 px-5 py-4 md:px-6"
        data-testid={`${props.dataTestId}-details`}
      >
        {props.getDetails(item, isSwitchOn)}
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || isOn === null) {
      return (
        <ErrorMessage
          message={error || "Item not found"}
          onRefreshClick={() => {
            void fetchItem();
          }}
        />
      );
    }

    return (
      /*
       * A full-bleed row, ruled like the card's own header rule, as on the
       * status page's Channels and "What your status page shows" cards. The
       * lines under the switch, if any, are a row of their own below it.
       */
      <div className="-mx-5 -mb-6 border-t border-gray-200 md:-mx-6">
        <div className="px-5 py-4 md:px-6">
          <ModelSwitchRow<TBaseModel>
            /*
             * Keyed on the record, so a switch read for one record never
             * shows on the next one's card.
             */
            key={modelIdString}
            modelType={props.modelType}
            modelId={props.modelId}
            column={props.column}
            initialValue={isOn}
            title={props.title}
            getDescription={props.getDescription}
            note={props.note}
            isInverted={props.isInverted}
            getConfirmation={props.getConfirmation}
            modelAPI={props.modelAPI}
            onChange={(value: boolean): void => {
              setIsSwitchOn(value);
              props.onChange?.(value);
            }}
            onSaved={(value: boolean): void => {
              props.onSaved?.(value);
            }}
            dataTestId={props.dataTestId}
            locksWhenPlanNeeded={props.locksWhenPlanNeeded}
            lockedReason={props.lockedReason}
          />
        </div>
        {getDetails()}
      </div>
    );
  };

  return (
    <Card title={props.cardTitle} description={props.cardDescription}>
      <div data-testid={`${props.dataTestId}-card`}>{getBody()}</div>
    </Card>
  );
};

export default ModelSwitchCard;
