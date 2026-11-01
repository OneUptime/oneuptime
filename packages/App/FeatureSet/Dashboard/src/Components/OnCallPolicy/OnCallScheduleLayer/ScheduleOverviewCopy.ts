import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Words of a schedule's Overview and Layers pages that more than one file
 * (and App/Tests) reads. Kept free of React. Every sentence is wrapped in
 * translationKey() so npm run i18n:extract finds it.
 */

/*
 * The details card's Edit button and dialog: the schedule as every menu
 * names it. The model's own name (On-Call Policy Schedule) is its table's.
 */
export const SCHEDULE_EDIT_BUTTON_TEXT: string = translationKey(
  "Edit On-Call Schedule",
);

/*
 * The Overview's card that says who is on call and when. A schedule with no
 * layers yet shows its first step in the same card, so the page keeps one
 * shape before and after the first layer.
 */
export const SCHEDULE_FINAL_SCHEDULE_TITLE: string =
  translationKey("Final Schedule");

/*
 * What the Final Schedule shows, under its title on the Overview and the
 * Layers page (and over the layer form's preview). It used to say the
 * timezone too ("Times are in this schedule's timezone, Europe/London."),
 * three lines above the "View as" note that says it again beside the
 * control that changes it - and above times that each carry their zone.
 * The note is the one place now.
 */
export const SCHEDULE_FINAL_SCHEDULE_DESCRIPTION: string = translationKey(
  "Who is on call and when, with every layer applied.",
);

/*
 * A schedule with no layers yet, on its Overview: one step - add the people
 * who take turns - where a red "No one is currently on call" banner, two
 * calendar cards and "No Layers in this On Call Schedule. Please go to
 * layers tab to add one." used to be.
 */
export const ScheduleNoLayersCopy: {
  title: string;
  description: string;
  button: string;
} = {
  title: translationKey("Nobody takes turns on this schedule yet"),
  description: translationKey(
    "Add the people who are on call, and when, on its Layers page. Until then, nobody is paged through it.",
  ),
  button: translationKey("Go to Layers"),
};

export const SCHEDULE_NO_LAYERS_TEST_ID: string = "schedule-no-layers";
