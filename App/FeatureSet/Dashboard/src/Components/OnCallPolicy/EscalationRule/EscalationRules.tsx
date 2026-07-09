import ProjectUser from "../../../Utils/ProjectUser";
import EscalationSummary, {
  EscalationLevelSummary,
  EscalationResponder,
} from "./EscalationSummary";
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
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
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
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
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
  useRef,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
  projectId: ObjectID;
}

/*
 * The join rows for a single escalation rule. We keep the whole join row (not
 * just the entity) so we have both the entity to render AND the join-row id,
 * which is what we delete when a responder is removed during an edit.
 */
interface RuleMembers {
  userJoins: Array<OnCallDutyPolicyEscalationRuleUser>;
  teamJoins: Array<OnCallDutyPolicyEscalationRuleTeam>;
  scheduleJoins: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}

type MembersByRuleId = Record<string, RuleMembers>;

/*
 * The selected responder ids captured live from the edit form, keyed by the
 * override-field name used in the form.
 */
interface SelectedMembers {
  users: Array<string>;
  teams: Array<string>;
  onCallSchedules: Array<string>;
}

// Prefill values for the edit form's member multi-selects.
interface MemberDefaults {
  users: Array<DropdownOption>;
  teams: Array<DropdownOption>;
  onCallSchedules: Array<DropdownOption>;
}

const emptyRuleMembers: () => RuleMembers = (): RuleMembers => {
  return { userJoins: [], teamJoins: [], scheduleJoins: [] };
};

/*
 * Normalizes a form multi-select value (which may be an array of ids, or an
 * array of { value, label } option envelopes when seeded as a default) into a
 * plain array of id strings.
 */
const toIdArray: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Array<string> = [];
  for (const item of value) {
    if (item === null || item === undefined) {
      continue;
    }
    if (
      typeof item === "object" &&
      "value" in (item as Record<string, unknown>)
    ) {
      const inner: unknown = (item as Record<string, unknown>)["value"];
      if (inner !== null && inner !== undefined) {
        ids.push(String(inner));
      }
    } else {
      ids.push(String(item));
    }
  }
  return ids;
};

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

const RULE_FORM_STEPS: Array<{ title: string; id: string }> = [
  { title: "Overview", id: "overview" },
  { title: "Notify", id: "notification" },
  { title: "Escalation", id: "escalation" },
];

/*
 * getDefaultValue is typed to return a scalar, but a multi-select form value is
 * an array of option envelopes. The form assigns whatever we return verbatim,
 * so we cast to satisfy the type while returning the option array at runtime.
 */
const memberFieldDefault: (
  options: Array<DropdownOption>,
) => (item: FormValues<OnCallDutyEscalationRule>) => string = (
  options: Array<DropdownOption>,
): ((item: FormValues<OnCallDutyEscalationRule>) => string) => {
  return (() => {
    return options;
  }) as unknown as (item: FormValues<OnCallDutyEscalationRule>) => string;
};

/*
 * Builds the create/edit form fields. When memberDefaults is provided (edit
 * mode), the member multi-selects are pre-populated with the rule's current
 * responders via getDefaultValue.
 */
const buildRuleFormFields: (
  memberDefaults?: MemberDefaults,
) => Array<ModelField<OnCallDutyEscalationRule>> = (
  memberDefaults?: MemberDefaults,
): Array<ModelField<OnCallDutyEscalationRule>> => {
  return [
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
      description: "An optional description for this escalation rule.",
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
      getDefaultValue: memberDefaults
        ? memberFieldDefault(memberDefaults.onCallSchedules)
        : undefined,
    },
    {
      overrideField: { teams: true },
      showEvenIfPermissionDoesNotExist: true,
      title: "Teams",
      stepId: "notification",
      description: "Every member of the selected teams will be notified.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Team,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select teams",
      overrideFieldKey: "teams",
      getDefaultValue: memberDefaults
        ? memberFieldDefault(memberDefaults.teams)
        : undefined,
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
      getDefaultValue: memberDefaults
        ? memberFieldDefault(memberDefaults.users)
        : undefined,
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
  ];
};

