import DatabaseService from "../../../../Services/DatabaseService";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import { RunOptions, RunReturnType } from "../../ComponentCode";
import { InitProps } from "../../TriggerCode";
import OnTriggerBaseModel from "./OnTriggerBaseModel";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  WHAT_HAPPENED_ID,
  WhatHappenedForRun,
  getWhatHappenedForRun,
} from "../../../../../Types/Workflow/CreateOrUpdateTrigger";
import { DatabaseOperation } from "../../../../../Types/Workflow/DatabaseOperation";

/*
 * On Create or Update: one trigger for a new record and for a changed one
 * (Types/Workflow/CreateOrUpdateTrigger).
 *
 * It listens for nothing itself. A create and an update reach the workflow
 * service as the On Create and On Update events they always were, and the
 * On Create and On Update triggers start this trigger's workflows along with
 * their own (OnTriggerBaseModel.initTrigger): "created" for a create, and
 * "updated" for an update that changes a watched field. A run starts here
 * like any record trigger's: the record, read with its Fields to pass on -
 * and What Happened, which says which of the two it is.
 */
export default class OnCreateOrUpdateBaseModel<
  TBaseModel extends BaseModel,
> extends OnTriggerBaseModel<TBaseModel> {
  public constructor(modelService: DatabaseService<TBaseModel>) {
    super(modelService, DatabaseOperation.OnCreateOrUpdate);
  }

  /*
   * No route of its own: nothing sends an "on-create-or-update" event, and
   * a route here would be one more way to start these workflows than a
   * create or an update.
   */
  @CaptureSpan()
  public override async init(_props: InitProps): Promise<void> {
    return await Promise.resolve();
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    /*
     * What started the run: the event that started it, or what Run
     * Workflow - or the API, or another workflow - asked. Nothing asked is a
     * create, as an empty choice is its first; anything else is refused
     * before the record is read.
     */
    const whatHappened: WhatHappenedForRun = getWhatHappenedForRun(
      args[WHAT_HAPPENED_ID],
    );

    if (!whatHappened.whatHappened) {
      throw options.onError(
        new BadDataException(whatHappened.error || "What Happened is not set."),
      );
    }

    const result: RunReturnType = await super.run(args, options);

    return {
      ...result,
      returnValues: {
        ...result.returnValues,
        [WHAT_HAPPENED_ID]: whatHappened.whatHappened,
      },
    };
  }
}
