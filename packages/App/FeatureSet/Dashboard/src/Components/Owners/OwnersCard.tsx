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
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import {
  getOwnersPeoplePickerConfig,
  OWNERS_ADD_BUTTON_TEXT,
} from "Common/UI/Components/PeoplePicker/OwnersFormField";
import PeopleAvatar, {
  PeopleAvatarItem,
} from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import PeopleSearchPopup, {
  PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
  PEOPLE_SEARCH_POPUP_WIDTH_PX,
} from "Common/UI/Components/PeoplePicker/PeopleSearchPopup";
import {
  getPeoplePickerKinds,
  getPeoplePickerOptionKey,
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  PeoplePickerOption,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
} from "Common/UI/Types/UseAnchoredFieldPopup";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  translatableTerm,
  TranslatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useIsProjectMember from "../../Utils/UseIsProjectMember";
import { ProjectMembershipAnswer } from "../../Utils/ProjectMembershipLoader";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * A record's Owners page: the people and teams who own it, as avatars, and
 * one "Add owner" list of people and teams to add more from - the same list
 * every form that asks for owners opens (Common's PeoplePicker), so owners
 * are picked the same way everywhere.
 */

const OWNERS_PICKER_CONFIG: PeoplePickerFieldConfig =
  getOwnersPeoplePickerConfig();

interface OwnerCircle extends PeopleAvatarItem {
  rowId: ObjectID;
  email?: string | undefined;
  // The person's or the team's id: what the search list leaves out.
  existingId: string;
}

interface OwnerCircleViewProps {
  item: OwnerCircle;
  isOverlapping: boolean;
  onRemoveClick: () => void;
}

const OwnerCircleView: FunctionComponent<OwnerCircleViewProps> = (
  props: OwnerCircleViewProps,
): ReactElement => {
  const { item, isOverlapping } = props;
  const translator: Translator = useTranslator();

  /*
   * An owner who has left the project is kept as the record of who owned it
   * (a closed incident's owners are its history), but nothing of the project
   * reaches them any more: the avatar fades and says so.
   */
  const isMember: ProjectMembershipAnswer = useIsProjectMember(
    item.kind === PeoplePickerKind.User ? item.userId : null,
  );
  const isNotProjectMember: boolean = isMember === false;

  const tooltipContent: ReactElement = (
    <div className="flex items-center gap-3 p-1.5 min-w-[180px]">
      <div className="flex-shrink-0">
        <PeopleAvatar item={item} size="lg" />
      </div>
      <div className="flex flex-col min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">
          {item.name}
        </div>
        {isNotProjectMember ? (
          <div className="text-xs font-medium text-amber-700 truncate">
            {translator.translateText("No longer a member")}
          </div>
        ) : (
          <div className="text-xs text-gray-500 truncate">
            {item.kind === PeoplePickerKind.Team
              ? translator.translateText("Team")
              : item.email || translator.translateText("Owner")}
          </div>
        )}
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
          <div
            data-testid={
              isNotProjectMember ? "owner-not-project-member" : undefined
            }
            className={`transition-transform duration-200 group-hover:scale-105${
              isNotProjectMember ? " opacity-50 grayscale" : ""
            }`}
          >
            <PeopleAvatar item={item} size="md" />
            {isNotProjectMember ? (
              <span className="sr-only">
                {translator.translateText("No longer a member")}
              </span>
            ) : (
              <></>
            )}
          </div>
        </div>
      </Tooltip>
      <button
        type="button"
        onClick={props.onRemoveClick}
        aria-label={translator.translateTemplate("Remove {{name}}", {
          name: item.name,
        })}
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
  /*
   * What owning the resource means, under the title. Default: they are
   * responsible for it and notified about changes - right for an incident,
   * not for a template, whose owners own what is declared from it. A whole
   * English sentence, looked up as one in the locale files.
   */
  description?: string | undefined;
  /*
   * The empty state's sentence. Default: add someone to be notified. Looked
   * up as one sentence too.
   */
  emptyDescription?: string | undefined;
}

function OwnersCard<TOwnerUser extends BaseModel, TOwnerTeam extends BaseModel>(
  props: ComponentProps<TOwnerUser, TOwnerTeam>,
): ReactElement {
  const translator: Translator = useTranslator();
  const resourceIdString: string = props.resourceId.toString();
  const { resourceIdField, resourceDisplayName } = props;
  const projectIdString: string | null =
    ProjectUtil.getCurrentProjectId()?.toString() ?? null;

  const [items, setItems] = useState<Array<OwnerCircle>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  const [confirmRemove, setConfirmRemove] = useState<OwnerCircle | null>(null);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string>("");

  /*
   * One list for both "Add owner" buttons - the empty state's and the "+"
   * after the avatars; only one is ever on screen. It follows the "+" as
   * owners are added in front of it.
   */
  const popup: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
    popupWidth: PEOPLE_SEARCH_POPUP_WIDTH_PX,
    repositionKey: items.length,
  });

  const loadOwners: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (!projectIdString) {
        setIsLoading(false);
        return;
      }

      const projectId: ObjectID = new ObjectID(projectIdString);
      const resourceId: ObjectID = new ObjectID(resourceIdString);

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
            kind: PeoplePickerKind.User,
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
            kind: PeoplePickerKind.Team,
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
    setIsLoading(true);
    void loadOwners();
  }, [loadOwners]);

  const takenKeys: Set<string> = useMemo(() => {
    return new Set(
      items.map((i: OwnerCircle) => {
        return getPeoplePickerOptionKey(i.kind, i.existingId);
      }),
    );
  }, [items]);

  const handleAddOwner: (option: PeoplePickerOption) => Promise<void> =
    useCallback(
      async (option: PeoplePickerOption): Promise<void> => {
        if (!projectIdString) {
          return;
        }

        const projectId: ObjectID = new ObjectID(projectIdString);

        if (option.kind === PeoplePickerKind.User) {
          const m: TOwnerUser = new props.ownerUserModelType();
          const fields: Record<string, unknown> = m as unknown as Record<
            string,
            unknown
          >;
          fields[resourceIdField] = props.resourceId;
          fields["projectId"] = projectId;
          fields["userId"] = new ObjectID(option.id);
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
          fields["teamId"] = new ObjectID(option.id);
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
      if (confirmRemove.kind === PeoplePickerKind.User) {
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
      return i.kind === PeoplePickerKind.User;
    }).length;
  }, [items]);

  const teamCount: number = useMemo(() => {
    return items.filter((i: OwnerCircle) => {
      return i.kind === PeoplePickerKind.Team;
    }).length;
  }, [items]);

  const countLabel: string = useMemo(() => {
    if (items.length === 0) {
      return "";
    }
    const parts: Array<string> = [];
    if (userCount > 0) {
      parts.push(
        translator.translatePlural(
          { one: "{{count}} person", other: "{{count}} people" },
          userCount,
        ),
      );
    }
    if (teamCount > 0) {
      parts.push(
        translator.translatePlural(
          { one: "{{count}} team", other: "{{count}} teams" },
          teamCount,
        ),
      );
    }
    return parts.join(" · ");
  }, [items.length, userCount, teamCount, translator.language]);

  // The resource's noun as it reads in the middle of a sentence.
  const resourceName: TranslatableTerm = translatableTerm(resourceDisplayName, {
    inSentence: true,
  });

  const addOwnerText: string =
    translator.translateText(OWNERS_ADD_BUTTON_TEXT) || OWNERS_ADD_BUTTON_TEXT;

  const titleNode: ReactElement = (
    <span className="inline-flex items-center gap-2">
      <span>{translator.translateText("Owners")}</span>
      {items.length > 0 && (
        <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold ring-1 ring-inset ring-indigo-100">
          {items.length}
        </span>
      )}
    </span>
  );

  const descriptionNode: ReactElement = (
    <span>
      {props.description
        ? translator.translateText(props.description)
        : translator.translateTemplate(
            "People and teams responsible for this {{resourceName}}. They are notified about changes.",
            { resourceName: resourceName },
          )}
      {countLabel && <span className="ml-1 text-gray-400">· {countLabel}</span>}
    </span>
  );

  const searchPopup: ReactElement = (
    <PeopleSearchPopup
      popup={popup}
      kinds={getPeoplePickerKinds(OWNERS_PICKER_CONFIG)}
      selectedKeys={takenKeys}
      selectionMode="add"
      onPick={(option: PeoplePickerOption): Promise<void> => {
        return handleAddOwner(option);
      }}
      searchPlaceholder={OWNERS_PICKER_CONFIG.searchPlaceholder}
      emptyText={OWNERS_PICKER_CONFIG.emptyText}
      ariaLabel={OWNERS_ADD_BUTTON_TEXT}
    />
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
              {translator.translateText("No owners yet")}
            </div>
            <div className="text-xs text-gray-500 mt-1 max-w-xs">
              {props.emptyDescription
                ? translator.translateText(props.emptyDescription)
                : translator.translateTemplate(
                    "Add a teammate or a team so they get notified about changes to this {{resourceName}}.",
                    { resourceName: resourceName },
                  )}
            </div>
            <div ref={popup.anchorRef} className="mt-4 inline-block">
              <button
                type="button"
                onClick={popup.togglePopup}
                onKeyDown={popup.onTriggerKeyDown}
                aria-haspopup="dialog"
                aria-expanded={popup.isPopupOpen}
                aria-controls={popup.isPopupOpen ? popup.popupId : undefined}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 shadow-sm transition-colors"
              >
                <Icon
                  icon={IconProp.Add}
                  className="h-3.5 w-3.5"
                  size={SizeProp.Small}
                />
                <span>{addOwnerText}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center flex-wrap gap-y-3">
            <div className="flex items-center">
              {items.map((item: OwnerCircle) => {
                return (
                  <OwnerCircleView
                    key={`${item.kind}-${item.rowId.toString()}`}
                    item={item}
                    isOverlapping={true}
                    onRemoveClick={() => {
                      setRemoveError("");
                      setConfirmRemove(item);
                    }}
                  />
                );
              })}
              <div ref={popup.anchorRef} className="relative">
                <Tooltip text={addOwnerText}>
                  <button
                    type="button"
                    onClick={popup.togglePopup}
                    onKeyDown={popup.onTriggerKeyDown}
                    aria-label={addOwnerText}
                    aria-haspopup="dialog"
                    aria-expanded={popup.isPopupOpen}
                    aria-controls={
                      popup.isPopupOpen ? popup.popupId : undefined
                    }
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
          </div>
        )}

        {searchPopup}

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
                <TranslatedSentence
                  template={
                    confirmRemove.kind === PeoplePickerKind.Team
                      ? "Are you sure you want to remove {{name}} (Team) as an owner of this {{resourceName}}?"
                      : "Are you sure you want to remove {{name}} as an owner of this {{resourceName}}?"
                  }
                  slots={{
                    name: (
                      <span className="font-semibold text-gray-900">
                        {confirmRemove.name}
                      </span>
                    ),
                  }}
                  values={{ resourceName: resourceName }}
                />
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
