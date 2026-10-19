/*
 * THE BUNDLED GLOBAL RUNNER
 *
 * Every OneUptime install runs a global Runner of its own, on by default, as
 * it runs its own global probes: the Helm chart's `globalRunner` deployment
 * and the Docker Compose `global-runner` service. It is the ordinary Runner
 * image started with this fixed id and the install's GLOBAL_RUNNER_KEY, and
 * nothing else - no cluster key and none of the server's settings - so a
 * step that runs on it can reach no more than the step's own sandbox does
 * (GlobalRunnerWork).
 *
 * The server keeps its row from that same key on every boot (the App's
 * SeedBundledGlobalRunner startup migration): created while the key is set,
 * its key updated when the key changes, and removed when the key is unset -
 * the bundled global Runner turned off - so no project lists a global Runner
 * nobody runs. Its id is fixed, so the deployment needs no id from anyone and
 * a changed key never leaves a second row behind; global Runners a master
 * admin adds under Admin Dashboard -> Settings -> Global Runners get ids of
 * their own and are never touched by it.
 *
 * The Helm chart and docker-compose.base.yml write this id as it stands
 * here; Tests/Ops/BundledGlobalRunner.test.js holds them to it.
 */

export const BUNDLED_GLOBAL_RUNNER_ID: string =
  "00000000-0000-0000-0000-000000000002";

// What every project's Runners page calls it, until a master admin renames it.
export const BUNDLED_GLOBAL_RUNNER_NAME: string = "Global Runner";

export const BUNDLED_GLOBAL_RUNNER_DESCRIPTION: string =
  "Runs with this server.";

// The App reads the key from here; the bundled global Runner gets the same value.
export const GLOBAL_RUNNER_KEY_ENV: string = "GLOBAL_RUNNER_KEY";

/*
 * How many bundled global Runners the install runs (Docker Compose
 * GLOBAL_RUNNER_REPLICAS, the chart's globalRunner.replicaCount). Unset reads
 * as one; "0" turns it off as an unset key does.
 */
export const GLOBAL_RUNNER_REPLICAS_ENV: string = "GLOBAL_RUNNER_REPLICAS";
