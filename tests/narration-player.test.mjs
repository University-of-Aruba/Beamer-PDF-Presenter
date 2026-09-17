import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseNarration, buildNarrationPlan } from "../narration.mjs";
import { NarrationPlayer, localVoices, splitSpeechText, MAX_SPEECH_CHARS } from "../narration-player.mjs";

const voice = { voiceURI: "local:en", name: "Offline English", lang: "en-US", localService: true };
const remoteVoice = { voiceURI: "remote:en", name: "Online English", lang: "en-US", localService: false };
const event = (type, fields = {}) => ({ type, page: 1, slideNumber: 1, title: "Test", line: 5, ...fields });
const speech = text => event("speech", { text });
const tick = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness(options = {}) {
  const data = { voices: [voice, remoteVoice], utterances: [], cancelled: 0, snapshots: [], pages: [], timers: new Map(), time: 0 };
  let timerId = 0;
  const synthesis = {
    getVoices: () => data.voices,
    speak: utterance => { data.utterances.push(utterance); options.speak?.(utterance); },
    cancel: () => {
      data.cancelled += 1;
      const current = data.utterances.at(-1);
      if (options.cancelEvent && current) current.onerror?.({ error: "interrupted" });
    },
  };
  class Utterance { constructor(text) { this.text = text; } }
  const player = new NarrationPlayer({
    speechSynthesis: synthesis,
    Utterance,
    navigate: async page => { data.pages.push(page); return options.navigate?.(page); },
    onChange: snapshot => { data.snapshots.push(snapshot); options.onChange?.(snapshot, player); },
    setTimeout: (callback, delay) => { const id = ++timerId; data.timers.set(id, { callback, at: data.time + delay }); return id; },
    clearTimeout: id => data.timers.delete(id),
    now: () => data.time,
  });
  return { data, synthesis, player, end: () => data.utterances.at(-1).onend(),
    advance: async ms => {
      data.time += ms;
      for (const [id, timer] of [...data.timers]) {
        if (timer.at <= data.time) { data.timers.delete(id); timer.callback(); }
      }
      await tick();
    },
  };
}

test("voice filtering permits only explicitly local services and tolerates missing APIs", () => {
  assert.deepEqual(localVoices({ getVoices: () => [voice, remoteVoice, {}, null] }), [voice]);
  assert.deepEqual(localVoices(undefined), []);
  assert.deepEqual(localVoices({ getVoices() { throw new Error("Unavailable"); } }), []);
});

test("speech splitting preserves readable text with bounded sentence and word chunks", () => {
  const text = `First sentence. Second sentence! ${"long paragraph word ".repeat(80)} Final question?`;
  const chunks = splitSpeechText(text);
  assert.equal(chunks[0], "First sentence. Second sentence!");
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= MAX_SPEECH_CHARS));
  assert.equal(chunks.join(" "), text.replace(/\s+/g, " ").trim());
  assert.deepEqual(splitSpeechText(" \n\t "), []);
});

test("splitting long unbroken Unicode text neither loses characters nor splits surrogate pairs", () => {
  const text = "🦉".repeat(701);
  const chunks = splitSpeechText(text);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= MAX_SPEECH_CHARS));
  assert.ok(chunks.every(chunk => !/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(chunk)));
});

test("navigation must finish successfully before the first spoken chunk", async () => {
  const navigation = deferred();
  const { player, data, end } = harness({ navigate: () => navigation.promise });
  player.play([event("page", { page: 7 }), speech("Hello.")], { voice, rate: 0.8 });
  await tick();
  assert.deepEqual(data.pages, [7]);
  assert.equal(data.utterances.length, 0);
  navigation.resolve();
  await tick();
  assert.equal(data.utterances[0].text, "Hello.");
  assert.equal(data.utterances[0].voice, voice);
  assert.equal(data.utterances[0].lang, "en-US");
  assert.equal(data.utterances[0].rate, 0.8);
  end(); await tick();
  assert.equal(player.snapshot.phase, "finished");
});

test("short sentences share an utterance instead of restarting speech after every sentence", async () => {
  const { player, data, end } = harness();
  player.play([speech("First. Second. Third.")], { voice });
  await tick();
  assert.equal(data.utterances.length, 1);
  assert.equal(data.utterances[0].text, "First. Second. Third.");
  end(); await tick();
  assert.equal(player.snapshot.phase, "finished");
});

