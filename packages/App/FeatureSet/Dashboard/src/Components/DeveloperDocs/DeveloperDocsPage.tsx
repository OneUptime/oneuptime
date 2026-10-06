import PageComponentProps from "../../Pages/PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SetupGuideMarkdown from "../SetupGuide/SetupGuideMarkdown";
import SetupGuideSteps, {
  SetupGuideStepVariants,
  SetupGuideStepVariantView,
  SetupGuideStepView,
} from "../SetupGuide/SetupGuideSteps";
import SetupGuideTopics, {
  SetupGuideTopicView,
} from "../SetupGuide/SetupGuideTopics";
import {
  getSetupGuideOneUptimeUrl,
  SetupGuideLink,
  SetupGuideStepVariant,
  SetupGuideTopic,
} from "../SetupGuide/SetupGuide";
import {
  DEVELOPER_DOCS_IMPORT_LIMIT,
  DEVELOPER_DOCS_LEARN_MORE_LABEL,
  DEVELOPER_DOCS_NOT_FOUND_MESSAGE,
  DeveloperDocsGuide,
  DeveloperDocsRecord,
  DeveloperDocsSample,
  DeveloperDocsSection,
  DeveloperDocsStep,
  getDeveloperDocsGuide,
} from "./DeveloperDocsGuides";
import {
  DEVELOPER_DOCS_PAGES,
  DeveloperDocsPageDefinition,
  DeveloperDocsPageType,
  DeveloperDocsScope,
} from "./DeveloperDocsPages";
import { DeveloperDocsResource } from "./DeveloperDocsResources";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { getApiReadSelect } from "Common/Utils/DeveloperDocs/ExampleBuilder";
import {
  addDeveloperDocsLookupResult,
  DeveloperDocsLiveData,
  DeveloperDocsLiveRecord,
  DeveloperDocsLookup,
  getEmptyDeveloperDocsLiveData,
  toDeveloperDocsLiveRecord,
} from "Common/Utils/DeveloperDocs/LiveData";
import {
  DeveloperDocsPageKind,
  getDeveloperDocsPageLookups,
} from "Common/Utils/DeveloperDocs/PageLookups";
import {
  getNameColumn,
  getTerraformAttributes,
  TerraformAttributeDescriptor,
  TerraformValueKind,
} from "Common/Utils/DeveloperDocs/TerraformSchema";
import { TerraformImportTarget } from "Common/Utils/DeveloperDocs/TerraformConfig";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import { HOST, HTTP_PROTOCOL, VERSION } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslateValue from "Common/UI/Utils/Translation";
import User from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";

/*
 * A Developer page: Terraform, API or AI Assistants, for one resource (its
 * view menu) or for its type (its list menu). One component for every
 * resource; what it says comes from DeveloperDocsGuides, written from the
 * model's metadata, the resource's profile, and the project as it is now:
 * the record itself on a view page, and a few of the records its examples
 * point at (the project's severities, monitors, teams), so the examples are
 * the project's own and every id names its record.
 *
 * Laid out like the product's setup guides: numbered steps, then ready-made
 * recipes, then folded extras under "More", then links to the full
 * documentation.
 *
 * Secrets never reach this page: the record is fetched without the fields
 * that hold them (TerraformSchema marks them), and the lookups ask for ids,
 * names and a few yes/no flags only, so no secret can leak into the
 * configuration, a curl command or a prompt even by mistake. Every request
 * asks only for what the viewer may read; a lookup that fails all the same
 * only costs its examples their real values.
 */

export interface ComponentProps extends PageComponentProps {
  resource: DeveloperDocsResource;
  scope: DeveloperDocsScope;
  page: DeveloperDocsPageType;
}

// Columns every request may select (ColumnPermissions.getExcludedColumnNames).
const ALWAYS_READABLE_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "createdAt",
  "updatedAt",
];

/*
 * Whether the viewer may read a column (ModelDetail's rule), read the way the
 * server reads it (PermissionGate): one of the column's read permissions, no
 * team block on any of them.
 */
function canReadColumn(descriptor: TerraformAttributeDescriptor): boolean {
  return PermissionGate.holdsAnyOf(descriptor.readPermissions);
}

