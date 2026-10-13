/*
 * Build the alarm sounds a critical on-call page can play
 * (src/notifications/criticalAlertSounds.ts) into assets/sounds/.
 *
 * Every sound is synthesised here from plain arithmetic - no samples, no
 * recordings, nothing licensed - so the files carry no third-party rights and
 * anyone can rebuild them. The output is deterministic: the same script
 * writes the same audio, and src/notifications/criticalAlertSoundFiles.test.ts
 * checks the committed files against it.
 *
 * The format is what both platforms play as a notification sound:
 *   - 16-bit linear PCM WAV, mono, 16 kHz. iOS plays only linear PCM, MA4,
 *     uLaw or aLaw notification sounds; Android plays WAV from res/raw.
 *   - Under 30 seconds. iOS plays the default sound instead of a longer one.
 *   - Lowercase letters, digits and underscores in the name: Android resource
 *     names allow nothing else.
 *
 * Run: node packages/MobileApp/scripts/generate-critical-alert-sounds.js
 * (add `--out <directory>` to write the files somewhere else, as the test
 * that checks the committed files does).
 */
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const SAMPLE_RATE = 16000;

// The highest partial any tone may carry, comfortably below Nyquist (8 kHz).
const MAX_PARTIAL_HZ = 7200;

// Loudest sample, as a fraction of full scale: -1 dBFS, so no player clips.
const PEAK = 0.89;

// How long the end of every sound takes to fade to silence.
const FADE_OUT_SECONDS = 0.05;

/*
 * A tone whose pitch may glide, built from harmonics only up to
 * MAX_PARTIAL_HZ so nothing folds back as aliasing. `partials` lists each
 * harmonic's number and level.
 */
function createTone(partials) {
  let phase = 0;

  return (frequency) => {
    phase += (2 * Math.PI * frequency) / SAMPLE_RATE;

    if (phase > 2 * Math.PI * 1e6) {
      phase -= 2 * Math.PI * 1e6;
    }

    let value = 0;

    for (const [harmonic, level] of partials) {
      if (harmonic * frequency < MAX_PARTIAL_HZ) {
        value += level * Math.sin(harmonic * phase);
      }
    }

    return value;
  };
}

// Odd harmonics at 1/n: a band-limited square wave - the buzz of a horn or beeper.
function squarePartials(count) {
  const partials = [];

  for (let harmonic = 1; harmonic <= count * 2; harmonic += 2) {
    partials.push([harmonic, 1 / harmonic]);
  }

  return partials;
}

// Every harmonic at 1/n: a band-limited sawtooth - brassy and harsh.
function sawPartials(count) {
  const partials = [];

  for (let harmonic = 1; harmonic <= count; harmonic++) {
    partials.push([harmonic, 1 / harmonic]);
  }

  return partials;
}

/*
 * A burst's level at `time` seconds into a burst of `length` seconds: up over
 * `attack`, down over `release`, so no burst starts or stops with a click.
 */
function gate(time, length, attack, release) {
  if (time < 0 || time >= length) {
    return 0;
  }

  if (time < attack) {
    return time / attack;
  }

  if (time > length - release) {
    return Math.max(0, (length - time) / release);
  }

  return 1;
}

function triangle(position) {
  const fraction = position - Math.floor(position);

  return fraction < 0.5 ? fraction * 2 : 2 - fraction * 2;
}

/*
 * Klaxon: the "ah-oo-gah" of a ship's horn. Each blast is a two-note chord on
 * a buzzing reed tone that swoops up into pitch and sags at the end, with a
 * growl on top. Blast after blast, without letting up.
 */
