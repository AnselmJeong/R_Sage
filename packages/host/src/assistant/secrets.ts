// API keys for the assistant's model providers.
//
// macOS: the login Keychain (via /usr/bin/security), never a plain file.
// Elsewhere (Linux dev): ~/.rsage/secrets.json with mode 0600.
// An environment variable (ANTHROPIC_API_KEY / OPENAI_API_KEY) is used when
// nothing is stored, so developers can run without saving a key.

import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appDir, writeFileAtomic } from "../config";

const SERVICE = "R Sage";
const ENV: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export type KeySource = "keychain" | "file" | "env";

const useKeychain = () => process.platform === "darwin" && !process.env.RSAGE_NO_KEYCHAIN;
const filePath = () => join(appDir(), "secrets.json");

function readFile(): Record<string, string> {
  try {
    return existsSync(filePath()) ? JSON.parse(readFileSync(filePath(), "utf8")) : {};
  } catch {
    return {};
  }
}

function keychainGet(account: string): string | undefined {
  const p = Bun.spawnSync(["/usr/bin/security", "find-generic-password", "-s", SERVICE, "-a", account, "-w"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return p.exitCode === 0 ? p.stdout.toString().trim() || undefined : undefined;
}

export function getKey(provider: string): { key: string; source: KeySource } | undefined {
  const stored = useKeychain() ? keychainGet(provider) : readFile()[provider];
  if (stored) return { key: stored, source: useKeychain() ? "keychain" : "file" };
  const env = ENV[provider] ? process.env[ENV[provider]!] : undefined;
  return env ? { key: env, source: "env" } : undefined;
}

export function setKey(provider: string, key: string | null) {
  if (useKeychain()) {
    if (key === null) {
      Bun.spawnSync(["/usr/bin/security", "delete-generic-password", "-s", SERVICE, "-a", provider], { stdout: "ignore", stderr: "ignore" });
      return;
    }
    // -U updates an existing item. The key is passed as an argument, which is
    // visible to `ps` for the instant the command runs; security(1) offers no
    // stdin form for -w that works non-interactively.
    const p = Bun.spawnSync(["/usr/bin/security", "add-generic-password", "-U", "-s", SERVICE, "-a", provider, "-w", key], {
      stdout: "ignore",
      stderr: "pipe",
    });
    if (p.exitCode !== 0) throw new Error(`Keychain: ${p.stderr.toString().trim()}`);
    return;
  }
  const data = readFile();
  if (key === null) delete data[provider];
  else data[provider] = key;
  writeFileAtomic(filePath(), JSON.stringify(data, null, 2));
  chmodSync(filePath(), 0o600);
}
