import {
  AppliedLevelChange,
  applyLevelChange,
  getCreatedLevelRow,
  getProductsChangedBetween,
  getProductsShownFirst,
  getTeamProductLevels,
  groupAsTheMenuDoes,
  isNoChange,
  planProductLevelChange,
  ProductLevelChange,
  ProductLevelGroup,
  ProductLevelRow,
  ReplacedRow,
  TeamLevelRow,
  TeamProductLevel,
} from "./TeamProductLevels";
import {
  getProductLevelNotes,
  LEVEL_DESCRIPTIONS,
  LEVEL_NOT_YOURS_TO_GIVE,
  LEVEL_TITLES,
  NO_ACCESS_TEXT,
  PRODUCT_ACCESS_DESCRIPTION,
  PRODUCT_ACCESS_TITLE,
  SHOW_ALL_PRODUCTS,
  SHOW_FEWER_PRODUCTS,
} from "./TeamProductAccessWords";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../Utils/NavigationItems";
import useProjectProducts from "../../Utils/ProjectProducts/UseProjectProducts";
import { ProjectProductsState } from "../../Utils/ProjectProducts/ProjectProductsStore";
import Label from "Common/Models/DatabaseModels/Label";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import Includes from "Common/Types/BaseDatabase/Includes";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Exception from "Common/Types/Exception/Exception";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ProductKey from "Common/Types/Product/ProductKey";
import {
  getProductLevelPermission,
  PRODUCT_LEVEL_PERMISSION_VALUES,
  ProductLevel,
} from "Common/Types/Product/ProductLevels";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import { MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import GrantablePermission from "Common/UI/Utils/GrantablePermission";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * A TEAM'S PRODUCT ACCESS: ONE LEVEL PER PRODUCT, ON ONE CARD (#10289).
 *
 * "Admin of Cloud, view-only on Network Monitoring, nothing on App
 * Platforms, and not a project administrator." Every product that has
 * levels (Common/Types/Product/ProductLevels) is a row, in the groups, the
 * order and the names of the products menu, with the level the team holds
 * of it for the whole project in a list: Viewer, Member (where the product
 * has one) or Admin, and No access when the list is cleared. A pick saves
 * at once and says "Saved" (useSaveOnChange): the level's row is given,
 * then the team's other whole-project rows of the product are taken away
 * (TeamProductLevels), and the permissions table above reads again.
 *
 * A level is an ordinary team permission, so the server decides who may
 * give one as it decides every grant: someone who may change the team's
 * permissions, and who holds the level themselves, or a Project Owner
 * (TeamPermissionService.assertCanGrantPermission). The card offers no
 * more. Someone who may not change the team's permissions reads each
 * product's level, with why it is locked; a level they may not give is in
 * the list and cannot be picked, saying why (GrantablePermission). What
 * the card does not change - a level limited to some records, one a custom
 * role gives, a block - is said under the product's name.
 *
 * The products the project hides from its menu wait behind Show All
 * Products, unless the team holds something of one.
 */

export const TEAM_PRODUCT_ACCESS_TEST_ID: string = "team-product-access";

// A product's row; its list is `${row}-level`, its "Saved" `${row}-status`.
export const getTeamProductAccessRowTestId: (product: string) => string = (
  product: string,
): string => {
  return `${TEAM_PRODUCT_ACCESS_TEST_ID}-${product}`;
};

export interface ComponentProps {
  teamId: ObjectID;
  // Changes whenever the permissions table changes a row: read again.
  refreshToggle?: string | undefined;
  // Called once a level is saved, so the permissions table reads again.
  onLevelChange?: (() => void) | undefined;
}

// A product's list: its levels, least first, each saying what it adds.
export const getProductLevelOptions: (data: {
  entry: TeamProductLevel;
  // Whether the reader may give the team this level (the grant ceiling).
  mayGive: (permission: Permission) => boolean;
}) => Array<DropdownOption> = (data: {
  entry: TeamProductLevel;
  mayGive: (permission: Permission) => boolean;
}): Array<DropdownOption> => {
  return data.entry.levels.map((level: ProductLevel): DropdownOption => {
    const permission: Permission = getProductLevelPermission(
      data.entry.product,
      level,
    )!;
    const isOffered: boolean =
      data.entry.level === level || data.mayGive(permission);

    return {
      value: level,
      label: LEVEL_TITLES[level],
      description: isOffered
        ? LEVEL_DESCRIPTIONS[level]
        : LEVEL_NOT_YOURS_TO_GIVE,
      isDisabled: !isOffered,
    };
  });
};

interface ProductLevelPickerProps {
  entry: TeamProductLevel;
  teamId: ObjectID;
  // The product's menu item: its name and icon, in the reader's words.
  menuItem: MoreMenuItem | undefined;
  // Locked, with why (or with nothing to say while permissions load).
  isLocked: boolean;
  // Told what the server took, after every write of a change.
  onApplied: (applied: AppliedLevelChange) => void;
  // Told once a change is saved in full.
  onSaved: () => void;
}

/*
 * One product's row: its name, the notes on what the card does not change,
 * and its level's list with "Saved" beside it.
 */
const ProductLevelPicker: FunctionComponent<ProductLevelPickerProps> = (
  props: ProductLevelPickerProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const uniqueId: string = useId();
  const nameId: string = `team-product-access-name-${uniqueId}`;
  const notesId: string = `team-product-access-notes-${uniqueId}`;
  const rowTestId: string = getTeamProductAccessRowTestId(props.entry.product);

  /*
   * The product's whole-project rows as the server has them, kept as each
   * write lands: a change picked while the last one saves is planned from
   * them, before the page draws again.
   */
  const rowsRef: MutableRefObject<Array<ReplacedRow>> = useRef<
    Array<ReplacedRow>
  >(props.entry.replacedRows);

  const setting: SaveOnChange<ProductLevel | null> =
    useSaveOnChange<ProductLevel | null>({
      initialValue: props.entry.level,
      save: async (level: ProductLevel | null): Promise<void> => {
        const change: ProductLevelChange = planProductLevelChange(
          { ...props.entry, replacedRows: rowsRef.current },
          level,
        );

        if (isNoChange(change)) {
          return;
        }

        // The new level first: a change that stops half way takes nothing.
        if (change.create) {
          const row: TeamPermission = new TeamPermission();
          row.teamId = props.teamId;
          row.projectId = ProjectUtil.getCurrentProjectId()!;
          row.permission = change.create;
          row.isBlockPermission = false;
          row.scope = PermissionScope.All;

          const response: { data: unknown } = await ModelAPI.create({
            model: row,
            modelType: TeamPermission,
          });
          const id: string =
            (response.data as TeamPermission | undefined)?.id?.toString() || "";
          const created: TeamLevelRow = getCreatedLevelRow(id, change.create);

          rowsRef.current = [
            ...rowsRef.current,
            { id: id, permission: change.create },
          ];
          props.onApplied({ created: created, deletedIds: [] });
        }

        for (const id of change.delete) {
          await ModelAPI.deleteItem<TeamPermission>({
            modelType: TeamPermission,
            id: new ObjectID(id),
          });

          rowsRef.current = rowsRef.current.filter(
            (row: ReplacedRow): boolean => {
              return row.id !== id;
            },
          );
          props.onApplied({ created: null, deletedIds: [id] });
        }
      },
      onSaved: () => {
        props.onSaved();
      },
    });

  const options: Array<DropdownOption> = useMemo(
    (): Array<DropdownOption> => {
      return getProductLevelOptions({
        entry: props.entry,
        mayGive: (permission: Permission): boolean => {
          return GrantablePermission.canCurrentUserGrant(permission);
        },
      });
    },
    // The revision hands the list its options anew after a refused change.
    [props.entry, setting.revision],
  );

  /*
   * What the list shows: the change being saved, or the level the team
   * holds. After a refused change, the level its rows add up to now - a
   * change refused half way, the new level given and the old one not yet
   * taken away, leaves the team the higher of the two.
   */
  const shownLevel: ProductLevel | null = setting.error
    ? props.entry.level
    : setting.value;

  const selected: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === shownLevel;
    },
  );

  const notes: Array<string> = getProductLevelNotes(props.entry);
  const title: string = props.menuItem
    ? props.menuItem.isTitleTranslated
      ? props.menuItem.title
      : translator.translateText(props.menuItem.title) || props.menuItem.title
    : props.entry.product;
  const levelText: string = shownLevel
    ? LEVEL_TITLES[shownLevel]
    : NO_ACCESS_TEXT;

  return (
    <li
      className="flex min-w-0 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4"
      data-testid={rowTestId}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-gray-100">
          <Icon
            icon={props.menuItem?.icon || IconProp.Squares}
            className="h-4 w-4 text-gray-600"
          />
        </div>
        <div className="min-w-0 pt-1.5">
          <div
            id={nameId}
            className="break-words text-sm font-medium text-gray-900"
          >
            {title}
          </div>
          {notes.length > 0 ? (
            <div id={notesId} data-testid={`${rowTestId}-notes`}>
              {notes.map((note: string): ReactElement => {
                return (
                  <p key={note} className="text-xs text-gray-500">
                    {translator.translateText(note)}
                  </p>
                );
              })}
            </div>
          ) : (
            <></>
          )}
          {setting.error ? (
            <p
              className="mt-1 text-sm text-red-600"
              role="alert"
              data-testid={`${rowTestId}-error`}
            >
              <ErrorInSentence message={setting.error} showWhereToLook={true} />
            </p>
          ) : (
            <></>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 pl-11 sm:pl-0">
        {props.isLocked ? (
          <span
            className="text-sm text-gray-900"
            data-testid={`${rowTestId}-level`}
          >
            {translator.translateText(levelText)}
          </span>
        ) : (
          <div className="w-full sm:w-56" data-testid={`${rowTestId}-level`}>
            <Dropdown
              options={options}
              value={selected}
              placeholder={NO_ACCESS_TEXT}
              isClearable={true}
              ariaLabelledby={nameId}
              ariaDescribedby={notes.length > 0 ? notesId : undefined}
              className="relative w-full overflow-visible rounded-md"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (Array.isArray(value)) {
                  return;
                }

                setting.change(value ? (value as ProductLevel) : null);
              }}
            />
          </div>
        )}
        <SaveStatus
          state={setting.saveState}
          dataTestId={`${rowTestId}-status`}
        />
      </div>
    </li>
  );
};

