import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import StateMoveUtil, {
  StateMoveRecord,
  StateMoveState,
} from "../../Utils/StateMove";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "./Database/RelationIdUtil";

/*
 * THE SERVER'S TWO ASKS OF THE ONE STATE MOVE RULE (Common/Utils/StateMove):
 * a new row of a record's state timeline, and an update that writes a
 * record's current state. Both are refused with the rule's own sentence,
 * before anything is written. A timeline row is asked whoever creates it -
 * a person in the dashboard, a chat button, the API, Terraform, a workflow
 * or OneUptime itself; an update is asked for everyone but OneUptime, whose
 * own writes of the state follow the record's timeline (see
 * assertUpdateMovesAllowed).
 */

const toId: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return value.toString().trim().toLowerCase();
};

export default class StateMoveCheck {
  /*
   * A new row of a record's state timeline, asked by its timeline service in
   * onBeforeCreate: refused when it would put the record in the state of the
   * row before it, move it back up its list, or put a back-dated row in the
   * state of the row after it. `previousState` is the state of the row
   * before it, with its name and place (null for the record's first row);
   * the state it moves to is read (readNewState) only when there is a place
   * to compare it with - a first row, or a row after a state with no place,
   * has nothing to be compared with but ids.
   */
  public static async assertTimelineRowAllowed(data: {
    record: StateMoveRecord;
    previousState: StateMoveState | null;
    newStateId: ObjectID;
    nextStateId?: ObjectID | null | undefined;
    readNewState: () => Promise<StateMoveState | null>;
    isGroupingRuleReopen?: boolean | undefined;
  }): Promise<void> {
    let newState: StateMoveState = { id: data.newStateId };

    const previous: StateMoveState | null = data.previousState;

    const comparesPlaces: boolean = Boolean(
      previous &&
        toId(previous.id || previous._id) !== toId(data.newStateId) &&
        previous.order !== null &&
        previous.order !== undefined &&
        previous.order !== "",
    );

    if (comparesPlaces) {
      const read: StateMoveState | null = await data.readNewState();

      if (read) {
        newState = {
          id: data.newStateId,
          name: read.name,
          order: read.order,
        };
      }
    }

    const refusal: string | null = StateMoveUtil.getMoveRefusal({
      record: data.record,
      from: previous,
      to: newState,
      nextStateId: data.nextStateId,
      isGroupingRuleReopen: data.isGroupingRuleReopen,
    });

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }

  /*
   * An update that writes a record's current state - under its ID column or
   * its relation (`stateKeys`, the two must agree) - asked by the record's
   * service in onBeforeUpdate, before anything is written. The state it
   * writes is a move of each record it writes, from the state the record is
   * in, and is refused for any of them by the rule a new timeline row is
   * held to: back up the project's list of states, with the sentence the
   * timeline gives. Writing the state a record is in already moves nothing,
   * and is left alone. The rows are those the update writes, read as their
   * service reads them for a check and the update held to them
   * (findRowsAndHold: DatabaseService.findRowsAndHoldUpdateToThem); the
   * project's states are read once per project (getProjectStates). An update
   * that writes no state, or that OneUptime makes (props.isRoot), reads
   * nothing.
   */
  public static async assertUpdateMovesAllowed<TModel extends BaseModel>(data: {
    record: StateMoveRecord;
    updateBy: UpdateBy<TModel>;
    // The ID column first, then the relation.
    stateKeys: Array<string>;
    stateModelName: string;
    findRowsAndHold: (select: Select<TModel>) => Promise<Array<TModel>>;
    getProjectStates: (projectId: ObjectID) => Promise<Array<StateMoveState>>;
  }): Promise<void> {
    const writtenStateId: ObjectID | null = RelationIdUtil.readConsistent(
      data.updateBy.data as unknown as Record<string, unknown>,
      data.stateKeys,
      data.stateModelName,
    );

    /*
     * OneUptime's own writes of the state follow the record's timeline - the
     * column takes the state its latest row holds, after a change, a reopen
     * or a deleted row - and move nothing of their own.
     */
    if (!writtenStateId || data.updateBy.props.isRoot) {
      return;
    }

    const stateColumn: string = data.stateKeys[0]!;

    const rows: Array<TModel> = await data.findRowsAndHold({
      _id: true,
      projectId: true,
      [stateColumn]: true,
    } as unknown as Select<TModel>);

    const statesOfProject: Map<string, Array<StateMoveState>> = new Map<
      string,
      Array<StateMoveState>
    >();

    for (const row of rows) {
      const values: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;

      const currentStateId: string = toId(values[stateColumn]);

      // Writing the state the record is in moves nothing.
      if (!currentStateId || currentStateId === toId(writtenStateId)) {
        continue;
      }

      const projectId: string = toId(values["projectId"]);

      if (!projectId) {
        continue;
      }

      if (!statesOfProject.has(projectId)) {
        statesOfProject.set(
          projectId,
          await data.getProjectStates(new ObjectID(projectId)),
        );
      }

      const states: Array<StateMoveState> = statesOfProject.get(projectId)!;

      const findState: (id: string) => StateMoveState = (
        id: string,
      ): StateMoveState => {
        return (
          states.find((state: StateMoveState): boolean => {
            return toId(state._id || state.id) === id;
          }) || { id: id }
        );
      };

      const refusal: string | null = StateMoveUtil.getMoveRefusal({
        record: data.record,
        from: findState(currentStateId),
        to: findState(toId(writtenStateId)),
      });

      if (refusal) {
        throw new BadDataException(refusal);
      }
    }
  }
}
