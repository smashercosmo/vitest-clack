import {
  cancel,
  confirm,
  intro,
  isCancel,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts"
import timers from "node:timers"

/** A small but typical clack CLI, imported by the tests the way an app would be. */
async function main(): Promise<{ name: string; manager: string } | undefined> {
  intro("create-app")

  const name = await text({
    message: "Project name?",
    placeholder: "my-app",
    validate: (value) =>
      value === undefined || value === "" ? "A name is required" : undefined,
  })
  if (isCancel(name)) {
    cancel("Cancelled")
    return undefined
  }

  const manager = await select({
    message: "Package manager?",
    options: [
      { value: "npm", label: "npm" },
      { value: "pnpm", label: "pnpm" },
    ],
  })
  if (isCancel(manager)) {
    cancel("Cancelled")
    return undefined
  }

  const install = await confirm({ message: "Install dependencies?" })
  if (install === true) {
    const spin = spinner()
    spin.start("Installing")
    await timers.promises.setTimeout(20)
    spin.stop("Installed")
  }

  outro(`Created ${name}`)
  return { name, manager }
}

export { main }
