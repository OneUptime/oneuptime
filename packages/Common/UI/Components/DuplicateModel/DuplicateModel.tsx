import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Navigation from "../../Utils/Navigation";
import { ButtonStyleType } from "../Button/Button";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import Card from "../Card/Card";
import BasicFormModal from "../FormModal/BasicFormModal";
import { ModelField } from "../Forms/ModelForm";
import FormValues from "../Forms/Types/FormValues";
import ConfirmModal from "../Modal/ConfirmModal";
import { fetchDuplicateName, getDuplicateNameColumn } from "./DuplicateName";
import {
  translatableTerm,
  translateNamedAction,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import React, { ReactElement, useRef, useState } from "react";
import Select from "../../../Types/BaseDatabase/Select";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  onDuplicateSuccess?: (item: TBaseModel) => Promise<void> | void;
  fieldsToDuplicate: Select<TBaseModel>;
  /*
   * What the dialog asks for the copy. The model's name column among them
   * starts filled in with the copy's name ("API Monitor 2", DuplicateName).
   */
  fieldsToChange: Array<ModelField<TBaseModel>>;
  /*
   * Where the copy opens: the copy's id is added to this route - a list's
   * route, so the copy's own page.
   */
  navigateToOnSuccess?: Route | undefined;
  /*
   * Adjusts the copy once it holds the original's values and what the
   * dialog asked, just before it is saved - a form's copy starts turned
   * off, say. Whatever it sets is what is saved.
   */
  prepareCopy?: ((copy: TBaseModel) => void) | undefined;
  /*
   * What the card says about the copy, in place of the generic "Duplicating
   * this <model> will create another <model> exactly like this one." - for
   * a copy that is not exactly like its original. In English: the card
   * looks it up.
   */
  description?: string | undefined;
}

/*
 * DUPLICATE: A COPY, NAMED AND OPENED.
 *
 * Duplicate <X> looks up the name the copy starts with (DuplicateName: the
 * original's name, numbered past the project's names) while its button
 * spins, then opens the dialog with that name filled in. Duplicate in the
 * dialog makes the copy and opens it.
 *
 * The dialog stays open until the copy exists. A refusal - a name the
 * server's unique check finds taken, a copy the server will not accept - is
 * shown in the dialog with what was typed, so the name can be changed and
 * Duplicate pressed again (or, if the dialog was closed meanwhile, in the
 * error dialog). Once the copy exists the dialog closes: what
 * onDuplicateSuccess does after (an on-call schedule's layers) is never
 * retried from the dialog, which would make a second copy; its failure is
 * reported on its own.
 */
