const { execFileSync } = require("node:child_process");
const { createWriteStream, mkdirSync, readFileSync, unlinkSync, chmodSync } = require("node:fs");
const { join } = require("node:path");
const https = require("node:https");

const repo = "kiyo-e/p2p-share-files";
const pkgPath = join(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;

const target = resolveTarget(process.platform, process.arch);
const asset = `pairlane-${version}-${target}.tar.gz`;
const url = `https://github.com/${repo}/releases/download/v${version}/${asset}`;

const distDir = join(__dirname, "..", "dist");
mkdirSync(distDir, { recursive: true });

const archivePath = join(distDir, asset);

main().catch((err) => {
  console.error("pairlane: failed to download the CLI binary.");
  console.error(err.message || err);
  process.exit(1);
});

async function main() {
  await download(url, archivePath);
  execFileSync("tar", ["-xzf", archivePath, "-C", distDir]);
  chmodSync(join(distDir, "pairlane"), 0o755);
  unlinkSync(archivePath);
}

function resolveTarget(platform, arch) {
  if (platform === "linux" && arch === "x64") {
    return "x86_64-unknown-linux-gnu";
  }
  if (platform === "darwin" && arch === "x64") {
    return "x86_64-apple-darwin";
  }
  if (platform === "darwin" && arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          res.resume();
          return;
        }
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => reject(err));
  });
}
