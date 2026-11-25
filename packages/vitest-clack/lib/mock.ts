// oxlint-disable-next-line import/no-namespace -- The mock mirrors the whole module, so it needs the module's type.
import type * as Clack from "@clack/prompts"
import type { Mock } from "vitest"

import util from "node:util"
import { vi } from "vitest"

import type { CorePrompt, StepState } from "#lib/steps.js"
import type { Terminal } from "#lib/terminal.js"

import {
  MessageStep,
  ProgressStep,
  PromptStep,
  TaskLogStep,
} from "#lib/steps.js"
import { ADD_STEP } from "#lib/terminal.js"

type ClackModule = typeof Clack
/** Any function: what Vitest's `Mock` accepts, which it doesn't export. */
// oxlint-disable-next-line typescript/no-explicit-any -- Vitest constrains `Mock` to exactly this.
type Procedure = (...args: any[]) => any

/** Prompts: their options object is the first argument. */
const PROMPTS = [
  "text",
  "password",
  "confirm",
  "select",
  "selectKey",
  "multiselect",
  "groupMultiselect",
  "autocomplete",
  "autocompleteMultiselect",
  "multiline",
  "date",
  "path",
] as const satisfies readonly (keyof ClackModule)[]

/**
 * Printed messages, with the index of their options argument and of their
 * title, if any.
 */
const MESSAGES = [
  { name: "intro", options: 1 },
  { name: "outro", options: 1 },
  { name: "cancel", options: 1 },
  { name: "note", options: 2, title: 1 },
  { name: "box", options: 2, title: 1 },
] as const satisfies readonly {
  name: keyof ClackModule
  options: number
  title?: number
}[]

const SPINNERS = [
  "spinner",
  "progress",
] as const satisfies readonly (keyof ClackModule)[]

/** Functions that never touch a stream, spied on only so calls can be asserted. */
const PASSTHROUGH = ["group"] as const satisfies readonly (keyof ClackModule)[]

type Spied =
  | (typeof PROMPTS)[number]
  | (typeof MESSAGES)[number]["name"]
  | (typeof SPINNERS)[number]
  | "tasks"
  | "taskLog"
  | (typeof PASSTHROUGH)[number]

/**
 * A spy that keeps the original call signature: `Mock<T>` alone erases
 * generics, which would turn e.g. `select<Value>()` into `select<unknown>()`
 * for callers.
 */
type Spy<Target extends Procedure> = Target & Mock<Target>

type MockedMethods<Methods> = {
  [Name in keyof Methods]: Methods[Name] extends Procedure
    ? Spy<Methods[Name]>
    : Methods[Name]
}

/**
 * `@clack/prompts` as seen by the code under test: every function that reads
 * input or renders output is a `vi.fn()` spy whose default implementation is
 * the real one, wired to the test's {@link Terminal}. Everything else
 * (`isCancel`, symbols, settings, ...) is the original export.
 */
type ClackMock = Omit<ClackModule, Spied | "log" | "stream"> & {
  [Name in Spied]: Spy<ClackModule[Name]>
} & {
  log: MockedMethods<ClackModule["log"]>
  stream: MockedMethods<ClackModule["stream"]>
}

/** A class from `@clack/core` that every prompt extends. */
interface PromptClass {
  prototype: { prompt: (...args: unknown[]) => unknown }
}

/** Calls the real function, with other arguments. */
type Call = (args: unknown[]) => unknown
/** Handles a clack call made while a test is running. */
type Route = (terminal: Terminal, args: unknown[], call: Call) => unknown
/** Runs before a method, with its arguments. */
type Before = (...args: never[]) => void
/** Replaces a method's result. */
type After = (result: never) => unknown

interface StreamOptions {
  /** The symbol before the first line; a gray bar when `undefined`. */
  symbol: string | undefined
  /** Gets every chunk, as given. */
  onChunk: (chunk: string) => void
}

