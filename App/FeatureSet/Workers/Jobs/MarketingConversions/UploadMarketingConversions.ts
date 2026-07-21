import RunCron from "../../Utils/Cron";
import { EVERY_HOUR, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  getAllEnvVars,
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import MarketingConversionService from "Common/Server/Services/MarketingConversionService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionUploadBatchResult,
} from "Common/Server/Utils/Marketing/ConversionUploadProvider";
import AllConversionUploadProviders from "Common/Server/Utils/Marketing/ConversionUploadProviders";
import logger from "Common/Server/Utils/Logger";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import {
  MarketingConversionType,
  MarketingConversionUploadStatus,
} from "Common/Types/Marketing/MarketingConversion";
import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";

// Google/Microsoft/LinkedIn accept conversions up to 90 days after the click.
const SIGNUP_DISCOVERY_WINDOW_IN_DAYS: number = 90;
const PAID_DISCOVERY_WINDOW_IN_DAYS: number = 180;
// Rows older than this cannot be uploaded anywhere anymore — stop scanning them.
const PENDING_SCAN_WINDOW_IN_DAYS: number = 100;
const UPLOAD_BATCH_SIZE: number = 500;
const MAX_UPLOAD_ATTEMPTS: number = 5;

type GetDateDaysAgoFunction = (days: number) => Date;
const getDateDaysAgo: GetDateDaysAgoFunction = (days: number): Date => {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
};

interface ProviderUploadState {
  status?: string;
  attempts?: number;
  error?: string;
  uploadedAt?: string;
}

type GetProviderStateFunction = (
  conversion: MarketingConversion,
  providerKey: string,
) => ProviderUploadState;

const getProviderState: GetProviderStateFunction = (
  conversion: MarketingConversion,
  providerKey: string,
): ProviderUploadState => {
  const uploadState: JSONObject = conversion.uploadState || {};
  return (uploadState[providerKey] as ProviderUploadState) || {};
};

type SetProviderStateFunction = (data: {
  conversion: MarketingConversion;
  providerKey: string;
  state: ProviderUploadState;
}) => Promise<void>;

/*
 * Read-modify-write of the uploadState JSON, merging over the row's CURRENT
 * persisted state rather than the copy loaded at scan time. A stalled job
 * can be re-dispatched while the original run is still in flight, so this
 * job cannot assume it is the only writer; re-reading keeps one provider's
 * write from clobbering another's.
 */
const setProviderState: SetProviderStateFunction = async (data: {
  conversion: MarketingConversion;
  providerKey: string;
  state: ProviderUploadState;
}): Promise<void> => {
  const current: MarketingConversion | null =
    await MarketingConversionService.findOneById({
      id: data.conversion.id!,
      select: {
        uploadState: true,
      },
      props: {
        isRoot: true,
      },
    });

  const uploadState: JSONObject = {
    ...(current?.uploadState || data.conversion.uploadState || {}),
    [data.providerKey]: data.state as unknown as JSONObject,
  };

  // Keep the in-memory copy in sync for subsequent providers in this run.
  data.conversion.uploadState = uploadState;

  await MarketingConversionService.updateOneById({
    id: data.conversion.id!,
    data: {
      uploadState: uploadState,
    } as any,
    props: {
      isRoot: true,
    },
  });
};

type DiscoverSignUpConversionsFunction = () => Promise<void>;

/*
 * Users who signed up carrying ad click IDs become SignUp conversion rows.
 * conversionAt is the accurate signup time (user.createdAt). The unique
 * index on (conversionType, userId) makes discovery idempotent.
 */
