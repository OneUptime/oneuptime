"use strict";

/**
 * The Probe's job installs what it needs from apt out of the Actions cache.
 *
 * Its suite runs Chromium and Firefox, under strace too, and compiles a shim
 * with gcc, so it cannot run in the Playwright image the other browser jobs
 * run in (Tests/Ops/PlaywrightImage): the browsers' system packages and fonts
 * (about 54 MB) and strace come from apt, and the runner's Ubuntu mirror
 * serves some runners at a few dozen kB/s (11 minutes on 2026-10-26, past 19
 * on another run). Scripts/GHA/apt_archive_cache.sh keeps what apt fetched
 * in the Actions cache, keyed on the runner image, and the next run on that
 * image installs it with no package source at all (its own tests:
 * Scripts/GHA/Tests/apt_archive_cache_test.sh).
 *
 * This holds the job to the wiring that makes that safe:
 *   - the runner image is named first, and the cache restored before
 *     anything installs, under a key of the image, the Probe's lockfile
 *     (its Playwright picks the browsers' packages) and this workflow (which
 *     names the rest);
 *   - the cache's packages are installed only on a hit, and a failed install
 *     there does not fail the job: every install from the mirror runs when
 *     the cache install did not succeed, after apt is told to keep what it
 *     downloads;
 *   - on a miss what apt kept is copied out and saved under the restore's
 *     own key, after the installs;
 *   - when the cache did install, the browsers alone are installed, without
 *     --with-deps (which asks apt again);
 *   - the suite itself runs whichever way the packages came.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { stepCommand } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = ".github/workflows/test.probe.yaml";
const SCRIPT = "./Scripts/GHA/apt_archive_cache.sh";
const ARCHIVES = "/var/cache/oneuptime-apt";
const CACHE_PATH = "${{ runner.temp }}/probe-apt";
const NOT_FROM_CACHE = "steps.apt-from-cache.outcome != 'success'";
const FROM_CACHE = "steps.apt-from-cache.outcome == 'success'";
const ON_A_HIT = "steps.apt-cache.outputs.cache-hit == 'true'";
const ON_A_MISS = "steps.apt-cache.outputs.cache-hit != 'true'";

const job = yaml.load(fs.readFileSync(path.join(REPO_ROOT, WORKFLOW), "utf8"))
  .jobs.test;
const steps = job.steps;

function indexWhere(predicate) {
  return steps.findIndex(predicate);
}

function command(step) {
  return stepCommand(step);
}

function isMirrorInstall(step) {
  const run = command(step);

  return (
    /\bplaywright\s+install\b[^\n]*--with-deps/.test(run) ||
    /\bapt-get\s+(update|install)\b/.test(run)
  );
}

const imageAt = indexWhere((step) => {
  return command(step) === `bash ${SCRIPT} image >>"$GITHUB_OUTPUT"`;
});
const restoreAt = indexWhere((step) => {
  return /^actions\/cache\/restore@/.test(step.uses || "");
});
const fromCacheAt = indexWhere((step) => {
  return step.id === "apt-from-cache";
});
const keepAt = indexWhere((step) => {
  return command(step) === `bash ${SCRIPT} keep ${ARCHIVES}`;
});
const copyOutAt = indexWhere((step) => {
  return command(step) === `bash ${SCRIPT} save ${ARCHIVES} "${CACHE_PATH}"`;
});
const saveAt = indexWhere((step) => {
  return /^actions\/cache\/save@/.test(step.uses || "");
});
const browsersAloneAt = indexWhere((step) => {
  return /\bplaywright\s+install\s+chromium\s+firefox$/.test(command(step));
});
const testAt = indexWhere((step) => {
  return command(step) === "cd packages/Probe && npm run test";
});
const mirrorInstalls = steps
  .map((step, index) => {
    return { step, index };
  })
  .filter(({ step }) => {
    return isMirrorInstall(step);
  });

describe(`${WORKFLOW}: what apt installs comes from the Actions cache`, () => {
  test("every step this suite reads is there", () => {
    expect({
      imageAt,
      restoreAt,
      fromCacheAt,
      keepAt,
      copyOutAt,
      saveAt,
      browsersAloneAt,
      testAt,
    }).toEqual({
      imageAt: expect.any(Number),
      restoreAt: expect.any(Number),
      fromCacheAt: expect.any(Number),
      keepAt: expect.any(Number),
      copyOutAt: expect.any(Number),
      saveAt: expect.any(Number),
      browsersAloneAt: expect.any(Number),
      testAt: expect.any(Number),
    });

    for (const at of [
      imageAt,
      restoreAt,
      fromCacheAt,
      keepAt,
      copyOutAt,
      saveAt,
      browsersAloneAt,
      testAt,
    ]) {
      expect(at).toBeGreaterThanOrEqual(0);
    }

    // The browsers' packages with --with-deps, and strace and gcc.
    expect(mirrorInstalls).toHaveLength(2);
  });

  test("the image is named, then the cache restored, under a key of the image, the Probe's lockfile and this workflow", () => {
    expect(steps[imageAt].id).toBe("runner-image");
    expect(imageAt).toBeLessThan(restoreAt);

    const restore = steps[restoreAt];

    expect(restore.id).toBe("apt-cache");
    expect(restore.with.path).toBe(CACHE_PATH);

    const key = String(restore.with.key);

    expect(key).toContain("${{ steps.runner-image.outputs.image }}");
    expect(key).toContain("packages/Probe/package-lock.json");
    expect(key).toContain(WORKFLOW);
    expect(key.startsWith("probe-apt-")).toBe(true);
  });

  test("nothing installs before the cache is restored", () => {
    for (const { index } of mirrorInstalls) {
      expect(index).toBeGreaterThan(restoreAt);
    }

    expect(fromCacheAt).toBeGreaterThan(restoreAt);
  });

  test("the cache's packages install only on a hit, and a failed install there falls back rather than failing the job", () => {
    const fromCache = steps[fromCacheAt];

    expect(fromCache.if).toBe(ON_A_HIT);
    expect(fromCache["continue-on-error"]).toBe(true);
    expect(command(fromCache)).toBe(`bash ${SCRIPT} install "${CACHE_PATH}"`);
    expect(Number(fromCache["timeout-minutes"])).toBeGreaterThan(0);
  });

  test("every install from the mirror runs when the cache install did not succeed, after apt is told to keep what it downloads", () => {
    expect(steps[keepAt].if).toBe(NOT_FROM_CACHE);

    for (const { step, index } of mirrorInstalls) {
      expect({ run: command(step), if: step.if }).toEqual({
        run: command(step),
        if: NOT_FROM_CACHE,
      });
      expect(index).toBeGreaterThan(keepAt);
    }
  });

  test("on a miss, what apt kept is copied out and saved under the restore's own key, after the installs", () => {
    const copyOut = steps[copyOutAt];
    const save = steps[saveAt];

    expect(copyOut.if).toBe(ON_A_MISS);
    expect(save.if).toBe(ON_A_MISS);
    expect(save.with.path).toBe(CACHE_PATH);
    expect(save.with.key).toBe(
      "${{ steps.apt-cache.outputs.cache-primary-key }}",
    );

    for (const { index } of mirrorInstalls) {
      expect(copyOutAt).toBeGreaterThan(index);
    }

    expect(saveAt).toBeGreaterThan(copyOutAt);
  });

  test("when the cache installed, the browsers alone are installed, without asking apt again", () => {
    const browsersAlone = steps[browsersAloneAt];

    expect(browsersAlone.if).toBe(FROM_CACHE);
    expect(command(browsersAlone)).not.toContain("--with-deps");
    expect(browsersAloneAt).toBeGreaterThan(fromCacheAt);
  });

  test("the suite runs whichever way the packages came, last", () => {
    const suite = steps[testAt];

    expect(suite.if).toBeUndefined();
    expect(testAt).toBeGreaterThan(
      Math.max(
        browsersAloneAt,
        saveAt,
        ...mirrorInstalls.map(({ index }) => {
          return index;
        }),
      ),
    );
  });

  test("the job's limit holds every step's on either way through", () => {
    const limited = steps.reduce((sum, step) => {
      return sum + Number(step["timeout-minutes"] || 0);
    }, 0);

    // 7 minutes for checkout, Node and the npm installs, as BrowserInstallLimits counts them.
    expect(Number(job["timeout-minutes"])).toBeGreaterThanOrEqual(limited + 7);
  });
});
