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
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { PermissionHelper } from "Common/Types/Permission";
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
import PermissionUtil from "Common/UI/Utils/Permission";
import useTranslateValue from "Common/UI/Utils/Translation";
import User from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useParams } from "react-router-dom";

/*
 * A Developer page: Terraform, API or AI Assistants, for one resource (its
 * view menu) or for its type (its list menu). One component for every
 * resource; what it says comes from DeveloperDocsGuides, written from the
 * model's metadata and, on a view page, from the record as it is now.
 *
 * Laid out like the product's setup guides: numbered steps, then folded
 * extras under "More", then links to the full documentation.
 *
 * Secrets never reach this page: the record is fetched without the fields
 * that hold them (TerraformSchema marks them), so they cannot leak into the
 * configuration, a curl command or a prompt even by mistake.
 */

export interface ComponentProps extends PageComponentProps {
  resource: DeveloperDocsResource;
  scope: DeveloperDocsScope;
  page: DeveloperDocsPageType;
}

// Whether the viewer may read a column (ModelDetail's rule).
function canReadColumn(descriptor: TerraformAttributeDescriptor): boolean {
  if (User.isMasterAdmin()) {
    return true;
  }

  return PermissionHelper.doesPermissionsIntersect(
    PermissionUtil.getAllPermissions(),
    descriptor.readPermissions,
  );
}

/*
 * What to fetch for the record: its name always, and on the Terraform page
 * every attribute the configuration may carry that the viewer may read.
 * Secret fields are never asked for.
 */
export function getDeveloperDocsRecordSelect(data: {
  modelType: DatabaseBaseModelType;
  page: DeveloperDocsPageType;
  canRead: (descriptor: TerraformAttributeDescriptor) => boolean;
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

function toStepView(step: DeveloperDocsStep): SetupGuideStepView {
  return {
    title: step.title,
    description: step.description,
    content: (
      <div className="space-y-3">
        {step.markdown && <SetupGuideMarkdown text={step.markdown} />}
        {step.variants && step.variants.length > 0 && (
          <SetupGuideStepVariants
            variants={step.variants.map(
              (variant: SetupGuideStepVariant): SetupGuideStepVariantView => {
                return {
                  label: variant.label,
                  content: <SetupGuideMarkdown text={variant.markdown} />,
                };
              },
            )}
          />
        )}
        {step.prompts && step.prompts.length > 0 && (
          <DeveloperDocsPromptList prompts={step.prompts} />
        )}
      </div>
    ),
  };
}

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

const DeveloperDocsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { id } = useParams();
  const modelType: DatabaseBaseModelType = props.resource.modelType;
  const isView: boolean = props.scope === DeveloperDocsScope.View;
  const needsList: boolean =
    !isView && props.page === DeveloperDocsPageType.Terraform;

  const [isLoading, setIsLoading] = useState<boolean>(isView || needsList);
  const [error, setError] = useState<string>("");
  const [record, setRecord] = useState<DeveloperDocsRecord | undefined>(
    undefined,
  );
  const [importTargets, setImportTargets] = useState<
    Array<TerraformImportTarget>
  >([]);
  const [totalCount, setTotalCount] = useState<number>(0);

  const load: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      if (isView) {
        const modelId: ObjectID = new ObjectID(id || "");
        const item: BaseModel | null = await ModelAPI.getItem({
          modelType,
          id: modelId,
          select: getDeveloperDocsRecordSelect({
            modelType,
            page: props.page,
            canRead: canReadColumn,
          }) as never,
        });

        if (!item) {
          setError(DEVELOPER_DOCS_NOT_FOUND_MESSAGE);
          return;
        }

        const json: JSONObject = BaseModel.toJSON(item, modelType);

        setRecord({
          id: modelId.toString(),
          displayName: getDisplayName(modelType, json),
          json,
        });
      }

      if (needsList) {
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
  });

  return (
    <DeveloperDocsGuideView
      guide={guide}
      icon={getPageDefinition(props.page).icon}
    />
  );
};

export default DeveloperDocsPage;
