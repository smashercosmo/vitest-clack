import config from "@smashercosmo/configs/oxlint"
import { defineConfig } from "oxlint"

export default defineConfig({
  /** Options can't be set in a shared config. */
  options: {
    reportUnusedDisableDirectives: "error",
    typeAware: true,
  },
  extends: [config],
  rules: {
    /** Node modules are imported whole and used with dot-notation. */
    "unicorn/import-style": [
      "error",
      { styles: { "node:util": { default: true } } },
    ],
    /**
     * `unicorn/escape-case` wants uppercase escapes and `unicorn/no-hex-escape`
     * wants `\u` over `\x`, in regexes too. The regexp rules said the opposite,
     * so they follow unicorn here.
     */
    "regexp/letter-case": [
      "error",
      { unicodeEscape: "uppercase", hexadecimalEscape: "uppercase" },
    ],
    "regexp/hexadecimal-escape": ["error", "never"],
    /** Members are public unless marked otherwise; `#private` marks the rest. */
    "typescript/explicit-member-accessibility": [
      "error",
      { accessibility: "no-public" },
    ],
    /**
     * Function declarations are hoisted: helpers can follow the code using
     * them.
     */
    "no-use-before-define": ["error", { functions: false }],

    /* ---- Rules that made the code worse rather than better ---- */

    /** Typing into a terminal is sequential: one key press after another. */
    "no-await-in-loop": "off",
    /**
     * `Number.parseInt` reads an empty escape-sequence parameter as `NaN`, i.e.
     * missing. `Number("")` would read it as 0.
     */
    "unicorn/prefer-number-coercion": "off",
    /** Copying a few small objects is no cost worth restructuring code for. */
    "oxc/no-map-spread": "off",
    /** It flags Node's own callback APIs, such as `Writable`'s `write()`. */
    "promise/prefer-await-to-callbacks": "off",
    /**
     * TypeScript checks definite assignment; `let x = undefined` is then
     * flagged as useless.
     */
    "init-declarations": "off",
    "no-inline-comments": "off",
    /**
     * Small related classes, such as the kinds of steps or a terminal and its
     * streams, read best side by side.
     */
    "max-classes-per-file": "off",
    /**
     * Types already say what parameters and results are; tags only restated
     * names.
     */
    "jsdoc/require-param": "off",
    "jsdoc/require-returns": "off",
  },
  overrides: [
    {
      files: ["**/*.spec.ts"],
      rules: {
        /** A test of a whole prompt checks several outcomes of one run. */
        "vitest/max-expects": ["error", { max: 10 }],
        /** A synchronous test can't finish before its assertions run. */
        "vitest/prefer-expect-assertions": [
          "error",
          { onlyFunctionsWithAsyncKeyword: true },
        ],
        /**
         * Tests made with `withClack()` under another name than `it`, e.g. a
         * test with a smaller terminal. Listing names replaces the rule's
         * defaults, so `it` is listed too.
         */
        "vitest/no-standalone-expect": [
          "error",
          {
            additionalTestBlockFunctions: [
              "it",
              "small",
              "withGreeting",
              "withCli",
            ],
          },
        ],
        "vitest/require-hook": [
          "error",
          { allowedFunctionCalls: ["small", "withGreeting", "withCli"] },
        ],
      },
    },
  ],
})
