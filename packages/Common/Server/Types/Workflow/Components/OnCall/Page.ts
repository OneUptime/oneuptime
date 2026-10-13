import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONArray, JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  Argument,
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import OnCallComponents, {
  PageStepTarget,
  PageTargetKind,
  getPageStepTarget,
} from "../../../../../Types/Workflow/Components/OnCall";
import {
  PAGE_ARGUMENT_IDS,
  PAGE_ERROR_PORT_ID,
  PAGE_RETURN_VALUE_IDS,
  PAGE_SUCCESS_PORT_ID,
  PageAbout,
  PageIdList,
  hasPageSettingValue,
  readPageAbout,
  readPageIdList,
  readPageRecordId,
} from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import {
  TRUNCATED_NAME_NOTE,
  fitTextToLength,
} from "../../../../../Utils/MessageFit";
import OnCallPageService, {
  ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS,
  OnCallPageAbout,
  OnCallPageRecordType,
  OnCallPageResult,
  OnCallPageTargets,
  OnCallPagedPerson,
} from "../../../../Services/OnCallPageService";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

// Kept back from the workflow's time, so the run can still record the result.
const WORKFLOW_TIME_MARGIN_IN_MS: number = 5 * 1000;

/*
 * What a page is asked for, read from the step's settings: who to page and
 * what about. `unreadable` is what the who-to-page setting held that is
 * neither an id nor (for people) an email address.
 */
export interface PageStepRequest {
  targets: OnCallPageTargets;
  about: OnCallPageAbout;
  unreadable: Array<string>;
}

/*
 * A PAGE STEP: Page Users, Page a Team, Page Whoever Is On Call or Page an
 * On-Call Policy (Types/Workflow/Components/OnCall).
 *
 * One class runs all four: they differ only in which setting says who to
 * page and what kind of record its entries name. The paging itself is
 * OnCallPageService's, asked as the step - a Project Admin of the
 * workflow's project (WorkflowPrincipal) - so a step pages whoever a Project
 * Admin could, on what the project's plan includes.
 *
 * WHICH OUTPUT IT TAKES
 *
 *   Success   somebody was paged, or a policy started.
 *   Error     nobody was: nobody the settings name could be found, an
 *             incident or alert that is not there, everybody away, nobody
 *             on call, a plan without on-call. Error says why. When the
 *             record exists - an alert the step created, say - its ID is
 *             still returned, so the Error path can page somebody else
 *             about it.
 *
 * A step that was never set up - no one to page, no title for a new alert -
 * is a mistake in the workflow, and stops the run, as an empty required
 * setting does on every step. What a setting holds is judged as it is
 * saved (options.configuredArguments): a value from an earlier step that
 * turned out empty at run time is not a mistake in the workflow, and takes
 * Error.
 */
export default class Page extends ComponentCode {
  public constructor(componentId: ComponentID) {
    super();

    const Component: ComponentMetadata | undefined = OnCallComponents.find(
      (i: ComponentMetadata) => {
        return i.id === componentId;
      },
    );

    if (!Component || !getPageStepTarget(componentId)) {
      throw new BadDataException("Component not found.");
    }

    this.setMetadata(Component);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === PAGE_SUCCESS_PORT_ID;
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Success port not found"));
    }

