/**
 * The shape of a key event, exactly as Node's `readline.emitKeypressEvents()`
 * produces it. Clack (and the `readline` interface it creates) consume these
 * objects, so we emit the very same shape instead of writing raw bytes. That
 * keeps key presses synchronous and deterministic (a raw `\x1b` would otherwise
 * wait for readline's escape-code timeout).
 */
interface KeyEvent {
  sequence: string
  name: string | undefined
  ctrl: boolean
  meta: boolean
  shift: boolean
  code?: string
}

type Letter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z"

type NamedKey =
  | "enter"
  | "return"
  | "escape"
  | "tab"
  | "shift+tab"
  | "backspace"
  | "delete"
  | "space"
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "pageup"
  | "pagedown"

type Key = NamedKey | `ctrl+${Letter}`

/**
 * A key event as emitted by Node, plus the `str` argument it is emitted with
 * (`undefined` for escape sequences, the raw character otherwise).
 */
interface Keypress {
  str: string | undefined
  key: KeyEvent
}

function event(
  sequence: string,
  name?: string,
  extra: Partial<KeyEvent> = {},
): KeyEvent {
  return { sequence, name, ctrl: false, meta: false, shift: false, ...extra }
}

const NAMED_KEYS: Record<NamedKey, Keypress> = {
  // Terminals send a carriage return for the Enter key, which Node names "return".
  // Clack only submits on `name === "return"`, so "enter" is an alias for it.
  enter: { str: "\r", key: event("\r", "return") },
  return: { str: "\r", key: event("\r", "return") },
  escape: { str: undefined, key: event("\u001B", "escape", { meta: true }) },
  tab: { str: "\t", key: event("\t", "tab") },
  "shift+tab": {
    str: undefined,
    key: event("\u001B[Z", "tab", { shift: true, code: "[Z" }),
  },
  backspace: { str: "\u007F", key: event("\u007F", "backspace") },
  delete: {
    str: undefined,
    key: event("\u001B[3~", "delete", { code: "[3~" }),
  },
  space: { str: " ", key: event(" ", "space") },
  up: { str: undefined, key: event("\u001B[A", "up", { code: "[A" }) },
  down: { str: undefined, key: event("\u001B[B", "down", { code: "[B" }) },
  right: { str: undefined, key: event("\u001B[C", "right", { code: "[C" }) },
  left: { str: undefined, key: event("\u001B[D", "left", { code: "[D" }) },
  home: { str: undefined, key: event("\u001B[H", "home", { code: "[H" }) },
  end: { str: undefined, key: event("\u001B[F", "end", { code: "[F" }) },
  pageup: {
    str: undefined,
    key: event("\u001B[5~", "pageup", { code: "[5~" }),
  },
  pagedown: {
    str: undefined,
    key: event("\u001B[6~", "pagedown", { code: "[6~" }),
  },
}

const CTRL_KEY = /^ctrl\+(?<letter>[a-z])$/v

function isNamedKey(value: string): value is NamedKey {
  return Object.hasOwn(NAMED_KEYS, value)
}

function isKey(value: string): value is Key {
  return isNamedKey(value) || CTRL_KEY.test(value)
}

/**
 * Resolves a key name (`"enter"`, `"down"`, `"ctrl+c"`, ...) to the event Node
 * would emit.
 */
function keypressFor(key: Key): Keypress {
  const letter = CTRL_KEY.exec(key)?.groups?.["letter"]
  if (letter !== undefined) {
    const sequence = String.fromCodePoint((letter.codePointAt(0) ?? 0) - 96)
    return { str: sequence, key: event(sequence, letter, { ctrl: true }) }
  }
  if (!isNamedKey(key)) {
    throw new TypeError(`Unknown key "${key}"`)
  }
  return NAMED_KEYS[key]
}

/**
 * Resolves a single typed character to the event Node would emit for it.
 * Mirrors the branches of `emitKeys()` in `node:internal/readline/utils`.
 */
function keypressForChar(char: string): Keypress {
  switch (char) {
    case "\r": {
      return { str: char, key: event(char, "return") }
    }
    case "\n": {
      return { str: char, key: event(char, "enter") }
    }
    case "\t": {
      return { str: char, key: event(char, "tab") }
    }
    case "\b":
    case "\u007F": {
      return { str: char, key: event(char, "backspace") }
    }
    case " ": {
      return { str: char, key: event(char, "space") }
    }
    default: {
      break
    }
  }

  if (char <= "\u001A") {
    const name = String.fromCodePoint((char.codePointAt(0) ?? 0) + 96)
    return { str: char, key: event(char, name, { ctrl: true }) }
  }

  if (/^[0-9a-z]$/iv.test(char)) {
    return {
      str: char,
      key: event(char, char.toLowerCase(), { shift: /^[A-Z]$/v.test(char) }),
    }
  }

  // Readline doesn't name printable characters other than letters and digits.
  return { str: char, key: event(char) }
}

export { isKey, keypressFor, keypressForChar }
export type { Key, KeyEvent, Keypress, Letter, NamedKey }
