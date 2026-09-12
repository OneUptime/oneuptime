# Session Replay playback smoothness

Why playback stuttered, what shipped for each cause, what was considered and
rejected, and what is left. Written after an investigation that read the
player, the engine, the chunk loader, the transport, the server route and the
recorder end to end.

---

## 1. What "smooth" means here

Five things, in the order a viewer notices them:

1. **No dropped frames while playing.** rrweb casts recorded mutations from
   its own `requestAnimationFrame` loop on the main thread. Anything else
   that occupies that thread for more than a few milliseconds per frame —
   React reconciliation, `JSON.parse`, a synchronous DOM rebuild — shows up
   as a stutter in the picture.
2. **No buffering stalls** at 1x–8x on an ordinary connection.
3. **Fast first frame and fast seeks**, with no blank or half-built frame in
   between.
4. **Continuous motion**: the cursor, scrolling and typing look like what the
   end user did, not like a slideshow.
5. **Controls that always respond.** Space, the arrows and the scrubber must
   work at every moment of playback.

Out of scope, deliberately: masking and privacy policy, ingest correctness,
the session list, billing.

---

## 2. How this was investigated

Six reviewers each read the code through one lens — React render cost, chunk
loading and decoding, bytes on the wire, Replayer configuration, recorder
capture fidelity, and engine timing — and reported findings with file-and-line
evidence. Every finding was then attacked twice: once by a reviewer trying to
show the defect was not real or not perceptible, and once by a reviewer
checking whether the proposed fix could be made without breaking a pinned
invariant, a test, the iframe sandbox, the audit ordering, or the recorder's
wire contract.

| Stage | Count |
|---|---|
| Raw findings | 40 |
| After de-duplication | 39 |
| Confirmed real and perceptible | 18 |
| Rejected on the evidence | 21 |

The rejected list is section 6, recorded so nobody spends the time again.

---

## 3. Measurements

Taken on a development machine, so treat the absolute numbers as indicative
and the ratios as the point.

| Measurement | Result |
|---|---|
| `JSON.parse` of one full 8-chunk page (8.4 MB of recorded JSON) | 200–340 ms, in one synchronous block |
| `JSON.parse` of a single 1 MB chunk | ~47 ms |
| gzip level 4 of that page | 8.7x smaller (8.4 MB → 0.97 MB) in 133 ms |
| brotli quality 4 of that page | 11.8x smaller, 270 ms |
| React work per 33 ms engine publish (45-minute session, jsdom profiler) | scrubber 11 ms avg / 40 ms max; rail 3.8 ms avg / 89 ms max; header 1.2 ms; overlays 0.5 ms |

One dropped frame at 60 Hz is anything over ~16 ms of main thread. The page
parse alone is 12–20 dropped frames every time a page lands. The React
reconciliation was a steady 10–20% of every frame while playing, with spikes
far over a frame whenever the rail's window shifted.

---

## 4. What shipped

### 4.1 The whole player tree reconciled 30 times a second

**Was.** `SessionReplayPlayer` subscribed to the engine's whole snapshot
through `useSyncExternalStore`. `publish()` builds a new snapshot object at
most every 33 ms while playing, so every publish re-rendered the header, the
overlays, the stage, the transport, the timeline and the 1800-line rail —
synchronously, in the same frame rrweb was casting mutations into.

**Now.** The engine publishes on two channels. The *structural* snapshot keeps
its object identity until something other than the playhead changes; the
*clock* channel carries the playhead alone. The composition root subscribes to
the structural channel only, so it re-renders on real transitions. Each part
that needs the time subscribes itself, at the coarsest quantum it can live
with, through small memoised wrappers: the timeline's needle every frame
(16 ms), the transport every 100 ms, the header, rail and overlays every
250 ms. The rail gets the exact playhead while paused, because its divider
shows tenths and there is no frame budget to protect then.

The structural comparator is written as one comparator per snapshot field, so
adding a field to the snapshot fails to compile rather than silently becoming
clock-only.

A paused seek inside the fed range is now provably clock-only: it moves the
playhead and repaints through the Replayer, and reconciles nothing.

### 4.2 Chunk pages travelled uncompressed

**Was.** `/chunks` sends `application/octet-stream`, which is deliberately
outside nginx's `gzip_types`, and there is no compression middleware. Pages of
up to 8 MB of JSON text went out as-is.

