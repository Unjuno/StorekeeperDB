import { existsSync, readFileSync } from "node:fs";

type PackageExport = {
  types?: string;
  import?: string;
};

type CompletePackageExport = {
  types: string;
  import: string;
};

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  exports?: Record<string, PackageExport>;
};

const fail = (message: string): never => {
  console.error(`release check failed: ${message}`);
  process.exit(1);
};

const requireFile = (path: string): void => {
  if (!existsSync(path)) fail(`missing required file: ${path}`);
};

const requireExport = (pkg: PackageJson, exportName: string): CompletePackageExport => {
  const entry = pkg.exports?.[exportName];
  if (entry === undefined) fail(`missing export entry: ${exportName}`);

  const importPath = entry.import;
  const typesPath = entry.types;

  if (typeof importPath !== "string" || importPath.length === 0) {
    fail(`missing import path for export: ${exportName}`);
  }

  if (typeof typesPath !== "string" || typesPath.length === 0) {
    fail(`missing types path for export: ${exportName}`);
  }

  return { import: importPath, types: typesPath };
};

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

if (pkg.name !== "@storekeeper/db") fail(`unexpected package name: ${pkg.name ?? "<missing>"}`);
if (!pkg.version?.includes("alpha")) fail(`alpha release must use an alpha version: ${pkg.version ?? "<missing>"}`);
if (pkg.private !== false) fail("package.json private must be false for public alpha dry-run checks");

const expectedFileEntries = ["dist", "README.md", "LICENSE", "CHANGELOG.md", "docs"];
for (const entry of expectedFileEntries) {
  if (!pkg.files?.includes(entry)) fail(`package files must include ${entry}`);
}

const expectedExports = [".", "./core", "./node", "./react", "./experimental"];
for (const exportName of expectedExports) {
  const entry = requireExport(pkg, exportName);
  requireFile(entry.import.replace(/^\.\//, ""));
  requireFile(entry.types.replace(/^\.\//, ""));
}

const publicDocs = [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "docs/RELEASE.md",
  "docs/TRANSACTION_MODEL.md",
  "docs/BROWSER_BOUNDARY.md",
  "docs/RUNTIME_HARDENING.md",
  "docs/NEXT_WORK.md",
];

for (const path of publicDocs) requireFile(path);

console.log(JSON.stringify({
  packageName: pkg.name,
  version: pkg.version,
  checkedExports: expectedExports.length,
  checkedDocs: publicDocs.length,
  pass: true,
}, null, 2));
