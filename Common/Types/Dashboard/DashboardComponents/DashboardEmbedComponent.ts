import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardEmbedComponent extends BaseComponent {
  componentType: DashboardComponentType.Embed;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    url?: string | undefined;
    /*
     * When true, render with sandbox="" so the embedded page can't pop out
     * of the iframe or run scripts. Off by default — most embed targets
     * (Grafana, internal docs, etc.) need scripts to function.
     */
    sandbox?: boolean | undefined;
  };
}