// Whether the viewer may read a column of any model, by name.
function canReadModelColumn(
  modelType: DatabaseBaseModelType,
  column: string,
): boolean {
  if (ALWAYS_READABLE_COLUMNS.includes(column)) {
    return true;
  }

  return PermissionGate.holdsColumnPermission(new modelType(), column, "read");
}

// Whether the viewer may list a model at all.
function canReadModel(modelType: DatabaseBaseModelType): boolean {
  return PermissionGate.check(new modelType(), ModelAction.Read).isAllowed;
}

function toPageKind(page: DeveloperDocsPageType): DeveloperDocsPageKind {
  switch (page) {
    case DeveloperDocsPageType.Terraform:
      return "terraform";
    case DeveloperDocsPageType.Api:
      return "api";
    case DeveloperDocsPageType.AiAssistants:
      return "ai-assistants";
  }
}

/*
 * What to fetch for the record: its name always; on the Terraform page
 * every attribute the configuration may carry, and on the API page the
 * fields its read example asks for, in both cases only those the viewer may
 * read. Secret fields are never asked for.
 */
export function getDeveloperDocsRecordSelect(data: {
  modelType: DatabaseBaseModelType;
  page: DeveloperDocsPageType;
  canRead: (descriptor: TerraformAttributeDescriptor) => boolean;
  canReadColumn?: ((column: string) => boolean) | undefined;
}): JSONObject {
  const select: JSONObject = { _id: true };
  const nameColumn: string | null = getNameColumn(data.modelType);
  const attributes: Array<TerraformAttributeDescriptor> =
    getTerraformAttributes(data.modelType);
  const nameAttribute: TerraformAttributeDescriptor | undefined =
    attributes.find((descriptor: TerraformAttributeDescriptor): boolean => {
      return descriptor.columnName === nameColumn;
    });

  if (nameColumn && (!nameAttribute || data.canRead(nameAttribute))) {
    select[nameColumn] = true;
  }

  if (data.page === DeveloperDocsPageType.Api) {
    const secrets: Set<string> = new Set<string>(
      attributes
        .filter((descriptor: TerraformAttributeDescriptor): boolean => {
          return Boolean(descriptor.secretKind);
        })
        .map((descriptor: TerraformAttributeDescriptor): string => {
          return descriptor.columnName;
        }),
    );

    for (const column of Object.keys(getApiReadSelect(data.modelType))) {
      if (
        !secrets.has(column) &&
        (data.canReadColumn ? data.canReadColumn(column) : true)
      ) {
        select[column] = true;
      }
    }

    return select;
  }

  if (data.page !== DeveloperDocsPageType.Terraform) {
    return select;
  }

  for (const descriptor of attributes) {
    if (
      descriptor.secretKind ||
      descriptor.kind === TerraformValueKind.Unsupported ||
      !data.canRead(descriptor)
    ) {
      continue;
    }

    select[descriptor.columnName] =
      descriptor.kind === TerraformValueKind.IdSet ? { _id: true } : true;
  }

  return select;
}

