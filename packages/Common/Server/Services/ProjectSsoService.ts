import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProjectSso";
import ObjectID from "../../Types/ObjectID";
import { fillSamlProviderDefaults } from "../../Types/SSO/SamlProviderDefaults";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectSsoProviderChanges, {
  ProjectSsoProviderWrite,
} from "../Utils/ProjectSsoProviderChanges";
import { ProjectSsoProviderStandingValue } from "../Utils/ProjectSsoProviderStanding";
import SsoProviderTeamGrant, {
  SsoProviderKind,
} from "../Utils/SsoProviderTeamGrant";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Exception from "../../Types/Exception/Exception";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Whether this SAML provider still vouches for the sign-ins it gave in the
   * project: it is there, it is the project's, it is on, and when it was
   * last turned off (Utils/ProjectSsoProviderStanding). Asked on every
   * request to a project that requires SSO, so it is cached for a minute.
   */
  @CaptureSpan()
  public async getSignInStanding(data: {
    providerId: ObjectID;
    projectId: ObjectID;
  }): Promise<ProjectSsoProviderStandingValue> {
    return await ProjectSsoProviderChanges.getStanding<Model>({
      service: this,
      providerType: SsoProviderType.ProjectSSO,
      providerId: data.providerId,
      projectId: data.projectId,
    });
  }

  /*
   * A SAML provider created without a signature method, a digest method or
   * a description gets the usual ones (Types/SSO/SamlProviderDefaults),
   * before the required-field check runs: the columns stay required, so the
   * API and Terraform keep their contract, and a caller may leave them out.
   * What the caller sent is kept.
   *
   * Its teams must be teams the person creating it could invite someone to
   * (Utils/SsoProviderTeamGrant): people who sign in with it join them.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    fillSamlProviderDefaults(createBy.data);

    await SsoProviderTeamGrant.assertCanCreate({
      kind: SsoProviderKind.Saml,
      modelType: Model,
      provider: createBy.data,
      props: createBy.props,
    });

    return { createBy, carryForward: null };
  }

  /*
   * Every save, by the same rule as a create (Utils/SsoProviderTeamGrant).
   * Turning a provider off ends the sign-ins it gave, and a project that
   * requires SSO keeps a provider to sign in with
   * (Utils/ProjectSsoProviderChanges).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const checkedUpdateBy: UpdateBy<Model> =
      await SsoProviderTeamGrant.checkUpdate<Model>({
        kind: SsoProviderKind.Saml,
        service: this,
        updateBy: updateBy,
      });

    const write: ProjectSsoProviderWrite | null =
      await ProjectSsoProviderChanges.beforeUpdate<Model>({
        providerType: SsoProviderType.ProjectSSO,
        service: this,
        updateBy: checkedUpdateBy,
      });

    return {
      updateBy: checkedUpdateBy,
      carryForward: write,
    };
  }

  // Turning a provider off writes when, in the same write.
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await ProjectSsoProviderChanges.beforeWrite<Model>({
      service: this,
      updateBy: updateBy,
    });
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await ProjectSsoProviderChanges.afterUpdate({
      write: onUpdate.carryForward as ProjectSsoProviderWrite | null,
      updatedItemIds: updatedItemIds,
    });

    return onUpdate;
  }

  // Deleting a provider that is on ends the sign-ins it gave, as turning it off does.
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    return {
      deleteBy,
      carryForward: await ProjectSsoProviderChanges.beforeDelete<Model>({
        providerType: SsoProviderType.ProjectSSO,
        service: this,
        deleteBy: deleteBy,
      }),
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    await ProjectSsoProviderChanges.afterDelete({
      write: onDelete.carryForward as ProjectSsoProviderWrite | null,
      deletedItemIds: itemIdsBeforeDelete,
    });

    return onDelete;
  }

  /*
   * A hard delete (the retention job's purge) runs no onDeleteSuccess: the
   * locks its check took are given back here, and the projects of the
   * providers it deleted that were on are told, as onDeleteSuccess does.
   */
  @CaptureSpan()
  protected override async onHardDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    await ProjectSsoProviderChanges.afterDelete({
      write: onDelete.carryForward as ProjectSsoProviderWrite | null,
      deletedItemIds: itemIdsBeforeDelete,
    });

    return onDelete;
  }

  // An update that failed, or was refused, once it held its locks: they are given back.
  @CaptureSpan()
  protected override async onUpdateError(
    error: Exception,
    onUpdate?: OnUpdate<Model> | undefined,
  ): Promise<Exception> {
    await ProjectSsoProviderChanges.afterFailedWrite(
      onUpdate?.carryForward as ProjectSsoProviderWrite | null | undefined,
    );

    return error;
  }

  // The same for a delete.
  @CaptureSpan()
  protected override async onDeleteError(
    error: Exception,
    onDelete?: OnDelete<Model> | undefined,
  ): Promise<Exception> {
    await ProjectSsoProviderChanges.afterFailedWrite(
      onDelete?.carryForward as ProjectSsoProviderWrite | null | undefined,
    );

    return error;
  }
}

export default new Service();
