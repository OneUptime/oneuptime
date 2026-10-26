import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { getPostmortemRuleTemplateNames } from "./PostmortemRuleForm";
import {
  POSTMORTEM_RULE_MORE_TEMPLATES,
  POSTMORTEM_RULE_STANDARD_OUTLINE,
} from "./PostmortemRulesCopy";

/*
 * The width a rule's templates may take in the Postmortem rules table.
 *
 * The table has seven columns - the grip, the select box, Name, Match
 * Criteria, Templates, Status and the row's buttons - and on a 1280px
 * screen, beside the side menu, its card is about 940px wide. A template
 * named in full on one line (up to the table's 20rem cap) took the room
 * Status needed: the rows scrolled sideways, and whether a rule was
 * enabled was out of sight. Capped here, a long name is cut short with its
 * whole name under the pointer, and every column fits; from 1536px on
 * there is room for more of it. 10rem, not 11rem: in German
 * ("Deaktiviert", "Bearbeiten") the rows still ran past the card.
 */
export const POSTMORTEM_RULE_TEMPLATES_COLUMN_CLASS_NAME: string =
  "max-w-[10rem] 2xl:max-w-[18rem]";

/*
 * The least the Name and Templates columns narrow to: 8rem, as the AI rules
 * table's Name does (INVESTIGATION_RULE_NAME_COLUMN_CLASS_NAME), not the
 * 10rem a column of prose has. Beside the grip, the select box, Match
 * Criteria, Status and the row's Edit, the table ran past its card at
 * 1280px beside the side menu in German ("Deaktiviert", "Bearbeiten") by
 * 20px, and in Russian by 62px - Status under the row's buttons. A name
 * still runs onto as many lines as it needs, and a template ends in "..."
 * with its whole name under the pointer.
 */
export const POSTMORTEM_RULE_TEXT_COLUMN_FLOOR_CLASS_NAME: string =
  "min-w-[8rem]";

// Each template's name, as the table and its tests find it.
export const POSTMORTEM_RULE_TEMPLATE_TEST_ID: string =
  "postmortem-rule-template";

export interface ComponentProps {
  templates: Array<{ templateName?: string | undefined }> | undefined;
}

interface TemplateItem {
  name: string;
}

/*
 * A rule's templates in the Postmortem rules table: one a line, as every
 * list of records in a table is drawn (TableColumnListComponent) - the
 * first three by name, then "2 more templates", which shows the rest -
 * each cut short at the column's width with its whole name under the
 * pointer, and in full on a phone's card. A rule that names none drafts in
 * OneUptime AI's standard outline, and says so in the grey an absent value
 * is drawn in.
 */
const PostmortemRuleTemplates: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const names: Array<string> = getPostmortemRuleTemplateNames(props.templates);

  if (names.length === 0) {
    return (
      <span className="text-gray-500">
        {translator.translateText(POSTMORTEM_RULE_STANDARD_OUTLINE)}
      </span>
    );
  }

  return (
    <TableColumnListComponent<TemplateItem>
      items={names.map((name: string): TemplateItem => {
        return { name: name };
      })}
      moreTemplate={POSTMORTEM_RULE_MORE_TEMPLATES}
      noItemsMessage={POSTMORTEM_RULE_STANDARD_OUTLINE}
      getEachElement={(item: TemplateItem): ReactElement => {
        return (
          <span data-testid={POSTMORTEM_RULE_TEMPLATE_TEST_ID}>
            {item.name}
          </span>
        );
      }}
    />
  );
};

export default PostmortemRuleTemplates;