const discoverSignUpConversions: DiscoverSignUpConversionsFunction =
  async (): Promise<void> => {
    let skip: number = 0;

    while (skip < 100000) {
      const users: Array<User> = await UserService.findBy({
        query: {
          clickIds: QueryHelper.notNull(),
          createdAt: QueryHelper.greaterThanEqualTo(
            getDateDaysAgo(SIGNUP_DISCOVERY_WINDOW_IN_DAYS),
          ),
        },
        select: {
          _id: true,
          email: true,
          clickIds: true,
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

      const existingConversions: Array<MarketingConversion> =
        await MarketingConversionService.findBy({
          query: {
            conversionType: MarketingConversionType.SignUp,
            userId: QueryHelper.any(
              users.map((user: User) => {
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

      for (const user of users) {
        if (existingUserIds.has(user.id!.toString())) {
          continue;
        }

        const conversion: MarketingConversion = new MarketingConversion();
        conversion.conversionType = MarketingConversionType.SignUp;
        conversion.userId = user.id!;
        conversion.email = user.email?.toString() || undefined;
        conversion.clickIds = user.clickIds || {};
        conversion.conversionAt = user.createdAt || new Date();

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
            `MarketingConversions: skipping duplicate signup conversion: ${err}`,
          );
        }
      }

      if (users.length < LIMIT_MAX) {
        break;
      }

      skip += LIMIT_MAX;
    }
  };

type GetMonthlyRevenueFunction = (project: Project) => number | undefined;

// MRR in cents; undefined for custom-pricing / unknown plans.
const getMonthlyRevenueInUSDCents: GetMonthlyRevenueFunction = (
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
 * Projects with ad click IDs on an active paid subscription become
 * PaidSubscription conversion rows. Stripe status "active" excludes
 * trials ("trialing" is its own status), so this fires only once the
 * customer is actually paying. conversionAt is the detection time (at most
 * one job interval after the fact), since OneUptime does not record the
 * exact payment moment.
 */
const discoverPaidConversions: DiscoverPaidConversionsFunction =
  async (): Promise<void> => {
    const paidPlanTypes: Array<string> = Object.values(PlanType).filter(
      (planType: string) => {
        return planType !== PlanType.Free;
      },
    );

    let skip: number = 0;

    while (skip < 100000) {
      const projects: Array<Project> = await ProjectService.findBy({
        query: {
          clickIds: QueryHelper.notNull(),
          planName: QueryHelper.any(paidPlanTypes),
          paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
          createdAt: QueryHelper.greaterThanEqualTo(
            getDateDaysAgo(PAID_DISCOVERY_WINDOW_IN_DAYS),
          ),
        },
        select: {
          _id: true,
          createdOwnerEmail: true,
          clickIds: true,
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

      const existingConversions: Array<MarketingConversion> =
        await MarketingConversionService.findBy({
          query: {
            conversionType: MarketingConversionType.PaidSubscription,
            projectId: QueryHelper.any(
              projects.map((project: Project) => {
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

      for (const project of projects) {
        if (existingProjectIds.has(project.id!.toString())) {
          continue;
        }

        const conversion: MarketingConversion = new MarketingConversion();
        conversion.conversionType = MarketingConversionType.PaidSubscription;
        conversion.projectId = project.id!;
        conversion.email = project.createdOwnerEmail?.toString() || undefined;
        conversion.clickIds = project.clickIds || {};
        conversion.conversionAt = new Date();
        conversion.conversionValueInUSDCents =
          getMonthlyRevenueInUSDCents(project);

        try {
          await MarketingConversionService.create({
            data: conversion,
            props: {
              isRoot: true,
            },
          });
        } catch (err) {
          logger.debug(
            `MarketingConversions: skipping duplicate paid conversion: ${err}`,
          );
        }
      }

      if (projects.length < LIMIT_MAX) {
        break;
      }

      skip += LIMIT_MAX;
    }
  };

type UploadToProviderFunction = (
  provider: ConversionUploadProvider,
) => Promise<void>;

/*
 * Uploads all conversions still pending for this provider. Pending = no
 * status recorded yet and fewer than MAX_UPLOAD_ATTEMPTS transport
 * failures. Status filtering happens in application code (uploadState is a
 * JSON column), over a bounded scan of recent rows — anything older than
 * every platform's upload window can never be uploaded anyway.
 */
const uploadToProvider: UploadToProviderFunction = async (
  provider: ConversionUploadProvider,
): Promise<void> => {
  let skip: number = 0;
  const uploadable: Array<MarketingConversion> = [];
  const batchSize: number = Math.min(UPLOAD_BATCH_SIZE, provider.maxBatchSize);

  while (skip < 100000 && uploadable.length < batchSize) {
    const conversions: Array<MarketingConversion> =
      await MarketingConversionService.findBy({
        query: {
          createdAt: QueryHelper.greaterThanEqualTo(
            getDateDaysAgo(PENDING_SCAN_WINDOW_IN_DAYS),
          ),
        },
        select: {
          _id: true,
          conversionType: true,
          email: true,
          clickIds: true,
          conversionAt: true,
          conversionValueInUSDCents: true,
          uploadState: true,
        },
        limit: LIMIT_MAX,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

    if (conversions.length === 0) {
      break;
    }

    for (const conversion of conversions) {
      if (uploadable.length >= batchSize) {
        break;
      }

      const state: ProviderUploadState = getProviderState(
        conversion,
        provider.key,
      );

      if (state.status) {
        continue;
      }

      if ((state.attempts || 0) >= MAX_UPLOAD_ATTEMPTS) {
        continue;
      }

      const skip: ConversionSkip | null = provider.getSkipReason(conversion);

      if (skip) {
        /*
         * Permanent skips (no usable click id, outside the platform's upload
         * window) are recorded so the row is never revisited. Config-gap
         * skips are left pending — they upload once the operator adds the
         * missing configuration.
         */
        if (skip.isPermanent) {
          await setProviderState({
            conversion: conversion,
            providerKey: provider.key,
            state: {
              status: MarketingConversionUploadStatus.Skipped,
              error: skip.reason,
            },
          });
        }
        continue;
      }

      uploadable.push(conversion);
    }

    if (conversions.length < LIMIT_MAX) {
      break;
    }

    skip += LIMIT_MAX;
  }

  if (uploadable.length === 0) {
    return;
  }

  let result: ConversionUploadBatchResult;

  try {
    result = await provider.upload(uploadable);
  } catch (err) {
    /*
     * Transport/auth-level failure: bump attempts and leave status unset so
     * the next run retries, until the attempt cap marks it Failed. Only the
     * upload call is inside this try — a failure while RECORDING results
     * must not be mistaken for an upload failure, or it would overwrite the
     * statuses already persisted for this batch and re-upload them.
     */
    const message: string = ConversionUploadProvider.getErrorMessage(err);
    logger.error(
      `MarketingConversions: ${provider.displayName} upload failed: ${message}`,
    );

    for (const conversion of uploadable) {
      const attempts: number =
        (getProviderState(conversion, provider.key).attempts || 0) + 1;

      await setProviderState({
        conversion: conversion,
        providerKey: provider.key,
        state: {
          attempts: attempts,
          error: message,
          ...(attempts >= MAX_UPLOAD_ATTEMPTS
            ? { status: MarketingConversionUploadStatus.Failed }
            : {}),
        },
      }).catch((stateErr: Error) => {
        logger.error(
          `MarketingConversions: failed to record ${provider.displayName} attempt: ${stateErr}`,
        );
      });
    }

    return;
  }

  /*
   * The upload succeeded. Record each row's outcome independently so one
   * failed write does not lose the rest — rows whose write fails stay
   * pending and are retried (providers dedup retries via their own keys).
   */
  for (let i: number = 0; i < uploadable.length; i++) {
    const failureMessage: string | undefined = result.permanentFailures.get(i);

    await setProviderState({
      conversion: uploadable[i]!,
      providerKey: provider.key,
      state: failureMessage
        ? {
            // Per-conversion rejections (invalid/expired click id) are permanent.
            status: MarketingConversionUploadStatus.Failed,
            error: failureMessage,
          }
        : {
            status: MarketingConversionUploadStatus.Uploaded,
            uploadedAt: new Date().toISOString(),
          },
    }).catch((stateErr: Error) => {
      logger.error(
        `MarketingConversions: failed to record ${provider.displayName} result: ${stateErr}`,
      );
    });
  }

  logger.info(
    `MarketingConversions: uploaded ${
      uploadable.length - result.permanentFailures.size
    }/${uploadable.length} conversions to ${provider.displayName}`,
  );
};

RunCron(
  "MarketingConversions:Upload",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR,
    runOnStartup: false,
    /*
     * Discovery scans plus several providers' uploads can exceed the 5
     * minute default, and a job that overruns its timeout can be
     * re-dispatched while still running.
     */
    timeoutInMS: 30 * 60 * 1000,
  },
  async () => {
    if (!IsBillingEnabled) {
      return;
    }

    const configuredProviders: Array<ConversionUploadProvider> =
      AllConversionUploadProviders.filter(
        (provider: ConversionUploadProvider) => {
          return provider.isConfigured();
        },
      );

    // Self-hosted / unconfigured installs: do nothing, record nothing.
    if (configuredProviders.length === 0) {
      return;
    }

    await discoverSignUpConversions();
    await discoverPaidConversions();

    for (const provider of configuredProviders) {
      await uploadToProvider(provider);
    }
  },
);
