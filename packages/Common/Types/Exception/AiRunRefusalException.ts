import BadDataExceptionWithDetails from "./BadDataExceptionWithDetails";
import {
  AI_RUN_REFUSAL_CODE_FIELD,
  AiRunRefusalCode,
  getAiRunRefusalMessage,
} from "../AI/AiRunRefusal";

/*
 * OneUptime AI did not start a run someone asked for (#7359): bad data
 * (400) whose message is the refusal's English sentence, for the API and
 * older Dashboards, with its code beside it -
 * { message: "...", refusalCode: "ai_off" } - for the Dashboard to word
 * in the reader's language.
 */
export default class AiRunRefusalException extends BadDataExceptionWithDetails {
  public readonly refusalCode: AiRunRefusalCode;

  public constructor(refusalCode: AiRunRefusalCode) {
    super(getAiRunRefusalMessage(refusalCode), {
      [AI_RUN_REFUSAL_CODE_FIELD]: refusalCode,
    });
    this.refusalCode = refusalCode;
  }
}
