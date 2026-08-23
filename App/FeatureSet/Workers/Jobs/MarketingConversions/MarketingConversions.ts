import RunCron from "../../Utils/Cron";
import { EVERY_HOUR, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  getAllEnvVars,
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import Attribution from "Common/Server/Utils/Attribution";
import MarketingConversionService from "Common/Server/Services/MarketingConversionService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { MarketingConversionType } from "Common/Types/Marketing/MarketingConversion";
import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";

/*
 * How far back each discovery pass scans for rows it has not recorded yet.
 * Both are a bound on scan cost, not a correctness limit: a user or project
 * that first becomes attributable beyond its window is simply never recorded,
 * so widening either is safe and narrowing either loses conversions.
 */
const SIGNUP_DISCOVERY_WINDOW_IN_DAYS: number = 90;
const PAID_DISCOVERY_WINDOW_IN_DAYS: number = 180;
/*
 * How far back the chain-linking pass looks for conversions it has not linked
 * yet. Wider than the discovery windows on purpose: an enterprise cycle
 * running longer than either of them is exactly the case the chain exists to
 * describe.
 */
const CHAIN_LINK_SCAN_WINDOW_IN_DAYS: number = 400;
/*
 * Deliberately far below LIMIT_MAX. Each page of unlinked rows is followed by
 * one read of EVERY conversion belonging to the people on that page, and that
 * second read is itself capped at LIMIT_MAX — so a page big enough to name
 * more people than the follow-up can return would silently truncate the
 * candidate roots and link rows to the wrong one, permanently. One person can
 * hold at most one conversion of each type, so this bound leaves the follow-up
 * an order of magnitude of headroom.
 */
const CHAIN_LINK_PAGE_SIZE: number = 500;
// Backstop against a pathological scan; 500 pages is 250k rows in one run.
const MAX_CHAIN_LINK_PAGES: number = 500;

type GetDateDaysAgoFunction = (days: number) => Date;
const getDateDaysAgo: GetDateDaysAgoFunction = (days: number): Date => {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
};

/*
 * Which rows count as "attributed".
 *
 * QueryHelper has no OR, so each filter is run as its own paginated scan and
 * the results are de-duplicated by id. That is the whole reason this is a
 * list rather than one query.
 *
 * The second filter is the point of it. Discovery used to require
 * `clickIds notNull`, which meant a signup that arrived carrying
 * utm_campaign but no ad click id — a newsletter, a sponsorship, a conference
 * link, or any Google campaign with auto-tagging switched off — never became a
 * ledger row at all. A click id is not what makes a conversion worth
 * recording; carrying any attribution at all is, because the ledger is what
 * OneUptime reports campaigns from.
 */
const ATTRIBUTED_ROW_FILTERS: Array<JSONObject> = [
  { clickIds: QueryHelper.notNull() },
  { utmSource: QueryHelper.notNull() },
];

type CopyAttributionOntoConversionFunction = (data: {
  conversion: MarketingConversion;
  source: User | Project;
  email: string | undefined;
}) => void;

/*
 * Copy the attribution a User or Project carries onto the conversion row.
 *
 * Both models expose the same six utm* columns plus clickIds and
 * firstTouchAttribution — ProjectService copies them off the creating user at
 * project creation — so one function serves both discovery passes and they
 * cannot drift apart.
 */
const copyAttributionOntoConversion: CopyAttributionOntoConversionFunction =
  (data: {
    conversion: MarketingConversion;
    source: User | Project;
    email: string | undefined;
  }): void => {
    data.conversion.clickIds = data.source.clickIds || {};
    data.conversion.utmSource = data.source.utmSource;
    data.conversion.utmMedium = data.source.utmMedium;
    data.conversion.utmCampaign = data.source.utmCampaign;
    data.conversion.utmTerm = data.source.utmTerm;
    data.conversion.utmContent = data.source.utmContent;
    data.conversion.utmUrl = data.source.utmUrl;
    data.conversion.firstTouchAttribution = data.source.firstTouchAttribution;
    data.conversion.email = data.email;

    const emailHash: string | null = Attribution.hashEmail(data.email);

    if (emailHash) {
      data.conversion.emailHash = emailHash;
    }
  };

type CreateConversionFunction = (
  conversion: MarketingConversion,
) => Promise<void>;

const createConversion: CreateConversionFunction = async (
  conversion: MarketingConversion,
): Promise<void> => {
  try {
    await MarketingConversionService.create({
      data: conversion,
      props: {
        isRoot: true,
      },
    });
  } catch (err) {
    // Unique index race — another run already recorded it.
    logger.debug(
      `MarketingConversions: skipping duplicate ${conversion.conversionType} conversion: ${err}`,
    );
  }
};

type DiscoverSignUpConversionsFunction = () => Promise<void>;

/*
 * Users who signed up carrying any attribution become SignUp conversion rows.
 * conversionAt is the accurate signup time (user.createdAt). The unique
 * index on (conversionType, userId) makes discovery idempotent.
 */
export const discoverSignUpConversions: DiscoverSignUpConversionsFunction =
  async (): Promise<void> => {
    const seenUserIds: Set<string> = new Set<string>();

    for (const attributionFilter of ATTRIBUTED_ROW_FILTERS) {
      let skip: number = 0;

      while (skip < 100000) {
        const users: Array<User> = await UserService.findBy({
          query: {
            ...attributionFilter,
            createdAt: QueryHelper.greaterThanEqualTo(
              getDateDaysAgo(SIGNUP_DISCOVERY_WINDOW_IN_DAYS),
            ),
          } as any,
          select: {
            _id: true,
            email: true,
            clickIds: true,
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
            utmTerm: true,
            utmContent: true,
            utmUrl: true,
            firstTouchAttribution: true,
            createdAt: true,
          },
          limit: LIMIT_MAX,
          skip: skip,
          props: {
            isRoot: true,
          },
        });

        if (users.length === 0) {
          break;
        }

        /*
         * A user matching both filters is returned by both scans. The unique
         * index would absorb the second insert anyway, but skipping it here
         * keeps the log free of duplicate-key noise that means nothing.
         */
        const unseenUsers: Array<User> = users.filter((user: User) => {
          return !seenUserIds.has(user.id!.toString());
        });

        for (const user of unseenUsers) {
          seenUserIds.add(user.id!.toString());
        }

        if (unseenUsers.length > 0) {
          const existingConversions: Array<MarketingConversion> =
            await MarketingConversionService.findBy({
              query: {
                conversionType: MarketingConversionType.SignUp,
                userId: QueryHelper.any(
                  unseenUsers.map((user: User) => {
                    return user.id!;
                  }),
                ),
              },
              select: {
                userId: true,
              },
              limit: LIMIT_MAX,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          const existingUserIds: Set<string> = new Set<string>(
            existingConversions.map((conversion: MarketingConversion) => {
              return conversion.userId?.toString() || "";
            }),
          );

          for (const user of unseenUsers) {
            if (existingUserIds.has(user.id!.toString())) {
              continue;
            }

            const conversion: MarketingConversion = new MarketingConversion();
            conversion.conversionType = MarketingConversionType.SignUp;
            conversion.userId = user.id!;
            conversion.conversionAt = user.createdAt || new Date();

            copyAttributionOntoConversion({
              conversion: conversion,
              source: user,
              email: user.email?.toString() || undefined,
            });

            await createConversion(conversion);
          }
        }

        if (users.length < LIMIT_MAX) {
          break;
        }

        skip += LIMIT_MAX;
      }
    }
  };

type GetMonthlyRevenueFunction = (project: Project) => number | undefined;

// MRR in cents; undefined for custom-pricing / unknown plans.
export const getMonthlyRevenueInUSDCents: GetMonthlyRevenueFunction = (
  project: Project,
): number | undefined => {
  if (!project.paymentProviderPlanId) {
    return undefined;
  }

  const plan: SubscriptionPlan | undefined =
    SubscriptionPlan.getSubscriptionPlanById(
      project.paymentProviderPlanId,
      getAllEnvVars(),
    );

  if (!plan || plan.isCustomPricing()) {
    return undefined;
  }

  const monthlyAmountInUSD: number =
    plan.getYearlyPlanId() === project.paymentProviderPlanId
      ? plan.getYearlySubscriptionAmountInUSD()
      : plan.getMonthlySubscriptionAmountInUSD();

  const seats: number = project.paymentProviderSubscriptionSeats || 1;

  return Math.round(monthlyAmountInUSD * seats * 100);
};

type DiscoverPaidConversionsFunction = () => Promise<void>;

/*
 * Projects with any attribution on an active paid subscription become
 * PaidSubscription conversion rows. Stripe status "active" excludes
 * trials ("trialing" is its own status), so this fires only once the
 * customer is actually paying. conversionAt is the detection time (at most
 * one job interval after the fact), since OneUptime does not record the
 * exact payment moment.
 */
export const discoverPaidConversions: DiscoverPaidConversionsFunction =
  async (): Promise<void> => {
    const paidPlanTypes: Array<string> = Object.values(PlanType).filter(
      (planType: string) => {
        return planType !== PlanType.Free;
      },
    );

    const seenProjectIds: Set<string> = new Set<string>();

    for (const attributionFilter of ATTRIBUTED_ROW_FILTERS) {
      let skip: number = 0;

      while (skip < 100000) {
        const projects: Array<Project> = await ProjectService.findBy({
          query: {
            ...attributionFilter,
            planName: QueryHelper.any(paidPlanTypes),
            paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
            createdAt: QueryHelper.greaterThanEqualTo(
              getDateDaysAgo(PAID_DISCOVERY_WINDOW_IN_DAYS),
            ),
          } as any,
          select: {
            _id: true,
            createdOwnerEmail: true,
            clickIds: true,
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
            utmTerm: true,
            utmContent: true,
            utmUrl: true,
            firstTouchAttribution: true,
            paymentProviderPlanId: true,
            paymentProviderSubscriptionSeats: true,
          },
          limit: LIMIT_MAX,
          skip: skip,
          props: {
            isRoot: true,
          },
        });

        if (projects.length === 0) {
          break;
        }

        const unseenProjects: Array<Project> = projects.filter(
          (project: Project) => {
            return !seenProjectIds.has(project.id!.toString());
          },
        );

        for (const project of unseenProjects) {
          seenProjectIds.add(project.id!.toString());
        }

        if (unseenProjects.length > 0) {
          const existingConversions: Array<MarketingConversion> =
            await MarketingConversionService.findBy({
              query: {
                conversionType: MarketingConversionType.PaidSubscription,
                projectId: QueryHelper.any(
                  unseenProjects.map((project: Project) => {
                    return project.id!;
                  }),
                ),
              },
              select: {
                projectId: true,
              },
              limit: LIMIT_MAX,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          const existingProjectIds: Set<string> = new Set<string>(
            existingConversions.map((conversion: MarketingConversion) => {
              return conversion.projectId?.toString() || "";
            }),
          );

          for (const project of unseenProjects) {
            if (existingProjectIds.has(project.id!.toString())) {
              continue;
            }

            const conversion: MarketingConversion = new MarketingConversion();
            conversion.conversionType =
              MarketingConversionType.PaidSubscription;
            conversion.projectId = project.id!;
            conversion.conversionAt = new Date();
            conversion.conversionValueInUSDCents =
              getMonthlyRevenueInUSDCents(project);

            copyAttributionOntoConversion({
              conversion: conversion,
              source: project,
              email: project.createdOwnerEmail?.toString() || undefined,
            });

            await createConversion(conversion);
          }
        }

        if (projects.length < LIMIT_MAX) {
          break;
        }

        skip += LIMIT_MAX;
      }
    }
  };

type GetEffectiveConversionTimeFunction = (
  conversion: MarketingConversion,
) => number;

/*
 * When this conversion happened, for the purpose of ordering a person's
 * conversions against each other.
 *
 * Not simply conversionAt, because one writer's conversionAt is in the future:
 * a Cal booking is stamped with the meeting's startTime, which can be weeks
 * after the person asked for it. Someone who books a demo on Monday and signs
 * up on Tuesday, for a meeting on Friday, would otherwise look like they
 * signed up first. Clamping to createdAt — when OneUptime learned of the
 * conversion — fixes exactly that case and changes nothing for the others,
 * whose conversionAt is always at or before their row.
 */
const getEffectiveConversionTime: GetEffectiveConversionTimeFunction = (
  conversion: MarketingConversion,
): number => {
  const conversionAt: number = (
    conversion.conversionAt || new Date()
  ).getTime();

  if (!conversion.createdAt) {
    return conversionAt;
  }

  return Math.min(conversionAt, conversion.createdAt.getTime());
};

type LinkConversionChainsFunction = () => Promise<void>;

/*
 * Join every conversion to the first conversion the same person made.
 *
 * WHY THIS EXISTS
 *
 * The three conversion types are written by unrelated code paths that each see
 * one moment. A booked meeting has no user, a signup has no booking, and a
 * paid subscription knows only the project. Nothing in the ledger said that a
 * demo in June, a signup in July and a subscription in October were one
 * customer — so "revenue this demo campaign produced", the number that decides
 * whether sales-led ad spend is working, could not be computed at all.
 *
 * The join key is emailHash, which is the only identifier that survives the
 * gaps: a different device, a cleared browser, and the months in between.
 *
 * WHAT IT POINTS AT
 *
 * The EARLIEST conversion by that person, not the immediately preceding one.
 * Every row in a chain therefore points at the same root, which makes
 * attributing a chain a group-by rather than a recursive walk.
 *
 * Written once and never revised: a row that already has a link is left alone.
 * That keeps the pass idempotent and means a late-arriving row cannot silently
 * re-parent history that has already been reported.
 */
export const linkConversionChains: LinkConversionChainsFunction =
  async (): Promise<void> => {
    let skip: number = 0;
    let pagesScanned: number = 0;

    while (pagesScanned < MAX_CHAIN_LINK_PAGES) {
      pagesScanned++;

      const unlinked: Array<MarketingConversion> =
        await MarketingConversionService.findBy({
          query: {
            emailHash: QueryHelper.notNull(),
            attributedToConversionId: QueryHelper.isNull(),
            createdAt: QueryHelper.greaterThanEqualTo(
              getDateDaysAgo(CHAIN_LINK_SCAN_WINDOW_IN_DAYS),
            ),
          },
          select: {
            _id: true,
            emailHash: true,
            conversionAt: true,
            createdAt: true,
          },
          /*
           * A stable order, because the offset below only means anything
           * against one. Ascending, so the oldest unlinked rows — the ones
           * most likely to be a chain root somebody else is waiting on — are
           * resolved first.
           */
          sort: {
            createdAt: SortOrder.Ascending,
          },
          limit: CHAIN_LINK_PAGE_SIZE,
          skip: skip,
          props: {
            isRoot: true,
          },
        });

      if (unlinked.length === 0) {
        break;
      }

      const emailHashes: Array<string> = Array.from(
        new Set<string>(
          unlinked.map((conversion: MarketingConversion) => {
            return conversion.emailHash!;
          }),
        ),
      );

      /*
       * Every conversion by any of these people, in one indexed read — the
       * candidate roots are usually older than the scan window, so they cannot
       * be found by narrowing the scan instead.
       */
      const related: Array<MarketingConversion> =
        await MarketingConversionService.findBy({
          query: {
            emailHash: QueryHelper.any(emailHashes),
          },
          select: {
            _id: true,
            emailHash: true,
            conversionAt: true,
            createdAt: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      const earliestByEmailHash: Map<string, MarketingConversion> = new Map<
        string,
        MarketingConversion
      >();

      for (const conversion of related) {
        const emailHash: string = conversion.emailHash!;
        const current: MarketingConversion | undefined =
          earliestByEmailHash.get(emailHash);

        if (
          !current ||
          getEffectiveConversionTime(conversion) <
            getEffectiveConversionTime(current)
        ) {
          earliestByEmailHash.set(emailHash, conversion);
        }
      }

      let linkedCount: number = 0;

      for (const conversion of unlinked) {
        const root: MarketingConversion | undefined = earliestByEmailHash.get(
          conversion.emailHash!,
        );

        /*
         * A conversion that IS the root has nothing to point at. Leaving the
         * column null rather than self-referencing is what makes "the roots"
         * a query instead of a comparison.
         */
        if (!root || root.id!.toString() === conversion.id!.toString()) {
          continue;
        }

        try {
          await MarketingConversionService.updateOneById({
            id: conversion.id!,
            data: {
              attributedToConversionId: root.id! as ObjectID,
            } as any,
            props: {
              isRoot: true,
            },
          });

          linkedCount++;
        } catch (err) {
          logger.error(
            `MarketingConversions: failed to link conversion ${conversion.id?.toString()}: ${err}`,
          );
        }
      }

      if (linkedCount > 0) {
        logger.info(
          `MarketingConversions: linked ${linkedCount} conversions to an earlier conversion by the same person`,
        );
      }

      /*
       * Rows just linked no longer match the query, so they have already
       * dropped out of the result set the next page is taken from — the same
       * offset now shows rows that were previously beyond it. Only the ones
       * that STAYED (chain roots, which never get a link) need to be stepped
       * over, or they would be re-read forever.
       */
      if (linkedCount === 0) {
        skip += unlinked.length;

        // A short page that linked nothing is the end of the scan.
        if (unlinked.length < CHAIN_LINK_PAGE_SIZE) {
          break;
        }
      }
    }
  };

RunCron(
  "MarketingConversions:Discover",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR,
    runOnStartup: false,
    /*
     * The discovery scans can exceed the 5 minute default, and a job that
     * overruns its timeout can be re-dispatched while still running.
     */
    timeoutInMS: 30 * 60 * 1000,
  },
  async () => {
    /*
     * Paid conversions are a billing concept and the ledger exists to report
     * on OneUptime's own paid acquisition, so a self-hosted install records
     * nothing. Bookings are the exception: the Cal webhook writes those
     * directly and does not depend on this job.
     */
    if (!IsBillingEnabled) {
      return;
    }

    await discoverSignUpConversions();
    await discoverPaidConversions();

    /*
     * After discovery, so a signup found in this same run can be joined to the
     * meeting that preceded it without waiting an hour.
     */
    await linkConversionChains();
  },
);
