import stream from "node:stream"
import timers from "node:timers"
import util from "node:util"

import type { Key, Keypress } from "#lib/keys.js"
import type { Step, StepRecord } from "#lib/steps.js"

import { isKey, keypressFor, keypressForChar } from "#lib/keys.js"
import { Screen } from "#lib/screen.js"

interface TerminalOptions {
  /**
   * Width reported to clack through `output.columns`.
   *
   * @default 80
   */
  columns?: number
  /**
   * Height reported to clack through `output.rows`. Clack uses it to decide how
   * many options a select-like prompt shows at once.
   *
   * @default 24
   */
  rows?: number
  /**
   * Default timeout (ms) for {@link Terminal.waitFor}, and for waiting until a
   * prompt accepts input in {@link Terminal.type} / {@link Terminal.press}.
   *
   * @default 1000
   */
  timeout?: number
}

interface WaitOptions {
  timeout?: number
}

interface PressOptions extends WaitOptions {
  /**
   * How many times to press the key.
   *
   * @default 1
   */
  times?: number
}

type Matcher = string | RegExp

/** The fields a step must have, or a predicate it must satisfy. */
type StepMatcher = Partial<Step> | ((step: Step) => boolean)

/**
 * Used by the clack mock to register the steps of the current test. Not part of
 * the public API.
 */
const ADD_STEP = Symbol("vitest-clack:add-step")

/**
 * Marks terminals for {@link isTerminal}. A registered symbol, so it is the same
 * in every copy of this module.
 */
const TERMINAL = Symbol.for("vitest-clack:terminal")

/** What a wait reports when it times out. */
interface WaitFailure {
  timeout: number
  message: string
  /** More to add to the message, read when the wait times out. */
  details?: () => string
}

/**
 * The readable side of the fake TTY. Clack listens to its `keypress` events,
 * which is how Node delivers key presses from a real terminal in raw mode.
 */
class TerminalInput extends stream.PassThrough {
  readonly isTTY = true
  isRaw = false

  setRawMode(mode: boolean): this {
    this.isRaw = mode
    return this
  }
}

/** The writable side of the fake TTY. Everything clack renders ends up here. */
class TerminalOutput extends stream.Writable {
  readonly isTTY = true
  columns: number
  rows: number

  constructor(columns: number, rows: number, onWrite: (chunk: string) => void) {
    super({
      decodeStrings: false,
      write(chunk: string | Buffer, _encoding, callback) {
        onWrite(typeof chunk === "string" ? chunk : chunk.toString())
        callback()
      },
    })
    this.columns = columns
    this.rows = rows
  }

  getWindowSize(): [number, number] {
    return [this.columns, this.rows]
  }
}

/**
 * A fake interactive terminal that every `@clack/prompts` call made during a
 * test reads from and renders to.
 *
 * - Drive prompts with {@link Terminal.type} and {@link Terminal.press};
 * - Synchronize with the CLI using {@link Terminal.waitFor};
 * - Assert on what the CLI asked, printed and received with
 *   {@link Terminal.steps};
 * - See how clack drew it with {@link Terminal.screen} and
 *   {@link Terminal.transcript}.
 */
class Terminal {
  readonly input: TerminalInput
  readonly output: TerminalOutput
  readonly [TERMINAL] = true

  #raw = ""
  #plain: string | undefined
  #consumed = 0
  readonly #screen: Screen
  readonly #onWrite = new Set<() => void>()
  readonly #pending = new Set<() => void>()
  readonly #steps: StepRecord[] = []
  readonly #timeout: number

  constructor({
    columns = 80,
    rows = 24,
    timeout = 1000,
  }: TerminalOptions = {}) {
    this.#timeout = timeout
    this.#screen = new Screen(() => this.output.rows)
    this.input = new TerminalInput()
    this.output = new TerminalOutput(columns, rows, (chunk) => {
      this.#write(chunk)
    })
  }

  /** Whether a prompt is currently listening for key presses. */
  get isPromptActive(): boolean {
    return this.input.listenerCount("keypress") > 0
  }

  /**
   * What the user currently sees: the output interpreted by a virtual terminal,
   * so the cursor movement and erasure clack performs while re-rendering are
   * applied. Trailing whitespace is trimmed from every line.
   */
  screen(): string {
    return this.#screen.toString()
  }

  /** Same as {@link Terminal.screen}, split into lines. */
  lines(): string[] {
    return this.#screen.lines()
  }

