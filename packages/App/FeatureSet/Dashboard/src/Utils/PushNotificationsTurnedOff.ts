import GlobalConfigUtil, {
  GlobalConfigVars,
} from "Common/UI/Utils/GlobalConfig";
import { useEffect, useState } from "react";

/*
 * Whether the server has push notifications turned off (GlobalConfig.
 * disablePushNotifications, Types/PushNotification/PushNotificationsTurnedOff),
 * for every screen that offers push: a person's Notification Methods and
 * their on-call rules. Read from the server's public settings
 * (GlobalConfigUtil), once per page load.
 *
 * A read that fails answers "on", as every server was before the switch:
 * the server refuses to register a device while push is off (UserPushAPI),
 * so all that is lost is the notice that says why.
 */
export const usePushNotificationsTurnedOff: () => boolean | null = ():
  | boolean
  | null => {
  // Null while the answer is on its way.
  const [isTurnedOff, setIsTurnedOff] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted: boolean = true;

    GlobalConfigUtil.fetchVars()
      .then((vars: GlobalConfigVars) => {
        if (isMounted) {
          setIsTurnedOff(vars.disablePushNotifications === true);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsTurnedOff(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return isTurnedOff;
};
