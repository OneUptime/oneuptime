import {
  DashboardRecordingConfig,
  getDashboardRecordingConfig,
} from "../../Utils/DashboardRecording/DashboardRecordingConfig";
import DashboardRecordingController, {
  DashboardRecorderHandle,
} from "../../Utils/DashboardRecording/DashboardRecordingController";
import {
  DashboardRecordingDecision,
  decideDashboardRecording,
  shouldReadSwitches,
} from "../../Utils/DashboardRecording/DashboardRecordingGate";
import GuidedSetupContext, {
  GuidedSetupPlace,
} from "../../Utils/DashboardRecording/GuidedSetupContext";
import { isRecordedPath } from "../../Utils/DashboardRecording/RecordedPages";
import { getFeedbackPageFor } from "../Feedback/FeedbackPage";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import ObjectID from "Common/Types/ObjectID";
import { subscribeToModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import FormRefusals from "Common/UI/Utils/FormRefusals";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import Analytics from "Common/Utils/Analytics";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";

/*
 * WATCHING ONEUPTIME WITH ONEUPTIME (issue #6834), mounted once in App.
 *
 * Draws nothing. On every page it asks the gate (DashboardRecordingGate)
 * whether this moment may be recorded, and tells the controller, which
 * loads the recorder the first time the answer is yes, pauses it on pages
 * that are not recorded, and stops it for good when the person or the
 * project switches it off.
 *
 * On a server that records nobody - every self-hosted one - the first gate
 * answers no before anything else is asked: no switch is read, no listener
 * added, nothing imported or fetched.
 *
 * The decision is applied in a layout effect, in the same commit that draws
 * the new page, so the recorder pauses before the browser reports a page
 * that is not recorded to it, rather than one frame later.
 */

export interface ComponentProps {
  // The project in view, or null on a page outside any project (Welcome).
  projectId: string | null;
}

interface ProjectSwitch {
  projectId: string;
  isOff: boolean;
}

const loadRecorder: () => Promise<DashboardRecorderHandle> =
  async (): Promise<DashboardRecorderHandle> => {
    return (await import("../../Utils/DashboardRecording/DashboardRecorder"))
      .default;
  };

const DashboardRecording: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();

  const config: DashboardRecordingConfig | null = useMemo(() => {
    return getDashboardRecordingConfig();
  }, []);

  // Read only on a server that records at all: the first gate.
  const isConsentGiven: boolean = config
    ? Analytics.isSessionRecordingAllowed()
    : false;

  const isReadingSwitches: boolean =
    shouldReadSwitches({ config: config, isConsentGiven: isConsentGiven }) &&
    UserUtil.isLoggedIn();

  const [isPersonOff, setIsPersonOff] = useState<boolean | null>(null);
  const [projectSwitch, setProjectSwitch] = useState<ProjectSwitch | null>(
    null,
  );

  const projectId: string = props.projectId || "";

  // The person's own switch (User Profile).
  useEffect(() => {
    if (!isReadingSwitches) {
      return;
    }

    const userId: ObjectID = UserUtil.getUserId();
    let isCurrent: boolean = true;

    ModelAPI.getItem<User>({
      modelType: User,
      id: userId,
      select: { disableDashboardRecording: true },
    })
      .then((user: User | null): void => {
        if (isCurrent) {
          // Unread counts as off: only a clear "on" lets it record.
          setIsPersonOff(user ? Boolean(user.disableDashboardRecording) : true);
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setIsPersonOff(true);
        }
      });

    const unsubscribe: () => void = subscribeToModelSwitchSaved({
      modelType: User,
      modelId: userId,
      column: "disableDashboardRecording",
      onSaved: (value: boolean): void => {
        setIsPersonOff(value);
      },
    });

    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, [isReadingSwitches]);

  // The project's switch (Project Settings), for the project in view.
  useEffect(() => {
    if (!isReadingSwitches || !projectId) {
      return;
    }

    let isCurrent: boolean = true;
    const id: ObjectID = new ObjectID(projectId);

    ModelAPI.getItem<Project>({
      modelType: Project,
      id: id,
      select: { disableDashboardRecording: true },
    })
      .then((project: Project | null): void => {
        if (isCurrent) {
          setProjectSwitch({
            projectId: projectId,
            isOff: project ? Boolean(project.disableDashboardRecording) : true,
          });
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setProjectSwitch({ projectId: projectId, isOff: true });
        }
      });

    const unsubscribe: () => void = subscribeToModelSwitchSaved({
      modelType: Project,
      modelId: id,
      column: "disableDashboardRecording",
      onSaved: (value: boolean): void => {
        setProjectSwitch({ projectId: projectId, isOff: value });
      },
    });

    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, [isReadingSwitches, projectId]);

  const decision: DashboardRecordingDecision = decideDashboardRecording({
    config: config,
    isConsentGiven: isConsentGiven,
    isPersonOff: isPersonOff,
    hasProject: Boolean(projectId),
    isProjectOff:
      projectSwitch && projectSwitch.projectId === projectId
        ? projectSwitch.isOff
        : null,
    isRecordedPage: isRecordedPath(location.pathname),
  });

  const controllerRef: React.MutableRefObject<DashboardRecordingController | null> =
    useRef<DashboardRecordingController | null>(null);

  useLayoutEffect(() => {
    if (!config) {
      return;
    }

    if (!controllerRef.current) {
      controllerRef.current = new DashboardRecordingController({
        loadRecorder: loadRecorder,
      });
    }

    controllerRef.current.update({
      decision: decision,
      config: config,
      page: getFeedbackPageFor(location.pathname),
      isSampleProject:
        ProjectUtil.getCurrentProject()?.isSampleProject === true,
    });
  }, [decision, location.pathname]);

  /*
   * What the controller listens to, once there is something to record
   * for: input on the page, forms that refuse, the product's events and
   * where in a guided setup the person is.
   */
  const isListening: boolean =
    decision === DashboardRecordingDecision.Record ||
    decision === DashboardRecordingDecision.PageNotRecorded;

  useEffect(() => {
    if (!isListening || !controllerRef.current) {
      return;
    }

    const controller: DashboardRecordingController = controllerRef.current;

    const onInput: () => void = (): void => {
      controller.noteInput();
    };

    document.addEventListener("click", onInput, true);
    document.addEventListener("keydown", onInput, true);

    const unsubscribeForms: () => void = FormRefusals.subscribe((): void => {
      controller.noteFormRefusal();
    });

    const unsubscribeEvents: () => void = ProductEvents.subscribe(
      (name: string): void => {
        controller.noteProductEvent(name);
      },
    );

    controller.noteGuidedSetupPlace(GuidedSetupContext.get());

    const unsubscribePlace: () => void = GuidedSetupContext.subscribe(
      (place: GuidedSetupPlace | null): void => {
        controller.noteGuidedSetupPlace(place);
      },
    );

    return () => {
      document.removeEventListener("click", onInput, true);
      document.removeEventListener("keydown", onInput, true);
      unsubscribeForms();
      unsubscribeEvents();
      unsubscribePlace();
    };
  }, [isListening]);

  return <></>;
};

export default DashboardRecording;
