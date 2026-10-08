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
  ModelSwitchChild,
  ModelSwitchColumn,
} from "./ModelSwitchUtil";
import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCardRuledListClassName } from "../Card/CardSurface";

/*
 * A card of switches for one record: the card's title and the line under
 * it, then one row per yes-or-no setting, each its own boolean column and
 * each saving the moment it is flipped (ModelSwitchRow). It is what a card
 * becomes whose Edit dialog held nothing but switches - "Investigate new
 * incidents", "Draft a postmortem when an incident resolves" - so that
 * every one of them took Edit, flip, Save, and a wizard when there were
 * enough of them.
 *
 * ModelSwitchCard is the one-switch card; this is its twin for a list. Both
 * read the record the same way:
 *
 * - once, for every switch's column (and any `select` the page wants
 *   alongside them, handed to onLoaded), showing a loader while it reads
 *   and why a read failed, with a way to try again;
 * - a column the record never had set reads as its model's default.
 *
 * Each row keeps its own state from there: it saves only its own column,
 * locks for someone who may not change that column (its own update
 * permissions, as well as the record's), names the plan it needs, asks
 * first where the page says so, moves back with the server's reason when a
 * save is refused, and follows a save of its column made anywhere else on
 * the screen (ModelSwitchEvents).
 *
 * A switch can have switches of its own (`children`): the pull requests
 * OneUptime AI opens, under "Fix new incidents automatically". They are
 * drawn under its name, hanging from it, only while it is on - with it off
 * they would change nothing - and they turn on with it and off with it, in
 * the same save as its own column (ModelSwitchRow's childSwitches). While
 * it is on, each one is flipped on its own.
 */

// A switch on the card, or one under another switch.
export interface ModelSwitchesCardChildSwitch<TBaseModel extends BaseModel> {
  column: ModelSwitchColumn<TBaseModel>;
  // The switch's name and its sentences, in English, as on ModelSwitchRow.
  title: string;
  getDescription?: ((isOn: boolean) => string | undefined) | undefined;
  note?: string | undefined;
  isInverted?: boolean | undefined;
  getConfirmation?:
    | ((isTurningOn: boolean) => ModelSwitchConfirmation | undefined)
    | undefined;
  /*
   * The switch's data-testid. Its row is `${dataTestId}-row` and its
   * "Saved" status `${dataTestId}-status`.
   */
  dataTestId: string;
}

export interface ModelSwitchesCardSwitch<TBaseModel extends BaseModel>
  extends ModelSwitchesCardChildSwitch<TBaseModel> {
  /*
   * The switches that belong to this one, in the order they are drawn under
   * it (`${dataTestId}-children`). One level: they have none of their own.
   */
  children?: Array<ModelSwitchesCardChildSwitch<TBaseModel>> | undefined;
}

// Every switch of the card, in drawn order: each followed by the ones under it.
export const getModelSwitchesInOrder: <TBaseModel extends BaseModel>(
  switches: Array<ModelSwitchesCardSwitch<TBaseModel>>,
) => Array<ModelSwitchesCardChildSwitch<TBaseModel>> = <
  TBaseModel extends BaseModel,
>(
  switches: Array<ModelSwitchesCardSwitch<TBaseModel>>,
): Array<ModelSwitchesCardChildSwitch<TBaseModel>> => {
  return switches.flatMap(
    (
      definition: ModelSwitchesCardSwitch<TBaseModel>,
    ): Array<ModelSwitchesCardChildSwitch<TBaseModel>> => {
      return [definition, ...(definition.children || [])];
    },
  );
};

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  // The card's title and the line under it, in English.
  cardTitle: string;
  cardDescription?: string | ReactElement | undefined;
  // The switches, in the order they are drawn.
  switches: Array<ModelSwitchesCardSwitch<TBaseModel>>;
  // ModelAPI when left out; the admin dashboard passes AdminModelAPI.
  modelAPI?: typeof ModelAPI | undefined;
  // More columns to read along with the switches', for onLoaded.
  select?: Select<TBaseModel> | undefined;
  // Told what was read, each time the record is read.
  onLoaded?: ((item: TBaseModel) => void) | undefined;
  /*
   * Told whether a switch is on: once the record is read (for every
   * switch), whenever one moves, and again if a change is refused and it
   * moves back.
   */
  onChange?:
    | ((column: ModelSwitchColumn<TBaseModel>, isOn: boolean) => void)
    | undefined;
  // Told after a change is saved, with the switch and whether it is now on.
  onSaved?:
    | ((column: ModelSwitchColumn<TBaseModel>, isOn: boolean) => void)
    | undefined;
  // The card body's data-testid.
  dataTestId: string;
}

// Where each switch is, by column: as read, then as each one moves.
type SwitchPositions = Record<string, boolean>;

const ModelSwitchesCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const [positions, setPositions] = useState<SwitchPositions | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Bumped by every read: an answer for a read the card has moved on from
   * (another record, a retry) is dropped.
   */
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const modelIdString: string = props.modelId.toString();

  // Every switch, the ones under another switch too.
  const allSwitches: Array<ModelSwitchesCardChildSwitch<TBaseModel>> =
    getModelSwitchesInOrder(props.switches);

  // The columns, as one string, so a new array of the same switches is no change.
  const columnsKey: string = allSwitches
    .map((definition: ModelSwitchesCardChildSwitch<TBaseModel>): string => {
      return definition.column;
    })
    .join(",");

  const fetchItem: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    setIsLoading(true);
    setError("");

    const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

    const select: Record<string, unknown> = {
      ...((props.select || {}) as Record<string, unknown>),
    };

    for (const definition of allSwitches) {
      select[definition.column] = true;
    }

    try {
      const item: TBaseModel | null = await modelAPI.getItem<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: select as Select<TBaseModel>,
      });

      if (read !== readRef.current) {
        return;
      }

      if (!item) {
        setPositions(null);
        setError("Item not found");
      } else {
        const model: TBaseModel = new props.modelType();
        const readPositions: SwitchPositions = {};

        for (const definition of allSwitches) {
          readPositions[definition.column] = isModelSwitchOn({
            stored: (item as unknown as Record<string, unknown>)[
              definition.column
            ],
            defaultValue: getColumnBooleanDefault(model, definition.column),
            isInverted: definition.isInverted,
          });
        }

        setPositions(readPositions);
        props.onLoaded?.(item);

        for (const definition of allSwitches) {
          props.onChange?.(
            definition.column,
            Boolean(readPositions[definition.column]),
          );
        }
      }
    } catch (err) {
      if (read !== readRef.current) {
        return;
      }

      setPositions(null);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchItem();

    return () => {
      readRef.current += 1;
    };
  }, [modelIdString, columnsKey]);

  /*
   * Where a switch is now: the rows under a switch come and go with it, and
   * each comes back where it was last left - or on, once the switch it
   * belongs to was turned on.
   */
  const remember: (column: string, isOn: boolean) => void = (
    column: string,
    isOn: boolean,
  ): void => {
    setPositions(
      (current: SwitchPositions | null): SwitchPositions | null => {
        return current ? { ...current, [column]: isOn } : current;
      },
    );
  };

  const renderRow: (data: {
    definition: ModelSwitchesCardChildSwitch<TBaseModel>;
    initialValue: boolean;
    children?: Array<ModelSwitchesCardChildSwitch<TBaseModel>> | undefined;
  }) => ReactElement = (data: {
    definition: ModelSwitchesCardChildSwitch<TBaseModel>;
    initialValue: boolean;
    children?: Array<ModelSwitchesCardChildSwitch<TBaseModel>> | undefined;
  }): ReactElement => {
    const definition: ModelSwitchesCardChildSwitch<TBaseModel> =
      data.definition;
    const children: Array<ModelSwitchesCardChildSwitch<TBaseModel>> =
      data.children || [];

    return (
      <ModelSwitchRow<TBaseModel>
        /*
         * Keyed on the record too, so a switch read for one record never
         * shows on the next one's card.
         */
        key={`${modelIdString}-${definition.column}`}
        modelType={props.modelType}
        modelId={props.modelId}
        column={definition.column}
        initialValue={data.initialValue}
        title={definition.title}
        getDescription={definition.getDescription}
        note={definition.note}
        isInverted={definition.isInverted}
        getConfirmation={definition.getConfirmation}
        modelAPI={props.modelAPI}
        childSwitches={
          children.length > 0
            ? children.map(
                (
                  child: ModelSwitchesCardChildSwitch<TBaseModel>,
                ): ModelSwitchChild => {
                  return {
                    column: child.column,
                    isInverted: child.isInverted,
                  };
                },
              )
            : undefined
        }
        childrenWhileOn={
          children.length > 0
            ? children.map(
                (
                  child: ModelSwitchesCardChildSwitch<TBaseModel>,
                ): ReactElement => {
                  return renderRow({
                    definition: child,
                    initialValue: Boolean(positions?.[child.column]),
                  });
                },
              )
            : undefined
        }
        onChange={(isOn: boolean): void => {
          remember(definition.column, isOn);
          props.onChange?.(definition.column, isOn);
        }}
        onSaved={(isOn: boolean): void => {
          // The switches under it were saved with it, set the same way.
          for (const child of children) {
            remember(child.column, isOn);
            props.onChange?.(child.column, isOn);
            props.onSaved?.(child.column, isOn);
          }

          props.onSaved?.(definition.column, isOn);
        }}
        dataTestId={definition.dataTestId}
      />
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !positions) {
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
       * Full-bleed rows, ruled like the card's own header rule, as on the
       * project's Notification Channels card and the status page's "What
       * your status page shows".
       */
      <div className={ruledListClassName}>
        {props.switches.map(
          (definition: ModelSwitchesCardSwitch<TBaseModel>): ReactElement => {
            return (
              <div
                className="px-5 py-4 md:px-6"
                /*
                 * Keyed on the record too, so a switch read for one record
                 * never shows on the next one's card.
                 */
                key={`${modelIdString}-${definition.column}`}
              >
                {renderRow({
                  definition: definition,
                  initialValue: Boolean(positions[definition.column]),
                  children: definition.children,
                })}
              </div>
            );
          },
        )}
      </div>
    );
  };

  return (
    <Card title={props.cardTitle} description={props.cardDescription}>
      <div data-testid={props.dataTestId}>{getBody()}</div>
    </Card>
  );
};

export default ModelSwitchesCard;
