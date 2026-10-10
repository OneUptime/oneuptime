import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../../Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import { getCustomFieldSavedViewTableIds } from "../../../Types/CustomField/CustomFieldSavedViews";
import FormTargetType from "../../../Types/Form/FormTargetType";
import AlertService from "../../Services/AlertService";
import DatabaseService from "../../Services/DatabaseService";
import IncidentService from "../../Services/IncidentService";
import IncidentTemplateService from "../../Services/IncidentTemplateService";
import InventoryItemService from "../../Services/InventoryItemService";
import MonitorService from "../../Services/MonitorService";
import MonitorTemplateService from "../../Services/MonitorTemplateService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import ProjectUserProfileService from "../../Services/ProjectUserProfileService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceTemplateService from "../../Services/ScheduledMaintenanceTemplateService";
import StatusPageService from "../../Services/StatusPageService";
import TeamService from "../../Services/TeamService";

/*
 * WHERE EACH RESOURCE'S CUSTOM FIELD VALUES ARE KEPT.
 *
 * Nine definition tables describe custom fields, and the values they describe
 * live in a `customFields` jsonb bag, keyed by the field's name, on the
 * resource's own records - and on the templates that fill those records in.
 * Anything that changes what a stored value means (renaming an option of a
 * dropdown, CustomFieldOptionRename) has to reach every one of those tables,
 * and the saved views and forms that remember values too. This is the one
 * place that says which they are.
 *
 * Service references sit behind functions for the reason
 * CustomFieldMappingRegistry gives: the definition services import this
 * module and the value services import theirs, so a reference read while the
 * modules are still loading would be undefined. Built on first use, for the
 * same reason (a model's tableName is not there until its class is defined).
 *
 * Common/Tests/Server/Utils/CustomField/CustomFieldValueStores pins it to the
 * models: every definition model is listed, and every model with a
 * `customFields` column is a value table of one of them.
 */

export interface CustomFieldValueStore {
  // The definition table: "IncidentCustomField".
  definitionTableName: string;
  // How the definition is named in logs: "incident custom field".
  definitionName: string;
  /*
   * Every table that holds values of these fields under their names: the
   * records first, then the templates that fill records in.
   */
  getValueServices: () => Array<DatabaseService<any>>;
  // The records themselves: what the option editor counts.
  getRecordService: () => DatabaseService<any>;
  // The saved views of the tables that list the records.
  savedViewTableIds: Array<string>;
  /*
   * What a form whose questions can be these fields creates, so the answers
   * its templates hold for them are kept in step. Null when no form asks
   * them.
   */
  formTargetType: FormTargetType | null;
}

type BuildStoresFunction = () => Array<CustomFieldValueStore>;

const buildStores: BuildStoresFunction = (): Array<CustomFieldValueStore> => {
  type StoreFunction = (data: {
    definitionTableName: string;
    definitionName: string;
    getValueServices: () => Array<DatabaseService<any>>;
    formTargetType?: FormTargetType | undefined;
  }) => CustomFieldValueStore;

  const store: StoreFunction = (data: {
    definitionTableName: string;
    definitionName: string;
    getValueServices: () => Array<DatabaseService<any>>;
    formTargetType?: FormTargetType | undefined;
  }): CustomFieldValueStore => {
    return {
      definitionTableName: data.definitionTableName,
      definitionName: data.definitionName,
      getValueServices: data.getValueServices,
      getRecordService: (): DatabaseService<any> => {
        return data.getValueServices()[0]!;
      },
      savedViewTableIds: getCustomFieldSavedViewTableIds(
        data.definitionTableName,
      ),
      formTargetType: data.formTargetType || null,
    };
  };

  return [
    store({
      definitionTableName: new IncidentCustomField().tableName!,
      definitionName: "incident custom field",
      getValueServices: (): Array<DatabaseService<any>> => {
        return [IncidentService, IncidentTemplateService];
      },
      formTargetType: FormTargetType.Incident,
    }),
    store({
      definitionTableName: new AlertCustomField().tableName!,
      definitionName: "alert custom field",
      getValueServices: (): Array<DatabaseService<any>> => {
        return [AlertService];
      },
    }),
    store({
      definitionTableName: new ScheduledMaintenanceCustomField().tableName!,
      definitionName: "scheduled maintenance custom field",
      getValueServices: (): Array<DatabaseService<any>> => {
        return [
          ScheduledMaintenanceService,
          ScheduledMaintenanceTemplateService,
        ];
      },
      formTargetType: FormTargetType.ScheduledMaintenance,
    }),
    store({
      definitionTableName: new MonitorCustomField().tableName!,
      definitionName: "monitor custom field",
      getValueServices: (): Array<DatabaseService<any>> => {
        return [MonitorService, MonitorTemplateService];
      },
    }),
    store({
      definitionTableName: new StatusPageCustomField().tableName!,
      definitionName: "status page custom field",
      getValueServices: (): Array<DatabaseService<any>> => {
        return [StatusPageService];
      },
    }),
    store({
      definitionTableName: new OnCallDutyPolicyCustomField().tableName!,
      definitionName: "on-call policy custom field",
      getValueServices: (): Array<DatabaseService<any>> => {
        return [OnCallDutyPolicyService];
      },
    }),
    store({
      definitionTableName: new TeamCustomField().tableName!,
      definitionName: "team custom field",
      getValueServices: (): Array<DatabaseService<any>> => {
        return [TeamService];
      },
    }),
    store({
      definitionTableName: new TeamMemberCustomField().tableName!,
      definitionName: "team member custom field",
      getValueServices: (): Array<DatabaseService<any>> => {
        return [ProjectUserProfileService as DatabaseService<any>];
      },
    }),
    store({
      definitionTableName: new InventoryItemCustomField().tableName!,
      definitionName: "inventory custom field",
      getValueServices: (): Array<DatabaseService<any>> => {
        return [InventoryItemService as DatabaseService<any>];
      },
    }),
  ];
};

let STORES: Array<CustomFieldValueStore> | null = null;

export type GetCustomFieldValueStoresFunction =
  () => Array<CustomFieldValueStore>;

export const getCustomFieldValueStores: GetCustomFieldValueStoresFunction =
  (): Array<CustomFieldValueStore> => {
    if (!STORES) {
      STORES = buildStores();
    }

    return STORES;
  };

export type GetCustomFieldValueStoreFunction = (
  definitionTableName: string | undefined,
) => CustomFieldValueStore | undefined;

export const getCustomFieldValueStore: GetCustomFieldValueStoreFunction = (
  definitionTableName: string | undefined,
): CustomFieldValueStore | undefined => {
  if (!definitionTableName) {
    return undefined;
  }

  return getCustomFieldValueStores().find(
    (candidate: CustomFieldValueStore): boolean => {
      return candidate.definitionTableName === definitionTableName;
    },
  );
};
