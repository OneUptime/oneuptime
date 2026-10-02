import MeasurementDefinitionValidator from "./MeasurementDefinitionValidator";
import BadDataException from "../../../Types/Exception/BadDataException";
import { generateMeasurementKey } from "../../../Types/Measurement/MeasurementKey";

/*
 * The key a new incident, alert or scheduled maintenance measurement is
 * created with. Shared by the three measurement services.
 *
 * A key is never required. Left out - by the dashboard, which only sends one
 * someone typed, by an API client or by Terraform - it is made from the name
 * ("Time to Detect" -> "time-to-detect"), with -2, -3 and so on added when
 * another measurement of the project already has it. A key that is sent is
 * kept exactly as sent, or refused: it must be a valid key, and no other
 * measurement of the project may have it. Refused rather than renumbered,
 * because whoever typed it is going to look for that metric name.
 */
export default class MeasurementKeyAssigner {
  public static async getKeyForCreate(data: {
    // What the create asked for, if anything.
    key: string | undefined | null;
    name: string | undefined | null;
    /*
     * The keys the project's measurements (of the same kind) hold. Read as
     * root by the caller: a key must not clash with one the creator is not
     * allowed to see, or the database's unique index refuses the create.
     */
    getKeysInProject: () => Promise<Array<string>>;
  }): Promise<string> {
    const requestedKey: string = typeof data.key === "string" ? data.key : "";

    if (requestedKey.trim().length === 0) {
      return generateMeasurementKey({
        name: typeof data.name === "string" ? data.name : "",
        existingKeys: await data.getKeysInProject(),
      });
    }

    MeasurementDefinitionValidator.validateKey(requestedKey);

    const keysInProject: Array<string> = await data.getKeysInProject();

    if (keysInProject.includes(requestedKey)) {
      throw new BadDataException(
        `Another measurement in this project already has the key "${requestedKey}". Pick a different key, or leave the key out and one is made from the name.`,
      );
    }

    return requestedKey;
  }
}
