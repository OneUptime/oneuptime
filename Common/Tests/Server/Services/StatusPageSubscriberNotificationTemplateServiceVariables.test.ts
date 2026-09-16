import { Service as StatusPageSubscriberNotificationTemplateService } from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables from "../../../Types/StatusPage/SubscriberNotificationTemplateVariables";
import { describe, expect, test } from "@jest/globals";

/*
 * The service keeps its public static method, but the list itself lives in a
 * module without database dependencies. Both must answer the same, for every
 * event type - including the episode events the service used to throw for.
 */
describe("StatusPageSubscriberNotificationTemplateService.getAvailableVariablesForEventType", () => {
  test.each(Object.values(StatusPageSubscriberNotificationEventType))(
    "%s matches the shared variable list",
    (event: StatusPageSubscriberNotificationEventType) => {
      expect(
        StatusPageSubscriberNotificationTemplateService.getAvailableVariablesForEventType(
          event,
        ),
      ).toEqual(
        SubscriberNotificationTemplateVariables.getAvailableVariablesForEventType(
          event,
        ),
      );
    },
  );

  test.each([
    StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated,
    StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged,
  ])(
    "no longer throws for %s",
    (event: StatusPageSubscriberNotificationEventType) => {
      expect(() => {
        StatusPageSubscriberNotificationTemplateService.getAvailableVariablesForEventType(
          event,
        );
      }).not.toThrow();
    },
  );
});
