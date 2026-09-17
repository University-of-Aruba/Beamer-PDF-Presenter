/** Local browser speech with application-owned navigation, waits, and pauses. */
export const MAX_SPEECH_CHARS = 240;

/** Return only voices the browser identifies as supplied by a local synthesizer. */
export function localVoices(synthesis) {
  try {
    return Array.from(synthesis?.getVoices?.() || []).filter(voice => voice?.localService === true);
  } catch {
    return [];
  }
}

/** Pack adjacent sentences into bounded utterances to avoid restarting the voice. */
export function splitSpeechText(text) {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) return [];
  const chunks = [];
  let pending = "";
  for (const sentence of normalized.split(/(?<=[.!?])\s+/u)) {
    let points = Array.from(sentence);
    if (points.length > MAX_SPEECH_CHARS && pending) {
      chunks.push(pending);
      pending = "";
    }
    while (points.length > MAX_SPEECH_CHARS) {
      let end = points.lastIndexOf(" ", MAX_SPEECH_CHARS);
      if (end <= 0) end = MAX_SPEECH_CHARS;
      chunks.push(points.slice(0, end).join(""));
      points = points.slice(end);
      while (points[0] === " ") points.shift();
    }
    const remainder = points.join("");
    if (!remainder) continue;
    if (pending && Array.from(pending).length + 1 + points.length > MAX_SPEECH_CHARS) {
      chunks.push(pending);
      pending = "";
    }
    pending = pending ? `${pending} ${remainder}` : remainder;
  }
  if (pending) chunks.push(pending);
  return chunks;
}

function isSpoken(event) {
  return ["speech", "cue"].includes(event?.type) && event.speak !== false;
}

/** Keep adjacent cue/prose in one speech run; action and slide boundaries survive. */
function speechRuns(events) {
  const runs = [];
  for (const event of events) {
    const previous = runs.at(-1);
    if (isSpoken(previous) && isSpoken(event) && previous.page === event.page
        && previous.slideNumber === event.slideNumber) {
      previous.text += `\n\n${event.text}`;
    } else {
      runs.push({ ...event });
    }
  }
  return runs;
}

function sameVoice(left, right) {
  return left === right || (left?.voiceURI === right?.voiceURI
    && left?.name === right?.name && left?.lang === right?.lang);
}

function errorMessage(error, fallback) {
  return typeof error?.message === "string" && error.message ? error.message : fallback;
}

/**
 * Play a parser's flat event plan. Pausing speech repeats the interrupted chunk
 * on Continue, avoiding platform-dependent native pause/resume behavior.
 *
 * Commands return immediate snapshots. onChange receives later transitions.
 * navigate must resolve after the requested page is ready, or reject on failure.
 */
export class NarrationPlayer {
  constructor({ speechSynthesis = globalThis.speechSynthesis,
    Utterance = globalThis.SpeechSynthesisUtterance, navigate = async () => {},
    onChange = () => {}, setTimeout = globalThis.setTimeout.bind(globalThis),
    clearTimeout = globalThis.clearTimeout.bind(globalThis), now = () => performance.now() } = {}) {
    this.synthesis = speechSynthesis;
    this.Utterance = Utterance;
    this.navigate = navigate;
    this.onChange = onChange;
    this.setTimer = setTimeout;
    this.clearTimer = clearTimeout;
    this.now = now;
    this._generation = 0;
    this._phase = "idle";
    this._events = [];
    this._index = 0;
    this._chunkIndex = 0;
    this._chunks = null;
    this._text = "";
    this._error = null;
    this._utterance = null;
    this._timer = null;
    this._deadline = null;
    this._remainingMs = null;
    this._voice = null;
    this._rate = 1;
  }

  get snapshot() {
    return {
      phase: this._phase,
      text: this._text,
      error: this._error,
      event: this._events[this._index] ? { ...this._events[this._index] } : null,
      eventIndex: this._index,
      chunkIndex: this._chunkIndex,
      remainingMs: this._deadline === null ? this._remainingMs : Math.max(0, this._deadline - this.now()),
    };
  }

  /** Start a fresh plan using an explicit local voice; invalid input stops playback. */
  play(events, { voice, rate = 1 } = {}) {
    this._invalidate();
    this._events = [];
    this._index = 0;
    this._chunkIndex = 0;
    this._chunks = null;
    this._remainingMs = null;
    this._text = "";
    this._error = null;
    this._voice = voice;
    this._rate = rate;
    if (!Array.isArray(events)) return this._fail("The narration playback plan is invalid.");
    if (!this._hasSpeechAPI()) return this._fail("Speech synthesis is unavailable in this browser.");
    if (!voice || voice.localService !== true || !this._availableVoice()) {
      return this._fail("Select an available offline voice before starting narration.");
    }
    if (!Number.isFinite(rate) || rate < 0.1 || rate > 10) {
      return this._fail("Speech rate must be between 0.1 and 10.");
    }
    for (const event of events) {
      if (!event || !["page", "speech", "cue", "caption", "pause", "wait"].includes(event.type)
          || !Number.isSafeInteger(event.page) || event.page < 1
          || (["speech", "cue", "caption", "wait"].includes(event.type) && typeof event.text !== "string")
          || (event.type === "pause" && (!Number.isFinite(event.durationMs) || event.durationMs < 0))) {
        return this._fail("The narration playback plan contains an invalid event.");
      }
    }
    this._events = speechRuns(events);
    this._phase = "running";
    const generation = this._generation;
    this._notify();
    this._schedule(generation);
    return this.snapshot;
  }

