/*
 * A SUBMIT THE PERSON CALLED BACK.
 *
 * A form's onBeforeCreate or onBeforeUpdate can ask the person a question
 * before anything is sent - "This filter drops logs two monitors read.
 * Create it?" (Dashboard's drop filter forms, #10436) - and they can say
 * no. Thrown from the hook, this stops the submit quietly: nothing is
 * sent, no error is shown and no refusal is counted, and the form stays as
 * it was, to change or to submit again (ModelForm).
 */
export default class FormSubmitCancelled extends Error {
  public constructor() {
    super("The person called the submit back before anything was sent.");
    this.name = "FormSubmitCancelled";
  }

  // Whether an error is one, however it was made (a bundle can hold two copies of a class).
  public static isCancelled(error: unknown): boolean {
    return (
      error instanceof FormSubmitCancelled ||
      (error instanceof Error && error.name === "FormSubmitCancelled")
    );
  }
}
