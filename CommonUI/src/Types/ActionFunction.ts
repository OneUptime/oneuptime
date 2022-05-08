import Action from "./Action";
import ActionPayload from "./ActionPayload";

declare type ActionFunction = (payload: ActionPayload) => Action

export default ActionFunction