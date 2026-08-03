import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardHtmlComponent from "../../../Types/Dashboard/DashboardComponents/DashboardHtmlComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

const MarkupSection: ComponentArgumentSection = {
  name: "HTML",
  description: "The markup for this widget",
  order: 1,
};

const StyleSection: ComponentArgumentSection = {
  name: "CSS",
  description: "Styles applied to the markup above",
  order: 2,
  defaultCollapsed: true,
};

const ScriptSection: ComponentArgumentSection = {
  name: "JavaScript",
  description: "Script that runs when the widget loads",
  order: 3,
  defaultCollapsed: true,
};

const PermissionsSection: ComponentArgumentSection = {
  name: "Permissions",
  description:
    "What the widget is allowed to do. The widget always runs isolated from the rest of OneUptime.",
  order: 4,
  defaultCollapsed: true,
};

const DEFAULT_HTML: string = `<div class="widget">
  <h2>Hello, World!</h2>
  <p>Paste any HTML, CSS, and JavaScript to build your own widget.</p>
</div>`;

const DEFAULT_CSS: string = `.widget {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
}

.widget h2 {
  margin: 0 0 4px;
  font-size: 18px;
  color: #111827;
}

.widget p {
  margin: 0;
  color: #6b7280;
}`;

export default class DashboardHtmlComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardHtmlComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Html,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 3,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      arguments: {
        html: DEFAULT_HTML,
        css: DEFAULT_CSS,
        javascript: "",
        /*
         * Scripts on by default: a widget that silently does nothing when
         * the author pastes working JS is the more confusing default, and
         * the sandbox — not this flag — is what contains the script.
         */
        allowScripts: true,
        allowForms: false,
        allowPopups: true,
      },
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 1,
      minWidthInDashboardUnits: 2,
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardHtmlComponent>
  > {
    const componentArguments: Array<ComponentArgument<DashboardHtmlComponent>> =
      [];

    componentArguments.push({
      name: "HTML",
      description:
        "The body of the widget. Use {{variableName}} anywhere to substitute a dashboard variable.",
      required: false,
      type: ComponentInputType.Html,
      id: "html",
      placeholder: "<h2>Hello, World!</h2>",
      section: MarkupSection,
    });

    componentArguments.push({
      name: "CSS",
      description:
        "Styles for the markup above. The widget starts transparent — set a background on body to fill the card.",
      required: false,
      type: ComponentInputType.Css,
      id: "css",
      placeholder: "h2 { color: #111827; }",
      section: StyleSection,
    });

    componentArguments.push({
      name: "JavaScript",
      description:
        "Runs after the markup loads. window.ONEUPTIME holds the dashboard's variables and selected time range.",
      required: false,
      type: ComponentInputType.JavaScript,
      id: "javascript",
      placeholder: "console.log(window.ONEUPTIME.variables);",
      section: ScriptSection,
    });

    componentArguments.push({
      name: "Run JavaScript",
      description:
        "Turn off to render the HTML and CSS only. The script is left out of the widget entirely.",
      required: false,
      type: ComponentInputType.Boolean,
      id: "allowScripts",
      section: PermissionsSection,
    });

    componentArguments.push({
      name: "Open links in a new tab",
      description:
        "Allows links and window.open to open a new browser tab. Turn off to make the widget inert.",
      required: false,
      type: ComponentInputType.Boolean,
      id: "allowPopups",
      section: PermissionsSection,
    });

    componentArguments.push({
      name: "Allow forms to submit",
      description:
        "Allows a <form> inside the widget to submit. Off unless you need it.",
      required: false,
      type: ComponentInputType.Boolean,
      id: "allowForms",
      section: PermissionsSection,
    });

    return componentArguments;
  }
}
