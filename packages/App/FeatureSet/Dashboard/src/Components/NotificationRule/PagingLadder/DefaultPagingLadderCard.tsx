import PagingLadderEditor from "./PagingLadderEditor";
import {
  DEFAULT_LADDER_TITLE,
  PROJECT_PAGING_DEFAULTS_COPY,
  getDefaultLadderChannelChoices,
  toDefaultLadderSteps,
  toDefaultSteps,
} from "./ProjectPagingDefaultsWords";
import { canUpdateProjectColumns } from "../../../Pages/Settings/ProjectColumnEditGate";
import { usePushNotificationsTurnedOff } from "../../../Utils/PushNotificationsTurnedOff";
import Project from "Common/Models/DatabaseModels/Project";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import { JSONObject } from "Common/Types/JSON";
import { PagingLadderStep } from "Common/Types/NotificationRule/PagingLadder";
import { toPagingLadderDefaultJSON } from "Common/Types/NotificationRule/PagingLadderDefault";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * HOW MEMBERS ARE PAGED BY DEFAULT (#7449), in Project Settings >
 * Notification Channels' More settings: the project's default ladder, how a
 * member is paged once they verify a way to be reached, by channel, edited
 * with How to Reach Me's own editor. Saving it changes nobody's rules; On-Call
 * Readiness applies it to the members an admin picks (#7450), and a member
 * can start their own ladder from it on How to Reach Me (#9445). Its ask for
 * a phone method is PhoneForOnCallCard, beside it.
 *
 * Who may change it is the column's own update list (Project Owner and
 * Project Admin): anybody else sees it read only.
 *
 * A card of its own module, with a default export, as every card folded under
 * a page's More settings is: the card-in-card guard reads a module's default
 * export to know it draws a whole card, and so a section with its divider
 * there (Common/Tests/UI/Components/CardInCardGuard.test.ts, #9464).
 */

export const DEFAULT_LADDER_COLUMNS: Array<string> = ["defaultPagingLadder"];

export interface DefaultPagingLadderCardProps {
  projectId: ObjectID;
  // How many steps the saved default has, each time it is read or saved.
  onStepCountChange?: ((count: number) => void) | undefined;
}

const DefaultPagingLadderCard: FunctionComponent<
  DefaultPagingLadderCardProps
> = (props: DefaultPagingLadderCardProps): ReactElement => {
  const translator: Translator = useTranslator();
  const isPushTurnedOff: boolean = usePushNotificationsTurnedOff() === true;
  const isEditable: boolean = canUpdateProjectColumns(DEFAULT_LADDER_COLUMNS);

  const [savedSteps, setSavedSteps] = useState<Array<PagingLadderStep> | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [isTurningOff, setIsTurningOff] = useState<boolean>(false);

  const show: (value: unknown) => void = (value: unknown): void => {
    const steps: Array<PagingLadderStep> = toDefaultLadderSteps(value);
    setSavedSteps(steps);
    props.onStepCountChange?.(steps.length);
  };

  const load: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const project: Project | null = await ModelAPI.getItem<Project>({
        modelType: Project,
        id: props.projectId,
        select: { defaultPagingLadder: true },
      });

      show(project?.defaultPagingLadder);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  useEffect(() => {
    load().catch(() => {
      // load() reports its own failure.
    });
  }, [props.projectId.toString()]);

  const saveDefault: (steps: Array<PagingLadderStep>) => Promise<void> = async (
    steps: Array<PagingLadderStep>,
  ): Promise<void> => {
    const stored: JSONObject = {
      defaultPagingLadder: toPagingLadderDefaultJSON(toDefaultSteps(steps)),
    };

    await ModelAPI.updateById<Project>({
      modelType: Project,
      id: props.projectId,
      data: stored,
    });

    ProductEvents.send(ProductEventName.PagingLadderDefaultSaved, {
      step_count: steps.length,
    });

    show(stored["defaultPagingLadder"]);
  };

  if (!savedSteps) {
    return error ? (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          load().catch(() => {
            // load() reports its own failure.
          });
        }}
      />
    ) : (
      <PageSkeleton />
    );
  }

  const footer: ReactElement = (
    <div className="flex flex-col items-start gap-2">
      {isEditable && savedSteps.length > 0 ? (
        <Button
          title={PROJECT_PAGING_DEFAULTS_COPY.turnOff}
          buttonStyle={ButtonStyleType.LINK}
          buttonSize={ButtonSize.Small}
          isLoading={isTurningOff}
          dataTestId="default-ladder-turn-off"
          onClick={() => {
            setIsTurningOff(true);
            setError("");
            saveDefault([])
              .catch((err: unknown) => {
                setError(API.getFriendlyMessage(err));
              })
              .finally(() => {
                setIsTurningOff(false);
              });
          }}
        />
      ) : (
        <></>
      )}
      {!isEditable ? (
        <p
          className="text-sm text-gray-500"
          data-testid="default-ladder-read-only"
        >
          {translator.translateText(PROJECT_PAGING_DEFAULTS_COPY.readOnly)}
        </p>
      ) : (
        <></>
      )}
      {error ? <ErrorMessage message={error} /> : <></>}
    </div>
  );

  return (
    <div data-testid="default-ladder-card">
      <PagingLadderEditor
        title={translator.translateText(DEFAULT_LADDER_TITLE) || ""}
        description={
          translator.translateText(
            PROJECT_PAGING_DEFAULTS_COPY.ladderDescription,
          ) || ""
        }
        savedSteps={savedSteps}
        methods={getDefaultLadderChannelChoices()}
        isEditable={isEditable}
        isPushTurnedOff={isPushTurnedOff}
        differences={[]}
        severityColors={{}}
        onSave={(steps: Array<PagingLadderStep>): Promise<void> => {
          return saveDefault(steps);
        }}
        footer={footer}
        noStepsText={translator.translateText(
          PROJECT_PAGING_DEFAULTS_COPY.noDefault,
        )}
        addLabel={translator.translateText(
          PROJECT_PAGING_DEFAULTS_COPY.addLabel,
        )}
        savedText={translator.translateText(PROJECT_PAGING_DEFAULTS_COPY.saved)}
      />
    </div>
  );
};

export default DefaultPagingLadderCard;
