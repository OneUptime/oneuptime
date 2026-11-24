import CodeApi, {
  CodeRepositoriesResponse,
  CodeRepositoryListItem,
} from "./CodeApi";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CodeRepositoryListGroup,
  CodeRepositoryListOrder,
} from "Common/Types/AI/CodeTask";
import Includes from "Common/Types/BaseDatabase/Includes";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import Search from "Common/Types/BaseDatabase/Search";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * CODE'S REPOSITORIES, AS A SEARCHED PICKER READS THEM (#10764).
 *
 * The shared entity picker (EntityDropdown) searches a model's list route
 * as the reader types and reads what it holds by id. A picker of the
 * repositories OneUptime AI can work in needs what only Code's own routes
 * know - whether OneUptime reaches a repository - so this answers the
 * picker's two reads from them, over every repository the reader may read,
 * however many the project has:
 *
 *   - a search (the picker's query, with the text it typed as a Search or a
 *     MultiSearch) is POST /code-task/repositories, by name - in one of
 *     Code's two lists when the picker's query names it under
 *     CODE_REPOSITORY_CHOICE_GROUP_KEY;
 *   - a read of what it holds (`_id` in a list) is
 *     POST /code-task/repositories-by-id: a repository the reader may no
 *     longer read is not answered, and the picker says it is not found.
 *
 * Any other model is read as ModelAPI reads it.
 */

// The key of a picker's query that names one of Code's two lists.
export const CODE_REPOSITORY_CHOICE_GROUP_KEY: string = "codeRepositoryGroup";

// The text a picker's query searches for, as typed: "" for none.
export const readChoiceSearch: (query: Record<string, unknown>) => string = (
  query: Record<string, unknown>,
): string => {
  for (const value of Object.values(query)) {
    if (value instanceof Search || value instanceof MultiSearch) {
      return String(value.value || "").trim();
    }
  }

  return "";
};

// The list a picker's query names: none unless it is one of the two.
export const readChoiceGroup: (
  query: Record<string, unknown>,
) => CodeRepositoryListGroup | undefined = (
  query: Record<string, unknown>,
): CodeRepositoryListGroup | undefined => {
  const value: unknown = query[CODE_REPOSITORY_CHOICE_GROUP_KEY];

  return (Object.values(CodeRepositoryListGroup) as Array<unknown>).includes(
    value,
  )
    ? (value as CodeRepositoryListGroup)
    : undefined;
};

// The ids a picker reads what it holds by: null when it is not that read.
export const readHeldIds: (
  query: Record<string, unknown>,
) => Array<string> | null = (
  query: Record<string, unknown>,
): Array<string> | null => {
  const value: unknown = query["_id"];

  if (!(value instanceof Includes)) {
    return null;
  }

  return value.values
    .map((id: unknown): string => {
      return String(id);
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });
};

/*
 * A repository as the picker reads a record: its id and name, its host's
 * organization/name, and whether OneUptime reaches it (isConnected, read by
 * a picker's formatOption).
 */
export const toCodeRepositoryRecord: (
  repository: CodeRepositoryListItem,
) => CodeRepository = (repository: CodeRepositoryListItem): CodeRepository => {
  const record: CodeRepository = new CodeRepository();

  record._id = repository.id;
  record.name = repository.name;

  if (repository.organizationName) {
    record.organizationName = repository.organizationName;
  }

  if (repository.repositoryName) {
    record.repositoryName = repository.repositoryName;
  }

  (record as unknown as Record<string, unknown>)["isConnected"] =
    repository.isConnected;

  return record;
};

export default class CodeRepositoryChoicesAPI extends ModelAPI {
  public static override async getList<TBaseModel extends BaseModel>(
    data: Parameters<typeof ModelAPI.getList<TBaseModel>>[0],
  ): Promise<ListResult<TBaseModel>> {
    if ((data.modelType as unknown) !== CodeRepository) {
      return await ModelAPI.getList<TBaseModel>(data);
    }

    const query: Record<string, unknown> = (data.query || {}) as Record<
      string,
      unknown
    >;
    const heldIds: Array<string> | null = readHeldIds(query);

    if (heldIds) {
      const held: Array<CodeRepositoryListItem> =
        heldIds.length > 0 ? await CodeApi.getRepositoriesById(heldIds) : [];

      return {
        data: held.map(toCodeRepositoryRecord) as unknown as Array<TBaseModel>,
        count: held.length,
        skip: 0,
        limit: data.limit,
      };
    }

    const found: CodeRepositoriesResponse = await CodeApi.getRepositories({
      search: readChoiceSearch(query),
      group: readChoiceGroup(query),
      order: CodeRepositoryListOrder.Name,
      skip: data.skip,
      limit: data.limit,
    });

    return {
      data: found.repositories.map(
        toCodeRepositoryRecord,
      ) as unknown as Array<TBaseModel>,
      count: found.count,
      skip: data.skip,
      limit: data.limit,
    };
  }
}
