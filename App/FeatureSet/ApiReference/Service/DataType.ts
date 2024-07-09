import { CodeExamplesPath, ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import LocalCache from "CommonServer/Infrastructure/LocalCache";
import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";
import LocalFile from "CommonServer/Utils/LocalFile";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();

export default class ServiceHandler {
  public static async executeResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Initialize pageData object
    const pageData: any = {};

    // Retrieve and cache code examples for different data types
    pageData.selectCode = await LocalCache.getOrSetString(
      "data-type",
      "select",
      async () => {
        // Read code example file
        return await LocalFile.read(`${CodeExamplesPath}/DataTypes/Select.md`);
      },
    );

    pageData.sortCode = await LocalCache.getOrSetString(
      "data-type",
      "sort",
      async () => {
        // Read code example file
        return await LocalFile.read(`${CodeExamplesPath}/DataTypes/Sort.md`);
      },
    );

    //... (rest of the code remains the same)

asynchronously
async () => {
  return await LocalFile.read(
    `${CodeExamplesPath}/DataTypes/LessThan.md`,
  );
},

// Get or set a string in the cache and return the code for less than or equal
pageData.lessThanOrEqualCode = await LocalCache.getOrSetString(
  "data-type",
  "less-than-or-equal",
  async () => {
    // Read a local file asynchronously
    return await LocalFile.read(
      `${CodeExamplesPath}/DataTypes/LessThanOrEqual.md`,
    );
  },
);

// Get or set a string in the cache and return the code for is null
pageData.isNullCode = await LocalCache.getOrSetString(
  "data-type",
  "is-null",
  async () => {
    // Read a local file asynchronously
    return await LocalFile.read(`${CodeExamplesPath}/DataTypes/IsNull.md`);
  },
);

// Get or set a string in the cache and return the code for not null
pageData.notNullCode = await LocalCache.getOrSetString(
  "data-type",
  "not-null",
  async () => {
    // Read a local file asynchronously
    return await LocalFile.read(`${CodeExamplesPath}/DataTypes/NotNull.md`);
  },
);

// Get or set a string in the cache and return the code for not equal to
pageData.notEqualToCode = await LocalCache.getOrSetString(
  "data-type",
  "not-equals",
  async () => {
    // Read a local file asynchronously
    return await LocalFile.read(
      `${CodeExamplesPath}/DataTypes/NotEqualTo.md`,
    );
  },
);

// Set the HTTP status to 200 and render the index page
res.status(200);
return res.render(`${ViewsPath}/pages/index`, {
  page: "data-types",
  pageTitle: "Data Types",
  pageDescription:
    "Data Types that can be used to interact with OneUptime API",
  resources: Resources,
  pageData: pageData,
});