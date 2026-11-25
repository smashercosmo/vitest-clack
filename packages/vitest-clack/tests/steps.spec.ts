import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it as base, describe, expect } from "vitest"

import { Terminal, withClack } from "#lib/index.js"

const it = withClack(base)

function validatePort(value: string | undefined): string | undefined {
  return /^\d+$/v.test(value ?? "") ? undefined : "Must be a number"
}

// oxlint-disable-next-line typescript/require-await -- Async on purpose: `stream.*` take async iterables.
async function* streamedText() {
  yield "streamed"
  yield " text"
}

describe("a session", () => {
  it("is recorded as one step per clack call, without decorations", async ({
    terminal,
  }) => {
    const { main } = await import("#tests/fixtures/cli.js")
    const done = main()

    await terminal.waitFor("Project name?")
    await terminal.type("my-app")
    await terminal.press("enter")
    await terminal.waitFor("Package manager?")
    await terminal.press("down")
    await terminal.press("enter")
    await terminal.waitFor("Install dependencies?")
    await terminal.press("enter")
    await done

    expect(terminal.steps()).toMatchInlineSnapshot(`
      [
        {
          "message": "create-app",
          "type": "intro",
        },
        {
          "message": "Project name?",
          "state": "done",
          "type": "text",
          "value": "my-app",
        },
        {
          "message": "Package manager?",
          "state": "done",
          "type": "select",
          "value": "pnpm",
        },
        {
          "message": "Install dependencies?",
          "state": "done",
          "type": "confirm",
          "value": true,
        },
        {
          "message": "Installed",
          "state": "done",
          "type": "spinner",
        },
        {
          "message": "Created my-app",
          "type": "outro",
        },
      ]
    `)
  })

  it("shows cancellation", async ({ terminal }) => {
    const { main } = await import("#tests/fixtures/cli.js")
    const done = main()
    await terminal.waitFor("Project name?")
    await terminal.press("ctrl+c")
    await done

    expect(terminal.steps()).toMatchInlineSnapshot(`
      [
        {
          "message": "create-app",
          "type": "intro",
        },
        {
          "message": "Project name?",
          "state": "cancelled",
          "type": "text",
        },
        {
          "message": "Cancelled",
          "type": "cancel",
        },
      ]
    `)
  })

  it("leaves out stubbed prompts, which never run", async ({
    terminal,
    clack,
  }) => {
    clack.text.mockResolvedValueOnce("stubbed")
    clack.select.mockResolvedValueOnce("npm")
    clack.confirm.mockResolvedValueOnce(false)

    const { main } = await import("#tests/fixtures/cli.js")
    await main()

    expect(terminal.steps().map(({ type }) => type)).toStrictEqual([
      "intro",
      "outro",
    ])
  })
})

describe("an open prompt", () => {
  it("shows the text typed so far", async ({ terminal, clack }) => {
    void clack.text({ message: "Name?" })
    await terminal.type("Ad")
    expect(terminal.step()).toStrictEqual({
      type: "text",
      message: "Name?",
      state: "active",
      value: "Ad",
    })
  })

  it("shows the validation error it displays, until it's fixed", async ({
    terminal,
    clack,
  }) => {
    const answer = clack.text({
      message: "Port?",
      validate: validatePort,
    })
    await terminal.type("abc")
    await terminal.press("enter")
    expect(terminal.step()).toStrictEqual({
      type: "text",
      message: "Port?",
      state: "active",
      value: "abc",
      error: "Must be a number",
    })

    await terminal.press("backspace", { times: 3 })
    await terminal.type("80")
    expect(terminal.step()).not.toHaveProperty("error")

    await terminal.press("enter")
    await answer
    expect(terminal.step()).toStrictEqual({
      type: "text",
      message: "Port?",
      state: "done",
      value: "80",
    })
  })

  it("shows the focused option of a select", async ({ terminal, clack }) => {
    void clack.select({
      message: "Package manager?",
      options: [
        { value: "npm", label: "npm" },
        { value: "pnpm", label: "pnpm" },
      ],
    })
    await terminal.waitFor("Package manager?")
    expect(terminal.step().value).toBe("npm")
    await terminal.press("down")
    expect(terminal.step().value).toBe("pnpm")
  })

  it("shows the selected options of a multiselect", async ({
    terminal,
    clack,
  }) => {
    void clack.multiselect({
      message: "Features?",
      options: [
        { value: "ts", label: "TypeScript" },
        { value: "lint", label: "Linting" },
      ],
    })
    await terminal.press("down")
    await terminal.press("space")
    expect(terminal.step()).toStrictEqual({
      type: "multiselect",
      message: "Features?",
      state: "active",
      value: ["lint"],
    })
  })
})

