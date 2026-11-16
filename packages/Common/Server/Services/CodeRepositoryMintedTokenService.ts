import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CodeRepositoryMintedToken";

/*
 * How long a row is kept: long after the token in it ended on its own (a
 * day at most after it was made), for whoever looks back at what a run was
 * handed.
 */
export const CODE_REPOSITORY_MINTED_TOKEN_RETENTION_IN_DAYS: number = 30;

/*
 * The access tokens OneUptime made on a repository's host for one code-fix
 * run each (see the model), written and read only by
 * Utils/CodeRepository/CodeHost/CodeRepositoryMintedTokens, as root.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      CODE_REPOSITORY_MINTED_TOKEN_RETENTION_IN_DAYS,
    );
  }
}

export default new Service();
