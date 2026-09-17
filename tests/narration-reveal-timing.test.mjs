import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { parseNarration, buildNarrationPlan } from "../narration.mjs";
import { NarrationPlayer } from "../narration-player.mjs";

const paragraphs = [
  "At zero it is going upwards. At pi over two it levels off, and at pi it is going downwards. So what would we expect the signs of the slopes to be?",
  "Positive, zero, and negative. We don't have their exact values from this picture, but we can already check whether our answer later makes sense.",
  "We still need a formula for the exact slope.",
];

// Keep the reported passage intact; only its required file/slide metadata is added.
const excerpt = `[format: math1-narration-v1]
[pdf: slope-signs.pdf]
[pdf-pages: 10]

[slide: 2 | Predicting the Slope]
[pages: 2-4]

${paragraphs[0]}

[pause: think]

[reveal: 2 | Show the predicted slope signs.]

${paragraphs[1]}

[reveal: 3 | Show why we still need a formula.]

${paragraphs[2]}

[slide: 3 | A Limit from the Unit Circle]
[pages: 5-10]
`;

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

function harness(navigate) {
  const voice = { voiceURI: "local:en", name: "Offline English", lang: "en-US", localService: true };
  const data = { utterances: [], pages: [], snapshots: [], timerDelays: [], timers: new Map(), time: 0 };
  let timerId = 0;
  const synthesis = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => [voice],
    speak(utterance) {
      synthesis.speaking = true;
      data.utterances.push({ utterance, submittedAt: data.time });
      utterance.onstart?.();
    },
    cancel() { synthesis.speaking = false; },
  };
  class Utterance { constructor(text) { this.text = text; } }
  const player = new NarrationPlayer({
    speechSynthesis: synthesis,
    Utterance,
    navigate: async page => { data.pages.push(page); await navigate?.(page); },
    onChange: snapshot => data.snapshots.push(snapshot),
    setTimeout(callback, delay = 0) {
      const id = ++timerId;
      data.timerDelays.push(delay);
      data.timers.set(id, { callback, at: data.time + delay });
      return id;
    },
    clearTimeout: id => data.timers.delete(id),
    now: () => data.time,
  });

  function runDueTimers() {
    for (const [id, timer] of [...data.timers]) {
      if (timer.at <= data.time) {
        data.timers.delete(id);
        timer.callback();
      }
    }
  }

  // Process asynchronous work without advancing the scripted clock. This accepts
  // microtask or zero-delay task scheduling, but cannot hide another timed pause.
  async function settleUntil(predicate, message) {
    const deadline = performance.now() + 1000;
    do {
      runDueTimers();
      await nextTurn();
      if (predicate()) return;
    } while (performance.now() < deadline);
    assert.fail(message);
  }

  return {
    data,
    player,
    voice,
    settleUntil,
    end() {
      synthesis.speaking = false;
      data.utterances.at(-1).utterance.onend();
    },
    advance(ms) {
      data.time += ms;
      runDueTimers();
    },
  };
}

test("real-deck reveal numbers select overlays and create only the explicit think pause", () => {
  const parsed = parseNarration(excerpt);
  const plan = buildNarrationPlan(parsed, 2);
  assert.deepEqual(plan.filter(event => event.type === "page").map(event => event.page), [2, 3, 4, 5]);
  assert.deepEqual(plan.filter(event => event.type === "pause").map(event => [event.page, event.durationMs]), [[2, 5000]]);
  assert.deepEqual(plan.filter(event => event.type === "speech").map(event => event.text), paragraphs);
  assert.deepEqual(plan.filter(event => event.type === "caption").map(event => [event.page, event.text, event.speak]), [
    [3, "Show the predicted slope signs.", false],
    [4, "Show why we still need a formula.", false],
  ]);
  assert.deepEqual(plan.map(event => event.type), [
    "page", "speech", "pause", "page", "caption", "speech", "page", "caption", "speech", "page",
  ]);
});

test("real-deck reveal three submits the next narration as soon as its page is ready", async t => {
  const revealReady = deferred();
  const { data, player, voice, settleUntil, end, advance } = harness(page => page === 4 ? revealReady.promise : undefined);
  t.after(() => player.stop());
  player.play(buildNarrationPlan(parseNarration(excerpt), 2), { voice });
  await settleUntil(() => data.utterances.length === 1, "The first paragraph did not start.");
  assert.equal(data.utterances[0].utterance.text, paragraphs[0]);
  end();
  await settleUntil(() => player.snapshot.remainingMs === 5000, "The explicit think pause was not reached.");
  advance(4999);
  assert.equal(data.utterances.length, 1);
  advance(1);
  await settleUntil(() => data.utterances.length === 2, "Narration did not resume after the explicit think pause.");
  assert.equal(data.utterances[1].utterance.text, paragraphs[1]);
  end();
  await settleUntil(() => data.pages.includes(4), "Reveal three did not request physical PDF page four.");
  assert.equal(data.utterances.length, 2, "Speech must wait for reveal readiness.");

  const readyAt = data.time;
  revealReady.resolve();
  await settleUntil(() => data.utterances.length === 3, "Reveal three added a delay after the page was ready.");
  assert.equal(data.utterances[2].submittedAt, readyAt, "No additional scripted time should elapse at reveal three.");
  assert.deepEqual(data.utterances.map(item => item.utterance.text), paragraphs);
  assert.deepEqual(data.timerDelays.filter(delay => delay > 0), [5000]);
  assert.ok(data.snapshots.some(snapshot => snapshot.event?.type === "caption"
    && snapshot.text === "Show why we still need a formula."), "The reveal caption remains available as silent guidance.");
  end();
  await settleUntil(() => player.snapshot.phase === "finished", "Playback did not complete after the final paragraph.");
  assert.deepEqual(data.pages, [2, 3, 4, 5]);
});
