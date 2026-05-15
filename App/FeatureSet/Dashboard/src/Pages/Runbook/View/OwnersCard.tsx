import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookOwnerTeam from "Common/Models/DatabaseModels/RunbookOwnerTeam";
import RunbookOwnerUser from "Common/Models/DatabaseModels/RunbookOwnerUser";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Image from "Common/UI/Components/Image/Image";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

interface OwnerCircle {
  rowId: ObjectID;
  type: "user" | "team";
  name: string;
  userId?: ObjectID | undefined;
  hasProfilePicture: boolean;
  email?: string | undefined;
  existingId: string;
}

const USER_AVATAR_PALETTE: Array<{ bg: string; ring: string }> = [
  { bg: "bg-gradient-to-br from-indigo-500 to-violet-600", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-sky-500 to-blue-600", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-fuchsia-500 to-pink-600", ring: "ring-white" },
  {
    bg: "bg-gradient-to-br from-emerald-500 to-teal-600",
    ring: "ring-white",
  },
  { bg: "bg-gradient-to-br from-amber-500 to-orange-600", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-rose-500 to-red-600", ring: "ring-white" },
  {
    bg: "bg-gradient-to-br from-violet-500 to-purple-600",
    ring: "ring-white",
  },
  { bg: "bg-gradient-to-br from-cyan-500 to-sky-600", ring: "ring-white" },
];

const TEAM_AVATAR_PALETTE: Array<{ bg: string; ring: string }> = [
  { bg: "bg-gradient-to-br from-slate-700 to-slate-900", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-gray-700 to-gray-900", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-stone-700 to-stone-900", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-zinc-700 to-zinc-900", ring: "ring-white" },
  {
    bg: "bg-gradient-to-br from-neutral-700 to-neutral-900",
    ring: "ring-white",
  },
];

function hashString(text: string): number {
  let hash: number = 0;
  for (let i: number = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getUserAvatarStyle(name: string): { bg: string; ring: string } {
  const idx: number = hashString(name) % USER_AVATAR_PALETTE.length;
  return USER_AVATAR_PALETTE[idx] as { bg: string; ring: string };
}

function getTeamAvatarStyle(name: string): { bg: string; ring: string } {
  const idx: number = hashString(name) % TEAM_AVATAR_PALETTE.length;
  return TEAM_AVATAR_PALETTE[idx] as { bg: string; ring: string };
}

function getInitials(name: string): string {
  const parts: Array<string> = name
    .trim()
    .split(/\s+/)
    .filter((p: string) => {
      return p.length > 0;
    });
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return ((parts[0] as string)[0] || "?").toUpperCase();
  }
  const first: string = (parts[0] as string)[0] || "";
  const last: string = (parts[parts.length - 1] as string)[0] || "";
  return (first + last).toUpperCase();
}

interface AvatarVisualProps {
  item: OwnerCircle;
  size: "sm" | "md" | "lg";
}

const AvatarVisual: FunctionComponent<AvatarVisualProps> = (
  props: AvatarVisualProps,
): ReactElement => {
  const { item, size } = props;

  const sizeClasses: string =
    size === "lg"
      ? "h-14 w-14 text-base"
      : size === "md"
        ? "h-11 w-11 text-sm"
        : "h-8 w-8 text-xs";

  if (item.type === "user" && item.hasProfilePicture && item.userId) {
    return (
      <Image
        className={`${sizeClasses} rounded-full object-cover ring-2 ring-white shadow-sm bg-gray-100`}
        imageUrl={UserUtil.getProfilePictureRoute(item.userId)}
        alt={item.name}
      />
    );
  }

  const palette: { bg: string; ring: string } =
    item.type === "user"
      ? getUserAvatarStyle(item.name)
      : getTeamAvatarStyle(item.name);

  return (
    <div
      className={`${sizeClasses} ${palette.bg} rounded-full ring-2 ${palette.ring} shadow-sm flex items-center justify-center font-semibold text-white select-none`}
    >
      {getInitials(item.name)}
    </div>
  );
};

interface OwnerCircleViewProps {
  item: OwnerCircle;
  isOverlapping: boolean;
  onRemoveClick: () => void;
}

const OwnerCircleView: FunctionComponent<OwnerCircleViewProps> = (
  props: OwnerCircleViewProps,
): ReactElement => {
  const { item, isOverlapping } = props;

  const tooltipContent: ReactElement = (
    <div className="flex items-center gap-3 p-1.5 min-w-[180px]">
      <div className="flex-shrink-0">
        <AvatarVisual item={item} size="lg" />
      </div>
      <div className="flex flex-col min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">
          {item.name}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {item.type === "team" ? "Team" : item.email || "Owner"}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`relative group transition-all duration-200 hover:z-20 hover:-translate-y-0.5 ${
        isOverlapping ? "-ml-2 first:ml-0" : ""
      }`}
    >
      <Tooltip richContent={tooltipContent}>
        <div className="cursor-default">
          <div className="transition-transform duration-200 group-hover:scale-105">
            <AvatarVisual item={item} size="md" />
          </div>
          {item.type === "team" && (
            <div
              className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-gray-200 flex items-center justify-center shadow-sm"
              aria-hidden="true"
            >
              <Icon
                icon={IconProp.UserGroup}
                className="h-2.5 w-2.5 text-gray-600"
                size={SizeProp.Smaller}
              />
            </div>
          )}
        </div>
      </Tooltip>
      <button
        type="button"
        onClick={props.onRemoveClick}
        aria-label={`Remove ${item.name}`}
        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-md opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 hover:bg-red-600 focus:opacity-100 focus:scale-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 transition-all duration-150"
      >
        <Icon icon={IconProp.Close} className="h-3 w-3" size={SizeProp.Small} />
      </button>
    </div>
  );
};

export interface ComponentProps {
  runbookId: ObjectID;
}

const OwnersCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const runbookIdString: string = props.runbookId.toString();
  const projectIdString: string | null =
    ProjectUtil.getCurrentProjectId()?.toString() ?? null;

  const [items, setItems] = useState<Array<OwnerCircle>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [addError, setAddError] = useState<string>("");

  const [confirmRemove, setConfirmRemove] = useState<OwnerCircle | null>(null);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string>("");

  const loadOwners: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (!projectIdString) {
        setIsLoading(false);
        return;
      }

      const projectId: ObjectID = new ObjectID(projectIdString);
      const runbookId: ObjectID = new ObjectID(runbookIdString);

      setIsLoading(true);
      setLoadError("");

      try {
        const [userOwnersResult, teamOwnersResult]: [
          ListResult<RunbookOwnerUser>,
          ListResult<RunbookOwnerTeam>,
        ] = await Promise.all([
          ModelAPI.getList<RunbookOwnerUser>({
            modelType: RunbookOwnerUser,
            query: {
              runbookId,
              projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              createdAt: true,
              user: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            sort: { createdAt: SortOrder.Ascending },
          }),
          ModelAPI.getList<RunbookOwnerTeam>({
            modelType: RunbookOwnerTeam,
            query: {
              runbookId,
              projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              createdAt: true,
              team: {
                _id: true,
                name: true,
              },
            },
            sort: { createdAt: SortOrder.Ascending },
          }),
        ]);

        const next: Array<OwnerCircle> = [];

        for (const row of userOwnersResult.data) {
          const u: User | undefined = row.user as User | undefined;
          if (!u || !row.id) {
            continue;
          }
          next.push({
            rowId: row.id,
            type: "user",
            name: u.name?.toString() || u.email?.toString() || "User",
            userId: u.id ?? undefined,
            hasProfilePicture: Boolean(u.profilePictureId),
            email: u.email?.toString(),
            existingId: u._id?.toString() || "",
          });
        }

        for (const row of teamOwnersResult.data) {
          const t: Team | undefined = row.team as Team | undefined;
          if (!t || !row.id) {
            continue;
          }
          next.push({
            rowId: row.id,
            type: "team",
            name: t.name?.toString() || "Team",
            hasProfilePicture: false,
            existingId: t._id?.toString() || "",
          });
        }

        setItems(next);
      } catch (err) {
        setLoadError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    }, [runbookIdString, projectIdString]);

  useEffect(() => {
    void loadOwners();
  }, [loadOwners]);

  const fetchOwnerOptions: () => Promise<
    Array<DropdownOption | DropdownOptionGroup>
  > = useCallback(async (): Promise<
    Array<DropdownOption | DropdownOptionGroup>
  > => {
    if (!projectIdString) {
      return [];
    }

    const projectId: ObjectID = new ObjectID(projectIdString);

    const [teamMembersResult, teamsResult]: [
      ListResult<TeamMember>,
      ListResult<Team>,
    ] = await Promise.all([
      ModelAPI.getList<TeamMember>({
        modelType: TeamMember,
        query: { projectId },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          user: {
            _id: true,
            name: true,
            email: true,
          },
        },
        sort: {},
      }),
      ModelAPI.getList<Team>({
        modelType: Team,
        query: { projectId },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
        },
        sort: { name: SortOrder.Ascending },
      }),
    ]);

    const taken: Set<string> = new Set(
      items.map((i: OwnerCircle) => {
        return `${i.type}:${i.existingId}`;
      }),
    );

    const seenUsers: Set<string> = new Set();
    const userOptions: Array<DropdownOption> = [];
    for (const tm of teamMembersResult.data) {
      const u: User | undefined = tm.user as User | undefined;
      const uid: string | undefined = u?._id?.toString();
      if (!u || !uid || seenUsers.has(uid)) {
        continue;
      }
      seenUsers.add(uid);
      if (taken.has(`user:${uid}`)) {
        continue;
      }
      const display: string = u.name?.toString() || u.email?.toString() || uid;
      userOptions.push({
        value: `user:${uid}`,
        label: display,
      });
    }

    const teamOptions: Array<DropdownOption> = [];
    for (const t of teamsResult.data) {
      const tid: string | undefined = t._id?.toString();
      if (!tid) {
        continue;
      }
      if (taken.has(`team:${tid}`)) {
        continue;
      }
      teamOptions.push({
        value: `team:${tid}`,
        label: t.name?.toString() || "Team",
      });
    }

    const groups: Array<DropdownOption | DropdownOptionGroup> = [];
    if (userOptions.length > 0) {
      groups.push({ label: "People", options: userOptions });
    }
    if (teamOptions.length > 0) {
      groups.push({ label: "Teams", options: teamOptions });
    }
    return groups;
  }, [projectIdString, items]);

  const handleAdd: (data: JSONObject) => Promise<void> = async (
    data: JSONObject,
  ): Promise<void> => {
    if (!projectIdString) {
      return;
    }

    const projectId: ObjectID = new ObjectID(projectIdString);

    setIsAdding(true);
    setAddError("");

    try {
      const raw: string = (data["owner"] as string) || "";
      const [kind, id] = raw.split(":");

      if (!kind || !id) {
        throw new Error("Please select an owner.");
      }

      if (kind === "user") {
        const m: RunbookOwnerUser = new RunbookOwnerUser();
        m.runbookId = props.runbookId;
        m.projectId = projectId;
        m.userId = new ObjectID(id);
        await ModelAPI.create<RunbookOwnerUser>({
          model: m,
          modelType: RunbookOwnerUser,
        });
      } else if (kind === "team") {
        const m: RunbookOwnerTeam = new RunbookOwnerTeam();
        m.runbookId = props.runbookId;
        m.projectId = projectId;
        m.teamId = new ObjectID(id);
        await ModelAPI.create<RunbookOwnerTeam>({
          model: m,
          modelType: RunbookOwnerTeam,
        });
      }

      setShowAddModal(false);
      await loadOwners();
    } catch (err) {
      setAddError(API.getFriendlyMessage(err));
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveConfirm: () => Promise<void> = async (): Promise<void> => {
    if (!confirmRemove) {
      return;
    }

    setIsRemoving(true);
    setRemoveError("");

    try {
      if (confirmRemove.type === "user") {
        await ModelAPI.deleteItem<RunbookOwnerUser>({
          modelType: RunbookOwnerUser,
          id: confirmRemove.rowId,
        });
      } else {
        await ModelAPI.deleteItem<RunbookOwnerTeam>({
          modelType: RunbookOwnerTeam,
          id: confirmRemove.rowId,
        });
      }

      setConfirmRemove(null);
      await loadOwners();
    } catch (err) {
      setRemoveError(API.getFriendlyMessage(err));
    } finally {
      setIsRemoving(false);
    }
  };

  const userCount: number = useMemo(() => {
    return items.filter((i: OwnerCircle) => {
      return i.type === "user";
    }).length;
  }, [items]);

  const teamCount: number = useMemo(() => {
    return items.filter((i: OwnerCircle) => {
      return i.type === "team";
    }).length;
  }, [items]);

  const countLabel: string = useMemo(() => {
    if (items.length === 0) {
      return "";
    }
    const parts: Array<string> = [];
    if (userCount > 0) {
      parts.push(`${userCount} ${userCount === 1 ? "person" : "people"}`);
    }
    if (teamCount > 0) {
      parts.push(`${teamCount} ${teamCount === 1 ? "team" : "teams"}`);
    }
    return parts.join(" · ");
  }, [items.length, userCount, teamCount]);

  const titleNode: ReactElement = (
    <span className="inline-flex items-center gap-2">
      <span>Owners</span>
      {items.length > 0 && (
        <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold ring-1 ring-inset ring-indigo-100">
          {items.length}
        </span>
      )}
    </span>
  );

  const descriptionNode: ReactElement = (
    <span>
      People and teams responsible for this runbook. They are notified about
      changes.
      {countLabel && <span className="ml-1 text-gray-400">· {countLabel}</span>}
    </span>
  );

  return (
    <Card title={titleNode} description={descriptionNode}>
      <>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <ComponentLoader />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-8 flex flex-col items-center text-center">
            <div className="h-12 w-12 rounded-full bg-white ring-1 ring-gray-200 flex items-center justify-center shadow-sm mb-3">
              <Icon
                icon={IconProp.User}
                size={SizeProp.Large}
                className="h-6 w-6 text-gray-400"
              />
            </div>
            <div className="text-sm font-medium text-gray-900">
              No owners yet
            </div>
            <div className="text-xs text-gray-500 mt-1 max-w-xs">
              Add a teammate or a team so they get notified about changes to
              this runbook.
            </div>
            <button
              type="button"
              onClick={() => {
                setAddError("");
                setShowAddModal(true);
              }}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 shadow-sm transition-colors"
            >
              <Icon
                icon={IconProp.Add}
                className="h-3.5 w-3.5"
                size={SizeProp.Small}
              />
              <span>Add owner</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center flex-wrap gap-y-3">
            <div className="flex items-center">
              {items.map((item: OwnerCircle) => {
                return (
                  <OwnerCircleView
                    key={`${item.type}-${item.rowId.toString()}`}
                    item={item}
                    isOverlapping={true}
                    onRemoveClick={() => {
                      setRemoveError("");
                      setConfirmRemove(item);
                    }}
                  />
                );
              })}
              <Tooltip text="Add owner">
                <button
                  type="button"
                  onClick={() => {
                    setAddError("");
                    setShowAddModal(true);
                  }}
                  aria-label="Add owner"
                  className="-ml-2 h-11 w-11 rounded-full border-2 border-dashed border-gray-300 bg-white text-gray-400 flex items-center justify-center hover:border-indigo-500 hover:text-white hover:bg-indigo-600 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 transition-all duration-200 hover:scale-105 hover:-translate-y-0.5 relative z-10"
                >
                  <Icon
                    icon={IconProp.Add}
                    className="h-5 w-5"
                    size={SizeProp.Five}
                  />
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        {loadError && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600">
            <Icon
              icon={IconProp.Alert}
              className="h-4 w-4"
              size={SizeProp.Small}
            />
            <span>{loadError}</span>
          </div>
        )}

        {showAddModal && (
          <BasicFormModal<JSONObject>
            title="Add Owner"
            description="Add a teammate or a team as an owner of this runbook."
            submitButtonText="Add Owner"
            isLoading={isAdding}
            error={addError}
            onClose={() => {
              setShowAddModal(false);
              setAddError("");
            }}
            onSubmit={(data: JSONObject) => {
              void handleAdd(data);
            }}
            formProps={{
              initialValues: {},
              fields: [
                {
                  field: { owner: true },
                  title: "Owner",
                  description:
                    "Select a teammate or a team. They will be notified about changes to this runbook.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  required: true,
                  placeholder: "Search people or teams...",
                  fetchDropdownOptions: fetchOwnerOptions,
                },
              ],
            }}
          />
        )}

        {confirmRemove && (
          <ConfirmModal
            title="Remove owner"
            description={
              <span>
                Are you sure you want to remove{" "}
                <span className="font-semibold text-gray-900">
                  {confirmRemove.name}
                </span>
                {confirmRemove.type === "team" ? " (Team)" : ""} as an owner of
                this runbook?
              </span>
            }
            submitButtonText="Remove"
            submitButtonType={ButtonStyleType.DANGER}
            isLoading={isRemoving}
            error={removeError}
            onClose={() => {
              setConfirmRemove(null);
              setRemoveError("");
            }}
            onSubmit={() => {
              void handleRemoveConfirm();
            }}
          />
        )}
      </>
    </Card>
  );
};

export default OwnersCard;
