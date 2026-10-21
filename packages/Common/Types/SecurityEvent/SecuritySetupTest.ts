/*
 * The setup test (Security Events > Overview > "Run a test"): a harmless
 * simulated attack - a dozen failed sign-ins from one documentation
 * address - sent through the real pipeline, so a new project sees a case
 * open before it has a real one.
 *
 * Every event the test writes carries SETUP_TEST_PRODUCT_NAME, which is how
 * the rest of the product keeps the test to itself: SIEM destinations never
 * send these events, and the test's rule reads only them.
 */

// A documentation address (RFC 5737), never a real attacker.
export const SETUP_TEST_SOURCE_IP: string = "203.0.113.77";
export const SETUP_TEST_USER: string = "setup-test-user";
export const SETUP_TEST_HOST: string = "oneuptime-setup-test";
export const SETUP_TEST_VENDOR_NAME: string = "OneUptime";
export const SETUP_TEST_PRODUCT_NAME: string = "OneUptime setup test";
export const SETUP_TEST_ATTRIBUTE: string = "oneuptime.setup_test";

// The brute force rule needs ten in its window; a dozen is plainly more.
export const SETUP_TEST_EVENT_COUNT: number = 12;

// How far back the test's rule reads its events.
export const SETUP_TEST_WINDOW_IN_MINUTES: number = 10;
