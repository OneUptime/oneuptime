/*
 * ShouldRender
 * Description: Renders the children component if the view resolves to TRUE
 * Params
 * Params 1: props
 * Returns JSX.Element or NULL
 */
export default function ShouldRender(props: $TSFixMe): void {
    return props.if ? props.children : null;
}