function renderKlaxon(samples) {
  const blastLength = 0.66;
  const blastPeriod = 0.88;
  const low = createTone(sawPartials(18));
  const high = createTone(sawPartials(14));

  for (let index = 0; index < samples.length; index++) {
    const time = index / SAMPLE_RATE;
    const blastTime = time % blastPeriod;
    const swoop =
      blastTime < 0.15
        ? 0.62 + 0.38 * (blastTime / 0.15)
        : blastTime > blastLength - 0.12
          ? 1 - 0.1 * ((blastTime - (blastLength - 0.12)) / 0.12)
          : 1;
    const frequency = 365 * swoop;
    const growl = 1 - 0.28 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 31 * time));
    const level = gate(blastTime, blastLength, 0.008, 0.03);

    samples[index] =
      level * growl * (low(frequency) + 0.8 * high(frequency * 1.26));
  }

  return { drive: 2.2 };
}

/*
 * Siren: an emergency vehicle's wail - a slow sweep from low to high and back
 * - that breaks into the fast "yelp" for the second half.
 */
function renderSiren(samples) {
  const tone = createTone([
    [1, 1],
    [2, 0.45],
    [3, 0.28],
    [4, 0.12],
  ]);
  const wailEnds = 9;
  const length = samples.length / SAMPLE_RATE;

  for (let index = 0; index < samples.length; index++) {
    const time = index / SAMPLE_RATE;
    const sweep =
      time < wailEnds
        ? 0.5 - 0.5 * Math.cos((2 * Math.PI * time) / 3)
        : triangle((time - wailEnds) / 0.34);
    const frequency = 640 + 760 * sweep;

    samples[index] = gate(time, length, 0.02, 0.08) * tone(frequency);
  }

  return { drive: 1.6 };
}

/*
 * Digital alarm: the bedside alarm clock - four sharp beeps and a breath,
 * over and over, which runs together into one rapid beeping for the last few
 * seconds.
 */
function renderDigital(samples) {
  const tone = createTone(squarePartials(2));
  const rapidFrom = 10.5;

  for (let index = 0; index < samples.length; index++) {
    const time = index / SAMPLE_RATE;
    let level;

    if (time < rapidFrom) {
      const groupTime = time % 1.1;
      const beepTime = groupTime % 0.16;
      level = groupTime < 0.64 ? gate(beepTime, 0.1, 0.003, 0.004) : 0;
    } else {
      level = gate((time - rapidFrom) % 0.12, 0.07, 0.003, 0.004);
    }

    samples[index] = level * tone(2048);
  }

  return { drive: 1.3 };
}

/*
 * Smoke alarm: the three-beep pattern every fire alarm uses (ISO 8201's
 * "temporal three") on a piercing 3.1 kHz piezo tone - three half-second
 * beeps, a pause, and again. A sound people are trained to get up for.
 */
function renderSmokeAlarm(samples) {
  const tone = createTone([
    [1, 1],
    [2, 0.22],
  ]);

  for (let index = 0; index < samples.length; index++) {
    const time = index / SAMPLE_RATE;
    const cycleTime = time % 4;
    const beepTime = cycleTime % 1;
    const level = cycleTime < 3 ? gate(beepTime, 0.5, 0.004, 0.006) : 0;
    const rasp = 1 - 0.18 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 62 * time));

    samples[index] = level * rasp * tone(3150);
  }

  return { drive: 1.3 };
}

/*
 * Rising alarm: starts as a soft, slow pulse and keeps getting louder and
 * faster, switching to an alternating two-note call at the top - for
 * somebody who would rather be woken gently, but woken.
 */
function renderRising(samples) {
  const lower = createTone([
    [1, 1],
    [3, 0.22],
    [5, 0.08],
  ]);
  const upper = createTone([
    [1, 1],
    [3, 0.22],
    [5, 0.08],
  ]);
  const length = samples.length / SAMPLE_RATE;
  const fullFrom = 18;
  const alternateFrom = 16;
  let pulse = 0;

  for (let index = 0; index < samples.length; index++) {
    const time = index / SAMPLE_RATE;
    const rate = 1.2 * Math.pow(5 / 1.2, time / length);

    pulse += rate / SAMPLE_RATE;

    const pulseNumber = Math.floor(pulse);
    const pulseTime = (pulse - pulseNumber) / rate;
    const level = gate(pulseTime, 0.5 / rate, 0.006, 0.012);
    const loudness =
      time >= fullFrom ? 1 : 0.18 * Math.pow(1 / 0.18, time / fullFrom);
    const isHighPulse = time >= alternateFrom && pulseNumber % 2 === 1;
    const root = isHighPulse ? 1046.5 : 880;

    samples[index] = level * loudness * (lower(root) + 0.7 * upper(root * 1.5));
  }

  return { drive: 1.5 };
}

