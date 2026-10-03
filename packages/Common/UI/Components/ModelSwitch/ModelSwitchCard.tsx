import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../../Types/BaseDatabase/Select";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Card from "../Card/Card";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import ModelSwitchRow, { ModelSwitchConfirmation } from "./ModelSwitchRow";
import {
  getColumnBooleanDefault,
  isModelSwitchOn,
  ModelSwitchColumn,
} from "./ModelSwitchUtil";
import React, {
  MutableRefObject,
  ReactElement,
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
  // More columns to read along with the switch's, for onLoaded.
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
   * The switch's data-testid (see ModelSwitchRow). The card's body is
   * `${dataTestId}-card`.
   */
  dataTestId: string;
}

const ModelSwitchCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isOn, setIsOn] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Bumped by every read: an answer for a read the card has moved on from
   * (another record, a retry) is dropped.
   */
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const modelIdString: string = props.modelId.toString();

  const fetchItem: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    setIsLoading(true);
    setError("");

    const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

    try {
      const item: TBaseModel | null = await modelAPI.getItem<TBaseModel>({
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

      if (!item) {
        setIsOn(null);
        setError("Item not found");
      } else {
        const value: boolean = isModelSwitchOn({
          stored: (item as unknown as Record<string, unknown>)[props.column],
          defaultValue: getColumnBooleanDefault(
            new props.modelType(),
            props.column,
          ),
          isInverted: props.isInverted,
        });

        setIsOn(value);
        props.onLoaded?.(item);
        props.onChange?.(value);
      }
    } catch (err) {
      if (read !== readRef.current) {
        return;
      }

      setIsOn(null);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchItem();

    return () => {
      readRef.current += 1;
    };
  }, [modelIdString, props.column]);

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
       * status page's Channels and "What your status page shows" cards.
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
              props.onChange?.(value);
            }}
            onSaved={(value: boolean): void => {
              props.onSaved?.(value);
            }}
            dataTestId={props.dataTestId}
          />
        </div>
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
