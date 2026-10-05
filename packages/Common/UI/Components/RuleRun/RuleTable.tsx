import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Select from "../../../Types/BaseDatabase/Select";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { RuleRunType, RuleRunTypeUtil } from "../../../Types/Rules/RuleRun";
import Navigation from "../../Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { Yellow } from "../../../Types/BrandColors";
import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import { BulkActionProps } from "../ModelTable/BaseModelTable";
import Column from "../ModelTable/Column";
import ModelTable, {
  ComponentProps as ModelTableComponentProps,
} from "../ModelTable/ModelTable";
import Pill from "../Pill/Pill";
import {
  doesRuleAddNothing,
  getRuleActionColumns,
  getRuleActionSelect,
  RULE_ADDS_NOTHING_TEXT,
  RULE_ADDS_NOTHING_TOOLTIP,
  RuleActionColumns,
} from "./RuleAction";
import {
  RULE_ENABLED_COLUMN,
  withRuleEnabledOnEditOnly,
} from "./RuleEnabledField";
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

// The rule's status column: the one its Enabled switch is shown in.
function isStatusColumn<TBaseModel extends BaseModel>(
  column: Column<TBaseModel>,
): boolean {
  return Object.keys(column.field || {})[0] === RULE_ENABLED_COLUMN;
}

/*
 * A label or owner rule that adds nothing when it matches - one saved
 * before the form asked what it adds (RuleAction) - says so beside its
 * status: "Adds nothing". Every other row is drawn exactly as the page drew
 * it.
 */
function withAddsNothingMarker<TBaseModel extends BaseModel>(
  columns: Array<Column<TBaseModel>>,
  action: RuleActionColumns,
): Array<Column<TBaseModel>> {
  return columns.map((column: Column<TBaseModel>): Column<TBaseModel> => {
    const getElement: Column<TBaseModel>["getElement"] = column.getElement;

    if (!getElement || !isStatusColumn(column)) {
      return column;
    }

    return {
      ...column,
      getElement: (
        item: TBaseModel,
        onBeforeFetchData?: TBaseModel | undefined,
      ): ReactElement => {
        const status: ReactElement = getElement(item, onBeforeFetchData);

        if (!doesRuleAddNothing(item, action)) {
          return status;
        }

        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {status}
            <span data-testid="rule-adds-nothing">
              <Pill
                color={Yellow}
                text={RULE_ADDS_NOTHING_TEXT}
                tooltip={RULE_ADDS_NOTHING_TOOLTIP}
              />
            </span>
          </span>
        );
      },
    };
  });
}

/*
 * A table of rules. For rules that can be run - label, owner, privacy, and
 * status page and SLO monitor rules - it adds "Run Now" to each row and to
 * the bulk actions, and makes each rule viewable on its own page.
 *
 * Every rule starts on: the create form leaves out the rule's Enabled
 * switch, which stays on the edit form and in the table (RuleEnabledField).
 *
 * A label or owner rule that adds nothing - saved before the form asked
 * what it adds - says "Adds nothing" beside its status (RuleAction).
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

  // Every rule starts on: its create form leaves the Enabled switch out.
  const ruleTableProps: ModelTableComponentProps<TBaseModel> = {
    ...tableProps,
    formFields: tableProps.formFields
      ? withRuleEnabledOnEditOnly<TBaseModel>(tableProps.formFields)
      : tableProps.formFields,
  };

  /*
   * A label or owner rule's table reads what each rule adds, so a rule that
   * adds nothing says so beside its status. Only for a viewer who may read
   * all of it: selecting a column one may not read fails the whole list
   * (PermissionGate.canReadColumn), and a rule is never said to add nothing
   * from part of what it adds.
   */
  const ruleAction: RuleActionColumns | null = getRuleActionColumns(model);

  const canReadRuleAction: boolean = Boolean(
    ruleAction &&
      [...ruleAction.listColumns, ...ruleAction.switchColumns].every(
        (column: string): boolean => {
          return PermissionGate.canReadColumn(model, column);
        },
      ),
  );

  if (ruleAction && canReadRuleAction) {
    ruleTableProps.selectMoreFields = {
      ...(tableProps.selectMoreFields || {}),
      ...getRuleActionSelect(ruleAction),
    } as Select<TBaseModel>;
    ruleTableProps.columns = withAddsNothingMarker<TBaseModel>(
      tableProps.columns || [],
      ruleAction,
    );
  }

  const isViewable: boolean =
    props.isViewable ??
    Boolean(ruleType && (getRuleViewRoute || props.viewPageRoute));

  return (
    <Fragment>
      <ModelTable<TBaseModel>
        {...ruleTableProps}
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
