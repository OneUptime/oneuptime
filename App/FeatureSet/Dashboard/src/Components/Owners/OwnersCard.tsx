import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
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
import AddOwnerPopover, { AddOwnerSelection } from "./AddOwnerPopover";

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

export interface ComponentProps<
  TOwnerUser extends BaseModel,
  TOwnerTeam extends BaseModel,
> {
  resourceId: ObjectID;
  /**
   * Foreign-key column on the owner models that points back to the resource,
   * e.g. "runbookId", "monitorId", "alertId".
   */
  resourceIdField: string;
  /**
   * Lowercase singular noun used in user-facing copy ("this {name} ...").
   * Example: "runbook", "monitor", "incident".
   */
  resourceDisplayName: string;
  ownerUserModelType: { new (): TOwnerUser };
  ownerTeamModelType: { new (): TOwnerTeam };
}

function OwnersCard<TOwnerUser extends BaseModel, TOwnerTeam extends BaseModel>(
  props: ComponentProps<TOwnerUser, TOwnerTeam>,
): ReactElement {
  const resourceIdString: string = props.resourceId.toString();
  const { resourceIdField, resourceDisplayName } = props;
  const projectIdString: string | null =
    ProjectUtil.getCurrentProjectId()?.toString() ?? null;

  const [items, setItems] = useState<Array<OwnerCircle>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  const [isPopoverOpen, setIsPopoverOpen] = useState<boolean>(false);

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
      const resourceId: ObjectID = new ObjectID(resourceIdString);

      setIsLoading(true);
      setLoadError("");

      try {
        const ownerQuery: Record<string, unknown> = {
          [resourceIdField]: resourceId,
          projectId,
        };

        const [userOwnersResult, teamOwnersResult]: [
          ListResult<TOwnerUser>,
          ListResult<TOwnerTeam>,
        ] = await Promise.all([
          ModelAPI.getList<TOwnerUser>({
            modelType: props.ownerUserModelType,
            query: ownerQuery as Parameters<
              typeof ModelAPI.getList<TOwnerUser>
            >[0]["query"],
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
            } as Parameters<typeof ModelAPI.getList<TOwnerUser>>[0]["select"],
            sort: { createdAt: SortOrder.Ascending } as Parameters<
              typeof ModelAPI.getList<TOwnerUser>
            >[0]["sort"],
          }),
          ModelAPI.getList<TOwnerTeam>({
            modelType: props.ownerTeamModelType,
            query: ownerQuery as Parameters<
              typeof ModelAPI.getList<TOwnerTeam>
            >[0]["query"],
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              createdAt: true,
              team: {
                _id: true,
                name: true,
              },
            } as Parameters<typeof ModelAPI.getList<TOwnerTeam>>[0]["select"],
            sort: { createdAt: SortOrder.Ascending } as Parameters<
              typeof ModelAPI.getList<TOwnerTeam>
            >[0]["sort"],
          }),
        ]);

        const next: Array<OwnerCircle> = [];

        for (const row of userOwnersResult.data) {
          const rowRecord: Record<string, unknown> = row as unknown as Record<
            string,
            unknown
          >;
          const u: User | undefined = rowRecord["user"] as User | undefined;
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
          const rowRecord: Record<string, unknown> = row as unknown as Record<
            string,
            unknown
          >;
          const t: Team | undefined = rowRecord["team"] as Team | undefined;
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
    }, [
      resourceIdString,
      projectIdString,
      resourceIdField,
      props.ownerUserModelType,
      props.ownerTeamModelType,
    ]);

  useEffect(() => {
    void loadOwners();
  }, [loadOwners]);

  const takenKeys: Set<string> = useMemo(() => {
    return new Set(
      items.map((i: OwnerCircle) => {
        return `${i.type}:${i.existingId}`;
      }),
    );
  }, [items]);

  const handleAddOwner: (selection: AddOwnerSelection) => Promise<void> =
    useCallback(
      async (selection: AddOwnerSelection): Promise<void> => {
        if (!projectIdString) {
          return;
        }

        const projectId: ObjectID = new ObjectID(projectIdString);

        if (selection.kind === "user") {
          const m: TOwnerUser = new props.ownerUserModelType();
          const fields: Record<string, unknown> = m as unknown as Record<
            string,
            unknown
          >;
          fields[resourceIdField] = props.resourceId;
          fields["projectId"] = projectId;
          fields["userId"] = selection.id;
          await ModelAPI.create<TOwnerUser>({
            model: m,
            modelType: props.ownerUserModelType,
          });
        } else {
          const m: TOwnerTeam = new props.ownerTeamModelType();
          const fields: Record<string, unknown> = m as unknown as Record<
            string,
            unknown
          >;
          fields[resourceIdField] = props.resourceId;
          fields["projectId"] = projectId;
          fields["teamId"] = selection.id;
          await ModelAPI.create<TOwnerTeam>({
            model: m,
            modelType: props.ownerTeamModelType,
          });
        }

        await loadOwners();
      },
      [
        projectIdString,
        props.resourceId,
        props.ownerUserModelType,
        props.ownerTeamModelType,
        resourceIdField,
        loadOwners,
      ],
    );

  const handleRemoveConfirm: () => Promise<void> = async (): Promise<void> => {
    if (!confirmRemove) {
      return;
    }

    setIsRemoving(true);
    setRemoveError("");

    try {
      if (confirmRemove.type === "user") {
        await ModelAPI.deleteItem<TOwnerUser>({
          modelType: props.ownerUserModelType,
          id: confirmRemove.rowId,
        });
      } else {
        await ModelAPI.deleteItem<TOwnerTeam>({
          modelType: props.ownerTeamModelType,
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
      People and teams responsible for this {resourceDisplayName}. They are
      notified about changes.
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
              this {resourceDisplayName}.
            </div>
            <div className="relative mt-4 inline-block">
              <button
                type="button"
                onClick={() => {
                  setIsPopoverOpen((prev: boolean) => {
                    return !prev;
                  });
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 shadow-sm transition-colors"
              >
                <Icon
                  icon={IconProp.Add}
                  className="h-3.5 w-3.5"
                  size={SizeProp.Small}
                />
                <span>Add owner</span>
              </button>
              <AddOwnerPopover
                isOpen={isPopoverOpen}
                onClose={() => {
                  setIsPopoverOpen(false);
                }}
                takenKeys={takenKeys}
                onSelect={handleAddOwner}
              />
            </div>
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
              <div className="relative">
                <Tooltip text="Add owner">
                  <button
                    type="button"
                    onClick={() => {
                      setIsPopoverOpen((prev: boolean) => {
                        return !prev;
                      });
                    }}
                    aria-label="Add owner"
                    aria-expanded={isPopoverOpen}
                    className="-ml-2 h-11 w-11 rounded-full border-2 border-dashed border-gray-300 bg-white text-gray-400 flex items-center justify-center hover:border-indigo-500 hover:text-white hover:bg-indigo-600 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 transition-all duration-200 hover:scale-105 hover:-translate-y-0.5 relative z-10"
                  >
                    <Icon
                      icon={IconProp.Add}
                      className="h-5 w-5"
                      size={SizeProp.Five}
                    />
                  </button>
                </Tooltip>
                <AddOwnerPopover
                  isOpen={isPopoverOpen}
                  onClose={() => {
                    setIsPopoverOpen(false);
                  }}
                  takenKeys={takenKeys}
                  onSelect={handleAddOwner}
                />
              </div>
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
                this {resourceDisplayName}?
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
}

export default OwnersCard;
