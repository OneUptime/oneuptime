import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { RuleRunType, RuleRunTypeUtil } from "../../../Types/Rules/RuleRun";
import Navigation from "../../Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import { BulkActionProps } from "../ModelTable/BaseModelTable";
import ModelTable, {
  ComponentProps as ModelTableComponentProps,
} from "../ModelTable/ModelTable";
import RuleView from "./RuleView";
import RunRuleNowModal from "./RunRuleNowModal";
import getRunRulesBulkAction from "./RunRulesBulkAction";
import React, { Fragment, ReactElement, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel>
  extends ModelTableComponentProps<TBaseModel> {
  /*
   * When set, the rule's own page is rendered instead of the table - so a
   * rule's view page is the same component, with the same form fields, as the
   * table that lists it.
   */
  viewRuleId?: ObjectID | undefined;
  // Where a row's View button goes. Defaults to viewPageRoute + "/<id>".
  getRuleViewRoute?: ((item: TBaseModel) => Route) | undefined;
  /*
   * The table's own route, where the view page returns once its rule is
   * deleted. Defaults to the current route minus its last segment.
   */
  listRoute?: Route | undefined;
}

function getParentRoute(): Route {
  return new Route(
    Navigation.getCurrentRoute()
      .toString()
      .replace(/\/+$/, "")
      .replace(/\/[^/]+$/, ""),
  );
}

/*
 * A table of rules. For rules that can be run - label, owner, privacy and
 * status page monitor rules - it adds "Run Now" to each row and to the bulk
 * actions, and makes each rule viewable on its own page.
 */
const RuleTable: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [ruleBeingRun, setRuleBeingRun] = useState<{
    id: string;
    name: string | undefined;
  } | null>(null);

  const { viewRuleId, getRuleViewRoute, listRoute, ...tableProps } = props;

  const model: TBaseModel = new props.modelType();
  const ruleType: RuleRunType | null = RuleRunTypeUtil.fromTableName(
    model.tableName,
  );

  if (viewRuleId) {
    return (
      <RuleView<TBaseModel>
        modelType={props.modelType}
        ruleId={viewRuleId}
        formFields={props.formFields || []}
        formSteps={props.formSteps}
        listRoute={listRoute || getParentRoute()}
        createEditModalWidth={props.createEditModalWidth}
        modelAPI={props.modelAPI}
      />
    );
  }

  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
  );
  const canOfferRun: boolean = Boolean(
    ruleType && (updateGate.isAllowed || updateGate.disabledReason),
  );

  const actionButtons: Array<ActionButtonSchema<TBaseModel>> = [
    ...(props.actionButtons || []),
  ];

  let bulkActions: BulkActionProps<TBaseModel> | undefined = props.bulkActions;

  if (ruleType && canOfferRun) {
    actionButtons.push({
      title: "Run Now",
      icon: IconProp.Play,
      buttonStyleType: ButtonStyleType.NORMAL,
      disabled: !updateGate.isAllowed,
      tooltip: updateGate.disabledReason,
      onClick: (
        item: TBaseModel,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ) => {
        try {
          const id: string | undefined =
            item.id?.toString() || item._id?.toString();

          if (id && updateGate.isAllowed) {
            const name: unknown = (item as unknown as Record<string, unknown>)[
              "name"
            ];

            setRuleBeingRun({
              id: id,
              name: typeof name === "string" ? name : undefined,
            });
          }

          onCompleteAction();
        } catch (err) {
          onCompleteAction();
          onError(err as Error);
        }
      },
    });

    bulkActions = {
      ...(props.bulkActions || {}),
      buttons: [
        ...(props.bulkActions?.buttons || []),
        getRunRulesBulkAction<TBaseModel>({
          ruleType: ruleType,
          modelType: props.modelType,
        }),
      ],
    };
  }

  const isViewable: boolean =
    props.isViewable ??
    Boolean(ruleType && (getRuleViewRoute || props.viewPageRoute));

  return (
    <Fragment>
      <ModelTable<TBaseModel>
        {...tableProps}
        actionButtons={actionButtons}
        bulkActions={bulkActions}
        isViewable={isViewable}
        {...(getRuleViewRoute
          ? {
              onViewPage: (item: TBaseModel): Promise<Route | URL> => {
                return Promise.resolve(getRuleViewRoute(item));
              },
            }
          : {})}
      />

      {ruleType && ruleBeingRun ? (
        <RunRuleNowModal
          ruleType={ruleType}
          ruleId={ruleBeingRun.id}
          ruleName={ruleBeingRun.name}
          onClose={() => {
            setRuleBeingRun(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default RuleTable;
