"use strict";
/*
 * What the whole path's real pages look like, in a real browser, signed in as the person the walk
 * signed up. whole-path.py says which pages, when, and what each has to show, and holds a page to
 * what this reports: whether it threw, drew an error or an empty state, or never showed what the
 * cloud really holds, and what the browser's console said.
 *
 * At the size the docs' screenshots are (Docs/Static/images/VMwareHosts.png is 1600 by 1100).
 *
 * Usage: WALK_PASSWORD=... node whole-path-pages.cjs <spec.json> <report.json>, with @playwright/test
 * on NODE_PATH. The screenshots go beside the report.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const WIDTH = 1600;
const HEIGHT = 1100;
const WAIT_MS = 60000;

// What a page draws when a read failed, and when it has nothing to show.
const ERROR_MARKS = [
  '[data-testid$="-read-error"]',
  '[data-testid$="-read-failed"]',
  '[data-testid$="-refresh-failed"]',
  '[data-testid="resource-topology-error"]',
  '[data-testid="refresh-button"]',
  '[role="alert"]',
].join(",");
const EMPTY_MARKS = [
  '[data-testid$="-empty"]',
  '[data-testid$="-no-match"]',
  '[data-testid="empty-action"]',
].join(",");
const ERROR_WORDS =
  /something went wrong|page not found|could not (be )?(load|read)|not authorized|do not have permission/i;

const [specFile, reportFile] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
const folder = path.dirname(reportFile);

async function shown(page, selector) {
  return page.locator(selector).evaluateAll((elements) => {
    return elements
      .filter((element) => {
        return element.getClientRects().length > 0;
      })
      .map((element) => {
        const mark =
          element.getAttribute("data-testid") ||
          element.getAttribute("role") ||
          element.tagName;
        return `${mark}: ${(element.innerText || "").trim().slice(0, 200)}`;
      });
  });
}

async function signIn(page) {
  await page.goto(`${spec.baseUrl}/accounts/login`, { timeout: WAIT_MS });
  await page.getByTestId("email").fill(spec.email);
  await page
    .locator('input[type="password"]')
    .first()
    .fill(process.env.WALK_PASSWORD);
  await page.locator('[id$="-form-submit-button"]').first().click();
  await page.waitForURL(/\/dashboard/, { timeout: WAIT_MS });
}

async function lookAt(page, target, seen) {
  const report = {
    name: target.name,
    path: target.path,
    file: target.file,
    isNamed: Boolean(target.isNamed),
    problems: [],
    emptyStates: [],
    consoleErrors: seen.consoleErrors,
    failedRequests: seen.failedRequests,
    pageErrors: seen.pageErrors,
  };

  await page.goto(`${spec.baseUrl}${target.path}`, {
    waitUntil: "domcontentloaded",
    timeout: WAIT_MS,
  });
  // A page that polls never goes quiet, so this only gives it a chance to.
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => {});
  await page
    .locator('[data-testid="component-loader"]')
    .first()
    .waitFor({ state: "hidden", timeout: 30000 })
    .catch(() => {});

  for (const testId of target.clicks || []) {
    await page
      .getByTestId(testId)
      .click({ timeout: WAIT_MS })
      .catch((error) => {
        report.problems.push(
          `could not press ${testId}: ${error.message.split("\n")[0]}`,
        );
      });
  }
  for (const words of target.text || []) {
    await page
      .getByText(words, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: WAIT_MS })
      .catch(() => {
        report.problems.push(`never showed "${words}"`);
      });
  }
  for (const wanted of target.marks || []) {
    const mark = wanted.hasText
      ? page.locator(wanted.selector, { hasText: wanted.hasText })
      : page.locator(wanted.selector);
    await mark
      .first()
      .waitFor({ state: "visible", timeout: WAIT_MS })
      .catch(() => {
        report.problems.push(
          `never drew ${wanted.selector} ${wanted.hasText || ""}`.trim(),
        );
      });
    if (wanted.attribute) {
      const value = await mark
        .first()
        .getAttribute(wanted.attribute, { timeout: 2000 })
        .catch(() => {
          return null;
        });
      if (value !== wanted.value) {
        report.problems.push(
          `${wanted.selector} has ${wanted.attribute}=${value}, not ${wanted.value}`,
        );
      }
    }
    if (wanted.scrollTo) {
      await mark
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
    }
  }
  await page.waitForTimeout(target.settleMs || 2500);

  for (const line of await shown(page, ERROR_MARKS)) {
    report.problems.push(`drew an error: ${line}`);
  }
  report.emptyStates = await shown(page, EMPTY_MARKS);
  if (target.isNamed) {
    for (const line of report.emptyStates) {
      report.problems.push(`drew an empty state: ${line}`);
    }
  }
  const words = await page
    .locator("body")
    .innerText()
    .catch(() => {
      return "";
    });
  // A guide's own words can name an error: it says what to do about them.
  const said = target.isGuide ? null : ERROR_WORDS.exec(words);
  if (said) {
    report.problems.push(`says "${said[0]}"`);
  }
  for (const thrown of seen.pageErrors) {
    report.problems.push(`threw: ${thrown}`);
  }
  for (const request of seen.failedRequests) {
    if (request.startsWith("5")) {
      report.problems.push(`a read answered ${request}`);
    }
  }
  report.finalUrl = page.url();

  const file = path.join(folder, target.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  return report;
}

async function main() {
  const reports = [];
  const save = () => {
    fs.writeFileSync(reportFile, JSON.stringify(reports, null, 2));
  };
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-US",
  });
  const page = await context.newPage();
  let seen = { consoleErrors: [], failedRequests: [], pageErrors: [] };

  page.on("console", (message) => {
    if (message.type() === "error") {
      seen.consoleErrors.push(message.text().slice(0, 400));
    }
  });
  page.on("pageerror", (error) => {
    seen.pageErrors.push(String(error.message || error).slice(0, 400));
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      seen.failedRequests.push(
        `${response.status()} ${response.request().method()} ${response.url()}`.slice(
          0,
          300,
        ),
      );
    }
  });

  try {
    await signIn(page);
  } catch (error) {
    await page
      .screenshot({ path: path.join(folder, "sign-in-failed.png") })
      .catch(() => {});
    reports.push({
      name: "signing in",
      file: "sign-in-failed.png",
      isNamed: true,
      problems: [
        `could not sign in: ${error.message.split("\n")[0]}, at ${page.url()}`,
      ],
      emptyStates: [],
      consoleErrors: seen.consoleErrors,
      failedRequests: seen.failedRequests,
      pageErrors: seen.pageErrors,
    });
    save();
    await browser.close();
    return;
  }

  for (const target of spec.pages) {
    seen = { consoleErrors: [], failedRequests: [], pageErrors: [] };
    try {
      reports.push(await lookAt(page, target, seen));
    } catch (error) {
      reports.push({
        name: target.name,
        path: target.path,
        file: target.file,
        isNamed: Boolean(target.isNamed),
        problems: [`could not be read: ${error.message.split("\n")[0]}`],
        emptyStates: [],
        consoleErrors: seen.consoleErrors,
        failedRequests: seen.failedRequests,
        pageErrors: seen.pageErrors,
      });
    }
    save();
  }
  await browser.close();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
