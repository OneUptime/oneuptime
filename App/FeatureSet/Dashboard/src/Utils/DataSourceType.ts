import DataSourceType, {
  DataSourceTypeProps,
  DataSourceTypeUtil,
} from "Common/Types/DataSource/DataSourceType";
import IconProp from "Common/Types/Icon/IconProp";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

export default class DataSourceTypeUIUtil {
  public static getIcon(dataSourceType: DataSourceType): IconProp {
    switch (dataSourceType) {
      case DataSourceType.Prometheus:
        return IconProp.Graph;
      case DataSourceType.PostgreSQL:
      case DataSourceType.MySQL:
      case DataSourceType.MicrosoftSqlServer:
        return IconProp.Database;
      case DataSourceType.ClickHouse:
        return IconProp.Cube;
      case DataSourceType.Loki:
        return IconProp.Logs;
      case DataSourceType.Elasticsearch:
        return IconProp.Search;
      case DataSourceType.RestApi:
        return IconProp.Globe;
      default:
        return IconProp.Database;
    }
  }

  public static dataSourceTypesAsCardSelectOptions(): Array<CardSelectOption> {
    return DataSourceTypeUtil.getAllDataSourceTypes().map(
      (dataSourceType: DataSourceType): CardSelectOption => {
        const typeProps: DataSourceTypeProps =
          DataSourceTypeUtil.getProps(dataSourceType);

        return {
          value: dataSourceType,
          title: typeProps.title,
          description: typeProps.description,
          icon: DataSourceTypeUIUtil.getIcon(dataSourceType),
        };
      },
    );
  }

  public static dataSourceTypesAsDropdownOptions(): Array<DropdownOption> {
    return DataSourceTypeUtil.getAllDataSourceTypes().map(
      (dataSourceType: DataSourceType): DropdownOption => {
        return {
          value: dataSourceType,
          label: DataSourceTypeUtil.getProps(dataSourceType).title,
        };
      },
    );
  }
}
