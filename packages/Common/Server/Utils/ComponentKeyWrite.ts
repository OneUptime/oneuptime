import { isShippedSecretValue } from "../EnvironmentConfig";
import BadDataException from "../../Types/Exception/BadDataException";

/*
 * THE KEY A PROBE, A RUNNER OR AN AI AGENT IS STORED WITH
 *
 * A probe (Probe.key), a Runner (Runner.key) and an AI agent (AIAgent.key)
 * each prove who they are with the key stored on their row. The server makes
 * a random one when a row is created without it, and the people who may
 * manage the component may write one themselves: on create, or as the
 * dashboard's Reset Key does.
 *
 * A value this repository ships (EnvironmentConfig.isShippedSecretValue: a
 * blank key, "secret", or a config.example.env placeholder) is public, so it
 * is never stored as such a key, whoever writes it - a project role through
 * the API, or the server itself. Where a key is presented, a shipped value
 * is refused as well (ProbeService.verifyProbeKey,
 * RunnerService.findByIdAndKey, CodeFixAgentAuth, AIAgentAPI), so a row from
 * before this rule that holds one authenticates nothing until its key is
 * reset.
 */
export default class ComponentKeyWrite {
  /*
   * A create: throws when the key it stores - after the service made one
   * for a create without it - is a value this repository ships, or not text.
   * `component` names the row with its article: "a probe", "a Runner", "an
   * AI agent".
   */
  public static assertCreatedKey(key: unknown, component: string): void {
    if (typeof key !== "string" || isShippedSecretValue(key)) {
      throw new BadDataException(ComponentKeyWrite.refusal(component));
    }
  }

  /*
   * An update: throws when it writes a key, and that key is a value this
   * repository ships or not text. An update that leaves the key out is not
   * held to it, so a row from before this rule can still be edited.
   */
  public static assertUpdatedKey(data: unknown, component: string): void {
    if (!data || typeof data !== "object") {
      return;
    }

    const written: unknown = (data as Record<string, unknown>)["key"];

    if (written === undefined) {
      return;
    }

    ComponentKeyWrite.assertCreatedKey(written, component);
  }

  // What a write that would store a shipped key is told.
  public static refusal(component: string): string {
    return `This key is a value the OneUptime repository ships ("secret", a "please-change-this-to-random-value" placeholder from config.example.env, or a blank key), which is public, so it is not stored as ${component}'s key. Leave the key out to have OneUptime make one, or use a long random value.`;
  }
}
