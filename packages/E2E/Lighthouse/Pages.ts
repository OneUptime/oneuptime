/*
 * The pages the Lighthouse suite scans: one for each template the site, the
 * docs and the API reference draw, since pages drawn from one template
 * score alike. A page is its address on oneuptime.com without the host; the
 * suite asks the proxy (Proxy.js) for it, which sends it where oneuptime.com
 * does.
 *
 * A new template earns a page here, and the page its results in
 * Baseline.json (README.md says how to record them).
 */
export interface LighthousePage {
  path: string;
  // The template the page stands for, as the suite names its tests.
  template: string;
}

export type FormFactor = "mobile" | "desktop";

// Lighthouse's own default first: Google indexes the mobile page.
export const FormFactors: ReadonlyArray<FormFactor> = ["mobile", "desktop"];

const LighthousePages: ReadonlyArray<LighthousePage> = [
  { path: "/", template: "the home page" },
  { path: "/pricing", template: "pricing" },
  { path: "/product/status-page", template: "a product page" },
  { path: "/product/on-call", template: "another product page" },
  { path: "/solutions/sre", template: "a solution page" },
  { path: "/compare/datadog", template: "a comparison with another product" },
  { path: "/integrations", template: "the integrations" },
  {
    path: "/integrations/opentelemetry/browser",
    template: "an OpenTelemetry guide",
  },
  { path: "/enterprise/demo", template: "the demo request form" },
  { path: "/legal/privacy", template: "a legal page" },
  // The posts are the fixture blog's (Blog/), not the real blog's.
  { path: "/blog", template: "the blog" },
  {
    path: "/blog/post/2026-01-12-reading-a-status-page/view",
    template: "a blog post",
  },
  { path: "/docs/en/introduction/getting-started", template: "a docs page" },
  {
    path: "/docs/en/terraform/quick-start",
    template: "a docs page with code and a diagram",
  },
  {
    path: "/docs/fa/introduction/getting-started",
    template: "a docs page in Persian, read right to left",
  },
  {
    path: "/docs/zh-CN/introduction/getting-started",
    template: "a docs page in Chinese",
  },
  { path: "/reference/en/introduction", template: "the API reference" },
  { path: "/reference/en/monitor", template: "a model in the API reference" },
];

export default LighthousePages;