test("long runs stay bounded and issue only one utterance at a time", async () => {
  const text = `${"Read this sentence. ".repeat(40)}End.`;
  const { player, data, end } = harness();
  player.play([speech(text)], { voice }); await tick();
  assert.equal(data.utterances.length, 1);
  while (player.snapshot.phase === "running") { end(); await tick(); }
  assert.ok(data.utterances.length > 1);
  assert.ok(data.utterances.every(item => Array.from(item.text).length <= MAX_SPEECH_CHARS));
  assert.equal(data.utterances.map(item => item.text).join(" "), text);
});

test("pause cancels immediately and continue repeats only the interrupted bounded chunk", async () => {
  const first = "A".repeat(MAX_SPEECH_CHARS - 1) + ".";
  const { player, data, end } = harness({ cancelEvent: true });
  player.play([speech(`${first} Second. Third.`)], { voice }); await tick();
  end(); await tick();
  const interrupted = data.utterances.at(-1);
  player.pause();
  assert.equal(data.cancelled, 1);
  assert.equal(player.snapshot.phase, "paused");
  assert.equal(player.snapshot.text, "Second. Third.");
  interrupted.onend();
  interrupted.onerror({ error: "synthesis-failed" });
  await tick();
  assert.equal(player.snapshot.phase, "paused");
  player.continue(); await tick();
  assert.equal(data.utterances.at(-1).text, "Second. Third.");
  assert.deepEqual(data.utterances.map(item => item.text), [first, "Second. Third.", "Second. Third."]);
  end(); await tick();
  assert.equal(player.snapshot.phase, "finished");
});

test("timed silence automatically continues only after its duration", async () => {
  const { player, data, advance } = harness();
  player.play([event("pause", { durationMs: 1500 }), speech("Continue.")], { voice }); await tick();
  assert.equal(data.timers.size, 1);
  await advance(1499);
  assert.equal(data.utterances.length, 0);
  await advance(1);
  assert.equal(data.utterances[0].text, "Continue.");
});

test("pausing timed silence preserves its remainder and invalidates canceled callbacks", async () => {
  const { player, data, advance } = harness();
  player.play([event("pause", { durationMs: 1500 }), speech("Continue.")], { voice }); await tick();
  const staleTimer = [...data.timers.values()][0];
  await advance(600);
  player.pause();
  assert.equal(player.snapshot.remainingMs, 900);
  assert.equal(data.timers.size, 0);
  await advance(9000);
  staleTimer.callback(); await tick();
  assert.equal(data.utterances.length, 0);
  player.continue(); await tick();
  assert.equal(player.snapshot.remainingMs, 900);
  await advance(899);
  assert.equal(data.utterances.length, 0);
  await advance(1);
  assert.equal(data.utterances[0].text, "Continue.");
});

test("wait displays instructions indefinitely and continues without reading them aloud", async () => {
  const { player, data, advance, end } = harness();
  player.play([speech("Before."), event("wait", { text: "Try the exercise." }), speech("After.")], { voice }); await tick();
  end(); await tick();
  assert.equal(player.snapshot.phase, "waiting");
  assert.equal(player.snapshot.text, "Try the exercise.");
  assert.equal(data.timers.size, 0);
  await advance(1000000);
  assert.equal(data.utterances.length, 1);
  player.pause();
  assert.equal(player.snapshot.phase, "waiting");
  player.continue(); await tick();
  assert.deepEqual(data.utterances.map(u => u.text), ["Before.", "After."]);
});

test("spoken and silent cues remain distinct and never navigate", async () => {
  const { player, data, end } = harness();
  player.play([event("cue", { text: "Look at the triangle." }),
    event("cue", { text: "Silent instruction.", speak: false }), event("wait", { text: "Hold." })], { voice });
  await tick();
  assert.equal(data.utterances[0].text, "Look at the triangle.");
  end(); await tick();
  assert.equal(data.utterances.length, 1);
  assert.deepEqual(data.pages, []);
  assert.ok(data.snapshots.some(snapshot => snapshot.text === "Silent instruction."));
  assert.equal(player.snapshot.phase, "waiting");
});

test("stop invalidates speech completion and makes later Continue a no-op", async () => {
  const { player, data } = harness();
  player.play([speech("Old."), event("page", { page: 2 })], { voice }); await tick();
  const stale = data.utterances[0];
  player.stop();
  stale.onend(); stale.onerror({ error: "network" });
  player.continue(); await tick();
  assert.equal(player.snapshot.phase, "idle");
  assert.deepEqual(data.pages, []);
  assert.equal(player.snapshot.error, null);
});

