import { it as base, describe, expect } from "vitest"

import type { Step } from "#lib/index.js"

import { withClack } from "#lib/index.js"

const it = withClack(base, { timeout: 200 })

function isInstallMessage(step: Step): boolean {
  return /installed \d+/iv.test(step.message ?? "")
}

const LONG_MESSAGE =
  "Which packages do you want to install? You can enter a space- or comma-separated list of names"

describe("terminal.waitForStep", () => {
  it("resolves with the prompt once it is open, however clack wrapped it", async ({
    terminal,
  }) => {
    const clack = await import("@clack/prompts")
    const answer = clack.text({ message: LONG_MESSAGE, initialValue: "react" })

    const step = await terminal.waitForStep({
      type: "text",
      message: LONG_MESSAGE,
      state: "active",
    })
    expect(step).toStrictEqual({
      type: "text",
      message: LONG_MESSAGE,
      state: "active",
      value: "react",
    })

    await terminal.press("enter")
    await expect(answer).resolves.toBe("react")
  })

  it("resolves right away when the latest step already matches", async ({
    terminal,
  }) => {
    const clack = await import("@clack/prompts")
    clack.log.info("hello")

    await expect(
      terminal.waitForStep({ type: "log.info" }),
    ).resolves.toStrictEqual({
      type: "log.info",
      message: "hello",
    })
  })

  it("only looks at the latest step, so a repeated prompt is told apart from the answered one", async ({
    terminal,
  }) => {
    const clack = await import("@clack/prompts")
    async function ask() {
      await clack.text({ message: "Name?" })
      clack.log.warn("Try again.")
      return clack.text({ message: "Name?" })
    }
    const answers = ask()

    await terminal.waitForStep({
      type: "text",
      message: "Name?",
      state: "active",
    })
    await terminal.type("a")
    await terminal.press("enter")
    const second = await terminal.waitForStep({
      type: "text",
      message: "Name?",
      state: "active",
    })

    expect(second).toStrictEqual({
      type: "text",
      message: "Name?",
      state: "active",
    })
    expect(terminal.steps().map((step) => step.type)).toStrictEqual([
      "text",
      "log.warn",
      "text",
    ])
    await terminal.type("b")
    await terminal.press("enter")
    await expect(answers).resolves.toBe("b")
  })

  it("accepts a predicate", async ({ terminal }) => {
    const clack = await import("@clack/prompts")
    setTimeout(() => {
      clack.log.success("Installed 3 packages")
    }, 10)

    const step = await terminal.waitForStep(isInstallMessage)
    expect(step).toStrictEqual({
      type: "log.success",
      message: "Installed 3 packages",
    })
  })

  it("times out with the latest step and the screen in the message", async ({
    terminal,
  }) => {
    const clack = await import("@clack/prompts")
    clack.log.info("still waiting")

    await expect(terminal.waitForStep({ type: "outro" })).rejects.toThrow(
      /Timed out after 200ms waiting for a step matching \{ type: 'outro' \}\.\n{2}Latest step:\n {2}\{ type: 'log\.info', message: 'still waiting' \}\n{2}Screen:/v,
    )
  })
})
