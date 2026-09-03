/*
 * The AI triage verdict and the fault domain declared by the throwing code are
 * the SAME vocabulary, so they are the same enum. It lives in
 * Common/Types/Telemetry/ErrorClass.ts, which is importable from the emit path
 * (Types-only, no server dependencies) as well as from the AI lane.
 *
 * This path is kept so the triage runner, the insight scanner and their tests
 * keep compiling — and because "the AI's verdict" is a genuinely useful name
 * at those call sites. It is one SOURCE of the field, not a separate concept:
 * a class declared by the throwing code outranks it, and a human's click
 * outranks both.
 */
export { default } from "../Telemetry/ErrorClass";
