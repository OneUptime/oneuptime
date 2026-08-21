import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import Navigation from "../../Utils/Navigation";
import { ButtonStyleType } from "../Button/Button";
import Card, {
  CardButtonSchema,
  ComponentProps as CardProps,
} from "../Card/Card";
import { FormType } from "../Forms/ModelForm";
import Fields from "../Forms/Types/Fields";
import { FormStep } from "../Forms/Types/FormStep";
import { ModalWidth } from "../Modal/Modal";
import ModelFormModal from "../ModelFormModal/ModelFormModal";
import ModelDetail, { ComponentProps as ModeDetailProps } from "./ModelDetail";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import React, { ReactElement, useEffect, useRef, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  cardProps: CardProps;
  modelDetailProps: ModeDetailProps<TBaseModel>;
  isEditable?: undefined | boolean;
  onSaveSuccess?: undefined | ((item: TBaseModel) => void);
  editButtonText?: undefined | string;
  formSteps?: undefined | Array<FormStep<TBaseModel>>;
  formFields?: undefined | Fields<TBaseModel>;
  className?: string | undefined;
  name: string;
  modelAPI?: typeof ModelAPI | undefined;
  createEditModalWidth?: ModalWidth | undefined;
  refresher?: boolean;
  createOrUpdateApiUrl?: URL | undefined;
  documentationLink?: Route | URL | undefined;
  videoLink?: Route | URL | undefined;
  onBeforeEdit?: (() => boolean) | undefined;
}

const CardModelDetail: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [cardButtons, setCardButtons] = useState<
    Array<CardButtonSchema | ReactElement>
  >([]);
  const [showModel, setShowModal] = useState<boolean>(false);
  const [item, setItem] = useState<TBaseModel | null>(null);
  const [refresher, setRefresher] = useState<boolean>(false);
  const model: TBaseModel = new props.modelDetailProps.modelType();

  const onBeforeEditRef: React.MutableRefObject<(() => boolean) | undefined> =
    useRef<(() => boolean) | undefined>(props.onBeforeEdit);
  useEffect(() => {
    onBeforeEditRef.current = props.onBeforeEdit;
  }, [props.onBeforeEdit]);

  useEffect(() => {
    setRefresher(!refresher);
  }, [props.refresher]);

  useEffect(() => {
    /*
     * This used to look at project permissions only, so a permission granted
     * globally did not count, and it read the raw updateRecordPermissions
     * field rather than going through the model's own accessor.
     */
    const updateGate: PermissionGateResult = PermissionGate.check(
      model,
      ModelAction.Update,
    );

    let cardButtons: Array<CardButtonSchema | ReactElement> = [];

    // Add documentation link button first if provided
    if (props.documentationLink) {
      cardButtons.push({
        title: "View Documentation",
        icon: IconProp.Book,
        buttonStyle: ButtonStyleType.OUTLINE,
        className: "hidden md:flex",
        onClick: () => {
          Navigation.navigate(props.documentationLink!, {
            openInNewTab: true,
          });
        },
      });
    }

    // Add video link button if provided
    if (props.videoLink) {
      cardButtons.push({
        title: "Watch Demo",
        icon: IconProp.Play,
        buttonStyle: ButtonStyleType.OUTLINE,
        className: "hidden md:flex",
        onClick: () => {
          Navigation.navigate(props.videoLink!, {
            openInNewTab: true,
          });
        },
      });
    }

    /*
     * Without update permission the button stays where it is, locked, and the
     * tooltip names the permission that is missing. Removing it made the page
     * look like editing was not a thing rather than not allowed. It is only
     * dropped entirely when there is nothing honest to say - the permission
     * snapshot has not loaded, or the model declares no update permissions.
     */
    if (
      props.isEditable &&
      (updateGate.isAllowed || updateGate.disabledReason)
    ) {
      cardButtons.push({
        title: props.editButtonText || `Edit ${model.singularName}`,
        buttonStyle: ButtonStyleType.NORMAL,
        disabled: !updateGate.isAllowed,
        tooltip: updateGate.disabledReason,
        onClick: () => {
          if (!updateGate.isAllowed) {
            return;
          }

          if (onBeforeEditRef.current && onBeforeEditRef.current() === false) {
            return;
          }
          setShowModal(true);
        },
        icon: IconProp.Edit,
      });
    }

    if (props.cardProps.buttons) {
      cardButtons = cardButtons.concat(...props.cardProps.buttons);
    }

    setCardButtons(cardButtons);
    /*
     * props.refresher is the card's existing "something changed, look again"
     * signal. The permission snapshot arrives on an API response header, so a
     * one-shot read at mount could permanently show the wrong state.
     */
  }, [props.refresher, props.isEditable, props.editButtonText]);

  return (
    <>
      <Card {...props.cardProps} buttons={cardButtons}>
        <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
          <ModelDetail
            refresher={refresher}
            {...props.modelDetailProps}
            modelAPI={props.modelAPI}
            onItemLoaded={(item: TBaseModel) => {
              setItem(item);
              if (props.modelDetailProps.onItemLoaded) {
                props.modelDetailProps.onItemLoaded(item);
              }
            }}
          />
        </div>
      </Card>

      {showModel ? (
        <ModelFormModal<TBaseModel>
          title={`Edit ${model.singularName}`}
          modalWidth={props.createEditModalWidth}
          modelAPI={props.modelAPI}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={`Save Changes`}
          onSuccess={(item: TBaseModel) => {
            setShowModal(false);
            setRefresher(!refresher);
            if (props.onSaveSuccess) {
              props.onSaveSuccess(item);
            }
          }}
          name={props.name}
          modelType={props.modelDetailProps.modelType}
          formProps={{
            id: `edit-${model.singularName?.toLowerCase()}-from`,
            fields: props.formFields || [],
            name: props.name,
            formType: FormType.Update,
            modelType: props.modelDetailProps.modelType,
            steps: props.formSteps || [],
            createOrUpdateApiUrl: props.createOrUpdateApiUrl,
          }}
          /*
           * Prefer the id the caller already handed us. Deriving it purely
           * from the loaded item meant that opening the modal before (or
           * without) a successful detail fetch produced an Update form with
           * no id: ModelForm silently skipped its fetch, rendered defaults,
           * and BasicForm coerced every untouched Toggle to false - so
           * saving quietly wrote blank values over the real record.
           */
          modelIdToEdit={
            props.modelDetailProps.modelId || item?.id || undefined
          }
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default CardModelDetail;
