import {
  HowOneUptimeWorksOpenedFrom,
  openHowOneUptimeWorks,
} from "../Home/HowOneUptimeWorksDialog";
import { deleteSampleProject, SampleProjectResult } from "./SampleProjectApi";
import {
  getProjectToGoBackTo,
  leaveDeletedSample,
  openProjectHome,
} from "./SampleProjectNavigation";
import Project from "Common/Models/DatabaseModels/Project";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * EVERY PAGE OF A SAMPLE PROJECT SAYS WHAT IT IS (issue #6808).
 *
 * One bar across the top of every page of a sample project - and of no
 * other project: nothing in it is real, and nobody is notified. Beside it,
 * the ways out: back to the person's own project (or, with none yet, to
 * make one), Delete Sample Project, and How OneUptime works, the story the
 * sample tells.
 *
 * The one banner the Dashboard shows on every page of a project: here the
 * project itself is the exception, and the person must never mistake it
 * for their own (Docs/ux/README.md, "A sample project says so on every
 * page"; NoAlwaysOnInfoBannersGuard lists it among the banners that
 * belong). Dark rather than tinted, so it reads as the frame of the page,
 * not a message inside it.
 */

export const SAMPLE_PROJECT_BAR_TEST_ID: string = "sample-project-bar";

export interface ComponentProps {
  project: Project;
  projects: ReadonlyArray<Project>;
  // Opens the dialog that creates a project, for a person with no other one.
  onCreateProject: () => void;
}

const SampleProjectBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  if (!props.project.isSampleProject) {
    return <></>;
  }

  const goBackTo: Project | null = getProjectToGoBackTo(props.projects);
  const projectName: string = props.project.name || "";
  const sentence: string =
    translator.translateText(
      "This is a sample project. Nothing here is real, and nobody is notified.",
    ) || "";

  const deleteSample: () => Promise<void> = async (): Promise<void> => {
    if (!props.project.id) {
      return;
    }

    setIsDeleting(true);
    setDeleteError("");

    const result: SampleProjectResult<true> = await deleteSampleProject(
      props.project.id,
    );

    if (!result.isSuccess) {
      setIsDeleting(false);
      setDeleteError(result.error);
      return;
    }

    ProductEvents.send(ProductEventName.SampleProjectDeleted, {
      days_kept: props.project.createdAt
        ? Math.max(
            0,
            OneUptimeDate.getDaysBetweenTwoDates(
              props.project.createdAt,
              OneUptimeDate.getCurrentDate(),
            ),
          )
        : 0,
    });

    leaveDeletedSample(goBackTo);
  };

  return (
    <div
      data-testid={SAMPLE_PROJECT_BAR_TEST_ID}
      role="region"
      aria-label={sentence}
      className="flex flex-col gap-2 bg-gray-900 px-4 py-2 text-sm text-white sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      {/* A div, not a p: the Icon draws a div of its own. */}
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          icon={IconProp.Beaker}
          className="mt-0.5 h-4 w-4 flex-none text-amber-300"
        />
        <span className="min-w-0">{sentence}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          data-testid="sample-project-how-it-works"
          className="font-medium text-gray-300 underline-offset-2 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={() => {
            openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.SampleProject);
          }}
        >
          {translator.translateText("How OneUptime works")}
        </button>
        {goBackTo?.id ? (
          <button
            type="button"
            data-testid="sample-project-back"
            className="font-medium text-white underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => {
              openProjectHome(goBackTo.id!);
            }}
          >
            {translator.translateTemplate("Back to {{name}}", {
              name: goBackTo.name || "",
            })}
          </button>
        ) : (
          <button
            type="button"
            data-testid="sample-project-create-own"
            className="font-medium text-white underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={props.onCreateProject}
          >
            {translator.translateText("Create Your Own Project")}
          </button>
        )}
        <Button
          title="Delete Sample Project"
          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          buttonSize={ButtonSize.Small}
          onClick={() => {
            setDeleteError("");
            setIsConfirmingDelete(true);
          }}
          dataTestId="sample-project-delete"
        />
      </div>
      {isConfirmingDelete ? (
        <ConfirmModal
          title="Delete Sample Project"
          description={translator.translateTemplate(
            "Are you sure you want to delete {{project}}? All its made-up data is deleted for good. You can explore a new sample at any time.",
            { project: projectName },
          )}
          submitButtonText="Delete Sample Project"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isDeleting}
          error={deleteError || undefined}
          onClose={() => {
            if (!isDeleting) {
              setIsConfirmingDelete(false);
            }
          }}
          onSubmit={() => {
            deleteSample().catch(() => {
              // deleteSample() says what failed.
            });
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SampleProjectBar;
