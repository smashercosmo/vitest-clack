import config from "@smashercosmo/configs/oxfmt"
import { defineConfig } from "oxfmt"

/** Oxfmt doesn't support `extends`, so the shared config is spread instead. */
export default defineConfig({
  ...config,
  semi: false,
  experimentalOperatorPosition: "end",
  proseWrap: "always",
})
