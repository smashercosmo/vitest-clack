import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it as base, describe, expect, vi } from "vitest"

import { withClack } from "#lib/index.js"

const it = withClack(base)

function validatePort(value: string | undefined): string | undefined {
  return /^\d+$/v.test(value ?? "") ? undefined : "Must be a number"
}

describe("text", () => {
  it("reads typed input", async ({ terminal, clack }) => {
    const answer = clack.text({ message: "Your name?", placeholder: "Ada" })

    await terminal.waitFor("Your name?")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Your name?
      │  Ada
      └
    `)

    await terminal.type("Grace")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Your name?
      │  Grace█
      └
    `)

    await terminal.press("enter")
    await expect(answer).resolves.toBe("Grace")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  Your name?
      │  Grace
    `)
  })

  it("edits input with backspace and arrows", async ({ terminal, clack }) => {
    const answer = clack.text({ message: "Word?" })
    await terminal.type("helo")
    await terminal.press("left")
    await terminal.type("l")
    await terminal.press("end")
    await terminal.type("!!")
    await terminal.press("backspace")
    await terminal.press("enter")
    await expect(answer).resolves.toBe("hello!")
  })

  it("shows validation errors until the input is valid", async ({
    terminal,
    clack,
  }) => {
    const answer = clack.text({
      message: "Port?",
      validate: validatePort,
    })
    await terminal.type("abc")
    await terminal.press("enter")
    await terminal.waitFor("Must be a number")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ▲  Port?
      │  abc█
      └  Must be a number
    `)

    await terminal.press("backspace", { times: 3 })
    await terminal.type("8080")
    await terminal.press("enter")
    await expect(answer).resolves.toBe("8080")
  })

  it("submits the initial value", async ({ terminal, clack }) => {
    const answer = clack.text({ message: "Directory?", initialValue: "./app" })
    await terminal.press("enter")
    await expect(answer).resolves.toBe("./app")
  })

  it("is canceled by ctrl+c", async ({ terminal, clack }) => {
    const answer = clack.text({ message: "Your name?" })
    await terminal.press("ctrl+c")
    expect(clack.isCancel(await answer)).toBe(true)
    expect(terminal).toMatchInlineSnapshot(`
      │
      ■  Your name?
      │
    `)
  })

  it("is canceled by escape", async ({ terminal, clack }) => {
    const answer = clack.text({ message: "Your name?" })
    await terminal.press("escape")
    expect(clack.isCancel(await answer)).toBe(true)
  })
})

describe("password", () => {
  it("masks the input", async ({ terminal, clack }) => {
    const answer = clack.password({ message: "Token?" })
    await terminal.type("s3cret")
    expect(terminal.screen()).not.toContain("s3cret")
    await terminal.press("enter")
    await expect(answer).resolves.toBe("s3cret")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  Token?
      │  ▪▪▪▪▪▪
    `)
  })
})

describe("confirm", () => {
  it("toggles with arrows", async ({ terminal, clack }) => {
    const answer = clack.confirm({ message: "Continue?" })
    await terminal.waitFor("Continue?")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Continue?
      │  ● Yes / ○ No
      └
    `)
    await terminal.press("right")
    await terminal.press("enter")
    await expect(answer).resolves.toBe(false)
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  Continue?
      │  No
    `)
  })

  it("answers with y and n", async ({ terminal, clack }) => {
    const yes = clack.confirm({ message: "First?", initialValue: false })
    await terminal.type("y")
    await expect(yes).resolves.toBe(true)

    const no = clack.confirm({ message: "Second?" })
    await terminal.type("n")
    await expect(no).resolves.toBe(false)
  })
})

describe("select", () => {
  const options = [
    { value: "npm", label: "npm" },
    { value: "pnpm", label: "pnpm", hint: "recommended" },
    { value: "yarn", label: "yarn" },
  ]

  it("moves the cursor and submits", async ({ terminal, clack }) => {
    const answer = clack.select({ message: "Package manager?", options })
    await terminal.waitFor("Package manager?")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Package manager?
      │  ● npm
      │  ○ pnpm
      │  ○ yarn
      │  ↑/↓ to navigate • Enter: confirm
      └
    `)

    await terminal.press("down")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Package manager?
      │  ○ npm
      │  ● pnpm (recommended)
      │  ○ yarn
      │  ↑/↓ to navigate • Enter: confirm
      └
    `)

    await terminal.press("enter")
    await expect(answer).resolves.toBe("pnpm")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◇  Package manager?
      │  pnpm
    `)
  })

  it("wraps around and supports vim keys", async ({ terminal, clack }) => {
    const answer = clack.select({ message: "Package manager?", options })
    await terminal.press("up")
    await terminal.type("k")
    await terminal.press("enter")
    await expect(answer).resolves.toBe("pnpm")
  })

  it("only shows as many options as fit the terminal", async ({
    terminal,
    clack,
  }) => {
    terminal.resize(80, 8)
    const many = Array.from({ length: 20 }, (_value, index) => ({
      value: index,
      label: `Option ${index}`,
    }))
    const answer = clack.select({ message: "Pick", options: many })
    await terminal.waitFor("Pick")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Pick
      │  ● Option 0
      │  ...
      │  ↑/↓ to navigate • Enter: confirm
      └
    `)
    await terminal.press("enter")
    await expect(answer).resolves.toBe(0)
  })
})

describe("selectKey", () => {
  it("submits on the option's key", async ({ terminal, clack }) => {
    const answer = clack.selectKey({
      message: "Action?",
      options: [
        { value: "a", label: "Add" },
        { value: "d", label: "Delete" },
      ],
    })
    await terminal.waitFor("Action?")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Action?
      │   a  Add
      │   d  Delete
      └
    `)
    await terminal.type("d")
    await expect(answer).resolves.toBe("d")
  })
})

