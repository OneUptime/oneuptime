/*
 * Rebuild the transparent native launch wordmark from the existing brand SVG.
 * Uses the browser already installed for MobileApp's UI tests; no image package
 * or new font is needed. Run: node MobileApp/scripts/generate-launch-asset.js
 */
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("@playwright/test");

async function generateLaunchAsset() {
  const sourcePath = path.resolve(
    __dirname,
    "../../Common/Server/Static/Brand/oneuptime-logo.svg",
  );
  const destinationPath = path.resolve(__dirname, "../assets/splash-light.png");
  const source = await readFile(sourcePath, "utf8");
  if (
    !source.includes('fill="#121212"') ||
    !source.includes('fill="#7ed957"')
  ) {
    throw new Error(
      "The source brand palette changed; review the launch asset mapping.",
    );
  }
  const artwork = source
    .replaceAll('fill="#121212"', 'fill="#17212F"')
    .replaceAll('fill="#7ed957"', 'fill="#3155D9"');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 200 },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:1000px;height:200px}</style></head><body>${artwork}</body></html>`,
    );
    await page.locator("svg").screenshot({
      path: destinationPath,
      omitBackground: true,
      animations: "disabled",
    });
    process.stdout.write(
      "Generated MobileApp/assets/splash-light.png from the existing brand SVG.\n",
    );
  } finally {
    await browser.close();
  }
}

generateLaunchAsset().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
