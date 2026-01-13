import PermissionUtil from "../../Utils/Permission";
import User from "../../Utils/User";
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
import {
  PermissionHelper,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import React, { ReactElement, useEffect, useState } from "react";

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
  createEditModalWidth?: ModalWidth | undefined;
  refresher?: boolean;
  createOrUpdateApiUrl?: URL | undefined;
  documentationLink?: Route | URL | undefined;
  videoLink?: Route | URL | undefined;
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

  useEffect(() => {
    setRefresher(!refresher);
  }, [props.refresher]);

  useEffect(() => {
    const userProjectPermissions: UserTenantAccessPermission | null =
      PermissionUtil.getProjectPermissions();

    const hasPermissionToEdit: boolean =
      Boolean(
        userProjectPermissions &&
          userProjectPermissions.permissions &&
          PermissionHelper.doesPermissionsIntersect(
            model.updateRecordPermissions,
            userProjectPermissions.permissions.map((item: UserPermission) => {
              return item.permission;
            }),
          ),
      ) || User.isMasterAdmin();

    let cardButtons: Array<CardButtonSchema | ReactElement> = [];

    // Add documentation link button first if provided
    if (props.documentationLink) {
      cardButtons.push({
        title: "View Documentation",
        icon: IconProp.Book,
        buttonStyle: ButtonStyleType.OUTLINE,
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
        title: "Watch Video",
        icon: IconProp.Play,
        buttonStyle: ButtonStyleType.OUTLINE,
        onClick: () => {
          Navigation.navigate(props.videoLink!, {
            openInNewTab: true,
          });
        },
      });
    }

    if (props.isEditable && hasPermissionToEdit) {
      cardButtons.push({
        title: props.editButtonText || `Edit ${model.singularName}`,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: () => {
          setShowModal(true);
        },
        icon: IconProp.Edit,
      });
    }

    if (props.cardProps.buttons) {
      cardButtons = cardButtons.concat(...props.cardProps.buttons);
    }

    setCardButtons(cardButtons);
  }, []);

  return (
    <>
      <Card {...props.cardProps} buttons={cardButtons}>
        <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
          <ModelDetail
            refresher={refresher}
            {...props.modelDetailProps}
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
          modelIdToEdit={item?.id || undefined}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default CardModelDetail;
