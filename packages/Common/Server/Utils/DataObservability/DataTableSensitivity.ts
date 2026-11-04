import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import Search from "../../../Types/BaseDatabase/Search";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "../../../Types/DataObservability/DataAssetColumn";
import {
  DataColumnSensitivity,
  readColumnSensitivities,
} from "../../../Types/DataObservability/DataColumnSensitivity";
import { isFindingCounted } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import ObjectID from "../../../Types/ObjectID";
import DataAssetService from "../../Services/DataAssetService";
import DataStoreFindingService from "../../Services/DataStoreFindingService";

// The most findings read for one table. A table has far fewer columns than this.
const MAX_FINDINGS_PER_TABLE: number = 1000;

/*
 * What Data Security knows each of a table's columns holds, for the table's
 * Columns tab and the checks it suggests. It names data types and never a
 * sample of the values, which stay on Data Security's own pages.
 */
export default class DataTableSensitivity {
  public static async read(data: {
    projectId: ObjectID;
    dataAssetId: ObjectID;
  }): Promise<Array<DataColumnSensitivity>> {
    const asset: DataAsset | null = await DataAssetService.findOneBy({
      query: { projectId: data.projectId, _id: data.dataAssetId },
      select: {
        name: true,
        schemaName: true,
        dataStoreId: true,
        columns: true,
      },
      props: { isRoot: true },
    });

    if (!asset?.name || !asset.dataStoreId) {
      return [];
    }

    const findings: Array<DataStoreFinding> =
      await DataStoreFindingService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: asset.dataStoreId,
          // The location starts with the table's name, in any case: it is worked out below.
          location: new Search(`${asset.name}.`),
        },
        select: {
          location: true,
          dataTypeId: true,
          dataTypeName: true,
          sensitivity: true,
          matchCount: true,
          isConfirmed: true,
          isSuppressed: true,
          isAiSuggested: true,
        },
        skip: 0,
        limit: MAX_FINDINGS_PER_TABLE,
        props: { isRoot: true },
      });
    const columns: Array<DataAssetColumn> = readDataAssetColumns(asset.columns);

    return readColumnSensitivities({
      schemaName: asset.schemaName,
      tableName: asset.name,
      columns,
      findings: findings.filter(isFindingCounted),
    });
  }
}
