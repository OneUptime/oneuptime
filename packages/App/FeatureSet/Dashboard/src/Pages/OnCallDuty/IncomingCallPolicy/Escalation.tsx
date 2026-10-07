import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUserElement from "../../../Components/User/ProjectUserElement";
import OnCallDutyScheduleElement from "../../../Components/OnCallDutySchedule/ScheduleElement";
import {
  getIncomingCallEscalationRuleFormFields,
  prepareIncomingCallRuleForCreate,
} from "../../../Components/OnCallPolicy/EscalationRule/IncomingCallEscalationRuleForm";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { getEscalationRuleDisplayName } from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { DEFAULT_INCOMING_CALL_RING_SECONDS } from "Common/Types/IncomingCall/IncomingCallRingTime";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * Who is rung when someone calls the policy's number, from the top of the
 * list down: one on-call schedule or one person per rule, each rung for its
 * own number of seconds. Adding or editing a rule is one short step - who
 * to call and how long to ring, with the name and the description folded
 * under Advanced (IncomingCallEscalationRuleForm.ts).
 *
 * Each rule shows who it calls first. A rule nobody named is shown after
 * its place in the list, "Level 2", as an on-call policy's levels are. That
 * name is not saved, so it follows the rule when the rules are dragged into
 * another order.
 */

// The rules on screen, in order, and the level of the first of them.
interface RulesOnScreen {
  ids: Array<string>;
  firstLevel: number;
  // Every rule of the policy, on this page or not.
  count: number;
}

const NO_RULES_ON_SCREEN: RulesOnScreen = {
  ids: [],
  firstLevel: 1,
  count: 0,
};

// A rule's level: its place in the whole list, or 0 when it is not on screen.
const getLevelOnScreen: (
  rulesOnScreen: RulesOnScreen,
  ruleId: string,
) => number = (rulesOnScreen: RulesOnScreen, ruleId: string): number => {
  const index: number = rulesOnScreen.ids.indexOf(ruleId);

  return index < 0 ? 0 : rulesOnScreen.firstLevel + index;
};

const IncomingCallPolicyEscalationPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const translator: Translator = useTranslator();

  /*
   * The rules on screen, twice. The list draws a fetch's cards in the render
   * its rules arrive in, before its columns are rebuilt, so the cards read
   * their levels from the ref, which onFetchSuccess has filled in by then.
   * The state is for the dialog, whose name placeholder is the level the
   * rule has, or will have at the end of the list.
   */
  const rulesOnScreenRef: React.MutableRefObject<RulesOnScreen> =
    useRef<RulesOnScreen>(NO_RULES_ON_SCREEN);
  const [rulesOnScreen, setRulesOnScreen] =
    useState<RulesOnScreen>(NO_RULES_ON_SCREEN);

  // Where the page being fetched starts: its first rule's level, less one.
  const pageStartRef: React.MutableRefObject<number> = useRef<number>(0);

  // The rule the edit dialog is open on; null while adding one.
  const [ruleIdToEdit, setRuleIdToEdit] = useState<string | null>(null);

  const isEditing: boolean = Boolean(ruleIdToEdit);

  const formLevel: number = ruleIdToEdit
    ? getLevelOnScreen(rulesOnScreen, ruleIdToEdit) || 1
    : rulesOnScreen.count + 1;

  const formFields: Array<ModelField<IncomingCallPolicyEscalationRule>> =
    useMemo((): Array<ModelField<IncomingCallPolicyEscalationRule>> => {
      return getIncomingCallEscalationRuleFormFields<IncomingCallPolicyEscalationRule>(
        {
          level: formLevel,
          isEditing: isEditing,
        },
      );
    }, [formLevel, isEditing]);

  return (
    <Fragment>
      <ModelTable<IncomingCallPolicyEscalationRule>
        modelType={IncomingCallPolicyEscalationRule}
        id="incoming-call-policy-escalation-rules-table"
        userPreferencesKey="incoming-call-policy-escalation-rules-table"
        isDeleteable={true}
        name="Incoming Call Policy > Escalation Rules"
        singularName="Escalation Rule"
        pluralName="Escalation Rules"
        createVerb="Add"
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          incomingCallPolicyId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        showAs={ShowAs.List}
        listDetailOptions={{
          showDetailsInNumberOfColumns: 2,
        }}
        onFetchInit={(pageNumber: number, itemsOnPage: number) => {
          pageStartRef.current = (pageNumber - 1) * itemsOnPage;
        }}
        onFetchSuccess={(
          rules: Array<IncomingCallPolicyEscalationRule>,
          totalCount: number,
        ) => {
          const onScreen: RulesOnScreen = {
            ids: rules.map((rule: IncomingCallPolicyEscalationRule): string => {
              return rule.id?.toString() || "";
            }),
            firstLevel: pageStartRef.current + 1,
            count: totalCount,
          };

          rulesOnScreenRef.current = onScreen;
          setRulesOnScreen(onScreen);
        }}
        onBeforeEdit={async (
          item: IncomingCallPolicyEscalationRule,
        ): Promise<IncomingCallPolicyEscalationRule> => {
          setRuleIdToEdit(item.id?.toString() || null);
          return item;
        }}
        onCreateEditModalClose={() => {
          setRuleIdToEdit(null);
        }}
        onBeforeCreate={async (
          item: IncomingCallPolicyEscalationRule,
        ): Promise<IncomingCallPolicyEscalationRule> => {
          item.incomingCallPolicyId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;

          return prepareIncomingCallRuleForCreate(item);
        }}
        cardProps={{
          title: "Escalation Rules",
          description:
            "Define the order in which users or schedules are called when an incoming call is received. Drag a rule to change when it is called.",
        }}
        formFields={formFields}
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              onCallDutyPolicySchedule: {
                _id: true,
                name: true,
                projectId: true,
              },
              user: {
                _id: true,
                name: true,
                email: true,
              },
            },
            title: "Who to call",
            type: FieldType.Entity,
            getElement: (
              item: IncomingCallPolicyEscalationRule,
            ): ReactElement => {
              if (item.onCallDutyPolicySchedule) {
                return (
                  <OnCallDutyScheduleElement
                    schedule={item.onCallDutyPolicySchedule}
                  />
                );
              }

              if (item.user) {
                // A rule never rings somebody who has left the project.
                return <ProjectUserElement user={item.user} />;
              }

              return <></>;
            },
          },
          {
            field: {
              escalateAfterSeconds: true,
            },
            title: "Ring for",
            type: FieldType.Number,
            getElement: (
              item: IncomingCallPolicyEscalationRule,
            ): ReactElement => {
              return (
                <span>
                  {translator.translatePlural(
                    {
                      one: "{{count}} second",
                      other: "{{count}} seconds",
                    },
                    item.escalateAfterSeconds ??
                      DEFAULT_INCOMING_CALL_RING_SECONDS,
                  )}
                </span>
              );
            },
          },
          {
            field: {
              name: true,
              description: true,
            },
            title: "Name",
            type: FieldType.Text,
            getElement: (
              item: IncomingCallPolicyEscalationRule,
            ): ReactElement => {
              const description: string = item.description?.toString() || "";

              return (
                <div>
                  <div>
                    {getEscalationRuleDisplayName(
                      item.name?.toString(),
                      getLevelOnScreen(
                        rulesOnScreenRef.current,
                        item.id?.toString() || "",
                      ),
                    )}
                  </div>
                  {description ? (
                    <p className="mt-1 text-sm text-gray-500">{description}</p>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default IncomingCallPolicyEscalationPage;
