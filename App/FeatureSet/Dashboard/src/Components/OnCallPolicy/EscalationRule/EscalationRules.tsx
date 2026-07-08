import ProjectUser from "../../../Utils/ProjectUser";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import Image from "Common/UI/Components/Image/Image";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import BlankProfilePic from "Common/UI/Images/users/blank-profile.svg";
import OnCallDutyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
  projectId: ObjectID;
}

interface RuleMembers {
  users: Array<User>;
  teams: Array<Team>;
  schedules: Array<OnCallDutyPolicySchedule>;
}

type MembersByRuleId = Record<string, RuleMembers>;

// Turns a raw minutes value into a compact human-readable string, e.g. "1 hr 30 min".
const formatMinutes: (minutes: number | undefined | null) => string = (
  minutes: number | undefined | null,
): string => {
  if (!minutes || minutes <= 0) {
    return "immediately";
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours: number = Math.floor(minutes / 60);
  const remainingMinutes: number = minutes % 60;

  if (remainingMinutes === 0) {
    return hours === 1 ? "1 hr" : `${hours} hrs`;
  }

  return `${hours} hr ${remainingMinutes} min`;
};

const EscalationRules: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rules, setRules] = useState<Array<OnCallDutyEscalationRule>>([]);
  const [membersByRuleId, setMembersByRuleId] = useState<MembersByRuleId>({});

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [ruleToEdit, setRuleToEdit] = useState<OnCallDutyEscalationRule | null>(
    null,
  );
  const [ruleToDelete, setRuleToDelete] =
    useState<OnCallDutyEscalationRule | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [reorderingRuleId, setReorderingRuleId] = useState<string | null>(null);

  const loadData: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const rulesResult: ListResult<OnCallDutyEscalationRule> =
        await ModelAPI.getList<OnCallDutyEscalationRule>({
          modelType: OnCallDutyEscalationRule,
          query: {
            onCallDutyPolicyId: props.onCallDutyPolicyId,
            projectId: props.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            description: true,
            escalateAfterInMinutes: true,
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      const [userJoins, teamJoins, scheduleJoins]: [
        ListResult<OnCallDutyPolicyEscalationRuleUser>,
        ListResult<OnCallDutyPolicyEscalationRuleTeam>,
        ListResult<OnCallDutyPolicyEscalationRuleSchedule>,
      ] = await Promise.all([
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleUser>({
          modelType: OnCallDutyPolicyEscalationRuleUser,
          query: { onCallDutyPolicyId: props.onCallDutyPolicyId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            onCallDutyPolicyEscalationRuleId: true,
            user: {
              _id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          sort: {},
        }),
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleTeam>({
          modelType: OnCallDutyPolicyEscalationRuleTeam,
          query: { onCallDutyPolicyId: props.onCallDutyPolicyId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            onCallDutyPolicyEscalationRuleId: true,
            team: {
              _id: true,
              name: true,
            },
          },
          sort: {},
        }),
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleSchedule>({
          modelType: OnCallDutyPolicyEscalationRuleSchedule,
          query: { onCallDutyPolicyId: props.onCallDutyPolicyId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            onCallDutyPolicyEscalationRuleId: true,
            onCallDutyPolicySchedule: {
              _id: true,
              name: true,
            },
          },
          sort: {},
        }),
      ]);

      const members: MembersByRuleId = {};

      const ensureRule: (ruleId: string | undefined) => RuleMembers | null = (
        ruleId: string | undefined,
      ): RuleMembers | null => {
        if (!ruleId) {
          return null;
        }
        if (!members[ruleId]) {
          members[ruleId] = { users: [], teams: [], schedules: [] };
        }
        return members[ruleId]!;
      };

      for (const join of userJoins.data) {
        const bucket: RuleMembers | null = ensureRule(
          join.onCallDutyPolicyEscalationRuleId?.toString(),
        );
        if (bucket && join.user) {
          bucket.users.push(join.user);
        }
      }

      for (const join of teamJoins.data) {
        const bucket: RuleMembers | null = ensureRule(
          join.onCallDutyPolicyEscalationRuleId?.toString(),
        );
        if (bucket && join.team) {
          bucket.teams.push(join.team);
        }
      }

      for (const join of scheduleJoins.data) {
        const bucket: RuleMembers | null = ensureRule(
          join.onCallDutyPolicyEscalationRuleId?.toString(),
        );
        if (bucket && join.onCallDutyPolicySchedule) {
          bucket.schedules.push(join.onCallDutyPolicySchedule);
        }
      }

      setRules(rulesResult.data);
      setMembersByRuleId(members);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await loadData();
  }, []);

  const moveRule: (
    rule: OnCallDutyEscalationRule,
    targetOrder: number,
  ) => Promise<void> = async (
    rule: OnCallDutyEscalationRule,
    targetOrder: number,
  ): Promise<void> => {
    if (!rule.id) {
      return;
    }

    try {
      setReorderingRuleId(rule.id.toString());
      await ModelAPI.updateById({
        modelType: OnCallDutyEscalationRule,
        id: rule.id,
        data: {
          order: targetOrder,
        } as JSONObject,
      });
      await loadData();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setReorderingRuleId(null);
  };

  const confirmDelete: () => Promise<void> = async (): Promise<void> => {
    if (!ruleToDelete || !ruleToDelete.id) {
      return;
    }

    try {
      setIsDeleting(true);
      await ModelAPI.deleteItem({
        modelType: OnCallDutyEscalationRule,
        id: ruleToDelete.id,
      });
      setRuleToDelete(null);
      await loadData();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setRuleToDelete(null);
    }

    setIsDeleting(false);
  };

  const getUserChip: (user: User) => ReactElement = (
    user: User,
  ): ReactElement => {
    const userId: ObjectID | null = user.id || null;
    const imageRoute: Route = userId
      ? UserUtil.getProfilePictureRoute(userId)
      : Route.fromString(`${BlankProfilePic}`);
    const name: string =
      user.name?.toString() || user.email?.toString() || "User";

    return (
      <span
        key={`user-${userId?.toString()}`}
        className="inline-flex items-center gap-2 rounded-full bg-white ring-1 ring-inset ring-gray-200 py-0.5 pl-0.5 pr-3 shadow-sm"
      >
        <Image
          className="h-6 w-6 rounded-full bg-gray-100 object-cover"
          imageUrl={imageRoute}
          alt={name}
        />
        <span className="text-sm font-medium text-gray-700">{name}</span>
      </span>
    );
  };

  const getTeamChip: (team: Team) => ReactElement = (
    team: Team,
  ): ReactElement => {
    return (
      <span
        key={`team-${team.id?.toString()}`}
        className="inline-flex items-center gap-2 rounded-full bg-white ring-1 ring-inset ring-gray-200 py-1 pl-1 pr-3 shadow-sm"
      >
        <span className="h-6 w-6 rounded-full bg-violet-100 flex items-center justify-center">
          <Icon icon={IconProp.Team} className="h-3.5 w-3.5 text-violet-600" />
        </span>
        <span className="text-sm font-medium text-gray-700">
          {team.name?.toString()}
        </span>
      </span>
    );
  };

  const getScheduleChip: (
    schedule: OnCallDutyPolicySchedule,
  ) => ReactElement = (schedule: OnCallDutyPolicySchedule): ReactElement => {
    return (
      <span
        key={`schedule-${schedule.id?.toString()}`}
        className="inline-flex items-center gap-2 rounded-full bg-white ring-1 ring-inset ring-gray-200 py-1 pl-1 pr-3 shadow-sm"
      >
        <span className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center">
          <Icon
            icon={IconProp.Calendar}
            className="h-3.5 w-3.5 text-indigo-600"
          />
        </span>
        <span className="text-sm font-medium text-gray-700">
          {schedule.name?.toString()}
        </span>
      </span>
    );
  };

  const getNotifiesSection: (members: RuleMembers) => ReactElement = (
    members: RuleMembers,
  ): ReactElement => {
    const totalCount: number =
      members.users.length + members.teams.length + members.schedules.length;

    if (totalCount === 0) {
      return (
        <div className="inline-flex items-start gap-2 rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2 text-sm text-amber-800">
          <Icon
            icon={IconProp.Alert}
            className="h-4 w-4 text-amber-500 mt-0.5 shrink-0"
          />
          <span>
            No responders assigned. No one will be notified at this level —
            delete this rule or add responders.
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        {members.schedules.map((schedule: OnCallDutyPolicySchedule) => {
          return getScheduleChip(schedule);
        })}
        {members.teams.map((team: Team) => {
          return getTeamChip(team);
        })}
        {members.users.map((user: User) => {
          return getUserChip(user);
        })}
      </div>
    );
  };

  type IconButtonProps = {
    icon: IconProp;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
  };

  const getIconButton: (buttonProps: IconButtonProps) => ReactElement = (
    buttonProps: IconButtonProps,
  ): ReactElement => {
    return (
      <Tooltip text={buttonProps.label}>
        <button
          type="button"
          aria-label={buttonProps.label}
          disabled={buttonProps.disabled}
          onClick={buttonProps.onClick}
          className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none ${
            buttonProps.danger
              ? "text-gray-400 hover:text-red-600 hover:bg-red-50"
              : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          <Icon icon={buttonProps.icon} className="h-4 w-4" />
        </button>
      </Tooltip>
    );
  };

  const getRuleCard: (
    rule: OnCallDutyEscalationRule,
    index: number,
  ) => ReactElement = (
    rule: OnCallDutyEscalationRule,
    index: number,
  ): ReactElement => {
    const ruleId: string = rule.id?.toString() || "";
    const members: RuleMembers = membersByRuleId[ruleId] || {
      users: [],
      teams: [],
      schedules: [],
    };
    const isFirst: boolean = index === 0;
    const isLast: boolean = index === rules.length - 1;
    const isReordering: boolean = reorderingRuleId === ruleId;

    return (
      <div
        key={ruleId}
        className={`group rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:border-indigo-300 hover:shadow-md ${
          isReordering ? "opacity-60 pointer-events-none" : ""
        }`}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-4">
            {/* Level badge */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-sm font-semibold text-white shadow-sm ring-1 ring-inset ring-indigo-700/20">
              {index + 1}
            </div>

            <div className="min-w-0 flex-1">
              {/* Header: name + escalation timing + actions */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-gray-900">
                      {rule.name?.toString() || `Escalation Level ${index + 1}`}
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
                      <Icon
                        icon={IconProp.Clock}
                        className="h-3 w-3 text-gray-400"
                      />
                      Escalates after{" "}
                      {formatMinutes(rule.escalateAfterInMinutes)}
                    </span>
                  </div>
                  {rule.description?.toString() ? (
                    <p className="mt-1 text-sm leading-relaxed text-gray-500">
                      {rule.description.toString()}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-0.5">
                  {getIconButton({
                    icon: IconProp.ArrowUp,
                    label: "Move up",
                    disabled: isFirst,
                    onClick: () => {
                      const previous: OnCallDutyEscalationRule | undefined =
                        rules[index - 1];
                      if (previous && previous.order !== undefined) {
                        moveRule(rule, previous.order).catch(() => {});
                      }
                    },
                  })}
                  {getIconButton({
                    icon: IconProp.ArrowDown,
                    label: "Move down",
                    disabled: isLast,
                    onClick: () => {
                      const next: OnCallDutyEscalationRule | undefined =
                        rules[index + 1];
                      if (next && next.order !== undefined) {
                        moveRule(rule, next.order).catch(() => {});
                      }
                    },
                  })}
                  {getIconButton({
                    icon: IconProp.Edit,
                    label: "Edit rule",
                    onClick: () => {
                      return setRuleToEdit(rule);
                    },
                  })}
                  {getIconButton({
                    icon: IconProp.Trash,
                    label: "Delete rule",
                    danger: true,
                    onClick: () => {
                      return setRuleToDelete(rule);
                    },
                  })}
                </div>
              </div>

              {/* Notifies */}
              <div className="mt-4">
                <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Notifies
                </div>
                {getNotifiesSection(members)}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getConnector: (rule: OnCallDutyEscalationRule) => ReactElement = (
    rule: OnCallDutyEscalationRule,
  ): ReactElement => {
    return (
      <div className="flex flex-col items-center py-1">
        <div className="h-3 w-px bg-gray-200" />
        <div className="my-1 inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
          <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 text-gray-400" />
          <span>
            If unacknowledged after{" "}
            <span className="font-semibold text-gray-900">
              {formatMinutes(rule.escalateAfterInMinutes)}
            </span>
            , escalate to the next level
          </span>
        </div>
        <Icon icon={IconProp.ChevronDown} className="h-4 w-4 text-gray-300" />
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="flex w-full justify-center py-16">
          <ComponentLoader />
        </div>
      );
    }

    if (error) {
      return <ErrorMessage message={error} onRefreshClick={loadData} />;
    }

    if (rules.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50">
          <EmptyState
            id="no-escalation-rules"
            icon={IconProp.Bell}
            title={"No escalation rules yet"}
            description={
              "Escalation rules decide who gets paged and how quickly the alert climbs the ladder when no one responds. Add your first rule to get started."
            }
            footer={
              <Button
                title="Add Escalation Rule"
                icon={IconProp.Add}
                buttonStyle={ButtonStyleType.PRIMARY}
                onClick={() => {
                  return setShowCreateModal(true);
                }}
              />
            }
          />
        </div>
      );
    }

    return (
      <div>
        {rules.map((rule: OnCallDutyEscalationRule, index: number) => {
          return (
            <Fragment key={rule.id?.toString() || index}>
              {getRuleCard(rule, index)}
              {index !== rules.length - 1 ? getConnector(rule) : <></>}
            </Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <Fragment>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 ring-1 ring-inset ring-indigo-200">
              <Icon icon={IconProp.Bell} className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Escalation Rules
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Who gets notified when an incident is triggered, and how it
                climbs the ladder if no one responds.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:shrink-0">
            <Button
              title="Refresh"
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                loadData().catch(() => {});
              }}
            />
            <Button
              title="Add Escalation Rule"
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.PRIMARY}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                return setShowCreateModal(true);
              }}
            />
          </div>
        </div>

        {/* Body */}
        <div className="p-6">{getBody()}</div>
      </div>

      {/* Create modal */}
      {showCreateModal ? (
        <ModelFormModal<OnCallDutyEscalationRule>
          title="Add Escalation Rule"
          name="Create Escalation Rule"
          description="Escalation rules determine who to contact, and when, once an incident is triggered."
          modalWidth={ModalWidth.Medium}
          modelType={OnCallDutyEscalationRule}
          submitButtonText="Create Rule"
          onClose={() => {
            return setShowCreateModal(false);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            loadData().catch(() => {});
          }}
          onBeforeCreate={(
            item: OnCallDutyEscalationRule,
          ): Promise<OnCallDutyEscalationRule> => {
            item.onCallDutyPolicyId = props.onCallDutyPolicyId;
            item.projectId = props.projectId;
            return Promise.resolve(item);
          }}
          formProps={{
            name: "Create Escalation Rule",
            modelType: OnCallDutyEscalationRule,
            id: "create-escalation-rule-form",
            formType: FormType.Create,
            steps: [
              { title: "Overview", id: "overview" },
              { title: "Notify", id: "notification" },
              { title: "Escalation", id: "escalation" },
            ],
            fields: [
              {
                field: { name: true },
                stepId: "overview",
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "First Responders",
                description: "A short name to identify this escalation rule.",
              },
              {
                field: { description: true },
                stepId: "overview",
                title: "Description",
                fieldType: FormFieldSchemaType.LongText,
                required: false,
                placeholder: "Describe who this level notifies and why.",
                description:
                  "An optional description for this escalation rule.",
              },
              {
                overrideField: { onCallSchedules: true },
                showEvenIfPermissionDoesNotExist: true,
                title: "On-Call Schedules",
                stepId: "notification",
                description:
                  "On-call schedules to notify. The person currently on-call will be contacted.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: OnCallDutyPolicySchedule,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Select on-call schedules",
                overrideFieldKey: "onCallSchedules",
              },
              {
                overrideField: { teams: true },
                showEvenIfPermissionDoesNotExist: true,
                title: "Teams",
                stepId: "notification",
                description:
                  "Every member of the selected teams will be notified.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: Team,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Select teams",
                overrideFieldKey: "teams",
              },
              {
                overrideField: { users: true },
                showEvenIfPermissionDoesNotExist: true,
                title: "Users",
                stepId: "notification",
                description: "Specific users to notify directly.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                fetchDropdownOptions: async () => {
                  return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                    ProjectUtil.getCurrentProjectId()!,
                  );
                },
                required: false,
                placeholder: "Select users",
                overrideFieldKey: "users",
              },
              {
                field: { escalateAfterInMinutes: true },
                stepId: "escalation",
                title: "Escalate after (in minutes)",
                fieldType: FormFieldSchemaType.Number,
                placeholder: "30",
                required: true,
                description:
                  "How long to wait for an acknowledgement before escalating to the next rule.",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {/* Edit modal */}
      {ruleToEdit ? (
        <ModelFormModal<OnCallDutyEscalationRule>
          title="Edit Escalation Rule"
          name="Edit Escalation Rule"
          description="Update the name, description, and escalation timing for this rule."
          modelType={OnCallDutyEscalationRule}
          modelIdToEdit={ruleToEdit.id!}
          submitButtonText="Save Changes"
          onClose={() => {
            return setRuleToEdit(null);
          }}
          onSuccess={() => {
            setRuleToEdit(null);
            loadData().catch(() => {});
          }}
          formProps={{
            name: "Edit Escalation Rule",
            modelType: OnCallDutyEscalationRule,
            id: "edit-escalation-rule-form",
            formType: FormType.Update,
            fields: [
              {
                field: { name: true },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "First Responders",
                description: "A short name to identify this escalation rule.",
              },
              {
                field: { description: true },
                title: "Description",
                fieldType: FormFieldSchemaType.LongText,
                required: false,
                placeholder: "Describe who this level notifies and why.",
                description:
                  "An optional description for this escalation rule.",
              },
              {
                field: { escalateAfterInMinutes: true },
                title: "Escalate after (in minutes)",
                fieldType: FormFieldSchemaType.Number,
                placeholder: "30",
                required: true,
                description:
                  "How long to wait for an acknowledgement before escalating to the next rule.",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {/* Delete confirmation */}
      {ruleToDelete ? (
        <ConfirmModal
          title="Delete Escalation Rule"
          description={`Are you sure you want to delete "${
            ruleToDelete.name?.toString() || "this escalation rule"
          }"? Its notification targets will be removed. This action cannot be undone.`}
          submitButtonText="Delete Rule"
          submitButtonType={ButtonStyleType.DANGER}
          closeButtonText="Cancel"
          isLoading={isDeleting}
          onSubmit={() => {
            confirmDelete().catch(() => {});
          }}
          onClose={() => {
            return setRuleToDelete(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default EscalationRules;
