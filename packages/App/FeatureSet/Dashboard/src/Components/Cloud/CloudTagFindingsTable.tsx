import CloudTagFinding from "Common/Models/DatabaseModels/CloudTagFinding";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CloudTagMissingJSON,
  readCloudTagMissing,
} from "Common/Types/Cloud/CloudTagCoverage";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import FieldType from "Common/UI/Components/Types/FieldType";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";

/*
 * NEW RESOURCES FOUND WITHOUT A REQUIRED TAG (#11012): each resource the
 * watcher found within a day of its creation lacking one (CloudTagFinding),
 * newest first - what it lacked, who created it, when the people were told
 * and whether it carries its tags now. Read only: the watcher keeps it.
 */

export const FINDINGS_TITLE: string = translationKey("New Resources");
export const FINDINGS_DESCRIPTION: string = translationKey(
  "Resources created without a required tag, found the day they appeared: who created them, when the people were told, and whether they carry their tags now.",
);
export const FINDINGS_EMPTY: string = translationKey(
  "No new resources without required tags yet. They appear here within the hour they are created.",
);
export const FINDING_TAGGED: string = translationKey("Tagged");
export const FINDING_MISSING_TAGS: string = translationKey("Missing tags");
export const FINDING_NOT_TOLD_YET: string = translationKey("Not yet");

function readMissing(value: unknown): Array<CloudTagMissingJSON> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readCloudTagMissing)
    .filter((item: CloudTagMissingJSON | null): boolean => {
      return Boolean(item);
    }) as Array<CloudTagMissingJSON>;
}

export interface ComponentProps {
  projectId: ObjectID;
  cloudAccountId?: ObjectID | null | undefined;
}

const CloudTagFindingsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<CloudTagFinding>
      modelType={CloudTagFinding}
      id="cloud-tag-findings-table"
      userPreferencesKey="cloud-tag-findings-table"
      name="Cloud > Tags > New Resources"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      query={{
        projectId: props.projectId,
        ...(props.cloudAccountId
          ? { cloudAccountId: props.cloudAccountId }
          : {}),
      }}
      sortBy="foundAt"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: FINDINGS_TITLE,
        description: FINDINGS_DESCRIPTION,
      }}
      noItemsMessage={FINDINGS_EMPTY}
      selectMoreFields={{
        cloudResourceId: true,
        missingTags: true,
        creatorActor: true,
        resolvedAt: true,
        notifiedAt: true,
      }}
      filters={[]}
      columns={[
        {
          field: { cloudResource: { name: true } },
          title: "Resource",
          type: FieldType.Element,
          isNotCustomizable: true,
          wrapContent: true,
          getLineText: drawsItsOwnLines,
          getElement: (item: CloudTagFinding): ReactElement => {
            const missing: Array<CloudTagMissingJSON> = readMissing(
              item.missingTags,
            );

            return (
              <div className="min-w-0">
                {item.cloudResourceId ? (
                  <AppLink
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                      {
                        modelId: new ObjectID(item.cloudResourceId.toString()),
                      },
                    )}
                    className="break-words text-sm font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    <bdi>{item.cloudResource?.name || ""}</bdi>
                  </AppLink>
                ) : (
                  <TableEmptyValue />
                )}
                <div className="mt-0.5 font-mono text-xs text-gray-500">
                  <bdi>
                    {missing
                      .map((entry: CloudTagMissingJSON): string => {
                        return entry.key;
                      })
                      .join(", ")}
                  </bdi>
                </div>
              </div>
            );
          },
        },
        {
          field: { cloudAccount: { name: true } },
          title: "Account",
          type: FieldType.Text,
          hideOnMobile: true,
        },
        {
          field: { creatorUser: { name: true } },
          title: "Created By",
          type: FieldType.Element,
          getElement: (item: CloudTagFinding): ReactElement => {
            const who: string =
              item.creatorUser?.name?.toString() || item.creatorActor || "";

            return who ? (
              <bdi className="break-all text-sm text-gray-900">{who}</bdi>
            ) : (
              <TableEmptyValue />
            );
          },
        },
        {
          field: { foundAt: true },
          title: "Found",
          type: FieldType.DateTime,
          hideOnMobile: true,
        },
        {
          field: { notifiedAt: true },
          title: "Told",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: CloudTagFinding): ReactElement => {
            return item.notifiedAt ? (
              <span className="text-sm text-gray-700">
                {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  item.notifiedAt,
                )}
              </span>
            ) : (
              <span className="text-sm text-gray-500">
                {translator.translateText(FINDING_NOT_TOLD_YET) ||
                  FINDING_NOT_TOLD_YET}
              </span>
            );
          },
        },
        {
          field: { resolvedAt: true },
          title: "Status",
          type: FieldType.Element,
          getElement: (item: CloudTagFinding): ReactElement => {
            return (
              <span
                data-testid="cloud-tag-finding-status"
                data-tagged={item.resolvedAt ? "true" : "false"}
              >
                <Pill
                  text={item.resolvedAt ? FINDING_TAGGED : FINDING_MISSING_TAGS}
                  tone={item.resolvedAt ? PillTone.Success : PillTone.Warning}
                />
              </span>
            );
          },
        },
      ]}
    />
  );
};

export default CloudTagFindingsTable;
