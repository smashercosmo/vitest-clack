import readline from "node:readline"
import stream from "node:stream"
import { describe, expect, it } from "vitest"

import type { Key } from "#lib/keys.js"

import { isKey, keypressFor, keypressForChar } from "#lib/keys.js"

/**
 * Feeds `sequence` to Node's own keypress decoder and returns the first event
 * it emits.
 */
async function decode(
  sequence: string,
): Promise<{ str: string | undefined; key: object }> {
  const input = new stream.PassThrough()
  readline.emitKeypressEvents(input)
  const { promise, resolve } = Promise.withResolvers<{
    str: string | undefined
    key: object
  }>()
  input.once("keypress", (str, key) => {
    resolve({ str, key })
  })
  input.write(sequence)
  return promise
}

const NAMED_KEYS: Key[] = [
  "enter",
  "return",
  "escape",
  "tab",
  "shift+tab",
  "backspace",
  "delete",
  "space",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  "ctrl+a",
  "ctrl+c",
  "ctrl+d",
  "ctrl+u",
  "ctrl+z",
]

describe("keypressFor()", () => {
  it.for(NAMED_KEYS)("emits what Node emits for %s", async (name) => {
    expect.hasAssertions()
    const keypress = keypressFor(name)
    expect(keypress).toStrictEqual(await decode(keypress.key.sequence))
  })

  it("maps enter to the carriage return a terminal sends", () => {
    expect(keypressFor("enter").key).toMatchObject({
      name: "return",
      sequence: "\r",
    })
  })

  it("throws on unknown keys", () => {
    // @ts-expect-error -- An unknown key, on purpose.
    expect(() => keypressFor("f13")).toThrow('Unknown key "f13"')
  })
})

describe("keypressForChar()", () => {
  it.for([
    "a",
    "Z",
    "7",
    "-",
    ".",
    "/",
    " ",
    "é",
    "\t",
    "\r",
    "\u007F",
    "\u0003",
  ])("emits what Node emits for %j", async (char) => {
    expect.hasAssertions()
    expect(keypressForChar(char)).toStrictEqual(await decode(char))
  })
})

describe("isKey()", () => {
  it("recognises named and ctrl keys", () => {
    expect(isKey("enter")).toBe(true)
    expect(isKey("ctrl+c")).toBe(true)
    expect(isKey("ctrl+1")).toBe(false)
    expect(isKey("hyper")).toBe(false)
  })
})
