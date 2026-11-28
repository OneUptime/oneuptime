import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { RecordOwners } from "../../../Types/LabelAccess/LabelAccess";
import {
  RecordOwnershipOperation,
  RecordOwnershipResult,
  RecordOwnershipTable,
} from "../../../Types/RecordAccess/RecordOwnership";
import DatabaseService from "../../Services/DatabaseService";
import OwnedScopePermission, {
  TableOwnedThrough,
} from "../../Types/Database/Permissions/OwnedScopePermission";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHO OWNS THE RECORDS A PAGE SHOWS, BY THE SERVER'S OWN OWNED SCOPE
 * (#11436, Types/RecordAccess/RecordOwnership).
 *
 * Nothing here decides who may do what: a page's locks are worked out by
 * the shared rule (Types/LabelAccess/LabelAccess.weighRecord) from the
 * reader's permission snapshot, and this answers the one thing the
 * snapshot cannot tell - who owns each record - from the lookups the Owned
 * scope narrows every read, change and delete by
 * (OwnedScopePermission.getOwnersOf):
 *
 *   - only the records the reader may read are answered: they are read as
 *     the reader first, by the read rule every page's read follows, so a
 *     record they may not see is not even said to exist;
 *   - of each, whether the reader owns it themselves, and which of the
 *     teams their grants scoped to Owned are given on own it - the teams
 *     whose records those grants reach, never their other teams;
 *   - the tables that take their owners from the kind's records, and the
 *     operations on each the Owned scope narrows
 *     (OwnedScopePermission.getTablesOwnedThrough).
 *
 * Three reads at most, however many records: the records as the reader,
 * and the kind's two owner tables kept to them.
 */
export default class RecordOwnershipReader {
  @CaptureSpan()
  public static async read(data: {
    service: DatabaseService<BaseModel>;
    // The records asked about: valid ids, in lower case, each once.
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<RecordOwnershipResult> {
    const modelType: { new (): BaseModel } = data.service.modelType;
    const tableName: string = new modelType().tableName || "";

    const tables: Array<RecordOwnershipTable> =
      OwnedScopePermission.getTablesOwnedThrough(modelType).map(
        (table: TableOwnedThrough): RecordOwnershipTable => {
          return {
            tableName: table.tableName,
            key: table.key,
            operations: table.operations.map(
              (operation: string): RecordOwnershipOperation => {
                return operation as RecordOwnershipOperation;
              },
            ),
          };
        },
      );

    const readableIds: Array<string> =
      data.ids.length === 0
        ? []
        : DatabaseService.getRowIds(
            await data.service.findBy({
              query: {
                _id: QueryHelper.any(data.ids),
              } as Query<BaseModel>,
              select: { _id: true } as Select<BaseModel>,
              skip: 0,
              limit: data.ids.length,
              props: data.props,
            }),
          ).map((id: string): string => {
            return id.toLowerCase();
          });

    const owners: Map<string, RecordOwners> =
      await OwnedScopePermission.getOwnersOf({
        modelType: modelType,
        props: data.props,
        teamIds: OwnedScopePermission.getTeamIdsOfOwnedRows(data.props),
        resourceIds: readableIds,
      });

    const records: Record<string, RecordOwners> = {};

    for (const id of readableIds) {
      records[id] = owners.get(id) || { isOwnedByCaller: false, teamIds: [] };
    }

    return {
      tableName: tableName,
      tables: tables,
      records: records,
    };
  }
}
