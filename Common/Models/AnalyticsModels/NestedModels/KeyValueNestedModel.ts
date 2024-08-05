import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import NestedModel from "../AnalyticsBaseModel/NestedModel";

export default class KeyValueNestedModel extends NestedModel {
  public constructor() {
    super({
      tableColumns: [
        new AnalyticsTableColumn({
          key: "key",
          title: "Key",
          description: "Key of the attribute",
          required: true,
          type: TableColumnType.Text,
        }),

        new AnalyticsTableColumn({
          key: "stringValue",
          title: "String Value",
          description: "Key of the attribute",
          required: false,
          type: TableColumnType.Text,
        }),

        new AnalyticsTableColumn({
          key: "numberValue",
          title: "Number Value",
          description: "Value of the attribute",
          required: false,
          type: TableColumnType.Number,
        }),
      ],
    });
  }

  public get key(): string | undefined {
    return this.getColumnValue("key");
  }

  public set key(v: string | undefined) {
    this.setColumnValue("key", v);
  }

  public get stringValue(): string | undefined {
    return this.getColumnValue("stringValue");
  }

  public set stringValue(v: string | undefined) {
    this.setColumnValue("stringValue", v);
  }

  public get numberValue(): number | undefined {
    return this.getColumnValue("numberValue");
  }

  public set numberValue(v: number | undefined) {
    this.setColumnValue("numberValue", v);
  }
}
