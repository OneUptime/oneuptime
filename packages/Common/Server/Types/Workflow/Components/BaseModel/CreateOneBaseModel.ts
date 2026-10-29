import DatabaseService from "../../../../Services/DatabaseService";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import ObjectID from "../../../../../Types/ObjectID";
import Text from "../../../../../Types/Text";
import ComponentMetadata, {
  Argument,
  Port,
} from "../../../../../Types/Workflow/Component";
import {
  getCreateFromTemplateArgument,
  readTemplateId,
} from "../../../../../Types/Workflow/CreateFromTemplate";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import { applyTenantColumn, logUnknownColumns } from "./ModelArguments";
import { linkAffectedResourcesFromSetting } from "./AffectedResourcesArgument";
import { AFFECTED_RESOURCES_ARGUMENT_ID } from "../../../../../Types/Workflow/AffectedResourcesSetting";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import logComponentError from "./LogComponentError";
import { assertIdsAreResolved } from "./UnresolvedIdReference";

export default class CreateOneBaseModel<
  TBaseModel extends BaseModel,
> extends ComponentCode {
  private modelService: DatabaseService<TBaseModel> | null = null;

  public constructor(modelService: DatabaseService<TBaseModel>) {
    super();

    const BaseModelComponent: ComponentMetadata | undefined =
      BaseModelComponents.getComponents(modelService.getModel()).find(
        (i: ComponentMetadata) => {
          return (
            i.id ===
            `${Text.pascalCaseToDashes(
              modelService.getModel().tableName!,
            )}-create-one`
          );
        },
      );

    if (!BaseModelComponent) {
      throw new BadDataException(
        "Create one component for " +
          modelService.getModel().tableName +
          " not found.",
      );
    }
    this.setMetadata(BaseModelComponent);
    this.modelService = modelService;
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "success";
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Success port not found"));
    }

    const errorPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "error";
      },
    );

    if (!errorPort) {
      throw options.onError(new BadDataException("Error port not found"));
    }

    try {
      if (!this.modelService) {
        throw options.onError(
          new BadDataException("modelService is undefined."),
        );
      }

      /*
       * The template the step declares the record from, when its record has
       * templates and one is picked (Types/Workflow/CreateFromTemplate).
       * With one, JSON Object holds only what should differ from it, and
       * may be left empty.
       */
      const templateId: ObjectID | null = this.readTemplateArgument(args);

      if (!args["json"] && !templateId) {
        throw options.onError(new BadDataException("JSON is undefined."));
      }

      if (!args["json"]) {
        args["json"] = {};
      }

      if (typeof args["json"] === "string") {
        args["json"] = JSONFunctions.parse(args["json"] as string);
      }

      if (typeof args["json"] !== "object") {
        throw options.onError(
          new BadDataException("JSON is should be of type object."),
        );
      }

      // An ID still written as a {{...}} reference stops the step. See the helper.
      assertIdsAreResolved({
        json: args["json"] as JSONObject,
        model: this.modelService.getModel(),
        metadata: this.getMetadata(),
        argumentId: "json",
      });

      /*
       * Checked before applyTenantColumn rather than after: the report should
       * name the keys the builder actually typed, and the tenant column the
       * stamp adds is not one of them.
       */
      logUnknownColumns(
        args["json"] as JSONObject,
        this.modelService.getModel(),
        options.log,
      );

      args["json"] = applyTenantColumn(
        args["json"] as JSONObject,
        this.modelService.getModel(),
        options.projectId,
      );

      const data: TBaseModel = BaseModel.fromJSON<TBaseModel>(
        (args["json"] as JSONObject) || {},
        this.modelService.modelType,
      ) as TBaseModel;

      // A Project Admin of the project, never root. See getStepProps.
      const props: DatabaseCommonInteractionProps =
        await this.getStepProps(options);

      /*
       * Create One Incident's and Create One Alert's Affected Resources: the
       * names, addresses or IDs it holds, looked up as the step and added to
       * the record's lists (AffectedResourcesArgument). A name that matches
       * nothing is said in the run log; it never fails the step.
       */
      await linkAffectedResourcesFromSetting({
        record: data,
        tableName: this.modelService.getModel().tableName || undefined,
        value: args[AFFECTED_RESOURCES_ARGUMENT_ID],
        projectId: options.projectId,
        props: props,
        templateId: templateId,
        log: (message: string): void => {
          options.log(message);
        },
      });

      /*
       * Declared from the template by the record's own service, as the step
       * - it applies the template the way the server applies one anywhere,
       * and records which template it was (IncidentService).
       */
      const model: TBaseModel = templateId
        ? await this.modelService.createFromTemplate({
            templateId: templateId,
            data: data,
            props: props,
          })
        : ((await this.modelService.create({
            data: data,
            props: props,
          })) as TBaseModel);

      return {
        returnValues: {
          model: BaseModel.toJSON(model, this.modelService.modelType),
        },
        executePort: successPort,
      };
    } catch (err: any) {
      // Said in the run log, and again under the step's Error output.
      const reason: string = logComponentError({
        error: err,
        model: this.modelService?.getModel() || null,
        log: options.log,
        stepTitle: this.getMetadata().title,
      });

      return {
        returnValues: {},
        executePort: errorPort,
        executePortReason: reason,
      };
    }
  }

  /*
   * The step's template setting, read: the template's ID, or null when the
   * step has no such setting or none is picked. A value that is not an ID -
   * a reference that came out as something else - is refused in words that
   * name the setting.
   */
  private readTemplateArgument(args: JSONObject): ObjectID | null {
    const argument: Argument | null = getCreateFromTemplateArgument(
      this.modelService?.getModel().tableName || undefined,
    );

    if (!argument) {
      return null;
    }

    const value: string | null = readTemplateId(args[argument.id]);

    if (!value) {
      return null;
    }

    if (!ObjectID.isValidUUID(value)) {
      throw new BadDataException(
        `${argument.name} must be the ID of a template, and "${value}" is not one. Pick the template from the list.`,
      );
    }

    return new ObjectID(value);
  }
}
