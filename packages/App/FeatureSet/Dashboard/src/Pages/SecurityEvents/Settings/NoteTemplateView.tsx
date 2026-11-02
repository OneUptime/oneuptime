import PageComponentProps from "../../PageComponentProps";
import { SECURITY_CASE_NOTE_TEMPLATES_COPY } from "../../../Components/SecurityCase/NoteTemplates/SecurityCaseNoteTemplatesCopy";
import NoteTemplateFormCopy from "../../../Components/NoteTemplate/NoteTemplateFormCopy";
import { getSecurityEventsBreadcrumbs } from "../../../Utils/Breadcrumbs";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SecurityCaseNoteTemplate from "Common/Models/DatabaseModels/SecurityCaseNoteTemplate";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import { nameRecordInTrail } from "Common/UI/Components/Page/RecordNameInTrail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/*
 * One case note template's page (Security Events > Settings > Note
 * Templates > a template): its name and what it is for, then its note as it
 * reads - each card edited on its own - and Delete. As an incident's and an
 * alert's note template pages are.
 *
 * Its edit dialogs and Delete name it as the list does - "Edit Note
 * Template", "Delete Note Template" - not by the model's longer name, and
 * its crumb and the browser's tab name the template once it is read
 * ("Note Templates > Containment checklist"), as a hunt's, a watchlist's and
 * a playbook's pages in Security Events do.
 */
const SecurityCaseNoteTemplateViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const copy: typeof SECURITY_CASE_NOTE_TEMPLATES_COPY =
    SECURITY_CASE_NOTE_TEMPLATES_COPY;

  // The template's name as read, and read again after its details are saved.
  const [templateName, setTemplateName] = useState<string>("");

  const breadcrumbs: Array<Link> | null = useMemo(() => {
    return (
      nameRecordInTrail({
        links: getSecurityEventsBreadcrumbs(path),
        recordId: modelId.toString(),
        recordName: templateName,
      }) || null
    );
  }, [path, modelId.toString(), templateName]);

  usePageBreadcrumbLinks(templateName ? breadcrumbs : null);

  return (
    <Fragment>
      <CardModelDetail
        name="Security Case Note Template Details"
        singularName={copy.singularName}
        cardProps={{
          title: copy.detailsTitle,
          description: copy.detailsDescription,
        }}
        isEditable={true}
        editButtonText={copy.editDetailsButtonText}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: copy.nameTitle,
            description: copy.nameDescription,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: copy.namePlaceholder,
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              templateDescription: true,
            },
            title: copy.descriptionTitle,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: copy.descriptionPlaceholder,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: SecurityCaseNoteTemplate,
          id: "model-detail-security-case-note-template",
          fields: [
            {
              field: {
                templateName: true,
              },
              title: copy.nameTitle,
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateDescription: true,
              },
              title: copy.descriptionTitle,
              fieldType: FieldType.LongText,
            },
          ],
          modelId: modelId,
          onItemLoaded: (item: SecurityCaseNoteTemplate) => {
            setTemplateName(item.templateName || "");
          },
        }}
      />

      <CardModelDetail
        name="Security Case Note Template"
        singularName={copy.singularName}
        cardProps={{
          title: copy.noteCardTitle,
          description: NoteTemplateFormCopy.noteFieldDescription,
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        editButtonText={copy.editNoteButtonText}
        formFields={[
          {
            field: {
              note: true,
            },
            title: NoteTemplateFormCopy.noteFieldTitle,
            description: NoteTemplateFormCopy.noteFieldDescription,
            fieldType: FormFieldSchemaType.Markdown,
            required: true,
            validation: {
              minLength: 2,
            },
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: SecurityCaseNoteTemplate,
          id: "model-detail-security-case-note-template-note",
          fields: [
            {
              field: {
                note: true,
              },
              title: NoteTemplateFormCopy.noteFieldTitle,
              fieldType: FieldType.Markdown,
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelDelete
        modelType={SecurityCaseNoteTemplate}
        modelId={modelId}
        // "Delete Note Template", as the list and the trail name one.
        singularName={copy.singularName}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SECURITY_EVENTS_SETTINGS_NOTE_TEMPLATES
              ] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default SecurityCaseNoteTemplateViewPage;