/**
 * Global rather than module state: `@clack/core` is loaded once per worker,
 * while this module may be evaluated once per test file.
 */
const PATCHED = Symbol.for("vitest-clack:patched")
const CLAIM = Symbol.for("vitest-clack:claim")

type Claim = (prompt: CorePrompt) => void
const hooks = globalThis as typeof globalThis & {
  [CLAIM]?: Claim | undefined
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value)
}

function isTask(value: unknown): value is Clack.Task {
  return (
    isRecord(value) &&
    typeof value["title"] === "string" &&
    typeof value["task"] === "function"
  )
}

function isStringSource(
  value: unknown,
): value is Iterable<string> | AsyncIterable<string> {
  return (
    typeof value === "string" ||
    (isObject(value) &&
      (Symbol.iterator in value || Symbol.asyncIterator in value))
  )
}

/** Reads `key` from the options object at `index`. */
function option(args: unknown[], index: number, key: string): unknown {
  const options = args[index]
  return isRecord(options) ? options[key] : undefined
}

/**
 * Makes every prompt instance created by `@clack/core` available to the prompt
 * function that is creating it, which is how steps read a prompt's live state.
 */
function patchPromptClass(Prompt: PromptClass): void {
  const prototype = Prompt.prototype as PromptClass["prototype"] & {
    [PATCHED]?: true
  }
  if (prototype[PATCHED]) {
    return
  }
  const { prompt: original } = prototype
  prototype.prompt = function prompt(this: CorePrompt, ...args: unknown[]) {
    hooks[CLAIM]?.(this)
    return original.apply(this, args)
  }
  prototype[PATCHED] = true
}

/** Runs `run`, handing the first prompt instance it creates to `claim`. */
function claimPrompt<Result>(claim: Claim, run: () => Result): Result {
  const previous = hooks[CLAIM]
  let claimed = false
  hooks[CLAIM] = (prompt) => {
    if (claimed) {
      return
    }
    claimed = true
    claim(prompt)
  }
  try {
    return run()
  } finally {
    hooks[CLAIM] = previous
  }
}

/** Puts the terminal's streams into the options argument at `index`. */
function withStreams(
  args: unknown[],
  index: number,
  terminal: Terminal,
): unknown[] {
  const next = [...args]
  next.length = Math.max(next.length, index + 1)
  const options = next[index]
  next[index] = {
    ...(isObject(options) ? options : {}),
    input: terminal.input,
    output: terminal.output,
  }
  return next
}

function text(message: unknown): string | undefined {
  if (Array.isArray(message)) {
    return message.join("\n")
  }
  if (message === undefined || typeof message === "string") {
    return message
  }
  return util.inspect(message)
}

/**
 * Wraps `target` so that calling one of the methods named in `before` first
 * runs that function with the same arguments, then the method, whose result the
 * function of the same name in `after` may replace.
 */
function tap<Target extends object>(
  target: Target,
  before: Record<string, Before>,
  after: Record<string, After> = {},
): Target {
  return new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property, object)
      if (typeof value !== "function" || typeof property !== "string") {
        return value
      }
      const run = Object.hasOwn(before, property) ? before[property] : undefined
      const replace = Object.hasOwn(after, property)
        ? after[property]
        : undefined
      if (run === undefined && replace === undefined) {
        return value
      }
      return (...args: unknown[]): unknown => {
        if (run !== undefined) {
          Reflect.apply(run, undefined, args)
        }
        const result: unknown = Reflect.apply(value, object, args)
        return replace === undefined
          ? result
          : Reflect.apply(replace, undefined, [result])
      }
    },
  })
}

/**
 * Builds the mocked module. `getTerminal` is read on every call rather than
 * captured, so modules that imported the mock in an earlier test keep working
 * with the current test's terminal. When no terminal is active, calls go to
 * clack untouched.
 */
