interface Position {
  row: number
  col: number
}

/* oxlint-disable regexp/no-control-character, regexp/no-obscure-range -- ANSI sequences are made of control characters and byte ranges. */
// CSI: ESC [ <private marker?> <params> <intermediates> <final byte>
const CSI =
  /\u{1B}\[(?<marker>[<=>?]?)(?<params>[\d:;]*)[ -\/]*(?<final>[@-~])/vy
/** A CSI sequence that a later write will finish. */
const PARTIAL_CSI = /^\u{1B}\[[<=>?]?[\d:;]*[ -\/]*$/v
// OSC: ESC ] ... terminated by BEL or ST (ESC \)
const OSC = /\u{1B}\][^\u{7}\u{1B}]*(?:\u{7}|\u{1B}\\)/vy
/* oxlint-enable regexp/no-control-character, regexp/no-obscure-range */

/**
 * A minimal virtual terminal: it interprets the subset of ANSI control
 * sequences clack (through `sisteransi`) emits — relative/absolute cursor
 * movement, line and screen erasure, cursor save/restore — and ignores styling.
 * The result is the text a user would actually see, which is what makes
 * assertions on re-rendered prompts meaningful.
 *
 * Long lines are not soft-wrapped: clack wraps its own frames before writing
 * them.
 */
class Screen {
  #lines: string[][] = [[]]
  #cursor: Position = { row: 0, col: 0 }
  #saved: Position = { row: 0, col: 0 }
  /**
   * Index of the first line of the visible viewport; everything above it is
   * scrollback.
   */
  #top = 0
  /**
   * Lines removed by clearing the scrollback, so row numbers handed out stay
   * stable.
   */
  #dropped = 0
  /** An escape sequence split across two writes. */
  #pending = ""
  readonly #rows: () => number

  constructor(rows: () => number) {
    this.#rows = rows
  }

  /** The cursor position. Rows count from the first line ever written. */
  get cursor(): Readonly<Position> {
    return { row: this.#cursor.row + this.#dropped, col: this.#cursor.col }
  }

  write(data: string): void {
    const text = this.#pending + data
    this.#pending = ""

    let index = 0
    while (index < text.length) {
      const consumed = this.#read(text, index)
      if (consumed === 0) {
        this.#pending = text.slice(index)
        return
      }
      index += consumed
    }
  }

  /**
   * Everything written so far (scrollback included), one string per line,
   * without trailing blanks.
   */
  lines(): string[] {
    return this.slice(this.#dropped)
  }

  /**
   * The lines from row `start` up to, not including, row `end` (rows as
   * reported by {@link Screen.cursor}), without trailing blanks.
   */
  slice(start: number, end?: number): string[] {
    const from = Math.max(0, start - this.#dropped)
    const to =
      end === undefined
        ? this.#lines.length
        : Math.max(from, end - this.#dropped)
    const lines = this.#lines
      .slice(from, to)
      .map((line) => line.join("").trimEnd())
    while (lines.length > 0 && lines.at(-1) === "") {
      lines.pop()
    }
    return lines
  }

  toString(): string {
    return this.lines().join("\n")
  }

  /**
   * Interprets what starts at `index`, and returns how many code units it took:
   * 0 for an escape sequence the write cut off.
   */
  #read(text: string, index: number): number {
    const char = text.charAt(index)
    switch (char) {
      case "\u001B": {
        return this.#escape(text, index)
      }
      case "\n": {
        // TTYs translate LF to CRLF on output (`onlcr`).
        this.#moveTo(this.#cursor.row + 1, 0)
        return 1
      }
      case "\r": {
        this.#cursor.col = 0
        return 1
      }
      case "\b": {
        this.#cursor.col = Math.max(0, this.#cursor.col - 1)
        return 1
      }
      case "\t": {
        this.#cursor.col = (Math.floor(this.#cursor.col / 8) + 1) * 8
        return 1
      }
      default: {
        const codePoint = text.codePointAt(index)
        // Other control characters print nothing.
        if (codePoint === undefined || char < " ") {
          return 1
        }
        const glyph = String.fromCodePoint(codePoint)
        this.#print(glyph)
        return glyph.length
      }
    }
  }

  #line(row: number): string[] {
    const existing = this.#lines[row]
    if (existing !== undefined) {
      return existing
    }
    while (this.#lines.length < row) {
      this.#lines.push([])
    }
    const line: string[] = []
    this.#lines.push(line)
    return line
  }

  #print(glyph: string) {
    const line = this.#line(this.#cursor.row)
    while (line.length < this.#cursor.col) {
      line.push(" ")
    }
    line[this.#cursor.col] = glyph
    this.#cursor.col += 1
  }

  #moveTo(row: number, col: number) {
    const rows = this.#rows()
    // A real terminal can't move the cursor into scrollback.
    const nextRow = Math.max(this.#top, row)
    if (nextRow > this.#top + rows - 1) {
      this.#top = nextRow - rows + 1
    }
    this.#line(nextRow)
    this.#cursor = { row: nextRow, col: Math.max(0, col) }
  }

  #escape(text: string, index: number): number {
    if (index + 1 >= text.length) {
      return 0
    }

    const next = text[index + 1]
    if (next === "[") {
      CSI.lastIndex = index
      const match = CSI.exec(text)
      if (!match) {
        return PARTIAL_CSI.test(text.slice(index)) ? 0 : 2
      }
      const { marker = "", params = "", final = "" } = match.groups ?? {}
      if (marker === "") {
        this.#csi(final, params)
      }
      return match[0].length
    }
    if (next === "]") {
      OSC.lastIndex = index
      const match = OSC.exec(text)
      return match ? match[0].length : 0
    }
    if (next === "7") {
      this.#saved = { ...this.#cursor }
    }
    if (next === "8") {
      this.#moveTo(this.#saved.row, this.#saved.col)
    }
    return 2
  }

  #csi(final: string, rawParams: string) {
    const params = rawParams
      .split(/[:;]/v)
      .map((value) => Number.parseInt(value, 10))

    function param(position = 0, fallback = 1) {
      const value = params[position]
      return value === undefined || Number.isNaN(value) ? fallback : value
    }

    const { row, col } = this.#cursor

    switch (final) {
      case "A": {
        this.#moveTo(row - param(), col)
        break
      }
      case "B": {
        this.#moveTo(row + param(), col)
        break
      }
      case "C": {
        this.#moveTo(row, col + param())
        break
      }
      case "D": {
        this.#moveTo(row, col - param())
        break
      }
      case "E": {
        this.#moveTo(row + param(), 0)
        break
      }
      case "F": {
        this.#moveTo(row - param(), 0)
        break
      }
      case "G": {
        this.#moveTo(row, param() - 1)
        break
      }
      case "d": {
        this.#moveTo(this.#top + param() - 1, col)
        break
      }
      case "H":
      case "f": {
        this.#moveTo(this.#top + param(0) - 1, param(1) - 1)
        break
      }
      case "s": {
        this.#saved = { ...this.#cursor }
        break
      }
      case "u": {
        this.#moveTo(this.#saved.row, this.#saved.col)
        break
      }
      case "K": {
        this.#eraseLine(param(0, 0))
        break
      }
      case "J": {
        this.#eraseScreen(param(0, 0))
        break
      }
      default:
      // Styling (`m`) and everything else has no effect on the text.
    }
  }

  #eraseLine(mode: number) {
    const line = this.#line(this.#cursor.row)
    if (mode === 0) {
      line.length = Math.min(line.length, this.#cursor.col)
    }
    if (mode === 1) {
      line.fill(" ", 0, Math.min(line.length, this.#cursor.col + 1))
    }
    if (mode === 2) {
      line.length = 0
    }
  }

  #eraseScreen(mode: number) {
    const { row } = this.#cursor
    if (mode === 0) {
      this.#eraseLine(0)
      this.#lines.length = row + 1
    }
    if (mode === 1) {
      for (let erased = this.#top; erased < row; erased += 1) {
        this.#lines[erased] = []
      }
      this.#eraseLine(1)
    }
    if (mode === 2) {
      for (let erased = this.#top; erased < this.#lines.length; erased += 1) {
        this.#lines[erased] = []
      }
    }
    if (mode === 3) {
      this.#lines = this.#lines.slice(this.#top)
      this.#dropped += this.#top
      this.#cursor.row -= this.#top
      this.#saved.row = Math.max(0, this.#saved.row - this.#top)
      this.#top = 0
    }
  }
}

export { Screen }