describe("answers", () => {
  it("are recorded for every prompt", async ({
    terminal,
    clack,
    onTestFinished,
  }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vitest-clack-"))
    onTestFinished(async () => fs.rm(root, { recursive: true }))
    await fs.writeFile(path.join(root, "file.txt"), "")

    async function run(): Promise<void> {
      await clack.text({ message: "text", defaultValue: "fallback" })
      await clack.password({ message: "password" })
      await clack.confirm({ message: "confirm" })
      await clack.select({
        message: "select",
        options: [{ value: 1, label: "One" }],
      })
      await clack.selectKey({
        message: "selectKey",
        options: [{ value: "y", label: "Yes" }],
      })
      await clack.multiselect({
        message: "multiselect",
        options: [{ value: "a", label: "A" }],
      })
      await clack.groupMultiselect({
        message: "groupMultiselect",
        options: { group: [{ value: "g" }] },
      })
      await clack.autocomplete({
        message: "autocomplete",
        options: [{ value: "x", label: "X" }],
      })
      await clack.autocompleteMultiselect({
        message: "autocompleteMultiselect",
        options: [{ value: "m", label: "M" }],
      })
      await clack.multiline({ message: "multiline" })
      await clack.date({
        message: "date",
        initialValue: new Date(Date.UTC(2026, 0, 15)),
      })
      await clack.path({
        message: "path",
        initialValue: path.join(root, "file.txt"),
      })
    }
    const done = run()

    await terminal.press("enter") // `text`: empty, falls back to defaultValue
    await terminal.type("s3cret")
    await terminal.press("enter")
    await terminal.press("right") // `confirm`: No
    await terminal.press("enter")
    await terminal.press("enter") // `select`
    await terminal.type("y") // `selectKey`
    await terminal.press("space") // `multiselect`
    await terminal.press("enter")
    await terminal.press("space") // `groupMultiselect`
    await terminal.press("enter")
    await terminal.press("enter") // `autocomplete`
    await terminal.press("tab") // `autocompleteMultiselect`
    await terminal.press("enter")
    await terminal.type("two")
    await terminal.press("enter")
    await terminal.type("lines")
    await terminal.press("enter")
    await terminal.press("enter") // `multiline`
    await terminal.press("enter") // `date`
    await terminal.press("enter") // `path`
    await done

    expect(
      terminal.steps().map(({ type, value }) => [type, value]),
    ).toStrictEqual([
      ["text", "fallback"],
      ["password", "s3cret"],
      ["confirm", false],
      ["select", 1],
      ["selectKey", "y"],
      ["multiselect", ["a"]],
      ["groupMultiselect", ["g"]],
      ["autocomplete", "x"],
      ["autocompleteMultiselect", ["m"]],
      ["multiline", "two\nlines"],
      ["date", new Date(Date.UTC(2026, 0, 15))],
      ["path", path.join(root, "file.txt")],
    ])
    expect(new Set(terminal.steps().map(({ state }) => state))).toStrictEqual(
      new Set(["done"]),
    )
  })
})

describe("printed messages", () => {
  it("are recorded with their text and title", async ({ terminal, clack }) => {
    clack.intro("intro")
    clack.log.message(["multi", "line"])
    clack.log.info("info")
    clack.log.warn("warn")
    clack.note("Body", "Note title")
    clack.box("Inside", "Box title")
    await clack.stream.success(streamedText())
    clack.cancel("cancel")
    clack.outro()

    expect(terminal.steps()).toMatchInlineSnapshot(`
      [
        {
          "message": "intro",
          "type": "intro",
        },
        {
          "message": "multi
      line",
          "type": "log.message",
        },
        {
          "message": "info",
          "type": "log.info",
        },
        {
          "message": "warn",
          "type": "log.warn",
        },
        {
          "message": "Body",
          "title": "Note title",
          "type": "note",
        },
        {
          "message": "Inside",
          "title": "Box title",
          "type": "box",
        },
        {
          "message": "streamed text",
          "type": "stream.success",
        },
        {
          "message": "cancel",
          "type": "cancel",
        },
        {
          "type": "outro",
        },
      ]
    `)
  })
})