  /**
   * Everything written to the terminal so far, with ANSI escape sequences
   * removed. Unlike {@link Terminal.screen}, re-rendered frames are not
   * collapsed, so this is a log of the session rather than a picture of it.
   */
  transcript(): string {
    this.#plain ??= util.stripVTControlCharacters(this.#raw)
    return this.#plain
  }

  /** Everything written to the terminal so far, ANSI escape sequences included. */
  raw(): string {
    return this.#raw
  }

  /**
   * Every clack call made during the test, in order, as plain data: what was
   * asked or printed, and for prompts, spinners and tasks, their state and
   * value right now. A prompt that is still open shows its live value (the
   * typed text, the focused option, ...) and any validation error it displays.
   *
   * Use {@link Terminal.screen} instead to see how clack drew it all.
   */
  steps(): Step[] {
    return this.#steps.map((step) => step.snapshot())
  }

  /**
   * A single step, by position: `0` is the first, negative indices count from
   * the end. Defaults to the latest one, which is the open prompt while one is
   * waiting.
   */
  step(index = -1): Step {
    const step = this.#steps.at(index)
    if (!step) {
      const steps = this.steps()
      throw new RangeError(
        steps.length === 0
          ? "No clack function has been called yet."
          : `No step at index ${index}: there are ${steps.length} (${steps.map(({ type }) => type).join(", ")}).`,
      )
    }
    return step.snapshot()
  }

  /**
   * Resolves once `matcher` appears in the output written since the previous
   * successful `waitFor`, and moves past it. Waits are therefore sequential:
   * waiting for the second of two prompts with the same wording doesn't resolve
   * on the first one.
   */
  async waitFor(
    matcher: Matcher,
    { timeout = this.#timeout }: WaitOptions = {},
  ): Promise<void> {
    if (this.#consume(matcher)) {
      return
    }
    await this.#wait(
      (done) => {
        const check = (): void => {
          if (this.#consume(matcher)) {
            done()
          }
        }
        this.#onWrite.add(check)
        return () => {
          this.#onWrite.delete(check)
        }
      },
      {
        timeout,
        message: `Timed out after ${timeout}ms waiting for ${quote(matcher)}.`,
      },
    )
  }

  /**
   * Resolves with the latest step once it matches `expected`: every field given
   * there must equal the step's (compared deeply), or the predicate must return
   * true. Unlike {@link Terminal.waitFor} it doesn't depend on how clack
   * rendered or wrapped the text, so it is the reliable way to wait for a
   * prompt: `{ type: "text", message, state: "active" }`.
   */
  async waitForStep(
    expected: StepMatcher,
    { timeout = this.#timeout }: WaitOptions = {},
  ): Promise<Step> {
    const current = this.#latestMatching(expected)
    if (current !== undefined) {
      return current
    }
    return this.#wait<Step>(
      /**
       * Checked on writes: every step renders something once it is live (a
       * prompt as soon as it listens for keys), so a step is never matched half
       * set up.
       */
      (done) => {
        const check = (): void => {
          const step = this.#latestMatching(expected)
          if (step !== undefined) {
            done(step)
          }
        }
        this.#onWrite.add(check)
        return () => {
          this.#onWrite.delete(check)
        }
      },
      {
        timeout,
        message: `Timed out after ${timeout}ms waiting for a step matching ${describeMatcher(expected)}.`,
        details: () =>
          `\n\nLatest step:\n${indent(util.inspect(this.#steps.at(-1)?.snapshot() ?? "<none>"))}`,
      },
    )
  }

  /**
   * Types `text` into the active prompt, one key press per character. Waits for
   * a prompt to become active first if none is.
   */
  async type(text: string, options: WaitOptions = {}): Promise<void> {
    for (const char of text) {
      await this.#emit(keypressForChar(char), char, options)
    }
  }

  /**
   * Presses a key (`"enter"`, `"down"`, `"space"`, `"ctrl+c"`, ...) in the
   * active prompt. Waits for a prompt to become active first if none is.
   */
  async press(
    key: Key,
    { times = 1, ...options }: PressOptions = {},
  ): Promise<void> {
    if (!isKey(key)) {
      throw new TypeError(`Unknown key ${quote(key)}`)
    }
    const keypress = keypressFor(key)
    for (let pressed = 0; pressed < times; pressed += 1) {
      await this.#emit(keypress, key, options)
    }
  }

