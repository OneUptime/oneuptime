import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  /** Singular label used in copy, e.g. "service". Defaults to model name. */
  singularName?: string | undefined;
  /** Where to send the user after archiving (usually the list page). */
  listRoute?: Route | undefined;
}

/**
 * Self-contained card for the per-resource Settings page that lets a user
 * archive or unarchive a single resource. Archiving is a visibility flag only —
 * telemetry continues to be ingested. The client sends `{ isArchived }`; the
 * server stamps `archivedAt` / `archivedByUserId`.
 */
const ArchiveResourceCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isArchived, setIsArchived] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const model: TBaseModel = new props.modelType();
  const singularName: string =
    props.singularName || model.singularName || "resource";

  const loadState: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: {
          isArchived: true,
        } as any,
      });
      setIsArchived(Boolean((item as any)?.isArchived));
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadState().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const toggleArchive: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    try {
      const newValue: boolean = !isArchived;
      await ModelAPI.updateById<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        data: {
          isArchived: newValue,
        } as any,
      });
      setIsArchived(newValue);
      setShowConfirm(false);
      setIsSaving(false);

      // After archiving, send the user back to the list (the resource is now hidden there).
      if (newValue && props.listRoute) {
        Navigation.navigate(props.listRoute);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsSaving(false);
      setShowConfirm(false);
    }
  };

  if (isLoading) {
    return (
      <Card title="Archive" description="Loading…">
        <ComponentLoader />
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Archive">
        <ErrorMessage message={error} />
      </Card>
    );
  }

  const title: string = isArchived
    ? `Unarchive ${singularName}`
    : `Archive ${singularName}`;

  const description: string = isArchived
    ? `This ${singularName} is archived and hidden from lists. It is still collecting telemetry. Unarchive it to make it visible again.`
    : `Archive this ${singularName} to hide it from lists while it keeps collecting telemetry. You can unarchive it anytime.`;

  return (
    <Fragment>
      <Card
        title={title}
        description={description}
        buttons={[
          {
            title: isArchived ? "Unarchive" : "Archive",
            icon: isArchived ? IconProp.Unarchive : IconProp.Archive,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setShowConfirm(true);
            },
          },
        ]}
      />
      {showConfirm && (
        <ConfirmModal
          title={title}
          description={
            isArchived
              ? `Are you sure you want to unarchive this ${singularName}? It will reappear in the main list.`
              : `Are you sure you want to archive this ${singularName}? It will be hidden from the list but will keep collecting telemetry.`
          }
          submitButtonText={isArchived ? "Unarchive" : "Archive"}
          submitButtonType={ButtonStyleType.NORMAL}
          isLoading={isSaving}
          onClose={() => {
            setShowConfirm(false);
          }}
          onSubmit={() => {
            toggleArchive().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default ArchiveResourceCard;