function getDisplayName(
  modelType: DatabaseBaseModelType,
  json: JSONObject,
): string | null {
  const nameColumn: string | null = getNameColumn(modelType);
  const value: unknown = nameColumn ? json[nameColumn] : undefined;

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getPageDefinition(
  page: DeveloperDocsPageType,
): DeveloperDocsPageDefinition {
  return (
    DEVELOPER_DOCS_PAGES.find(
      (definition: DeveloperDocsPageDefinition): boolean => {
        return definition.type === page;
      },
    ) || (DEVELOPER_DOCS_PAGES[0] as DeveloperDocsPageDefinition)
  );
}

/*
 * One lookup, as the viewer may make it: only the columns they may read,
 * and not at all when they may not list the table. Null when there is
 * nothing to ask.
 */
export function getReadableDeveloperDocsLookup(
  lookup: DeveloperDocsLookup,
  canRead: {
    model: (modelType: DatabaseBaseModelType) => boolean;
    column: (modelType: DatabaseBaseModelType, column: string) => boolean;
  },
): DeveloperDocsLookup | null {
  if (!canRead.model(lookup.modelType)) {
    return null;
  }

  const select: Dictionary<boolean> = {};

  for (const column of Object.keys(lookup.select)) {
    if (canRead.column(lookup.modelType, column)) {
      select[column] = true;
    }
  }

  // Naming records is the point of a lookup by id.
  const nameColumn: string | null = getNameColumn(lookup.modelType);

  if (lookup.ids && (!nameColumn || !select[nameColumn])) {
    return null;
  }

  return { ...lookup, select };
}

// Runs the lookups side by side; one that fails leaves its examples as placeholders.
async function runLookups(
  lookups: Array<DeveloperDocsLookup>,
  live: DeveloperDocsLiveData,
): Promise<DeveloperDocsLiveData> {
  const results: Array<{
    lookup: DeveloperDocsLookup;
    records: Array<DeveloperDocsLiveRecord>;
  } | null> = await Promise.all(
    lookups.map(
      async (
        lookup: DeveloperDocsLookup,
      ): Promise<{
        lookup: DeveloperDocsLookup;
        records: Array<DeveloperDocsLiveRecord>;
      } | null> => {
        try {
          const list: ListResult<BaseModel> = await ModelAPI.getList({
            modelType: lookup.modelType,
            query: (lookup.ids
              ? { _id: new Includes(lookup.ids) }
              : {}) as never,
            select: lookup.select as never,
            sort: Object.fromEntries(
              Object.entries(lookup.sort).map(
                ([column, order]: [string, "ASC" | "DESC"]) => {
                  return [
                    column,
                    order === "ASC"
                      ? SortOrder.Ascending
                      : SortOrder.Descending,
                  ];
                },
              ),
            ) as never,
            limit: lookup.limit,
            skip: 0,
          });

          return {
            lookup,
            records: list.data
              .map((item: BaseModel): DeveloperDocsLiveRecord | null => {
                return toDeveloperDocsLiveRecord({
                  modelType: lookup.modelType,
                  json: BaseModel.toJSON(item, lookup.modelType),
                });
              })
              .filter(
                (
                  record: DeveloperDocsLiveRecord | null,
                ): record is DeveloperDocsLiveRecord => {
                  return record !== null;
                },
              ),
          };
        } catch {
          // Its examples keep their placeholders.
          return null;
        }
      },
    ),
  );

  let result: DeveloperDocsLiveData = live;

  for (const item of results) {
    if (item) {
      result = addDeveloperDocsLookupResult(result, item.lookup, item.records);
    }
  }

  return result;
}

export interface PromptListProps {
  prompts: Array<string>;
}

// Prompts to paste into an assistant, each with a copy button.
export const DeveloperDocsPromptList: FunctionComponent<PromptListProps> = (
  props: PromptListProps,
): ReactElement => {
  return (
    <ul className="space-y-2" data-testid="developer-docs-prompts">
      {props.prompts.map((prompt: string) => {
        return (
          <li
            key={prompt}
            className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5"
          >
            <div className="mt-0.5 flex-shrink-0 text-indigo-500">
              <Icon icon={IconProp.ChatBubbleLeft} className="h-4 w-4" />
            </div>
            <p className="min-w-0 flex-1 break-words text-sm leading-relaxed text-gray-700">
              {prompt}
            </p>
            <CopyTextButton
              textToBeCopied={prompt}
              size="sm"
              title="Copy this prompt"
              className="flex-shrink-0"
            />
          </li>
        );
      })}
    </ul>
  );
};

function toVariantViews(
  variants: Array<SetupGuideStepVariant>,
): Array<SetupGuideStepVariantView> {
  return variants.map(
    (variant: SetupGuideStepVariant): SetupGuideStepVariantView => {
      return {
        label: variant.label,
        content: <SetupGuideMarkdown text={variant.markdown} />,
      };
    },
  );
}

function toStepView(step: DeveloperDocsStep): SetupGuideStepView {
  return {
    title: step.title,
    description: step.description,
    content: (
      <div className="space-y-3">
        {step.markdown && <SetupGuideMarkdown text={step.markdown} />}
        {step.variants && step.variants.length > 0 && (
          <SetupGuideStepVariants variants={toVariantViews(step.variants)} />
        )}
        {step.prompts && step.prompts.length > 0 && (
          <DeveloperDocsPromptList prompts={step.prompts} />
        )}
      </div>
    ),
  };
}

export interface SectionViewProps {
  section: DeveloperDocsSection;
}

/*
 * A section after the steps: ready-made recipes, one tab each, or a
 * reference table. Headed like a step, but not numbered: none of it has to
 * be done, or done in order.
 */
export const DeveloperDocsSectionView: FunctionComponent<SectionViewProps> = (
  props: SectionViewProps,
): ReactElement => {
  const section: DeveloperDocsSection = props.section;

  return (
    <section
      className="mt-8 border-t border-gray-100 pt-6"
      data-testid="developer-docs-section"
    >
      <h3 className="text-sm font-semibold text-gray-900">{section.title}</h3>
      {section.description && (
        <p className="mb-3 mt-0.5 text-sm leading-relaxed text-gray-500">
          {section.description}
        </p>
      )}
      <div className="space-y-3">
        {section.markdown && <SetupGuideMarkdown text={section.markdown} />}
        {section.variants && section.variants.length > 0 && (
          <SetupGuideStepVariants variants={toVariantViews(section.variants)} />
        )}
      </div>
    </section>
  );
};

export interface GuideViewProps {
  guide: DeveloperDocsGuide;
  icon: IconProp;
}

// The guide card. Exported for the tests, which render it from guide data.
export const DeveloperDocsGuideView: FunctionComponent<GuideViewProps> = (
  props: GuideViewProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const guide: DeveloperDocsGuide = props.guide;

  const topics: Array<SetupGuideTopicView> = guide.topics.map(
    (topic: SetupGuideTopic): SetupGuideTopicView => {
      return {
        title: topic.title,
        summary: topic.summary,
        content: <SetupGuideMarkdown text={topic.markdown} />,
      };
    },
  );

  return (
    <div className="mb-5" data-testid="developer-docs-guide">
      <div className="overflow-visible rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-5 sm:px-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50">
              <Icon icon={props.icon} className="h-5 w-5 text-indigo-600" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {translateString(guide.title)}
              </h2>
              <p className="mt-0.5 text-sm leading-relaxed text-gray-500">
                {translateString(guide.description)}
              </p>
            </div>
          </div>
        </div>

        <div className="px-4 py-6 sm:px-6">
          {guide.notice && (
            <div className="mb-6" data-testid="developer-docs-notice">
              <Alert type={AlertType.INFO} title={guide.notice} />
            </div>
          )}

          <SetupGuideSteps steps={guide.steps.map(toStepView)} />

          {guide.sections.map((section: DeveloperDocsSection) => {
            return (
              <DeveloperDocsSectionView key={section.title} section={section} />
            );
          })}

          {topics.length > 0 && (
            <div className="mt-8">
              <SetupGuideTopics
                title="More"
                description={topics
                  .map((topic: SetupGuideTopicView): string => {
                    return topic.title;
                  })
                  .join(" · ")}
                icon={IconProp.AdjustmentHorizontal}
                topics={topics}
                testId="developer-docs-more"
              />
            </div>
          )}

          {guide.links.length > 0 && (
            <div
              className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500"
              data-testid="developer-docs-links"
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon icon={IconProp.BookOpen} className="h-4 w-4" />
                {translateString(DEVELOPER_DOCS_LEARN_MORE_LABEL)}
              </span>
              {guide.links.map((link: SetupGuideLink) => {
                return (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                  >
                    {link.title}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function getCurrentUserId(): string | undefined {
  try {
    const id: string = User.getUserId().toString();
    return id || undefined;
  } catch {
    return undefined;
  }
}

const DeveloperDocsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { id } = useParams();
  const modelType: DatabaseBaseModelType = props.resource.modelType;
  const isView: boolean = props.scope === DeveloperDocsScope.View;
  const needsImports: boolean =
    !isView && props.page === DeveloperDocsPageType.Terraform;
  const needsSample: boolean =
    !isView && props.page === DeveloperDocsPageType.Api;
  const usesLiveData: boolean =
    props.page !== DeveloperDocsPageType.AiAssistants;

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [record, setRecord] = useState<DeveloperDocsRecord | undefined>(
    undefined,
  );
  const [importTargets, setImportTargets] = useState<
    Array<TerraformImportTarget>
  >([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [sample, setSample] = useState<DeveloperDocsSample | undefined>(
    undefined,
  );
  const [live, setLive] = useState<DeveloperDocsLiveData>(
    getEmptyDeveloperDocsLiveData(new Date()),
  );

  const load: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      let nextRecord: DeveloperDocsRecord | undefined = undefined;

      if (isView) {
        const modelId: ObjectID = new ObjectID(id || "");
        const item: BaseModel | null = await ModelAPI.getItem({
          modelType,
          id: modelId,
          select: getDeveloperDocsRecordSelect({
            modelType,
            page: props.page,
            canRead: canReadColumn,
            canReadColumn: (column: string): boolean => {
              return canReadModelColumn(modelType, column);
            },
          }) as never,
        });

        if (!item) {
          setError(DEVELOPER_DOCS_NOT_FOUND_MESSAGE);
          return;
        }

        const json: JSONObject = BaseModel.toJSON(item, modelType);

        nextRecord = {
          id: modelId.toString(),
          displayName: getDisplayName(modelType, json),
          json,
        };
      }

      if (needsImports) {
        const nameColumn: string | null = getNameColumn(modelType);
        const select: Dictionary<boolean> = { _id: true };

        if (nameColumn) {
          select[nameColumn] = true;
        }

        const list: ListResult<BaseModel> = await ModelAPI.getList({
          modelType,
          query: {},
          select: select as never,
          sort: { createdAt: SortOrder.Ascending } as never,
          limit: DEVELOPER_DOCS_IMPORT_LIMIT,
          skip: 0,
        });

        setTotalCount(list.count);
        setImportTargets(
          list.data.map((item: BaseModel): TerraformImportTarget => {
            const json: JSONObject = BaseModel.toJSON(item, modelType);

            return {
              id: item.id?.toString() || String(json["_id"] || ""),
              displayName: getDisplayName(modelType, json),
            };
          }),
        );
      }

      let nextSample: DeveloperDocsSample | undefined = undefined;

      if (needsSample && canReadModel(modelType)) {
        // The first record as the list example returns it; without it the page shows no response.
        try {
          const select: Dictionary<boolean> = {};

          for (const column of Object.keys(getApiReadSelect(modelType))) {
            if (canReadModelColumn(modelType, column)) {
              select[column] = true;
            }
          }

          const list: ListResult<BaseModel> = await ModelAPI.getList({
            modelType,
            query: {},
            select: select as never,
            sort: { createdAt: SortOrder.Descending } as never,
            limit: 1,
            skip: 0,
          });

          nextSample = {
            records: list.data.map((item: BaseModel): JSONObject => {
              return BaseModel.toJSON(item, modelType);
            }),
            count: list.count,
          };
        } catch {
          nextSample = undefined;
        }
      }

      let nextLive: DeveloperDocsLiveData = {
        ...getEmptyDeveloperDocsLiveData(new Date()),
        currentUserId: getCurrentUserId(),
      };

      if (usesLiveData) {
        const lookups: Array<DeveloperDocsLookup> = getDeveloperDocsPageLookups(
          {
            modelType,
            scope: isView ? "view" : "list",
            page: toPageKind(props.page),
            json: nextRecord?.json,
          },
        )
          .map((lookup: DeveloperDocsLookup): DeveloperDocsLookup | null => {
            return getReadableDeveloperDocsLookup(lookup, {
              model: canReadModel,
              column: canReadModelColumn,
            });
          })
          .filter(
            (
              lookup: DeveloperDocsLookup | null,
            ): lookup is DeveloperDocsLookup => {
              return lookup !== null;
            },
          );

        nextLive = await runLookups(lookups, nextLive);
      }

      setRecord(nextRecord);
      setSample(nextSample);
      setLive(nextLive);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {
      // load() reports its own errors.
    });
  }, [id, props.page, props.scope, modelType]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          load().catch(() => {
            // load() reports its own errors.
          });
        }}
      />
    );
  }

  const guide: DeveloperDocsGuide = getDeveloperDocsGuide(props.page, {
    resource: props.resource,
    scope: props.scope,
    oneuptimeUrl: getSetupGuideOneUptimeUrl({
      host: HOST,
      isHttps: HTTP_PROTOCOL === Protocol.HTTPS,
    }),
    platformVersion: VERSION.toString(),
    apiKeysUrl: RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
    ).toString(),
    record,
    importTargets,
    totalCount,
    live,
    sample,
  });

  return (
    <DeveloperDocsGuideView
      guide={guide}
      icon={getPageDefinition(props.page).icon}
    />
  );
};

export default DeveloperDocsPage;
