import { parseNarration, validateNarrationPdf, buildNarrationPlan } from "./narration.mjs";
import { NarrationPlayer, localVoices } from "./narration-player.mjs";

/** Private presenter controls. File readers are bound to the loaded PDF. */
export class NarrationControls {
  constructor(root, { getPage, isAvailable, isVisible, navigate, onCancel = () => {}, synthesis = globalThis.speechSynthesis,
    Utterance = globalThis.SpeechSynthesisUtterance }) {
    this.getPage = getPage;
    this.isAvailable = isAvailable;
    this.isVisible = isVisible;
    this.synthesis = synthesis;
    this.elements = Object.fromEntries(["play", "stop", "open", "input", "status", "text", "voice", "rate", "optional", "refresh", "settings", "voice-help"]
      .map(name => [name, root.querySelector(`#narration-${name}`)]));
    this.binding = null;
    this.script = null;
    this.revision = 0;
    this.busy = false;
    this.feedback = "";
    this.message = "Open a PDF to use narration.";
    this.player = new NarrationPlayer({ speechSynthesis: synthesis, Utterance, navigate,
      onChange: snapshot => {
        if (snapshot.phase !== "running") onCancel();
        this.feedback = "";
        this.render(snapshot);
      } });
    this.elements.play.addEventListener("click", () => this.toggle());
    this.elements.stop.addEventListener("click", () => this.stop());
    this.elements.open.addEventListener("click", () => {
      this.pickerBinding = this.binding;
      this.elements.input.click();
    });
    this.elements.input.addEventListener("change", () => {
      const file = this.elements.input.files?.[0];
      this.elements.input.value = "";
      if (file && this.pickerBinding === this.binding) this.loadScript(() => file);
    });
    this.elements.refresh.addEventListener("click", () => this.refreshVoices());
    for (const name of ["voice", "rate", "optional"]) {
      this.elements[name].addEventListener("change", () => this.stop("Settings changed. Auto-play starts again at the current page."));
    }
    this.voicesChanged = () => this.refreshVoices();
    synthesis?.addEventListener?.("voiceschanged", this.voicesChanged);
    this.refreshVoices();
  }

  bind(file, pageCount, getNarrationFile = null) {
    this.stop();
    this.binding = { file, pageCount, getNarrationFile };
    this.script = null;
    this.elements.text.textContent = "";
    this.message = getNarrationFile
      ? "Auto-play looks for the matching .txt file in this PDF folder."
      : "Choose Open narration to attach a .txt file to this PDF.";
    this.render();
  }

  stop(message = "Stopped. Auto-play starts at the current page.") {
    ++this.revision;
    this.busy = false;
    this.message = message;
    this.player.stop();
    this.render();
  }

  pause() {
    if (this.player.snapshot.phase === "running") this.player.pause();
  }