test("stop cancels pending silence and ignores its late timer", async () => {
  const { player, data } = harness();
  player.play([event("pause", { durationMs: 20 }), speech("Should not speak.")], { voice }); await tick();
  const callback = [...data.timers.values()][0].callback;
  player.stop(); callback(); await tick();
  assert.equal(data.timers.size, 0);
  assert.equal(data.utterances.length, 0);
  assert.equal(player.snapshot.phase, "idle");
});

test("a new play session ignores completion from an old navigation", async () => {
  const navigation = deferred();
  const { player, data } = harness({ navigate: () => navigation.promise });
  player.play([event("page"), speech("Old.")], { voice }); await tick();
  player.play([speech("New.")], { voice }); await tick();
  navigation.resolve(); await tick();
  assert.deepEqual(data.utterances.map(u => u.text), ["New."]);
});

test("a new play session ignores rejection from an old navigation", async () => {
  const navigation = deferred();
  const { player, data } = harness({ navigate: () => navigation.promise });
  player.play([event("page"), speech("Old.")], { voice }); await tick();
  player.play([speech("New.")], { voice }); await tick();
  navigation.reject(new Error("Old failed")); await tick();
  assert.equal(player.snapshot.phase, "running");
  assert.equal(player.snapshot.error, null);
  assert.equal(data.utterances.length, 1);
});

test("pause during navigation never starts speech from the interrupted navigation", async () => {
  const first = deferred(), second = deferred();
  let count = 0;
  const { player, data } = harness({ navigate: () => (++count === 1 ? first.promise : second.promise) });
  player.play([event("page"), speech("After page.")], { voice }); await tick();
  player.pause();
  first.resolve(); await tick();
  assert.equal(data.utterances.length, 0);
  player.continue(); await tick();
  assert.equal(count, 2);
  assert.equal(data.utterances.length, 0);
  second.resolve(); await tick();
  assert.equal(data.utterances[0].text, "After page.");
});

for (const result of [false, new Error("PDF render failed")]) {
  test(`navigation failure halts the plan: ${String(result)}`, async () => {
    const { player, data } = harness({ navigate: () => { if (result instanceof Error) throw result; return result; } });
    player.play([event("page", { page: 9 }), speech("Must not speak.")], { voice }); await tick();
    assert.equal(player.snapshot.phase, "error");
    assert.match(player.snapshot.error, result === false ? /page 9/ : /PDF render failed/);
    assert.equal(data.utterances.length, 0);
  });
}

for (const code of ["not-allowed", "voice-unavailable", "synthesis-failed", "interrupted", "canceled"]) {
  test(`unexpected utterance error ${code} halts without advancing`, async () => {
    const { player, data } = harness();
    player.play([speech("First. Second."), event("page", { page: 2 })], { voice }); await tick();
    const failed = data.utterances[0];
    failed.onerror({ error: code });
    failed.onend(); await tick();
    assert.equal(player.snapshot.phase, "error");
    assert.match(player.snapshot.error, new RegExp(code));
    assert.equal(data.utterances.length, 1);
    assert.deepEqual(data.pages, []);
    player.continue(); await tick();
    assert.equal(player.snapshot.phase, "error");
  });
}

test("a synchronous synthesis exception halts playback", async () => {
  const { player } = harness({ speak: () => { throw new Error("Audio device failed"); } });
  player.play([speech("First.")], { voice }); await tick();
  assert.equal(player.snapshot.phase, "error");
  assert.match(player.snapshot.error, /Audio device failed/);
});

test("fresh Play can retry after an error, while stale callbacks remain harmless", async () => {
  const { player, data, end } = harness();
  player.play([speech("Attempt.")], { voice }); await tick();
  const old = data.utterances[0];
  old.onerror({ error: "not-allowed" });
  player.play([speech("Retry.")], { voice }); await tick();
  old.onend(); old.onerror({ error: "network" }); await tick();
  assert.equal(player.snapshot.phase, "running");
  assert.equal(data.utterances.at(-1).text, "Retry.");
  end(); await tick();
  assert.equal(player.snapshot.phase, "finished");
});

for (const selection of [undefined, remoteVoice, { ...voice, voiceURI: "missing" }]) {
  test(`unavailable or remote voice is rejected: ${selection?.voiceURI}`, async () => {
    const { player, data } = harness();
    player.play([event("page"), speech("Hello.")], { voice: selection }); await tick();
    assert.equal(player.snapshot.phase, "error");
    assert.equal(data.utterances.length, 0);
    assert.deepEqual(data.pages, []);
  });
}

