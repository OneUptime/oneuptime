import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * A widget whose body is HTML, CSS, and JavaScript written by the dashboard
 * author. It renders inside a sandboxed iframe; see
 * Common/Utils/Dashboard/HtmlWidgetDocument.ts for the security model and
 * for what each of the allow* flags maps to.
 *
 * Every argument is optional. The settings modal saves whatever is in the
 * form even when a `required` argument is empty (ComponentSettingsModal does
 * not consume ArgumentsForm's validation callback), so the renderer has to
 * cope with a half-configured widget regardless of what is declared here.
 */
export default interface DashboardHtmlComponent extends BaseComponent {
  componentType: DashboardComponentType.Html;
  componentId: ObjectID;
  arguments: {
    html?: string | undefined;
    css?: string | undefined;
    javascript?: string | undefined;
    allowScripts?: boolean | undefined;
    allowForms?: boolean | undefined;
    allowPopups?: boolean | undefined;
  };
}