function createClackMock(
  original: ClackModule,
  getTerminal: () => Terminal | undefined,
): ClackMock {
  /**
   * Spies on `fn`, routing it to the terminal through `route` while a test is
   * running.
   */
  function spy(fn: Procedure, route: Route): Mock {
    return vi.fn<(...args: unknown[]) => unknown>(function routed(
      this: unknown,
      ...args: unknown[]
    ): unknown {
      const terminal = getTerminal()
      if (!terminal) {
        return fn.apply(this, args)
      }
      return route(terminal, args, (next): unknown => fn.apply(this, next))
    })
  }

  const spies: Record<string, Mock> = {}

  for (const name of PROMPTS) {
    spies[name] = spy(original[name], async (terminal, args, call) => {
      const step = new PromptStep(name, text(option(args, 0, "message")))
      terminal[ADD_STEP](step)
      const value: unknown = await claimPrompt(
        (prompt) => {
          step.prompt = prompt
        },
        () => call(withStreams(args, 0, terminal)),
      )
      step.settle(original.isCancel(value), value)
      return value
    })
  }

  for (const message of MESSAGES) {
    const titleIndex = "title" in message ? message.title : undefined
    spies[message.name] = spy(
      original[message.name],
      (terminal, args, call) => {
        const title =
          titleIndex === undefined ? undefined : text(args[titleIndex])
        terminal[ADD_STEP](new MessageStep(message.name, text(args[0]), title))
        return call(withStreams(args, message.options, terminal))
      },
    )
  }

  for (const name of SPINNERS) {
    spies[name] = spy(original[name], (terminal, args, call) => {
      const spinner = call(withStreams(args, 0, terminal))
      if (!isObject(spinner)) {
        return spinner
      }
      let step: ProgressStep | undefined

      function end(state: StepState) {
        return (message?: string) => {
          if (step === undefined) {
            return
          }
          step.state = state
          step.message = message ?? ""
        }
      }

      return tap(spinner, {
        start(message?: string) {
          step = new ProgressStep(name, message ?? "")
          if (name === "progress") {
            step.value = 0
          }
          terminal[ADD_STEP](step)
        },
        message(message?: string) {
          if (step !== undefined && message !== undefined) {
            step.message = message
          }
        },
        advance(amount = 1, message?: string) {
          if (step === undefined) {
            return
          }
          step.value = (step.value ?? 0) + amount
          if (message !== undefined) {
            step.message = message
          }
        },
        stop: end("done"),
        cancel: end("cancelled"),
        error: end("failed"),
        clear() {
          if (step !== undefined) {
            step.state = "done"
          }
        },
      })
    })
  }

  spies["tasks"] = spy(original.tasks, (terminal, args, call) => {
    const [list] = args
    if (!Array.isArray(list) || !list.every((task: unknown) => isTask(task))) {
      return call(withStreams(args, 1, terminal))
    }
    const tracked = list.map(({ task: run, ...fields }): Clack.Task => ({
      ...fields,
      task: async (message) => {
        const step = new ProgressStep("task", fields.title)
        terminal[ADD_STEP](step)
        try {
          const result = await run((update) => {
            step.message = update
            message(update)
          })
          // Clack stops the task's spinner with the result, or the title without one.
          const shown =
            typeof result === "string" && result !== "" ? result : fields.title
          step.state = "done"
          step.message = shown
          return shown
        } catch (error) {
          step.state = "failed"
          throw error
        }
      },
    }))
    return call(withStreams([tracked, ...args.slice(1)], 1, terminal))
  })

  spies["taskLog"] = spy(original.taskLog, (terminal, args, call) => {
    const step = new TaskLogStep(text(option(args, 0, "title")) ?? "")
    terminal[ADD_STEP](step)

    function finish(state: StepState) {
      return (message: string) => {
        step.state = state
        step.message = message
      }
    }

    function addLine(message: string) {
      step.log.push(message)
    }

    const log = call(withStreams(args, 0, terminal))
    if (!isObject(log)) {
      return log
    }
    return tap(
      log,
      { message: addLine, success: finish("done"), error: finish("failed") },
      // Messages logged through a group belong to the same task log.
      { group: (group: object) => tap(group, { message: addLine }) },
    )
  })

  for (const name of PASSTHROUGH) {
    spies[name] = vi.fn<ClackModule[typeof name]>(original[name])
  }

  const log = Object.fromEntries(
    Object.entries(original.log).map(([level, fn]) => [
      level,
      spy(fn, (terminal, args, call) => {
        terminal[ADD_STEP](new MessageStep(`log.${level}`, text(args[0])))
        return call(withStreams(args, 1, terminal))
      }),
    ]),
  )

  const writeStream = createStreamWriter(original)
  const symbols = new Map([
    ["info", util.styleText("blue", original.S_INFO)],
    ["success", util.styleText("green", original.S_SUCCESS)],
    ["step", util.styleText("green", original.S_STEP_SUBMIT)],
    ["warn", util.styleText("yellow", original.S_WARN)],
    ["warning", util.styleText("yellow", original.S_WARN)],
    ["error", util.styleText("red", original.S_ERROR)],
  ])

  const stream = Object.fromEntries(
    Object.entries(original.stream).map(([level, fn]) => [
      level,
      spy(fn, async (terminal, args) => {
        const [source] = args
        if (!isStringSource(source)) {
          throw new TypeError(`stream.${level}() takes an iterable of strings`)
        }
        const step = new MessageStep(`stream.${level}`, "")
        terminal[ADD_STEP](step)
        const custom = option(args, 1, "symbol")
        await writeStream(terminal.output, source, {
          symbol:
            level === "message" && typeof custom === "string"
              ? custom
              : symbols.get(level),
          onChunk: (chunk) => {
            step.message += chunk
          },
        })
      }),
    ]),
  )

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The spies are built from clack's exports at runtime, so their types can't follow.
  return { ...original, ...spies, log, stream } as unknown as ClackMock
}

