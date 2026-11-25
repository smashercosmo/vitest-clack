/**
 * Where a step is at:
 *
 * - `active`: a prompt waiting for an answer, a spinner spinning, a task running;
 * - `done`: a prompt answered, a spinner stopped, a task or task log succeeded;
 * - `canceled`: a prompt or spinner canceled;
 * - `failed`: a spinner, task or task log that ended in an error.
 */
type StepState = "active" | "done" | "cancelled" | "failed"

/**
 * One clack call, as data: no symbols, guides, borders or colors, only what the
 * CLI asked, printed and received. Fields that don't apply to a step are left
 * out.
 */
interface Step {
  /**
   * The clack function behind the step: `"text"`, `"select"`, `"log.info"`,
   * `"spinner"`, `"task"`, ...
   */
  type: string
  /**
   * The prompt's question, the printed text, or the current message of a
   * spinner or task.
   */
  message?: string
  /** The title of a note, box or task log. */
  title?: string
  /** For prompts, spinners, tasks and task logs. */
  state?: StepState
  /**
   * For prompts: the current value (the typed text, the focused option, the
   * selected options, ...) and, once answered, the answer. For progress bars:
   * the progress so far.
   */
  value?: unknown
  /** The validation error a prompt currently shows. */
  error?: string
  /** The lines a task log printed. */
  log?: string[]
}

interface StepRecord {
  snapshot: () => Step
}

/** The part of a `@clack/core` `Prompt` instance a step reads. */
interface CorePrompt {
  state: string
  value: unknown
  error: string
}

/** A step with `undefined` for the fields that don't apply to it. */
type LooseStep = { [Key in keyof Step]: Step[Key] | undefined } & {
  type: string
}

/** Leaves out the fields that don't apply to a step. */
function compact({ type, ...fields }: LooseStep): Step {
  const defined = Object.entries(fields).filter(
    ([, value]) => value !== undefined,
  )
  return { type, ...Object.fromEntries(defined) }
}

/**
 * A printed message: `intro`, `outro`, `cancel`, `log.*`, `note`, `box`,
 * `stream.*`.
 */
class MessageStep implements StepRecord {
  readonly type: string
  message: string | undefined
  readonly title: string | undefined

  constructor(type: string, message?: string, title?: string) {
    this.type = type
    this.message = message
    this.title = title
  }

  snapshot(): Step {
    return compact({
      type: this.type,
      message: this.message,
      title: this.title,
    })
  }
}

/**
 * A prompt. While it is open, its state comes from the live `@clack/core`
 * instance; once its promise settles, from the outcome (an answer returned
 * through `defaultValue` only shows up there).
 */
class PromptStep implements StepRecord {
  readonly type: string
  readonly message: string | undefined
  prompt: CorePrompt | undefined
  #outcome: { cancelled: boolean; value: unknown } | undefined

  constructor(type: string, message: string | undefined) {
    this.type = type
    this.message = message
  }

  settle(cancelled: boolean, value: unknown) {
    this.#outcome = { cancelled, value }
  }

  snapshot(): Step {
    const { type, message } = this
    if (this.#outcome) {
      return this.#outcome.cancelled
        ? compact({ type, message, state: "cancelled" })
        : compact({ type, message, state: "done", value: this.#outcome.value })
    }
    const { prompt } = this
    const state =
      prompt?.state === "cancel"
        ? "cancelled"
        : prompt?.state === "submit"
          ? "done"
          : "active"
    return compact({
      type,
      message,
      state,
      value: prompt?.value,
      error:
        prompt?.state === "error" && prompt.error !== ""
          ? prompt.error
          : undefined,
    })
  }
}

/**
 * A spinner, progress bar or task: something with a message that changes until
 * it ends.
 */
class ProgressStep implements StepRecord {
  readonly type: string
  message: string
  state: StepState = "active"
  value: number | undefined

  constructor(type: string, message: string) {
    this.type = type
    this.message = message
  }

  snapshot(): Step {
    return compact({
      type: this.type,
      message: this.message,
      state: this.state,
      value: this.value,
    })
  }
}

/** A task log: a titled group of lines that ends in success or an error. */
class TaskLogStep implements StepRecord {
  readonly title: string
  state: StepState = "active"
  message: string | undefined
  readonly log: string[] = []

  constructor(title: string) {
    this.title = title
  }

  snapshot(): Step {
    return compact({
      type: "taskLog",
      title: this.title,
      message: this.message,
      state: this.state,
      log: [...this.log],
    })
  }
}

export { MessageStep, ProgressStep, PromptStep, TaskLogStep }
export type { CorePrompt, Step, StepRecord, StepState }
