import { NotificationMethodChoice } from "./NotificationMethodChoice";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import OnCallRulesTabs, { OnCallRulesPerson } from "./OnCallRulesTabs";
import {
  PagingLadderData,
  loadOwnPagingMethods,
  loadPagingLadderData,
  savePagingLadder,
} from "./PagingLadder/PagingLadderApi";
import PagingLadderEditor from "./PagingLadder/PagingLadderEditor";
import AddWaysToReach from "./PagingLadder/AddWaysToReach";
import {
  PagingMethodChoice,
  getMemberMethodChoices,
} from "./PagingLadder/PagingLadderMethods";
import {
  DifferencesList,
  MethodLabel,
  StepChip,
} from "./PagingLadder/PagingLadderParts";
import {
  CARDS_DIFFER,
  PAGING_LADDER_COPY,
} from "./PagingLadder/PagingLadderWords";
import {
  StepsNotSentNowNotice,
  getChannelsNotSentNow,
  getChannelsNotSentNowInSteps,
} from "./PagingLadder/StepsNotSentNow";
import TestPageCard from "../OnCallTestPage/TestPageCard";
import VerificationCodeModal from "../NotificationMethods/VerificationCodeModal";
import { VerificationCodeChannel } from "../NotificationMethods/VerificationCodeChannels";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { usePushNotificationsTurnedOff } from "../../Utils/PushNotificationsTurnedOff";
import Route from "Common/Types/API/Route";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ON_CALL_RULE_KIND_QUERY_PARAM,
  readOnCallRuleKind,
} from "Common/Types/NotificationRule/OnCallRuleKind";
import {
  PagingLadderDifference,
  PagingLadderReading,
  PagingLadderStep,
  PagingMethodColumn,
  getPagingLadderCellKey,
  getPagingLadderStepKey,
  readPagingLadder,
} from "Common/Types/NotificationRule/PagingLadder";
import {
  PagingLadderFromDefault,
  PagingLadderMethodReference,
  getPagingLadderDefaultStart,
} from "Common/Types/NotificationRule/PagingLadderDefault";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import ObjectID from "Common/Types/ObjectID";
import { ProjectCanSendAnswer } from "Common/Types/ServerSending/ProjectCanSend";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { useProjectCanSend } from "Common/UI/Utils/ServerSending";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import User from "Common/UI/Utils/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * HOW TO REACH ME (#6820): how somebody is reached when they are paged.
 *
 * It opens on one ladder - "Push and SMS at once, then a call after five
 * minutes" - for every kind of page and every severity, drawn as numbered
 * steps (#8139). That is what most people mean, and it is what the product
 * already makes: a verified method starts with a rule in every card, at
 * once. The per-severity grid (the tabs and cards of OnCallRulesTabs) is
 * one click away, the "Different for Some Severities" button beside the
 * ladder's title, and opens by itself only for a link to one kind's rules
 * (?type=alerts) - the setup checklist, a readiness card, a reminder email
 * - which is about that kind.
 *
 * Somebody whose cards differ opens on the steps too, with the cards that
 * differ listed under them (#8890). The page used to open on the grid for
 * them, with the steps behind "Use One Ladder for Everything", which read
 * as a reset: once one severity differed, the steps looked gone for good.
 * Saving the steps now leaves the cards that differ as they are, and
 * giving them the ladder too is a button of its own.
 *
 * The ladder is not stored: it is read from the grid's rows and saved as
 * them (Common/Types/NotificationRule/PagingLadder, PagingLadderService).
 *
 * Both places draw this: your own page in User Settings, and a member's
 * under Users > (a member) > On-Call, with their masked methods.
 */

export enum HowToReachMeView {
  Ladder = "ladder",
  Grid = "grid",
}

export interface ComponentProps {
  // Whose rules: the signed-in user when left out.
  userId?: ObjectID | undefined;
  // The person, given only when that is not the viewer.
  person?: OnCallRulesPerson | undefined;
  // For somebody else's rules: their methods, masked by readiness.
  notificationMethods?: Array<NotificationMethodChoice> | undefined;
  isEditable?: boolean | undefined;
  userPreferencesKeyPrefix: string;
  noItemsMessage?: string | undefined;
}

// The methods that are verified by a code the page can ask for.
const VERIFY_CHANNEL_BY_COLUMN: Partial<
  Record<PagingMethodColumn, VerificationCodeChannel>
> = {
  userEmailId: VerificationCodeChannel.Email,
  userSmsId: VerificationCodeChannel.SMS,
  userCallId: VerificationCodeChannel.Call,
  userWhatsAppId: VerificationCodeChannel.WhatsApp,
};

// Whether an address asks for the grid: it names a tab, known or not.
export const isGridRequested: (
  typeParam: string | null | undefined,
) => boolean = (typeParam: string | null | undefined): boolean => {
  return (
    Boolean(readOnCallRuleKind(typeParam)) ||
    (typeof typeParam === "string" && typeParam.trim().length > 0)
  );
};

/*
 * The view a page opens on: the grid for a link to one kind's rules, and
 * the steps otherwise - for rules that differ too, which the steps list
 * (#8890).
 */
export const getInitialView: (data: {
  requestsKind: boolean;
}) => HowToReachMeView = (data: {
  requestsKind: boolean;
}): HowToReachMeView => {
  if (data.requestsKind) {
    return HowToReachMeView.Grid;
  }

  return HowToReachMeView.Ladder;
};

const HowToReachMe: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isPushTurnedOff: boolean = usePushNotificationsTurnedOff() === true;
  /*
   * Whether this server can send email, SMS and calls right now, as
   * Notification Methods reads it (#9446): a step of a channel it can't is
   * marked. Not known yet, or yes, and nothing is.
   */
  const projectCanSend: ProjectCanSendAnswer | null = useProjectCanSend();
  const channelsNotSentNow: Array<OnCallPageChannel> =
    getChannelsNotSentNow(projectCanSend);

  const targetUserId: ObjectID | null = props.userId || User.getUserId();
  const isOwn: boolean =
    !props.userId || props.userId.toString() === User.getUserId()?.toString();
  const isEditable: boolean = props.isEditable ?? true;
  const memberName: string | undefined = props.person
    ? props.person.firstName
    : undefined;

  /*
   * A link that names a tab (?type=alerts) is about that kind's cards, so it
   * opens the grid - one naming a kind this build does not know too, which
   * opens the grid's first tab, as such a link always did.
   */
  const requestsKind: boolean = isGridRequested(
    Navigation.getQueryStringByName(ON_CALL_RULE_KIND_QUERY_PARAM),
  );

  const [data, setData] = useState<PagingLadderData | null>(null);
  const [ownMethods, setOwnMethods] = useState<Array<PagingMethodChoice>>([]);
  const [error, setError] = useState<string>("");
  const [view, setView] = useState<HowToReachMeView | null>(
    requestsKind ? HowToReachMeView.Grid : null,
  );
  const [verifying, setVerifying] = useState<PagingMethodChoice | null>(null);

  const methods: Array<PagingMethodChoice> = isOwn
    ? ownMethods
    : getMemberMethodChoices(props.notificationMethods || []);

  /*
   * Reads the rules again. What is on screen stays while it does: only a
   * first read, with nothing to show yet, draws the loader.
   */
  const load: () => Promise<void> = async (): Promise<void> => {
    if (!targetUserId) {
      return;
    }

    setError("");

    try {
      const [ladderData, loadedMethods]: [
        PagingLadderData,
        Array<PagingMethodChoice>,
      ] = await Promise.all([
        loadPagingLadderData(targetUserId),
        isOwn ? loadOwnPagingMethods(targetUserId) : Promise.resolve([]),
      ]);

      setData(ladderData);
      setOwnMethods(loadedMethods);

      setView((current: HowToReachMeView | null) => {
        return current || getInitialView({ requestsKind: requestsKind });
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  useEffect(() => {
    load().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [targetUserId?.toString()]);

  const reading: PagingLadderReading | null = data
    ? readPagingLadder(data)
    : null;
  const differences: Array<PagingLadderDifference> = reading?.differences || [];

  /*
   * The project's default ladder as these steps (#9445): offered beside the
   * title while the steps are not what it gives, mapped to the verified
   * methods the way Readiness's Apply Default Ladder maps it.
   */
  const defaultStart: PagingLadderFromDefault | null =
    data && reading
      ? getPagingLadderDefaultStart({
          defaultSteps: data.defaultSteps || [],
          methods: methods
            .filter((choice: PagingMethodChoice): boolean => {
              return choice.isVerified;
            })
            .map((choice: PagingMethodChoice): PagingLadderMethodReference => {
              return {
                methodColumn: choice.methodColumn,
                methodId: choice.methodId,
              };
            }),
          currentSteps: reading.steps,
        })
      : null;

  const loadFailure: ReactElement | null =
    error && !data ? (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          load().catch(() => {
            // load() reports its own failure.
          });
        }}
      />
    ) : null;

  /*
   * The ladder waits for the rules. A link to one kind's tab opens the
   * grid at once instead, and the ladder above it follows.
   */
  if (view !== HowToReachMeView.Grid) {
    if (loadFailure) {
      return loadFailure;
    }

    if (!data || !reading) {
      return <PageSkeleton />;
    }
  }

  const title: string = memberName
    ? translator.translateTemplate(PAGING_LADDER_COPY.memberTitle, {
        name: memberName,
      })
    : translator.translateTemplate(PAGING_LADDER_COPY.ownTitle);

  const description: string = memberName
    ? translator.translateTemplate(PAGING_LADDER_COPY.memberDescription, {
        name: memberName,
      })
    : translator.translateTemplate(PAGING_LADDER_COPY.ownDescription);

  const differingCellKeys: Set<string> = new Set<string>(
    differences.map((difference: PagingLadderDifference): string => {
      return getPagingLadderCellKey(difference.cell);
    }),
  );

  const openView: (next: HowToReachMeView) => void = (
    next: HowToReachMeView,
  ): void => {
    if (next === HowToReachMeView.Grid) {
      ProductEvents.send(ProductEventName.PagingLadderGridOpened, {
        is_own: isOwn,
        differing_card_count: differences.length,
      });
    } else {
      // The tab in the address is the grid's; the ladder has none.
      Navigation.setQueryString({ [ON_CALL_RULE_KIND_QUERY_PARAM]: null });
    }

    setView(next);
  };

  const save: (
    steps: Array<PagingLadderStep>,
    keepDifferences: boolean,
  ) => Promise<void> = async (
    steps: Array<PagingLadderStep>,
    keepDifferences: boolean,
  ): Promise<void> => {
    await savePagingLadder({
      userId: isOwn ? undefined : props.userId,
      steps: steps,
      keepCards: keepDifferences
        ? differences.map((difference: PagingLadderDifference) => {
            return difference.cell;
          })
        : undefined,
    });

    ProductEvents.send(ProductEventName.PagingLadderSaved, {
      is_own: isOwn,
      step_count: steps.length,
      replaced_card_count: keepDifferences ? 0 : differences.length,
    });

    await load();
  };

  const notVerified: Array<PagingMethodChoice> = isOwn
    ? methods.filter((choice: PagingMethodChoice): boolean => {
        return (
          !choice.isVerified &&
          Boolean(VERIFY_CHANNEL_BY_COLUMN[choice.methodColumn])
        );
      })
    : [];

  const methodsPage: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] as Route,
  );

  const hasVerifiedMethod: boolean = methods.some(
    (choice: PagingMethodChoice): boolean => {
      return choice.isVerified;
    },
  );

  /*
   * Under the steps: a method waiting for its code, which cannot be a step
   * until it is verified, and why nothing can be added yet. Setting up
   * another method is the last item of every Add menu; with nothing
   * verified there is no menu, so it is a link here.
   */
  const footer: ReactElement = (
    <div className="flex flex-col gap-3" data-testid="paging-ladder-footer">
      {!hasVerifiedMethod ? (
        <div className="flex flex-col items-start gap-1.5">
          <p
            className="text-sm text-gray-600"
            data-testid="paging-ladder-no-methods"
          >
            {memberName
              ? translator.translateTemplate(
                  PAGING_LADDER_COPY.memberNoMethods,
                  {
                    name: memberName,
                  },
                )
              : translator.translateText(PAGING_LADDER_COPY.ownNoMethods)}
          </p>
          {isOwn ? (
            <Link
              to={methodsPage}
              className="inline-flex w-fit items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              {translator.translateText(PAGING_LADDER_COPY.setUpMoreMethods)}
            </Link>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      {notVerified.length > 0 ? (
        <div
          className="max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
          data-testid="paging-ladder-not-verified"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            {translator.translateText(PAGING_LADDER_COPY.notVerifiedTitle)}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {notVerified.map((choice: PagingMethodChoice) => {
              return (
                <li
                  key={`${choice.methodColumn}:${choice.methodId}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                >
                  <MethodLabel choice={choice} />
                  <Button
                    title={PAGING_LADDER_COPY.verify}
                    buttonStyle={ButtonStyleType.LINK}
                    buttonSize={ButtonSize.ExtraSmall}
                    dataTestId="paging-ladder-verify"
                    onClick={() => {
                      setVerifying(choice);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <></>
      )}
      {isOwn ? (
        /*
         * A phone, this browser or the app, added without leaving the page
         * (#7451), and the project's ask for a phone method (#7449). Each
         * reads the ladder again, keeping what is on screen.
         */
        <AddWaysToReach
          methods={methods}
          isPushTurnedOff={isPushTurnedOff}
          isPhoneMethodRequired={data?.isPhoneMethodRequired === true}
          canSendSms={projectCanSend ? projectCanSend.sms : null}
          onAdded={() => {
            load().catch(() => {
              // load() reports its own failure.
            });
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );

  const verifyModal: ReactElement =
    verifying && VERIFY_CHANNEL_BY_COLUMN[verifying.methodColumn] ? (
      <VerificationCodeModal
        channel={VERIFY_CHANNEL_BY_COLUMN[verifying.methodColumn]!}
        itemId={verifying.methodId}
        destination={verifying.identifier}
        onClose={() => {
          setVerifying(null);
        }}
        onVerified={() => {
          setVerifying(null);
          // Verifying adds the method to every card at once, as it always has.
          load().catch(() => {
            // load() reports its own failure.
          });
        }}
      />
    ) : (
      <></>
    );

  const testPage: ReactElement = isOwn ? (
    <TestPageCard dataTestId="on-call-rules-test-page-card" />
  ) : (
    <></>
  );

  if (view === HowToReachMeView.Grid) {
    return (
      <Fragment>
        <div data-testid="how-to-reach-me" data-view="grid">
          <Card
            title={title}
            description={
              !reading
                ? undefined
                : reading.isOneLadder
                  ? memberName
                    ? translator.translateTemplate(
                        PAGING_LADDER_COPY.memberGridSame,
                        { name: memberName },
                      )
                    : translator.translateText(PAGING_LADDER_COPY.ownGridSame)
                  : translator.translatePlural(
                      CARDS_DIFFER,
                      reading.differences.length,
                    )
            }
            buttons={[
              {
                title: PAGING_LADDER_COPY.backToLadder,
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.List,
                onClick: () => {
                  openView(HowToReachMeView.Ladder);
                },
              },
            ]}
          >
            {!reading ? (
              loadFailure || <CardListSkeleton count={3} lines={1} />
            ) : (
              <div
                className="flex flex-col gap-3"
                data-testid="paging-ladder-summary"
              >
                {/* Said once for the page, as on the steps (#9446). */}
                <StepsNotSentNowNotice
                  channels={getChannelsNotSentNowInSteps(
                    [
                      ...reading.steps,
                      ...reading.differences.flatMap(
                        (
                          difference: PagingLadderDifference,
                        ): Array<PagingLadderStep> => {
                          return difference.extra;
                        },
                      ),
                    ],
                    channelsNotSentNow,
                  )}
                />
                {reading.steps.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {reading.steps.map((step: PagingLadderStep) => {
                      return (
                        <StepChip
                          key={getPagingLadderStepKey(step)}
                          step={step}
                          methods={methods}
                          channelsNotSentNow={channelsNotSentNow}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <></>
                )}
                {reading.differences.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {translator.translateText(PAGING_LADDER_COPY.gridIntro)}
                    </p>
                    <DifferencesList
                      differences={reading.differences}
                      methods={methods}
                      severityColors={data?.severityColors || {}}
                      channelsNotSentNow={channelsNotSentNow}
                    />
                  </div>
                ) : (
                  <></>
                )}
              </div>
            )}
          </Card>
          <OnCallRulesTabs
            userId={props.userId}
            person={props.person}
            notificationMethods={props.notificationMethods}
            isEditable={props.isEditable}
            userPreferencesKeyPrefix={props.userPreferencesKeyPrefix}
            noItemsMessage={props.noItemsMessage}
            differingCellKeys={differingCellKeys}
            onRulesChanged={() => {
              load().catch(() => {
                // load() reports its own failure.
              });
            }}
          />
        </div>
        {testPage}
        {verifyModal}
      </Fragment>
    );
  }

  return (
    <Fragment>
      <div data-testid="how-to-reach-me" data-view="ladder">
        <PagingLadderEditor
          title={title}
          description={description}
          savedSteps={reading!.steps}
          methods={methods}
          isEditable={isEditable}
          isPushTurnedOff={isPushTurnedOff}
          differences={differences}
          severityColors={data!.severityColors}
          memberName={memberName}
          onOpenGrid={() => {
            openView(HowToReachMeView.Grid);
          }}
          setUpMoreMethodsRoute={isOwn && isEditable ? methodsPage : undefined}
          onSave={save}
          defaultStart={defaultStart}
          onStartFromDefault={(start: PagingLadderFromDefault) => {
            ProductEvents.send(
              ProductEventName.PagingLadderStartedFromDefault,
              {
                is_own: isOwn,
                step_count: start.steps.length,
                left_out_count: start.leftOutChannels.length,
              },
            );
          }}
          channelsNotSentNow={channelsNotSentNow}
          footer={
            isEditable ? (
              footer
            ) : (
              <p
                className="text-sm text-gray-500"
                data-testid="paging-ladder-read-only"
              >
                {translator.translateText(PAGING_LADDER_COPY.readOnlyNote)}
              </p>
            )
          }
        />
      </div>
      {testPage}
      {verifyModal}
    </Fragment>
  );
};

export default HowToReachMe;
