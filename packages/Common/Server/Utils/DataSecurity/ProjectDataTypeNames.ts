import DataSecurityCustomDataType from "../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { customDataTypeId } from "../../../Types/DataSecurity/CustomDataTypeId";
import DataTypeNamer from "../../../Types/DataSecurity/DataTypeNamer";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import DataSecurityCustomDataTypeService from "../../Services/DataSecurityCustomDataTypeService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHAT A PROJECT CALLS ITS DATA TYPES, READ ONCE FOR A REQUEST (#10363).
 *
 * Everything on the server that names a data type for a person or for
 * OneUptime AI names it through a DataTypeNamer: the record of processing
 * and its export, what Explain and Fix with AI tell OneUptime AI about an
 * issue, Ask AI's Data Security tools, and Scrub It's rules. A custom type
 * is named by the name the project gave it, so its types are read here -
 * their ids and names, nothing else, in one read - and a type that is gone
 * reads as deleted (DataTypeNamer).
 *
 *   - As OneUptime (no props): what a route that reads its records as
 *     OneUptime names, and what OneUptime AI is told.
 *   - As the reader: what Ask AI shows a person, who sees in it what Data
 *     Security shows them and nothing more. A reader who may not read the
 *     project's data types gets them named "Custom data type", as the
 *     Dashboard names them for that reader.
 */

export default class ProjectDataTypeNames {
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    // The reader's own permissions; as OneUptime when left out.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<DataTypeNamer> {
    let rows: Array<DataSecurityCustomDataType>;

    try {
      rows = await DataSecurityCustomDataTypeService.findBy({
        query: { projectId: data.projectId },
        select: { _id: true, name: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: data.props || { isRoot: true },
      });
    } catch (error) {
      // Not the reader's to read: named as one, never by an id.
      if (
        error instanceof NotAuthorizedException ||
        error instanceof PaymentRequiredException
      ) {
        return DataTypeNamer.withoutCustomTypes();
      }

      throw error;
    }

    const names: Map<string, string> = new Map();

    for (const row of rows) {
      if (row.id) {
        names.set(customDataTypeId(row.id.toString()), row.name || "");
      }
    }

    return new DataTypeNamer(names);
  }
}
