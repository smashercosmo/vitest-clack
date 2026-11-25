import { it as base, describe, expect } from "vitest"

import { withClack } from "#lib/index.js"

const it = withClack(base)

// oxlint-disable-next-line typescript/require-await -- Async on purpose: `stream.*` take async iterables.
async function* words() {
  yield "Thinking"
  yield " about"
  yield " it"
}

describe("intro, outro and cancel", () => {
  it("frame the session", ({ terminal, clack }) => {
    clack.intro("create-app")
    clack.outro("You're all set!")
    expect(terminal).toMatchInlineSnapshot(`
      ┌  create-app
      │
      └  You're all set!
    `)
  })

  it("render cancellation", ({ terminal, clack }) => {
    clack.cancel("Operation cancelled")
    expect(terminal).toMatchInlineSnapshot(`└  Operation cancelled`)
  })

  it("keep caller options other than streams", ({ terminal, clack }) => {
    clack.intro("No guide", { withGuide: false })
    expect(terminal).toMatchInlineSnapshot(`No guide`)
  })
})

describe("note and box", () => {
  it("render a note", ({ terminal, clack }) => {
    clack.note("cd my-app\npnpm dev", "Next steps")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  Next steps ─╮
      │              │
      │  cd my-app   │
      │  pnpm dev    │
      │              │
      ├──────────────╯
    `)
  })

  it("render a box as wide as the terminal", ({ terminal, clack }) => {
    terminal.resize(30)
    clack.box("Hello", "Title", { width: 1 })
    expect(terminal).toMatchInlineSnapshot(`
      │ ┌─Title────────────────────┐
      │ │  Hello                   │
      │ └──────────────────────────┘
    `)
  })
})

describe("log", () => {
  it("renders every level", ({ terminal, clack }) => {
    clack.log.message("plain")
    clack.log.info("info")
    clack.log.success("success")
    clack.log.step("step")
    clack.log.warn("warn")
    clack.log.warning("warning")
    clack.log.error("error")
    expect(terminal).toMatchInlineSnapshot(`
      │
      │  plain
      │
      ●  info
      │
      ◆  success
      │
      ◇  step
      │
      ▲  warn
      │
      ▲  warning
      │
      ■  error
    `)
  })

  it("spies on every level", ({ clack }) => {
    clack.log.info("info")
    expect(clack.log.info).toHaveBeenCalledWith("info")
    expect(clack.log.error).not.toHaveBeenCalled()
  })
})

describe("stream", () => {
  it("renders streamed chunks", async ({ terminal, clack }) => {
    await clack.stream.info(words())
    await clack.stream.message(["multi\nline"])
    expect(terminal).toMatchInlineSnapshot(`
      │
      ●  Thinking about it
      │
      │  multi
      │  line
    `)
  })

  it("wraps at the terminal width", async ({ terminal, clack }) => {
    terminal.resize(16)
    await clack.stream.step(["one two ", "three four ", "five"])
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  one two
      │  three four
      │  five
    `)
  })
})

describe("spinner", () => {
  it("animates and stops", async ({ terminal, clack }) => {
    const spin = clack.spinner()
    spin.start("Installing")
    await terminal.waitFor("Installing")
    expect(terminal.screen()).toMatch(/^│\n. {2}Installing\.*$/v)

    spin.message("Linking")
    await terminal.waitFor("Linking")
    spin.stop("Installed")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  Installed
    `)
  })

  it("renders errors and cancellation", ({ terminal, clack }) => {
    const failing = clack.spinner()
    failing.start("Downloading")
    failing.error("Download failed")

    const canceled = clack.spinner()
    canceled.start("Building")
    canceled.cancel("Build canceled")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ▲  Download failed
      │
      ■  Build canceled
    `)
  })
})

describe("progress", () => {
  it("advances a progress bar", async ({ terminal, clack }) => {
    const bar = clack.progress({ max: 4, size: 8 })
    bar.start("Copying")
    bar.advance(2, "Copying files")
    await terminal.waitFor("Copying files")
    expect(terminal.screen()).toMatch(/━{4}/v)
    bar.stop("Copied")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  Copied
    `)
  })
})

describe("tasks", () => {
  it("runs tasks with a spinner each", async ({ terminal, clack }) => {
    await clack.tasks([
      { title: "Fetching", task: () => "Fetched" },
      { title: "Skipped", enabled: false, task: () => "never" },
      {
        title: "Building",
        task: (message) => {
          message("Bundling")
          return "Built"
        },
      },
    ])
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  Fetched
      │
      ◇  Built
    `)
  })
})

describe("taskLog", () => {
  it("clears the log on success", ({ terminal, clack }) => {
    const log = clack.taskLog({ title: "Installing" })
    log.message("resolving")
    log.message("fetching")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  Installing
      │
      │  resolving
      │  fetching
    `)
    log.success("Installed")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Installed
    `)
  })

  it("keeps the log on error", ({ terminal, clack }) => {
    const log = clack.taskLog({ title: "Installing" })
    log.message("ERR_PNPM_FETCH_404")
    log.error("Install failed")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ■  Install failed
      │
      │  ERR_PNPM_FETCH_404
    `)
  })
})
