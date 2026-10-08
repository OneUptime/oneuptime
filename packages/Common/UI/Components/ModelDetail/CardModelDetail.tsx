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
import { useIsCardSection } from "../Card/CardSurface";
import { FormType, ModelFormOnBeforeUpdate } from "../Forms/ModelForm";
import Fields from "../Forms/Types/Fields";
import { FormStep } from "../Forms/Types/FormStep";
import { ModalWidth } from "../Modal/Modal";
import ModelFormModal from "../ModelFormModal/ModelFormModal";
import ModelDetail, { ComponentProps as ModeDetailProps } from "./ModelDetail";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import {
  translateNamedAction,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  cardProps: CardProps;
  modelDetailProps: ModeDetailProps<TBaseModel>;
  isEditable?: undefined | boolean;
  onSaveSuccess?: undefined | ((item: TBaseModel) => void);
  editButtonText?: undefined | string;
  /*
   * The edit dialog's title and the line under it. The title defaults to
   * "Edit <model>", which says "Edit Project" on a card that edits a few of
   * the project's settings: such a card names what it edits instead.
   */
  editModalTitle?: undefined | string;
  editModalDescription?: undefined | string;
  formSteps?: undefined | Array<FormStep<TBaseModel>>;
  formFields?: undefined | Fields<TBaseModel>;
  /*
   * Called with the model the Edit dialog is about to save, the misc data
   * and every value the form holds (ModelForm's onBeforeUpdate): what it
   * returns is what is saved. The incident's Affected Resources card leaves
   * out a monitor status when no monitor is left to put in it.
   */
  onBeforeUpdate?: ModelFormOnBeforeUpdate<TBaseModel> | undefined;
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

// The fields' box: a rule across the card under its header, on a page.
export const CARD_MODEL_DETAIL_BODY_CLASS_NAME: string =
  "border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2";

/*
 * In a section of a card: no rule and no box of their own, and a little more
 * room under the header than a card's body has, which the rule gave.
 */
export const CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME: string = "pt-2";

const CardModelDetail: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isCardSection: boolean = useIsCardSection();
  const [showModel, setShowModal] = useState<boolean>(false);
  const [item, setItem] = useState<TBaseModel | null>(null);
  const [refresher, setRefresher] = useState<boolean>(false);
  const model: TBaseModel = new props.modelDetailProps.modelType();
  const editTitle: string = translateNamedAction(translator, {
    template: "Edit {{itemName}}",
    itemName: model.singularName || "",
  });

  const onBeforeEditRef: React.MutableRefObject<(() => boolean) | undefined> =
    useRef<(() => boolean) | undefined>(props.onBeforeEdit);
  useEffect(() => {
    onBeforeEditRef.current = props.onBeforeEdit;
  }, [props.onBeforeEdit]);

  /*
   * Only a real change to props.refresher toggles the internal one. Toggling
   * on mount as well handed ModelDetail a second refresher value right after
   * its first render, so every card sent two getItem requests on page load.
   * Comparing against the last seen value, rather than skipping the first
   * run, also holds when StrictMode re-runs effects on mount.
   */
  const lastPropsRefresherRef: React.MutableRefObject<boolean | undefined> =
    useRef<boolean | undefined>(props.refresher);

  useEffect(() => {
    if (lastPropsRefresherRef.current === props.refresher) {
      return;
    }

    lastPropsRefresherRef.current = props.refresher;
    setRefresher(!refresher);
  }, [props.refresher]);

  /*
   * The header's buttons: the card's own (documentation, demo, Edit), then
   * the page's. Worked out while rendering rather than kept in state, so a
   * page button that comes and goes - Apply Template on the postmortem,
   * shown once the project's templates have loaded and there is one - is
   * drawn as soon as the page hands it over. Kept in state and refreshed
   * only by the refresher, a button the page added after the first paint
   * stayed missing until something else changed.
   */
  const cardButtons: Array<CardButtonSchema | ReactElement> = useMemo(() => {
    /*
     * This used to look at project permissions only, so a permission granted
     * globally did not count, and it read the raw updateRecordPermissions
     * field rather than going through the model's own accessor.
     *
     * It then looked at the record's update list alone. The form leaves out
     * every field its viewer may not change, and many columns are narrower
     * than their record - a project's name is not a project admin's to
     * change, its notification channels are a Billing Admin's - so somebody
     * the record let in but none of the card's fields did was handed an
     * Edit button that opened an empty form. The button now locks for them
     * too, naming what would open it (PermissionGate.checkFormUpdate).
     */
    const updateGate: PermissionGateResult = props.formFields
      ? PermissionGate.checkFormUpdate(model, props.formFields)
      : PermissionGate.check(model, ModelAction.Update);

    let cardButtons: Array<CardButtonSchema | ReactElement> = [];

    // Add documentation link button first if provided
    if (props.documentationLink) {
      cardButtons.push({
        title: "View Documentation",
        icon: IconProp.Book,
        buttonStyle: ButtonStyleType.OUTLINE,
        className: "max-md:hidden md:flex",
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
        className: "max-md:hidden md:flex",
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
        title: props.editButtonText || editTitle,
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

    return cardButtons;
    /*
     * props.refresher is the card's existing "something changed, look again"
     * signal. The permission snapshot arrives on an API response header, so a
     * one-shot read at mount could permanently show the wrong state. A page
     * usually writes its buttons as a literal, so they are new on every
     * render of the page, which looks again too.
     */
  }, [
    props.refresher,
    props.isEditable,
    props.editButtonText,
    props.documentationLink,
    props.videoLink,
    props.cardProps.buttons,
    props.formFields,
    translator.language,
  ]);

  return (
    <>
      <Card {...props.cardProps} buttons={cardButtons}>
        {/*
         * On a page the fields sit under a rule across the card, apart from
         * its header. In a section of a card (CardSections) a rule across
         * the card is the divider between two sections, so one here would
         * read as the start of a section with no title: the fields follow
         * the header as they do in a card without one.
         */}
        <div
          className={
            isCardSection
              ? CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME
              : CARD_MODEL_DETAIL_BODY_CLASS_NAME
          }
          data-testid="card-model-detail-body"
        >
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
          title={props.editModalTitle || editTitle}
          description={props.editModalDescription}
          modalWidth={props.createEditModalWidth}
          modelAPI={props.modelAPI}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={`Save Changes`}
          onBeforeUpdate={props.onBeforeUpdate}
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