/*
 * Reconciles one join-table (users/teams/schedules) for a rule: creates rows
 * for newly-added responders and deletes rows for removed ones.
 */
const syncJoinType: <TJoin extends BaseModel>(config: {
  latestIds: Array<string>;
  joins: Array<TJoin>;
  getEntityId: (join: TJoin) => string | undefined;
  createOne: (entityId: string) => Promise<void>;
  modelType: { new (): TJoin };
}) => Promise<void> = async <TJoin extends BaseModel>(config: {
  latestIds: Array<string>;
  joins: Array<TJoin>;
  getEntityId: (join: TJoin) => string | undefined;
  createOne: (entityId: string) => Promise<void>;
  modelType: { new (): TJoin };
}): Promise<void> => {
  const originalIds: Set<string> = new Set(
    config.joins
      .map((join: TJoin) => {
        return config.getEntityId(join);
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      }),
  );
  const latestIdSet: Set<string> = new Set(config.latestIds);

  for (const id of config.latestIds) {
    if (!originalIds.has(id)) {
      await config.createOne(id);
    }
  }

  for (const join of config.joins) {
    const entityId: string | undefined = config.getEntityId(join);
    if (entityId && !latestIdSet.has(entityId) && join.id) {
      await ModelAPI.deleteItem({ modelType: config.modelType, id: join.id });
    }
  }
};

