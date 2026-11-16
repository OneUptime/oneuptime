import { jest } from "@jest/globals";
import CodeRepositoryMintedTokenService from "../../../../../Server/Services/CodeRepositoryMintedTokenService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import CodeRepositoryMintedToken from "../../../../../Models/DatabaseModels/CodeRepositoryMintedToken";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * The rows CodeRepositoryMintedTokens keeps, held in memory for a test: the
 * service's create, findBy and updateOneById read and write them, matching
 * the queries the class makes (a run, a repository, not revoked yet). What
 * the class writes on a repository (its refusal, kept or cleared) is kept
 * too.
 */

export interface RepositoryWrite {
  id: string;
  data: Record<string, unknown>;
}

export interface MintedTokenStore {
  rows: Array<CodeRepositoryMintedToken>;
  repositoryWrites: Array<RepositoryWrite>;
  // Every query updateBy was asked, for the refusals a new token clears.
  repositoryBulkWrites: Array<{
    query: Record<string, unknown>;
    data: Record<string, unknown>;
  }>;
  // Makes the next create fail, as a database that is down would.
  failNextCreate: () => void;
}

function sameId(a: unknown, b: unknown): boolean {
  return Boolean(a) && Boolean(b) && String(a) === String(b);
}

export function mockMintedTokenStore(): MintedTokenStore {
  const rows: Array<CodeRepositoryMintedToken> = [];
  const repositoryWrites: Array<RepositoryWrite> = [];
  const repositoryBulkWrites: Array<{
    query: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];
  let shouldFailCreate: boolean = false;

  jest
    .spyOn(CodeRepositoryMintedTokenService, "create")
    .mockImplementation((async (data: {
      data: CodeRepositoryMintedToken;
    }): Promise<CodeRepositoryMintedToken> => {
      if (shouldFailCreate) {
        shouldFailCreate = false;
        throw new Error("the database is down");
      }

      data.data.id = ObjectID.generate();
      data.data.createdAt = new Date();
      rows.push(data.data);
      return data.data;
    }) as never);

  jest
    .spyOn(CodeRepositoryMintedTokenService, "findBy")
    .mockImplementation((async (data: {
      query: Record<string, unknown>;
    }): Promise<Array<CodeRepositoryMintedToken>> => {
      return rows.filter((row: CodeRepositoryMintedToken): boolean => {
        if ("revokedAt" in data.query && row.revokedAt) {
          return false;
        }

        if (
          data.query["aiRunId"] &&
          !sameId(data.query["aiRunId"], row.aiRunId)
        ) {
          return false;
        }

        if (
          data.query["codeRepositoryId"] &&
          !sameId(data.query["codeRepositoryId"], row.codeRepositoryId)
        ) {
          return false;
        }

        return true;
      });
    }) as never);

  jest
    .spyOn(CodeRepositoryMintedTokenService, "updateOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      const row: CodeRepositoryMintedToken | undefined = rows.find(
        (candidate: CodeRepositoryMintedToken): boolean => {
          return sameId(candidate.id, data.id);
        },
      );

      if (row) {
        Object.assign(row, data.data);
      }
    }) as never);

  jest
    .spyOn(CodeRepositoryService, "updateOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      repositoryWrites.push({ id: data.id.toString(), data: data.data });
    }) as never);

  jest
    .spyOn(CodeRepositoryService, "updateBy")
    .mockImplementation((async (data: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<number> => {
      repositoryBulkWrites.push({ query: data.query, data: data.data });
      return 1;
    }) as never);

  return {
    rows,
    repositoryWrites,
    repositoryBulkWrites,
    failNextCreate: (): void => {
      shouldFailCreate = true;
    },
  };
}
