import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pin the gateway timezone so day/week expectations hold on any machine. It's a +05:30 zone
    // with no DST, which catches code that assumes whole-hour offsets; DST cases pass a zone.
    env: { TIMEZONE: "Asia/Kolkata" },
  },
});