describe("multiselect", () => {
  it("toggles options with space", async ({ terminal, clack }) => {
    const answer = clack.multiselect({
      message: "Features?",
      options: [
        { value: "ts", label: "TypeScript" },
        { value: "lint", label: "Linting" },
        { value: "test", label: "Testing" },
      ],
    })
    await terminal.press("space")
    await terminal.press("down", { times: 2 })
    await terminal.press("space")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Features?
      │  ◼ TypeScript
      │  ◻ Linting
      │  ◼ Testing
      │  ↑/↓ to navigate • Space: select • Enter: confirm
      └
    `)

    await terminal.press("enter")
    await expect(answer).resolves.toStrictEqual(["ts", "test"])
  })

  it("requires a selection by default", async ({ terminal, clack }) => {
    const answer = clack.multiselect({
      message: "Features?",
      options: [{ value: "ts", label: "TypeScript" }],
    })
    await terminal.press("enter")
    await terminal.waitFor(/at least one/iv)
    await terminal.press("space")
    await terminal.press("enter")
    await expect(answer).resolves.toStrictEqual(["ts"])
  })
})

describe("groupMultiselect", () => {
  it("selects whole groups", async ({ terminal, clack }) => {
    const answer = clack.groupMultiselect({
      message: "Packages?",
      options: {
        frontend: [{ value: "react" }, { value: "vue" }],
        backend: [{ value: "express" }],
      },
    })
    await terminal.waitFor("Packages?")
    await terminal.press("space")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Packages?
      │  ◼ frontend
      │  │ ◼ react
      │  └ ◼ vue
      │  ◻ backend
      │  └ ◻ express
      │  ↑/↓ to navigate • Space: select • Enter: confirm
      └
    `)
    await terminal.press("enter")
    await expect(answer).resolves.toStrictEqual(["react", "vue"])
  })
})

describe("autocomplete", () => {
  it("filters options while typing", async ({ terminal, clack }) => {
    const answer = clack.autocomplete({
      message: "Framework?",
      options: [
        { value: "astro", label: "Astro" },
        { value: "next", label: "Next.js" },
        { value: "nuxt", label: "Nuxt" },
      ],
    })
    await terminal.type("nu")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Framework?
      │
      │  Search: nu█ (1 match)
      │  ● Nuxt
      │  ↑/↓ to select • Enter: confirm • Type: to search
      └
    `)
    await terminal.press("enter")
    await expect(answer).resolves.toBe("nuxt")
  })
})

describe("autocompleteMultiselect", () => {
  it("filters and toggles options", async ({ terminal, clack }) => {
    const answer = clack.autocompleteMultiselect({
      message: "Tools?",
      options: [
        { value: "eslint", label: "ESLint" },
        { value: "oxlint", label: "Oxlint" },
        { value: "prettier", label: "Prettier" },
      ],
    })
    await terminal.type("lint")
    await terminal.press("tab")
    await terminal.press("down")
    await terminal.press("tab")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Tools?
      │
      │  Search: lint (2 matches)
      │  ◼ ESLint
      │  ◼ Oxlint
      │  ↑/↓ to navigate • Space/Tab: select • Enter: confirm • Type: to search
      └
    `)
    await terminal.press("enter")
    await expect(answer).resolves.toStrictEqual(["eslint", "oxlint"])
  })
})