  refreshVoices() {
    const select = this.elements.voice;
    const previous = select.value;
    this.voices = localVoices(this.synthesis);
    select.replaceChildren();
    for (const voice of this.voices) {
      const option = document.createElement("option");
      option.value = JSON.stringify([voice.voiceURI, voice.name, voice.lang]);
      option.textContent = `${voice.name} (${voice.lang})`;
      select.append(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    else {
      const preferred = this.voices.find(voice => voice.default) || this.voices.find(voice => voice.lang?.startsWith("en"));
      if (preferred) select.value = JSON.stringify([preferred.voiceURI, preferred.name, preferred.lang]);
    }
    this.elements["voice-help"].textContent = this.voices.length
      ? "Installed local voices only. Narration stays on this computer."
      : "No local voice is available. Enable a speech voice in the operating system, then refresh voices or try another browser. Narration text can still be opened and read here.";
    select.disabled = !this.voices.length;
    this.render();
  }

  async loadScript(reader, start = false) {
    const binding = this.binding;
    if (!binding || !this.isAvailable()) return;
    this.stop();
    this.script = null;
    const revision = ++this.revision;
    this.busy = true;
    this.message = "Checking narration against this PDF…";
    this.render();
    try {
      const file = await reader();
      if (!file) throw new Error("No matching narration file found. Put a .txt with the PDF's filename stem in its folder, or choose Open narration.");
      if (file.size > 2 * 1024 * 1024) throw new Error("The narration file exceeds 2 MB. Choose a plain-text narration script.");
      const script = parseNarration(await file.text());
      const bytes = script.pdfSha256 ? await binding.file.arrayBuffer() : undefined;
      await validateNarrationPdf(script, { filename: binding.file.name, pageCount: binding.pageCount, bytes });
      if (revision !== this.revision || binding !== this.binding) return;
      this.script = script;
      this.message = `Ready · ${file.name}. Auto-play starts at the current page.`;
      const plan = buildNarrationPlan(script, this.getPage(), { includeOptional: this.elements.optional.checked });
      this.elements.text.textContent = plan.filter(event => event.text).map(event => event.text).join("\n\n");
      if (start) this.startPlan(plan);
    } catch (error) {
      if (revision !== this.revision || binding !== this.binding) return;
      this.feedback = error.message || String(error);
    } finally {
      if (revision === this.revision) {
        this.busy = false;
        this.render();
      }
    }
  }

  startPlan(plan) {
    if (!this.isVisible()) throw new Error("Restore the audience screen and hide the full-screen timer before continuing narration.");
    this.refreshVoices();
    const voice = this.voices.find(item => JSON.stringify([item.voiceURI, item.name, item.lang]) === this.elements.voice.value);
    if (!voice) {
      this.elements.settings.open = true;
      throw new Error("No installed local voice is available in this browser. Open narration to read the script, or enable a local voice and refresh voices.");
    }
    this.player.play(plan, { voice, rate: Number(this.elements.rate.value) });
  }

  async toggle() {
    if (!this.isAvailable() || this.busy) return;
    const phase = this.player.snapshot.phase;
    if (phase === "running") { this.player.pause(); return; }
    try {
      if (phase === "paused" || phase === "waiting") {
        if (!this.isVisible()) throw new Error("Restore the audience screen and hide the full-screen timer before continuing narration.");
        this.player.continue();
      } else if (this.script) {
        this.startPlan(buildNarrationPlan(this.script, this.getPage(), { includeOptional: this.elements.optional.checked }));
      } else if (this.binding?.getNarrationFile) {
        await this.loadScript(this.binding.getNarrationFile, true);
      } else {
        throw new Error("Choose Open narration to select the companion .txt file. Browsers cannot read neighbouring files after Open PDF.");
      }
    } catch (error) {
      this.feedback = error.message || String(error);
      this.render();
    }
  }

  render(snapshot = this.player?.snapshot || { phase: "idle" }) {
    const available = this.isAvailable();
    const phase = snapshot.phase;
    if (phase === "waiting") this.elements.settings.open = true;
    const active = ["running", "paused", "waiting"].includes(phase);
    this.elements.play.disabled = !available || this.busy;
    this.elements.open.disabled = !available || this.busy;
    this.elements.stop.disabled = !active && !this.busy;
    this.elements.play.textContent = this.busy ? "Checking…" : phase === "running" ? "Pause narration"
      : phase === "paused" || phase === "waiting" ? "Continue" : "Auto-play";
    const labels = {
      running: snapshot.event?.type === "pause" ? "Timed pause · continues automatically" : "Narrating",
      paused: "Paused · Continue repeats the interrupted passage", waiting: "Waiting for Continue",
      finished: "Narration finished", error: snapshot.error,
    };
    this.elements.status.textContent = this.feedback || labels[phase] || this.message;
    this.elements.status.dataset.phase = phase;
    this.elements.status.dataset.error = String(Boolean(this.feedback) || phase === "error");
    if (snapshot.text) this.elements.text.textContent = snapshot.text;
  }

  destroy() {
    this.stop();
    this.synthesis?.removeEventListener?.("voiceschanged", this.voicesChanged);
  }
}
