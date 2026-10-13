import CommonAPI from "./CommonAPI";
import LlmProviderService from "../Services/LlmProviderService";
import Select from "../Types/Database/Select";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import { PermissionHelper } from "../../Types/Permission";

/*
 * WHO MAY TEST AN LLM PROVIDER, and the provider a test runs.
 *
 * Test (on Project Settings > AI > LLM Providers, and on a global provider's
 * row in the Admin Dashboard) sends the provider a short prompt with its
 * saved API key, model, Base URL and Additional Parameters, and says whether
 * it answered and called the tool it was offered. It changes nothing and
 * sends nobody a message, but it spends tokens on the provider's key and
 * shows what the provider answered. So it is for the people who set the
 * provider up:
 *
 *  - a project's own provider: whoever may change it, in the project it
 *    belongs to - the provider's update rule (its update list, a team's
 *    block counted), on a credential that may make changes, on the plan
 *    that sells providers (DatabaseService.findOneUpdatableById). A member
 *    who may only read providers sees Test locked, saying which permission
 *    tests one (the Dashboard asks the same list);
 *  - a global provider (one no project owns): a server administrator, from
 *    the Admin Dashboard. Its key and its bill are the instance's own.
 *
 * In that order: who the caller is and the permission first, before any
 * read, so a caller learns nothing about a provider they may not test; then
 * whose provider it is, read as OneUptime, its project alone. A provider of
 * another project and one that does not exist are answered alike.
 *
 * Whether a provider is global is decided by its project alone. isGlobalLlm
 * is read by no project role (read: []), and reading it with the caller's
 * props - as this route's check once did - refused every member's test, the
 * project owner's included: "You do not have permissions to select on -
 * isGlobalLlm." Master admins never met it: their reads skip every column
 * check. The provider's whole configuration, the key included, is read only
 * once the caller may test it, as OneUptime.
 */

// What a test needs of the provider, read as OneUptime once it may run.
export const LLM_PROVIDER_TEST_SELECT: Select<LlmProvider> = {
  _id: true,
  llmType: true,
  apiKey: true,
  baseUrl: true,
  modelName: true,
  additionalParams: true,
  // LlmProviderService.isUnownedGlobalProvider reads both.
  isGlobalLlm: true,
  projectId: true,
};

export default class LlmProviderTestAccess {
  // A provider that does not exist, or that the caller may not reach.
  public static readonly NOT_FOUND_MESSAGE: string =
    "LLM Provider not found, or you do not have access to it.";

  public static readonly ID_REQUIRED_MESSAGE: string =
    "llmProviderId is required";

  // A global provider, to anyone but a server administrator.
  public static readonly GLOBAL_PROVIDER_MESSAGE: string =
    "Only server administrators can test a global LLM provider, from the Admin Dashboard.";

  /*
   * What a member who may not test the provider is told: the sentence the
   * Dashboard's locked Test button says (LlmProviderTestCopy), and who may -
   * the provider's update list, by title, as the button lists them.
   */
  public static readonly REFUSED_SENTENCE: string =
    "You do not have permission to test this LLM provider.";

  public static getRefusalMessage(): string {
    const titles: Array<string> = PermissionHelper.getPermissionTitles(
      new LlmProvider().getUpdatePermissions(),
    );

    return `${LlmProviderTestAccess.REFUSED_SENTENCE} You need one of these permissions: ${titles.join(", ")}.`;
  }

  /*
   * The provider to test - its configuration, the key included, read as
   * OneUptime - once the caller may test it. Throws what to tell them
   * otherwise.
   */
  public static async getProviderToTest(data: {
    props: DatabaseCommonInteractionProps;
    llmProviderId: unknown;
  }): Promise<LlmProvider> {
    const id: ObjectID = LlmProviderTestAccess.toProviderId(data.llmProviderId);

    if (data.props.isMasterAdmin) {
      return await LlmProviderTestAccess.readToTest(id);
    }

    // A signed-in member of the project the request names, or its API key.
    const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectPrincipal(
      data.props,
    );

    CommonAPI.assertPermittedInProject({
      databaseProps: data.props,
      allowedPermissions: new LlmProvider().getUpdatePermissions(),
      errorMessage: LlmProviderTestAccess.getRefusalMessage(),
    });

    // Whose provider it is: its project alone, read as OneUptime.
    const owner: LlmProvider | null = await LlmProviderService.findOneById({
      id: id,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!owner) {
      throw new BadDataException(LlmProviderTestAccess.NOT_FOUND_MESSAGE);
    }

    if (!owner.projectId) {
      throw new NotAuthorizedException(
        LlmProviderTestAccess.GLOBAL_PROVIDER_MESSAGE,
      );
    }

    if (owner.projectId.toString() !== projectId.toString()) {
      throw new BadDataException(LlmProviderTestAccess.NOT_FOUND_MESSAGE);
    }

    /*
     * The provider's update rule, on this row: a team's block, a
     * credential issued for reading only and the plan refuse here, as an
     * edit of it would be refused.
     */
    const provider: LlmProvider | null =
      await LlmProviderService.findOneUpdatableById({
        id: id,
        select: LLM_PROVIDER_TEST_SELECT,
        props: data.props,
      });

    if (!provider) {
      throw new BadDataException(LlmProviderTestAccess.NOT_FOUND_MESSAGE);
    }

    return provider;
  }

  // The provider a server administrator tests, global or a project's.
  private static async readToTest(id: ObjectID): Promise<LlmProvider> {
    const provider: LlmProvider | null = await LlmProviderService.findOneById({
      id: id,
      select: LLM_PROVIDER_TEST_SELECT,
      props: {
        isRoot: true,
      },
    });

    if (!provider) {
      throw new BadDataException(LlmProviderTestAccess.NOT_FOUND_MESSAGE);
    }

    return provider;
  }

  /*
   * The id the request names. Not an id at all is answered like one that
   * names no provider: the id column is a uuid, and Postgres refuses a
   * query of it with anything else.
   */
  private static toProviderId(value: unknown): ObjectID {
    if (value === undefined || value === null || value === "") {
      throw new BadDataException(LlmProviderTestAccess.ID_REQUIRED_MESSAGE);
    }

    if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
      throw new BadDataException(LlmProviderTestAccess.NOT_FOUND_MESSAGE);
    }

    return new ObjectID(value);
  }
}