test("an initially empty voice list permits a fresh Play after local voices load", async () => {
  const { player, data } = harness();
  data.voices = [];
  player.play([speech("Hello.")], { voice }); await tick();
  assert.equal(player.snapshot.phase, "error");
  data.voices = [voice];
  player.play([speech("Hello.")], { voice }); await tick();
  assert.equal(player.snapshot.phase, "running");
  assert.equal(data.utterances.length, 1);
});

test("voice disappearance between chunks fails without falling back to an online voice", async () => {
  const { player, data, end } = harness();
  player.play([speech("A".repeat(MAX_SPEECH_CHARS - 1) + ". Second.")], { voice }); await tick();
  data.voices = [remoteVoice];
  end(); await tick();
  assert.equal(player.snapshot.phase, "error");
  assert.match(player.snapshot.error, /no longer available/);
  assert.equal(data.utterances.length, 1);
});

test("voice enumeration can replace voice objects without breaking the selected local voice", async () => {
  const { player, data, end } = harness();
  player.play([speech("A".repeat(MAX_SPEECH_CHARS - 1) + ". Second.")], { voice }); await tick();
  const replacement = { ...voice };
  data.voices = [replacement];
  end(); await tick();
  assert.equal(data.utterances[1].voice, replacement);
});

test("missing synthesis API reports a readable error", () => {
  const player = new NarrationPlayer({ speechSynthesis: null, Utterance: null });
  assert.equal(player.play([speech("Hello.")], { voice }).phase, "error");
  assert.match(player.snapshot.error, /unavailable/);
});

test("invalid plan data and rates never navigate or reach a speech engine", async () => {
  for (const plan of [null, [event("unknown")], [event("page", { page: 0 })], [event("pause", { durationMs: NaN })],
    [event("pause", { durationMs: -1 })], [event("speech", { text: null })]]) {
    const { player, data } = harness();
    player.play(plan, { voice }); await tick();
    assert.equal(player.snapshot.phase, "error");
    assert.equal(data.utterances.length, 0);
    assert.deepEqual(data.pages, []);
  }
  for (const rate of [NaN, Infinity, 0, 11, "1"]) {
    const { player } = harness();
    assert.equal(player.play([speech("Hello.")], { voice, rate }).phase, "error");
  }
});

test("empty and silent plans finish without speech", async () => {
  for (const plan of [[], [speech(" ")], [event("cue", { text: "Observe.", speak: false })]]) {
    const { player, data } = harness();
    player.play(plan, { voice }); await tick();
    assert.equal(player.snapshot.phase, "finished");
    assert.equal(data.utterances.length, 0);
  }
});

test("snapshots and caller mutations cannot alter an active event plan", async () => {
  const { player, data } = harness();
  const plan = [speech("Original.")];
  player.play(plan, { voice });
  plan[0].text = "Mutated outside.";
  player.snapshot.event.text = "Mutated snapshot.";
  await tick();
  assert.equal(data.utterances[0].text, "Original.");
});

test("stop from a change callback cannot leak a speech or navigation action", async () => {
  for (const plan of [[speech("Do not speak.")], [event("page")]]) {
    const { player, data } = harness({ onChange: (snapshot, current) => {
      if (snapshot.phase === "running") current.stop();
    } });
    player.play(plan, { voice }); await tick();
    assert.equal(player.snapshot.phase, "idle");
    assert.equal(data.utterances.length, 0);
    assert.deepEqual(data.pages, []);
  }
});

test("synchronous speech completion cannot overflow the call stack", async () => {
  const { player, data } = harness({ speak: utterance => utterance.onend() });
  player.play([speech("Short. ".repeat(12000))], { voice });
  for (let count = 0; count < 12010 && player.snapshot.phase === "running"; count += 1) await tick();
  assert.equal(player.snapshot.phase, "finished");
  assert.ok(data.utterances.length < 12000);
  assert.equal(data.utterances.map(item => item.text).join(" "), "Short. ".repeat(12000).trim());
  assert.ok(data.utterances.every(item => Array.from(item.text).length <= MAX_SPEECH_CHARS));
});


