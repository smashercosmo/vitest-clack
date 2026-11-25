import type { TestAPI } from "vitest"

import module from "node:module"
import process from "node:process"
import url from "node:url"
import { vi } from "vitest"

import type { ClackMock, ClackModule } from "#lib/mock.js"
import type { TerminalOptions } from "#lib/terminal.js"

import { createClackMock, patchPromptClass, spiesOf } from "#lib/mock.js"
import { Terminal } from "#lib/terminal.js"

const CLACK = "@clack/prompts"

interface ClackFixtures {
  /** The fake TTY the current test's prompts read from and render to. */
  terminal: Terminal
  /**
   * The mocked `@clack/prompts` module, for asserting on calls or stubbing
   * prompts.
   */
  clack: ClackMock
}

/** The part of `@clack/core` that gets patched. */
interface ClackCore {
  Prompt: Parameters<typeof patchPromptClass>[0]
}

/**
 * The terminal of the running test. Clack calls made outside of a test hit the
 * real streams.
 */
let activeTerminal: Terminal | undefined
let clackMock: Promise<ClackMock> | undefined

function isClackCore(value: unknown): value is ClackCore {
  return (
    typeof value === "object" &&
    value !== null &&
    "Prompt" in value &&
    typeof value.Prompt === "function"
  )
}

/**
 * Loads the `@clack/core` that `@clack/prompts` itself uses (it pins an exact
 * version, which may differ from one the project depends on), so the patched
 * `Prompt` class is the one its prompts extend.
 */
async function importClackCore(): Promise<ClackCore> {
  const prompts = module.createRequire(import.meta.url).resolve(CLACK)
  const core = module.createRequire(prompts).resolve("@clack/core")
  const imported: unknown = await import(url.pathToFileURL(core).href)
  if (!isClackCore(imported)) {
    throw new TypeError(`${core} doesn't export a Prompt class`)
  }
  return imported
}

async function createMock(): Promise<ClackMock> {
  const [original, core] = await Promise.all([
    vi.importActual<ClackModule>(CLACK),
    importClackCore(),
  ])
  patchPromptClass(core.Prompt)
  return createClackMock(original, () => activeTerminal)
}

/**
 * One mock per module instance: modules imported by an earlier test stay bound
 * to it, so spies (reset before every test) and terminal routing keep working
 * for them.
 */
async function loadClackMock(): Promise<ClackMock> {
  clackMock ??= createMock()
  return clackMock
}

/**
 * Extends a Vitest `test` / `it` with fixtures for testing `@clack/prompts`
 * CLIs:
 *
 * - `terminal` — a fake interactive terminal. Type into prompts, press keys, wait
 *   for output, and inspect every clack call as plain data with
 *   `terminal.steps()`.
 * - `clack` — the mocked `@clack/prompts`. Every prompt and output function is a
 *   spy that runs the real implementation against `terminal` by default.
 *
 * Both are set up for every test of the returned API, whether destructured or
 * not.
 *
 * `@clack/prompts` is mocked with `vi.doMock`, which only affects modules
 * imported after the fixture ran: import the code under test dynamically inside
 * the test.
 *
 * @example
 *   import { it as base, expect } from "vitest"
 *   import { withClack } from "vitest-clack"
 *
 *   const it = withClack(base)
 *
 *   it("asks for a name", async ({ terminal }) => {
 *     const { main } = await import("../lib/cli.ts")
 *     const done = main()
 *
 *     await terminal.waitFor("What is your name?")
 *     await terminal.type("Ada")
 *     await terminal.press("enter")
 *     await done
 *
 *     expect(terminal.steps()).toEqual([
 *       {
 *         type: "text",
 *         message: "What is your name?",
 *         state: "done",
 *         value: "Ada",
 *       },
 *       { type: "outro", message: "Hello, Ada" },
 *     ])
 *   })
 *
 * @param base The `test` or `it` to extend.
 * @param options Options of the terminal created for every test.
 * @returns The `test` / `it` with the `terminal` and `clack` fixtures.
 */
function withClack<Context>(
  base: TestAPI<Context>,
  options: TerminalOptions = {},
) {
  /**
   * Vitest can't resolve its builder overloads against an open `Context`, so
   * the fixtures are declared on a concrete API and the result is typed as the
   * base plus the fixtures.
   */
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- See above.
  const extended = (base as unknown as TestAPI)
    .extend("clack", async () => {
      const clack = await loadClackMock()
      vi.doMock(CLACK, () => clack)
      return clack
    })
    .extend("terminal", { auto: true }, ({ clack }, { onCleanup }) => {
      for (const spy of spiesOf(clack)) {
        spy.mockReset()
      }

      /**
       * The terminal is an interactive TTY: clack's spinners and task logs only
       * animate when `CI` isn't set, so unset it to render the same way locally
       * and on CI.
       */
      const { CI: ci } = process.env
      delete process.env["CI"]

      const terminal = new Terminal(options)
      activeTerminal = terminal

      onCleanup(() => {
        if (activeTerminal === terminal) {
          activeTerminal = undefined
        }
        if (ci !== undefined) {
          process.env["CI"] = ci
        }
        terminal.dispose()
      })

      return terminal
    })

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return extended as unknown as TestAPI<Context & ClackFixtures>
}

export { withClack }
export type { ClackFixtures }
