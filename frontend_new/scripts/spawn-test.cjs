const { spawnSync } = require("node:child_process");
const path = require("node:path");

const exe = path.resolve(__dirname, "../node_modules/@esbuild/win32-x64/esbuild.exe");

const direct = spawnSync(exe, ["--version"], { encoding: "utf8" });
console.log("direct", {
  status: direct.status,
  error: direct.error && { code: direct.error.code, message: direct.error.message },
  stdout: direct.stdout,
  stderr: direct.stderr,
});

const viaCmd = spawnSync("cmd.exe", ["/c", `"${exe}" --version`], { encoding: "utf8" });
console.log("viaCmd", {
  status: viaCmd.status,
  error: viaCmd.error && { code: viaCmd.error.code, message: viaCmd.error.message },
  stdout: viaCmd.stdout,
  stderr: viaCmd.stderr,
});

