import Route from "Common/Types/API/Route";
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
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Image from "Common/UI/Components/Image/Image";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import BlankProfilePic from "Common/UI/Images/users/blank-profile.svg";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

interface OwnerCircle {
  rowId: ObjectID;
  type: "user" | "team";
  name: string;
  userId?: ObjectID | undefined;
  existingId: string;
}

const TEAM_AVATAR_PALETTE: Array<string> = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-fuchsia-500",
];

function hashString(text: string): number {
  let hash: number = 0;
  for (let i: number = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getTeamColorClass(name: string): string {
  const idx: number = hashString(name) % TEAM_AVATAR_PALETTE.length;
  return TEAM_AVATAR_PALETTE[idx] as string;
}

function getInitials(name: string): string {
  const parts: Array<string> = name
    .trim()
    .split(/\s+/)
    .filter((p: string) => {
      return p.length > 0;
    });
  if (parts.length === 0) {
    return "";
  }
  if (parts.length === 1) {
    return ((parts[0] as string)[0] || "").toUpperCase();
  }
  const first: string = (parts[0] as string)[0] || "";
  const last: string = (parts[parts.length - 1] as string)[0] || "";
  return (first + last).toUpperCase();
}

interface OwnerCircleViewProps {
  item: OwnerCircle;
  onRemoveClick: () => void;
}

const OwnerCircleView: FunctionComponent<OwnerCircleViewProps> = (
  props: OwnerCircleViewProps,
): ReactElement => {
  const { item } = props;
  const tooltipText: string =
    item.type === "user" ? item.name : `${item.name} (Team)`;

  const innerCircle: ReactElement =
    item.type === "user" ? (
      <Image
        className="h-11 w-11 rounded-full ring-2 ring-white shadow-sm object-cover bg-gray-100"
        imageUrl={
          item.userId
            ? UserUtil.getProfilePictureRoute(item.userId)
            : Route.fromString(`${BlankProfilePic}`)
        }
        alt={item.name}
      />
    ) : (
      <div
        className={`h-11 w-11 rounded-full ring-2 ring-white shadow-sm flex items-center justify-center text-sm font-semibold text-white ${getTeamColorClass(
          item.name,
        )}`}
      >
        {getInitials(item.name) || (
          <Icon icon={IconProp.Team} size={SizeProp.Regular} />
        )}
      </div>
    );

  return (
    <div className="relative group">
      <Tooltip text={tooltipText}>
        <div className="cursor-default">{innerCircle}</div>
      </Tooltip>
      <button
        type="button"
        onClick={props.onRemoveClick}
        aria-label={`Remove ${item.name}`}
        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 hover:bg-red-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500 transition-opacity duration-150"
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
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

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
      if (!projectId) {
        return;
      }

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
              runbookId: props.runbookId,
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
              runbookId: props.runbookId,
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
            existingId: t._id?.toString() || "",
          });
        }

        setItems(next);
      } catch (err) {
        setLoadError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    }, [props.runbookId, projectId]);

  useEffect(() => {
    void loadOwners();
  }, [loadOwners]);

  const fetchOwnerOptions: () => Promise<Array<DropdownOption>> =
    useCallback(async (): Promise<Array<DropdownOption>> => {
      if (!projectId) {
        return [];
      }

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
        const display: string =
          u.name?.toString() || u.email?.toString() || uid;
        userOptions.push({
          value: `user:${uid}`,
          label: `${display}`,
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
          label: `${t.name?.toString() || "Team"} (Team)`,
        });
      }

      return [...userOptions, ...teamOptions];
    }, [projectId, items]);

  const handleAdd: (data: JSONObject) => Promise<void> = async (
    data: JSONObject,
  ): Promise<void> => {
    if (!projectId) {
      return;
    }

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

  return (
    <Card
      title="Owners"
      description="People and teams responsible for this runbook. They are notified about changes."
    >
      <>
        <div className="flex flex-wrap items-center gap-3 min-h-[44px]">
          {isLoading ? (
            <div className="flex items-center">
              <ComponentLoader />
            </div>
          ) : (
            <>
              {items.length === 0 && (
                <div className="text-sm text-gray-500">
                  No owners assigned yet. Click the{" "}
                  <span className="font-medium text-gray-700">+</span> button to
                  add one.
                </div>
              )}

              {items.map((item: OwnerCircle) => {
                return (
                  <OwnerCircleView
                    key={`${item.type}-${item.rowId.toString()}`}
                    item={item}
                    onRemoveClick={() => {
                      setRemoveError("");
                      setConfirmRemove(item);
                    }}
                  />
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setAddError("");
                  setShowAddModal(true);
                }}
                aria-label="Add owner"
                className="h-11 w-11 rounded-full border-2 border-dashed border-gray-300 text-gray-400 flex items-center justify-center hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 transition-colors"
              >
                <Icon icon={IconProp.Add} size={SizeProp.Large} />
              </button>
            </>
          )}
        </div>

        {loadError && (
          <div className="mt-3 text-sm text-red-600">{loadError}</div>
        )}

        {showAddModal && (
          <BasicFormModal<JSONObject>
            title="Add Owner"
            description="Add a user or team as an owner of this runbook."
            submitButtonText="Add"
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
                    "Select a teammate or team. They will be notified about changes to this runbook.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  required: true,
                  placeholder: "Select user or team",
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
                <span className="font-medium text-gray-900">
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
