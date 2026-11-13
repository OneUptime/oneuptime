import { DashboardRecordingConfig } from "./DashboardRecordingConfig";
import { DashboardRecordingDecision } from "./DashboardRecordingGate";
import DashboardSignals, { DashboardSignalHit } from "./DashboardSignals";
import { GuidedSetupPlace } from "./GuidedSetupContext";

/*
 * WHAT THE RECORDER IS TOLD, AS THE PERSON MOVES (issue #6834).
 *
 * DashboardRecording (the component) works out the gate's decision on every
 * page and every change of a switch, and hands it here. This decides what
 * that means for the recorder:
 *
 *   - Record, and nothing loaded yet: load the recorder (import(), the
 *     first and only time anything of it is fetched) and start it.
 *   - Record, and it is paused: resume it - the same session, on a fresh
 *     snapshot of the page now.
 *   - PageNotRecorded: pause it. Nothing on this page is captured.
 *   - Anything else - consent gone, the person or the project switched it
 *     off: stop, keeping nothing not yet sent, and never start again on this
 *     page load.
 *
 * It also counts the Dashboard's signs of frustration (DashboardSignals)
 * and marks them, and the product events (#6830), on the recording - only
 * while it records. Where the person is goes in the recording's tags: the
 * page's route pattern, and the guided setup and its step; a marker's own
 * properties are masked like the page, so they cannot carry it.
 *
 * No React and no network: the recorder comes from `loadRecorder`, so the
 * tests drive every move.
 */

export interface DashboardRecorderHandle {
  start: (
    config: DashboardRecordingConfig,
    options?: { startPaused?: boolean | undefined } | undefined,
  ) => void;
  pause: () => void;
  resume: () => void;
  track: (name: string) => void;
  setTags: (tags: Record<string, string>) => void;
  stop: () => void;
}

export interface DashboardRecordingState {
  decision: DashboardRecordingDecision;
  config: DashboardRecordingConfig | null;
  // The page's route pattern, never its address.
  page: string;
  /*
   * The project in view is a sample one (#6808): exploring the sample is
   * not setting up for real, and the weekly view tells them apart.
   */
  isSampleProject?: boolean | undefined;
}

export interface DashboardRecordingControllerOptions {
  loadRecorder: () => Promise<DashboardRecorderHandle>;
  now?: (() => number) | undefined;
}

export enum DashboardRecorderStatus {
  NotLoaded = "not-loaded",
  Loading = "loading",
  Recording = "recording",
  Paused = "paused",
  Stopped = "stopped",
}

export default class DashboardRecordingController {
  private readonly loadRecorder: () => Promise<DashboardRecorderHandle>;
  private readonly now: () => number;
  private readonly signals: DashboardSignals = new DashboardSignals();

  private recorder: DashboardRecorderHandle | null = null;
  private status: DashboardRecorderStatus = DashboardRecorderStatus.NotLoaded;
  private latest: DashboardRecordingState | null = null;
  private page: string | null = null;
  private place: GuidedSetupPlace | null = null;

  public constructor(options: DashboardRecordingControllerOptions) {
    this.loadRecorder = options.loadRecorder;
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
  }

  public getStatus(): DashboardRecorderStatus {
    return this.status;
  }

  public update(state: DashboardRecordingState): void {
    this.latest = state;

    const hits: Array<DashboardSignalHit> =
      state.page !== this.page
        ? this.signals.notePage(state.page, this.now())
        : [];
    const hasPageChanged: boolean = state.page !== this.page;

    this.page = state.page;

    if (this.status === DashboardRecorderStatus.Stopped) {
      return;
    }

    const isRecordedHere: boolean =
      state.decision === DashboardRecordingDecision.Record;
    const mayRecord: boolean =
      isRecordedHere ||
      state.decision === DashboardRecordingDecision.PageNotRecorded;

    if (this.status === DashboardRecorderStatus.NotLoaded) {
      if (isRecordedHere && state.config) {
        this.load(state.config);
      }

      return;
    }

    if (this.status === DashboardRecorderStatus.Loading) {
      // What it starts as is decided when it arrives, from the latest state.
      return;
    }

    if (!mayRecord) {
      this.stop();
      return;
    }

    if (isRecordedHere) {
      const wasPaused: boolean = this.status === DashboardRecorderStatus.Paused;

      if (wasPaused) {
        this.recorder?.resume();
        this.status = DashboardRecorderStatus.Recording;
      }

      this.mark(hits);

      if (hasPageChanged || wasPaused) {
        this.applyTags();
      }

      return;
    }

    // Leaving for a page that is not recorded: what leaving said, then pause.
    this.mark(hits);

    if (this.status === DashboardRecorderStatus.Recording) {
      this.recorder?.pause();
      this.status = DashboardRecorderStatus.Paused;
    }
  }

  // A click or a key: the person, not a redirect, is on this page.
  public noteInput(): void {
    this.signals.noteInput();
  }

  // A form on this page refused the person.
  public noteFormRefusal(): void {
    this.mark(this.signals.noteFormRefusal());
  }

  // One of the Dashboard's product events (#6830), by its name.
  public noteProductEvent(name: string): void {
    if (this.status === DashboardRecorderStatus.Recording && this.recorder) {
      this.recorder.track(name);
    }
  }

  // Where in a guided setup the person is, from GuidedSetupFrame.
  public noteGuidedSetupPlace(place: GuidedSetupPlace | null): void {
    this.place = place;
    this.applyTags();
  }

  private load(config: DashboardRecordingConfig): void {
    this.status = DashboardRecorderStatus.Loading;

    this.loadRecorder()
      .then((recorder: DashboardRecorderHandle): void => {
        const latest: DashboardRecordingState | null = this.latest;

        if (
          !latest ||
          (latest.decision !== DashboardRecordingDecision.Record &&
            latest.decision !== DashboardRecordingDecision.PageNotRecorded)
        ) {
          // Withdrawn while it loaded: it never starts.
          this.status = DashboardRecorderStatus.Stopped;
          return;
        }

        const startPaused: boolean =
          latest.decision !== DashboardRecordingDecision.Record;

        this.recorder = recorder;
        recorder.start(latest.config || config, { startPaused: startPaused });
        this.status = startPaused
          ? DashboardRecorderStatus.Paused
          : DashboardRecorderStatus.Recording;
        this.applyTags();
      })
      .catch((): void => {
        // It could not load: nothing records on this page load.
        this.status = DashboardRecorderStatus.Stopped;
      });
  }

  private stop(): void {
    this.recorder?.stop();
    this.status = DashboardRecorderStatus.Stopped;
  }

  private mark(hits: Array<DashboardSignalHit>): void {
    if (this.status !== DashboardRecorderStatus.Recording || !this.recorder) {
      return;
    }

    for (const hit of hits) {
      this.recorder.track(hit.name);
    }
  }

  private applyTags(): void {
    if (this.status !== DashboardRecorderStatus.Recording || !this.recorder) {
      return;
    }

    const tags: Record<string, string> = {
      page: this.page || "",
      sample_project: this.latest?.isSampleProject ? "true" : "false",
    };

    if (this.place) {
      tags["guided_setup"] = this.place.setup;
      tags["guided_setup_step"] = this.place.step;
    }

    this.recorder.setTags(tags);
  }
}
