// Creates the dashboard admin, or resets its password. Sign-up is disabled in the web UI.
// Usage: bun run admin create <email> <name> | password <email>
import { audit, type Actor } from "../lib/audit";
import { auth } from "../lib/auth/admin";
import { db, migrateDb } from "../lib/db/client";

migrateDb(db());
const actor: Actor = { adminUserId: null, ip: "cli", userAgent: "scripts/admin.ts" };
const [cmd, email, name] = process.argv.slice(2);

/** Reads a line from the terminal without echoing it. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = "";
    stdin.on("data", function onData(buf) {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") process.exit(130); // Ctrl-C
        value = ch === "\u007f" ? value.slice(0, -1) : value + ch;
      }
    });
  });
}

async function readPassword() {
  const password = await promptHidden("Password (min 12 chars): ");
  if (password.length < 12) throw new Error("Password must be at least 12 characters");
  if ((await promptHidden("Repeat password: ")) !== password) throw new Error("Passwords do not match");
  return password;
}

async function main() {
  const ctx = await auth.$context;

  if (cmd === "create" && email && name) {
    if (await ctx.internalAdapter.findUserByEmail(email)) throw new Error(`${email} already exists`);
    const password = await readPassword();
    const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({
      providerId: "credential",
      accountId: user.id,
      userId: user.id,
      password: await ctx.password.hash(password),
    });
    audit(db(), actor, { action: "admin.create", targetType: "admin", targetId: user.id, after: { email, name } });
    console.log(`Admin ${email} created. Sign in at /admin.`);
  } else if (cmd === "password" && email) {
    const found = await ctx.internalAdapter.findUserByEmail(email);
    if (!found) throw new Error(`No admin ${email}`);
    const password = await readPassword();
    await ctx.internalAdapter.updatePassword(found.user.id, await ctx.password.hash(password));
    audit(db(), actor, { action: "admin.password_reset", targetType: "admin", targetId: found.user.id });
    console.log(`Password updated for ${email}.`);
  } else {
    console.log("Usage: bun run admin create <email> <name> | password <email>");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