function visibleWidth(value: string): number {
  return util.stripVTControlCharacters(value).length
}

/**
 * Upstream `stream.*` always writes to `process.stdout` and offers no `output`
 * option. This is the same rendering logic, writing to the terminal (and
 * wrapping at its width).
 */
function createStreamWriter(original: ClackModule) {
  return async (
    output: NodeJS.WritableStream & { columns?: number },
    iterable: Iterable<string> | AsyncIterable<string>,
    { symbol, onChunk }: StreamOptions,
  ): Promise<void> => {
    const bar = util.styleText("gray", original.S_BAR)
    const prefix = `${bar}  `
    const columns = output.columns ?? 80

    output.write(`${bar}\n${symbol ?? bar}  `)
    let lineWidth = 3
    for await (const given of iterable) {
      onChunk(given)
      const chunk = given.replaceAll("\n", `\n${prefix}`)
      if (chunk.includes("\n")) {
        lineWidth = 3 + visibleWidth(chunk.slice(chunk.lastIndexOf("\n")))
      }
      const chunkWidth = visibleWidth(chunk)
      if (lineWidth + chunkWidth < columns) {
        lineWidth += chunkWidth
        output.write(chunk)
      } else {
        output.write(`\n${prefix}${chunk.trimStart()}`)
        lineWidth = 3 + visibleWidth(chunk.trimStart())
      }
    }
    output.write("\n")
  }
}

/** Every spy in the mock, nested `log.*` / `stream.*` ones included. */
function spiesOf(mock: ClackMock): Mock[] {
  return [mock, mock.log, mock.stream].flatMap((object) =>
    Object.values(object).filter((value): value is Mock =>
      vi.isMockFunction(value),
    ),
  )
}

export { createClackMock, patchPromptClass, spiesOf }
export type { ClackMock, ClackModule, Spy }
