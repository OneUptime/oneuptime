import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectReferenceCheck, {
  JsonReferenceColumn,
} from "../Utils/Database/ProjectReferenceCheck";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";

/*
 * A service whose records may reference only their own project's records:
 * every list and relation they write must name the project's records, and
 * every person must be a member of the project (see ProjectReferenceCheck).
 *
 * Every service whose records name another record of the project is one:
 * the rules (label, owner, on-call, grouping, privacy and the rest) and the
 * owner rows (<Resource>OwnerUser / <Resource>OwnerTeam), whose ids the
 * engines act on as root, and every other record a caller can point at a
 * record - an incident's labels, a status page link's page, a team member's
 * team, a log pipeline processor's pipeline. A record that names another
 * project's record would act on it (a feed item written to that incident, a
 * list reordered on that status page) and show its name back through the
 * relation (`select: { statusPage: { name: true } }` reads the joined row
 * without asking whose it is).
 *
 * A subclass with create or update hooks of its own calls
 * super.onBeforeCreate / super.onBeforeUpdate first, before anything of its
 * own reads a referenced record, so an id from another project gets the same
 * answer as an id that matches nothing. ProjectScopedReferencesEverywhere and
 * OwnerAndRuleServicesCheckReferences (Common Tests) hold every service to
 * this.
 *
 * The check only ever answers someone who may write the table in the
 * project: DatabaseService refuses everyone else before any hook runs
 * (checkCallerBeforeHooks), so its answer is never a way to learn which ids
 * a project has.
 */

/*
 * The write a service is asked about in getRelationsCheckedByService and
 * getListsCheckedByService: a service may check a reference itself on one
 * kind of write only (a create), or for a person's write only, and leave the
 * others to the generic check.
 */
export interface ProjectReferenceWrite {
  kind: "create" | "update";
  props: DatabaseCommonInteractionProps;
}

export default class ProjectReferencesService<
  TBaseModel extends BaseModel,
> extends DatabaseService<TBaseModel> {
  /*
   * Relations this service already checks itself, with a check of its own
   * that is pinned to the project and answers an id from another project
   * exactly like one that matches nothing (a queue an owner row names, say).
   * They are left out of the generic check so the service's own words stay
   * the answer - on the writes the service checks them on, which it can tell
   * from `write`. Asked with no write, it names every relation it may check.
   */
  protected getRelationsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return [];
  }

  /*
   * Lists this service already checks itself, the same way - an incident's
   * monitors and labels, which IncidentService checks with
   * ProjectScopedReferenceValidator and its own words. Rules and owner rows
   * never leave a list out: OwnerAndRuleServicesCheckReferences holds them to
   * that. `write` as for getRelationsCheckedByService.
   */
  protected getListsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return [];
  }

  /*
   * JSON columns whose values name records - the metadata cannot describe
   * those - and how to read the references from a value. Checked together
   * with the lists and relations, in the same answer.
   */
  protected getJsonReferenceColumns(): Array<JsonReferenceColumn> {
    return [];
  }

  /*
   * Whether OneUptime's own writes are checked as well: a write as root with
   * no project on the request, which is how jobs, engines and the services'
   * own helpers write. They are by default.
   *
   * A service returns false when its own writes only name records it found
   * itself, and refusing one would lose the row: a feed item crediting
   * someone who has since left the project, a delivery log written before
   * the message is sent. Every write made in a project - an API call, a
   * workflow step, a root write with the project's tenant, a master admin -
   * is still checked.
   */
  protected checksServerWrites(): boolean {
    return true;
  }

  /*
   * Whether a person's create must pass their whole create permission check
   * - its columns as well as the table - before this check reads anything.
   * DatabaseService refuses anyone who may not create in the table at all
   * before any hook runs; a service whose own refusals describe the records
   * it looks up (a database, a queue, a team's rules), or whose rows anyone
   * signed in may create for themselves, asks for the rest of the check
   * first as well, so no answer here comes before it. Asked only when the
   * write names something to look up; root and master admin writes are not
   * asked, as DatabaseService does not ask them.
   */
  protected checksCreatePermissionFirst(): boolean {
    return false;
  }

  /*
   * Every reference a write names is held to the write's project here, in
   * the words a missing record gets (ProjectReferenceCheck, or the
   * service's own check of the relations and lists it names in
   * getRelationsCheckedByService / getListsCheckedByService) - so the
   * permission layer need not look up a parent or a listed record that the
   * caller's read reaches whatever it is (DatabaseService
   * .checksReferencesInProject).
   */
  protected override checksReferencesInProject(): boolean {
    return true;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<TBaseModel>,
  ): Promise<OnCreate<TBaseModel>> {
    if (this.isCheckedWrite(createBy.props)) {
      const write: ProjectReferenceWrite = {
        kind: "create",
        props: createBy.props,
      };

      const asksPermissionFirst: boolean =
        this.checksCreatePermissionFirst() &&
        !createBy.props.isRoot &&
        !createBy.props.isMasterAdmin;

      await ProjectReferenceCheck.validateCreate({
        service: this,
        createBy: createBy,
        relationsCheckedByService: this.getRelationsCheckedByService(write),
        listsCheckedByService: this.getListsCheckedByService(write),
        jsonReferenceColumns: this.getJsonReferenceColumns(),
        beforeReading: asksPermissionFirst
          ? (): void => {
              ModelPermission.checkCreatePermissions(
                this.modelType,
                createBy.data,
                createBy.props,
              );
            }
          : undefined,
      });
    }

    return { createBy: createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<TBaseModel>,
  ): Promise<OnUpdate<TBaseModel>> {
    if (this.isCheckedWrite(updateBy.props)) {
      const write: ProjectReferenceWrite = {
        kind: "update",
        props: updateBy.props,
      };

      await ProjectReferenceCheck.validateUpdate({
        service: this,
        updateBy: updateBy,
        relationsCheckedByService: this.getRelationsCheckedByService(write),
        listsCheckedByService: this.getListsCheckedByService(write),
        jsonReferenceColumns: this.getJsonReferenceColumns(),
      });
    }

    return { updateBy: updateBy, carryForward: null };
  }

  // See checksServerWrites.
  private isCheckedWrite(props: DatabaseCommonInteractionProps): boolean {
    if (this.checksServerWrites()) {
      return true;
    }

    return !ProjectReferenceCheck.isServerWrite(props);
  }
}
