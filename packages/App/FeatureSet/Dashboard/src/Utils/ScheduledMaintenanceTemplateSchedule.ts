import type ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";

/*
 * WHEN A SCHEDULED MAINTENANCE TEMPLATE'S NEXT EVENT COMES, AS THE
 * DASHBOARD SAYS IT.
 *
 * A template with Recurring Event on holds the time its next event is
 * created (scheduleNextEventAt): ScheduledMaintenanceTemplateService works
 * it out when the template is saved, and the job that creates the events
 * (Workers, ScheduleRecurringEvents) moves it on by one interval each time.
 * The job reads only templates whose switch is on, so a template turned off
 * creates no more events - but it used to keep the time it last had, and the
 * templates list said "Next event will be scheduled at ..." for it. The
 * service clears that time now, and a migration cleared it on the templates
 * stored that way; the Dashboard still reads a next event the way the job
 * does, the switch on and a time set, so the templates list and a template's
 * page never promise an event the job would not create.
 *
 * React-free, so App's tests can read it.
 */
export type ScheduledMaintenanceTemplateSchedule = Pick<
  ScheduledMaintenanceTemplate,
  "isRecurringEvent" | "scheduleNextEventAt"
>;

/*
 * The time a template's next event is created, or null when it creates
 * none: Recurring Event off, or no time worked out.
 */
export const getTemplateNextEventAt: (
  template: ScheduledMaintenanceTemplateSchedule,
) => Date | null = (
  template: ScheduledMaintenanceTemplateSchedule,
): Date | null => {
  if (!template.isRecurringEvent || !template.scheduleNextEventAt) {
    return null;
  }

  return template.scheduleNextEventAt;
};