  /**
   * Changes the terminal size and notifies clack, which re-renders the active
   * prompt.
   */
  resize(columns: number, rows: number = this.output.rows): void {
    this.output.columns = columns
    this.output.rows = rows
    this.output.emit("resize")
  }

  /** Cancels pending waits and closes the streams. */
  dispose(): void {
    for (const cancel of this.#pending) {
      cancel()
    }
    this.#pending.clear()
    this.#onWrite.clear()
    this.input.destroy()
    this.output.destroy()
  }

  [ADD_STEP](step: StepRecord): void {
    this.#steps.push(step)
  }

  #consume(matcher: Matcher): boolean {
    const end = findEnd(this.transcript().slice(this.#consumed), matcher)
    if (end === undefined) {
      return false
    }
    this.#consumed += end
    return true
  }

  #latestMatching(expected: StepMatcher): Step | undefined {
    const latest = this.#steps.at(-1)?.snapshot()
    return latest !== undefined && matchesStep(latest, expected)
      ? latest
      : undefined
  }

  #write(chunk: string) {
    this.#raw += chunk
    this.#plain = undefined
    this.#screen.write(chunk)
    for (const check of this.#onWrite) {
      check()
    }
  }

  async #emit(
    { str, key }: Keypress,
    label: string,
    { timeout = this.#timeout }: WaitOptions,
  ) {
    if (!this.isPromptActive) {
      await this.#wait(
        (done) => {
          function onListener(event: string | symbol): void {
            if (event === "keypress") {
              done()
            }
          }

          this.input.on("newListener", onListener)
          return () => {
            this.input.off("newListener", onListener)
          }
        },
        {
          timeout,
          message: `Timed out after ${timeout}ms waiting for a prompt to send ${quote(label)} to.`,
        },
      )
      // Readline subscribes first and clack right after it: let the prompt finish its setup.
      await timers.promises.setImmediate()
    }
    this.input.emit("keypress", str, { ...key })
    // Let clack handle the key (validation may be async) and re-render.
    await timers.promises.setImmediate()
  }

  /**
   * Resolves with what `subscribe` passes to `done`, or rejects once the wait
   * times out. `subscribe` starts listening and returns how to stop.
   * {@link Terminal.dispose} leaves the wait pending.
   */
  async #wait<Value = void>(
    subscribe: (done: (value: Value) => void) => () => void,
    { timeout, message, details = () => "" }: WaitFailure,
  ): Promise<Value> {
    const { promise, resolve, reject } = Promise.withResolvers<Value>()
    // Created up front so the stack trace points at the test, not at a timer callback.
    const error = new Error(message)
    const timer = timers.setTimeout(() => {
      error.message += `${details()}\n\nScreen:\n${indent(this.screen() || "<empty>")}`
      reject(error)
    }, timeout)
    const unsubscribe = subscribe(resolve)

    function stop(): void {
      timers.clearTimeout(timer)
      unsubscribe()
    }

    this.#pending.add(stop)
    try {
      return await promise
    } finally {
      this.#pending.delete(stop)
      stop()
    }
  }
}

function findEnd(text: string, matcher: Matcher): number | undefined {
  if (typeof matcher === "string") {
    const index = text.indexOf(matcher)
    return index === -1 ? undefined : index + matcher.length
  }
  const match = new RegExp(
    matcher.source,
    matcher.flags.replaceAll(/[gy]/gv, ""),
  ).exec(text)
  return match ? match.index + match[0].length : undefined
}

function matchesStep(step: Step, expected: StepMatcher): boolean {
  if (typeof expected === "function") {
    return expected(step)
  }
  const fields: Record<string, unknown> = { ...step }
  return Object.entries(expected).every(([key, value]) =>
    util.isDeepStrictEqual(fields[key], value),
  )
}

function describeMatcher(expected: StepMatcher): string {
  return typeof expected === "function"
    ? "the predicate"
    : util.inspect(expected, { breakLength: Infinity })
}

function quote(value: Matcher): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value)
}

function indent(text: string): string {
  return text.replaceAll(/^/gmv, "  ")
}

/**
 * Whether a value is a {@link Terminal}, from any copy of this module. Vitest
 * loads snapshot serializers once per worker but test files' modules afresh, so
 * `instanceof` would compare against a different `Terminal` class.
 */
function isTerminal(value: unknown): value is Terminal {
  return typeof value === "object" && value !== null && TERMINAL in value
}

export { ADD_STEP, isTerminal, Terminal }
export type { Matcher, PressOptions, StepMatcher, TerminalOptions, WaitOptions }