const DuplicateModel: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const model: TBaseModel = new props.modelType();
  const duplicateTitle: string = translateNamedAction(translator, {
    template: "Duplicate {{itemName}}",
    itemName: model.singularName || "",
  });

  /* Duplicating writes a brand new record, so it needs create permission. */
  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
  );
  const [showModal, setShowModal] = useState<boolean>(false);
  // The copy's name being looked up, before the dialog opens.
  const [isPreparing, setIsPreparing] = useState<boolean>(false);
  // The copy being made: from Duplicate in the dialog until it opens.
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // What the dialog's form starts with: the copy's name, then what was typed.
  const [initialValues, setInitialValues] = useState<FormValues<TBaseModel>>(
    {},
  );
  // Why the copy was refused, shown in the dialog.
  const [formError, setFormError] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

  /*
   * One lookup per press: a second click lands before the button has
   * re-rendered as busy.
   */
  const isBusy: React.MutableRefObject<boolean> = useRef<boolean>(false);

  // Whether the dialog is still up when the copy is refused.
  const isDialogOpen: React.MutableRefObject<boolean> = useRef<boolean>(false);

  // The column the copy is named by; null when the dialog does not ask it.
  const nameColumn: string | null = getDuplicateNameColumn({
    model,
    fieldsToChange: props.fieldsToChange,
  });

  type OpenDialogFunction = () => Promise<void>;

  const openDialog: OpenDialogFunction = async (): Promise<void> => {
    if (!createGate.isAllowed || isBusy.current) {
      return;
    }

    isBusy.current = true;
    setFormError("");

    let values: FormValues<TBaseModel> = {};

    if (nameColumn) {
      setIsPreparing(true);

      try {
        const copyName: string = await fetchDuplicateName<TBaseModel>({
          modelType: props.modelType,
          modelId: props.modelId,
          nameColumn,
        });

        if (copyName) {
          values = { [nameColumn]: copyName } as FormValues<TBaseModel>;
        }
      } catch {
        // No name to fill in: the dialog asks for one, as it always did.
        values = {};
      }

      setIsPreparing(false);
    }

    setInitialValues(values);
    isDialogOpen.current = true;
    setShowModal(true);
    isBusy.current = false;
  };

  type CloseDialogFunction = () => void;

  const closeDialog: CloseDialogFunction = (): void => {
    isDialogOpen.current = false;
    setShowModal(false);
    setFormError("");
  };

  type CreateCopyFunction = (partialModel: TBaseModel) => Promise<TBaseModel>;

  // Reads the original, puts in what the dialog asked, and saves it as new.
  const createCopy: CreateCopyFunction = async (
    partialModel: TBaseModel,
  ): Promise<TBaseModel> => {
    const item: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
      modelType: props.modelType,
      id: props.modelId,
      select: props.fieldsToDuplicate,
    });

    if (!item) {
      throw new Error(
        `Could not find ${model.singularName} with id ${props.modelId}`,
      );
    }

    for (const field of props.fieldsToChange) {
      const key: string | undefined = Object.keys(field.field || {})[0];

      if (!key) {
        continue;
      }

      const value: string = partialModel.getValue(key);
      item.setValue(key, value);
    }

    props.prepareCopy?.(item);

    // A new record: the original's id stays with the original.
    item.removeValue("_id");

    const newItem: HTTPResponse<TBaseModel> =
      (await ModelAPI.create<TBaseModel>({
        model: item,
        modelType: props.modelType,
      })) as HTTPResponse<TBaseModel>;

    if (!newItem) {
      throw new Error(`Could not create ${model.singularName}`);
    }

    return newItem.data;
  };

  type DuplicateItemFunction = (values: FormValues<TBaseModel>) => void;

  const duplicateItem: DuplicateItemFunction = async (
    values: FormValues<TBaseModel>,
  ): Promise<void> => {
    // Kept, so a refused copy brings the form back as it was typed.
    setInitialValues({ ...values });
    setFormError("");
    setIsLoading(true);

    let newItem: TBaseModel;

    try {
      newItem = await createCopy(
        BaseModel.fromJSONObject(
          values as JSONObject,
          props.modelType,
        ) as TBaseModel,
      );
    } catch (err) {
      const reason: string = API.getFriendlyMessage(err);

      setIsLoading(false);

      // Nothing was made: the dialog stays, with the reason.
      if (isDialogOpen.current) {
        setFormError(reason);
      } else {
        setError(reason);
        setShowErrorModal(true);
      }

      return;
    }

    // The copy exists from here on.
    closeDialog();

    try {
      if (props.onDuplicateSuccess) {
        await props.onDuplicateSuccess(newItem);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setShowErrorModal(true);
      setIsLoading(false);
      return;
    }

    // The copy opens: its own page, under the list's route.
    const copyId: string | undefined = newItem?.id?.toString();

    if (props.navigateToOnSuccess && copyId) {
      Navigation.navigate(
        new Route(props.navigateToOnSuccess.toString()).addRoute(`/${copyId}`),
        {
          forceNavigate: true,
        },
      );
    }

    setIsLoading(false);
  };

  return (
    <>
      <Card
        title={duplicateTitle}
        description={
          props.description ||
          translator.translateTemplate(
            "Duplicating this {{itemName}} will create another {{itemName}} exactly like this one.",
            {
              itemName: translatableTerm(model.singularName || "", {
                inSentence: true,
              }),
            },
          )
        }
        buttons={[
          {
            title: duplicateTitle,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !createGate.isAllowed,
            tooltip: createGate.disabledReason,
            onClick: () => {
              void openDialog();
            },
            isLoading: isPreparing || isLoading,
            icon: IconProp.Copy,
          },
        ]}
      />

      {showModal ? (
        <BasicFormModal<TBaseModel>
          description={translator.translateTemplate(
            "Are you sure you want to duplicate this {{itemName}}?",
            {
              itemName: translatableTerm(model.singularName || "", {
                inSentence: true,
              }),
            },
          )}
          title={duplicateTitle}
          isLoading={isLoading}
          error={formError || undefined}
          onSubmit={(values: TBaseModel) => {
            void duplicateItem(values as FormValues<TBaseModel>);
          }}
          onClose={closeDialog}
          submitButtonText={duplicateTitle}
          formProps={{
            fields: props.fieldsToChange,
            initialValues: initialValues,
          }}
        />
      ) : (
        <></>
      )}

      {showErrorModal ? (
        <ConfirmModal
          description={error}
          title={`Duplicate Error`}
          onSubmit={() => {
            setShowErrorModal(false);
            setError("");
          }}
          submitButtonText={`Close`}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default DuplicateModel;
