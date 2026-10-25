import { jest } from "@jest/globals";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
  PermissionGateOptions,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

/*
 * An event header shows its state buttons only to a reader the permission
 * snapshot says may add a row to the record's state timeline
 * (EventStatusPanel's stateChangeGate); before the snapshot has landed it
 * shows none. A suite that drives the buttons, rather than who may press
 * them, lets the reader change the state and leaves every other gate - an
 * alert's Declare Incident, say - to the snapshot it sets up itself.
 *
 * Call it in a beforeEach: a suite that restores its mocks after each test
 * restores this one too.
 */

const STATE_TIMELINE_TABLE: RegExp = /StateTimeline$/;

export function allowStateChanges(): void {
  const realCheck: typeof PermissionGate.check =
    PermissionGate.check.bind(PermissionGate);

  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (
        model: PermissionCheckableModel,
        action: ModelAction,
        options?: PermissionGateOptions | undefined,
      ): PermissionGateResult => {
        if (
          action === ModelAction.Create &&
          STATE_TIMELINE_TABLE.test(model.constructor.name)
        ) {
          return { isAllowed: true };
        }

        return realCheck(model, action, options);
      },
    );
}