  /** Pause immediately, preserving an interrupted chunk or remaining timed silence. */
  pause() {
    if (this._phase !== "running") return this.snapshot;
    if (this._deadline !== null) this._remainingMs = Math.max(0, this._deadline - this.now());
    this._invalidate();
    this._phase = "paused";
    this._notify();
    return this.snapshot;
  }

  /** Resume a manual pause or continue past a script wait instruction. */
  continue() {
    if (!["paused", "waiting"].includes(this._phase)) return this.snapshot;
    if (this._phase === "waiting") this._nextEvent();
    this._phase = "running";
    const generation = ++this._generation;
    this._notify();
    this._schedule(generation);
    return this.snapshot;
  }

  /** Cancel narration and invalidate every pending callback without navigating. */
  stop() {
    this._invalidate();
    this._phase = "idle";
    this._events = [];
    this._index = 0;
    this._chunks = null;
    this._chunkIndex = 0;
    this._text = "";
    this._error = null;
    this._remainingMs = null;
    this._notify();
    return this.snapshot;
  }

  _hasSpeechAPI() {
    return typeof this.Utterance === "function" && typeof this.synthesis?.speak === "function"
      && typeof this.synthesis?.cancel === "function";
  }

  _availableVoice() {
    return localVoices(this.synthesis).find(voice => sameVoice(voice, this._voice));
  }

  _notify() {
    this.onChange(this.snapshot);
  }

  _active(generation) {
    return generation === this._generation && this._phase === "running";
  }

  _invalidate() {
    this._generation += 1;
    if (this._timer !== null) this.clearTimer(this._timer);
    this._timer = null;
    this._deadline = null;
    const utterance = this._utterance;
    this._utterance = null;
    // Invalidate first: cancel may synchronously dispatch an error or end event.
    if (utterance) {
      try { this.synthesis.cancel(); } catch { /* Cancellation cannot advance the plan. */ }
    }
  }

  _fail(message) {
    this._invalidate();
    this._phase = "error";
    this._error = message;
    this._notify();
    return this.snapshot;
  }

  _nextEvent() {
    this._index += 1;
    this._chunkIndex = 0;
    this._chunks = null;
    this._remainingMs = null;
  }

  _schedule(generation) {
    // Some speech engines complete synchronously; keep long plans off the stack.
    Promise.resolve().then(() => this._advance(generation));
  }

  async _advance(generation) {
    try {
      while (this._active(generation)) {
        const event = this._events[this._index];
        if (!event) {
          this._phase = "finished";
          this._notify();
          return;
        }
        if (event.type === "page") {
          this._text = "";
          this._notify();
          if (!this._active(generation)) return;
          const result = await this.navigate(event.page);
          if (!this._active(generation)) return;
          if (result === false) throw new Error(`Unable to show PDF page ${event.page}.`);
          this._nextEvent();
        } else if (event.type === "wait") {
          this._text = event.text;
          this._phase = "waiting";
          this._notify();
          return;
        } else if (event.type === "pause") {
          this._text = "";
          const remaining = this._remainingMs ?? event.durationMs;
          this._remainingMs = remaining;
          this._deadline = this.now() + remaining;
          this._notify();
          if (!this._active(generation)) return;
          this._timer = this.setTimer(() => {
            if (!this._active(generation)) return;
            this._timer = null;
            this._deadline = null;
            this._nextEvent();
            this._schedule(generation);
          }, remaining);
          return;
        } else if (event.type === "caption" || event.speak === false) {
          this._text = event.text;
          this._notify();
          if (!this._active(generation)) return;
          this._nextEvent();
        } else {
          this._chunks ??= splitSpeechText(event.text);
          if (this._chunkIndex >= this._chunks.length) {
            this._nextEvent();
            continue;
          }
          this._speak(generation, this._chunks[this._chunkIndex]);
          return;
        }
      }
    } catch (error) {
      if (this._active(generation)) this._fail(errorMessage(error, "Narration playback failed."));
    }
  }

  _speak(generation, text) {
    const voice = this._availableVoice();
    if (!voice) throw new Error("The selected offline voice is no longer available. Select a voice and start again.");
    const utterance = new this.Utterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = this._rate;
    this._text = text;
    this._utterance = utterance;
    utterance.onend = () => {
      if (!this._active(generation) || this._utterance !== utterance) return;
      this._utterance = null;
      this._chunkIndex += 1;
      this._schedule(generation);
    };
    utterance.onerror = error => {
      if (!this._active(generation) || this._utterance !== utterance) return;
      const code = error?.error || "synthesis-failed";
      this._fail(`Speech could not continue (${code}). Select an offline voice and start again.`);
    };
    this._notify();
    if (!this._active(generation) || this._utterance !== utterance) return;
    this.synthesis.speak(utterance);
  }
}
