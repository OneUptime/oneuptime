import FormMappingCard from "../../../Components/FormBuilder/OnSubmit/FormMappingCard";
import FormTargetCard from "../../../Components/FormBuilder/OnSubmit/FormTargetCard";
import FormsCopy from "../../../Components/FormBuilder/FormsCopy";
import PageComponentProps from "../../PageComponentProps";
import Form from "Common/Models/DatabaseModels/Form";
import FormTargetType, {
  readFormTargetType,
} from "Common/Types/Form/FormTargetType";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import useAsyncEffect from "use-async-effect";

/*
 * A form's On Submit page: what each submission creates, and how its
 * answers and the form's settings become that record - the "map it to an
 * incident" step. Both cards read the form as it is now, and read it again
 * after either changes it.
 */
const FormOnSubmit: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { id } = useParams();
  const formId: ObjectID = new ObjectID(id || "");

  const [form, setForm] = useState<Form | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  // Bumped after a change, to read the form again.
  const [version, setVersion] = useState<number>(0);

  useAsyncEffect(async () => {
    setIsLoading(true);
    setError("");

    try {
      const loaded: Form | null = await ModelAPI.getItem<Form>({
        modelType: Form,
        id: formId,
        select: {
          targetType: true,
          fields: true,
          targetSettings: true,
        },
      });

      if (loaded) {
        setForm(loaded);
      } else {
        setError(FormsCopy.shareLinkNotFound);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, [formId.toString(), version]);

  const reload: () => void = (): void => {
    setVersion((value: number): number => {
      return value + 1;
    });
  };

  if (!form) {
    return (
      <Card
        title={FormsCopy.targetCardTitle}
        description={FormsCopy.targetCardDescription}
      >
        {isLoading ? (
          <ComponentLoader />
        ) : (
          <ErrorMessage message={error || FormsCopy.shareLinkNotFound} />
        )}
      </Card>
    );
  }

  const targetType: FormTargetType = readFormTargetType(form.targetType);

  return (
    <Fragment>
      <FormTargetCard
        formId={formId}
        targetType={targetType}
        fields={form.fields}
        onChanged={reload}
      />
      <FormMappingCard
        key={targetType}
        formId={formId}
        targetType={targetType}
        fields={form.fields}
        targetSettings={form.targetSettings}
        onSaved={reload}
      />
    </Fragment>
  );
};

export default FormOnSubmit;
