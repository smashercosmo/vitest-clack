# vitest-clack

Vitest fixtures for testing CLIs built with
[`@clack/prompts`](https://github.com/bombshell-dev/clack). Drive prompts from a
fake terminal and assert on what your CLI asked, printed and received, without
any of clack's decorations.

- **Real prompts, fake terminal.** Your CLI runs the real `@clack/prompts`
  against an in-memory TTY: no child processes, no pseudo-terminals.
- **Assert on meaning, not pixels.** Every clack call is recorded as a plain
  [step](#steps), such as `{ type: "text", message, state, value }`, whatever
  the terminal width or the symbols clack draws.
- **Or on pixels, when you want to.**
  [Snapshot the screen](#snapshots-of-the-screen) the way a user sees it.
- **Answer or stub.** Type and press keys like a user would, or stub any prompt
  with a [`vi.fn()` spy](#clack).

## Installation

```sh
pnpm add -D vitest-clack
```

vitest-clack needs Node.js 24 or later. Vitest 5 and `@clack/prompts` 1.8 or
later are peer dependencies: it uses the copies your project has.

## Usage

Extend Vitest's `it` with the fixtures, start your CLI inside the test, and
answer its prompts through `terminal`:

```ts
import { it as base, expect } from "vitest"
import { withClack } from "vitest-clack"

const it = withClack(base)

it("creates a project", async ({ terminal, clack }) => {
  // Import the code under test inside the test (see "How it works").
  const { main } = await import("../lib/cli.ts")
  const done = main()

  await terminal.waitFor("Project name?")
  await terminal.type("my-app")
  await terminal.press("enter")

  await terminal.waitFor("Package manager?")
  await terminal.press("down")
  await terminal.press("enter")

  await done

  expect(terminal.steps()).toEqual([
    { type: "intro", message: "create-app" },
    { type: "text", message: "Project name?", state: "done", value: "my-app" },
    {
      type: "select",
      message: "Package manager?",
      state: "done",
      value: "pnpm",
    },
    { type: "outro", message: "Created my-app" },
  ])
  expect(clack.text).toHaveBeenCalledOnce()
})
```

## `withClack(test, options?)`

Returns `test` (or `it`) extended with two fixtures, set up for every test:

- **`terminal`**: a fake interactive TTY that every clack call made during the
  test reads from and renders to.
- **`clack`**: the mocked `@clack/prompts`. Each prompt and output function is a
  `vi.fn()` spy that runs the real implementation against `terminal`. Spies are
  reset before every test.

It composes with other fixtures, both before and after:

```ts
const it = withClack(
  base.extend("registry", async ({}, { onCleanup }) => {
    /* ... */
  }),
).extend("cli", async ({ terminal }) => import("../lib/cli.ts"))
```

| Option    | Default | Description                                                                     |
| --------- | ------- | ------------------------------------------------------------------------------- |
| `columns` | `80`    | Terminal width                                                                  |
| `rows`    | `24`    | Terminal height (limits how many options select-like prompts show)              |
| `timeout` | `1000`  | Default timeout (ms) of `waitFor`, and of `type` / `press` waiting for a prompt |

## `terminal`

| Member                          | Description                                                                                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waitFor(text \| regex, opts?)` | Resolves once the text appears in output written since the previous `waitFor`. On timeout it rejects with the current screen in the message.                                                                                                                            |
| `waitForStep(expected, opts?)`  | Resolves with the latest step once it matches: every field of `expected` equal to the step's, or a predicate returning true. Doesn't depend on how clack wrapped the text, so it's the reliable way to wait for a prompt: `{ type: "text", message, state: "active" }`. |
| `type(text, opts?)`             | Types into the active prompt, one key press per character.                                                                                                                                                                                                              |
| `press(key, opts?)`             | Presses `enter`, `escape`, `tab`, `shift+tab`, `backspace`, `delete`, `space`, arrows, `home`, `end`, `pageup`, `pagedown` or `ctrl+<letter>`. `{ times }` repeats it.                                                                                                  |
| `steps()`                       | Every clack call of the test as plain data (see [Steps](#steps)).                                                                                                                                                                                                       |
| `step(index = -1)`              | A single step; negative indices count from the end. The default is the latest step, which is the open prompt while one is waiting. Throws if there is none.                                                                                                             |
| `screen()` / `lines()`          | What the user sees, decorations included. Output goes through a small virtual terminal, so re-rendered frames are collapsed. Handy for debugging.                                                                                                                       |
| `transcript()`                  | Everything printed, with ANSI codes stripped and frames not collapsed.                                                                                                                                                                                                  |
| `raw()`                         | Everything printed, ANSI codes included.                                                                                                                                                                                                                                |
| `resize(columns, rows?)`        | Resizes the terminal; clack re-renders the active prompt.                                                                                                                                                                                                               |
| `isPromptActive`                | Whether a prompt is listening for keys.                                                                                                                                                                                                                                 |
| `input` / `output`              | The underlying TTY streams.                                                                                                                                                                                                                                             |

`type` and `press` wait for a prompt to start listening, so you can chain
prompts without a `waitFor` in between.

### Snapshots of the screen

`expect(terminal.screen())` snapshots a quoted, escaped string. To snapshot
`expect(terminal)` as the screen itself, verbatim, register the terminal
serializer in your Vitest config:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    snapshotSerializers: ["vitest-clack/serializer"],
  },
})
```

```ts
expect(terminal).toMatchInlineSnapshot(`
  ┌  create-app
  │
  ◇  Project name?
  │  my-app
`)
```

`withClack` doesn't add it. It's also exported as `terminalSerializer`, for
`expect.addSnapshotSerializer()` in a setup file.

## Steps

A step is one clack call (`intro`, `text`, `select`, `log.info`, `spinner`, ...)
as plain data: no symbols, guide bars, borders, footers or colors. Only what
your CLI asked, printed and got back:

| Field     | Present for                                        | Content                                                                                                                                          |
| --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`    | every step                                         | The clack function: `"text"`, `"select"`, `"log.warn"`, `"stream.info"`, `"spinner"`, `"task"`, `"taskLog"`, ...                                 |
| `message` | most steps                                         | The prompt's question, the printed text, or the current message of a spinner or task                                                             |
| `title`   | `note`, `box`, `taskLog`                           | The title                                                                                                                                        |
| `state`   | prompts, spinners, progress bars, tasks, task logs | `"active"`, `"done"`, `"cancelled"` or `"failed"`                                                                                                |
| `value`   | prompts, progress bars                             | The answer, or while the prompt is open, its current value: typed text, focused option, selected options. For progress bars, the progress so far |
| `error`   | prompts                                            | The validation error the prompt currently shows                                                                                                  |
| `log`     | `taskLog`                                          | The lines it printed                                                                                                                             |

Open prompts are live, so you can check each step as you go:

```ts
await terminal.waitFor("Port?")
await terminal.type("abc")
await terminal.press("enter")
expect(terminal.step()).toEqual({
  type: "text",
  message: "Port?",
  state: "active",
  value: "abc",
  error: "Must be a number",
})

await terminal.press("backspace", { times: 3 })
await terminal.type("8080")
await terminal.press("enter")
expect(terminal.step()).toEqual({
  type: "text",
  message: "Port?",
  state: "done",
  value: "8080",
})
```

Each call to `steps()` or `step()` returns a snapshot that doesn't change
afterwards. A spinner's step starts when it starts spinning, and each task of
`tasks()` that runs is a `"task"` step. Prompts stubbed with
`mockResolvedValueOnce` never run, so they don't appear. Options, placeholders
and other arguments aren't part of steps; assert on them through the spies, e.g.
`clack.select.mock.calls`.

## `clack`

Prompts can be stubbed instead of answered:

```ts
it("skips the questions", async ({ clack }) => {
  clack.text.mockResolvedValueOnce("my-app")
  clack.confirm.mockResolvedValueOnce(false)
  // ...
})
```

Every prompt is covered: `text`, `password`, `confirm`, `select`, `selectKey`,
`multiselect`, `groupMultiselect`, `autocomplete`, `autocompleteMultiselect`,
`multiline`, `date` and `path`. So is all output: `intro`, `outro`, `cancel`,
`note`, `box`, `log.*`, `stream.*`, `spinner`, `progress`, `tasks` and
`taskLog`. `group` is spied on too. Everything else (`isCancel`, symbols,
`updateSettings`, and so on) is the original export.

## How it works

The fixture calls `vi.doMock("@clack/prompts")`, and the mock injects the
terminal's `input`/`output` into every call, overriding streams passed by the
caller. To read the live state of open prompts, it also wraps `prompt()` on
`@clack/core`'s `Prompt` class (the copy `@clack/prompts` uses), which every
prompt extends. That has a few consequences:

- **Import the code under test dynamically, inside the test.** `vi.doMock` only
  affects imports that happen after it runs, and static imports at the top of a
  test file run first.
- Only code that Vitest transforms is affected. Dependencies in `node_modules`
  that import `@clack/prompts` themselves get the real module.
- Tests in the same file share the active terminal, so `test.concurrent` isn't
  supported.
- `CI` is unset for the duration of each test. The terminal is interactive, and
  clack's spinners render differently under `CI=true`, which would otherwise
  make snapshots differ between local and CI runs.

## License

MIT © Vladislav Shkodin
