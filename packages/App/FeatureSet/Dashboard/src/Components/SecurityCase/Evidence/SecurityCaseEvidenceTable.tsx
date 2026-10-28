import UserElement from "../../User/User";
import {
  SECURITY_CASE_EVIDENCE_COPY,
  SECURITY_CASE_EVIDENCE_FILE_TYPES,
  SECURITY_CASE_EVIDENCE_TEST_IDS,
  formatEvidenceSize,
  getEvidenceDownloadUrl,
  getEvidenceLink,
  isFileEvidence,
  shortenSha256,
} from "./SecurityCaseEvidenceCopy";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseEvidenceKind from "Common/Types/SecurityCase/SecurityCaseEvidenceKind";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
 * Add File uploads one (up to 10 MB; anything else goes in a .zip), Add Link
 * points at evidence kept elsewhere; each asks for a name only when the
 * file's own name or the address will not do, and a description under More
 * fields. A file downloads - never opens in the page - and a link opens in a
 * new tab. Its name and description can be corrected; what it holds cannot.
 * Removing evidence takes the Security Admin role, and the case's timeline
 * says what was removed and by whom (SecurityCaseEvidenceService).
 */
const SecurityCaseEvidenceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
  const [adding, setAdding] = useState<SecurityCaseEvidenceKind | null>(null);
  const [refreshCount, setRefreshCount] = useState<number>(0);

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
                dataTestId: button.testId,
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
          description: true,
          createdAt: true,
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
            wrapMaxWidthClassName: "max-w-xl",
            getElement: (item: SecurityCaseEvidence): ReactElement => {
              const isFile: boolean = isFileEvidence(item);
              const link: string | null = getEvidenceLink(item);
              const meta: string = isFile
                ? [item.fileName, formatEvidenceSize(item.fileSizeInBytes)]
                    .filter((part: string | undefined): boolean => {
                      return Boolean(part);
                    })
                    .join(" · ")
                : link || "";

              return (
                <div className="grid min-w-[14rem] grid-cols-1">
                  <span className="flex min-w-0 items-start gap-2">
                    <Icon
                      icon={isFile ? IconProp.PaperClip : IconProp.Link}
                      className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                    />
                    <span
                      className="min-w-0 break-words font-medium text-gray-900"
                      data-testid={SECURITY_CASE_EVIDENCE_TEST_IDS.name}
                    >
                      <IsolatedText text={item.name || ""} />
                    </span>
                  </span>
                  {meta ? (
                    <span
                      className="mt-0.5 truncate ps-6 text-xs text-gray-500"
                      title={meta}
                      data-testid={SECURITY_CASE_EVIDENCE_TEST_IDS.meta}
                    >
                      <IsolatedText text={meta} />
                    </span>
                  ) : (
                    <></>
                  )}
                  {item.description ? (
                    <span className="mt-1 line-clamp-2 break-words ps-6 text-sm text-gray-600">
                      {item.description}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              createdByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: SECURITY_CASE_EVIDENCE_COPY.addedByColumn,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityCaseEvidence): ReactElement => {
              if (!item.createdByUser) {
                return <span className="text-sm text-gray-400">-</span>;
              }

              return <UserElement user={item.createdByUser} hideEmail={true} />;
            },
          },
          {
            field: { createdAt: true },
            title: SECURITY_CASE_EVIDENCE_COPY.addedColumn,
            type: FieldType.Element,
            getElement: (item: SecurityCaseEvidence): ReactElement => {
              if (!item.createdAt) {
                return <span className="text-sm text-gray-400">-</span>;
              }

              return (
                <span
                  className="whitespace-nowrap text-sm text-gray-700"
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    item.createdAt,
                  )}
                >
                  {OneUptimeDate.fromNow(item.createdAt)}
                </span>
              );
            },
          },
          {
            field: { sha256: true },
            title: SECURITY_CASE_EVIDENCE_COPY.sha256Column,
            headerTooltip: SECURITY_CASE_EVIDENCE_COPY.sha256Tooltip,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityCaseEvidence): ReactElement => {
              if (!item.sha256) {
                return <span className="text-sm text-gray-400">-</span>;
              }

              return (
                <span
                  className="inline-flex items-center gap-1"
                  data-testid={SECURITY_CASE_EVIDENCE_TEST_IDS.sha256}
                >
                  <code
                    className="font-mono text-xs text-gray-700"
                    title={item.sha256}
                  >
                    {shortenSha256(item.sha256)}
                  </code>
                  <CopyTextButton
                    textToBeCopied={item.sha256}
                    iconOnly={true}
                    size="xs"
                    variant="ghost"
                    title={
                      translator.translateText(
                        SECURITY_CASE_EVIDENCE_COPY.copySha256,
                      ) || SECURITY_CASE_EVIDENCE_COPY.copySha256
                    }
                  />
                </span>
              );
            },
          },
        ]}
      />

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