**Now.** The route gzips the framed body with async zlib at level 4 when the
client's `Accept-Encoding` allows it and the body is at least 1 KB, setting
`Content-Encoding`, `Vary: Accept-Encoding` and the real `Content-Length`.
`Cache-Control: no-store`, the omitted-chunks header and the 8 MB prefix cap
(still computed on the uncompressed frames) are untouched, as is the
audit-row-before-bytes ordering. Async, so the API event loop never blocks on
a page. Expect roughly 9x fewer bytes.

### 4.3 A whole page decoded in one synchronous block

**Was.** The loader parsed every frame of a page in one call when the response
landed, then admitted them all; the feed loop then pushed a whole chunk into
rrweb in one uninterrupted loop.

**Now.** Frames are decoded through a generator and the loader yields to the
browser (`scheduler.yield`, else `MessageChannel`, else `setTimeout(0)`) once
512 KB have been admitted since the last yield, re-checking its generation
after every yield so a dispose mid-page drops the rest. The first frame is
admitted without a yield, so time-to-first-frame is unchanged. The feed loop
yields between already-decoded chunks too, but never before the chunk a
stalled resume is waiting on.

### 4.4 Every buffering stall resumed with a full snapshot rebuild

**Was.** When rrweb drains everything it has been fed it sends itself `END`,
and `END` clears `lastPlayedEvent`. The next `play(t)` therefore rebuilt the
DOM from the last full snapshot and re-applied up to 60 s of events
synchronously — a visible hitch on every stall.

**Now.** The engine remembers the last event it fed and, when rrweb casts that
exact object with more footage still in the manifest, pauses the Replayer in a
microtask before rrweb's 50 ms finish timer fires. A plain pause keeps
`lastPlayedEvent`, so the resume applies nothing and the stall costs a pause
and a play. The end of a recording is unaffected: the pre-emption is gated on
there being a next chunk.

### 4.5 Returning to a hidden tab burst-cast the whole hidden span

**Was.** Browsers suspend `requestAnimationFrame` in a hidden tab. rrweb's
timer measures elapsed wall clock at the next frame, so on return it cast
every action from the hidden span in one synchronous loop, then drained and
stalled — which then triggered 4.4 as well.

**Now.** The engine subscribes to `visibilitychange`, suspends the Replayer
while the document is hidden (the viewer's intent stays "playing", so the
phase does not flicker) and resumes with `play(getCurrentTime())`. A viewer
who paused while away stays paused.

### 4.6 Replayed focus events stole the keyboard

**Was.** rrweb's `triggerFocus` defaults to true and calls `focus()` on the
element inside the sandboxed replay iframe for every recorded focus. That
makes the iframe the Dashboard's `activeElement`, so `keydown` fires in the
iframe's document and never reaches the window listener the shortcuts hang
off. Space, the arrows and the speed keys died the first time the recorded
user clicked into a field.

**Now.** `triggerFocus: false`, pinned by a test beside the other
never-flip-these keys. Input values still render; only the replayed caret and
focus ring are lost.

### 4.7 The held frame was dropped before the new one had landed

**Was.** On a cross-anchor seek the previous frame is held until the new
Replayer reports its first rebuild. For a seek landing well past its anchor,
that first rebuild shows the *anchor's* frame, so the picture jumped twice.

**Now.** The newcomer stays hidden until it has both rebuilt and landed, and
the fallback timer is armed per created Replayer. A second seek that retires a
still-hidden newcomer keeps the frame the viewer was actually looking at.

### 4.8 Capture cadence, and a cursor that parked between samples

