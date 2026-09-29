import IncidentCustomFieldTemplateVariablesCopy from "./IncidentCustomFieldTemplateVariablesCopy";
import { CUSTOM_FIELD_TYPE_LABELS } from "../CustomFields/CustomFieldSettingsCopy";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { sortCustomFieldDefinitions } from "Common/Types/CustomField/CustomFieldOrder";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  getCustomFieldTemplateVariableName,
  isValidCustomFieldVariableKey,
} from "Common/Types/CustomField/CustomFieldVariableKey";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Under a subscriber notification template's variable reference, for an
 * incident event: the project's incident custom fields, each with the
 * {{customFields.<key>}} variable that places its value, and whether it is
 * already in the default messages (Include in Subscriber Notifications).
 *
 * The reference names the variable family with its key left open; only the
 * project knows its keys, so they are read here. Above them is a warning:
 * custom field values and {{affectedStatusPages}} are internal data that a
 * template author could send to people outside the team - and a line saying
 * who may place custom fields and labels at all, which the save enforces.
 *
 * Reading the fields needs a permission and a plan with custom fields; when
 * that fails the warning still shows, with a line saying the fields could
 * not be listed.
 */

export interface ComponentProps {
  eventType?: StatusPageSubscriberNotificationEventType | undefined;
}

export interface IncidentCustomFieldTemplateVariableRow {
  variableName: string;
  name: string;
  customFieldType?: CustomFieldType | undefined;
  isIncludedInSubscriberNotifications: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; rows: Array<IncidentCustomFieldTemplateVariableRow> }
  | { status: "failed" };

/**
 * The project's incident custom fields that a template can place, in their
 * order. Throws when they cannot be read.
 */
export const fetchIncidentCustomFieldTemplateVariables: () => Promise<
  Array<IncidentCustomFieldTemplateVariableRow>
> = async (): Promise<Array<IncidentCustomFieldTemplateVariableRow>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const result: ListResult<IncidentCustomField> =
    await ModelAPI.getList<IncidentCustomField>({
      modelType: IncidentCustomField,
      query: projectId ? { projectId: projectId } : {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        name: true,
        variableKey: true,
        customFieldType: true,
        includeInSubscriberNotifications: true,
        sortOrder: true,
      },
      sort: {
        sortOrder: SortOrder.Ascending,
      },
    });

  return sortCustomFieldDefinitions(result.data || [])
    .filter((field: IncidentCustomField): boolean => {
      return (
        Boolean(field.name) && isValidCustomFieldVariableKey(field.variableKey)
      );
    })
    .map(
      (field: IncidentCustomField): IncidentCustomFieldTemplateVariableRow => {
        return {
          variableName: getCustomFieldTemplateVariableName(field.variableKey!),
          name: field.name!,
          customFieldType: field.customFieldType,
          isIncludedInSubscriberNotifications:
            field.includeInSubscriberNotifications === true,
        };
      },
    );
};

const IncidentCustomFieldTemplateVariables: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const offersCustomFields: boolean = Boolean(
    props.eventType &&
      SubscriberNotificationTemplateVariables.getDynamicVariablesForEventType(
        props.eventType,
      ).length > 0,
  );

  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!offersCustomFields) {
      return;
    }

    let isCurrent: boolean = true;

    setState({ status: "loading" });

    fetchIncidentCustomFieldTemplateVariables()
      .then((rows: Array<IncidentCustomFieldTemplateVariableRow>) => {
        if (isCurrent) {
          setState({ status: "loaded", rows: rows });
        }
      })
      .catch(() => {
        if (isCurrent) {
          setState({ status: "failed" });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [offersCustomFields]);

  if (!offersCustomFields) {
    return <Fragment />;
  }

  const copy: typeof IncidentCustomFieldTemplateVariablesCopy =
    IncidentCustomFieldTemplateVariablesCopy;

  return (
    <div
      className="space-y-3"
      data-testid="incident-custom-field-template-variables"
    >
      <Alert
        type={AlertType.WARNING}
        dataTestId="incident-template-variables-internal-data-warning"
        strongTitle={copy.internalDataWarningTitle}
        title={copy.internalDataWarning}
      />

      <p
        className="text-xs text-gray-600"
        data-testid="incident-template-variables-placement-permission"
      >
        {tx(copy.placementPermission)}
      </p>

      <div>
        <p className="text-sm font-semibold text-gray-900">
          {tx(copy.customFieldsTitle)}
        </p>
        <p className="mt-1 text-xs text-gray-600">
          {tx(copy.customFieldsDescription)}
        </p>
      </div>

      {state.status === "failed" ? (
        <p
          className="text-sm text-gray-600"
          data-testid="incident-custom-field-template-variables-unavailable"
        >
          {tx(copy.customFieldsUnavailable)}
        </p>
      ) : null}

      {state.status === "loaded" && state.rows.length === 0 ? (
        <p
          className="text-sm text-gray-600"
          data-testid="incident-custom-field-template-variables-empty"
        >
          {tx(copy.noCustomFields)}
        </p>
      ) : null}

      {state.status === "loaded" && state.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500">
                <th className="py-2 pr-4">{tx(copy.variableColumnTitle)}</th>
                <th className="py-2 pr-4">{tx(copy.fieldNameColumnTitle)}</th>
                <th className="py-2 pr-4">{tx(copy.fieldTypeColumnTitle)}</th>
                <th className="py-2">{tx(copy.includedColumnTitle)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {state.rows.map(
                (row: IncidentCustomFieldTemplateVariableRow): ReactElement => {
                  return (
                    <tr
                      key={row.variableName}
                      data-testid={`incident-custom-field-template-variable-${row.variableName}`}
                    >
                      <td className="py-2 pr-4">
                        <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
                          {`{{${row.variableName}}}`}
                        </code>
                      </td>
                      {/* A name a project member typed: shown as written. */}
                      <td className="py-2 pr-4 text-gray-900">{row.name}</td>
                      <td className="py-2 pr-4 text-gray-700">
                        {row.customFieldType
                          ? tx(
                              CUSTOM_FIELD_TYPE_LABELS[row.customFieldType] ||
                                row.customFieldType,
                            )
                          : ""}
                      </td>
                      <td className="py-2 text-gray-700">
                        {tx(
                          row.isIncludedInSubscriberNotifications
                            ? copy.yes
                            : copy.no,
                        )}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

export default IncidentCustomFieldTemplateVariables;
