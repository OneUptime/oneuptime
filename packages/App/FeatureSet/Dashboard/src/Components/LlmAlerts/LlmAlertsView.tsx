import React, { FunctionComponent, ReactElement } from "react";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType from "Common/Types/Monitor/MonitorType";
import LlmMonitorTemplates, {
  LlmMonitorTemplate,
} from "Common/Types/Monitor/LlmMonitor/LlmMonitorTemplates";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../AppLink/AppLink";
import MonitorTable from "../Monitor/MonitorTable";
import PageMap from "../../Utils/PageMap";
import { RouteUtil } from "../../Utils/RouteMap";
import {
  getLlmMonitorCreateRoute,
  getLlmMonitorTemplateRoute,
} from "../../Utils/LlmMonitorPrefill";
import {
  LLM_MONITOR_TEMPLATE_COPY,
  LlmMonitorTemplateCopy,
} from "./LlmMonitorTemplateCopy";

/*
 * BEING TOLD WHEN THE AI ANSWERS BADLY.
 *
 * The alerts most AI apps want, one card each: what goes wrong, and when it
 * tells you. A card opens Create Monitor filled in - an AI / LLM monitor
 * counting that problem - where anything can be changed before saving.
 * Under the cards, the project's AI / LLM monitors, with their status.
 * Spend is watched by budgets, one link away.
 *
 * Creating is permission-gated the way the monitor table gates its own
 * create button: a viewer is not offered a form they cannot submit.
 */

export interface TemplateCardProps {
  template: LlmMonitorTemplate;
  canCreate: boolean;
}

export const LlmAlertTemplateCard: FunctionComponent<TemplateCardProps> = (
  props: TemplateCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: LlmMonitorTemplateCopy =
    LLM_MONITOR_TEMPLATE_COPY[props.template.id];

  return (
    <div
      className="flex flex-col rounded-lg bg-white p-4 shadow ring-1 ring-gray-200/80"
      data-testid="llm-alert-template"
      data-template-id={props.template.id}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${copy.iconTileClassName}`}
          aria-hidden="true"
        >
          <Icon icon={copy.icon} className={`h-5 w-5 ${copy.iconClassName}`} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">
            {translator.translateText(copy.title)}
          </div>
          <div className="mt-1 text-sm text-gray-600">
            {translator.translateText(copy.description)}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-1 items-end">
        {props.canCreate ? (
          <AppLink
            to={getLlmMonitorTemplateRoute(props.template.id)}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <span>{translator.translateText("Create alert") || ""}</span>
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </AppLink>
        ) : (
          <div className="text-xs text-gray-500">
            {translator.translateText(
              "You need permission to create monitors to set this up.",
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const LlmAlertsView: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  const createButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: "Create AI alert",
      onClick: () => {
        Navigation.navigate(getLlmMonitorCreateRoute());
      },
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Add,
    },
    new Monitor(),
    ModelAction.Create,
  );

  const canCreate: boolean = Boolean(createButton);
  const budgetsRoute: Route = RouteUtil.getPageRoute(PageMap.LLM_BUDGETS);

  return (
    <div className="space-y-6" data-testid="llm-alerts-view">
      <div>
        <div className="mb-3">
          <h2 className="text-base font-semibold text-gray-900">
            {translator.translateText("Get told when your AI answers badly")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            {translator.translateText(
              "Every answer is checked as it arrives: did it fail, was it refused, cut off, empty or flagged by your evaluations? Pick an alert to start from. You can change anything before you save it.",
            )}
          </p>
        </div>
        <div
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
          data-testid="llm-alert-templates"
        >
          {LlmMonitorTemplates.getAll().map(
            (template: LlmMonitorTemplate): ReactElement => {
              return (
                <LlmAlertTemplateCard
                  key={template.id}
                  template={template}
                  canCreate={canCreate}
                />
              );
            },
          )}
        </div>
      </div>

      <MonitorTable
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          monitorType: MonitorType.Llm,
        }}
        title="AI alerts"
        description="Monitors that count your AI's answers and alert when too many are bad."
        emptyState={{
          title: "No AI alerts yet",
          description:
            "Pick an alert above, or create one from scratch to choose exactly what counts as a bad answer.",
          icon: IconProp.Bell,
        }}
        disableCreate={true}
        cardButtons={createButton ? [createButton] : []}
        saveFilterProps={{
          tableId: "llm-alerts-monitors-table",
        }}
      />

      <div
        className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow sm:flex-row sm:items-center sm:justify-between"
        data-testid="llm-alerts-spend"
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50"
            aria-hidden="true"
          >
            <Icon
              icon={IconProp.CurrencyDollar}
              className="h-5 w-5 text-emerald-600"
            />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {translator.translateText("Spending too much?")}
            </div>
            <div className="mt-1 text-sm text-gray-600">
              {translator.translateText(
                "Set a daily spend limit for your AI on the Budgets tab.",
              )}
            </div>
          </div>
        </div>
        <AppLink
          to={budgetsRoute}
          className="inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <span>{translator.translateText("Open Budgets") || ""}</span>
          <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
        </AppLink>
      </div>
    </div>
  );
};

export default LlmAlertsView;