**Was.** The recorder sampled mouse movement every 100 ms and scroll every
150 ms (the library's defaults are 50 and 100), and typing used `input:
"last"`, which only listens to `change` — so a typed value appeared as one
snap on blur. The stage's cursor transition was 80 ms divided by speed:
shorter than the 100 ms gap, so the pointer moved for 80 ms and parked for 20.

**Now.** The cadences are shared constants in `Common/Types/Rum/SessionReplay.ts`
(`SESSION_REPLAY_MOUSEMOVE_SAMPLE_MS` 50, `SESSION_REPLAY_SCROLL_SAMPLE_MS`
100, `SESSION_REPLAY_INPUT_SAMPLING` "all"). The recorder advertises a
`mousemove-50ms` capability on chunk 0, and the stage derives its cursor
transition from the recording's own cadence divided by the speed, with a
one-frame floor — so consecutive segments abut instead of parking. Recordings
made before the capability keep the 100 ms interval they were recorded at, so
old footage is not given a transition shorter than its gap.

Masked fields still cost one event per typing run: the mask is constant-width
and the recording library drops a repeated identical value, and the 250 ms
timestamp quantisation still removes the inter-keystroke timing channel. Cost
to the customer: a few kilobytes per 15-second chunk before compression.

### 4.9 Timeline lanes and rail body re-rendered per tick

Memoised band, marker-lane, activity-strip and playhead components with a
per-lane marker map; a binary search for the rail's active row instead of a
linear scan; a memoised per-row link map so the row memo actually holds.
Together with 4.1 these now render only when their own inputs change.

### 4.10 Signals re-adapted on every fed chunk

The loader caches `getTimelineEvents()` behind a version that only advances
when a chunk's rows are actually extracted, and the signal adapter caches by
input-array identity and session start. A feed that adds no rows no longer
rebuilds thousands of signal objects.

### 4.11 A fixed 15 s fetch timeout regardless of page size

The per-attempt timeout is now 15 s plus the planned bytes at 256 KB/s, so a
large page on a slow link is not restarted from byte zero every 15 s.

### 4.12 Backward seeks inside a segment froze the UI

The engine marks the seek landed and publishes before applying the transport,
so the seeking state paints before the synchronous re-apply.

---

## 4b. Found by the review of this change

An adversarial pass over the finished diff found one real regression and four
smaller issues. All five are fixed; the first has a regression test that was
confirmed to fail without the fix.

- **The held frame was never released when a build failed before creating a
  Replayer.** Arming the 2-second fallback in `build()` rather than in
  `retireSegment()` meant that a seek whose anchor page never arrived reached
  `halt()` with no newcomer to reveal and nothing armed to clean up: the
  previous frame stayed on screen, dimmed, under "Playback stopped" for the
  rest of the session, and its Replayer — the iframe plus every parsed event
  of the segment — was never freed. Retry did not clear it either. `halt()`
  now destroys the holdover when there is no segment to reveal.
- **The visibility resume could restart a halted engine.** A chunk failing
  while the tab was hidden left the intent "playing", so returning ran the
  picture on under the error overlay with a frozen clock. The resume now
  checks the buffer state.
- **The per-attempt fetch timeout had tripled.** Scaling by page bytes put
  143 seconds between a dead connection and the error explaining it, against
  45 before — and the scaling is measured on uncompressed bytes, which
  compression now makes several times too generous. The attempt is capped at
  30 seconds, which keeps the flat timeout's original promise that a hung
  socket does not read as a frozen player.
- **The memo on each clock wrapper never bailed out**, because each receives
  a freshly allocated props bag. The comment claimed an isolation the code
  did not have; it now says what is true, which is that the isolation comes
  from the root not re-rendering at all between structural changes.
- **A rail test would have passed with its fix reverted.** It asserted DOM
  node identity, which React preserves anyway through stable keys. It now
  counts calls to the route builder.

The review separately confirmed, by reading: all seven engine invariants still
hold; the stall pre-emption is genuinely effective against the real library's
state machine; the structural comparator cannot silently drop a new field; the
only reader of the structural snapshot's stale clock is safe; the compression
path preserves the no-store header, the byte cap and the error path; and
`input: "all"` creates no keystroke-length oracle, because the mask is
constant-width and identical repeats are dropped.

One consequence worth knowing: chunks close on whichever of 15 seconds or
256 KB comes first, so on very busy pages the extra samples reach the byte
threshold sooner and the per-session chunk cap arrives in roughly half the
wall-clock time. Time-driven sessions are unaffected.

---

## 5. Left for later

- **Stream the chunk page.** The server still builds the whole page and sends
  it in one buffer, so client-side streaming decode could only overlap with
  the transfer, not with the ClickHouse read. With gzip in place the remaining
  win is small on ordinary links; it becomes worth doing for very large
  snapshots on slow ones. Shape: write frames through `zlib.createGzip` as
  they are framed, read `response.body` in the loader, resolve each chunk as
  its own frame completes.
- **Run the manifest's identity lookup concurrently with the manifest read.**
  Safe — the audit row still lands first — but worth only one point lookup per
  open.
- **Audit `Recorder.test.ts` for recorders that are never stopped.** Nine
  tests construct a recorder directly rather than through the helper; the
  orphans keep reporting into later tests because the library's observers are
  delegated on the document. The new sampling tests run first to stay clear of
  it, and the shared helper now stops its predecessor, but the raw
  constructions remain.

---

## 6. Considered and rejected

Each was raised by a reviewer and refuted on the evidence. Recorded so it is
not re-investigated.

| Item | Why it was rejected |
|---|---|
| Loader stats getters allocate on every render | 8–200 microseconds; two orders of magnitude below perceptible |
| Inline object props defeat `React.memo` on header and overlays | Those take a per-tick prop anyway; the real fix is the clock split (4.1) |
| Header formats timezone strings per tick | ~6 microseconds per call; the large jsdom number was reconciliation, owned by 4.1 |
| Stage re-renders per tick | No DOM writes result; its style effects are keyed on recorded size and scale |
| Overlays resolve the URL and idle band per tick | Microseconds; the measured cost was reconciliation, owned by 4.1 |
| The 30 s live poll replaces the manifest | Once per 30 s, low single-digit ms, and new chunks usually arrive anyway |
| `buildSnapshot` allocates `fedRange` per publish | Sub-microsecond; nothing consumes it per tick |
| Per-chunk readiness / streaming decode | The server sends a page as one buffer; gzip addresses the same symptom far more cheaply. See section 5 |
| Prefetch competes with the critical page | At most two requests share the wire and the fill-in is issued first; only a narrow band at 4x–8x on slow links |
| `canHold` ignores in-flight pages | Bounded over-commit the fed-first eviction absorbs; no refetch observed |
| The fixed timeout restarts an 8 MB page | Real only for near-maximum pages under ~4 Mbit/s; folded into 4.11 |
| Manifest queries run serially | One point lookup per open, masked by the engine download. See section 5 |
| Warm the replay engine chunk from the list page | 87 KB gzipped, immutable-cached, already downloaded in parallel with the manifest, which is the longer leg on every repeat visit |
| nginx spools a large response to a temp file | Fits in the proxy buffers once compressed |
| The chunks route copies the body three times | Imperceptible per request |
| The held frame dims on cached seeks | The dim and its removal happen in one task; the browser never paints it |
| Smooth scroll lags 150 ms samples | The replayer re-targets each sample; the cadence (4.8) is the right lever |
| Checkouts not aligned to flushes | Chunk boundaries follow the checkout flag by design; 60 s anchors are the intended density |
| A mousemove batch clamped at a chunk boundary | Stage placement is already correct; only the idle map's activity point is clamped, harmlessly |
| Identical snapshots published while paused | Four per second with nothing animating; the playing case is 4.1 |
| The 8-minute re-anchor hitches | Runs inside one frame task; nothing intermediate is painted |

---

## 7. Verifying

Run only these suites; CI runs the rest.

```bash
cd Common && npx jest --config jest.config.json Tests/UI/Rum Tests/Server/API/SessionReplayAPI.test.ts
```

```bash
cd App && npx jest Tests/Dashboard
```

```bash
cd App/FeatureSet/BrowserRecorder && npx jest --runInBand --config jest.config.json Tests
```

`Common/Tests/UI/Rum/ReplayRenderBudget.test.tsx` is the one that guards the
headline change: it counts renders, because the regression it protects against
is invisible in a screenshot and shows up only as a dropped frame. A component
on the 250 ms quantum must render about fourteen times across 100 publishes,
not 100.

In a browser: open a long recording, start a Performance profile and play at
1x for a minute. There should be no task over 50 ms outside seeks, React
commits should not appear at 30 Hz, and `/chunks` responses should show
`content-encoding: gzip`. Switch tabs for a minute and come back: the picture
should continue from where it was, with no burst.

Note: `Tests/BundleHygiene.test.ts` runs the real recorder build and cannot
pass on a machine whose `esbuild` was installed for another platform — it
fails the same way on a clean checkout. CI builds on Linux and is unaffected.
