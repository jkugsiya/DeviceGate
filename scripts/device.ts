// Command-line device management; the admin UI uses the same audited helpers from lib/devices.ts.
// Usage: bun run device create <name> | setup <id> | list | rename <id> <name> | disable <id> | enable <id> | rotate <id>
import { isNull } from "drizzle-orm";
import type { Actor } from "../lib/audit";
import { db, migrateDb } from "../lib/db/client";
import { devices } from "../lib/db/schema";
import { publicBaseUrl } from "../lib/config";
import { createDevice, rotateDeviceToken, setDeviceStatus, updateDeviceDetails } from "../lib/devices";
import { createEnrollmentCode } from "../lib/enrollment";

const database = db();
migrateDb(database);
const actor: Actor = { adminUserId: null, ip: "cli", userAgent: "scripts/device.ts" };
const [cmd, id, name] = process.argv.slice(2);

function printSetup(deviceId: string) {
  const { code, expiresAt } = createEnrollmentCode(database, actor, deviceId);
  const base = publicBaseUrl();
  console.log(`Setup code ${code} (single use, expires ${expiresAt.toLocaleTimeString()}). On the PC run:`);
  console.log(`  macOS/Linux: curl -fsSL ${base}/setup.sh | sh -s -- ${code}`);
  console.log(`  Windows:     & ([scriptblock]::Create((irm ${base}/setup.ps1))) ${code}`);
}

switch (cmd) {
  case "create": {
    if (!id) throw new Error("Usage: device create <name>");
    const created = createDevice(database, actor, { name: id });
    console.log(`Created device "${id}" (${created.id})`);
    printSetup(created.id);
    break;
  }
  case "setup":
    printSetup(id);
    break;
  case "list":
    console.table(
      database
        .select({ id: devices.id, name: devices.name, status: devices.status, lastSeenAt: devices.lastSeenAt, lastIp: devices.lastIp })
        .from(devices)
        .where(isNull(devices.deletedAt))
        .all(),
    );
    break;
  case "rename":
    if (!id || !name) throw new Error("Usage: device rename <id> <name>");
    updateDeviceDetails(database, actor, id, { name, notes: null });
    console.log(`Renamed ${id} to "${name}"`);
    break;
  case "disable":
  case "enable":
    setDeviceStatus(database, actor, id, cmd === "disable" ? "disabled" : "enabled");
    console.log(`Device ${id} ${cmd}d`);
    break;
  case "rotate":
    console.log(`Token (shown once): ${rotateDeviceToken(database, actor, id)}`);
    break;
  default:
    console.log("Usage: bun run device create <name> | setup <id> | list | rename <id> <name> | disable <id> | enable <id> | rotate <id>");
}
