import SecurityCaseEvidenceCell from "./SecurityCaseEvidenceCell";
import { readEventEvidence, toSecurityEvent } from "./EventEvidence";
import {
  KEPT_EVENT_NOTE,
  VIEW_EVENT,
} from "../../SecurityEvents/Hunts/HuntsCopy";
import SecurityEventDetailPanel from "../../SecurityEvents/SecurityEventDetailPanel";
import RelativeTime from "../../EpisodeView/RelativeTime";
import { SecurityCaseEventSnapshot } from "Common/Types/SecurityCase/SecurityCaseEventEvidence";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  SECURITY_CASE_EVIDENCE_COPY,
  SECURITY_CASE_EVIDENCE_FILE_TYPES,
  SECURITY_CASE_EVIDENCE_TEST_IDS,
  getEvidenceDownloadUrl,
  getEvidenceLink,
  isFileEvidence,
} from "./SecurityCaseEvidenceCopy";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseEvidenceKind from "Common/Types/SecurityCase/SecurityCaseEvidenceKind";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import openAuthenticatedUrl from "Common/UI/Utils/OpenAuthenticatedUrl";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  caseId: ObjectID;
}

/*
 * The More fields fold of both Add dialogs: the description most evidence
 * does without. One section, built once, so the form scan reads it as one.
 */
const MORE_FIELDS: FormFieldCollapsibleSection<SecurityCaseEvidence> =
  getAdvancedFormSection<SecurityCaseEvidence>();

/*
 * A case's Evidence: the files and links kept on it, the latest first, each
 * with who added it and when - a file with its size, type and the SHA-256
 * of what was uploaded, to check a download against.
 *
 * Add File, the card's button, uploads one (up to 10 MB; anything else goes
 * in a .zip); Add Link, in the card's ⋯ - a table card keeps all but its
 * main button there - points at evidence kept elsewhere. Each asks for a
 * name only when the file's own name or the address will not do, and a
 * description under More fields. A file downloads - never opens in the
 * page - and a link opens in a new tab. Its name and description can be
 * corrected; what it holds cannot.
 * Removing evidence takes the Security Admin role, and the case's timeline
 * says what was removed and by whom (SecurityCaseEvidenceService).
 *
 * Security events are kept here from Security Events (Add to Case on Events
 * or a hunt's page, Open Case on an event): View Event opens one as the
 * Events explorer's panel does, from what the case kept - not read again
 * from the events table, where it may be past its retention.
 */
const SecurityCaseEvidenceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
  const [adding, setAdding] = useState<SecurityCaseEvidenceKind | null>(null);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  // The kept event open in the panel, and when it was kept.
  const [viewing, setViewing] = useState<{
    snapshot: SecurityCaseEventSnapshot;
    keptAt: Date | undefined;
  } | null>(null);

  const createGate: PermissionGateResult = PermissionGate.check(
    new SecurityCaseEvidence(),
    ModelAction.Create,
  );

  const downloadUrlOf: (item: SecurityCaseEvidence) => string = (
    item: SecurityCaseEvidence,
  ): string => {
    return getEvidenceDownloadUrl({
      apiUrl: APP_API_URL,
      projectId: projectId.toString(),
      evidenceId: item._id!.toString(),
    });
  };

  // What a piece of evidence is called, and its description.
  const descriptionField: ModelField<SecurityCaseEvidence> = {
    field: { description: true },
    title: SECURITY_CASE_EVIDENCE_COPY.descriptionField,
    fieldType: FormFieldSchemaType.LongText,
    required: false,
    placeholder: SECURITY_CASE_EVIDENCE_COPY.descriptionPlaceholder,
    hideColumnDescription: true,
    collapsibleSection: MORE_FIELDS,
  };

  const addButtons: Array<{
    kind: SecurityCaseEvidenceKind;
    title: string;
    icon: IconProp;
    testId: string;
  }> = [
    {
      kind: SecurityCaseEvidenceKind.File,
      title: SECURITY_CASE_EVIDENCE_COPY.addFile,
      icon: IconProp.Upload,
      testId: SECURITY_CASE_EVIDENCE_TEST_IDS.addFile,
    },
    {
      kind: SecurityCaseEvidenceKind.Link,
      title: SECURITY_CASE_EVIDENCE_COPY.addLink,
      icon: IconProp.Link,
      testId: SECURITY_CASE_EVIDENCE_TEST_IDS.addLink,
    },
  ];

  return (
    <>
      <ModelTable<SecurityCaseEvidence>
        modelType={SecurityCaseEvidence}
        id={SECURITY_CASE_EVIDENCE_TEST_IDS.table}
        userPreferencesKey="security-case-evidence-table"
        name="Security Events > Case > Evidence"
        singularName={SECURITY_CASE_EVIDENCE_COPY.singularName}
        pluralName={SECURITY_CASE_EVIDENCE_COPY.pluralName}
        query={{
          projectId: projectId,
          securityCaseId: props.caseId,
        }}
        refreshToggle={refreshCount > 0 ? String(refreshCount) : ""}
        isCreateable={false}
        isEditable={true}
        isDeleteable={true}
        deleteConfirmationWarning={SECURITY_CASE_EVIDENCE_COPY.deleteWarning}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: SECURITY_CASE_EVIDENCE_COPY.title,
          description: SECURITY_CASE_EVIDENCE_COPY.description,
          buttons: addButtons.map(
            (button: {
              kind: SecurityCaseEvidenceKind;
              title: string;
              icon: IconProp;
              testId: string;
            }) => {
              return {
                title: button.title,
                icon: button.icon,
                buttonStyle: ButtonStyleType.NORMAL,
                disabled: !createGate.isAllowed,
                tooltip: createGate.isAllowed
                  ? undefined
                  : createGate.disabledReason,
                onClick: () => {
                  setAdding(button.kind);
                },
              };
            },
          ),
        }}
        emptyState={{
          title: SECURITY_CASE_EVIDENCE_COPY.emptyTitle,
          description: SECURITY_CASE_EVIDENCE_COPY.emptyDescription,
          icon: IconProp.PaperClip,
          actions: createGate.isAllowed
            ? addButtons.map(
                (button: {
                  kind: SecurityCaseEvidenceKind;
                  title: string;
                  icon: IconProp;
                  testId: string;
                }) => {
                  return {
                    title: button.title,
                    icon: button.icon,
                    dataTestId: `${button.testId}-empty`,
                    onClick: () => {
                      setAdding(button.kind);
                    },
                  };
                },
              )
            : [],
        }}
        selectMoreFields={{
          kind: true,
          url: true,
          fileName: true,
          fileType: true,
          fileSizeInBytes: true,
          sha256: true,
          eventUid: true,
          eventTime: true,
          eventSnapshot: true,
          description: true,
          createdAt: true,
          // Who added it: a line under it (SecurityCaseEvidenceCell).
          createdByUser: {
            name: true,
            email: true,
          },
        }}
        actionButtons={[
          {
            title: SECURITY_CASE_EVIDENCE_COPY.download,
            icon: IconProp.Download,
            buttonStyleType: ButtonStyleType.NORMAL,
            isVisible: (item: SecurityCaseEvidence): boolean => {
              return isFileEvidence(item);
            },
            onClick: (
              item: SecurityCaseEvidence,
              onCompleteAction: () => void,
            ): void => {
              // The download reads the session cookie: freshened first.
              void openAuthenticatedUrl(downloadUrlOf(item));
              onCompleteAction();
            },
          },
          {
            title: SECURITY_CASE_EVIDENCE_COPY.openLink,
            icon: IconProp.ExternalLink,
            buttonStyleType: ButtonStyleType.NORMAL,
            isVisible: (item: SecurityCaseEvidence): boolean => {
              return Boolean(getEvidenceLink(item));
            },
            onClick: (
              item: SecurityCaseEvidence,
              onCompleteAction: () => void,
            ): void => {
              const link: string | null = getEvidenceLink(item);

              if (link) {
                Navigation.navigate(URL.fromString(link), {
                  openInNewTab: true,
                });
              }

              onCompleteAction();
            },
          },
          // An event kept on the case: its snapshot, in the event's panel.
          {
            title: VIEW_EVENT,
            icon: IconProp.Bookmark,
            buttonStyleType: ButtonStyleType.NORMAL,
            isVisible: (item: SecurityCaseEvidence): boolean => {
              return Boolean(readEventEvidence(item));
            },
            onClick: (
              item: SecurityCaseEvidence,
              onCompleteAction: () => void,
            ): void => {
              const snapshot: SecurityCaseEventSnapshot | null =
                readEventEvidence(item);

              if (snapshot) {
                setViewing({
                  snapshot,
                  keptAt: item.createdAt ? new Date(item.createdAt) : undefined,
                });
              }

              onCompleteAction();
            },
          },
        ]}
        filters={[]}
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        formFields={[
          {
            field: { name: true },
            title: SECURITY_CASE_EVIDENCE_COPY.nameField,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            hideColumnDescription: true,
          },
          {
            ...descriptionField,
            collapsibleSection: undefined,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: SECURITY_CASE_EVIDENCE_COPY.evidenceColumn,
            type: FieldType.Element,
            isNotCustomizable: true,
            wrapContent: true,
            // The table's one column: a long address shows what room allows.
            wrapMaxWidthClassName: "max-w-3xl",
            /*
             * Beside a side menu at 768px the card is 414px wide: with the
             * row's box and its Download and ⋯, 9rem is what is left, and
             * the table's 10rem floor scrolled the rows sideways.
             */
            contentClassName: "min-w-[9rem]",
            // A phone's card is the evidence: "Evidence" over each said nothing.
            hideTitleOnMobile: true,
            getElement: (item: SecurityCaseEvidence): ReactElement => {
              return <SecurityCaseEvidenceCell item={item} />;
            },
          },
        ]}
      />

      {viewing ? (
        <SecurityEventDetailPanel
          securityEvent={toSecurityEvent(viewing.snapshot)}
          showCaseActions={false}
          note={
            viewing.keptAt ? (
              <p className="text-xs text-gray-500">
                <TranslatedSentence
                  template={KEPT_EVENT_NOTE}
                  slots={{
                    time: (
                      <RelativeTime
                        date={viewing.keptAt}
                        className="whitespace-nowrap"
                      />
                    ),
                  }}
                />
              </p>
            ) : undefined
          }
          onClose={() => {
            setViewing(null);
          }}
        />
      ) : (
        <></>
      )}

      {adding ? (
        <ModelFormModal<SecurityCaseEvidence>
          modelType={SecurityCaseEvidence}
          name={
            adding === SecurityCaseEvidenceKind.File
              ? "security-case-evidence-add-file"
              : "security-case-evidence-add-link"
          }
          title={
            adding === SecurityCaseEvidenceKind.File
              ? SECURITY_CASE_EVIDENCE_COPY.addFileTitle
              : SECURITY_CASE_EVIDENCE_COPY.addLinkTitle
          }
          description={
            adding === SecurityCaseEvidenceKind.File
              ? SECURITY_CASE_EVIDENCE_COPY.addFileDescription
              : SECURITY_CASE_EVIDENCE_COPY.addLinkDescription
          }
          submitButtonText={
            adding === SecurityCaseEvidenceKind.File
              ? SECURITY_CASE_EVIDENCE_COPY.addFile
              : SECURITY_CASE_EVIDENCE_COPY.addLink
          }
          onClose={() => {
            setAdding(null);
          }}
          onBeforeCreate={async (
            item: SecurityCaseEvidence,
          ): Promise<SecurityCaseEvidence> => {
            item.projectId = projectId;
            item.securityCaseId = props.caseId;
            item.kind = adding;

            return item;
          }}
          onSuccess={() => {
            setAdding(null);
            setRefreshCount((count: number): number => {
              return count + 1;
            });
          }}
          formProps={{
            name:
              adding === SecurityCaseEvidenceKind.File
                ? "security-case-evidence-file-form"
                : "security-case-evidence-link-form",
            modelType: SecurityCaseEvidence,
            id: "security-case-evidence-form",
            formType: FormType.Create,
            fields:
              adding === SecurityCaseEvidenceKind.File
                ? [
                    {
                      field: { file: true },
                      title: SECURITY_CASE_EVIDENCE_COPY.fileField,
                      description:
                        SECURITY_CASE_EVIDENCE_COPY.fileFieldDescription,
                      fieldType: FormFieldSchemaType.File,
                      fileTypes: SECURITY_CASE_EVIDENCE_FILE_TYPES,
                      // One file: "Upload a file", not the picker's "Upload files".
                      placeholder: SECURITY_CASE_EVIDENCE_COPY.filePlaceholder,
                      required: true,
                      hideColumnDescription: true,
                    },
                    {
                      field: { name: true },
                      title: SECURITY_CASE_EVIDENCE_COPY.nameField,
                      fieldType: FormFieldSchemaType.Text,
                      required: false,
                      placeholder:
                        SECURITY_CASE_EVIDENCE_COPY.fileNamePlaceholder,
                      hideColumnDescription: true,
                    },
                    descriptionField,
                  ]
                : [
                    {
                      field: { url: true },
                      title: SECURITY_CASE_EVIDENCE_COPY.urlField,
                      description:
                        SECURITY_CASE_EVIDENCE_COPY.urlFieldDescription,
                      fieldType: FormFieldSchemaType.URL,
                      required: true,
                      placeholder: "https://",
                      hideColumnDescription: true,
                    },
                    {
                      field: { name: true },
                      title: SECURITY_CASE_EVIDENCE_COPY.nameField,
                      fieldType: FormFieldSchemaType.Text,
                      required: false,
                      placeholder:
                        SECURITY_CASE_EVIDENCE_COPY.linkNamePlaceholder,
                      hideColumnDescription: true,
                    },
                    descriptionField,
                  ],
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SecurityCaseEvidenceTable;
