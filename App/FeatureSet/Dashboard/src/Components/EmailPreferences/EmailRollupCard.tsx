import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationEmailRollupSetting from "Common/Models/DatabaseModels/UserNotificationEmailRollupSetting";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * THE ESCAPE HATCH FROM OWNER-EMAIL BURST ROLLUP, for one person in one
 * project.
 *
 * Rollup is on for everybody and no row exists in its table until somebody
 * turns it off here, so this card is the only place in the product where a
 * human can learn that their owner emails may be batched at all, and the only
 * place they can say no. It is not a per-event choice - it changes how every
 * event a person is subscribed to is delivered - which is why it lives on
 * Email Preferences next to the routine-email switch rather than among the
 * per-event rows on Notification Settings.
 *
 * That separation costs a navigation, and the cost is real: a reader who only
 * ever opens Notification Settings would otherwise conclude the per-event
 * rows are the whole story. Notification Settings therefore carries a
 * permanent pointer at this page, and rollup digests link here directly.
 */
type RollupEnabledResolver = (
  setting: UserNotificationEmailRollupSetting | null,
) => boolean;

/*
 * NO ROW MEANS ENABLED. Rollup shipped on with no backfill, so almost nobody
 * has a row here, and reading "no row" as off would show the overwhelming
 * majority of users a switch that disagrees with the mail they actually
 * receive. Only an explicit false is an opt-out - the same reading
 * UserNotificationEmailRollupSettingService.isRollupEnabledForUser does on the
 * server. The two have to agree or this card lies about live behaviour.
 */
const resolveRollupEnabled: RollupEnabledResolver = (
  setting: UserNotificationEmailRollupSetting | null,
): boolean => {
  return setting?.isEnabled !== false;
};

const EmailRollupCard: FunctionComponent = (): ReactElement => {
  const [setting, setSetting] =
    useState<UserNotificationEmailRollupSetting | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const fetchSetting: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsLoading(true);
      try {
        const result: ListResult<UserNotificationEmailRollupSetting> =
          await ModelAPI.getList<UserNotificationEmailRollupSetting>({
            modelType: UserNotificationEmailRollupSetting,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              userId: User.getUserId(),
            },
            /*
             * The service refuses a second row for the same (user, project),
             * so one row is all there can be.
             */
            limit: 1,
            skip: 0,
            select: {
              _id: true,
              isEnabled: true,
            },
            sort: {},
          });

        setSetting(result.data[0] || null);
        setError("");
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    }, []);

  useEffect(() => {
    fetchSetting().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [fetchSetting]);

  const isEnabled: boolean = resolveRollupEnabled(setting);

  const persistRollupEnabled: (next: boolean) => Promise<void> = async (
    next: boolean,
  ): Promise<void> => {
    const previous: UserNotificationEmailRollupSetting | null = setting;

    /*
     * Optimistic, like the per-event matrix on Notification Settings: the
     * switch has to move under the finger that pressed it, and the round trip
     * is undone in the catch below if the write never lands.
     */
    const optimistic: UserNotificationEmailRollupSetting =
      new UserNotificationEmailRollupSetting();
    if (previous && previous._id) {
      optimistic._id = previous._id;
    }
    optimistic.projectId = ProjectUtil.getCurrentProjectId()!;
    optimistic.userId = User.getUserId();
    optimistic.isEnabled = next;
    setSetting(optimistic);

    try {
      if (previous && previous.id) {
        await ModelAPI.updateById<UserNotificationEmailRollupSetting>({
          modelType: UserNotificationEmailRollupSetting,
          id: previous.id as ObjectID,
          data: { isEnabled: next } as JSONObject,
        });
      } else {
        /*
         * The first opinion this person has expressed in this project: there
         * is nothing to update, because the default they have been living
         * under is the absence of a row.
         */
        const newModel: UserNotificationEmailRollupSetting =
          new UserNotificationEmailRollupSetting();
        newModel.projectId = ProjectUtil.getCurrentProjectId()!;
        newModel.userId = User.getUserId();
        newModel.isEnabled = next;
        await ModelAPI.create<UserNotificationEmailRollupSetting>({
          model: newModel,
          modelType: UserNotificationEmailRollupSetting,
        });
        /*
         * Re-read so the next toggle updates that row rather than trying to
         * create a second one, which the service rejects.
         */
        await fetchSetting();
      }
      setError("");
    } catch (err) {
      setSetting(previous);
      setError(API.getFriendlyMessage(err));
    }
  };

  const handleToggle: () => Promise<void> = async (): Promise<void> => {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await persistRollupEnabled(!isEnabled);
    } finally {
      setIsBusy(false);
    }
  };

  const trackClasses: string = isEnabled
    ? "bg-emerald-500 border-emerald-500"
    : "bg-gray-200 border-gray-300";

  const knobClasses: string = isEnabled ? "translate-x-5" : "translate-x-0.5";

  return (
    <Card
      title="Email Rollup"
      description="How owner notification emails reach you in this project."
      bodyClassName="mt-5"
    >
      {isLoading ? (
        <ComponentLoader />
      ) : (
        <Fragment>
          {error ? (
            <div className="mb-4">
              <ErrorMessage
                message={error}
                onRefreshClick={() => {
                  fetchSetting().catch((err: Error) => {
                    setError(API.getFriendlyMessage(err));
                  });
                }}
              />
            </div>
          ) : null}
          <div className="flex items-start gap-4">
            <button
              type="button"
              role="switch"
              aria-checked={isEnabled}
              aria-label={`Roll up notification emails: ${isEnabled ? "On" : "Off"}. Click to ${isEnabled ? "disable" : "enable"}.`}
              onClick={handleToggle}
              disabled={isBusy}
              className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:opacity-60 ${trackClasses}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${knobClasses}`}
              />
            </button>
            <div>
              <div className="text-sm font-medium text-gray-900">
                {isEnabled
                  ? "On: notifications that arrive together are delivered as one email."
                  : "Off: every notification arrives as its own email, immediately."}
              </div>
              <p className="mt-1 text-sm text-gray-500 max-w-2xl">
                {isEnabled
                  ? "When a burst of notifications about the resources you own lands at once, the first few are still emailed one by one as they happen. The rest are delivered together a few minutes later. The summary includes the notifications you are still subscribed to when it is sent."
                  : "Nothing is held back or combined, ever. This is exactly how OneUptime delivered owner notifications before rollup existed, and it is the right choice if you file, filter or forward mail one event at a time."}
              </p>
              <p className="mt-3 text-xs text-gray-500 max-w-2xl">
                Either way, this only changes owner notification email. On-call
                paging, security and sign-in email, and billing email are never
                rolled up and are never delayed by this setting, so it cannot
                make you unreachable. SMS, calls, push and chat notifications
                are unaffected too.
              </p>
              <p className="mt-2 text-xs text-gray-500">
                This is your own setting, in this project only. It changes
                nothing for anyone else, and it saves automatically.
              </p>
            </div>
          </div>
        </Fragment>
      )}
    </Card>
  );
};

export default EmailRollupCard;
