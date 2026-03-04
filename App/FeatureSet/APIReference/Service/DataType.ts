import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { CodeExamplesPath, ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import LocalFile from "Common/Server/Utils/LocalFile";
import Dictionary from "Common/Types/Dictionary";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export default class ServiceHandler {
  public static async executeResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const pageData: Dictionary<unknown> = {};

    pageData["selectCode"] = await LocalCache.getOrSetString(
      "data-type",
      "select",
      async () => {
        return await LocalFile.read(`${CodeExamplesPath}/DataTypes/Select.md`);
      },
    );

    pageData["sortCode"] = await LocalCache.getOrSetString(
      "data-type",
      "sort",
      async () => {
        return await LocalFile.read(`${CodeExamplesPath}/DataTypes/Sort.md`);
      },
    );

    pageData["equalToCode"] = await LocalCache.getOrSetString(
      "data-type",
      "equal-to",
      async () => {
        return await LocalFile.read(`${CodeExamplesPath}/DataTypes/EqualTo.md`);
      },
    );

    pageData["equalToOrNullCode"] = await LocalCache.getOrSetString(
      "data-type",
      "equal-to-or-null",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/DataTypes/EqualToOrNull.md`,
        );
      },
    );

    pageData["greaterThanCode"] = await LocalCache.getOrSetString(
      "data-type",
      "greater-than",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/DataTypes/GreaterThan.md`,
        );
      },
    );

    pageData["greaterThanOrEqualCode"] = await LocalCache.getOrSetString(
      "data-type",
      "greater-than-or-equal",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/DataTypes/GreaterThanOrEqual.md`,
        );
      },
    );

    pageData["lessThanCode"] = await LocalCache.getOrSetString(
      "data-type",
      "less-than",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/DataTypes/LessThan.md`,
        );
      },
    );

    pageData["lessThanOrEqualCode"] = await LocalCache.getOrSetString(
      "data-type",
      "less-than-or-equal",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/DataTypes/LessThanOrEqual.md`,
        );
      },
    );

    pageData["includesCode"] = await LocalCache.getOrSetString(
      "data-type",
      "includes",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/DataTypes/Includes.md`,
        );
      },
    );

    pageData["lessThanOrNullCode"] = await LocalCache.getOrSetString(
      "data-type",
      "less-than-or-equal",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/DataTypes/LessThanOrNull.md`,
        );
      },
    );

    pageData["greaterThanOrNullCode"] = await LocalCache.getOrSetString(
      "data-type",
      "less-than-or-equal",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/DataTypes/LessThanOrNull.md`,
        );
      },
    );

    pageData["isNullCode"] = await LocalCache.getOrSetString(
      "data-type",
      "is-null",
      async () => {
        return await LocalFile.read(`${CodeExamplesPath}/DataTypes/IsNull.md`);
      },
    );

    pageData["notNullCode"] = await LocalCache.getOrSetString(
      "data-type",
      "not-null",
      async () => {
        return await LocalFile.read(`${CodeExamplesPath}/DataTypes/NotNull.md`);
      },
    );

    pageData["notEqualToCode"] = await LocalCache.getOrSetString(
      "data-type",
      "not-equals",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/DataTypes/NotEqualTo.md`,
        );
      },
    );

    res.status(200);
    return res.render(`${ViewsPath}/pages/index`, {
      page: "data-types",
      pageTitle: "Data Types",
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription:
        "Data Types that can be used to interact with OneUptime API",
      resources: Resources,
      dataTypes: DataTypes,
      pageData: pageData,
    });
  }
}