test("sample reveal caption stays silent and following narration starts without a timer", async () => {
  const text = await readFile(new URL("../sample-beamer.txt", import.meta.url), "utf8");
  const plan = buildNarrationPlan(parseNarration(text), 3);
  const { player, data } = harness();
  player.play(plan, { voice }); await tick();
  assert.deepEqual(data.pages, [3]);
  assert.equal(data.utterances.length, 1);
  assert.match(data.utterances[0].text, /^No, we can stay with the same slide and reveal the next point\./);
  assert.equal(data.timers.size, 0);
  assert.doesNotMatch(data.utterances[0].text, /Here we have three points|Look now at the second bullet/);
  assert.ok(data.snapshots.some(snapshot => snapshot.event?.type === "caption" && /second bullet/.test(snapshot.text)));
});

test("coalescing speech never crosses navigation, explicit pauses, waits or silent cues", async () => {
  const { player, data, end, advance } = harness();
  const plan = [event("page"), event("cue", { text: "Look here." }), speech("Explanation."),
    event("pause", { durationMs: 1500 }), speech("After pause."),
    event("wait", { text: "Discuss." }), speech("After wait."),
    event("cue", { text: "Silent cue.", speak: false }), speech("After silent cue."),
    event("page", { page: 2 }), event("speech", { page: 2, text: "New page." })];
  player.play(plan, { voice }); await tick();
  assert.equal(data.utterances[0].text, "Look here. Explanation.");
  end(); await tick();
  await advance(1499);
  assert.equal(data.utterances.length, 1);
  await advance(1);
  assert.equal(data.utterances.at(-1).text, "After pause.");
  end(); await tick();
  assert.equal(player.snapshot.phase, "waiting");
  assert.equal(player.snapshot.text, "Discuss.");
  player.continue(); await tick();
  assert.equal(data.utterances.at(-1).text, "After wait.");
  end(); await tick();
  assert.ok(data.snapshots.some(snapshot => snapshot.text === "Silent cue."));
  assert.equal(data.utterances.at(-1).text, "After silent cue.");
  assert.deepEqual(data.pages, [1]);
  end(); await tick();
  assert.deepEqual(data.pages, [1, 2]);
  assert.equal(data.utterances.at(-1).text, "New page.");
  end(); await tick();
  assert.equal(player.snapshot.phase, "finished");
  assert.equal(plan[1].text, "Look here.");
});

test("adjacent speech on different pages or logical slides retains its boundary", async () => {
  const { player, data, end } = harness();
  player.play([speech("One."), event("speech", { page: 2, text: "Two." }),
    event("speech", { page: 2, slideNumber: 2, text: "Another slide." })], { voice });
  await tick();
  assert.equal(data.utterances[0].text, "One.");
  end(); await tick();
  assert.equal(data.utterances.at(-1).text, "Two.");
  end(); await tick();
  assert.equal(data.utterances.at(-1).text, "Another slide.");
});


test("reveal captions never enter speech, while explicit cues speak after rendering without added silence", async () => {
  const script = `[format: math1-narration-v1]
[pdf: Lesson.pdf]
[pdf-pages: 2]
[slide: 1 | Lesson]
[pages: 1-2]
Before the reveal.
[reveal: 2 | Second diagram: caption only.]
[cue: Compare the highlighted arrows.]
They now point towards the centre.
[wait: Discuss the change.]`;
  const rendered = deferred();
  const { player, data, end } = harness({ navigate: page => page === 2 ? rendered.promise : undefined });
  player.play(buildNarrationPlan(parseNarration(script), 1), { voice }); await tick();
  assert.equal(data.utterances[0].text, "Before the reveal.");
  end(); await tick();
  assert.deepEqual(data.pages, [1, 2]);
  assert.equal(data.utterances.length, 1, "Speech must wait for the revealed page.");
  rendered.resolve(); await tick();
  assert.equal(data.utterances.length, 2);
  assert.equal(data.utterances[1].text, "Compare the highlighted arrows. They now point towards the centre.");
  assert.equal(data.timers.size, 0, "A caption must never insert a timed gap.");
  assert.ok(data.snapshots.some(snapshot => snapshot.text === "Second diagram: caption only."));
  end(); await tick();
  assert.equal(player.snapshot.phase, "waiting");
  assert.equal(player.snapshot.text, "Discuss the change.");
});

test("caption type is always silent even without a speak flag", async () => {
  for (const flags of [{}, { speak: true }, { speak: false }]) {
    const { player, data } = harness();
    player.play([event("caption", { text: "A label, never narration.", ...flags }), speech("Spoken explanation.")], { voice });
    await tick();
    assert.deepEqual(data.utterances.map(item => item.text), ["Spoken explanation."]);
    assert.equal(data.timers.size, 0);
  }
});
