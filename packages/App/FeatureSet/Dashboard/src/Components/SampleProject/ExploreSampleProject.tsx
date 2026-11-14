import { createSampleProject, SampleProjectResult } from "./SampleProjectApi";
import { openProjectHome } from "./SampleProjectNavigation";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SampleProjectCreateAnswer,
  SampleProjectEntryPoint,
} from "Common/Types/SampleProject/SampleProject";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "Explore Sample Project" (issue #6808): one click makes the person's
 * sample project - or opens the one they have - and takes them to its Home.
 * Offered on the "No projects" page, under the goal question's "Just
 * looking around", and on Home while the project has nothing in it.
 *
 * The line beside the button says what the sample is before the click, so
 * nobody mistakes it for their own project.
 *
 * Not offered where the person may not make a project: a server whose
 * admin keeps project creation to admins makes no sample for anyone else
 * (SampleProjectService), so the button is left out rather than refused.
 * The page that offers it says whether it may (isOffered), from what it
 * already read: the "No projects" page from the server's settings, Home
 * from its Welcome checklist answer - so offering it costs no request.
 */

export interface ComponentProps {
  from: SampleProjectEntryPoint;
  // Whether this person may have a sample made here (canExploreSampleProject).
  isOffered: boolean;
  buttonStyle?: ButtonStyleType | undefined;
  buttonSize?: ButtonSize | undefined;
  // The line that says what the sample is. Shown unless the page says it already.
  showDescription?: boolean | undefined;
  className?: string | undefined;
}

const ExploreSampleProject: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpening, setIsOpening] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const explore: () => Promise<void> = async (): Promise<void> => {
    setIsOpening(true);
    setError("");

    const result: SampleProjectResult<SampleProjectCreateAnswer> =
      await createSampleProject();

    if (!result.isSuccess) {
      setIsOpening(false);
      setError(result.error);
      return;
    }

    ProductEvents.send(ProductEventName.SampleProjectStarted, {
      from: props.from,
      is_new: result.value.isNew,
    });

    openProjectHome(new ObjectID(result.value.projectId));
  };

  if (!props.isOffered) {
    return <></>;
  }

  return (
    <div className={props.className} data-testid="explore-sample-project">
      {props.showDescription === false ? (
        <></>
      ) : (
        <p className="mb-3 text-sm text-gray-500">
          {translator.translateText(
            "See OneUptime with data in it: monitors, incidents, on-call, a status page and telemetry. Nothing in it is real, and nobody is notified.",
          )}
        </p>
      )}
      <Button
        icon={IconProp.Beaker}
        title="Explore Sample Project"
        buttonStyle={props.buttonStyle || ButtonStyleType.NORMAL}
        buttonSize={props.buttonSize || ButtonSize.Normal}
        isLoading={isOpening}
        disabled={isOpening}
        onClick={() => {
          explore().catch(() => {
            // explore() says what failed.
          });
        }}
        dataTestId="explore-sample-project-button"
      />
      {error ? (
        <p
          role="alert"
          data-testid="explore-sample-project-error"
          className="mt-2 text-sm text-red-600"
        >
          {translator.translateText(error)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ExploreSampleProject;