const TeamProductAccess: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const navigation: DashboardNavigationItems = useDashboardNavigationItems();
  const products: ProjectProductsState = useProjectProducts();
  const [levelRows, setLevelRows] = useState<Array<TeamLevelRow> | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [isShowingAll, setIsShowingAll] = useState<boolean>(false);

  /*
   * How many times each product's list was drawn anew: a list keeps what
   * it last saved, so a level changed somewhere else draws it again.
   */
  const [generations, setGenerations] = useState<Record<string, number>>({});
  const rowsRef: MutableRefObject<Array<TeamLevelRow> | null> =
    useRef<Array<TeamLevelRow> | null>(null);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const result: ListResult<TeamPermission> =
      await ModelAPI.getList<TeamPermission>({
        modelType: TeamPermission,
        query: {
          teamId: props.teamId,
          projectId: ProjectUtil.getCurrentProjectId()!,
          permission: new Includes([...PRODUCT_LEVEL_PERMISSION_VALUES]),
        },
        select: {
          _id: true,
          permission: true,
          isBlockPermission: true,
          scope: true,
          labels: { _id: true },
          teamCustomRoleId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {},
      });

    const rows: Array<TeamLevelRow> = result.data.map(
      (row: TeamPermission): TeamLevelRow => {
        return {
          id: row.id?.toString() || "",
          permission: row.permission!,
          isBlockPermission: Boolean(row.isBlockPermission),
          labelIds: (row.labels || []).map((label: Label): string => {
            return label.id?.toString() || "";
          }),
          scope: row.scope,
          isFromCustomRole: Boolean(row.teamCustomRoleId),
        };
      },
    );

    const changed: Array<ProductKey> = rowsRef.current
      ? getProductsChangedBetween(rowsRef.current, rows)
      : [];

    rowsRef.current = rows;
    setLevelRows(rows);
    setLoadError("");

    if (changed.length > 0) {
      setGenerations(
        (current: Record<string, number>): Record<string, number> => {
          const next: Record<string, number> = { ...current };

          for (const product of changed) {
            next[product] = (next[product] || 0) + 1;
          }

          return next;
        },
      );
    }
  }, [props.teamId]);

  const loadOrSay: () => void = useCallback((): void => {
    load().catch((error: unknown) => {
      setLoadError(API.getFriendlyMessage(error as Exception));
    });
  }, [load]);

  useEffect(() => {
    loadOrSay();
  }, [loadOrSay, props.refreshToggle]);

  // What the server took of a change, as it lands: the card's rows follow.
  const onApplied: (applied: AppliedLevelChange) => void = (
    applied: AppliedLevelChange,
  ): void => {
    const next: Array<TeamLevelRow> = applyLevelChange(
      rowsRef.current || [],
      applied,
    );

    rowsRef.current = next;
    setLevelRows(next);
  };

  /*
   * Who may change the team's levels: someone who may give and take away
   * the team's permissions. Nothing to say while permissions load: then
   * the levels are read, with no reason given.
   */
  const mayCreate: PermissionGateResult = PermissionGate.check(
    new TeamPermission(),
    ModelAction.Create,
  );
  const mayDelete: PermissionGateResult = PermissionGate.check(
    new TeamPermission(),
    ModelAction.Delete,
  );
  const isLocked: boolean = !mayCreate.isAllowed || !mayDelete.isAllowed;
  const lockReason: string | undefined = !mayCreate.isAllowed
    ? mayCreate.disabledReason
    : mayDelete.disabledReason;

  const entries: Array<TeamProductLevel> = levelRows
    ? getTeamProductLevels(levelRows)
    : [];
  const shownFirst: Array<TeamProductLevel> = getProductsShownFirst(
    entries,
    products.answer.hidden,
  );
  const hasMore: boolean = shownFirst.length < entries.length;
  const shown: Array<TeamProductLevel> = isShowingAll ? entries : shownFirst;
  const groups: Array<ProductLevelGroup<MoreMenuItem>> = groupAsTheMenuDoes(
    shown,
    navigation.moreMenuItems,
  );

  const getContent: () => ReactElement = (): ReactElement => {
    if (loadError) {
      return <ErrorMessage message={loadError} onRefreshClick={loadOrSay} />;
    }

    if (!levelRows) {
      return <DetailListSkeleton fields={6} />;
    }

    return (
      <div className="space-y-6">
        {isLocked && lockReason ? (
          <p
            className="text-sm text-gray-600"
            data-testid={`${TEAM_PRODUCT_ACCESS_TEST_ID}-locked`}
          >
            {lockReason}
          </p>
        ) : (
          <></>
        )}
        {groups.map((group: ProductLevelGroup<MoreMenuItem>): ReactElement => {
          const first: MoreMenuItem | undefined = group.rows[0]?.menuItem;
          const category: string =
            first && !first.isCategoryTranslated
              ? translator.translateText(group.category) || group.category
              : group.category;

          return (
            <section key={group.category || "other"}>
              {category ? (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {category}
                </h3>
              ) : (
                <></>
              )}
              <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200">
                {group.rows.map(
                  (row: ProductLevelRow<MoreMenuItem>): ReactElement => {
                    return (
                      <ProductLevelPicker
                        key={`${row.entry.product}-${
                          generations[row.entry.product] || 0
                        }`}
                        entry={row.entry}
                        teamId={props.teamId}
                        menuItem={row.menuItem}
                        isLocked={isLocked}
                        onApplied={onApplied}
                        onSaved={() => {
                          props.onLevelChange?.();
                        }}
                      />
                    );
                  },
                )}
              </ul>
            </section>
          );
        })}
      </div>
    );
  };

  return (
    <Card
      title={PRODUCT_ACCESS_TITLE}
      description={PRODUCT_ACCESS_DESCRIPTION}
      buttons={
        levelRows && hasMore
          ? [
              {
                title: isShowingAll ? SHOW_FEWER_PRODUCTS : SHOW_ALL_PRODUCTS,
                icon: isShowingAll ? IconProp.ChevronUp : IconProp.ChevronDown,
                buttonStyle: ButtonStyleType.OUTLINE,
                onClick: () => {
                  setIsShowingAll(!isShowingAll);
                },
              },
            ]
          : []
      }
    >
      <div data-testid={TEAM_PRODUCT_ACCESS_TEST_ID}>{getContent()}</div>
    </Card>
  );
};

export default TeamProductAccess;
