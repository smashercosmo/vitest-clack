import { describe, expect, it } from "vitest"

import { Screen } from "#lib/screen.js"

function render(chunks: string | string[], rows = 24): Screen {
  const screen = new Screen(() => rows)
  for (const chunk of [chunks].flat()) {
    screen.write(chunk)
  }
  return screen
}

describe("screen", () => {
  it("prints text and line feeds", () => {
    expect(render("one\ntwo\n").lines()).toStrictEqual(["one", "two"])
  })

  it("treats a line feed as CR+LF", () => {
    expect(render("abc\nd").lines()).toStrictEqual(["abc", "d"])
  })

  it("overwrites after a carriage return", () => {
    expect(render("hello\rje").toString()).toBe("jello")
  })

  it("handles backspace and tabs", () => {
    expect(render("ab\bc").toString()).toBe("ac")
    expect(render("a\tb").toString()).toBe("a       b")
  })

  it("ignores styling and cursor visibility", () => {
    expect(
      render("\u001B[?25l\u001B[1;32mgreen\u001B[39;22m\u001B[?25h").toString(),
    ).toBe("green")
  })

  it("ignores OSC sequences such as hyperlinks", () => {
    expect(
      render(
        "\u001B]8;;https://example.com\u0007link\u001B]8;;\u001B\\",
      ).toString(),
    ).toBe("link")
  })

  it("moves the cursor relatively", () => {
    expect(
      render("aaa\nbbb\nccc\u001B[2A\u001B[1Dx\u001B[1By").lines(),
    ).toStrictEqual(["aax", "bbby", "ccc"])
  })

  it("moves the cursor to a column", () => {
    expect(render("abcdef\u001B[3GX\u001B[GY").toString()).toBe("YbXdef")
  })

  it("moves the cursor to the next and previous lines", () => {
    expect(render("one\ntwo\u001B[1Fz\u001B[1Ey").lines()).toStrictEqual([
      "zne",
      "ywo",
    ])
  })

  it("positions the cursor absolutely within the viewport", () => {
    expect(render("first\nsecond\u001B[1;3HX").lines()).toStrictEqual([
      "fiXst",
      "second",
    ])
  })

  it("erases lines", () => {
    expect(render("abcdef\u001B[3G\u001B[K").toString()).toBe("ab")
    expect(render("abcdef\u001B[3G\u001B[1K").toString()).toBe("   def")
    expect(render("abcdef\u001B[2K").toString()).toBe("")
  })

  it("erases the screen below the cursor", () => {
    expect(
      render("one\ntwo\nthree\u001B[1A\u001B[2G\u001B[J").lines(),
    ).toStrictEqual(["one", "t"])
  })

  it("erases the screen above the cursor", () => {
    expect(render("one\ntwo\nthree\u001B[2G\u001B[1J").lines()).toStrictEqual([
      "",
      "",
      "  ree",
    ])
  })

  it("erases the viewport", () => {
    expect(render("one\ntwo\u001B[2J").toString()).toBe("")
    expect(render("one\ntwo\nthree\u001B[2J", 2).lines()).toStrictEqual(["one"])
  })

  it("erases the scrollback", () => {
    expect(render("one\ntwo\nthree\u001B[3J", 2).lines()).toStrictEqual([
      "two",
      "three",
    ])
    expect(render("one\ntwo\u001B[3J").lines()).toStrictEqual(["one", "two"])
  })

  it("saves and restores the cursor", () => {
    expect(render("ab\u001B7\ncd\u001B8X").lines()).toStrictEqual(["abX", "cd"])
    expect(render("ab\u001B[s\ncd\u001B[uX").lines()).toStrictEqual([
      "abX",
      "cd",
    ])
  })

  it("re-renders a frame the way clack does", () => {
    // What `text()` writes when the user types "A": go back to the frame start, rewrite one line.
    const frame = "◆  Name?\n│  _\n└\n"
    const update =
      "\u001B[999D\u001B[3A\u001B[1B\u001B[2K\u001B[G│  A█\u001B[2B"
    expect(render([frame, update]).lines()).toStrictEqual([
      "◆  Name?",
      "│  A█",
      "└",
    ])
  })

  it("buffers escape sequences split across writes", () => {
    expect(render(["abc\u001B", "[2", "DX"]).toString()).toBe("aXc")
  })

  it("can't move the cursor into scrollback", () => {
    const screen = render("1\n2\n3\n4\u001B[10AX", 2)
    expect(screen.lines()).toStrictEqual(["1", "2", "3X", "4"])
    expect(screen.cursor).toStrictEqual({ row: 2, col: 2 })
  })

  it("keeps the cursor at the start of the line", () => {
    expect(render("ab\u001B[5Dc").toString()).toBe("cb")
  })

  it("trims trailing blanks", () => {
    expect(render("a   \n\n\n").lines()).toStrictEqual(["a"])
  })
})
