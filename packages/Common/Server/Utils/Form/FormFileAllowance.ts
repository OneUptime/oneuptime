import FormRateLimit, {
  FORM_FILES_RATE_LIMIT_MESSAGE,
  FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  FormCeilingException,
  FormFileAllowanceCounter,
} from "../../Middleware/FormRateLimit";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";

/*
 * A FORM'S HOURLY ALLOWANCE OF FILES.
 *
 * How many bytes of files one form may take in per window, every address
 * together (FormRateLimit's file ceiling: 200 MB an hour unless the
 * installation says otherwise): what a leaked link can make the database
 * hold, however many submissions the form's submission ceiling lets through.
 * A counter keyed on the form, never on a client - the per-address limits
 * are FormRateLimit's, counted by ClientRateLimitCounter - so it is its own
 * module (Tests/Server/Utils/RateLimit/ClientRateLimitGuard lists it with
 * what it counts).
 *
 * Spent by FormService.submitPublicForm for a submission with files, once
 * the submission has passed every other check and spent its place under
 * the submission ceiling, right before its files are stored.
 */
export default class FormFileAllowance {
  /*
   * Spend these bytes of the form's allowance, or refuse: 429
   * (FormCeilingException, with when to come back) when they would take the
   * window past it - and then they are given back, since nothing is stored
   * - and 503 when the counter cannot be reached: like the submission
   * ceiling, the allowance fails closed. Nothing to spend for no bytes.
   */
  public static async reserve(data: {
    shareKey: string | undefined;
    bytes: number;
  }): Promise<void> {
    if (!Number.isFinite(data.bytes) || data.bytes <= 0) {
      return;
    }

    const counter: FormFileAllowanceCounter =
      FormRateLimit.getFileAllowanceCounter(data.shareKey);
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new ServiceUnavailableException(
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      );
    }

    const bytes: number = Math.ceil(data.bytes);

    let total: number;

    try {
      total = Number(await client.incrby(counter.key, bytes));

      if (total === bytes) {
        await client.expire(counter.key, counter.ttlSeconds);
      }
    } catch (err) {
      if (FormRateLimit.shouldLogFileCounterUnavailable()) {
        logger.warn(
          `FormFileAllowance: the files counter failed for form ${counter.formKey}`,
        );
        logger.warn(err);
      }

      throw new ServiceUnavailableException(
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      );
    }

    if (total <= counter.limitInBytes) {
      return;
    }

    // Nothing is stored for a refused submission: its bytes are given back.
    try {
      await client.decrby(counter.key, bytes);
    } catch (err) {
      logger.warn(
        `FormFileAllowance: could not give back the bytes of a refused submission to form ${counter.formKey}`,
      );
      logger.warn(err);
    }

    // Logged once a window: the first refusal that crossed the allowance.
    if (total - bytes <= counter.limitInBytes) {
      logger.warn(
        `FormFileAllowance: refused a submission's files to form ${counter.formKey} (the form's hourly allowance of files)`,
      );
    }

    throw new FormCeilingException(
      counter.secondsUntilWindowEnd,
      FORM_FILES_RATE_LIMIT_MESSAGE,
    );
  }
}
