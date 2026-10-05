import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
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
 * Every rule (label, owner, on-call, grouping, privacy and the rest) and
 * every owner row (<Resource>OwnerUser / <Resource>OwnerTeam) is served by
 * one: those are the records whose ids the engines act on as root, adding
 * owners, paging on-call policies and attaching labels.
 *
 * A subclass with create or update hooks of its own calls
 * super.onBeforeCreate / super.onBeforeUpdate before anything of its own
 * reads a referenced record, so an id from another project gets the same
 * answer as an id that matches nothing. OwnerAndRuleServicesCheckReferences
 * (Common Tests) holds every rule and owner service to this.
 */
export default class ProjectReferencesService<
  TBaseModel extends BaseModel,
> extends DatabaseService<TBaseModel> {
  /*
   * Relations this service already checks itself, with a check of its own
   * that is pinned to the project and answers an id from another project
   * exactly like one that matches nothing (a queue an owner row names, say).
   * They are left out of the generic check so the service's own words stay
   * the answer. Lists are never left out.
   */
  protected getRelationsCheckedByService(): Array<string> {
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

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<TBaseModel>,
  ): Promise<OnCreate<TBaseModel>> {
    await ProjectReferenceCheck.validateCreate({
      service: this,
      createBy: createBy,
      relationsCheckedByService: this.getRelationsCheckedByService(),
      jsonReferenceColumns: this.getJsonReferenceColumns(),
    });

    return { createBy: createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<TBaseModel>,
  ): Promise<OnUpdate<TBaseModel>> {
    await ProjectReferenceCheck.validateUpdate({
      service: this,
      updateBy: updateBy,
      relationsCheckedByService: this.getRelationsCheckedByService(),
      jsonReferenceColumns: this.getJsonReferenceColumns(),
    });

    return { updateBy: updateBy, carryForward: null };
  }
}
