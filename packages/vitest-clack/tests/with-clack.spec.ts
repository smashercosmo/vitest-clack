import process from "node:process"
import stream from "node:stream"
import consumers from "node:stream/consumers"
import {
  afterAll,
  beforeAll,
  it as base,
  describe,
  expect,
  expectTypeOf,
  vi,
} from "vitest"

import type { ClackMock } from "#lib/index.js"

import { Terminal, withClack } from "#lib/index.js"

const it = withClack(base)

describe("a CLI under test", () => {
  it("is driven end to end", async ({ terminal, clack }) => {
    const { main } = await import("#tests/fixtures/cli.js")
    const result = main()

    await terminal.waitFor("Project name?")
    await terminal.press("enter")
    await terminal.waitFor("A name is required")
    await terminal.type("my-app")
    await terminal.press("enter")

    await terminal.waitFor("Package manager?")
    await terminal.press("down")
    await terminal.press("enter")

    await terminal.waitFor("Install dependencies?")
    await terminal.press("enter")

    await expect(result).resolves.toStrictEqual({
      name: "my-app",
      manager: "pnpm",
    })
    expect(terminal).toMatchInlineSnapshot(`
      ┌  create-app
      │
      ◇  Project name?
      │  my-app
      │
      ◇  Package manager?
      │  pnpm
      │
      ◇  Install dependencies?
      │  Yes
      │
      ◇  Installed
      │
      └  Created my-app
    `)
    expect(clack.text).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Project name?" }),
    )
    expect(clack.spinner).toHaveBeenCalledTimes(1)
  })

  it("handles cancellation", async ({ terminal, clack }) => {
    const { main } = await import("#tests/fixtures/cli.js")
    const result = main()

    await terminal.waitFor("Project name?")
    await terminal.press("ctrl+c")

    await expect(result).resolves.toBeUndefined()
    expect(clack.cancel).toHaveBeenCalledWith("Cancelled")
    expect(clack.select).not.toHaveBeenCalled()
  })

  it("can have prompts stubbed instead of answered", async ({
    terminal,
    clack,
  }) => {
    clack.text.mockResolvedValueOnce("stubbed")
    clack.select.mockResolvedValueOnce("npm")
    clack.confirm.mockResolvedValueOnce(false)

    const { main } = await import("#tests/fixtures/cli.js")
    await expect(main()).resolves.toStrictEqual({
      name: "stubbed",
      manager: "npm",
    })
    expect(terminal).toMatchInlineSnapshot(`
      ┌  create-app
      │
      └  Created stubbed
    `)
  })

  it("sees spies reset between tests", async ({ terminal, clack }) => {
    /**
     * The module was imported by the previous tests: it must still reach this
     * test's spies and terminal, and the stubs from the previous test must be
     * gone.
     */
    const { main } = await import("#tests/fixtures/cli.js")
    const result = main()
    await terminal.waitFor("Project name?")
    await terminal.press("ctrl+c")
    await result

    expect(clack.text).toHaveBeenCalledTimes(1)
    expect(clack.intro).toHaveBeenCalledTimes(1)
    expect(terminal.screen()).toContain("create-app")
  })
})

describe("fixtures", () => {
  it("mocks clack even when no fixture is destructured", async () => {
    const clack = await import("@clack/prompts")
    expect(vi.isMockFunction(clack.text)).toBe(true)
    expect(vi.isMockFunction(clack.log.info)).toBe(true)
    expect(vi.isMockFunction(clack.isCancel)).toBe(false)
  })

  it("provides the mocked module as `clack`", async ({ clack }) => {
    await expect(import("@clack/prompts")).resolves.toMatchObject({
      text: clack.text,
      select: clack.select,
    })
  })

  it("routes clack's output even when the caller passes its own streams", ({
    terminal,
    clack,
  }) => {
    const elsewhere = new stream.PassThrough()
    clack.log.info("captured", { output: elsewhere })
    expect(terminal.screen()).toContain("captured")
  })

  it("creates a fresh terminal for every test", ({ terminal }) => {
    expect(terminal).toBeInstanceOf(Terminal)
    expect(terminal.raw()).toBe("")
  })

  it("is typed", ({ terminal, clack }) => {
    expectTypeOf(terminal).toEqualTypeOf<Terminal>()
    expectTypeOf(clack).toEqualTypeOf<ClackMock>()
    // Spies keep the generic signatures of the originals.
    async function pick() {
      return clack.select({
        message: "Pick",
        options: [{ value: "a" as const, label: "A" }],
      })
    }
    expectTypeOf(pick).returns.resolves.toEqualTypeOf<
      "a" | typeof clack.CANCEL_SYMBOL
    >()
    expectTypeOf(clack.text.mock.calls).toEqualTypeOf<
      [Parameters<typeof clack.text>[0]][]
    >()
  })
})

describe("options", () => {
  const small = withClack(base, { columns: 40, rows: 10, timeout: 20 })

  small("configure the terminal", async ({ terminal }) => {
    expect(terminal.output.getWindowSize()).toStrictEqual([40, 10])
    await expect(terminal.waitFor("never")).rejects.toThrow(
      "Timed out after 20ms",
    )
  })
})

describe("composition", () => {
  const withGreeting = withClack(base.extend("greeting", "Hello"))
  const withCli = withClack(base).extend("cli", async ({ terminal }) => {
    void terminal
    return import("#tests/fixtures/cli.js")
  })

  withGreeting("keeps the base's fixtures", ({ greeting, terminal, clack }) => {
    clack.log.message(greeting)
    expect(terminal.screen()).toContain("Hello")
  })

  withCli("can be extended further", async ({ cli, terminal }) => {
    const result = cli.main()
    await terminal.press("ctrl+c")
    await expect(result).resolves.toBeUndefined()
  })
})

describe("environment", () => {
  beforeAll(() => {
    vi.stubEnv("CI", "true")
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it("unsets CI so clack renders as in an interactive terminal", () => {
    expect(process.env["CI"]).toBeUndefined()
  })

  base("restores CI afterwards", () => {
    expect(process.env["CI"]).toBe("true")
  })
})

describe("outside of a clack test", () => {
  base("the mock falls back to the real streams", async () => {
    expect.hasAssertions()
    const clack = await import("@clack/prompts")
    expect(vi.isMockFunction(clack.log.info)).toBe(true)

    const output = new stream.PassThrough()
    clack.log.info("passthrough", { output })
    output.end()
    await expect(consumers.text(output)).resolves.toContain("passthrough")
  })
})
