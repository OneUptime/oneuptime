import PromptText from "../../../../Utils/AI/PromptText";
import ToolResultSerializer from "../Toolbox/Serializer";

/*
 * Text that telemetry, a pipeline or a collector sent - a change's title, a
 * version, an exception's type - as the investigation's starting context
 * gives it to the model: on one line, without embedded data or secrets,
 * held to a length. Whoever sends telemetry chooses this text, so it must
 * not be able to start a line of its own in the prompt.
 */
export function untrustedLine(text: string, maxLength: number): string {
  const oneLine: string = text.replace(/\s+/g, " ").trim();

  return PromptText.field(ToolResultSerializer.redact(oneLine).text, {
    maxLength,
  });
}

// The same, quoted: read as a value, never as words of the prompt.
export function quotedUntrustedLine(text: string, maxLength: number): string {
  return JSON.stringify(untrustedLine(text, maxLength));
}