describe("spinners and tasks", () => {
  it("record a spinner's messages and how it ended", ({ terminal, clack }) => {
    const spin = clack.spinner()
    spin.start("Installing...")
    expect(terminal.step()).toStrictEqual({
      type: "spinner",
      message: "Installing...",
      state: "active",
    })
    spin.message("Linking")
    expect(terminal.step().message).toBe("Linking")
    spin.stop("Installed")

    const failing = clack.spinner()
    failing.start("Downloading")
    failing.error("Download failed")

    const cancelled = clack.spinner()
    cancelled.start("Building")
    cancelled.cancel("Build cancelled")

    expect(terminal.steps()).toMatchInlineSnapshot(`
      [
        {
          "message": "Installed",
          "state": "done",
          "type": "spinner",
        },
        {
          "message": "Download failed",
          "state": "failed",
          "type": "spinner",
        },
        {
          "message": "Build cancelled",
          "state": "cancelled",
          "type": "spinner",
        },
      ]
    `)
  })

  it("start a spinner's step when it starts spinning", ({
    terminal,
    clack,
  }) => {
    const spin = clack.spinner()
    clack.log.step("Preparing")
    spin.start("Installing")
    spin.stop("Installed")
    expect(terminal.steps().map(({ type }) => type)).toStrictEqual([
      "log.step",
      "spinner",
    ])
  })

  it("record a progress bar's progress", ({ terminal, clack }) => {
    const bar = clack.progress({ max: 10 })
    bar.start("Copying")
    bar.advance(3, "Copying files")
    bar.advance()
    expect(terminal.step()).toStrictEqual({
      type: "progress",
      message: "Copying files",
      state: "active",
      value: 4,
    })
    bar.stop("Copied")
    expect(terminal.step()).toStrictEqual({
      type: "progress",
      message: "Copied",
      state: "done",
      value: 4,
    })
  })

  it("record each task that runs", async ({ terminal, clack }) => {
    await clack.tasks([
      { title: "Fetching", task: () => "Fetched" },
      { title: "Skipped", enabled: false, task: () => "never" },
      {
        title: "Building",
        task: (message) => {
          message("Bundling")
        },
      },
    ])
    expect(terminal.steps()).toMatchInlineSnapshot(`
      [
        {
          "message": "Fetched",
          "state": "done",
          "type": "task",
        },
        {
          "message": "Building",
          "state": "done",
          "type": "task",
        },
      ]
    `)
  })

  it("record a failing task", async ({ terminal, clack }) => {
    const run = clack.tasks([
      {
        title: "Deploying",
        task: () => {
          throw new Error("boom")
        },
      },
    ])
    await expect(run).rejects.toThrow("boom")
    expect(terminal.step()).toMatchObject({
      type: "task",
      message: "Deploying",
      state: "failed",
    })
  })

  it("record a task log, groups included", ({ terminal, clack }) => {
    const log = clack.taskLog({ title: "Installing" })
    log.message("resolving")
    log.group("react").message("fetching react")
    expect(terminal.step()).toStrictEqual({
      type: "taskLog",
      title: "Installing",
      state: "active",
      log: ["resolving", "fetching react"],
    })
    log.error("Install failed")
    expect(terminal.step()).toMatchObject({
      state: "failed",
      message: "Install failed",
    })
  })
})

describe("step()", () => {
  it("picks steps by index", ({ terminal, clack }) => {
    clack.intro("one")
    clack.log.info("two")
    clack.outro("three")

    expect(terminal.step(0)).toStrictEqual({ type: "intro", message: "one" })
    expect(terminal.step(-2)).toStrictEqual({
      type: "log.info",
      message: "two",
    })
    expect(terminal.step()).toStrictEqual({ type: "outro", message: "three" })
    expect(() => terminal.step(3)).toThrow(
      new RangeError(
        "No step at index 3: there are 3 (intro, log.info, outro).",
      ),
    )
  })

  it("fails clearly when nothing has been called", ({ terminal }) => {
    expect(terminal.steps()).toStrictEqual([])
    expect(() => terminal.step()).toThrow(
      new RangeError("No clack function has been called yet."),
    )
  })

  it("returns snapshots that don't change afterwards", async ({
    terminal,
    clack,
  }) => {
    void clack.text({ message: "Name?" })
    await terminal.type("A")
    const before = terminal.step()
    await terminal.type("da")
    expect(before.value).toBe("A")
    expect(terminal.step().value).toBe("Ada")
  })
})

describe("a terminal used without clack", () => {
  base("has no steps", () => {
    const terminal = new Terminal()
    terminal.output.write("plain output\n")
    expect(terminal.steps()).toStrictEqual([])
  })
})
