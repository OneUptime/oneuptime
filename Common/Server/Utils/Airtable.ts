import { AirtableApiKey, AirtableBaseId } from "../EnvironmentConfig";
import Dictionary from "../../Types/Dictionary";
import PositiveNumber from "../../Types/PositiveNumber";
import AirtableLib, { FieldSet, Records } from "airtable";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export type AirtableRecords = Records<FieldSet>;

class Airtable {
  private static base = new AirtableLib({ apiKey: AirtableApiKey }).base(
    AirtableBaseId,
  );

  @CaptureSpan()
  public static async find(
    tableName: string,
    airtableView: string,
    limit: PositiveNumber,
  ): Promise<AirtableRecords> {
    return this.base(tableName)
      .select({ view: airtableView, pageSize: limit.toNumber() })
      .firstPage();
  }

  @CaptureSpan()
  public static async update(
    tableName: string,
    id: string,
    fields: Dictionary<string>,
  ): Promise<void> {
    await this.base(tableName).update(id, fields);
  }

  @CaptureSpan()
  public static async create(
    tableName: string,
    fields: Dictionary<string>,
  ): Promise<void> {
    await this.base(tableName).create(fields);
  }

  @CaptureSpan()
  public static async delete(tableName: string, id: string): Promise<void> {
    await this.base(tableName).destroy(id);
  }
}

export default Airtable;