    const errorPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === PAGE_ERROR_PORT_ID;
      },
    );

    if (!errorPort) {
      throw options.onError(new BadDataException("Error port not found"));
    }

    // A step that was never set up is a mistake in the workflow.
    const setupProblem: string | null = this.getSetupProblem(
      options.configuredArguments || args,
    );

    if (setupProblem) {
      options.log(setupProblem);
      throw options.onError(new BadDataException(setupProblem));
    }

    type TakeErrorFunction = (
      message: string,
      result?: OnCallPageResult | undefined,
    ) => RunReturnType;

    // Nobody was paged: the Error output, with why - and the record, if any.
    const takeError: TakeErrorFunction = (
      message: string,
      result?: OnCallPageResult | undefined,
    ): RunReturnType => {
      options.log(message);

      return {
        returnValues: {
          ...(result ? this.getRecordReturnValues(result) : {}),
          [PAGE_RETURN_VALUE_IDS.error]: message,
        },
        executePort: errorPort,
        executePortReason: message,
      };
    };

    let request: PageStepRequest;

    try {
      request = this.getRequest(args);
    } catch (err) {
      return takeError(this.getErrorMessage(err));
    }

    let result: OnCallPageResult;

    try {
      result = await OnCallPageService.page({
        projectId: options.projectId,
        targets: request.targets,
        about: request.about,
        props: await this.getStepProps(options),
        maxWaitForRecordInMs: Page.getMaxWaitForRecordInMs(options),
      });
    } catch (err) {
      return takeError(this.getErrorMessage(err, request.unreadable));
    }

    /*
     * What the who-to-page setting held that names nobody is said beside
     * what the page came to: it is why somebody the author expected was not
     * paged.
     */
    const unreadableNote: string = this.getUnreadableNote(request.unreadable);

    const summary: string = unreadableNote
      ? `${result.summary} ${unreadableNote}`
      : result.summary;

    if (!result.isAnyonePaged) {
      return takeError(summary, result);
    }

    options.log(summary);

    const returnValues: JSONObject = {
      [PAGE_RETURN_VALUE_IDS.summary]: summary,
      ...this.getRecordReturnValues(result),
    };

    if (this.returns(PAGE_RETURN_VALUE_IDS.pagedUsers)) {
      returnValues[PAGE_RETURN_VALUE_IDS.pagedUsers] = result.paged.map(
        (person: OnCallPagedPerson): JSONObject => {
          return {
            id: person.userId.toString(),
            name: person.name,
            email: person.email || "",
          };
        },
      ) as JSONArray;
    }

    return {
      returnValues: returnValues,
      executePort: successPort,
      executePortReason: summary,
    };
  }

  // The step's who-to-page setting: which one, and what its entries name.
  private getTarget(): PageStepTarget {
    return getPageStepTarget(this.getMetadata().id)!;
  }

  private getArgumentName(argumentId: string): string {
    return (
      this.getMetadata().arguments.find((argument: Argument): boolean => {
        return argument.id === argumentId;
      })?.name || argumentId
    );
  }

  private returns(returnValueId: string): boolean {
    return this.getMetadata().returnValues.some(
      (returnValue: { id: string }): boolean => {
        return returnValue.id === returnValueId;
      },
    );
  }

  /*
   * What is wrong with the step as it is saved, or null: a required setting
   * that holds nothing at all, or a Page About that is none of its choices.
   * Named as the settings name them.
   */
  public getSetupProblem(configured: JSONObject): string | null {
    const target: PageStepTarget = this.getTarget();

    if (!hasPageSettingValue(configured[target.argumentId])) {
      return `${this.getArgumentName(target.argumentId)} is empty, so this step has nobody to page. Open the step and choose who to page.`;
    }

    const about: PageAbout | null = readPageAbout(
      configured[PAGE_ARGUMENT_IDS.about],
    );

    if (!about) {
      return `${this.getArgumentName(PAGE_ARGUMENT_IDS.about)} is set to something this step does not know. Open the step and choose what the page is about.`;
    }

    const requiredArgumentId: string =
      about === PageAbout.Incident
        ? PAGE_ARGUMENT_IDS.incidentId
        : about === PageAbout.Alert
          ? PAGE_ARGUMENT_IDS.alertId
          : PAGE_ARGUMENT_IDS.title;

    if (!hasPageSettingValue(configured[requiredArgumentId])) {
      return about === PageAbout.NewAlert
        ? `${this.getArgumentName(requiredArgumentId)} is empty. A page about a new alert needs a title: open the step and write one.`
        : `${this.getArgumentName(requiredArgumentId)} is empty. Open the step and choose the ${about} to page about.`;
    }

    return null;
  }

  /*
   * Who to page and what about, read from the settings as they are once
   * every value from an earlier step is in them. Throws a BadDataException
   * that says what is wrong, in the settings' own names.
   */
  public getRequest(args: JSONObject): PageStepRequest {
    const target: PageStepTarget = this.getTarget();
    const targetName: string = this.getArgumentName(target.argumentId);

    const list: PageIdList = readPageIdList(args[target.argumentId], {
      // People can be named by the email address they sign in with.
      allowEmails: target.kind === PageTargetKind.User,
    });

    if (list.ids.length === 0 && list.emails.length === 0) {
      throw new BadDataException(
        list.unreadable.length > 0
          ? `Nobody was paged. ${this.getUnreadableNote(list.unreadable, targetName)}`
          : `Nobody was paged. ${targetName} came out empty when the step ran, so there was nobody to page.`,
      );
    }

    const ids: Array<ObjectID> = list.ids.map((id: string): ObjectID => {
      return new ObjectID(id);
    });

    const targets: OnCallPageTargets = {};

    switch (target.kind) {
      case PageTargetKind.User:
        targets.userIds = ids;
        targets.userEmails = list.emails;
        break;
      case PageTargetKind.Team:
        targets.teamIds = ids;
        break;
      case PageTargetKind.OnCallSchedule:
        targets.onCallScheduleIds = ids;
        break;
      case PageTargetKind.OnCallPolicy:
      default:
        targets.onCallDutyPolicyIds = ids;
        break;
    }

    return {
      targets: targets,
      about: this.getAbout(args),
      unreadable: list.unreadable,
    };
  }

  // What the page is about, read from the settings that go with Page About.
  private getAbout(args: JSONObject): OnCallPageAbout {
    const about: PageAbout | null = readPageAbout(
      args[PAGE_ARGUMENT_IDS.about],
    );

    if (about === PageAbout.Incident || about === PageAbout.Alert) {
      const argumentId: string =
        about === PageAbout.Incident
          ? PAGE_ARGUMENT_IDS.incidentId
          : PAGE_ARGUMENT_IDS.alertId;

      const recordId: string | null = readPageRecordId(args[argumentId]);

      if (!recordId) {
        throw new BadDataException(
          `Nobody was paged. ${this.getArgumentName(argumentId)} is ${this.describeValue(args[argumentId])}, which is not the ID of one ${about}.`,
        );
      }

      return about === PageAbout.Incident
        ? { incidentId: new ObjectID(recordId) }
        : { alertId: new ObjectID(recordId) };
    }

    if (about !== PageAbout.NewAlert) {
      throw new BadDataException(
        `Nobody was paged. ${this.getArgumentName(PAGE_ARGUMENT_IDS.about)} is ${this.describeValue(args[PAGE_ARGUMENT_IDS.about])}, which is not one of its choices.`,
      );
    }

    const title: string = this.getText(args[PAGE_ARGUMENT_IDS.title]).trim();

    if (!title) {
      throw new BadDataException(
        `Nobody was paged. ${this.getArgumentName(PAGE_ARGUMENT_IDS.title)} came out empty when the step ran, and a page about a new alert needs a title.`,
      );
    }

    const newAlert: OnCallPageAbout["newAlert"] = {
      // An alert's title holds this much; a longer one is cut, not refused.
      title: fitTextToLength(title, ColumnLength.LongText, TRUNCATED_NAME_NOTE),
    };

    const message: string = this.getText(
      args[PAGE_ARGUMENT_IDS.message],
    ).trim();

    if (message) {
      newAlert.description = message;
    }

    if (hasPageSettingValue(args[PAGE_ARGUMENT_IDS.alertSeverity])) {
      const severityId: string | null = readPageRecordId(
        args[PAGE_ARGUMENT_IDS.alertSeverity],
      );

      if (!severityId) {
        throw new BadDataException(
          `Nobody was paged. ${this.getArgumentName(PAGE_ARGUMENT_IDS.alertSeverity)} is ${this.describeValue(args[PAGE_ARGUMENT_IDS.alertSeverity])}, which is not the ID of an alert severity.`,
        );
      }

      newAlert.alertSeverityId = new ObjectID(severityId);
    }

    return { newAlert: newAlert };
  }

  // The record a page is about, as the step returns it.
  private getRecordReturnValues(result: OnCallPageResult): JSONObject {
    return result.record.type === OnCallPageRecordType.Incident
      ? { [PAGE_RETURN_VALUE_IDS.incidentId]: result.record.id.toString() }
      : { [PAGE_RETURN_VALUE_IDS.alertId]: result.record.id.toString() };
  }

  /*
   * "Users also held "Jane" and "ops", which are not IDs or email
   * addresses." - what a who-to-page setting held that names nobody.
   */
  private getUnreadableNote(
    unreadable: Array<string>,
    targetName?: string | undefined,
  ): string {
    if (unreadable.length === 0) {
      return "";
    }

    const target: PageStepTarget = this.getTarget();
    const name: string = targetName || this.getArgumentName(target.argumentId);

    const quoted: Array<string> = unreadable
      .slice(0, 3)
      .map((entry: string): string => {
        return `"${entry}"`;
      });

    const more: number = unreadable.length - quoted.length;

    const what: string =
      target.kind === PageTargetKind.User
        ? "an ID or an email address"
        : "an ID";

    return `${name} held ${quoted.join(", ")}${more > 0 ? ` and ${more} more` : ""}, which ${unreadable.length === 1 ? "is" : "are"} not ${what}.`;
  }

  /*
   * Why the page did not go out, in words for the workflow's author: the
   * paging service's and the database layer's messages are written to be
   * read. Anything else is a fault of ours, and its message is not shown.
   */
  private getErrorMessage(
    err: unknown,
    unreadable?: Array<string> | undefined,
  ): string {
    const message: string =
      err instanceof Exception && err.message
        ? err.message
        : "Nobody was paged: the page could not be sent.";

    const note: string = this.getUnreadableNote(unreadable || []);

    return note ? `${message} ${note}` : message;
  }

  // A setting's value, quoted and cut short, for a message about it.
  private describeValue(value: JSONValue | undefined): string {
    const text: string = this.getText(value).trim();

    if (!text) {
      return "empty";
    }

    return `"${text.length > 80 ? `${text.slice(0, 80)}…` : text}"`;
  }

  private getText(value: JSONValue | undefined): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  }

  /*
   * How long the page may wait for a record created moments ago to get its
   * channels: what the paging service takes by default, and always inside
   * what is left of the workflow's own time.
   */
  public static getMaxWaitForRecordInMs(options: RunOptions): number {
    const remainingInMs: number | undefined =
      options.getRemainingExecutionTimeInMs?.();

    if (remainingInMs === undefined) {
      return ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS;
    }

    return Math.max(
      0,
      Math.min(
        ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS,
        Math.floor((remainingInMs - WORKFLOW_TIME_MARGIN_IN_MS) / 2),
      ),
    );
  }
}
