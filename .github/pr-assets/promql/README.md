# PromQL over a project's metrics: screenshots

Screenshots for #6796. The page is the real Metrics → PromQL tab
(`PromQLQueryView`), bundled with the app's esbuild config, Tailwind and
theme, with its API answered by a stand-in, so every series in them is
synthetic.

| File | What it shows |
| --- | --- |
| `graph-light.jpg` | A query run over the past hour: the chart named by its query, its series named by their labels, with the series filter and sort. |
| `table-light.jpg` | The same query in **Table**: each series' value at the end of the time range. |
| `error-light.jpg` | A query the server refuses: what is wrong, in a sentence, under the editor. |
| `graph-dark.jpg` | The graph in the dark theme. |
| `phone-light.jpg` | The tab at 375 pixels: the editor, the button and the examples stack, and the chart fits. |
