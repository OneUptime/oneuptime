import SecurityEventSeverityPill from "../SecurityEvents/SecurityEventSeverityPill";
import MitreAttackChips from "./MitreAttackChips";
import { getSecurityDetectionSourceIcon } from "./SecurityCasePills";
import SecurityEntityChips, {
  readSecurityEntities,
} from "./SecurityEntityChips";
import SecurityDetection from "Common/Models/DatabaseModels/SecurityDetection";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  securityCaseId: ObjectID;
  refreshToggle?: string | undefined;
}

const DetailRow: FunctionComponent<{
  label: string;
  children: ReactElement | string;
}> = (props: {
  label: string;
  children: ReactElement | string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
      <dt className="text-sm font-medium text-gray-500">
        {translator.translateText(props.label)}
      </dt>
      <dd className="col-span-2 min-w-0 text-sm text-gray-900">
        {props.children}
      </dd>
    </div>
  );
};

/*
 * One detection, opened from its row: what fired, how often, on what, and
 * the event that last set it off.
 */
const SecurityDetectionDetailModal: FunctionComponent<{
  detection: SecurityDetection;
  onClose: () => void;
}> = (props: {
  detection: SecurityDetection;
  onClose: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const detection: SecurityDetection = props.detection;

  return (
    <Modal
      title={detection.title || "Detection"}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <div className="space-y-4">
        {detection.description ? (
          <div className="prose prose-sm max-w-none text-gray-700">
            <LazyMarkdownViewer text={detection.description} />
          </div>
        ) : (
          <></>
        )}

        <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          <DetailRow label="Source">
            <span className="inline-flex items-center gap-1.5">
              <Icon
                icon={getSecurityDetectionSourceIcon(detection.source)}
                className="h-4 w-4 text-gray-400"
              />
              {translator.translateText(detection.source || "") || "-"}
              {detection.ruleName ? (
                <span className="text-gray-500">· {detection.ruleName}</span>
              ) : (
                <></>
              )}
            </span>
          </DetailRow>
          <DetailRow label="Severity">
            <SecurityEventSeverityPill severityName={detection.severity} />
          </DetailRow>
          <DetailRow label="Fired">
            {translator.translatePlural(
              { one: "{{count}} time", other: "{{count}} times" },
              detection.fireCount || 1,
            )}
          </DetailRow>
          <DetailRow label="Matching Events">
            {String(detection.eventCount || 0)}
          </DetailRow>
          <DetailRow label="First Seen">
            {detection.firstSeenAt
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  detection.firstSeenAt,
                )
              : "-"}
          </DetailRow>
          <DetailRow label="Last Seen">
            {detection.lastSeenAt
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  detection.lastSeenAt,
                )
              : "-"}
          </DetailRow>
          <DetailRow label="Entities">
            <SecurityEntityChips
              entities={readSecurityEntities(detection.entities)}
            />
          </DetailRow>
          <DetailRow label="MITRE ATT&CK">
            <MitreAttackChips
              tactics={detection.mitreTactics || []}
              techniques={detection.mitreTechniques || []}
            />
          </DetailRow>
        </dl>

        {detection.sampleMessage ? (
          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-gray-900">
              {translator.translateText("Latest matching event")}
            </h4>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-700">
              {detection.sampleMessage}
            </pre>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

/*
 * The detections grouped into a case: each rule, threat-intelligence match
 * or imported alert that named what the case is about. A detection that
 * fires again counts up rather than adding a row.
 */
const SecurityCaseDetections: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [selected, setSelected] = useState<SecurityDetection | null>(null);

  return (
    <>
      <ModelTable<SecurityDetection>
        modelType={SecurityDetection}
        id="security-case-detections-table"
        name="Security Events > Case > Detections"
        userPreferencesKey="security-case-detections-table"
        query={{ securityCaseId: props.securityCaseId }}
        refreshToggle={props.refreshToggle}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "Detections",
          description:
            "What fired to open this case or join it: detection rules, threat intelligence matches, alerts from connected products and entity risk. A detection that fires again counts up on its row.",
        }}
        noItemsMessage="No detections on this case. It was opened by hand."
        showRefreshButton={true}
        selectMoreFields={{
          description: true,
          sampleMessage: true,
          entities: true,
          mitreTactics: true,
          mitreTechniques: true,
          firstSeenAt: true,
          eventCount: true,
          ruleName: true,
        }}
        actionButtons={[
          {
            title: "Details",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Info,
            onClick: (
              item: SecurityDetection,
              onCompleteAction: VoidFunction,
            ) => {
              setSelected(item);
              onCompleteAction();
            },
          },
        ]}
        filters={[]}
        columns={[
          {
            /*
             * What fired and what it is about, in one column that wraps, so
             * the table fits the case page's main column: the title, its
             * source and rule, then the entities it names.
             */
            field: { title: true, entities: true },
            title: "Detection",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-lg",
            getElement: (item: SecurityDetection): ReactElement => {
              const entities: Array<SecurityEntity> = readSecurityEntities(
                item.entities,
              );

              return (
                <div className="min-w-[12rem]">
                  <div className="line-clamp-2 break-words font-medium text-gray-900">
                    {item.title || ""}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
                    <Icon
                      icon={getSecurityDetectionSourceIcon(item.source)}
                      className="h-3 w-3 text-gray-400"
                    />
                    <span>
                      {item.source ? translator.translateText(item.source) : ""}
                    </span>
                    {item.ruleName && item.ruleName !== item.title ? (
                      <span>· {item.ruleName}</span>
                    ) : (
                      <></>
                    )}
                  </div>
                  {entities.length > 0 ? (
                    <div className="mt-1.5">
                      <SecurityEntityChips entities={entities} limit={2} />
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { severity: true },
            title: "Severity",
            type: FieldType.Element,
            getElement: (item: SecurityDetection): ReactElement => {
              return <SecurityEventSeverityPill severityName={item.severity} />;
            },
          },
          {
            field: { fireCount: true },
            title: "Fired",
            type: FieldType.Element,
            getElement: (item: SecurityDetection): ReactElement => {
              return (
                <span className="text-sm tabular-nums text-gray-700">
                  {translator.translatePlural(
                    { one: "{{count}} time", other: "{{count}} times" },
                    item.fireCount || 1,
                  )}
                </span>
              );
            },
          },
          {
            field: { lastSeenAt: true },
            title: "Last Seen",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityDetection): ReactElement => {
              if (!item.lastSeenAt) {
                return <span className="text-sm text-gray-400">-</span>;
              }

              return (
                <span
                  className="text-sm text-gray-700"
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    item.lastSeenAt,
                  )}
                >
                  {OneUptimeDate.fromNow(item.lastSeenAt)}
                </span>
              );
            },
          },
        ]}
      />

      {selected ? (
        <SecurityDetectionDetailModal
          detection={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SecurityCaseDetections;
