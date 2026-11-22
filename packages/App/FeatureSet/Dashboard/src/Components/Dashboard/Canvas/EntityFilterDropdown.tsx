import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EntityDropdown, {
  EntityDropdownValue,
} from "Common/UI/Components/EntityDropdown/EntityDropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import {
  getSharedNameFacts,
  getSharedNameSelect,
} from "Common/UI/Utils/SharedNameOptions";
import Color from "Common/Types/Color";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import RumProductAnalyticsSavedView from "Common/Models/DatabaseModels/RumProductAnalyticsSavedView";
import { ProductAnalyticsSavedViewType } from "Common/Types/Rum/ProductAnalyticsSavedViews";
import { describeProductAnalyticsSavedViewOptions } from "../../ProductAnalytics/ProductAnalyticsSavedViews";
import { EntityFilterModelType } from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import { getUnnamedText } from "../Components/DashboardWidgetFallbackWords";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

type ModelTypeOf<T extends BaseModel> = { new (): T };

interface EntityModelDef<T extends BaseModel> {
  modelType: ModelTypeOf<T>;
  sortField: keyof T;
  sortOrder: SortOrder;
  /*
   * A kind a project can have any number of - monitors, SLOs, labels,
   * clusters, hosts: the picker searches the server as the reader types,
   * 50 by name (EntityDropdown), so every one can be found (#10580). The
   * picker used to read the first 1,000 by name and search those in the
   * browser, so a monitor whose name sorted past the 1,000th was never
   * offered. The other kinds are short lists of the project's own values
   * (severities, states, site types) or of saved views, kept in their own
   * order (or worded under their names) and read whole.
   */
  isSearchedOnServer?: boolean | undefined;
  /*
   * Narrows what can be PICKED for a new selection, on top of the project
   * scope - e.g. archived SLOs are retired and must not be offered for a new
   * widget or variable. An item that is already selected is still shown (see
   * the load below), labelled with `unpickableLabelTemplate`.
   */
  pickableQuery?: Query<T> | undefined;
  /*
   * A selected item the list is missing is not necessarily unpickable - it may
   * just sit past the list's row cap. `isUnpickable` tells the two apart for an
   * item looked up by id, reading the fields named in `unpickableSelect`, and
   * only an item it flags gets `unpickableLabelTemplate`.
   */
  unpickableSelect?: Record<string, true> | undefined;
  isUnpickable?: ((item: T) => boolean) | undefined;
  /*
   * The label of such an item, as a whole sentence with its name in it
   * ("{{name}} (archived)"), so the word beside the name reads in the
   * reader's language (#8297).
   */
  unpickableLabelTemplate?: string | undefined;
  /*
   * Columns an option is worded from beside its name, and a step that
   * words the options once they are read - a saved funnel's application
   * under its name. Best effort: a step that fails leaves the names.
   */
  optionSelect?: Record<string, true> | undefined;
  describeOptions?:
    | ((data: {
        items: Array<T>;
        options: Array<DropdownOption>;
        projectId: ObjectID;
      }) => Promise<void>)
    | undefined;
}

// An archived SLO a widget or a variable still points at.
export const ARCHIVED_SLO_LABEL: string = translationKey("{{name}} (archived)");

/*
 * A selected item that can no longer be picked, labelled with the sentence
 * that says why: its name as it reads in the picker (a name as written,
 * "Unnamed" in the reader's words already), inside a sentence in the
 * reader's language - "Checkout latency (archivado)". The sentence is
 * translated here, so the option is drawn as given (isUserContent), never
 * looked up again. It was the name and an English " (archived)" glued on,
 * drawn as written in every language (#8297).
 */
export const getUnpickableOption: (
  option: DropdownOption,
  template: string,
  translator: Translator,
) => DropdownOption = (
  option: DropdownOption,
  template: string,
  translator: Translator,
): DropdownOption => {
  return {
    ...option,
    label: translator.translateTemplate(
      template,
      { name: option.label },
      { setsValuesApart: true },
    ),
    isUserContent: true,
  };
};

type ToDropdownOptionFunction = (
  item: BaseModel,
  colorColumnName: string | null,
) => DropdownOption;

/*
 * A severity, state or monitor status (and a label) is offered with its
 * colour, the dot every other picker of them shows.
 */