describe("multiline", () => {
  it("submits on a second enter", async ({ terminal, clack }) => {
    const answer = clack.multiline({ message: "Bio?" })
    await terminal.type("line one")
    await terminal.press("enter")
    await terminal.type("line two")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Bio?
      │  line one
      │  line two█
      └
    `)
    await terminal.press("enter")
    await terminal.press("enter")
    await expect(answer).resolves.toBe("line one\nline two")
  })
})

describe("date", () => {
  it("edits date segments", async ({ terminal, clack }) => {
    const answer = clack.date({
      message: "Release date?",
      format: "YMD",
      // Clack reads and returns dates in UTC.
      initialValue: new Date(Date.UTC(2026, 0, 15)),
    })
    await terminal.waitFor("Release date?")
    expect(terminal).toMatchInlineSnapshot(`
      │
      ◆  Release date?
      │  2026/01/15
      └
    `)
    await terminal.press("up")
    await terminal.press("right")
    await terminal.press("up")
    expect(terminal.screen()).toContain("2027/02/15")
    await terminal.press("enter")
    await expect(answer).resolves.toStrictEqual(new Date(Date.UTC(2027, 1, 15)))
  })
})

describe("path prompt", () => {
  it("suggests entries of the typed directory", async ({
    terminal,
    clack,
    onTestFinished,
  }) => {
    // The suggestions are absolute paths, and `os.tmpdir()` can be long (on macOS, `/var/folders/…/T/`): at 80 columns clack would wrap a file name in two.
    terminal.resize(200)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vitest-clack-"))
    onTestFinished(async () => fs.rm(root, { recursive: true }))
    await fs.writeFile(path.join(root, "alpha.txt"), "")
    await fs.writeFile(path.join(root, "beta.txt"), "")

    const answer = clack.path({
      message: "File?",
      initialValue: root + path.sep,
    })
    await terminal.waitFor("File?")
    expect(terminal.screen()).toContain("alpha.txt")
    expect(terminal.screen()).toContain("beta.txt")

    await terminal.type("b")
    expect(terminal.screen()).not.toContain("alpha.txt")
    await terminal.press("enter")
    await expect(answer).resolves.toBe(path.join(root, "beta.txt"))
  })
})

describe("group", () => {
  it("runs prompts in sequence and collects their results", async ({
    terminal,
    clack,
  }) => {
    const answers = clack.group({
      name: async () => clack.text({ message: "Name?" }),
      confirmed: async ({ results }) =>
        clack.confirm({ message: `Hi ${results.name}, continue?` }),
    })
    await terminal.waitFor("Name?")
    await terminal.type("Ada")
    await terminal.press("enter")
    await terminal.waitFor("Hi Ada, continue?")
    await terminal.press("enter")
    await expect(answers).resolves.toStrictEqual({
      name: "Ada",
      confirmed: true,
    })
    expect(clack.group).toHaveBeenCalledTimes(1)
  })

  it("reports canceled prompts and carries on", async ({ terminal, clack }) => {
    const onCancel = vi.fn<() => void>()
    const answers = clack.group(
      {
        name: async () => clack.text({ message: "Name?" }),
        age: async () => clack.text({ message: "Age?" }),
      },
      { onCancel },
    )
    await terminal.press("ctrl+c")
    await terminal.waitFor("Age?")
    await terminal.type("36")
    await terminal.press("enter")
    await expect(answers).resolves.toStrictEqual({
      name: "canceled",
      age: "36",
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(clack.text).toHaveBeenCalledTimes(2)
  })
})