/*
 * The sounds, by file. `seconds` is each file's length; every one is well
 * under iOS's 30.
 */
const SOUNDS = [
  { fileName: "oneuptime_klaxon.wav", seconds: 15, render: renderKlaxon },
  { fileName: "oneuptime_siren.wav", seconds: 15, render: renderSiren },
  { fileName: "oneuptime_digital.wav", seconds: 15, render: renderDigital },
  {
    fileName: "oneuptime_smoke_alarm.wav",
    seconds: 15,
    render: renderSmokeAlarm,
  },
  { fileName: "oneuptime_rising.wav", seconds: 25, render: renderRising },
];

/*
 * One sound as 16-bit samples: rendered, pushed into a soft limiter (`drive`)
 * so it is as loud as it can be without harsh clipping, and scaled so its
 * loudest sample sits at PEAK.
 */
function renderSamples(sound) {
  const samples = new Float64Array(Math.round(sound.seconds * SAMPLE_RATE));
  const { drive } = sound.render(samples);

  /*
   * The file may end in the middle of a blast or a beep. Faded out over the
   * last moment, it stops instead of ending in a click.
   */
  const fadeLength = Math.round(FADE_OUT_SECONDS * SAMPLE_RATE);

  for (let index = 0; index < fadeLength; index++) {
    samples[samples.length - 1 - index] *= index / fadeLength;
  }

  let peak = 0;

  for (let index = 0; index < samples.length; index++) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }

  const limited = new Float64Array(samples.length);
  let limitedPeak = 0;

  for (let index = 0; index < samples.length; index++) {
    limited[index] = Math.tanh((drive * samples[index]) / (peak || 1));
    limitedPeak = Math.max(limitedPeak, Math.abs(limited[index]));
  }

  const output = new Int16Array(samples.length);

  for (let index = 0; index < samples.length; index++) {
    output[index] = Math.round(
      (limited[index] / (limitedPeak || 1)) * PEAK * 32767,
    );
  }

  return output;
}

// A RIFF/WAVE file around the samples: one fmt chunk (linear PCM), one data chunk.
function encodeWav(samples) {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // linear PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // bytes per second
  buffer.writeUInt16LE(2, 32); // bytes per sample frame
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < samples.length; index++) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }

  return buffer;
}

function renderWav(fileName) {
  const sound = SOUNDS.find((candidate) => {
    return candidate.fileName === fileName;
  });

  if (!sound) {
    throw new Error(`No critical alert sound is built as ${fileName}.`);
  }

  return encodeWav(renderSamples(sound));
}

const SOUNDS_DIRECTORY = path.resolve(__dirname, "../assets/sounds");

function generateCriticalAlertSounds(directory) {
  mkdirSync(directory, { recursive: true });

  for (const sound of SOUNDS) {
    const destination = path.join(directory, sound.fileName);

    writeFileSync(destination, renderWav(sound.fileName));
    process.stdout.write(
      `Generated ${path.relative(process.cwd(), destination)}\n`,
    );
  }
}

// `--out <directory>`, or the app's own assets/sounds.
function outputDirectory(args) {
  const flag = args.indexOf("--out");

  if (flag === -1) {
    return SOUNDS_DIRECTORY;
  }

  if (!args[flag + 1]) {
    throw new Error("--out needs a directory.");
  }

  return path.resolve(args[flag + 1]);
}

if (require.main === module) {
  try {
    generateCriticalAlertSounds(outputDirectory(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SAMPLE_RATE,
  PEAK,
  SOUNDS,
  SOUNDS_DIRECTORY,
  renderWav,
};
