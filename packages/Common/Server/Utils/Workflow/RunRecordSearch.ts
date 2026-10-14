/*
 * Finds the record a workflow is run with, from what a person typed into the
 * Run Workflow panel: INC-8, 8, part of a title, or an ID. See
 * Types/Workflow/RunRecord for what a reference means.
 *
 * Every read is the person's own: their permissions decide what they find,
 * so someone who may not read incidents cannot look one up by its number.
 * And every read is held to the workflow's project, so another project's
 * INC-8 is never found, whatever the person may read elsewhere.
 */

import DatabaseService from "../../Services/DatabaseService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  RUN_RECORD_SEARCH_LIMIT,
  RunRecordColumns,
  RunRecordMatch,
  RunRecordOption,
  RunRecordReference,
  RunRecordReferenceKind,
  formatRunRecordNumber,
  getRunRecordColumns,
  getRunRecordSearchWords,
  isRunRecordNumberMatch,
  parseRunRecordReference,
  readRunRecordText,
} from "../../../Types/Workflow/RunRecord";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";

export interface RunRecordSearchRequest {
  // The service of the model the workflow's trigger acts on.
  service: DatabaseService<BaseModel>;
  // The workflow's project. Nothing outside it is ever read.
  projectId: ObjectID;
  // The person asking. Their permissions decide what they find.
  props: DatabaseCommonInteractionProps;
  // What they typed.
  search: string;
  // At most RUN_RECORD_SEARCH_LIMIT.
  limit?: number | undefined;
}

export default class RunRecordSearch {
  /**
   * The records a reference finds, best first: the record with that ID or
   * that number, then the records whose name contains what was typed, newest
   * first. Nothing typed: the newest records.
   */
  public static async search(
    request: RunRecordSearchRequest,
  ): Promise<Array<RunRecordOption>> {
    const columns: RunRecordColumns = getRunRecordColumns(
      request.service.getModel(),
    );
    const reference: RunRecordReference = parseRunRecordReference(
      request.search,
    );
    const limit: number = Math.max(
      1,
      Math.min(
        request.limit || RUN_RECORD_SEARCH_LIMIT,
        RUN_RECORD_SEARCH_LIMIT,
      ),
    );

    let found: Array<RunRecordOption> = [];

    if (reference.kind === RunRecordReferenceKind.Empty) {
      found = await RunRecordSearch.read({
        request: request,
        columns: columns,
        query: {},
        limit: limit,
        matchedBy: RunRecordMatch.Recent,
      });
    }

    if (
      reference.kind === RunRecordReferenceKind.Id ||
      reference.kind === RunRecordReferenceKind.Number
    ) {
      const exact: RunRecordOption | null = await RunRecordSearch.findExact({
        request: request,
        columns: columns,
        reference: reference,
      });

      if (exact) {
        found.push(exact);
      }
    }

    /*
     * Part of a name - and a number too, which can be part of a title
     * ("Error 500") as well as a record's number. Every word typed has to be
     * in the name, in any order, which is how a title half remembered is
     * typed: "database down" finds "Database is down". Each word is read as
     * typed: a % or an _ in it is that character, not "anything".
     */
    if (
      columns.nameColumn &&
      (reference.kind === RunRecordReferenceKind.Text ||
        reference.kind === RunRecordReferenceKind.Number)
    ) {
      found.push(
        ...(await RunRecordSearch.read({
          request: request,
          columns: columns,
          query: {
            [columns.nameColumn]: QueryHelper.searchAllWords(
              getRunRecordSearchWords(reference.text),
            ),
          },
          limit: limit,
          matchedBy: RunRecordMatch.Name,
        })),
      );
    }

    const seen: Set<string> = new Set<string>();

    return found
      .filter((option: RunRecordOption): boolean => {
        if (seen.has(option.id)) {
          return false;
        }

        seen.add(option.id);
        return true;
      })
      .slice(0, limit);
  }

  /**
   * The one record a reference names exactly - by its ID, or by its number -
   * or null. Part of a name never names a record exactly.
   */
  public static async resolve(
    request: RunRecordSearchRequest,
  ): Promise<RunRecordOption | null> {
    return RunRecordSearch.findExact({
      request: request,
      columns: getRunRecordColumns(request.service.getModel()),
      reference: parseRunRecordReference(request.search),
    });
  }