const toDropdownOption: ToDropdownOptionFunction = (
  item: BaseModel,
  colorColumnName: string | null,
): DropdownOption => {
  const option: DropdownOption = {
    value: ((item as unknown as { _id: string })._id as string) || "",
    label:
      ((item as unknown as { name: string }).name as string) ||
      getUnnamedText(),
    /*
     * The name reads by its row's table: a default state's, severity's or
     * monitor status's name is OneUptime's word, looked up; any other name,
     * and "Unnamed" (already the reader's word), is drawn as written.
     */
    isUserContent:
      !(item as unknown as { name: string }).name ||
      isRecordNameAsWritten(
        item.tableName,
        (item as unknown as { name: string }).name,
      ),
  };

  const color: Color | undefined = colorColumnName
    ? DropdownUtil.toOptionColor(
        (item as unknown as Record<string, unknown>)[colorColumnName],
      )
    : undefined;

  if (color) {
    option.color = color;
  }

  // A label that shares its name is told apart from the others (#10064).
  const sharedName: DropdownOption["sharedName"] = getSharedNameFacts(item);

  if (sharedName) {
    option.sharedName = sharedName;
  }

  return option;
};

type GetColorColumnNameFunction = (
  modelType: ModelTypeOf<BaseModel>,
) => string | null;

// The model's colour column (a severity's, a state's), if it has one.
const getColorColumnName: GetColorColumnNameFunction = (
  modelType: ModelTypeOf<BaseModel>,
): string | null => {
  return new modelType().getFirstColorColumn();
};

type GetOptionSelectFunction = (
  colorColumnName: string | null,
) => Record<string, true>;

// The columns an option is built from: the name, the id and any colour.
const getOptionSelect: GetOptionSelectFunction = (
  colorColumnName: string | null,
): Record<string, true> => {
  const select: Record<string, true> = { _id: true, name: true };

  if (colorColumnName) {
    select[colorColumnName] = true;
  }

  return select;
};

type GetSelectedIdsFunction = (
  value: string | Array<string> | undefined,
) => Array<string>;

const getSelectedIds: GetSelectedIdsFunction = (
  value: string | Array<string> | undefined,
): Array<string> => {
  const ids: Array<string> = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];

  return ids.filter((id: string): boolean => {
    return typeof id === "string" && id.length > 0;
  });
};

