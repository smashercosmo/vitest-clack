import timers from "node:timers"
import { describe, expect, it } from "vitest"

import { Terminal } from "#lib/terminal.js"

/** Subscribes to key presses the way clack does, recording them. */
function listen(terminal: Terminal) {
  const keys: { str: string | undefined; name: string | undefined }[] = []

  function listener(str: string | undefined, key: { name?: string }) {
    keys.push({ str, name: key.name })
  }

  terminal.input.on("keypress", listener)
  return {
    keys,
    stop: () => {
      terminal.input.off("keypress", listener)
    },
  }
}

async function outcome(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return "resolved"
  } catch {
    return "rejected"
  }
}

describe("terminal", () => {
  it("looks like an interactive TTY", () => {
    const terminal = new Terminal({ columns: 100, rows: 30 })
    expect(terminal.input.isTTY).toBe(true)
    expect(terminal.output.isTTY).toBe(true)
    expect(terminal.output.columns).toBe(100)
    expect(terminal.output.rows).toBe(30)
    expect(terminal.output.getWindowSize()).toStrictEqual([100, 30])
    expect(terminal.input.setRawMode(true).isRaw).toBe(true)
  })

  it("defaults to 80x24", () => {
    const terminal = new Terminal()
    expect(terminal.output.getWindowSize()).toStrictEqual([80, 24])
  })

  it("separates the screen, the transcript and the raw output", () => {
    const terminal = new Terminal()
    terminal.output.write("\u001B[32mloading\u001B[39m")
    terminal.output.write("\r\u001B[2Kdone\n")

    expect(terminal.screen()).toBe("done")
    expect(terminal.lines()).toStrictEqual(["done"])
    expect(terminal.transcript()).toBe("loading\rdone\n")
    expect(terminal.raw()).toBe("\u001B[32mloading\u001B[39m\r\u001B[2Kdone\n")
  })

  describe("waitFor", () => {
    it("resolves on output that's already there", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      terminal.output.write("ready")
      await expect(terminal.waitFor("ready")).resolves.toBeUndefined()
    })

    it("resolves when the output arrives", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      timers.setTimeout(() => {
        terminal.output.write("later")
      }, 10)
      await expect(terminal.waitFor("later")).resolves.toBeUndefined()
    })

    it("matches across writes and ignores styling", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      const waiting = terminal.waitFor("hello world")
      terminal.output.write("\u001B[1mhello")
      terminal.output.write(" \u001B[22mworld")
      await expect(waiting).resolves.toBeUndefined()
    })

    it("accepts regular expressions", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      terminal.output.write("Installed 42 packages")
      await expect(
        terminal.waitFor(/installed \d+ packages/iv),
      ).resolves.toBeUndefined()
    })

    it("ignores global and sticky flags", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      terminal.output.write("xx a")
      await expect(terminal.waitFor(/a/gvy)).resolves.toBeUndefined()
    })

    it("consumes matched output so waits are sequential", async () => {
      expect.hasAssertions()
      const terminal = new Terminal({ timeout: 50 })
      terminal.output.write("Continue?\n")
      await terminal.waitFor("Continue?")
      await expect(terminal.waitFor("Continue?")).rejects.toThrow(
        'waiting for "Continue?"',
      )

      terminal.output.write("Continue?\n")
      await expect(terminal.waitFor("Continue?")).resolves.toBeUndefined()
    })

    it("fails with the current screen after the timeout", async () => {
      expect.hasAssertions()
      const terminal = new Terminal({ timeout: 20 })
      terminal.output.write("◆  Pick one\n│  ● a\n")
      await expect(terminal.waitFor("Pick two")).rejects
        .toThrowErrorMatchingInlineSnapshot(`
        [Error: Timed out after 20ms waiting for "Pick two".

        Screen:
          ◆  Pick one
          │  ● a]
      `)
    })

    it("supports a per-call timeout", async () => {
      expect.hasAssertions()
      const terminal = new Terminal({ timeout: 5000 })
      await expect(terminal.waitFor(/never/v, { timeout: 10 })).rejects.toThrow(
        "Timed out after 10ms waiting for /never/v.",
      )
    })

    it("stops waiting once disposed", async () => {
      expect.hasAssertions()
      const terminal = new Terminal({ timeout: 10 })
      const waiting = outcome(terminal.waitFor("never"))
      terminal.dispose()
      await expect(
        Promise.race([waiting, timers.promises.setTimeout(30, "pending")]),
      ).resolves.toBe("pending")
    })
  })

  describe("type", () => {
    it("emits one key press per character", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      const { keys } = listen(terminal)
      await terminal.type("Hi!")
      expect(keys).toStrictEqual([
        { str: "H", name: "h" },
        { str: "i", name: "i" },
        { str: "!", name: undefined },
      ])
    })

    it("waits for a prompt to start listening", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      const typing = terminal.type("a")
      const { keys } = listen(terminal)
      await typing
      expect(keys).toStrictEqual([{ str: "a", name: "a" }])
    })

    it("fails when no prompt starts listening", async () => {
      expect.hasAssertions()
      const terminal = new Terminal({ timeout: 10 })
      await expect(terminal.type("a")).rejects.toThrow(
        'Timed out after 10ms waiting for a prompt to send "a" to.',
      )
    })
  })

  describe("press", () => {
    it("emits the key press", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      const { keys } = listen(terminal)
      await terminal.press("down")
      await terminal.press("ctrl+c")
      expect(keys).toStrictEqual([
        { str: undefined, name: "down" },
        { str: "\u0003", name: "c" },
      ])
    })

    it("presses a key several times", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      const { keys } = listen(terminal)
      await terminal.press("space", { times: 3 })
      expect(keys).toHaveLength(3)
    })

    it("rejects unknown keys", async () => {
      expect.hasAssertions()
      const terminal = new Terminal()
      // @ts-expect-error -- An unknown key, on purpose.
      await expect(terminal.press("hyper")).rejects.toThrow(
        'Unknown key "hyper"',
      )
    })

    it("fails when no prompt starts listening", async () => {
      expect.hasAssertions()
      const terminal = new Terminal({ timeout: 10 })
      await expect(terminal.press("enter", { timeout: 5 })).rejects.toThrow(
        'Timed out after 5ms waiting for a prompt to send "enter" to.',
      )
    })
  })

  it("reports whether a prompt is active", () => {
    const terminal = new Terminal()
    expect(terminal.isPromptActive).toBe(false)
    const { stop } = listen(terminal)
    expect(terminal.isPromptActive).toBe(true)
    stop()
    expect(terminal.isPromptActive).toBe(false)
  })

  it("resizes and notifies listeners", () => {
    const terminal = new Terminal()
    let resized = 0
    terminal.output.on("resize", () => {
      resized += 1
    })
    terminal.resize(40)
    expect(terminal.output.getWindowSize()).toStrictEqual([40, 24])
    terminal.resize(60, 10)
    expect(terminal.output.getWindowSize()).toStrictEqual([60, 10])
    expect(resized).toBe(2)
  })
})
