import {
  ANY_NUMBER_FROM_ONE,
  HIGHER_THAN_HIGHEST_TEMPLATE,
  NEXT_NUMBER_CARD_TITLE,
  NEXT_NUMBER_EDIT_BUTTON_TITLE,
  NEXT_NUMBER_EDIT_MODAL_TITLE,
  NextNumberPage,
  NextNumberRow,
  NumberingByKind,
  getNextNumberChanges,
  getNextNumberColumns,
  getNextNumberFormValues,
  getNumberingByKind,
  getStartsAtColumn,
} from "./NextNumberSettings";
import { NextNumberPreview, NextNumberValue } from "./NextNumberValue";
import NumberingAPI from "./NumberingAPI";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Pages/Settings/ProjectColumnEditGate";
import Project from "Common/Models/DatabaseModels/Project";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Detail from "Common/UI/Components/Detail/Detail";
import DetailField from "Common/UI/Components/Detail/Field";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import FormField from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CARD_MODEL_DETAIL_BODY_CLASS_NAME } from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import NextNumberUtil, {
  NextNumberProblem,
  RecordNumbering,
} from "Common/Utils/Project/NextNumber";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  page: NextNumberPage;
}

/*
 * The Next Number card on each product's Numbering page: one row per kind
 * of number, showing the number the next record gets (with its prefix) and
 * the highest used so far, and an Update button that opens one dialog for
 * them all. A number may be anything above the highest used so far, so no
 * number is ever used twice; the dialog says what that is for each, and
 * the server refuses the same (Common/Utils/Project/NextNumber).
 */
const NextNumberCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [numbering, setNumbering] = useState<NumberingByKind | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [showModal, setShowModal] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  // What the dialog holds: the next numbers, or what was typed before a failed save.
  const [formValues, setFormValues] = useState<FormValues<JSONObject>>({});

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const load: () => Promise<void> = async (): Promise<void> => {
    if (!projectId) {
      return;
    }

    setIsLoading(true);
    setLoadError("");

    try {
      setNumbering(
        getNumberingByKind(await NumberingAPI.getNumbering(projectId)),
      );
    } catch (error) {
      setLoadError(API.getFriendlyMessage(error));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  /*
   * The starts take Project Owner, Project Admin or Edit Project, as the
   * prefixes do. Read on every render: the permission snapshot arrives on an
   * API response header, and the numbering's load re-renders the card.
   */
  const editGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: getNextNumberColumns(props.page),
    buttonTitle: NEXT_NUMBER_EDIT_BUTTON_TITLE,
  });

  const openDialog: () => void = (): void => {
    setFormValues(
      getNextNumberFormValues({
        page: props.page,
        numbering: numbering || {},
      }),
    );
    setSaveError("");
    setShowModal(true);
  };

  let buttons: Array<CardButtonSchema> = [];

  if (numbering) {
    buttons = editGate.isEditable
      ? [
          {
            title: NEXT_NUMBER_EDIT_BUTTON_TITLE,
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Edit,
            onClick: openDialog,
          },
        ]
      : editGate.lockedButtons;
  }

  const detailFields: Array<DetailField<NumberingByKind>> = props.page.rows.map(
    (row: NextNumberRow): DetailField<NumberingByKind> => {
      return {
        // The row reads the kind's entry: Detail draws a field by its key.
        key: row.kind,
        title: row.label,
        fieldType: FieldType.Element,
        getElement: (item: NumberingByKind): ReactElement => {
          const entry: RecordNumbering | undefined = item[row.kind];

          return entry ? (
            <NextNumberValue
              numbering={entry}
              dataTestId={`next-number-row-${row.kind}`}
            />
          ) : (
            <></>
          );
        },
      };
    },
  );

  const formFields: Array<FormField<JSONObject>> = props.page.rows.map(
    (row: NextNumberRow): FormField<JSONObject> => {
      const column: string = getStartsAtColumn(row.kind);
      const entry: RecordNumbering | undefined = numbering?.[row.kind];
      const highestNumber: number = entry?.highestNumber || 0;

      return {
        field: {
          [column]: true,
        } as SelectFormFields<JSONObject>,
        title: row.formTitle,
        description:
          highestNumber > 0
            ? translator.translateTemplate(HIGHER_THAN_HIGHEST_TEMPLATE, {
                highestNumber: String(highestNumber),
              })
            : translator.translateTemplate(ANY_NUMBER_FROM_ONE),
        required: true,
        fieldType: FormFieldSchemaType.Number,
        dataTestId: `next-number-field-${row.kind}`,
        customValidation: (values: FormValues<JSONObject>): string | null => {
          const problem: NextNumberProblem | null = NextNumberUtil.getProblem(
            (values as JSONObject)[column],
            highestNumber,
          );

          return problem
            ? translateValidationMessage(
                NextNumberUtil.getProblemMessage(problem),
                NextNumberUtil.getProblemValues(highestNumber),
              )
            : null;
        },
        getFooterElement: (values: FormValues<JSONObject>): ReactElement => {
          return (
            <NextNumberPreview
              value={(values as JSONObject)[column]}
              prefix={entry?.prefix || null}
              highestNumber={highestNumber}
              dataTestId={`next-number-preview-${row.kind}`}
            />
          );
        },
      };
    },
  );

  const save: (values: FormValues<JSONObject>) => Promise<void> = async (
    values: FormValues<JSONObject>,
  ): Promise<void> => {
    const changes: JSONObject = getNextNumberChanges({
      page: props.page,
      values: values as JSONObject,
      numbering: numbering || {},
    });

    if (Object.keys(changes).length === 0 || !projectId) {
      setShowModal(false);
      return;
    }

    setFormValues(values);
    setSaveError("");
    setIsSaving(true);

    try {
      await ModelAPI.updateById<Project>({
        modelType: Project,
        id: projectId,
        data: changes,
      });

      setShowModal(false);
      await load();
    } catch (error) {
      setSaveError(API.getFriendlyMessage(error));

      /*
       * Most often a record took the number meanwhile: read the numbers
       * again, so each field says what it must be higher than now.
       */
      await load();
    }

    setIsSaving(false);
  };

  return (
    <>
      <Card
        title={NEXT_NUMBER_CARD_TITLE}
        description={props.page.cardDescription}
        buttons={buttons}
      >
        <div
          className={CARD_MODEL_DETAIL_BODY_CLASS_NAME}
          data-testid="next-number-card-body"
        >
          {isLoading && !numbering ? <ComponentLoader /> : <></>}
          {!isLoading && loadError ? (
            <ErrorMessage
              message={loadError}
              onRefreshClick={() => {
                void load();
              }}
            />
          ) : (
            <></>
          )}
          {numbering && !loadError ? (
            <Detail<NumberingByKind>
              id={`next-number-detail-${props.page.name}`}
              item={numbering}
              fields={detailFields}
              showRecordLine={false}
            />
          ) : (
            <></>
          )}
        </div>
      </Card>

      {showModal ? (
        <BasicFormModal<JSONObject>
          title={NEXT_NUMBER_EDIT_MODAL_TITLE}
          description={props.page.editDescription}
          name={props.page.name}
          submitButtonText="Save Changes"
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setShowModal(false);
          }}
          onSubmit={(values: JSONObject) => {
            void save(values);
          }}
          formProps={{
            name: props.page.name,
            initialValues: formValues,
            fields: formFields,
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default NextNumberCard;