export function getEntityModelDef(
  entityFilterModelType: EntityFilterModelType,
): EntityModelDef<BaseModel> {
  switch (entityFilterModelType) {
    case EntityFilterModelType.IncidentSeverity:
      return {
        modelType: IncidentSeverity as unknown as ModelTypeOf<BaseModel>,
        sortField: "order" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.AlertSeverity:
      return {
        modelType: AlertSeverity as unknown as ModelTypeOf<BaseModel>,
        sortField: "order" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.IncidentState:
      return {
        modelType: IncidentState as unknown as ModelTypeOf<BaseModel>,
        sortField: "order" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.AlertState:
      return {
        modelType: AlertState as unknown as ModelTypeOf<BaseModel>,
        sortField: "order" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.MonitorStatus:
      return {
        modelType: MonitorStatus as unknown as ModelTypeOf<BaseModel>,
        sortField: "priority" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    case EntityFilterModelType.Monitor:
      return {
        modelType: Monitor as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.ServiceLevelObjective:
      return {
        modelType: ServiceLevelObjective as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
        /*
         * An archived SLO is retired - not evaluated, its numbers frozen - so
         * it is not offered for a new widget or dashboard variable. A widget
         * that already points at one keeps loading it by id.
         */
        pickableQuery: { isArchived: false } as Query<BaseModel>,
        unpickableSelect: { isArchived: true },
        isUnpickable: (item: BaseModel): boolean => {
          return (item as ServiceLevelObjective).isArchived === true;
        },
        unpickableLabelTemplate: ARCHIVED_SLO_LABEL,
      };
    case EntityFilterModelType.Label:
      return {
        modelType: Label as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.KubernetesCluster:
      return {
        modelType: KubernetesCluster as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.DockerHost:
      return {
        modelType: DockerHost as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.PodmanHost:
      return {
        modelType: PodmanHost as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.ProxmoxCluster:
      return {
        modelType: ProxmoxCluster as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.VMwareVCenter:
      return {
        modelType: VMwareVCenter as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.CephCluster:
      return {
        modelType: CephCluster as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.StorageArray:
      return {
        modelType: StorageArray as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.DockerSwarmCluster:
      return {
        modelType: DockerSwarmCluster as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        isSearchedOnServer: true,
      };
    case EntityFilterModelType.ProductAnalyticsSavedFunnel:
    case EntityFilterModelType.ProductAnalyticsSavedRetention:
      /*
       * A Funnel widget picks one of the project's saved funnels, a
       * Retention widget one of its saved retention tables, each named
       * with its RUM application under it.
       */
      return {
        modelType:
          RumProductAnalyticsSavedView as unknown as ModelTypeOf<BaseModel>,
        sortField: "name" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
        pickableQuery: {
          viewType:
            entityFilterModelType ===
            EntityFilterModelType.ProductAnalyticsSavedFunnel
              ? ProductAnalyticsSavedViewType.Funnel
              : ProductAnalyticsSavedViewType.Retention,
        } as Query<BaseModel>,
        optionSelect: { rumApplicationId: true },
        describeOptions: describeProductAnalyticsSavedViewOptions as (data: {
          items: Array<BaseModel>;
          options: Array<DropdownOption>;
          projectId: ObjectID;
        }) => Promise<void>,
      };
    case EntityFilterModelType.NetworkSiteType:
      /*
       * `order` places a type in the hierarchy (lower is higher up), so
       * sorting by it lists Region before Market before Store — the order a
       * customer thinks about their own estate in.
       */
      return {
        modelType: NetworkSiteType as unknown as ModelTypeOf<BaseModel>,
        sortField: "order" as keyof BaseModel,
        sortOrder: SortOrder.Ascending,
      };
    default:
      throw new Error(
        `Unsupported entity filter model type: ${entityFilterModelType}`,
      );
  }
}

export interface EntityFilterDropdownProps {
  entityFilterModelType: EntityFilterModelType;
  isMultiSelect: boolean;
  value: string | Array<string> | undefined;
  placeholder?: string | undefined;
  onChange: (value: string | Array<string> | null) => void;
}

// The rows one read of a short list takes; every page is read.
export const ENTITY_FILTER_LIST_PAGE_SIZE: number = 1000;

/*
 * A short list read whole: a page at a time until every row is in, in the
 * list's own order. One read for every project there is, but never a row
 * left out of the options because it came after the first page.
 */
const readEveryPage: (data: {
  def: EntityModelDef<BaseModel>;
  projectId: ObjectID;
  select: Record<string, true>;
}) => Promise<Array<BaseModel>> = async (data: {
  def: EntityModelDef<BaseModel>;
  projectId: ObjectID;
  select: Record<string, true>;
}): Promise<Array<BaseModel>> => {
  const rows: Array<BaseModel> = [];

  for (;;) {
    const page: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
      modelType: data.def.modelType,
      query: {
        ...(data.def.pickableQuery || {}),
        projectId: data.projectId,
      } as Query<BaseModel>,
      limit: ENTITY_FILTER_LIST_PAGE_SIZE,
      skip: rows.length,
      select: data.select,
      sort: { [data.def.sortField]: data.def.sortOrder } as Record<
        string,
        SortOrder
      >,
    });

    rows.push(...page.data);

    if (
      page.data.length === 0 ||
      page.data.length < ENTITY_FILTER_LIST_PAGE_SIZE ||
      rows.length >= page.count
    ) {
      return rows;
    }
  }
};

const ListedEntityFilterDropdown: FunctionComponent<
  EntityFilterDropdownProps
> = (props: EntityFilterDropdownProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [options, setOptions] = useState<Array<DropdownOption>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        setError("No project selected.");
        setIsLoading(false);
        return;
      }

      try {
        const def: EntityModelDef<BaseModel> = getEntityModelDef(
          props.entityFilterModelType,
        );

        const colorColumnName: string | null = getColorColumnName(
          def.modelType,
        );

        const listedRows: Array<BaseModel> = await readEveryPage({
          def: def,
          projectId: projectId,
          select: {
            ...(def.optionSelect || {}),
            ...getOptionSelect(colorColumnName),
            ...getSharedNameSelect(def.modelType),
          },
        });

        const newOptions: Array<DropdownOption> = listedRows.map(
          (item: BaseModel): DropdownOption => {
            return toDropdownOption(item, colorColumnName);
          },
        );
        // The rows the options were built from, in the same order.
        const optionItems: Array<BaseModel> = [...listedRows];

        /*
         * A saved selection can be missing from the list above: past its row
         * cap in a big project, or no longer pickable (a widget pointing at an
         * SLO that has since been archived). Left out, the dropdown would
         * render as if nothing were chosen while the widget keeps using the
         * item - and the next multi-select edit would silently drop it. So
         * those items are fetched by id and shown, the unpickable ones marked,
         * for the user to keep or remove on purpose.
         *
         * Only well-formed ids are looked up: a saved value that is not one
         * would make the server reject the whole lookup and cost the real
         * selections their labels too.
         */
        const unlistedSelectedIds: Array<string> = getSelectedIds(
          props.value,
        ).filter((id: string): boolean => {
          return (
            ObjectID.isValidUUID(id) &&
            !newOptions.some((option: DropdownOption): boolean => {
              return option.value === id;
            })
          );
        });

        if (unlistedSelectedIds.length > 0) {
          try {
            const selectedResult: ListResult<BaseModel> =
              await ModelAPI.getList<BaseModel>({
                modelType: def.modelType,
                query: {
                  projectId: projectId,
                  _id: new Includes(
                    unlistedSelectedIds.map((id: string): ObjectID => {
                      return new ObjectID(id);
                    }),
                  ),
                } as Query<BaseModel>,
                limit: unlistedSelectedIds.length,
                skip: 0,
                select: {
                  ...(def.unpickableSelect || {}),
                  ...(def.optionSelect || {}),
                  ...getOptionSelect(colorColumnName),
                } as Record<string, true>,
                sort: { [def.sortField]: def.sortOrder } as Record<
                  string,
                  SortOrder
                >,
              });

            for (const item of selectedResult.data) {
              const listed: DropdownOption = toDropdownOption(
                item,
                colorColumnName,
              );
              const option: DropdownOption =
                def.isUnpickable?.(item) && def.unpickableLabelTemplate
                  ? getUnpickableOption(
                      listed,
                      def.unpickableLabelTemplate,
                      translator,
                    )
                  : listed;

              newOptions.push(option);
              optionItems.push(item);
            }
          } catch {
            /*
             * This lookup only labels a selection the list is missing. Failing
             * it must not take the pickable list down with it.
             */
          }
        }

        if (def.describeOptions) {
          try {
            await def.describeOptions({
              items: optionItems,
              options: newOptions,
              projectId: projectId,
            });
          } catch {
            // The options keep their names: wording them is no reason to fail.
          }
        }

        setOptions(newOptions);
        setError(null);
      } catch (err: unknown) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsLoading(false);
    };

    load();
  }, [props.entityFilterModelType]);

  if (isLoading) {
    return (
      <div className="text-xs text-gray-500 py-2 px-3 border border-gray-200 rounded-md bg-gray-50">
        {translator.translateText("Loading options...")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-red-600 py-2 px-3 border border-red-200 rounded-md bg-red-50">
        <ErrorInSentence message={error} showWhereToLook={true} />
      </div>
    );
  }

  let initialValue: DropdownOption | Array<DropdownOption> | undefined =
    undefined;

  if (props.isMultiSelect) {
    const selectedValues: Array<string> = Array.isArray(props.value)
      ? props.value
      : [];
    initialValue = options.filter((opt: DropdownOption) => {
      return selectedValues.includes(opt.value as string);
    });
  } else if (typeof props.value === "string" && props.value) {
    initialValue = options.find((opt: DropdownOption) => {
      return opt.value === props.value;
    });
  }

  return (
    <Dropdown
      options={options}
      isMultiSelect={props.isMultiSelect}
      placeholder={props.placeholder || "Select..."}
      value={initialValue}
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        props.onChange(toPickedValue(value, props.isMultiSelect));
      }}
    />
  );
};

// What the widget's argument keeps of a pick: ids, as text.
export const toPickedValue: (
  value: DropdownValue | Array<DropdownValue> | null,
  isMultiSelect: boolean,
) => string | Array<string> = (
  value: DropdownValue | Array<DropdownValue> | null,
  isMultiSelect: boolean,
): string | Array<string> => {
  if (value === null) {
    return isMultiSelect ? [] : "";
  }

  if (Array.isArray(value)) {
    return value.map((v: DropdownValue) => {
      return v.toString();
    });
  }

  return value.toString();
};

/*
 * What a saved item that is no longer there reads as - deleted since, or
 * out of the reader's reach - rather than its id.
 */
export const ENTITY_FILTER_NOT_FOUND_LABEL: string = translationKey(
  "No longer available",
);

/*
 * A KIND A PROJECT CAN HAVE ANY NUMBER OF, SEARCHED ON THE SERVER (#10580).
 *
 * The picker (EntityDropdown) asks the server for 50 by name as the reader
 * types, within the kind's own rules (an archived SLO is never offered,
 * nor an archived label), so a monitor is found by its name however many
 * the project has. What the widget already points at is read by its id
 * first, so it is named - an archived SLO as "{{name}} (archived)" - even
 * where no search would offer it.
 */
const SearchedEntityFilterDropdown: FunctionComponent<
  EntityFilterDropdownProps
> = (props: EntityFilterDropdownProps): ReactElement => {
  const translator: Translator = useTranslator();
  const def: EntityModelDef<BaseModel> = getEntityModelDef(
    props.entityFilterModelType,
  );
  // The saved items, named, by id; null while they are read.
  const [savedOptions, setSavedOptions] = useState<Map<
    string,
    DropdownOption
  > | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setSavedOptions(null);

      /*
       * Only well-formed ids are looked up: a saved value that is not one
       * would make the server refuse the whole lookup and cost the real
       * selections their names too.
       */
      const ids: Array<string> = getSelectedIds(props.value).filter(
        (id: string): boolean => {
          return ObjectID.isValidUUID(id);
        },
      );

      if (ids.length === 0) {
        setSavedOptions(new Map<string, DropdownOption>());
        return;
      }

      const named: Map<string, DropdownOption> = new Map<
        string,
        DropdownOption
      >();

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      try {
        const colorColumnName: string | null = getColorColumnName(
          def.modelType,
        );

        const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>(
          {
            modelType: def.modelType,
            query: {
              ...(projectId ? { projectId: projectId } : {}),
              _id: new Includes(
                ids.map((id: string): ObjectID => {
                  return new ObjectID(id);
                }),
              ),
            } as Query<BaseModel>,
            limit: ids.length,
            skip: 0,
            select: {
              ...(def.unpickableSelect || {}),
              ...getOptionSelect(colorColumnName),
              ...getSharedNameSelect(def.modelType),
            } as Record<string, true>,
            sort: {},
          },
        );

        for (const item of result.data) {
          const listed: DropdownOption = toDropdownOption(
            item,
            colorColumnName,
          );

          named.set(
            String(listed.value).toLowerCase(),
            def.isUnpickable?.(item) && def.unpickableLabelTemplate
              ? getUnpickableOption(
                  listed,
                  def.unpickableLabelTemplate,
                  translator,
                )
              : listed,
          );
        }
      } catch {
        /*
         * Naming the saved items is a nicety: the picker names them itself
         * when this read fails, and searching must not fail with it.
         */
      }

      if (isCurrent) {
        setSavedOptions(named);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [props.entityFilterModelType]);

  if (savedOptions === null) {
    return (
      <div className="text-xs text-gray-500 py-2 px-3 border border-gray-200 rounded-md bg-gray-50">
        {translator.translateText("Loading options...")}
      </div>
    );
  }

  // What the widget holds, each named where its name was read.
  const held: Array<DropdownOption | string> = getSelectedIds(props.value).map(
    (id: string): DropdownOption | string => {
      return savedOptions.get(id.toLowerCase()) || id;
    },
  );

  return (
    <EntityDropdown
      modelType={def.modelType}
      labelField="name"
      valueField="_id"
      query={def.pickableQuery as Record<string, unknown> | undefined}
      isMultiSelect={props.isMultiSelect}
      value={
        (props.isMultiSelect ? held : held[0] || null) as EntityDropdownValue
      }
      placeholder={props.placeholder || "Select..."}
      notFoundLabel={ENTITY_FILTER_NOT_FOUND_LABEL}
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        props.onChange(toPickedValue(value, props.isMultiSelect));
      }}
    />
  );
};

/*
 * Whether a kind's picker searches the server. A kind this build does not
 * know is listed, and the list says it cannot be read, as it always did.
 */
export const isEntityFilterSearchedOnServer: (
  entityFilterModelType: EntityFilterModelType,
) => boolean = (entityFilterModelType: EntityFilterModelType): boolean => {
  try {
    return Boolean(getEntityModelDef(entityFilterModelType).isSearchedOnServer);
  } catch {
    return false;
  }
};

const EntityFilterDropdown: FunctionComponent<EntityFilterDropdownProps> = (
  props: EntityFilterDropdownProps,
): ReactElement => {
  if (isEntityFilterSearchedOnServer(props.entityFilterModelType)) {
    // Keyed by kind: a widget's argument never changes kind in place.
    return (
      <SearchedEntityFilterDropdown
        key={props.entityFilterModelType}
        {...props}
      />
    );
  }

  return (
    <ListedEntityFilterDropdown key={props.entityFilterModelType} {...props} />
  );
};

export default EntityFilterDropdown;
