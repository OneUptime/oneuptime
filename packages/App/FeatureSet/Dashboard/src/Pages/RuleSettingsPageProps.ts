import PageComponentProps from "./PageComponentProps";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * Props of a page that lists rules. The same page renders a rule's own view
 * page: the route for that view sets ruleViewModelType to the rule model whose
 * table should become the view of the rule named in the URL. A page with
 * several rule tables (incident and episode rules, say) uses it to pick one.
 */
export default interface RuleSettingsPageProps extends PageComponentProps {
  ruleViewModelType?: DatabaseBaseModelType | undefined;
}
