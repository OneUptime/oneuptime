import { NotificationMethodChoice } from "./OnCallRulesTable";
import OnCallRulesTabs, { OnCallRulesPerson } from "./OnCallRulesTabs";
import {
  PagingLadderData,
  loadOwnPagingMethods,
  loadPagingLadderData,
  savePagingLadder,
} from "./PagingLadder/PagingLadderApi";
import PagingLadderEditor from "./PagingLadder/PagingLadderEditor";
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
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProductEvents from "Common/UI/Utils/ProductEvents";
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
 * minutes" - for every kind of page and every severity. That is what most
 * people mean, and it is what the product already makes: a verified method
 * starts with a rule in every card, at once. The per-severity grid (the
 * tabs and cards of OnCallRulesTabs) is one click away, "Different for
 * Some Severities", and opens by itself:
 *
 *   - for somebody whose rules already differ between cards, with the
 *     differences named and an offer to use one ladder;
 *   - for a link to one kind's rules (?type=alerts) - the setup checklist,
 *     a readiness card, a reminder email - which is about that kind.
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

// The view a page opens on: the grid for a link to one kind's rules, or for rules that differ.
export const getInitialView: (data: {
  requestsKind: boolean;
  reading: PagingLadderReading;
}) => HowToReachMeView = (data: {
  requestsKind: boolean;
  reading: PagingLadderReading;
}): HowToReachMeView => {
  if (data.requestsKind || !data.reading.isOneLadder) {
    return HowToReachMeView.Grid;
  }

  return HowToReachMeView.Ladder;
};

const HowToReachMe: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isPushTurnedOff: boolean = usePushNotificationsTurnedOff() === true;

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
        return (
          current ||
          getInitialView({
            requestsKind: requestsKind,
            reading: readPagingLadder(ladderData),
          })
        );
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
      return <PageLoader isVisible={true} />;
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

  const save: (steps: Array<PagingLadderStep>) => Promise<void> = async (
    steps: Array<PagingLadderStep>,
  ): Promise<void> => {
    await savePagingLadder({
      userId: isOwn ? undefined : props.userId,
      steps: steps,
    });

    ProductEvents.send(ProductEventName.PagingLadderSaved, {
      is_own: isOwn,
      step_count: steps.length,
      replaced_card_count: differences.length,
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

  // Under the steps: what is waiting for its code, and where to add more.
  const footer: ReactElement = (
    <div className="flex flex-col gap-3" data-testid="paging-ladder-footer">
      {!hasVerifiedMethod ? (
        <p
          className="text-sm text-gray-600"
          data-testid="paging-ladder-no-methods"
        >
          {memberName
            ? translator.translateTemplate(PAGING_LADDER_COPY.memberNoMethods, {
                name: memberName,
              })
            : translator.translateText(PAGING_LADDER_COPY.ownNoMethods)}
        </p>
      ) : (
        <></>
      )}
      {notVerified.length > 0 ? (
        <div data-testid="paging-ladder-not-verified">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {translator.translateText(PAGING_LADDER_COPY.notVerifiedTitle)}
          </p>
          <ul className="mt-1 flex flex-col gap-1.5">
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
                title: reading?.isOneLadder
                  ? PAGING_LADDER_COPY.backToLadder
                  : PAGING_LADDER_COPY.useOneLadder,
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.List,
                onClick: () => {
                  openView(HowToReachMeView.Ladder);
                },
              },
            ]}
          >
            {!reading ? (
              loadFailure || <PageLoader isVisible={true} />
            ) : (
              <div
                className="flex flex-col gap-3"
                data-testid="paging-ladder-summary"
              >
                {reading.steps.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {reading.steps.map((step: PagingLadderStep) => {
                      return (
                        <StepChip
                          key={getPagingLadderStepKey(step)}
                          step={step}
                          methods={methods}
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
          headerButtons={[
            {
              title: PAGING_LADDER_COPY.differentForSome,
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.TableCells,
              onClick: () => {
                openView(HowToReachMeView.Grid);
              },
            },
          ]}
          onSave={save}
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