const EscalationRules: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rules, setRules] = useState<Array<OnCallDutyEscalationRule>>([]);
  const [membersByRuleId, setMembersByRuleId] = useState<MembersByRuleId>({});

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // Repeat-policy config, surfaced in the escalation summary's terminator node.
  const [repeatEnabled, setRepeatEnabled] = useState<boolean>(false);
  const [repeatCount, setRepeatCount] = useState<number>(0);

  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [ruleToEdit, setRuleToEdit] = useState<OnCallDutyEscalationRule | null>(
    null,
  );
  const [ruleToDelete, setRuleToDelete] =
    useState<OnCallDutyEscalationRule | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [reorderingRuleId, setReorderingRuleId] = useState<string | null>(null);

  /*
   * The live responder selection captured from the edit form. Seeded to the
   * rule's current responders when the edit modal opens.
   */
  const editedMembersRef: React.MutableRefObject<SelectedMembers> =
    useRef<SelectedMembers>({ users: [], teams: [], onCallSchedules: [] });

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

      // Repeat behavior, so the summary can describe what happens after the
      // final level with no acknowledgement.
      const policy: OnCallDutyPolicy | null =
        await ModelAPI.getItem<OnCallDutyPolicy>({
          modelType: OnCallDutyPolicy,
          id: props.onCallDutyPolicyId,
          select: {
            repeatPolicyIfNoOneAcknowledges: true,
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
          },
        });
      setRepeatEnabled(Boolean(policy?.repeatPolicyIfNoOneAcknowledges));
      setRepeatCount(policy?.repeatPolicyIfNoOneAcknowledgesNoOfTimes || 0);

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
            _id: true,
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
            _id: true,
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
            _id: true,
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
          members[ruleId] = emptyRuleMembers();
        }
        return members[ruleId]!;
      };

      for (const join of userJoins.data) {
        const bucket: RuleMembers | null = ensureRule(
          join.onCallDutyPolicyEscalationRuleId?.toString(),
        );
        if (bucket && join.user) {
          bucket.userJoins.push(join);
        }
      }

      for (const join of teamJoins.data) {
        const bucket: RuleMembers | null = ensureRule(
          join.onCallDutyPolicyEscalationRuleId?.toString(),
        );
        if (bucket && join.team) {
          bucket.teamJoins.push(join);
        }
      }

      for (const join of scheduleJoins.data) {
        const bucket: RuleMembers | null = ensureRule(
          join.onCallDutyPolicyEscalationRuleId?.toString(),
        );
        if (bucket && join.onCallDutyPolicySchedule) {
          bucket.scheduleJoins.push(join);
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

  /*
   * Reconciles the rule's responders against the edit form selection by
   * creating/deleting the relevant join rows.
   */
  const syncEditedMembers: (ruleId: ObjectID) => Promise<void> = async (
    ruleId: ObjectID,
  ): Promise<void> => {
    const original: RuleMembers =
      membersByRuleId[ruleId.toString()] || emptyRuleMembers();
    const latest: SelectedMembers = editedMembersRef.current;

    // On-call schedules
    await syncJoinType<OnCallDutyPolicyEscalationRuleSchedule>({
      latestIds: latest.onCallSchedules,
      joins: original.scheduleJoins,
      getEntityId: (join: OnCallDutyPolicyEscalationRuleSchedule) => {
        return join.onCallDutyPolicySchedule?.id?.toString();
      },
      modelType: OnCallDutyPolicyEscalationRuleSchedule,
      createOne: async (scheduleId: string) => {
        const model: OnCallDutyPolicyEscalationRuleSchedule =
          new OnCallDutyPolicyEscalationRuleSchedule();
        model.projectId = props.projectId;
        model.onCallDutyPolicyId = props.onCallDutyPolicyId;
        model.onCallDutyPolicyEscalationRuleId = ruleId;
        model.onCallDutyPolicyScheduleId = new ObjectID(scheduleId);
        await ModelAPI.create({
          modelType: OnCallDutyPolicyEscalationRuleSchedule,
          model: model,
        });
      },
    });

    // Teams
    await syncJoinType<OnCallDutyPolicyEscalationRuleTeam>({
      latestIds: latest.teams,
      joins: original.teamJoins,
      getEntityId: (join: OnCallDutyPolicyEscalationRuleTeam) => {
        return join.team?.id?.toString();
      },
      modelType: OnCallDutyPolicyEscalationRuleTeam,
      createOne: async (teamId: string) => {
        const model: OnCallDutyPolicyEscalationRuleTeam =
          new OnCallDutyPolicyEscalationRuleTeam();
        model.projectId = props.projectId;
        model.onCallDutyPolicyId = props.onCallDutyPolicyId;
        model.onCallDutyPolicyEscalationRuleId = ruleId;
        model.teamId = new ObjectID(teamId);
        await ModelAPI.create({
          modelType: OnCallDutyPolicyEscalationRuleTeam,
          model: model,
        });
      },
    });

    // Users
    await syncJoinType<OnCallDutyPolicyEscalationRuleUser>({
      latestIds: latest.users,
      joins: original.userJoins,
      getEntityId: (join: OnCallDutyPolicyEscalationRuleUser) => {
        return join.user?.id?.toString();
      },
      modelType: OnCallDutyPolicyEscalationRuleUser,
      createOne: async (userId: string) => {
        const model: OnCallDutyPolicyEscalationRuleUser =
          new OnCallDutyPolicyEscalationRuleUser();
        model.projectId = props.projectId;
        model.onCallDutyPolicyId = props.onCallDutyPolicyId;
        model.onCallDutyPolicyEscalationRuleId = ruleId;
        model.userId = new ObjectID(userId);
        await ModelAPI.create({
          modelType: OnCallDutyPolicyEscalationRuleUser,
          model: model,
        });
      },
    });
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
    const schedules: Array<OnCallDutyPolicySchedule> = members.scheduleJoins
      .map((join: OnCallDutyPolicyEscalationRuleSchedule) => {
        return join.onCallDutyPolicySchedule;
      })
      .filter(
        (
          schedule: OnCallDutyPolicySchedule | undefined,
        ): schedule is OnCallDutyPolicySchedule => {
          return Boolean(schedule);
        },
      );
    const teams: Array<Team> = members.teamJoins
      .map((join: OnCallDutyPolicyEscalationRuleTeam) => {
        return join.team;
      })
      .filter((team: Team | undefined): team is Team => {
        return Boolean(team);
      });
    const users: Array<User> = members.userJoins
      .map((join: OnCallDutyPolicyEscalationRuleUser) => {
        return join.user;
      })
      .filter((user: User | undefined): user is User => {
        return Boolean(user);
      });

    const totalCount: number = users.length + teams.length + schedules.length;

    if (totalCount === 0) {
      return (
        <div className="inline-flex items-start gap-2 rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2 text-sm text-amber-800">
          <Icon
            icon={IconProp.Alert}
            className="h-4 w-4 text-amber-500 mt-0.5 shrink-0"
          />
          <span>
            No responders assigned. No one will be notified at this level — edit
            this rule to add responders.
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        {schedules.map((schedule: OnCallDutyPolicySchedule) => {
          return getScheduleChip(schedule);
        })}
        {teams.map((team: Team) => {
          return getTeamChip(team);
        })}
        {users.map((user: User) => {
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

  /*
   * Opens the edit modal, seeding the live responder ref with the rule's
   * current responders so an untouched save is a no-op.
   */
  const openEditModal: (rule: OnCallDutyEscalationRule) => void = (
    rule: OnCallDutyEscalationRule,
  ): void => {
    const members: RuleMembers =
      membersByRuleId[rule.id?.toString() || ""] || emptyRuleMembers();

    editedMembersRef.current = {
      onCallSchedules: members.scheduleJoins
        .map((join: OnCallDutyPolicyEscalationRuleSchedule) => {
          return join.onCallDutyPolicySchedule?.id?.toString();
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        }),
      teams: members.teamJoins
        .map((join: OnCallDutyPolicyEscalationRuleTeam) => {
          return join.team?.id?.toString();
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        }),
      users: members.userJoins
        .map((join: OnCallDutyPolicyEscalationRuleUser) => {
          return join.user?.id?.toString();
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        }),
    };

    setRuleToEdit(rule);
  };

  const getRuleCard: (
    rule: OnCallDutyEscalationRule,
    index: number,
  ) => ReactElement = (
    rule: OnCallDutyEscalationRule,
    index: number,
  ): ReactElement => {
    const ruleId: string = rule.id?.toString() || "";
    const members: RuleMembers = membersByRuleId[ruleId] || emptyRuleMembers();
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
                      return openEditModal(rule);
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

  // Prefill options for the edit modal's member multi-selects.
  const editMemberDefaults: MemberDefaults | undefined = ruleToEdit
    ? ((): MemberDefaults => {
        const members: RuleMembers =
          membersByRuleId[ruleToEdit.id?.toString() || ""] ||
          emptyRuleMembers();
        return {
          onCallSchedules: members.scheduleJoins
            .filter((join: OnCallDutyPolicyEscalationRuleSchedule) => {
              return Boolean(join.onCallDutyPolicySchedule);
            })
            .map((join: OnCallDutyPolicyEscalationRuleSchedule) => {
              return {
                value: join.onCallDutyPolicySchedule!.id!.toString(),
                label:
                  join.onCallDutyPolicySchedule!.name?.toString() ||
                  "On-call schedule",
              };
            }),
          teams: members.teamJoins
            .filter((join: OnCallDutyPolicyEscalationRuleTeam) => {
              return Boolean(join.team);
            })
            .map((join: OnCallDutyPolicyEscalationRuleTeam) => {
              return {
                value: join.team!.id!.toString(),
                label: join.team!.name?.toString() || "Team",
              };
            }),
          users: members.userJoins
            .filter((join: OnCallDutyPolicyEscalationRuleUser) => {
              return Boolean(join.user);
            })
            .map((join: OnCallDutyPolicyEscalationRuleUser) => {
              return {
                value: join.user!.id!.toString(),
                label:
                  join.user!.name?.toString() ||
                  join.user!.email?.toString() ||
                  "User",
              };
            }),
        };
      })()
    : undefined;

  /*
   * Flatten the loaded rules + join rows into the lightweight shape the
   * escalation summary renders. Recomputed on every render so the summary stays
   * in lockstep with add / edit / delete / reorder of the rules below it.
   */
  const summaryLevels: Array<EscalationLevelSummary> = rules.map(
    (rule: OnCallDutyEscalationRule, index: number): EscalationLevelSummary => {
      const members: RuleMembers =
        membersByRuleId[rule.id?.toString() || ""] || emptyRuleMembers();

      const responders: Array<EscalationResponder> = [];

      for (const join of members.scheduleJoins) {
        if (join.onCallDutyPolicySchedule) {
          responders.push({
            type: "schedule",
            label:
              join.onCallDutyPolicySchedule.name?.toString() ||
              "On-call schedule",
          });
        }
      }
      for (const join of members.teamJoins) {
        if (join.team) {
          responders.push({
            type: "team",
            label: join.team.name?.toString() || "Team",
          });
        }
      }
      for (const join of members.userJoins) {
        if (join.user) {
          responders.push({
            type: "user",
            label:
              join.user.name?.toString() ||
              join.user.email?.toString() ||
              "User",
          });
        }
      }

      return {
        name: rule.name?.toString() || `Escalation Level ${index + 1}`,
        escalateAfterInMinutes: rule.escalateAfterInMinutes || 0,
        responders,
      };
    },
  );

  return (
    <Fragment>
      {!isLoading && !error && rules.length > 0 ? (
        <div className="mb-6">
          <EscalationSummary
            levels={summaryLevels}
            repeatEnabled={repeatEnabled}
            repeatCount={repeatCount}
          />
        </div>
      ) : (
        <></>
      )}

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
            steps: RULE_FORM_STEPS,
            fields: buildRuleFormFields(),
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
          description="Update the rule's details and change who it notifies."
          modalWidth={ModalWidth.Medium}
          modelType={OnCallDutyEscalationRule}
          modelIdToEdit={ruleToEdit.id!}
          submitButtonText="Save Changes"
          onClose={() => {
            return setRuleToEdit(null);
          }}
          onSuccess={() => {
            const editedRuleId: ObjectID | null | undefined = ruleToEdit?.id;
            setRuleToEdit(null);
            if (!editedRuleId) {
              loadData().catch(() => {});
              return;
            }
            // The rule's own fields are already saved; now reconcile responders.
            setIsLoading(true);
            syncEditedMembers(editedRuleId)
              .catch((err: Error) => {
                setError(API.getFriendlyMessage(err));
              })
              .finally(() => {
                loadData().catch(() => {});
              });
          }}
          formProps={{
            name: "Edit Escalation Rule",
            modelType: OnCallDutyEscalationRule,
            id: "edit-escalation-rule-form",
            formType: FormType.Update,
            steps: RULE_FORM_STEPS,
            fields: buildRuleFormFields(editMemberDefaults),
            onChange: (values: FormValues<OnCallDutyEscalationRule>) => {
              const currentValues: Record<string, unknown> =
                values as unknown as Record<string, unknown>;
              if (currentValues["onCallSchedules"] !== undefined) {
                editedMembersRef.current.onCallSchedules = toIdArray(
                  currentValues["onCallSchedules"],
                );
              }
              if (currentValues["teams"] !== undefined) {
                editedMembersRef.current.teams = toIdArray(
                  currentValues["teams"],
                );
              }
              if (currentValues["users"] !== undefined) {
                editedMembersRef.current.users = toIdArray(
                  currentValues["users"],
                );
              }
            },
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