  private static async findExact(data: {
    request: RunRecordSearchRequest;
    columns: RunRecordColumns;
    reference: RunRecordReference;
  }): Promise<RunRecordOption | null> {
    if (data.reference.kind === RunRecordReferenceKind.Id) {
      const byId: Array<RunRecordOption> = await RunRecordSearch.read({
        request: data.request,
        columns: data.columns,
        query: { _id: new ObjectID(data.reference.id as string) },
        limit: 1,
        matchedBy: RunRecordMatch.Id,
      });

      return byId[0] || null;
    }

    if (
      data.reference.kind !== RunRecordReferenceKind.Number ||
      !data.columns.number
    ) {
      return null;
    }

    /*
     * Numbers are counted per project, so a project has one record with a
     * number - and a record keeps the prefix it was numbered with, which is
     * what decides whether "ALT-8" means this incident 8 (it does not).
     */
    const byNumber: Array<RunRecordOption> = await RunRecordSearch.read({
      request: data.request,
      columns: data.columns,
      query: {
        [data.columns.number.numberColumn]: data.reference.number as number,
      },
      limit: 1,
      matchedBy: RunRecordMatch.Number,
    });

    const record: RunRecordOption | undefined = byNumber[0];

    if (
      !record ||
      !isRunRecordNumberMatch({
        reference: data.reference,
        numberWithPrefix: record.number,
      })
    ) {
      return null;
    }

    return record;
  }

  private static async read(data: {
    request: RunRecordSearchRequest;
    columns: RunRecordColumns;
    query: JSONObject | Dictionary<unknown>;
    limit: number;
    matchedBy: RunRecordMatch;
  }): Promise<Array<RunRecordOption>> {
    const model: BaseModel = data.request.service.getModel();
    const tenantColumn: string | null = model.getTenantColumn();

    /*
     * A record is looked up in the workflow's project, so a model with no
     * project of its own has nothing to look up there.
     */
    if (!tenantColumn) {
      throw new BadDataException(
        `${model.pluralName || "These records"} do not belong to a project, so the workflow can't be run with one.`,
      );
    }

    const query: Dictionary<unknown> = {
      ...data.query,
      [tenantColumn]: data.request.projectId,
    };

    const select: Dictionary<boolean> = {
      _id: true,
      createdAt: true,
    };

    if (data.columns.number) {
      select[data.columns.number.numberColumn] = true;
      select[data.columns.number.numberWithPrefixColumn] = true;
    }

    if (data.columns.nameColumn) {
      select[data.columns.nameColumn] = true;
    }

    const records: Array<BaseModel> = await data.request.service.findBy({
      query: query as Query<BaseModel>,
      select: select as Select<BaseModel>,
      sort: { createdAt: SortOrder.Descending } as Sort<BaseModel>,
      limit: data.limit,
      skip: 0,
      props: {
        ...data.request.props,
        tenantId: data.request.projectId,
      },
    });

    return records
      .map((record: BaseModel): RunRecordOption | null => {
        return RunRecordSearch.toOption({
          record: record,
          columns: data.columns,
          matchedBy: data.matchedBy,
        });
      })
      .filter((option: RunRecordOption | null): option is RunRecordOption => {
        return option !== null;
      });
  }

  private static toOption(data: {
    record: BaseModel;
    columns: RunRecordColumns;
    matchedBy: RunRecordMatch;
  }): RunRecordOption | null {
    const values: Dictionary<unknown> =
      data.record as unknown as Dictionary<unknown>;
    const id: string = data.record._id?.toString() || "";

    if (!id) {
      return null;
    }

    const option: RunRecordOption = {
      id: id,
      matchedBy: data.matchedBy,
    };

    if (data.columns.number) {
      const number: string | undefined = formatRunRecordNumber({
        number: values[data.columns.number.numberColumn],
        numberWithPrefix: values[data.columns.number.numberWithPrefixColumn],
      });

      if (number) {
        option.number = number;
      }
    }

    if (data.columns.nameColumn) {
      const name: string | undefined = readRunRecordText(
        values[data.columns.nameColumn],
      );

      if (name) {
        option.name = name;
      }
    }

    const createdAt: unknown = values["createdAt"];

    if (createdAt instanceof Date && !isNaN(createdAt.getTime())) {
      option.createdAt = createdAt.toISOString();
    } else if (typeof createdAt === "string" && !isNaN(Date.parse(createdAt))) {
      option.createdAt = new Date(createdAt).toISOString();
    }

    return option;
  }
}
